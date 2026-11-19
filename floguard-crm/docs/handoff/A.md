# Handoff A — contact enrichment (Trestle, per-phone metadata, spend guard)

Branch `crm-next/A`. Owned files only: `server/lib/contact-enrich.js`, `server/lib/trestle.js` (new),
`api/enrich-contacts.js`, `tests/enrich/`, `.env.example` (appended), `package.json` (`test` script).

## Read this first: Trestle does not find phone numbers

The brief assumed Trestle Reverse Address returns residents with phones. The published OpenAPI spec
(`docs.trestleiq.com/openapi/reverse-address.openapi.yaml`, read 2026-11-19) says otherwise:
`GET /3.1/location` returns `current_residents[]` with names, age range, associated people and
historical addresses. There is **no phone field**. So Trestle cannot be a discovery fallback.

What was built instead (same goal, honest data flow):

1. Path order is unchanged: BatchData, free website scrape, free directory search.
2. New step 4: Trestle **verifies every candidate number** (including numbers already on the lead):
   - Phone Validation `GET /3.0/phone_intel` with `add_ons=litigator_checks`: line type, activity
     score, TCPA litigator risk, validity.
   - Reverse Phone `GET /3.2/phone`: owner names, matched against the lead's owner name.
3. `trestle.reverseAddress()` exists and is tested, but the pipeline does not call it (no phone value).
   The UI/another agent can use it for "who lives here" if wanted.

Trestle returns no DNC flag. `dnc` is `null` for any number whose only check is Trestle. DNC comes from
BatchData, or from a scrub the owner does elsewhere.

## Contract output (per result in `results[]`)

Original fields kept: `id, phone, email, website, sources, status, detail`.

| field | meaning |
|---|---|
| `phone` | primary number, **only if the lead's phone is empty** (or `force`). Never overwrites. |
| `phones[]` | full merged list: `number, line_type, dnc, litigator, source, confidence, found_at` plus extras `name_match` (`match|partial|mismatch|unknown`), `activity_score`, `checks[]` |
| `phone_dnc, phone_line_type, phone_source, phone_confidence` | describe the lead's effective primary: the kept existing phone, else the new best |
| `suggested_phone` | when the lead keeps its own phone but a better, non-blocked number exists |
| `email`, `email_source` | `batchdata|web|search`; only when lead email empty |
| `enriched_at` | ISO |
| `warnings[]` | spend-guard hits, litigator add-on not enabled, owner mismatch text, Trestle errors |
| `cost` | `{batchdata, trestle_phone_intel, trestle_reverse_phone, trestle_litigator_addons, lookups}` for this lead |
| `status` | adds `blocked` (numbers exist but all DNC/litigator, none selectable). Others unchanged. |

Primary selection: exclude `dnc===true` and `litigator===true`; score = confidence + 0.15 mobile
(-0.05 voip) + 0.10 if `dnc===false` (actually scrubbed); highest wins. `dnc:null` is allowed but ranks
below a scrubbed number. UI must treat `null` as "not scrubbed" and keep the DNC reminder.

Confidence (0..1): batchdata 0.70, trestle 0.70, web 0.40, search 0.20, manual 0.50. Adjustments:
owner `match` +0.15, `partial` +0.05, `mismatch` -0.20 (labelled `name_match:'mismatch'`);
BatchData `reachable` false -0.30 / true +0.10; Trestle activity >=70 +0.10, <=30 -0.30,
`is_valid:false` caps at 0.05.

Name matching handles "SMITH JOHN A", "SMITH, JOHN", "John Smith", joint owners, trusts (reduced to the
person), and LLC/corp owners (never mismatched against a person: result `unknown`).

## API (`POST /api/enrich-contacts`, no new function files)

- `action:'capabilities'` -> `capabilities` now has `batchdata`, `trestle`, `trestle_role`,
  `litigator_check[]`, `max_validate_per_lead`, `default_max_paid_lookups` (50), `hard_max_paid_lookups` (500).
- `action:'estimate'` (no provider calls): `leads[]` each `{id, providers[], batchdata, trestle_phone_intel,
  trestle_reverse_phone, free[], expected_lookups, max_lookups}` and `totals{...,capped_at}`.
- `action:'enrich'`: new `maxPaidLookups` (default 50, hard cap 500, junk -> 50). Response adds
  `budget{max, remaining, used_total, used{}, exhausted}` and `summary.blocked`.
  The function is stateless: the cap is per request. A client running many 12-lead batches should
  subtract `budget.used_total` from its run total and send the remainder as `maxPaidLookups`.
- One paid lookup = one provider HTTP call. Max per lead: 1 BatchData + 3 phone_intel + 1 reverse phone.
  Litigator add-on rides on the phone_intel call (counted in `trestle_litigator_addons` for billing).
- Request `leads[]` should now also send `phones`, `phone_source`, `phone_line_type`, `phone_confidence`,
  `phone_dnc` so numbers already verified are not re-paid. They are optional.
- Batching: unchanged max 12 leads / `maxDuration` 60s; soft deadline 50s is also passed into
  `enrichOneLead`, so paid steps stop at the deadline (remaining leads get `timeout_budget`).

## Env

`TRESTLE_API_KEY` (new, appended to `.env.example`), optional `TRESTLE_API_URL` (tests/proxy only).
Existing `BATCHDATA_API_KEY` / `BATCH_DATA_API_KEY` unchanged. The litigator add-on bills extra and must
be enabled on the Trestle key; if it is not, `litigator` stays `null` and a warning says so.

## Tests

`cd floguard-crm && npm test` (script is `node --test "tests/**/*.test.js"`).
Not the literal `node --test tests/`: on Node 22 a bare directory argument is resolved as a module and
fails with MODULE_NOT_FOUND. The quoted glob needs Node >= 21 (Node 20 does not expand globs; use
Node 22 locally/CI). Other agents' tests under `tests/<name>/*.test.js` are picked up.
Fixtures in `tests/enrich/fixtures/`. Trestle ones follow the OpenAPI response schemas; the BatchData
one is an assumed shape (see below).

## Not verified (read before trusting)

- **BatchData response field names.** `developer.batchdata.com` could not be opened (fetch needed
  approval that was not given). `mapBatchDataResponse()` assumes `persons[].phoneNumbers[]` with
  `number, type, dnc, tcpa, reachable` and person-level `emails[].email`, tolerates aliases, and maps
  anything missing to `null`. `tcpa` is treated as the litigator flag: confirm that is what BatchData
  means by it. If real responses differ, change that one function and
  `tests/enrich/fixtures/batchdata-skiptrace.json`. Also unverified: whether the skip-trace request
  body needs a DNC/TCPA option enabled to return those flags (existing request code was not changed).
- **Trestle live behaviour.** Paths, params, header and response fields come from the published
  OpenAPI specs; nothing was run against the live API (no key). Rate-limit numbers are not published
  (docs give none); one retry on 429/5xx with 0.5s delay is a guess. Reverse Phone and Phone
  Validation pricing/quota per call not confirmed.
- Phone Validation spec forbids FCRA-covered decisions; this CRM use (lead contact quality) is outside
  that, but that is a legal call for the owner.
- `api/enrich-contacts.js` is covered by handler-level tests with stubbed fetch, not on Vercel.

## Needs from other agents

- C (leads in Postgres): store `phones` as jsonb and the scalar `phone_*`, `email_source`, `enriched_at`
  columns. Extras inside each phones[] entry (`name_match`, `activity_score`, `checks`) should be kept as-is.
- E / F1 (front end): send the optional lead fields above on enrich; call `estimate` before running and
  show `totals`; pass remaining budget as `maxPaidLookups`; render `dnc:null` as "not scrubbed";
  block dial on `phone_dnc === true` or `litigator === true`; show `name_match:'mismatch'` and `warnings`.
  Handle status `blocked`. Show `suggested_phone` as an offer, never auto-apply.
