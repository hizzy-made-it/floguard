"""Step 1 of the build order: Volusia parcel ingest.

Pulls address, owner, and polygon geometry for every parcel from the county
property-appraiser ArcGIS REST layer and upserts them into `parcel_risk`. This
is the seed the whole system grows from -- terrain.py fills the score columns
on these rows, and the rainfall cron rewrites fsi_live over them.

    ArcGIS REST FeatureServer/MapServer layer  (public record, FL law)
      -> paginated /query, f=geojson, outSR=4326
      -> keep parcel_id / address / owner / MultiPolygon
      -> upsert parcel_risk  (identity + geometry only; scores stay null)

Deliberately touches only the identity and geometry columns. twi/hand/hsg/
fema_zone/fsi_static/fsi_live are owned by terrain.py and rainfall.py; an
ON CONFLICT here that overwrote them would silently wipe a completed terrain
run every time parcels were re-ingested.

Config, because appraiser schemas vary by county and change without notice:

    FSI_PARCEL_LAYER_URL   .../FeatureServer/0  or  .../MapServer/0
                           (the layer, WITHOUT the trailing /query)
    FSI_PARCEL_ID_FIELDS   comma-separated candidates; first present wins
    FSI_PARCEL_ADDR_FIELDS   "
    FSI_PARCEL_OWNER_FIELDS  "

The field defaults below are the labels Volusia commonly publishes, but the
appraiser is the source of truth -- open `<layer>?f=json` and read `fields`
before trusting them. A wrong parcel-id field would upsert every parcel onto
one key; the run aborts (see main) if the id field resolves to nothing.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Iterable, Iterator

import httpx
from shapely.geometry import shape

# Layer's own /query cap is echoed as `exceededTransferLimit`; we page until it
# clears. 1000 is a widely supported request size -- higher is often silently
# clamped, which would make the offset math skip records.
PAGE_SIZE = 1000

# Volusia County (maps2.vcgov.org Pictometry_Parcels/ParcelOwners) + generic fallbacks.
# Confirm at <layer>?f=json if the appraiser renames fields.
DEFAULT_LAYER_URL = (
    "https://maps2.vcgov.org/arcgis/rest/services/Pictometry_Parcels/MapServer/0"
)
DEFAULT_ID_FIELDS = (
    "PARID",
    "ALTKEY",
    "PID",
    "ALT_ID",
    "DORPID",
    "PARCELID",
    "PARCEL_ID",
    "PIN",
    "STRAP",
)
DEFAULT_ADDR_FIELDS = (
    "ADDRFULL",
    "SITEADDR",
    "SITE_ADDR",
    "SITUS",
    "PHYSADDR",
    "PHY_ADDR1",
    "ADDRESS",
)
DEFAULT_OWNER_FIELDS = (
    "OWNER1",
    "OWNER",
    "OWNER_NAME",
    "OWN_NAME",
    "OWNNAME",
    "NAME",
)


@dataclass(frozen=True)
class FieldMapping:
    id_fields: tuple[str, ...]
    addr_fields: tuple[str, ...]
    owner_fields: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "FieldMapping":
        def parse(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
            raw = os.environ.get(name)
            if not raw:
                return default
            return tuple(part.strip() for part in raw.split(",") if part.strip())

        return cls(
            id_fields=parse("FSI_PARCEL_ID_FIELDS", DEFAULT_ID_FIELDS),
            addr_fields=parse("FSI_PARCEL_ADDR_FIELDS", DEFAULT_ADDR_FIELDS),
            owner_fields=parse("FSI_PARCEL_OWNER_FIELDS", DEFAULT_OWNER_FIELDS),
        )


@dataclass(frozen=True)
class ParcelRow:
    parcel_id: str
    address: str | None
    owner_name: str | None
    lat: float
    lon: float
    geojson: str  # geometry as a GeoJSON string, for ST_GeomFromGeoJSON


def _pick(props: dict, candidates: Iterable[str]) -> str | None:
    """First candidate field that carries a non-empty value.

    ArcGIS field names are case-sensitive on some servers and folded on others,
    so match case-insensitively against whatever keys the feature actually has.
    """
    lookup = {key.lower(): key for key in props}
    for candidate in candidates:
        key = lookup.get(candidate.lower())
        if key is None:
            continue
        value = props[key]
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def parcel_row_from_feature(feature: dict, mapping: FieldMapping) -> ParcelRow | None:
    """Convert one GeoJSON feature to a ParcelRow, or None if unusable.

    Unusable = no parcel id, or no polygon geometry. Both are dropped rather
    than defaulted: a parcel with no id cannot be keyed, and a point/line row
    would violate the MultiPolygon column. The caller counts the drops.
    """
    props = feature.get("properties") or {}
    parcel_id = _pick(props, mapping.id_fields)
    if not parcel_id:
        return None

    raw_geom = feature.get("geometry")
    if not raw_geom:
        return None
    geom = shape(raw_geom)
    if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
        return None

    # representative_point() is guaranteed to sit inside the polygon; a plain
    # centroid can land outside an L-shaped or crescent parcel and put the map
    # pin in a neighbor's yard.
    point = geom.representative_point()

    return ParcelRow(
        parcel_id=parcel_id,
        address=_pick(props, mapping.addr_fields),
        owner_name=_pick(props, mapping.owner_fields),
        lat=point.y,
        lon=point.x,
        geojson=json.dumps(raw_geom),
    )


def fetch_features(
    layer_url: str,
    client: httpx.Client | None = None,
    page_size: int = PAGE_SIZE,
) -> Iterator[dict]:
    """Yield every GeoJSON feature from an ArcGIS REST layer, paging by offset.

    `layer_url` is the layer endpoint WITHOUT `/query`. Stops when a page comes
    back short and the server is not signalling more -- relying on
    `exceededTransferLimit` alone is unsafe, since some servers omit it.
    """
    query_url = layer_url.rstrip("/") + "/query"
    owns_client = client is None
    client = client or httpx.Client(timeout=120.0)
    offset = 0
    try:
        while True:
            response = client.get(
                query_url,
                params={
                    "where": "1=1",
                    "outFields": "*",
                    "outSR": 4326,
                    "f": "geojson",
                    "resultOffset": offset,
                    "resultRecordCount": page_size,
                },
            )
            response.raise_for_status()
            payload = response.json()

            features = payload.get("features") or []
            if not features:
                return
            yield from features

            more = payload.get("exceededTransferLimit")
            if not more and len(features) < page_size:
                return
            offset += len(features)
    finally:
        if owns_client:
            client.close()


UPSERT_SQL = """
insert into parcel_risk (parcel_id, address, owner_name, lat, lon, geom, updated_at)
values (
    %(parcel_id)s, %(address)s, %(owner_name)s, %(lat)s, %(lon)s,
    st_multi(st_setsrid(st_geomfromgeojson(%(geojson)s), 4326)),
    now()
)
on conflict (parcel_id) do update set
    address    = excluded.address,
    owner_name = excluded.owner_name,
    lat        = excluded.lat,
    lon        = excluded.lon,
    geom       = excluded.geom,
    updated_at = now()
"""


def upsert_parcels(rows: Iterable[ParcelRow], conn, batch_size: int = 500) -> int:
    """Upsert ParcelRows into parcel_risk. Returns the row count written.

    Identity and geometry only -- the ON CONFLICT clause never names a score
    column, so a re-ingest cannot clobber a terrain run. `conn` is a psycopg
    connection; commits once at the end.
    """
    written = 0
    batch: list[dict] = []

    def flush(cur) -> None:
        nonlocal written
        if not batch:
            return
        cur.executemany(UPSERT_SQL, batch)
        written += len(batch)
        batch.clear()

    with conn.cursor() as cur:
        for row in rows:
            batch.append(
                {
                    "parcel_id": row.parcel_id,
                    "address": row.address,
                    "owner_name": row.owner_name,
                    "lat": row.lat,
                    "lon": row.lon,
                    "geojson": row.geojson,
                }
            )
            if len(batch) >= batch_size:
                flush(cur)
        flush(cur)

    conn.commit()
    return written


def ingest(layer_url: str, conn, mapping: FieldMapping | None = None) -> tuple[int, int]:
    """Fetch, transform, upsert. Returns (written, skipped)."""
    mapping = mapping or FieldMapping.from_env()
    skipped = 0

    def rows() -> Iterator[ParcelRow]:
        nonlocal skipped
        for feature in fetch_features(layer_url):
            row = parcel_row_from_feature(feature, mapping)
            if row is None:
                skipped += 1
                continue
            yield row

    written = upsert_parcels(rows(), conn)
    return written, skipped


def main() -> None:
    import psycopg

    layer_url = os.environ.get("FSI_PARCEL_LAYER_URL") or DEFAULT_LAYER_URL
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit(
            "DATABASE_URL is not set. Use the floguard project Postgres URI "
            "(Supabase → Project Settings → Database → URI). "
            f"Layer default: {DEFAULT_LAYER_URL}"
        )

    print(f"layer: {layer_url}")
    with psycopg.connect(dsn) as connection:
        written, skipped = ingest(layer_url, connection)
    print(f"parcel_risk: {written} upserted, {skipped} skipped (no id or non-polygon)")


if __name__ == "__main__":
    main()
