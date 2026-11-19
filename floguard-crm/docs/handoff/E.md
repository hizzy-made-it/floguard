# Handoff E: front-end split and redesign (`public/crm/`)

Branch `crm-next/E`. Two commits:

1. **Split, no behaviour change.** The inline `<style>` moved to `css/app.css` and the inline
   `<script>` to 16 classic scripts, cut at the existing section banners and loaded in the
   original order. Proven byte-for-byte (see "Checks").
2. **Redesign.** Tokens, Inter variable font, left sidebar shell, Lucide icon sprite, new
   Leads toolbar and table, map-first Flood map, restyled components across every panel,
   light and dark themes.

No files under `api/`. No build step, no runtime dependencies, no CDN. `package.json` untouched.

## File map

All paths are under `public/crm/`. Scripts are classic (non-module) and share one global
scope; **load order matters** (a top-level call into a later file fails). Add new files at
the end, or make sure no earlier file calls into them while loading (function declarations
only hoist within their own file). The split was checked with a one-off acorn script (not
committed, acorn is not a dependency) that walked every top-level statement, including
synchronously invoked callbacks, transitively; it found no call into a later file.

| File | Holds |
|---|---|
| `js/00-theme.js` | Loaded in `<head>`. Applies the stored theme (`floguard_theme`) and the collapsed-sidebar class (`floguard_sidebar_collapsed`) before first paint. |
| `js/01-data.js` | `SEED`, `SERVICE`, `CITIES`, `LISTS`, `LIST_SHORT`, `suggestListsForIndustry`, storage keys (`KEY`, `CFGKEY`, `CHATKEY`, `MGMTKEY`). |
| `js/02-crm-core.js` | Outreach CRM: status sets, management companies, maintenance schedule helpers, activity log, phone helpers, profile drawer paint/open/close/save, enrichment refresh, admin CRM KPIs, `STATUSES`. |
| `js/03-ai-prompts.js` | AI config (`MODELS`), system prompts, category playbooks, Sales Docs knowledge loader, `SCENARIOS`. |
| `js/04-state.js` | `state` / `view` / `chats`, `loadLeads`, `saveLeads`, server push / hydrate / merge, sync pill, `esc`. |
| `js/05-nav.js` | Nav open/close (`setNavOpen`, `closeNavMenu`), the `#nav` click handler that switches panels, `goTab`. |
| `js/06-leads.js` | Lead tracker: causes, per-cause status, `normalizeLead`, `render()` (table rows), `statusTone()` (new, presentation only), filters, paste/parse, enrich, CSV/JSON/import/print/reset. |
| `js/07-chat.js` | Chat engine shared by coach/roleplay/review. |
| `js/08-roleplay.js` | Roleplay gym. |
| `js/09-review.js` | Pitch review. |
| `js/10-settings.js` | Model preferences. |
| `js/11-auth.js` | Username + PIN auth (`floguard_desk_auth_v1`), `showApp`, `showLogin`, `bootAuth`. |
| `js/12-admin.js` | Token pill, usage lock, admin API and tables. |
| `js/13-boot.js` | `boot()`, sync pill re-pull, profile drawer wiring. |
| `js/14-drafts.js` | Outbound drafts desk. |
| `js/15-docs.js` | Documents library. |
| `js/16-fsi-map.js` | Flood map command center (MapLibre, list, detail, presets, bulk actions). |
| `js/17-shell.js` | New. Presentation glue only: mirrors the active nav item (`aria-current`, top-bar title, tab bar), mobile drawer + scrim, sidebar collapse, theme toggle, overflow menus, lead-drawer focus and scroll lock, `ResizeObserver` that calls `_fsiMap.resize()`. |
| `css/tokens.css` | Design tokens, `@font-face`, dark theme. |
| `css/app.css` | Every component and layout rule. |
| `fonts/` | Inter variable (latin + latin-ext woff2) from `@fontsource-variable/inter` 5.3.0, OFL licence in `fonts/OFL-Inter.txt`. |

JS edits in step 2 (everything else is untouched since the split):
- `05-nav.js` `setNavOpen`: swaps the toggle's SVG icon instead of writing `☰` / `✕` text.
- `06-leads.js` `render()`: inline `style=` replaced with classes (`lead-addr`, `lead-sub`,
  `lead-flag`, `lead-due`, `lead-cause`, `cell-*`), `data-st` tone on the status cell, aria-labels
  on inline inputs, an empty-state row when no lead matches; new helper `statusTone()`.
- `16-fsi-map.js`: meter colours moved to classes (`m-must`, `m-terrain`, `m-heat`), empty list
  uses `.empty-state`, popup meter/button use classes. No data logic changed.

Markup contract kept: every element id, `data-p`, `data-list`, `data-preset`, `data-mode`,
`data-fsi-act`, `data-q` from before the redesign is still present (checked with a diff of ids).
Panels keep their ids (`p-leads`, `p-fsi`, ...). `#nav` still contains one `<button data-p>`
per panel; group labels are `<div>`s, so `#nav button` selectors in the old code still match only
nav targets. Do not put any other `<button>` inside `#nav`.

## Shell

- Sidebar (`aside.sidebar`) groups: Work (Leads), Map (Flood map), Outreach (Outbound,
  Documents), Train (AI coach, Roleplay gym, Pitch review, Playbook), Admin (Models, Admin).
  Collapses to a 64px rail on desktop (`html.sb-collapsed`).
- At 820px and below: the sidebar becomes an off-canvas drawer (opened by `#navToggle` or the
  tab bar's More), and a bottom tab bar (`nav.tabbar`, buttons `data-go`) jumps to Leads, Map,
  Outbound, Coach. Tab bar buttons call `goTab()`; they are outside `#nav` on purpose.
- Top bar (`header.topbar`) keeps `#tokenPill`, `#syncPill`, `#userName`, `#logoutBtn`, adds
  `#themeToggle` and a section / page title (`#tbSection`, `#tbTitle`).
- `html[data-panel="<p>"]` is set by the shell for panel-specific layout (the map uses it).

## Tokens (css/tokens.css)

Use tokens, never raw hex, in new CSS.

- Surfaces and text: `--bg`, `--surface`, `--surface-2`, `--surface-sunken`, `--surface-hover`,
  `--line`, `--line-strong`, `--input-border`, `--text`, `--text-2` (secondary), `--text-3`
  (meta only).
- Action (brand orange, the only action colour): `--action`, `--action-hover`, `--action-press`,
  `--action-ink` (text on orange; ink, not white, for 6.7:1), `--action-soft`,
  `--action-soft-line`, `--action-text` (orange as text). Focus: `--focus`, `--focus-ring`.
- Info (blue): `--info` (text), `--info-fill`, `--info-soft`, `--info-line`.
- Status pairs, each with `-soft` and `-line`: `--success`, `--warn`, `--danger`, plus category
  tints `--teal`, `--violet`, `--clay`, `--rose`.
- Neutral ramp `--n-0` … `--n-900` (light theme only; prefer the semantic names).
- Spacing `--s-1`…`--s-12` (4px grid); radii `--r-xs` 4, `--r-sm` 6, `--r-md` 8, `--r-lg` 12,
  `--r-xl` 16, `--r-pill`; shadows `--sh-1`…`--sh-4`.
- Type: `--font` (Inter FG → system stack), `--fs-11`…`--fs-24`, `--fw-*`. Use
  `font-variant-numeric: tabular-nums` (or class `.num`) for scores, counts and money.
- Motion: `--t-fast` 120ms, `--t` 160ms, `--t-slow` 200ms, `--ease`. Reduced motion is honoured
  globally.
- Shell sizes: `--sidebar-w`, `--sidebar-w-collapsed`, `--topbar-h`, `--tabbar-h`.
- Legacy aliases (`--ink`, `--muted`, `--accent`, `--accent2`) remain for old inline styles in JS.

Theme: light by default; dark when the OS prefers it, unless the user picked one with the
toggle (`html[data-theme="light"|"dark"]`, stored in `localStorage.floguard_theme`).

## Component classes (css/app.css)

| Component | Classes |
|---|---|
| Buttons | `.btn` + `.p` / `.btn--primary` (orange), `.o` / `.btn--accent` (soft orange), `.ghost` / `.btn--ghost`, `.d` / `.danger` / `.btn--danger`; sizes `.btn--sm`, `.btn--lg`; `.btn--icon`, `.btn--block`. Icons go first: `<svg class="ic"><use href="#i-plus"/></svg>`. Keep one `.p` per view region. |
| Icons | Inline Lucide sprite at the top of `index.html` (ISC). Available: users, map, send, folder-open, headphones, messages-square, clipboard-check, book-open, sliders-horizontal, shield-check, plus, search, ellipsis, download, upload, printer, rotate-ccw, sun, moon, log-out, panel-left-close, panel-left-open, menu, x, sparkles, chevron-down, refresh-cw, trash-2, layers-2, crosshair, circle-gauge. Add more by copying `<symbol>`s from `lucide-static`. |
| Page header | `header.page-head` > `.page-title` (h1 + `.sub`) + `.page-actions`; `.page-head--compact`. |
| Toolbar | `.toolbar` > `.toolbar-row`; `.search-field` (label with icon + input); `.select-field`; segmented control `.seg` (buttons, `.on`); `.toggle` (switch checkbox); `.due-filter`. |
| Menu | `<details class="menu">` + `<summary class="btn btn--icon">` + `.menu-pop` > `.menu-item` (`.danger`), `.menu-sep`. Closing, Escape and arrow keys are handled in `17-shell.js`. |
| Surfaces | `.card`, `.detail-panel`, `.disclosure` (details), `.warn`, `.empty-state`, `.status-line`. |
| Tables | `.tablewrap` > `table` (sticky `th`). Leads: `.leads-table`, `col.c-*`, `td.cell-*`, status pill `td.cell-status[data-st=new|touched|active|quoted|won|lost|muted] .status-sel`, `.coachbtn` (`.openbtn`), `.del`, `.loading-row` + `.skel`, `.empty-row`. Rows become cards at ≤820px. |
| Pills and chips | `.wfs-pill` (`.g-A`…`.g-F`, `.hot`, `.none`), `.cause-chip` (`.on`, `.badge-*`), `.mnt-due`, `.badge`, `.tokenpill` (`.warn`, `.lock`), `.fsi-chip` (`.zone-x`, `.zone-f`, `.soil-d`, `.soil-a`), `.fsi-source` (`.live`, `.demo`), `.suggest-chip`, `.chips a/button`, `.docs-cats button`. |
| Meters | `.fsi-meter > i` (`.m-must`, `.m-terrain`, `.m-heat`), `.bar > i` (`.warn`, `.lock`). |
| Lead drawer | `.drawer-bg.open > .drawer` with `.drawer-head`, `.badges`, `.actbar`, `.sec`, `.grid-2`, `.grid-3`, `.btn-row`. |
| Map | `.fsi-toolbar`, `.fsi-presets`, `.fsi-controls`, `.fsi-layout` (map left, ranked list right; stacked ≤1000px), `.fsi-mapcol`, `.fsimap-legend` (overlay), `.fsi-sidecol`, `.fsi-list`, `.fsi-row`, `.fsi-bulk`, `.fsi-drawer`. MapLibre popups and controls are themed. |
| Utilities | `.sr-only`, `.spacer`, `.stack`, `.btn-row`, `.row2`, `.grid-2`, `.grid-3`, `.narrow`, `.num`, `.mt-2`, `.mt-3`, `.mb-3`, `.mb-4`, `.hint`, `.stats`, `.sub`, `.section-title`. |

Wave-2 notes: phone chips, pipeline boards and similar should reuse `.fsi-chip`-style tags
(4px radius) for attributes and the `.status-sel` pill tones for stages. Blocked actions
(DNC) should use `.btn[aria-disabled="true"]` plus a visible reason, not colour alone.

## Checks and how to run them

From `floguard-crm/`:

```bash
# 1. Split integrity (step 1): concatenated js == old inline script, app.css == old inline style
node tests/ui/check-split.mjs be167fd --at <split commit>

# 2. Syntax
for f in public/crm/js/*.js; do node --check "$f"; done

# 3. Browser smoke test (headless Chrome; skipped if playwright-core is missing)
npm i --prefix /tmp/pw playwright-core          # once, outside the repo
PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core node --test tests/ui/*.test.mjs
# screenshots too:
SCREENS=docs/handoff/E-screens PLAYWRIGHT_CORE=... node --test tests/ui/*.test.mjs
# every panel:  add SCREENS_ALL=1
```

Pass a glob (`tests/ui/*.test.mjs`): `node --test tests/ui/` would also try to run
`check-split.mjs`. The smoke test starts `scripts/dev-server.mjs` on a free port, stubs
`/crm/api/*` at the network layer in the test browser only (fake session, empty server leads,
bundled FIXTURE parcels), seeds 6 sample leads, then checks: no console or page errors; all
10 nav targets open their panel and get `aria-current="page"`; the map list renders and a row
opens the detail; add lead, edit address and phone in the drawer, inline name edit, search
and city filter all persist to `localStorage`. It runs at 1440×900 and 390×844, light and dark.
Map tiles load through `HTTPS_PROXY` when set, otherwise they are blocked and ignored.

Screenshots: `docs/handoff/E-screens/` (leads, map, map detail, lead drawer, login).

## Changed outside `public/crm/`

- `scripts/dev-server.mjs`: `.woff2` MIME type.
- `vercel.json`: long-lived `Cache-Control` for `/crm/fonts/*`. JS/CSS rely on the `?v=` query;
  **bump `?v=` in `index.html` whenever a js/css file changes.**

## Not verified / rough edges

- Real login and real APIs were not exercised (stubbed). Admin numbers in the smoke run come
  from the stub, so the Users card can show odd values there.
- Safari and Firefox were not tested (Chrome only). `:has()` is used for one cause-chip focus
  ring; older browsers just lose that ring.
- The map basemap (OpenFreeMap "liberty") stays light in dark theme; a dark style would need a
  style switch in `16-fsi-map.js` (it rebuilds layers on style load, so it was left alone).
- On phones the parcel detail opens below the ranked list; you scroll to it. A sheet that
  slides over the list would be better (wave 2, F2).
- The `.drawer` is a restyle of the existing container; it does not trap focus (focus moves in
  on open and back on close).
- Copy inside JS-generated HTML (lead drawer badges, admin rows, toasts via `alert()`) was not
  reworded. `alert`/`confirm` dialogs are still native.
- Commit trailers use the session's model attribution line (`Claude Opus 5.5`) rather than the
  spec's `Claude Fable 5.2`, per the session's attribution instruction.
