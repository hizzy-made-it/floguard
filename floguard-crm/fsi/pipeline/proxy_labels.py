"""Proxy-label ingest: match permits / complaints / damage assessments to parcels.

There are zero won/lost outcomes yet, so calibration needs other evidence that
a lot has a water problem. Public sources that carry an address and a date:
  - drainage / flood-repair / regrading / French-drain building permits
    (county and city permit portals; public-records request)
  - stormwater / standing-water / flooding complaints (county 311, city code
    enforcement; public-records request)
  - post-storm damage assessments (county emergency management, e.g. Ian/Nicole 2022)

Input CSV columns (header names are case-insensitive):
  parcel_id   optional; used as-is when present
  address     site address (required if no parcel_id)
  zip | city  optional; narrows fuzzy matching
  date        ISO date of the permit/complaint/assessment
  label_source  e.g. permit_drainage, complaint_flooding, ian_damage
  weight      0-1 trust in the label (default 1). Suggested: permit 1.0,
              damage assessment 0.8, complaint 0.5 (complaints include roads).
  label       1 (problem) or 0 (inspected, no problem). Default 1.

    python -m pipeline.proxy_labels --in permits.csv --parcels parcels.csv --out proxy_matched.csv

parcels.csv is an export of parcel_risk (parcel_id,address,zip,city); see the runbook.
Writes <out> and <out>.unmatched.csv. Match methods: parcel_id, exact, fuzzy.
"""

from __future__ import annotations

import argparse
import csv
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

FUZZY_MIN = 0.88

SUFFIX = {
    "STREET": "ST", "STR": "ST", "AVENUE": "AVE", "AV": "AVE", "DRIVE": "DR", "ROAD": "RD",
    "BOULEVARD": "BLVD", "BLV": "BLVD", "LANE": "LN", "COURT": "CT", "CIRCLE": "CIR",
    "PLACE": "PL", "TERRACE": "TER", "TERR": "TER", "PARKWAY": "PKWY", "HIGHWAY": "HWY",
    "TRAIL": "TRL", "WAY": "WAY", "COVE": "CV", "POINT": "PT", "SQUARE": "SQ", "LOOP": "LOOP",
    "RUN": "RUN", "PATH": "PATH", "PASS": "PASS", "CROSSING": "XING", "EXTENSION": "EXT",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "NORTHEAST": "NE", "NORTHWEST": "NW", "SOUTHEAST": "SE", "SOUTHWEST": "SW",
}
UNIT_RE = re.compile(r"\s+(APT|UNIT|STE|SUITE|LOT|BLDG|#)\s*\S*$")


def normalize_address(s: str | None) -> str:
    if not s:
        return ""
    s = s.upper().split(",")[0]
    s = re.sub(r"[.’']", "", s)
    s = re.sub(r"#\s*", " # ", s)
    s = re.sub(r"[^A-Z0-9# ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    prev = None
    while prev != s:
        prev = s
        s = UNIT_RE.sub("", s)
    return " ".join(SUFFIX.get(t, t) for t in s.split())


def split_number(norm: str) -> tuple[str | None, str]:
    m = re.match(r"^(\d+[A-Z]?)\s+(.*)$", norm)
    return (m.group(1), m.group(2)) if m else (None, norm)


class ParcelIndex:
    def __init__(self, rows: list[dict]):
        self.exact: dict[str, set[str]] = defaultdict(set)
        self.by_num: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
        for r in rows:
            n = normalize_address(r.get("address"))
            if not n:
                continue
            pid = str(r["parcel_id"])
            self.exact[n].add(pid)
            num, street = split_number(n)
            if num:
                self.by_num[num].append((street, pid, (r.get("zip") or "").strip()[:5]))

    def match(self, address: str | None, zip_code: str | None = None) -> tuple[str | None, str, float]:
        n = normalize_address(address)
        if not n:
            return None, "none", 0.0
        ex = self.exact.get(n)
        if ex and len(ex) == 1:
            return next(iter(ex)), "exact", 1.0
        num, street = split_number(n)
        if not num:
            return None, "no_house_number", 0.0
        z = (zip_code or "").strip()[:5]
        cands = [c for c in self.by_num.get(num, []) if not z or not c[2] or c[2] == z]
        scored = sorted(((SequenceMatcher(None, street, c[0]).ratio(), c[1]) for c in cands), reverse=True)
        if not scored or scored[0][0] < FUZZY_MIN:
            return None, "no_match", scored[0][0] if scored else 0.0
        if len(scored) > 1 and scored[1][0] == scored[0][0] and scored[1][1] != scored[0][1]:
            return None, "ambiguous", scored[0][0]
        return scored[0][1], "fuzzy", round(scored[0][0], 3)


def _lower(row: dict) -> dict:
    return {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}


def ingest(rows: list[dict], index: ParcelIndex) -> tuple[list[dict], list[dict]]:
    matched, unmatched = [], []
    for raw in rows:
        r = _lower(raw)
        try:
            w = float(r.get("weight") or 1.0)
        except ValueError:
            w = 1.0
        lab = r.get("label") or "1"
        base = {"date": r.get("date"), "label": 1 if lab in ("1", "true", "yes", "y") else 0,
                "label_source": r.get("label_source") or "proxy", "weight": max(0.0, min(1.0, w))}
        if r.get("parcel_id"):
            matched.append({"parcel_id": r["parcel_id"], **base, "match_method": "parcel_id", "match_score": 1.0})
            continue
        pid, how, score = index.match(r.get("address"), r.get("zip"))
        if pid:
            matched.append({"parcel_id": pid, **base, "match_method": how, "match_score": score})
        else:
            unmatched.append({**raw, "reason": how, "best_score": score})
    return matched, unmatched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", type=Path, required=True)
    ap.add_argument("--parcels", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    with a.parcels.open(newline="", encoding="utf-8") as f:
        idx = ParcelIndex(list(csv.DictReader(f)))
    with a.inp.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    m, u = ingest(rows, idx)
    cols = ["parcel_id", "date", "label", "label_source", "weight", "match_method", "match_score"]
    with a.out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(m)
    if u:
        with a.out.with_suffix(".unmatched.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(u[0].keys()))
            w.writeheader()
            w.writerows(u)
    print(f"matched {len(m)} / {len(rows)} ({sum(1 for x in m if x['match_method'] == 'fuzzy')} fuzzy); "
          f"unmatched {len(u)}")


if __name__ == "__main__":
    main()
