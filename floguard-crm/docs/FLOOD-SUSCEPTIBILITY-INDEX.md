# Flood Susceptibility Index (FSI) — spec

Status: **approved, not yet built.** Target surface: live map at `floguardfl.com/CRM`.

Scope decisions (locked with owner 2026-07-20):

| Decision | Choice |
|---|---|
| Lead source | County property-appraiser parcel data (public record) |
| First cut | Volusia County only |
| Calibration | Ship literature-standard weights; back-fit against closed jobs later |

This engine is **FloGuard-only**. The HD Academy CRM at `hdconnex.com/HDAcademy`
is a separate deployment and must not be touched by any of this work.

---

## 1. Why not raw elevation

Absolute elevation does not predict standing water. A parcel at 8 ft inside a
6 ft neighborhood drains; the same parcel inside a 12 ft neighborhood is a bowl.
What predicts water is **relative** position in the local terrain.

Two standard hydrology metrics carry that:

**TWI — Topographic Wetness Index**

    TWI = ln( a / tan β )

`a` = upslope contributing area per unit contour width (how much land drains
into this point), `β` = local slope. High TWI means water arrives and cannot
leave. This is the strongest single term in the model.

**HAND — Height Above Nearest Drainage**

Vertical distance from the parcel to the nearest drainage channel. Low HAND
means there is nowhere for water to go once it arrives.

## 2. Why FEMA zones must NOT dominate the score

FEMA's NFHL maps **riverine and coastal** flooding — the flood that arrives from
a river or the ocean. FloGuard sells against **groundwater and stormwater**:
standing yard water, saturated soil, crawlspace water, hardscape pooling.

These are different phenomena. A large share of the best prospects sit in
**Zone X**: real water problems, no flood-insurance requirement, no federal
attention, and nobody selling to them.

**Zone X + high TWI is the highest-value segment**, not the lowest. The
homeowner is surprised, unserved, and cannot dismiss the problem by pointing at
a map. FEMA zone therefore enters as a *modifier*, never as the primary term.

## 3. The equation

Static and dynamic terms are separated because they update on completely
different cadences — this split is what makes the system buildable.

### Static — per parcel, computed once

    S = w₁·TWI_n + w₂·(1 − HAND_n) + w₃·HSG + w₄·Z

    TWI_n   normalized 0–1 across the county
    HAND_n  normalized 0–1 (inverted: low HAND → high risk)
    HSG     USDA hydrologic soil group   D=1.0  C=0.7  B=0.4  A=0.2
    Z       FEMA zone modifier           AE/VE=1.0  AO/AH=0.8  X-shaded=0.6  X=0.45

### Dynamic — refreshed daily

Antecedent Precipitation Index carries soil saturation forward:

    API_t = k · API_(t−1) + P_t          k ≈ 0.87 (daily decay)

    D = w₅·API_n + w₆·Rain24_n

API is the term most implementations omit, and it is why the *second* storm
floods a yard when the first did not — the soil never dried out.

### Composite

    FSI = 100 · S^α · (0.5 + 0.5·D)

**Multiplicative, deliberately.** Rain falling on a well-drained ridge produces
nothing; the same rain on a clay bowl floods. An additive model would rank a
flat, sandy ridge as high risk after a large storm and burn dials on it.

> Terrain is the gate. Rainfall is the trigger.

The `(0.5 + 0.5·D)` form means a bad-terrain parcel never drops below half its
static score during a dry spell — the drainage defect is still there, it is just
not currently being demonstrated.

### Starting weights (uncalibrated)

    w₁ = 0.40   TWI
    w₂ = 0.25   HAND
    w₃ = 0.20   soil
    w₄ = 0.15   FEMA zone
    w₅ = 0.60   API
    w₆ = 0.40   last 24h
    α  = 1.0

Recalibrate `w₁..w₆` and `α` by logistic regression against closed jobs once
~100 won/lost outcomes with addresses exist. Until then these are literature
defaults, not tuned values — do not present FSI to a customer as a measurement.

## 4. Relationship to the Drainage Need Score

Both scores stay. They answer different questions and run at different times.

| | FSI | DNS |
|---|---|---|
| Input | Terrain, soil, flood zone, rainfall | The prospect's own description of the water |
| Timing | Before any contact | After the lead speaks |
| Answers | "Who should we call?" | "How urgent is this one?" |

FSI generates and ranks the prospect list. DNS takes over once the lead talks.
Neither is an engineering finding — the free on-site assessment does the
diagnosing, and reps must never present either number as an inspection result.

## 5. Data sources — all free, no vendor lock

| Layer | Source | Notes |
|---|---|---|
| Elevation (DEM) | USGS 3DEP LiDAR | Florida has strong 1 m coverage |
| Flood zones | FEMA NFHL ArcGIS REST | Also usable as a live WMS map overlay |
| Rainfall | NOAA MRMS QPE radar, or Open-Meteo | Open-Meteo: no key, 92-day history + forecast |
| Soil | USDA NRCS SSURGO | Hydrologic soil group |
| Parcels + owners | County property appraiser GIS | Public record under FL law |

## 6. Architecture — the part that decides whether this ships

Per-parcel TWI over LiDAR rasters is heavy GIS. **It cannot run inside a Vercel
function per request.** Attempting that is the main way this project stalls.

    [ one-time batch ]  DEM + SSURGO + NFHL + parcels
                            │  Python: rasterio / WhiteboxTools / richdem
                            ▼
                     parcel_risk table  (static S per parcel)
                            │
    [ daily cron ]  rainfall API ──► update API_t, Rain24 ──► fsi_live
                            │
                            ▼
    [ request time ]  map reads cheap indexed rows only

Table sketch:

    parcel_risk(
      parcel_id text primary key,
      address text, owner_name text,
      lat double precision, lon double precision,
      twi real, hand real, hsg text, fema_zone text,
      fsi_static real,          -- S, recomputed only when source data changes
      fsi_live real,            -- full FSI, rewritten by the daily cron
      updated_at timestamptz    -- ISO-8601 UTC
    )

Map client: **MapLibre GL + free basemap.** No Mapbox token, no per-load
billing. FEMA NFHL as a WMS overlay, parcels as a vector/heat layer colored by
`fsi_live`.

## 7. Build order

1. Volusia parcel ingest → address, owner, geometry
2. Static terrain precompute → `twi`, `hand`, `hsg`, `fema_zone`, `fsi_static`
3. Rainfall cron → `API_t`, `fsi_live`
4. Map surface in the CRM → MapLibre, NFHL overlay, FSI-colored parcels
5. "Create leads from viewport/threshold" → writes into the existing lead store
6. Calibration pass once closed-job outcomes exist

## 8. Compliance notes

Parcel and owner records are public in Florida, but outreach is still regulated:
phone numbers must be scrubbed against DNC before dialing, and email must satisfy
CAN-SPAM. FSI ranks *properties*; it does not authorize contacting a person by
any channel they have opted out of.

Never state or imply flood-insurance consequences from an FSI value — that is a
coverage claim, and it is already on the forbidden list in `playbooks.yaml`.
