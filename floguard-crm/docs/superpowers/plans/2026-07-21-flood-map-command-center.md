# Flood Map Command Center Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Split-panel Flood Map with ranked list, clusters, filters, pitch drawer, and real-data score readings.

**Architecture:** Extend `api/fsi-parcels.js` columns; rebuild FSI UI/state in `public/crm/index.html` only.

**Tech Stack:** MapLibre GL (vendored), vanilla JS, Supabase PostgREST parcels.

## Global Constraints

- Stay in `public/crm/index.html` (+ API file). No new npm deps.
- Color bands on `fsi_static`; list sort on `fsi_live`.
- Never present FSI as inspection/insurance/guarantee.
- FloGuard Supabase only (`gphlrnctrtbrpspmzaxw`).

---

### Task 1: API project twi_n / hand_n

**Files:** Modify `api/fsi-parcels.js`, `server/lib/fsi-fixtures.js` (optional nulls already ok)

- [x] Add `twi_n,hand_n` to COLUMNS and projectRow

### Task 2: CSS + HTML shell

**Files:** Modify `public/crm/index.html` styles + `#p-fsi` markup

- [x] Split layout, meters, chips, drawer, list

### Task 3: Client state + list + paint + clusters

**Files:** Modify FSI JS block in `public/crm/index.html`

- [x] `fsiState`, filter, render list, cluster source, selection

### Task 4: Drawer story + actions

- [x] Story templates, breakdown, Add lead, Queue draft, Maps, Copy

### Task 5: Verify + deploy

- [x] Local smoke, production deploy (crm.floguardfl.com live; redeploy when shipping uncommitted CRM/frontend delta)
