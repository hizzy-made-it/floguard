"""Daily rainfall refresh: advance API_t, recompute fsi_live.

Two sources, chosen by FSI_RAIN_SOURCE (default open_meteo):
  open_meteo  one county-centroid sample (refresh_county), or the 0.05 deg
              cell grid run inside Postgres by sql/009.
  mrms        NOAA MRMS multi-sensor radar QPE, 0.01 deg (~1 km) grid, 24 h and
              72 h accumulations (refresh_cells_mrms). Per-cell API state is
              keyed to the MRMS grid: rainfall_cell.cell_id = 'm<row>_<col>'.
              sql/018 rain_source_use('mrms') points parcels at those cells, and
              the existing fsi_apply_dynamic_cells() picks them up unchanged.


Runs once per day per county. Cheap: one API call, one state row, one bulk
UPDATE. The expensive terrain work already happened in terrain.py.

    API_t = k * API_(t-1) + P_t
    D     = w5*API_n + w6*Rain24_n
    FSI   = 100 * S^alpha * (0.5 + 0.5*D)

Normalization: API and Rain24 are divided by saturating caps rather than
min/max scaled across the county, because on any given day every parcel in a
single county sees nearly the same rainfall -- min/max scaling would amplify
millimetre noise into a full 0-1 spread.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from .config import advance_api, composite_fsi, dynamic_score

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Saturating caps, millimetres. Past these the soil is already at field
# capacity and more rain does not raise the sales signal further.
API_CAP_MM = 150.0
RAIN24_CAP_MM = 75.0

# Volusia County centroid. One rainfall sample per county is the documented
# first cut; switch to MRMS radar grid sampling when multi-county lands.
COUNTY_CENTROIDS = {
    "12127": (29.0280, -81.0755),  # Volusia
}


@dataclass
class RainfallObservation:
    county_fips: str
    rain_24h_mm: float
    observed_at: datetime


def fetch_rain_24h(county_fips: str, client: httpx.Client | None = None) -> RainfallObservation:
    """Fetch the last completed day's precipitation total for a county.

    Open-Meteo needs no API key and serves 92 days of history plus forecast.
    """
    try:
        lat, lon = COUNTY_CENTROIDS[county_fips]
    except KeyError:
        raise ValueError(f"no centroid configured for county_fips={county_fips!r}") from None

    owns_client = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        response = client.get(
            OPEN_METEO_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "daily": "precipitation_sum",
                "past_days": 1,
                "forecast_days": 1,
                "timezone": "UTC",
            },
        )
        response.raise_for_status()
        payload = response.json()
    finally:
        if owns_client:
            client.close()

    daily = payload.get("daily") or {}
    totals = daily.get("precipitation_sum") or []
    dates = daily.get("time") or []
    if not totals or not dates:
        raise RuntimeError(f"Open-Meteo returned no daily precipitation for {county_fips}")

    # Index 0 is the last COMPLETE day. Index 1 is today, still accumulating,
    # so using it would under-report every morning the cron runs.
    rain = totals[0]
    if rain is None:
        raise RuntimeError(f"Open-Meteo precipitation_sum was null for {dates[0]}")

    observed = datetime.fromisoformat(dates[0]).replace(tzinfo=timezone.utc)
    return RainfallObservation(county_fips, float(rain), observed)


def normalize(value: float, cap: float) -> float:
    """Clamp to 0-1 against a saturating cap."""
    if cap <= 0:
        raise ValueError("cap must be positive")
    return min(max(value, 0.0) / cap, 1.0)


def refresh_county(county_fips: str, conn) -> int:
    """Advance API_t and rewrite fsi_live for every parcel in a county.

    `conn` is a psycopg connection. Returns the number of parcels updated.
    """
    observation = fetch_rain_24h(county_fips)

    with conn.cursor() as cur:
        cur.execute(
            "select api_value from rainfall_state where county_fips = %s",
            (county_fips,),
        )
        row = cur.fetchone()
        # Cold start: seed API_t from today's rain rather than 0, so the first
        # run does not report the whole county as bone dry.
        prev_api = row[0] if row else observation.rain_24h_mm

        new_api = advance_api(prev_api, observation.rain_24h_mm)

        cur.execute(
            """
            insert into rainfall_state (county_fips, api_value, rain_24h, observed_at)
            values (%s, %s, %s, %s)
            on conflict (county_fips) do update set
              api_value   = excluded.api_value,
              rain_24h    = excluded.rain_24h,
              observed_at = excluded.observed_at
            """,
            (county_fips, new_api, observation.rain_24h_mm, observation.observed_at),
        )

        d = dynamic_score(
            normalize(new_api, API_CAP_MM),
            normalize(observation.rain_24h_mm, RAIN24_CAP_MM),
        )
        # D is county-uniform for this cut, so the multiplier is a constant and
        # the whole county updates in one statement.
        multiplier = composite_fsi(1.0, d)

        cur.execute(
            """
            update parcel_risk
               set fsi_live   = fsi_static * %s,
                   updated_at = now()
             where fsi_static is not null
            """,
            (multiplier,),
        )
        updated = cur.rowcount

    conn.commit()
    return updated


# ---------------------------------------------------------------------------
# NOAA MRMS radar QPE
# ---------------------------------------------------------------------------
# Access path confirmed 2026-11-19 (live listing + download from this repo's
# build environment): AWS Open Data bucket noaa-mrms-pds, anonymous HTTPS.
#   https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MultiSensor_QPE_24H_Pass2_00.00/
#       20261118/MRMS_MultiSensor_QPE_24H_Pass2_00.00_20261118-120000.grib2.gz
#   ... and MultiSensor_QPE_72H_Pass2_00.00 with the same naming.
# Hourly files; Pass2 has ~2 h latency and includes gauge correction, which is
# why it is used instead of Pass1 or RadarOnly.
# Grid (read from that file with GDAL): 7000 x 3500, 0.01 deg, upper-left
# corner -130.00 W / 55.00 N, cell centres at -129.995 + 0.01*col, 54.995 - 0.01*row.
# Units mm; negative values are missing (no radar coverage).
# Daily convention: the 24 h product valid 12:00 UTC is the 7 am-7 am EST
# climatological day (the COOP observer day), so "yesterday's rain" is read at
# 12Z today; the cron should run after ~14:30 UTC to clear the Pass2 latency.

RAIN_SOURCE = os.environ.get("FSI_RAIN_SOURCE", "open_meteo")
MRMS_BUCKET_URL = "https://noaa-mrms-pds.s3.amazonaws.com"
MRMS_PRODUCTS = {"24h": "MultiSensor_QPE_24H_Pass2", "72h": "MultiSensor_QPE_72H_Pass2"}
MRMS_NCOLS = 7000
MRMS_NROWS = 3500
MRMS_DEG = 0.01
MRMS_WEST = -130.0   # left edge of column 0
MRMS_NORTH = 55.0    # top edge of row 0


def mrms_index(lat: float, lon: float) -> tuple[int, int]:
    """(row, col) of the MRMS cell containing lat/lon. Raises outside CONUS grid."""
    # Written exactly like sql/018 mrms_cell_id() so Python and SQL agree bit for bit.
    import math

    row = math.floor((55.0 - lat) / 0.01)
    col = math.floor((lon + 130.0) / 0.01)
    if not (0 <= row < MRMS_NROWS and 0 <= col < MRMS_NCOLS):
        raise ValueError(f"{lat},{lon} is outside the MRMS CONUS grid")
    return row, col


def mrms_cell_center(row: int, col: int) -> tuple[float, float]:
    return (MRMS_NORTH - (row + 0.5) * MRMS_DEG, MRMS_WEST + (col + 0.5) * MRMS_DEG)


def mrms_cell_id(row: int, col: int) -> str:
    """Same text sql/018 mrms_cell_id() produces: 'm' || row || '_' || col."""
    return f"m{row}_{col}"


def parse_mrms_cell_id(cell_id: str) -> tuple[int, int]:
    r, c = cell_id[1:].split("_")
    return int(r), int(c)


def mrms_url(product: str, valid: datetime) -> str:
    name = MRMS_PRODUCTS[product]
    d = valid.strftime("%Y%m%d")
    t = valid.strftime("%H%M%S")
    return f"{MRMS_BUCKET_URL}/CONUS/{name}_00.00/{d}/MRMS_{name}_00.00_{d}-{t}.grib2.gz"


def read_mrms_values(grib_path, cells: list[tuple[int, int]]) -> list[float | None]:
    """Values (mm) at MRMS (row, col) cells from a decompressed .grib2 (or .tif in tests).

    Indexing goes through the file's own geotransform, not the constants, so a
    future grid change shows up as wrong-cell values only if the transform also
    lies; the constants are asserted to match so that change is loud instead.
    """
    import numpy as np
    import rasterio

    with rasterio.open(grib_path) as ds:
        t = ds.transform
        if abs(t.a - MRMS_DEG) > 1e-9 or abs(t.c - MRMS_WEST) > 1e-6 or abs(t.f - MRMS_NORTH) > 1e-6:
            raise RuntimeError(f"MRMS grid changed: transform {t}")
        arr = ds.read(1)
    out = []
    for r, c in cells:
        v = float(arr[r, c]) if 0 <= r < arr.shape[0] and 0 <= c < arr.shape[1] else float("nan")
        out.append(v if np.isfinite(v) and v >= 0 else None)
    return out


def fetch_mrms(product: str, valid: datetime, dest_dir, client: httpx.Client | None = None):
    """Download + gunzip one MRMS file. Returns the .grib2 path."""
    import gzip
    import shutil
    from pathlib import Path

    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    url = mrms_url(product, valid)
    gz = dest_dir / url.rsplit("/", 1)[-1]
    out = gz.with_suffix("")
    if out.exists():
        return out
    own = client is None
    client = client or httpx.Client(timeout=120.0)
    try:
        r = client.get(url)
        r.raise_for_status()
        gz.write_bytes(r.content)
    finally:
        if own:
            client.close()
    with gzip.open(gz, "rb") as fi, out.open("wb") as fo:
        shutil.copyfileobj(fi, fo)
    gz.unlink(missing_ok=True)
    return out


def api_from_72h(rain24: float, rain72: float, k: float = None) -> float:
    """Cold-start API from the 72 h total when no prior state exists.

    The two days before the last 24 h are not separated in one 72 h file;
    split them evenly: API ~ P0 + k*P1 + k^2*P2 with P1 = P2 = (72h - 24h)/2.
    Undercounts older rain (>3 days), which decays by 0.87^3 = 0.66 anyway.
    """
    from .config import API_DECAY_K

    k = API_DECAY_K if k is None else k
    rest = max(0.0, (rain72 or 0.0) - (rain24 or 0.0))
    return (rain24 or 0.0) + (k + k * k) * rest / 2.0


def advance_cell(prev_api: float | None, prev_day, rain24: float, rain72: float | None, day) -> float:
    """API_t for one cell. Unbroken daily chain -> k*API + P; same day -> unchanged;
    gap or cold start -> rebuilt from the 72 h accumulation."""
    if prev_api is not None and prev_day is not None:
        gap = (day - prev_day).days
        if gap <= 0:
            return prev_api
        if gap == 1:
            return advance_api(prev_api, rain24)
    return api_from_72h(rain24, rain72 if rain72 is not None else rain24)


def refresh_cells_mrms(conn, day=None, work_dir="data/mrms") -> int:
    """Update rainfall_cell rows for every MRMS cell that has parcels (sql/018
    parcel_risk.mrms_cell). `day` = the rain day (date) ending 12Z day+1.
    Returns the number of cells written. Does not touch fsi_live: the existing
    pg_cron fsi_daily() applies the cells at 12:00 UTC... so schedule this
    before it, or call fsi_apply_dynamic_cells() afterwards.
    """
    from datetime import date, timedelta

    day = day or (datetime.now(timezone.utc).date() - timedelta(days=1))
    valid = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc) + timedelta(days=1)
    with conn.cursor() as cur:
        cur.execute("select distinct mrms_cell from parcel_risk where mrms_cell is not null")
        cells = [r[0] for r in cur.fetchall()]
        if not cells:
            raise RuntimeError("no parcel_risk.mrms_cell values: run select mrms_cells_seed() (sql/018) first")
        rc = [parse_mrms_cell_id(c) for c in cells]
        g24 = fetch_mrms("24h", valid, work_dir)
        g72 = fetch_mrms("72h", valid, work_dir)
        v24 = read_mrms_values(g24, rc)
        v72 = read_mrms_values(g72, rc)
        cur.execute("select cell_id, api_value, rain_day from rainfall_cell where cell_id = any(%s)", (cells,))
        prev = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
        n = 0
        for cid, (r, c), p24, p72 in zip(cells, rc, v24, v72):
            if p24 is None:
                continue  # no radar coverage: leave the cell stale; SQL falls back to county d
            pa, pd_ = prev.get(cid, (None, None))
            api = advance_cell(pa, pd_, p24, p72, day)
            d = dynamic_score(normalize(api, API_CAP_MM), normalize(p24, RAIN24_CAP_MM))
            lat, lon = mrms_cell_center(r, c)
            cur.execute(
                """
                insert into rainfall_cell (cell_id, lat, lon, api_value, rain_24h, rain_72h, rain_day, d,
                                           observed_at, source)
                values (%s, %s, %s, %s, %s, %s, %s, %s, now(), 'mrms')
                on conflict (cell_id) do update set
                  api_value = excluded.api_value, rain_24h = excluded.rain_24h, rain_72h = excluded.rain_72h,
                  rain_day = excluded.rain_day, d = excluded.d, observed_at = now(), source = 'mrms'
                """,
                (cid, lat, lon, round(api, 2), round(p24, 2), None if p72 is None else round(p72, 2),
                 day, round(d, 3)),
            )
            n += 1
    conn.commit()
    return n


if __name__ == "__main__":
    import psycopg

    fips = os.environ.get("FSI_COUNTY_FIPS", "12127")
    dsn = os.environ["DATABASE_URL"]
    with psycopg.connect(dsn) as connection:
        if RAIN_SOURCE == "mrms":
            n = refresh_cells_mrms(connection)
            print(f"mrms: {n} rainfall cells updated; fsi_live follows at the next fsi_daily()")
        else:
            count = refresh_county(fips, connection)
            print(f"fsi_live updated for {count} parcels in county {fips}")
