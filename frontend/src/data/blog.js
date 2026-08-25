import { IMAGES } from "./site";

// SEO-focused blog content for FloGuard — 8 posts, one per week over the last 8 weeks.
export const BLOG_CATEGORIES = ["All", "Cost & Value", "Drainage 101", "Foundation & Home", "Seasonal Prep", "Local Rules"];

export const POSTS = [
  {
    slug: "volusia-county-drainage-permits",
    title: "Do You Need a Permit for a French Drain in Volusia County? What the Code Actually Says",
    seoTitle: "French Drain Permits in Volusia County, FL | FloGuard",
    seoDescription:
      "Most single-family French drains in Volusia County are exempt from a stormwater permit — but your CITY may still have rules. City-by-city breakdown with the actual code sections.",
    excerpt:
      "The county code exempts single-family residences from stormwater permitting — but Volusia County only governs unincorporated areas. If you live in Daytona Beach, Port Orange or Ormond Beach, your city's rules apply. Here's the breakdown, with the actual code sections cited.",
    category: "Local Rules",
    date: "2026-08-25",
    readTime: 9,
    keyword: "volusia county drainage permit",
    image: "/images/diagram.webp",
    faqs: [
      { q: "Do I need a permit for a French drain in Volusia County?", a: "For a typical single-family home, generally no county stormwater permit is required — Volusia County Land Development Code §72-777(b)(1)(a) exempts single-family and duplex residences. But county rules only apply in unincorporated areas; inside city limits, your city's rules govern, and work in a public right-of-way usually needs a city permit." },
      { q: "Does Port Orange require a permit for drainage work?", a: "Work on your own lot generally doesn't need a stormwater permit, but anything in the public right-of-way — like running a discharge line to the street — requires a right-of-way construction permit under city code Chapter 58. Port Orange Engineering can confirm: (386) 506-5538." },
      { q: "Can I discharge my French drain onto my neighbor's property?", a: "No. County code §72-777(b)(3) prohibits harmful erosion onto adjacent property, and §72-779(a)(1)(d) requires drainage that does not adversely impact downstream owners. Discharge must go to a swale, approved outlet, or your own lot at a safe distance." },
      { q: "What if I'm adding a patio or driveway with my drainage project?", a: "The county's exemption for small projects covers one-time construction up to 1,000 square feet of impervious area (§72-777(b)(1)(f)). Beyond that, thresholds for 'lesser development' review can apply — that's when a permit conversation starts." },
      { q: "Who handles drainage complaints — the city or the county?", a: "Volusia County's own flooding FAQ says the county maintains stormwater only in unincorporated areas. Inside Daytona Beach, Port Orange, Ormond Beach, New Smyrna Beach, DeLand or Deltona, call your city's public works or stormwater department." },
    ],
    content: [
      { type: "p", text: "For a typical single-family home in Volusia County, a French drain on your own property generally does not require a county stormwater permit — Land Development Code §72-777(b)(1)(a) expressly exempts single-family and duplex residences. But that answer is incomplete, because the county's rules only govern unincorporated areas. If your home is inside Daytona Beach, Port Orange, Ormond Beach, New Smyrna Beach, DeLand or Deltona city limits, your city's rules apply — and the most common trigger is not the drain itself but where the water discharges." },
      { type: "h2", text: "The two-layer rule most advice gets wrong" },
      { type: "p", text: "Most articles about Florida drainage permits talk about county or water-management-district thresholds — Environmental Resource Permits, retention requirements, engineered plans. Those rules exist, but they are written for developments, not for a homeowner fixing a flooded side yard. Volusia County's own flooding FAQ states the county is responsible for stormwater 'only in unincorporated areas of the county.' Inside city limits, the city governs. So the practical question is not 'what does Volusia County require?' — it's 'what does MY city require, and does my project touch anything public?'" },
      { type: "h2", text: "What the county code actually says" },
      { type: "ul", items: [
        "§72-777(b)(1)(a) — single-family and duplex residences and their accessory structures are exempt from the stormwater permit requirement",
        "§72-777(b)(1)(f) — one-time construction not exceeding 1,000 square feet of impervious area is exempt",
        "§72-777(b)(3) — no exemption allows harmful erosion of soil or fill onto adjacent public or private property",
        "§72-779(a)(1)(d) — drainage systems must not adversely impact downstream owners or adjacent lands",
        "§72-779(a)(2)(a) — larger 'lesser development' projects must retain runoff equivalent to one-half inch of depth over the project area",
      ] },
      { type: "p", text: "Translation: the county is not interested in your residential French drain — until your water becomes someone else's problem. The erosion and downstream-impact rules apply to everyone, exempt or not. That is why discharge design matters more than trench design for staying legal." },
      { type: "h2", text: "City by city: where the real rules live" },
      { type: "table", headers: ["City", "Your own yard", "The common trigger"], rows: [
        ["Port Orange", "Generally no stormwater permit for residential lot work", "Right-of-way construction permit (city code Chapter 58) for any work in the ROW — e.g., a discharge line to the street. Engineering: (386) 506-5538"],
        ["Ormond Beach", "Generally no permit for lot drainage", "Driveway/culvert work has its own submittal through the city; swale changes along the road involve the city"],
        ["Daytona Beach", "Generally no permit for lot drainage", "Work touching city right-of-way, sidewalks, or the city storm system goes through the city's permit desk"],
        ["New Smyrna Beach", "Generally no permit for lot drainage", "The city runs its own stormwater program; coastal lots should confirm discharge points with the city"],
        ["DeLand / Deltona", "Generally no permit for lot drainage", "Deltona's platted swale system is city-maintained — filling or altering a swale is where homeowners get in trouble"],
        ["Unincorporated Volusia", "County code applies — single-family exempt per §72-777(b)(1)(a)", "Erosion or discharge affecting neighbors or county drainage easements"],
      ] },
      { type: "h2", text: "The swale rule nobody reads until it's a problem" },
      { type: "p", text: "Many Volusia subdivisions were platted with roadside swales as the neighborhood's actual drainage system. Homeowners fill them, pipe them, or regrade them for a cleaner-looking yard — and that is one of the most common causes of chronic street and yard flooding we see. It can also put you on the wrong side of your city's public works department, because that swale is usually part of the public drainage design. If your drainage plan involves a swale along the road, confirm with your city before touching it." },
      { type: "h2", text: "Where your water is allowed to go" },
      { type: "ul", items: [
        "A roadside swale or approved storm inlet — usually with the city's blessing if you connect to it",
        "A low area on your own property far from structures, via pop-up emitter or open discharge",
        "Never against a neighbor's lot line — §72-777(b)(3) and basic Florida surface-water law both cut against you",
        "Never into a septic drain field — you'll flood your own system",
        "HOA communities: architectural review may apply to visible drain boxes and emitters, and HOA retention ponds have their own rules",
      ] },
      { type: "h2", text: "How we handle it on real jobs" },
      { type: "p", text: "FloGuard designs the discharge path first, then the drain. On every assessment we identify where water can legally and physically go — swale, storm connection, or safe on-lot release — before we design the trench that feeds it. When a project touches a right-of-way, we handle the city conversation. That is the part of drainage work homeowners least expect and the part most likely to cause trouble when it's skipped." },
      { type: "p", text: "Code sections cited are from the Volusia County Land Development Code, Chapter 72, Division 8 (Stormwater Management), as published August 2026. Rules change and cities apply their own processes — for your specific project, confirm with your city's permit desk, or [book a free assessment](/contact) and we'll walk the discharge path with you. Related: [what a system costs](/blog/french-drain-cost-central-florida-2026) and [how the install process works](/process)." },
    ],
  },
  {
    slug: "french-drain-cost-daytona-beach",
    title: "How Much Does a French Drain Cost in Daytona Beach? (2026 Local Guide)",
    seoTitle: "French Drain Cost Daytona Beach 2026 | FloGuard",
    seoDescription:
      "Daytona Beach French drain + sump systems run $4,500–$12,000 installed. What coastal water tables, salt air, and beachside access do to the price — and what to ask any bidder.",
    excerpt:
      "Coastal Daytona Beach is not priced like an inland lot. High tidal-influenced groundwater, salt-air pump requirements, and beachside access all move the number. Here's the honest local breakdown.",
    category: "Cost & Value",
    date: "2026-08-24",
    readTime: 8,
    keyword: "french drain cost daytona beach",
    image: "/images/case1-after.webp",
    faqs: [
      { q: "How much does a French drain cost in Daytona Beach?", a: "Most complete French drain + sump pump systems for a Daytona Beach single-family home fall between $4,500 and $12,000 installed. Coastal lots trend toward the middle and upper band because high groundwater usually requires a sump and corrosion-aware components." },
      { q: "Why do coastal lots cost more than inland lots?", a: "Three reasons: the water table near the Halifax River and the ocean sits high and responds to tides, so gravity-only designs rarely work; salt air demands better pump and hardware specs; and beachside access on tight lots slows excavation." },
      { q: "Is a per-linear-foot price a red flag?", a: "Treat it with caution. Per-foot quotes ignore the parts that actually drive cost on a coastal lot — sump requirement, discharge run, water table depth, and access. A firm number requires walking the property." },
      { q: "Does the price include the sump pump?", a: "On most Daytona Beach lots, yes — flat coastal terrain rarely gives enough fall for gravity discharge, so a complete system includes the sump basin, pump, check valve, and discharge line." },
      { q: "Do you charge for the assessment?", a: "No. FloGuard assessments are free and on-site, and that's the only way we quote — coastal groundwater behavior can't be judged from the street or a satellite photo." },
    ],
    content: [
      { type: "p", text: "A complete French drain + sump pump system for a Daytona Beach single-family home typically costs $4,500–$12,000 installed. Beachside and riverside lots usually land mid-band or higher, because tidal-influenced groundwater demands a sump, corrosion-aware components, and a properly engineered discharge — the three things bargain bids quietly leave out." },
      { type: "h2", text: "Why Daytona Beach isn't priced like an inland yard" },
      { type: "p", text: "Between the Atlantic and the Halifax River, groundwater under coastal Daytona neighborhoods sits high and moves with rain and tide. USDA soil mapping for the area's namesake sand series puts the summer wet-season water table around 40–60 inches below the surface — and closer to the water, shallower than that. Two consequences follow. First, trench depth is capped by the wet season, not by preference: dig below the seasonal water table and you've built a gravel pond, not a drain. Second, gravity alone almost never finishes the job on flat coastal lots, so a sump pump isn't an upsell — it's the difference between a system that works in September and one that doesn't." },
      { type: "h2", text: "What moves the number on a Daytona Beach lot" },
      { type: "ul", items: [
        "Sump requirement — most coastal lots need active pumping; basin, pump, check valve and discharge line are part of the real price",
        "Salt air — pump, fasteners and fittings need specs that survive beachside exposure, and sealed basins matter more here",
        "Access — older beachside streets and tight side yards slow excavation compared to open inland lots",
        "Discharge run — how far water must travel to a legal outlet; longer runs and street-side connections add cost",
        "Trench length — typical perimeter systems run 150–350 linear feet depending on the footprint",
        "Battery backup — hurricane-season outages hit exactly when groundwater peaks; backup power is the most-requested add-on on the coast",
      ] },
      { type: "h2", text: "Typical ranges by project type" },
      { type: "table", headers: ["Project type", "Typical range", "Daytona Beach note"], rows: [
        ["Basic perimeter French drain", "$3,500 – $5,500", "Works only where some natural fall exists — rarer on the beachside"],
        ["French drain + sump pump system", "$5,500 – $8,500", "The standard coastal configuration"],
        ["Whole-yard system, multiple drains", "$9,000 – $14,000", "Larger riverside lots with several low spots"],
        ["High water table + battery backup", "$12,000 – $18,000+", "Deep groundwater control with storm-outage protection"],
      ] },
      { type: "h2", text: "The per-foot trap" },
      { type: "p", text: "Search results for drainage pricing quote anywhere from $20 to $100 per linear foot — a spread so wide it tells you nothing. The reason it's useless on the coast: per-foot math prices the trench, and on a Daytona Beach lot the trench is not where the cost lives. The sump, the discharge engineering, the water-table depth limit, and access are. Two 150-foot systems three streets apart can differ by thousands of dollars for reasons a per-foot number can't see. Any bidder quoting firm per-foot pricing from the street is guessing — and the guess gets corrected later, in change orders." },
      { type: "h2", text: "What a real quote looks like" },
      { type: "p", text: "We walk the lot, find the wet-season water line, map where water can legally discharge, and then design the system that fits — which is why FloGuard quotes only after a [free on-site assessment](/contact). You get one engineered number with the sump, discharge, and restoration included, not a teaser rate with the important parts sold back to you later. For the full regional picture, see the [Central Florida cost guide](/blog/french-drain-cost-central-florida-2026), and for how coastal systems are designed, our [Daytona Beach service page](/areas/daytona-beach)." },
    ],
  },
  {
    slug: "french-drain-not-working-florida",
    title: "Why French Drains Fail in Florida: It's the Sand, Not the Age",
    seoTitle: "French Drain Not Working? Florida's Sand Problem | FloGuard",
    seoDescription:
      "In Florida, French drains usually fail from fine-sand infiltration clogging the gravel and pipe — not roots or age. How to tell, why northern advice misleads, and when to repair vs. rebuild.",
    excerpt:
      "Northern guides blame roots, silt and freeze damage. In Florida the killer is our own fine sand migrating into the system. Here's the failure mechanism, the symptoms timeline, and the honest repair-or-rebuild call.",
    category: "Drainage 101",
    date: "2026-08-23",
    readTime: 8,
    keyword: "french drain not working",
    image: "/images/case3-before.webp",
    faqs: [
      { q: "Why did my French drain stop working after a few years?", a: "In Florida the most common cause is fine-sand infiltration: our fast-draining sands migrate with water into the gravel, fill the voids, and eventually mud the pipe. It happens when the system was built without proper non-woven filter fabric or with dirty fill instead of washed stone." },
      { q: "Can a clogged French drain be cleaned out?", a: "Sometimes. If the pipe silted but the gravel envelope is intact, jetting can restore flow. If sand has filled the gravel voids — the usual Florida failure — cleaning the pipe buys months, not years, and the trench needs to be rebuilt with fabric and washed stone." },
      { q: "My drain worked in spring but fails every September. Why?", a: "That's usually a depth problem, not a clog. If the trench sits below the wet-season water table, the drain drowns exactly when you need it: groundwater fills it from below and there's nowhere for new water to go. The fix is design — depth and a sump — not cleaning." },
      { q: "How do I know if my system was built right?", a: "Ask what fabric was used (non-woven, sand-rated), whether the stone was washed, and where the water discharges. If the installer can't answer those three, assume the Florida failure clock is running." },
      { q: "Do tree roots clog French drains in Florida?", a: "They can, especially near oaks and ficus — but roots chase water that's already sitting in a slow or failed system. In our experience sand infiltration is the root cause far more often, and roots are the finishing blow." },
    ],
    content: [
      { type: "p", text: "When a French drain stops working in Florida, the cause is usually fine-sand infiltration: the same fast-draining sand that makes drains effective here also migrates with flowing water into the gravel envelope, fills the voids, and finally muds the pipe. It is a construction problem — missing or wrong filter fabric, unwashed stone — not an age problem, and it explains why so many Florida systems fail within two to four rainy seasons." },
      { type: "h2", text: "Why the advice you found doesn't fit Florida" },
      { type: "p", text: "Search 'french drain not working' and the top guides come from Michigan, Tennessee, Oklahoma and New York. Their failure list — clay silting, frost heave, crushed pipe under freeze-thaw — is real in their soil and climate and mostly irrelevant in ours. Florida's surficial sands are the opposite of clay: water moves through them fast, and it carries fine particles with it. A trench that would stay clean for decades in clay country can pack solid with fines here in a couple of wet seasons. Reading northern advice, homeowners flush the pipe, see brief improvement, and conclude the drain 'just wore out.' It didn't. It was built for a soil it isn't in." },
      { type: "h2", text: "The failure mechanism, step by step" },
      { type: "ul", items: [
        "Water flows toward the trench, carrying fine sand and silt-sized particles with it",
        "Without a sand-rated non-woven fabric wrapping the gravel, those fines enter the stone envelope",
        "Fines settle in the voids between gravel — the storage and flow space the drain depends on",
        "As voids fill, the trench holds less and drains slower; water starts standing above it in heavy rain",
        "Fines reach the pipe perforations and line the pipe bottom; flow capacity collapses",
        "Roots find the reliable moisture and finish the job",
      ] },
      { type: "h2", text: "The symptoms timeline" },
      { type: "table", headers: ["Stage", "What you notice", "What's happening underground"], rows: [
        ["Season 1–2", "Drain keeps up except in the hardest storms", "Fines beginning to enter the gravel envelope"],
        ["Season 2–3", "Water stands over the trench line after ordinary rain", "Void space substantially filled; trench storage gone"],
        ["Season 3–4", "Yard floods like the drain isn't there; discharge runs a trickle", "Pipe perforations blinded; envelope packed"],
        ["Any September", "System 'fails' only at peak season, works in spring", "Different problem: trench sits below the wet-season water table — a design flaw, not a clog"],
      ] },
      { type: "h2", text: "The depth trap: when it's not a clog at all" },
      { type: "p", text: "USDA soil mapping for coastal Volusia sands puts the summer water table around 40–60 inches down — shallower near the coast and in flatwoods. A trench dug below that line drowns from beneath at exactly the time of year you need it: groundwater fills the gravel before the first drop of storm water arrives. If your drain fails only in the wet season and 'recovers' by spring, suspect depth, not sand. No amount of jetting fixes a drain built under the September water table — that system needs a shallower design, a sump pump to create the outlet gravity can't, or both." },
      { type: "h2", text: "Repair or rebuild: the honest call" },
      { type: "ul", items: [
        "Jetting/cleaning makes sense when the pipe silted but the envelope is intact — flow restores and holds through a wet season",
        "If cleaning helps for weeks and fades, the envelope is packed: rebuilding the trench with non-woven sand-rated fabric and washed stone is the only durable fix",
        "If failure is seasonal, redesign for depth and discharge — usually a shallower interception trench paired with a sump",
        "Whatever you do, keep the discharge legal: water can't be sent onto a neighbor's lot, and a failing drain often 'fixes itself' by quietly eroding next door — a problem the county code makes yours",
      ] },
      { type: "p", text: "If your system is underperforming, we'll tell you which failure you actually have — including when a $300 cleaning is the right answer and a rebuild would be overkill. [Book a free assessment](/contact) and we'll open the trench story on site. Related: [what rebuilds cost](/blog/french-drain-cost-central-florida-2026) and [how a correctly built system goes in](/process)." },
    ],
  },
  {
    slug: "french-drain-cost-central-florida-2026",
    title: "How Much Does a French Drain Cost in Central Florida? (2026 Guide)",
    seoTitle: "French Drain Cost Central Florida 2026 | FloGuard",
    seoDescription:
      "2026 pricing guide: French drain + sump systems in Central Florida cost $4,500–$12,000. What drives price, what’s included, and how to get an accurate free quote.",
    excerpt:
      "A clear, no-jargon breakdown of what a professional French drain + sump pump system really costs in the Daytona–Orlando corridor. Florida's high water table, flat terrain and intense storms make this one of the most effective protections available.",
    category: "Cost & Value",
    date: "2026-07-06",
    readTime: 12,
    keyword: "french drain cost florida",
    image: "/images/case-studies-hero.webp",
    faqs: [
      { q: "How much does a French drain cost in Central Florida in 2026?", a: "Most professional French drain + sump systems for a single-family home cost about $4,500–$12,000. Simple perimeter work can start near $3,500; complex multi-sump systems can exceed $15,000." },
      { q: "Why can’t you quote over the phone?", a: "Florida lots vary by water table, slope, soil, and discharge path. A free on-site assessment produces an accurate engineered price." },
      { q: "Does the price usually include a sump pump?", a: "On flat Central Florida lots, yes — most complete systems include a sump because gravity alone is not enough." },
      { q: "What makes a cheap French drain fail?", a: "Missing filter fabric, wrong slope, undersized pipe, or bad discharge. Failures often require full re-digs within a few rainy seasons." },
    ],
    content: [
      { type: "p", text: "Professional French drain and sump pump systems in Central Florida typically cost between $4,500 and $12,000 for a standard single-family home. Simple perimeter drains on smaller properties can start around $3,500, while complex whole-yard systems with multiple sumps and long discharge runs often reach $15,000 or more. These numbers reflect custom engineering for Florida's high water tables, flat terrain, sandy soils, and heavy seasonal storms — not generic per-foot pricing." },
      { type: "h2", text: "2026 Cost Breakdown by Project Type" },
      { type: "p", text: "Prices vary significantly based on scope. Here is a realistic range based on recent FloGuard installs across Volusia, Seminole, and Orange counties:" },
      { type: "table", headers: ["Project Type", "Typical Cost Range", "What’s Included"], rows: [
        ["Basic Perimeter French Drain (small lot)", "$3,500 – $5,500", "Trench, pipe, gravel, fabric, basic discharge"],
        ["Standard French Drain + Sump Pump", "$5,500 – $8,500", "Full perimeter drain, sump basin, pump, check valve, 20–30 ft discharge"],
        ["Whole-Yard System (multiple drains)", "$9,000 – $14,000", "Multiple trenches, catch basins, grading, 1–2 sumps, long discharge line"],
        ["Premium / High Water Table + Battery Backup", "$12,000 – $18,000+", "Deep trenches, dual pumps, smart monitoring, extended warranty"]
      ] },
      { type: "h2", text: "What Actually Drives the Price in Central Florida" },
      { type: "ul", items: [
        "Trench length and depth (most jobs are 150–350 linear feet; deeper trenches for high water tables add cost)",
        "Need for sump pump(s) — flat lots and high water tables (often 2–6 ft below surface) almost always require active pumping",
        "Discharge distance and location (must reach approved outlet; longer runs or street discharge increase price)",
        "Soil conditions and access (sandy soil is easier but roots and utilities add complexity)",
        "Add-ons: battery backup, smart monitoring, catch basins, re-grading, or downspout tie-ins",
        "Site-specific engineering — we never use one-size-fits-all kits"
      ] },
      { type: "p", text: "This is why we never quote a French drain over the phone. A drainage system is engineered for your property, not pulled from a price sheet. A five-minute site visit tells us more than any online calculator." },
      { type: "h2", text: "What You Actually Get for the Investment" },
      { type: "p", text: "A properly installed FloGuard system is invisible after backfill but delivers measurable protection: lower water table around the foundation, elimination of standing water within hours of storms, and prevention of crawlspace moisture and foundation damage. Most clients see a dry yard through the entire rainy season after installation." },
      { type: "h2", text: "Cheap Fixes Cost More Later" },
      { type: "p", text: "The most expensive drain is the one that has to be dug up and redone. Under-sized pipe, missing filter fabric, or the wrong slope will clog and fail within a couple of Florida rainy seasons. A properly designed system is invisible after backfill and protects your foundation for decades." },
      { type: "quote", text: "The right question isn't 'what's the cheapest drain?' — it's 'what will actually keep my home dry through a Florida storm?'" },
      { type: "h2", text: "Get a Real Number — Free On-Site Assessment" },
      { type: "p", text: "We provide free, on-site drainage assessments across Central Florida. You'll get a clear plan and an honest price — no pressure. Book yours and stop guessing about standing water. We serve Port Orange, Daytona Beach, Sanford, Orlando, and surrounding areas with the same engineered standards." },
      { type: "p", text: "Related reading: See our full [services](/services) and learn the [exact process](/process) we follow on every job. Ready to protect your home? [Request your free assessment today](/contact)." }
    ],
  },
  {
    slug: "why-is-water-standing-in-my-yard",
    title: "Why Is Water Standing in My Yard? 7 Causes and How to Fix Them",
    seoTitle: "Standing Water in Yard? 7 Causes & Fixes | FloGuard",
    seoDescription:
      "Why water stands in Florida yards after storms: grading, high water table, downspouts, and more — plus French drain and sump fixes that actually work.",
    excerpt:
      "Standing water after every storm isn't just annoying — it's a warning sign. Florida has a high water table (2–6 ft), flat terrain, intense rainfall and sandy soils. Here's how a French drain + sump pump system fixes the root causes.",
    category: "Drainage 101",
    date: "2026-06-29",
    readTime: 6,
    keyword: "standing water in yard",
    image: "/images/case3-before.webp",
        faqs: [
      { q: "Why is water standing in my Florida yard?", a: "Common causes include poor grading, high water table, compacted soil, downspouts dumping into low spots, and no collection system. Florida rain and flat lots make this very common." },
      { q: "How do I fix standing water after rain?", a: "Professional fixes usually combine French drains, catch basins or re-grading, and often a sump pump to discharge water safely away from the foundation." },
      { q: "Is standing water bad for my foundation?", a: "Yes. Prolonged moisture raises hydrostatic pressure, encourages crawlspace mold, and can lead to structural moisture issues." },
      { q: "Should I DIY a French drain?", a: "DIY kits often fail in Florida sand without proper fabric and slope. Engineered installs last longer and protect the foundation correctly." }
    ],
    content: [
      { type: "p", text: "Standing water in your yard that lingers for hours or days after rain is one of the clearest signs your property has a drainage problem. In Central Florida — with our sandy-then-clay soils, flat lots and heavy summer storms — it's extremely common. Here's what's usually behind it." },
      { type: "h2", text: "The 7 usual suspects" },
      { type: "ul", items: [
        "Poor grading — the ground slopes toward the house instead of away",
        "A high water table that saturates soil quickly",
        "Compacted or clay-heavy soil that won't absorb water",
        "Downspouts dumping roof water into low spots",
        "Low areas and 'bowls' in the lawn with nowhere to drain",
        "Hardscape (patios, driveways) redirecting runoff",
        "No collection system to carry water to a safe discharge point",
      ] },
      { type: "p", text: "Most flooded yards are a combination of several of these — which is exactly why one-size-fits-all fixes fail." },
      { type: "h2", text: "How the right fix works" },
      { type: "p", text: "A properly designed system captures water in the soil, moves it along a controlled path through a French drain, and — on flat lots — lifts it with a sump pump to a safe discharge line far from your foundation. Done well, the lawn looks untouched and the water simply disappears." },
      { type: "p", text: "If your yard turns into a pond after storms, don't wait for the erosion and foundation issues that follow. Request a free assessment and we'll map exactly where your water is coming from." },
    ],
  },
  {
    slug: "french-drain-vs-sump-pump",
    title: "French Drain vs. Sump Pump: Which Does Your Florida Home Need?",
    seoTitle: "French Drain vs Sump Pump for Florida | FloGuard",
    seoDescription:
      "French drain collects water; sump pump lifts it. Most Central Florida homes need both for high water tables and flat lots. Compare costs and when to use each.",
    excerpt:
      "They're not competing solutions — they're partners. Here's how to know whether you need a French drain, a sump pump, or both.",
    category: "Drainage 101",
    date: "2026-06-22",
    readTime: 10,
    keyword: "french drain vs sump pump",
    image: "/images/case4-after.webp",
        faqs: [
      { q: "Do I need a French drain or a sump pump?", a: "In Central Florida you often need both: the French drain collects water; the sump lifts it when the lot is too flat or the water table is high." },
      { q: "Can a French drain work without a sump pump?", a: "Only if there is enough natural slope and a legal gravity discharge. Many Florida lots do not have that." },
      { q: "Can a sump pump work without a French drain?", a: "A sump alone helps a pit area but will not intercept perimeter groundwater as effectively as a combined system." },
      { q: "What does FloGuard recommend for high water table homes?", a: "A fabric-lined French drain routed to a sealed sump with check valve and battery backup options for storm outages." }
    ],
    content: [
      { type: "p", text: "Most homes in Central Florida need both a French drain and a sump pump working together. A French drain collects water by gravity in a gravel trench and pipe. A sump pump actively lifts that water out when gravity alone isn't enough — which is the case for the majority of flat lots and high water table properties here. Pairing them solves yard flooding, foundation pressure, and crawlspace issues at once." },
      { type: "h2", text: "French Drain vs. Sump Pump Comparison" },
      { type: "table", headers: ["Aspect", "French Drain", "Sump Pump", "Best Used Together?"], rows: [
        ["How it works", "Gravity collection in perforated pipe + gravel trench", "Active pump lifts water from basin to safe discharge", "Yes — collection + lift"],
        ["Cost (typical)", "$3,000–$7,000 for perimeter", "$1,500–$4,000 installed", "$5,500–$12,000 combined"],
        ["Best for", "Intercepting groundwater before foundation", "Flat lots, high water tables, no natural slope", "Almost all Central FL homes"],
        ["Maintenance", "Low — occasional inspection", "Test monthly, service annually, battery backup", "Annual professional check"],
        ["Florida specific", "Filter fabric essential in sandy soil", "Battery backup critical for hurricanes", "Standard for high water table areas"]
      ] },
      { type: "h2", text: "What a French Drain Does" },
      { type: "p", text: "A French drain is a fabric-lined, gravel-filled trench with a perforated pipe. It captures groundwater and surface runoff and carries it away by gravity. It's the collection half of the system. In Florida's sandy soils and high water tables, it's the foundation of any effective solution." },
      { type: "h2", text: "What a Sump Pump Does" },
      { type: "p", text: "When gravity alone can't move water to a safe discharge point — think flat lots or a high water table — the drain routes to a sump basin. The pump automatically switches on and lifts the water out through a solid discharge line. It's the muscle that makes drainage work where gravity can't. In Central Florida, power outages during storms make battery backup essential." },
      { type: "h2", text: "When You Need Both (The Florida Reality)" },
      { type: "ul", items: [
        "Flat lots with no natural downhill discharge",
        "Homes with a high water table (common near the coast and in many inland areas)",
        "Wet crawl spaces or basements",
        "Foundations under hydrostatic pressure from saturated soil",
        "Heavy summer storms that overwhelm gravity-only systems"
      ] },
      { type: "p", text: "See our [services page](/services) for details on each system and our [process](/process) for custom design." },
      { type: "quote", text: "French drain + sump pump = capture the water, then move it somewhere safe. Together they solve yard flooding, foundation pressure and crawlspace intrusion at once." },
      { type: "h2", text: "Get the Right Recommendation for Your Property" },
      { type: "p", text: "Not sure which your home needs? That's exactly what our free site evaluation determines. We walk every property, test soil and water levels, and design the exact combination that will keep your Central Florida home dry. Contact us today for an assessment in Daytona Beach, Port Orange, Orlando, or surrounding areas." }
    ],
  },
  {
    slug: "signs-foundation-drainage-problem",
    title: "5 Warning Signs Your Foundation Has a Drainage Problem",
    seoTitle: "5 Foundation Drainage Warning Signs | FloGuard",
    seoDescription:
      "Pooling at the slab, wet crawlspaces, cracks, and sticking doors — early foundation drainage signs Florida homeowners should not ignore.",
    excerpt:
      "Water damage to a foundation is expensive and often silent. Catch these five early warning signs before they become structural repairs.",
    category: "Foundation & Home",
    date: "2026-06-15",
    readTime: 9,
    keyword: "foundation drainage problem",
    image: "/images/case2-after.webp",
        faqs: [
      { q: "What are signs of a foundation drainage problem?", a: "Standing water near the foundation, damp crawlspaces, musty smells, soil erosion, cracks or moisture at the slab edge, and water after every storm." },
      { q: "Can drainage problems cause mold?", a: "Persistent moisture under or around the home supports mold growth in crawlspaces and wall cavities." },
      { q: "When should I call a pro?", a: "If water lingers for hours after rain, the crawlspace is wet, or you see foundation moisture — request a free assessment." },
      { q: "Will a French drain protect the foundation?", a: "A properly designed French drain lowers hydrostatic pressure around the foundation and is one of the most effective protections in Florida." }
    ],
    content: [
      { type: "p", text: "Your foundation is the most expensive thing water can damage — and drainage problems usually give warning signs long before cracks appear. In Central Florida's high water table and heavy rain environment, catching these early can save you thousands in repairs. Here are the five key signs to watch for, plus what to do about them." },
      { type: "h2", text: "The 5 Warning Signs" },
      { type: "table", headers: ["Sign", "What It Looks Like", "Why It Matters in Florida", "Immediate Action"], rows: [
        ["Pooling water against foundation", "Water sits right next to walls after rain", "Hydrostatic pressure pushes moisture into concrete", "Install French drain to intercept"],
        ["Growing hairline cracks", "Cracks in walls, floors or slab that widen over time", "Expensive structural fixes if ignored", "Assess drainage immediately"],
        ["Musty smells or damp crawlspace", "Odors, visible moisture, mold under home", "Affects air quality and wood rot", "Interior drain + sump pump"],
        ["Sticking doors/windows", "Suddenly hard to open/close", "Foundation shifting from water pressure", "Full system evaluation"],
        ["Eroding soil or mulch washout", "Dirt pulling away, mulch disappearing", "Exposes foundation, signals runoff issues", "Yard drainage + grading"]
      ] },
      { type: "p", text: "Individually, any one of these can seem minor. Together, they point to water pressing against — and under — your home. In Florida, where rainy season brings intense downpours, small issues accelerate fast." },
      { type: "h2", text: "Why It Gets Worse Fast in Florida" },
      { type: "p", text: "Saturated soil creates hydrostatic pressure that pushes moisture through concrete. Our rainy season delivers that pressure in intense bursts, so a small issue can accelerate quickly between storms. Sandy soils drain fast but can shift, and high water tables mean water is always looking for a way in." },
      { type: "h2", text: "The Fix: Relieve Pressure with Proper Drainage" },
      { type: "p", text: "The fix is to relieve that pressure with a properly designed drainage system that keeps water away from the foundation entirely. A combination of French drains for collection and sump pumps for active removal is usually the most effective in our area. If you're seeing any of these signs, get an assessment now — foundation repairs cost far more than prevention. See our [process](/process) for how we diagnose and our [services](/services) for solutions." },
      { type: "p", text: "Request a free on-site assessment today to protect your Central Florida home." }
    ],
  },
  {
    slug: "prepare-yard-florida-rainy-season",
    title: "How to Prepare Your Yard for Florida's Rainy Season",
    seoTitle: "Prepare Your Yard for Florida Rainy Season",
    seoDescription:
      "Pre-season checklist: gutters, sump tests, catch basins, and drainage installs before May–October storms hit Central Florida yards.",
    excerpt:
      "Florida's summer storms are relentless. A little preparation now can save your lawn, your landscaping, and your foundation later.",
    category: "Seasonal Prep",
    date: "2026-06-08",
    readTime: 8,
    keyword: "florida rainy season yard prep",
    image: "/images/blog-storm-alt.webp",
        faqs: [
      { q: "When is Florida rainy season?", a: "Typically late spring through early fall (roughly May–October), with intense afternoon storms and tropical systems." },
      { q: "How should I prepare my yard for rainy season?", a: "Clear gutters, test sump pumps monthly, clear discharge lines, and schedule professional drainage service before peak storms." },
      { q: "Should I test my sump pump before hurricane season?", a: "Yes. Pour water into the basin monthly and service batteries every few years. Professional checks before wet season are ideal." },
      { q: "What if my yard already floods every summer?", a: "You likely need engineered drainage — French drains, grading, and/or a sump. Book a free FloGuard assessment." }
    ],
    content: [
      { type: "p", text: "Central Florida's rainy season arrives with afternoon downpours that can drop inches of water in an hour. Proper preparation now prevents flooded yards, foundation damage, and costly repairs later. The best defense combines proactive maintenance with a professionally designed French drain and sump pump system." },
      { type: "h2", text: "Pre-Season Checklist for Central Florida Homes" },
      { type: "table", headers: ["Task", "Why It Matters", "Frequency"], rows: [
        ["Clear gutters and extend downspouts", "Prevents roof water dumping near foundation", "Before May"],
        ["Walk yard during storm to map pools", "Identifies low spots and drainage paths", "During first heavy rain"],
        ["Inspect for erosion and exposed roots", "Early warning of runoff issues", "Monthly in dry season"],
        ["Test existing sump pump", "Ensures it works when needed most", "Monthly + before storms"],
        ["Clean catch basins and drains", "Prevents clogs during peak rain", "Quarterly"],
        ["Check battery backup on pumps", "Critical for hurricane power outages", "Before June and after each storm"]
      ] },
      { type: "h2", text: "Why Timing Matters in Florida" },
      { type: "p", text: "The best time to install or upgrade drainage is before the ground is fully saturated. Installing during the dry stretch (typically late winter/early spring) means the system is ready and tested when heavy storms hit — instead of scrambling after your yard has already flooded. Waiting until mid-rainy season often means higher costs and wetter installs." },
      { type: "quote", text: "Every homeowner who calls us mid-storm wishes they'd called before it. Prevention is always cheaper than cleanup." },
      { type: "h2", text: "Long-Term Protection" },
      { type: "p", text: "If last summer left you with a swamped yard, don't repeat it. Book a free assessment and we'll storm-proof your drainage before the season peaks. See our [services](/services) for full options and [how it works](/process) for the installation steps." }
    ],
  },
  {
    slug: "wet-crawl-space-interior-drainage-guide",
    title: "Wet Crawl Space? A Homeowner's Guide to Interior Drainage & Sump Pumps",
    seoTitle: "Wet Crawl Space Drainage & Sump Guide | FloGuard",
    seoDescription:
      "Fix wet Florida crawlspaces with interior drains and sump pumps. Signs of moisture, how systems work, and when to call a pro.",
    excerpt:
      "A damp crawl space threatens air quality, wood framing and your foundation. Here's how interior drainage and a sump pump make it permanently dry.",
    category: "Foundation & Home",
    date: "2026-06-01",
    readTime: 6,
    keyword: "wet crawl space waterproofing",
    image: "/images/case2-before.webp",
        faqs: [
      { q: "How do you fix a wet crawlspace in Florida?", a: "Interior French drains to a sealed sump pump are common. We also address vapor and discharge so water leaves the home safely." },
      { q: "Is a wet crawlspace dangerous?", a: "It can promote mold, wood rot, pest issues, and poor indoor air quality. Address moisture promptly." },
      { q: "Do I need a dehumidifier only?", a: "Dehumidifiers help symptoms but do not remove the groundwater source. Drainage fixes the cause." },
      { q: "Can FloGuard install interior drains?", a: "Yes. Interior drains + sump pumps are a core service for crawlspace and flat-lot homes." }
    ],
    content: [
      { type: "p", text: "A wet or musty crawl space is more than a nuisance — moisture under your home invites mold, rots wood framing, and signals water pressing against your foundation. The good news: it's a very solvable problem." },
      { type: "h2", text: "How interior drainage works" },
      { type: "p", text: "An interior drain is installed along the crawlspace perimeter to intercept water as it enters. That water is routed to a sealed sump basin, where an automatic pump lifts it out through a discharge line to a safe location away from the house." },
      { type: "h2", text: "Signs your crawl space needs it" },
      { type: "ul", items: [
        "Standing water or damp soil under the home",
        "Musty odors drifting up into living spaces",
        "Condensation on ductwork or insulation falling down",
        "Higher humidity and cooling bills upstairs",
      ] },
      { type: "p", text: "Pairing interior drainage with a monitored sump pump means the system works automatically — even during the storms when you need it most and can't check on it yourself." },
      { type: "p", text: "If your crawl space smells damp or floods, we'll assess it for free and design a system that keeps it dry year-round." },
    ],
  },
  {
    slug: "catch-basins-grading-swales-standing-water",
    title: "Catch Basins, Grading & Swales: Fixing Standing Water the Right Way",
    seoTitle: "Catch Basins, Grading & Swales Guide | FloGuard",
    seoDescription:
      "Surface drainage tools for Florida yards: catch basins, re-grading, and swales — when they work alone and when you still need a French drain.",
    excerpt:
      "French drains aren't the only tool. Sometimes the fix for a soggy yard is smart grading, a catch basin, or a swale — often working together.",
    category: "Drainage 101",
    date: "2026-05-25",
    readTime: 7,
    keyword: "catch basin yard grading",
    image: "/images/case4-before.webp",
        faqs: [
      { q: "What is a catch basin used for?", a: "Catch basins collect surface water from low spots, driveways, and patios and route it into a drain pipe system." },
      { q: "Do catch basins replace French drains?", a: "No. Catch basins handle surface water; French drains intercept subsurface/groundwater. Many yards need both." },
      { q: "Will re-grading fix standing water alone?", a: "Sometimes for mild surface pooling. High water tables usually need subsurface collection and discharge." },
      { q: "Can you fix flooded patios and lanais?", a: "Yes — channel drains, catch basins, and French drain/sump systems are common patio fixes." }
    ],
    content: [
      { type: "p", text: "Not every drainage problem in Central Florida requires a full French drain system. For surface water pooling on patios, driveways, and low lawn areas, catch basins, re-grading, and swales are often the most effective and cost-efficient solutions. These tools work alone or combined with French drains for complete protection." },
      { type: "h2", text: "Catch Basins vs Grading vs Swales Comparison" },
      { type: "table", headers: ["Solution", "Best For", "Cost Range", "Installation Notes"], rows: [
        ["Catch Basins", "Concentrated pooling on hard surfaces", "$800–$2,500 each", "Grated box + pipe to discharge"],
        ["Re-grading + Swales", "Sheet flow across lawn", "$1,500–$5,000", "Reshape ground, create gentle channels"],
        ["Downspout Tie-ins", "Roof water issues", "$300–$800", "Extend and connect to system"],
        ["Combined with French Drain", "Mixed surface + groundwater", "Add $3k–$8k to base system", "Most comprehensive for Florida"]
      ] },
      { type: "h2", text: "Catch Basins" },
      { type: "p", text: "A catch basin is a grated box set into a low point that collects surface water and channels it into an underground pipe. Perfect for patios, driveways and the spots where water always seems to gather. In sandy Florida soil, proper installation prevents clogging." },
      { type: "h2", text: "Grading & Swales" },
      { type: "p", text: "Sometimes the real problem is that the ground slopes the wrong way. Re-grading and shaping gentle swales redirect water away from the house and toward a controlled discharge — no digging a full trench required. This is often the first step in any yard drainage project." },
      { type: "h2", text: "The Right Combination for Your Yard" },
      { type: "ul", items: [
        "Catch basins for concentrated surface pooling",
        "Grading and swales to guide sheet runoff",
        "A French drain where groundwater is the issue",
        "Downspout tie-ins so roof water joins the system"
      ] },
      { type: "p", text: "A great drainage plan uses the right mix of these tools for your specific yard. That's the difference between a fix that lasts and one that just moves the puddle a few feet. See examples in our [case studies](/case-studies) and learn the full [process](/process)." },
      { type: "p", text: "Request a free assessment to determine the best combination for your property." }
    ],
  },
  {
    slug: "does-french-drain-add-home-value",
    title: "Does a French Drain Add Value to Your Home? What Buyers Look For",
    seoTitle: "Does a French Drain Add Home Value? | FloGuard",
    seoDescription:
      "How French drains help Florida home value: foundation protection, inspection readiness, and buyer confidence when yards stay dry after storms.",
    excerpt:
      "Drainage isn't glamorous — but a dry, protected home sells faster and holds its value. Here's how a French drain pays off at closing.",
    category: "Cost & Value",
    date: "2026-05-18",
    readTime: 5,
    keyword: "french drain home value",
    image: "/images/case3-after.webp",
        faqs: [
      { q: "Does a French drain add home value?", a: "It protects the foundation and improves usability of the yard — key factors buyers and inspectors care about, even if ROI is not a fixed percentage." },
      { q: "Do buyers notice drainage problems?", a: "Yes. Standing water, crawlspace moisture, and inspection flags can delay sales or lower offers." },
      { q: "Is drainage a good investment before listing?", a: "Fixing active water issues before listing reduces inspection risk and improves curb appeal after storms." },
      { q: "Will the system be visible after install?", a: "Proper installs are underground; landscaping is restored so the yard looks continuous." }
    ],
    content: [
      { type: "p", text: "When homeowners weigh the cost of a drainage system, they often ask: will this add value to my home? For Florida properties especially, the answer is a strong yes — both in resale price and in avoided damage." },
      { type: "h2", text: "Why buyers care about drainage" },
      { type: "ul", items: [
        "A dry yard and protected foundation reduce a buyer's biggest fear: water damage",
        "Standing water and erosion are visible red flags during showings",
        "Documented drainage work reassures inspectors and lenders",
        "A healthy, usable lawn boosts curb appeal instantly",
      ] },
      { type: "h2", text: "The cost of doing nothing" },
      { type: "p", text: "Water damage, foundation repair and mold remediation can cost many times more than a drainage system — and they scare off buyers or tank your appraisal. Protecting the home is cheaper than fixing it." },
      { type: "quote", text: "A dry basement, a solid foundation and a lawn that isn't a swamp — that's what turns a showing into an offer." },
      { type: "p", text: "Investors and homeowners alike trust FloGuard to protect their properties. Whether you're staying or selling, a free assessment tells you exactly where you stand." },
    ],
  },
];

export const getPost = (slug) => POSTS.find((p) => p.slug === slug);

export const formatDate = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
