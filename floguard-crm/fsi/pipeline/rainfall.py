"""Daily rainfall refresh: advance API_t, recompute fsi_live.

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


if __name__ == "__main__":
    import psycopg

    fips = os.environ.get("FSI_COUNTY_FIPS", "12127")
    dsn = os.environ["DATABASE_URL"]
    with psycopg.connect(dsn) as connection:
        count = refresh_county(fips, connection)
    print(f"fsi_live updated for {count} parcels in county {fips}")
