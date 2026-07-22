# Cloudflare robots.txt — unblock AI answer engines (AEO)

## Problem

Live `https://www.floguardfl.com/robots.txt` currently starts with **Cloudflare Managed Content** that **Disallows** the bots we need for AI citations:

- `ClaudeBot`, `GPTBot`, `Google-Extended`
- `Applebot-Extended`, `CCBot`, `Bytespider`, `meta-externalagent`, `Amazonbot`

It also sets `Content-Signal: … ai-train=no …`.

Our repo `frontend/public/robots.txt` **Allow**s those agents, but crawlers use the **first matching User-agent block**. Cloudflare’s block is prepended, so **CF wins** and AEO fails.

## Fix (dashboard — required; cannot be done from this repo alone)

1. Log into [Cloudflare](https://dash.cloudflare.com) → zone **floguardfl.com**.
2. Find **AI Scrapers & Crawlers** / **Block AI bots** (often under **Security** → **Settings**, or **Bot Fight** / **Security** features — labels vary by plan).
3. **Turn off** managed AI-crawler blocking for this zone, **or** configure managed robots so GPTBot / ClaudeBot / PerplexityBot / Google-Extended / Applebot-Extended are **not** Disallowed.
4. If you use **Managed robots.txt**, disable AI disallow rules or stop Cloudflare from overriding origin `robots.txt` for AI UAs.
5. Confirm:

```bash
curl -sL https://www.floguardfl.com/robots.txt
```

You should **not** see a Cloudflare block of `GPTBot` / `ClaudeBot` / `Google-Extended` at the top. Origin Allow rules (or a clean CF allow list) should apply.

## After deploy

- Re-check robots.txt in Search Console / browser.
- Optionally re-request key URLs for indexing.
- AEO goal: answer engines can fetch and cite service, area, and blog pages.

## Repo source of truth

`frontend/public/robots.txt` — intentional Allow list for search + AI bots. Keep it; fix Cloudflare so it is not overridden.
