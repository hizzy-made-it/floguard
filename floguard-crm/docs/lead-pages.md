# Lead pages + auto-reply email

Every drainage request from the website gets its own private page and, once switched on, an
auto-reply email that links to it.

```
website form ─▶ Render backend (MongoDB, emails Heath)
                   └─▶ POST crm/api/leads {action:'lead_forward'} (shared secret)
                          ├─ saves the lead to the CRM (web-leads + sales list, with the page link)
                          ├─ builds the page: Census geocode ─▶ Volusia parcel ─▶ aerial + USGS lidar
                          └─ emails the reply (only if LEAD_AUTOREPLY_ENABLED=true)
```

Page: `https://floguardfl.com/p/<slug>-<16 random chars>` (Cloudflare Pages function proxies to the CRM),
also served at `https://crm.floguardfl.com/p/...`. Images: `/p/<token>/before.png`, `/p/<token>/after.png`.
Sample on any deployment: `/p/sample` (live data for 5512 N Lancewood Cir) and `/p/sample?email=1`
(that's `/api/leads?lead_page=sample&email=1`).

## Full vs simple

| Version | When | Page + email get |
|---|---|---|
| **Full** | the address geocodes, matches a **Volusia County parcel by house number**, and an aerial comes back | before/after images on the lot's aerial. With USGS 3DEP lidar: low ground shaded, lowest spot, basin there. Without lidar: lot outline and a back-of-lot concept. |
| **Simple** | anything less (no street number, outside Volusia, no parcel match, imagery down) | the templated page and email, no property images |

Everything in the full version is automatic and labelled as a concept: the low ground, basin spot, drain
routing and lengths. The real flood map, routing and price come from the site walk (the full design proposal).

## Privacy

The page shows only property answers from the form. It never shows email, phone or the free-text
message, and never stores owner/sale/value fields from the parcel layer. Tokens carry 96 random bits;
unknown tokens all 404; per-IP and per-token rate limits; `noindex`, `no-referrer`, strict CSP with nonces.

## Environment

CRM (Vercel, project floguard-crm):

| Name | Value |
|---|---|
| `LEAD_FORWARD_SECRET` | random 32+ chars, same value on Render |
| `LEAD_PAGE_BASE_URL` | `https://floguardfl.com` once the Cloudflare function is live (default `https://crm.floguardfl.com`) |
| `LEAD_AUTOREPLY_ENABLED` | `true` to send. **Unset = nothing is ever emailed to a lead.** |
| `LEAD_AUTOREPLY_TEST_ONLY` | an address; when set, replies go only to it (use first) |
| `LEAD_AUTOREPLY_FROM` | default `FloGuard <leads@hdconnex.com>` (verify floguardfl.com in Resend to send as @floguardfl.com) |
| `LEAD_AUTOREPLY_REPLY_TO` | default `heath@hdconnex.com` |
| `LEAD_AUTOREPLY_BCC` | optional, comma-separated |
| `RESEND_API_KEY` | already used for lead alerts |
| `LEAD_PAGE_SAMPLE` | `off` to disable `/p/sample` |

Render backend: `LEAD_FORWARD_SECRET` (same value), optional `CRM_LEAD_FORWARD_URL`.

## Existing leads

Website admin (floguardfl.com/admin) → **Lead pages + auto-replies** → *Build pages (no emails)*. Builds or
reuses a page for every saved drainage lead (guide downloads skipped) and lists name, version and link.
*Send replies* emails only the checked rows, after a confirm, and only while `LEAD_AUTOREPLY_ENABLED=true`.
Each page emails at most once.
