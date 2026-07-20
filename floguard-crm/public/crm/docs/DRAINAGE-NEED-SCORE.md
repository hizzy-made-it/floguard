# Drainage Need Score (DNS) — Spec

A 0–100 sales-urgency score for drainage leads. **Sales urgency, not an engineering assessment** — it prioritizes dials; the free on-site assessment does the diagnosing.

## Notes wire format (parsed by the CRM)

```
DNS <score>/<grade> (<band>) | <signal 1>; <signal 2>; <signal 3>
```

Example: `DNS 82/A (urgent) | standing water 3+ days; musty crawlspace; foundation-side pooling`

The CRM's prospect card parses this line from notes (legacy `WFS` prefix also parses). LeadAgent writes it during scoring.

## Scoring model

Start at 0, add signal points, cap at 100.

**Duration (how long water stands)** — drains within an hour +5 · a few hours +12 · about a day +20 · several days +35 · never fully dries +45

**Location touched** — yard only +5 · driveway/patio/lanai +15 · around the foundation +25 · crawlspace/under home +30 · inside the house +40 (use highest single location)

**Damage signals (stack, max +40)** — mold/musty smell +15 · foundation cracks or moisture +20 · dead grass/erosion +8 · damaged patio/driveway +8 · water inside +25

**Frequency** — heavy storms only +5 · seasonally +10 · every rain +15 · constant +20

**Intent** — timeline ASAP +10 · within a month +5

**Keyword fallback (no quiz data):** notes matching /flood|standing water|days to drain/ +20 · /crawl ?space|musty|mold/ +20 · /foundation/ +20 · /erosion|washout/ +10 · /sump|french drain/ (existing system) +10

## Grades and bands

| Score | Grade | Band | Action |
|---|---|---|---|
| 85–100 | A | urgent | Dial first, same day; assessment within 24–48h |
| 70–84 | B | urgent | This week's priority list |
| 50–69 | C | priority | Normal cadence; "fix before it reaches the slab" frame |
| 30–49 | D | monitor | Nurture; YardDrainage entry offer |
| 0–29 | F | monitor | Honest check-in only; do not push |

## Talk-track generation

Per band, the scorer emits a talk track: urgent → lead with their specific signals + compounding damage + 24–48h slot; priority → free-assessment-as-fact-finding; monitor → seasonal check-in, no pressure.
