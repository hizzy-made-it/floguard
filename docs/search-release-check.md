# FloGuard search release check

The marketing site is Cloudflare Pages (floguard.pages.dev and floguardfl.com). A green Vercel deployment on this repository belongs to the CRM, not the marketing site.

1. Build from `frontend` using `yarn install --frozen-lockfile` and `yarn build`. Do not disable prerender in production: the marketing routes and real 404 page depend on it.
2. From the repository root, run `python .github/scripts/indexnow.py --build frontend/build`. This checks the copied ownership file and each prerendered canonical.
3. Deploy to the existing marketing Pages project through its configured release path. Ensure the production marketing domain, not the preview or CRM, serves the new asset.
4. Run `python .github/scripts/indexnow.py --pages` for a read-only production check. Confirm the key serves the exact plain text without a redirect; all sitemap URLs must be direct 200 responses with their own canonical.
5. The IndexNow workflow notifies the endpoint after the frontend deploy. Use `workflow_dispatch` or `python .github/scripts/indexnow.py --pages --submit` only if an equivalent successful submission did not already run. HTTP 200 means the URLs were received and 202 means received with key validation pending. Neither guarantees indexing.
6. In the verified apex Domain property in Google Search Console and in Bing Webmaster Tools, verify receipt of `https://floguardfl.com/sitemap.xml`. Inspect the homepage, main service and city pages for actual indexing; do not infer indexing from a 200 response or resubmit without a reason.

The public sales mail link opts out of Cloudflare's email rewriting only on prerendered marketing pages. Zone-wide settings are untouched. Crawl restrictions and noindex headers supplement, but do not replace, authentication for the admin and studio surfaces.
