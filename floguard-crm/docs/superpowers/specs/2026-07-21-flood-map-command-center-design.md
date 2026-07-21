# Flood Map Command Center — Design

**Status:** Approved (user 2026-07-21)  
**Surface:** FloGuard Sales Rev CRM — panel `p-fsi` in `public/crm/index.html`  
**API:** `api/fsi-parcels.js` (+ small projection extend)  
**Spec foundation:** `docs/FLOOD-SUSCEPTIBILITY-INDEX.md`

---

## 1. Goal

Make the Flood Map **10× more useful** for sales reps in under 30 seconds by shipping **all three jobs**, in one implementation pass that covers former “phase 1+2”:

| Job | Success signal |
|-----|----------------|
| **Ranked dial list** | Sorted targets, click → call/add lead/queue draft |
| **Territory explorer** | Pan/zoom, clusters, presets (Zone X bowls, soil D, etc.) |
| **Pitch aid** | Plain-English “why this yard” + score meters; not engineering claims |

Plus **more visuals** and **clearer readings for real data** (breakdown when terrain factors exist).

---

## 2. Non-goals (this pass)

- Parcel polygon geometries / full LiDAR ingest pipeline  
- Recalibrating FSI weights  
- Phone numbers on parcels (still omitted)  
- Auto-dialer or SMS send  
- Extracting map into a separate SPA framework  
- Touching thecolony-ok / non-floguard Supabase

---

## 3. Architecture

```
Browser (index.html FSI section)
  ├─ MapLibre map (clusters, dots, selection, NFHL overlay)
  ├─ Ranked list + filters + presets (client-side on loaded set)
  └─ Parcel drawer (meters, chips, story, actions)
         │
         ▼ POST /crm/api/fsi-parcels  (Bearer academy session)
  Server: restGet public.parcel_risk  OR  FIXTURE fallback
```

- **No new endpoints** required.  
- **One API change:** project `twi_n`, `hand_n` when present (for breakdown UI).  
- **All filtering after load** is client-side so the map stays snappy and works offline of extra RPCs.  
- **Stay in** `public/crm/index.html` (+ CSS/JS sections there). Optional tiny shared helpers only if unavoidable; default is single-file.

### Data contract (API → browser)

Existing columns (keep):

`parcel_id, address, owner_name, lat, lon, fsi_live, fsi_static, fema_zone, hsg`

**Add to `COLUMNS`:**

`twi_n, hand_n`

Response shape (unchanged envelope):

```json
{
  "ok": true,
  "source": "postgres" | "fixtures",
  "count": 21,
  "truncated": false,
  "parcels": [ { ... } ],
  "note": "optional"
}
```

---

## 4. UI layout

Desktop (panel max width ~1280px of CRM wrap):

```
┌─ Toolbar: title, presets, min score, limit, Search area, Top, FEMA, stats ─┐
├──────────────────────────────┬────────────────────────────────────────────┤
│ Map (~58%)                   │ Ranked targets (~42%)                       │
│ clusters → dots              │ filters + search + band legend (clickable) │
│ selection pulse              │ scrollable rows                             │
│                              │ selected → drawer under list or side panel │
└──────────────────────────────┴────────────────────────────────────────────┘
```

Mobile / narrow:

- Map full width, min-height ~280px  
- List below  
- Drawer full-width sheet  

### Toolbar controls

| Control | Behavior |
|---------|----------|
| Presets chips | `Top risk`, `Zone X bowls`, `Clay / D soils`, `FEMA mapped`, `Clear` |
| Min live score | Existing input; re-filters client set; also sent on next server fetch |
| Max parcels | Existing; used on next server fetch |
| Search this area | Viewport POST (existing 1° limit) |
| Top countywide | Ranked POST; fit bounds |
| FEMA NFHL | Existing raster toggle |
| Stats | Count, truncated, **source badge** (`postgres` / `fixtures`) |

---

## 5. Map visuals

| Element | Spec |
|---------|------|
| **Clusters** | GeoJSON source `cluster: true`, clusterMaxZoom ~14, clusterRadius ~50. Cluster circle color by avg band or avg live FSI; label = count |
| **Unclustered dots** | Radius scales with `fsi_live` (interpolated); color by terrain-band (equal-count quintiles on **fsi_static**, same as today) |
| **Halo** | Optional second layer or paint blur under highest band only |
| **Selection** | Distinct stroke + larger radius; `flyTo` on list click |
| **Popup** | Lighter: address + live FSI meter + “Open details” (full story in drawer) — avoid duplicating entire drawer |
| **Cursor** | pointer on dots/clusters |
| **Basemap** | Keep OpenFreeMap liberty (no new CDN deps beyond existing MapLibre vendor) |

Color bands remain the existing CRM grade palette (green → red). Legend is **interactive**: click band → filter list/map to that band.

---

## 6. Ranked list

Columns / row content:

1. Rank (#)  
2. Live FSI meter (0–100) + numeric  
3. Terrain S (compact)  
4. Zone chip + Soil chip  
5. Address (truncate)  
6. Story one-liner (ellipsis)

Sort default: `fsi_live` desc. Optional click-header sort: live / static / address.

Row click = select parcel (sync map). Keyboard: ↑/↓ when list focused, Enter open drawer actions.

---

## 7. Parcel drawer — readings & pitch

### Always shown

- Owner, address  
- **Live FSI** meter + number  
- **Terrain S** meter (0–1 mapped to bar)  
- Rank in current filtered set (“#3 of 21”)  
- Zone chip, soil chip  
- **Headline story** (templated, sales language)  
- Disclaimer line: *Not an inspection, insurance quote, or guarantee. Free assessment diagnoses.*

### Story templates (deterministic)

Priority rules (first match wins):

1. Zone in `X` or `X-SHADED` AND high terrain band (≥3) → Zone X bowl / ignored-by-FEMA thesis  
2. HSG `D` or `*/D` dual → Clay / poor drainage soil  
3. High TWI_n when present → Water collects here  
4. Low HAND_n when present → Nowhere for water to go  
5. High AE/VE → Riverine/coastal mapped + still sell drainage  
6. Default → Combined live + terrain plain language  

Never invent numbers. Never claim flood insurance outcomes.

### Breakdown strip (when `twi_n` / `hand_n` present)

Show four contribution bars using **published literature weights** (display only, not recomputed FSI):

| Factor | Weight | Input |
|--------|--------|--------|
| TWI | 0.40 | `twi_n` |
| HAND (inverted) | 0.25 | `1 - hand_n` |
| Soil | 0.20 | lookup from HSG (same table as pipeline) |
| FEMA zone | 0.15 | lookup from fema_zone |

If `twi_n`/`hand_n` null: hide breakdown; show “Scores only — full terrain factors after parcel ingest.”

### Actions

| Action | Behavior |
|--------|----------|
| **Open in Maps** | Google Maps search (existing) |
| **Copy address** | Clipboard |
| **Add to Leads** | Create lead on FrenchDrain (or YardDrainage if story is yard-heavy) with notes: FSI live/static, zone, soil, parcel_id, story headline |
| **Queue draft** | Existing outbound draft queue if available; prefill subject/body with story + assessment CTA |
| **Call** | `tel:` only if phone appears on a matched CRM lead (optional enhancement); otherwise hide or show “No phone on lead” |

Integrate with existing lead store helpers already in `index.html` (same patterns as lead drawer).

---

## 8. Filters & presets (client-side)

Applied to the **last loaded** parcel array before paint + list render.

| Preset | Rule |
|--------|------|
| Top risk | Clear other filters; sort live desc |
| Zone X bowls | fema_zone in X, X-SHADED AND terrain band ≥ 3 |
| Clay / D soils | hsg matches D or dual ending/containing D |
| FEMA mapped | fema_zone in AE, VE, AO, AH |
| Clear | Reset filters |

Additional: free-text search on address, owner, parcel_id; multi-select zone/soil if cheap to implement without clutter.

---

## 9. Source & fixture handling

- Badge: `Live data` when `source === 'postgres'`, `Demo fixtures` when `fixtures`  
- If any `parcel_id` starts with `FIXTURE-`, show subtle banner: demo parcels; production ingest replaces these  
- Empty state: clear illustration text + “Top countywide” CTA  

---

## 10. Error handling

- Keep existing session/401 and 1° bbox client guard  
- Network errors in stats line (not silent)  
- Cluster click with 0 features: no-op  
- Add to Leads failure: toast/msg in drawer  

---

## 11. Performance

- Cap default fetch 500 (existing); list virtualization **not** required under 500  
- Re-filter without re-fetch  
- Debounce text search 150ms  
- Avoid re-creating MapLibre map on tab switch (keep `_fsiInited` pattern)  

---

## 12. Testing / verification

Manual:

1. Login → Flood Map → Top countywide → list + clusters + meters  
2. Click row ↔ map selection sync  
3. Preset Zone X bowls filters both  
4. Add to Leads creates row with FSI notes  
5. FEMA toggle still works  
6. `source` badge shows postgres on floguard project  
7. Narrow viewport: stacked layout usable  

API:

- `GET` projection includes `twi_n`/`hand_n` without breaking fixtures (nulls OK)  

---

## 13. Implementation order

1. CSS layout (split panel, meters, chips, drawer)  
2. API `COLUMNS` extend  
3. Client state: `fsiState` { raw, filtered, selectedId, filters }  
4. List + selection sync  
5. Clusters + visual paint  
6. Presets/filters/legend click  
7. Drawer story + breakdown + actions  
8. Mobile polish + source badge  
9. Smoke-test local + prod  

---

## 14. Risks

| Risk | Mitigation |
|------|------------|
| `index.html` size | Keep FSI block isolated; no new vendor libs |
| Over-claiming scores | Fixed disclaimer + story templates review |
| Cluster vs fitBounds races | Reuse `_fsiFitting` flag |
| Dual data sources | Explicit badge; don’t mix messaging |

---

## 15. Approval

- Layout A: **approved**  
- Phase 1+2 scope: **approved**  
- Single-file CRM: **approved**  
- Visuals + real-data readings + `twi_n`/`hand_n` API: **approved** (2026-07-21)
