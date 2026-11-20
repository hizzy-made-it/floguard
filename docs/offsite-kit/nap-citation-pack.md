# FloGuard — NAP + Citation Pack

Use this block **exactly**, character for character, on every listing. Consistent NAP is a local ranking signal. Small differences ("Ave" vs "Avenue", "FloGuard, LLC" vs "FloGuard LLC") create duplicate or split entities.

## Canonical NAP block

```
FloGuard LLC
5114 S Ridgewood Ave
Port Orange, FL 32127
{{PHONE}}
https://floguardfl.com
```

> **Phone: Heath must confirm the public number before any listing goes live.** The site (`frontend/src/data/site.js`) and older docs currently show `(386) 259-0023`. Whatever number is chosen must match the site header, footer, LocalBusiness schema, and GBP exactly. If a call-tracking number is used, put it on GBP as primary and keep the main line as the additional number.
>
> **Name:** older docs use "FloGuard, LLC" (with a comma). Pick one form and use it everywhere. This pack uses `FloGuard LLC`.
>
> **Website:** always the apex `https://floguardfl.com` (www 301s to apex). Never list `https://www.floguardfl.com`.

- **Facebook:** https://www.facebook.com/FloGuardLLC
- **Owner:** Heath Daniel
- **Service area:** Port Orange, Daytona Beach, Ormond Beach, South Daytona, New Smyrna Beach, Volusia County, FL
- **Hours:** {{HOURS}} (match GBP)

## Descriptions

**Short (≤50 chars)**
```
Drainage contractor in Port Orange, FL
```

**Medium (≤160 chars)**
```
French drains, yard drainage, grading, and sump pumps for homes in Port Orange, Daytona Beach, Ormond Beach, and Volusia County. Free on-site assessments.
```

**Long (≤500 chars)**
```
FloGuard LLC is an owner-operated drainage contractor based in Port Orange, Florida. We install French drains, fix yard drainage and grading problems, and install and maintain sump pumps for homeowners in Daytona Beach, Ormond Beach, South Daytona, New Smyrna Beach, and across Volusia County. Every job starts with a free on-site assessment of slope, soil, and water table, so the fix is built for Florida's sandy soil and heavy summer storms.
```

## Categories per platform

| Platform | Primary | Secondary |
|---|---|---|
| Google Business Profile | Drainage service | Excavating contractor, Contractor (see gbp-profile-copy.md) |
| Bing Places | Drainage Service (imports from GBP) | Excavating Contractors |
| Apple Business Connect | Drainage Service / Contractor | Landscaping |
| Yelp | Contractors → Grading / Excavation | Landscaping, Waterproofing |
| BBB | Drainage Contractors | Excavating Contractors |
| Angi | Drainage & Grading | Sump Pumps |
| Nextdoor | Home Services → Drainage | Landscaping |
| Thumbtack | Drainage Installation / French Drain Installation | Sump Pump Installation, Land Grading |
| HomeAdvisor | Drainage — Install or Repair | Sump Pump — Install |
| Houzz | Landscape Contractors (Drainage) | Excavation & Grading |
| Porch | Drainage Contractors | Sump Pump Installers |
| Chambers | Contractors / Home Services | — |

Category names change; pick the closest available match on each platform.

## Citation checklist

Costs and verification steps change often. Confirm on signup. "Free" means free basic listing; leads or ads are optional upsells.

| # | Platform | Signup URL | Cost | Verification method | Status |
|---|---|---|---|---|---|
| 1 | Bing Places | https://www.bingplaces.com | Free | Import from GBP (sign in with the Google account that owns GBP); otherwise phone/email/postcard | open |
| 2 | Apple Business Connect | https://businessconnect.apple.com | Free | Phone call to business number or document upload | open |
| 3 | Yelp | https://biz.yelp.com | Free (ads optional) | Phone call or text to business number | open |
| 4 | BBB | https://www.bbb.org/get-listed | Free listing; Accreditation is a paid annual fee (varies by business size) | BBB staff review; may request license/registration docs | open |
| 5 | Angi | https://www.angi.com/pro | Free profile; leads/ads paid | Background check + license/insurance review | open |
| 6 | Nextdoor | https://business.nextdoor.com | Free business page; ads paid | Address/phone verification | open |
| 7 | Thumbtack | https://www.thumbtack.com/pro | Free profile; pay per lead | Background check; phone verification | open |
| 8 | HomeAdvisor (Angi) | https://pro.homeadvisor.com | Membership fee + pay per lead | Background check + license/insurance | open |
| 9 | Houzz | https://pro.houzz.com | Free profile; Houzz Pro paid | Email verification | open |
| 10 | Porch | https://pro.porch.com | Free profile; leads paid | Email/phone verification | open |
| 11 | Port Orange-South Daytona Chamber of Commerce | {{CONFIRM_URL}} (call the chamber office in Port Orange) | Paid annual membership (confirm tier) | Membership application + payment | open |
| 12 | Daytona Regional Chamber of Commerce | https://daytonachamber.com/membership/index | Paid annual membership (confirm tier) | Membership application + payment | open |

**After each listing goes live:**
1. Paste the canonical NAP block, the medium or long description, categories, hours, logo, and 5+ real job photos.
2. Set the website to `https://floguardfl.com` (add UTM if the platform allows: `?utm_source=<platform>&utm_medium=citation`).
3. Add the listing URL to `sameAs` in the site's LocalBusiness schema once it is stable.
4. Change the status to `done` and note the live URL and date.
