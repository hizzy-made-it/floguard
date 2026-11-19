"""Upload a terrain v2 release into parcel_risk via PostgREST (sql/018 terrain_v2_apply).

Python twin of scripts/upload-terrain.mjs (that script is v1-only and outside
this pipeline's files). Uses the same env vars:

    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      (floguard-crm/.env, never committed)

    python -m pipeline.upload_v2 data/v2/release/terrain-v2-2026-12-01
    python -m pipeline.upload_v2 <dir> --dry-run      # count rows, send nothing

Loading v2 rows changes no score. Switch with fsi_set_model_version('v2') and the
batched recompute (RUNBOOK-terrain-v2.md section 7). If PostgREST is unreachable
(egress cap), host the JSON parts and use terrain_v2_load_enqueue(urls) instead.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BATCH = 1000


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("release_dir", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    load_env(Path(__file__).resolve().parents[2] / ".env")
    parts = sorted(a.release_dir.glob("parcel_terrain_v2_*.json"))
    if not parts:
        sys.exit(f"no parcel_terrain_v2_*.json in {a.release_dir}")
    rows = [r for p in parts for r in json.loads(p.read_text())]
    print(f"{len(rows)} rows in {len(parts)} parts")
    if a.dry_run:
        return
    import httpx

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    applied = 0
    with httpx.Client(timeout=300.0) as c:
        for i in range(0, len(rows), BATCH):
            for attempt in range(3):
                r = c.post(f"{url}/rest/v1/rpc/terrain_v2_apply", headers=h, json={"rows": rows[i:i + BATCH]})
                if r.status_code < 500:
                    break
            if r.status_code >= 300:
                sys.exit(f"terrain_v2_apply {r.status_code}: {r.text[:300]}")
            applied += int(r.text or 0)
            print(f"\rapplied {applied} / {len(rows)}", end="", flush=True)
    print(f"\ndone. Scores unchanged until fsi_set_model_version('v2') + batched recompute.")


if __name__ == "__main__":
    main()
