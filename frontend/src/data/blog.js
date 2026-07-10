import { IMAGES } from "./site";

// SEO-focused blog content for FloGuard — 8 posts, one per week over the last 8 weeks.
export const BLOG_CATEGORIES = ["All", "Cost & Value", "Drainage 101", "Foundation & Home", "Seasonal Prep"];

export const POSTS = [
  {
    slug: "french-drain-cost-central-florida-2026",
    title: "How Much Does a French Drain Cost in Central Florida? (2026 Guide)",
    excerpt:
      "A clear, no-jargon breakdown of what a professional French drain + sump pump system really costs in the Daytona–Orlando corridor. Florida's high water table, flat terrain and intense storms make this one of the most effective protections available.",
    category: "Cost & Value",
    date: "2026-07-06",
    readTime: 12,
    keyword: "french drain cost florida",
    image: "/images/case-studies-hero.jpg",
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
    excerpt:
      "Standing water after every storm isn't just annoying — it's a warning sign. Florida has a high water table (2–6 ft), flat terrain, intense rainfall and sandy soils. Here's how a French drain + sump pump system fixes the root causes.",
    category: "Drainage 101",
    date: "2026-06-29",
    readTime: 6,
    keyword: "standing water in yard",
    image: "/images/case3-before.jpg",
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
    excerpt:
      "They're not competing solutions — they're partners. Here's how to know whether you need a French drain, a sump pump, or both.",
    category: "Drainage 101",
    date: "2026-06-22",
    readTime: 10,
    keyword: "french drain vs sump pump",
    image: "/images/case4-after.jpg",
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
    excerpt:
      "Water damage to a foundation is expensive and often silent. Catch these five early warning signs before they become structural repairs.",
    category: "Foundation & Home",
    date: "2026-06-15",
    readTime: 9,
    keyword: "foundation drainage problem",
    image: "/images/case2-after.jpg",
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
    excerpt:
      "Florida's summer storms are relentless. A little preparation now can save your lawn, your landscaping, and your foundation later.",
    category: "Seasonal Prep",
    date: "2026-06-08",
    readTime: 8,
    keyword: "florida rainy season yard prep",
    image: "/images/blog-storm-alt.jpg",
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
    excerpt:
      "A damp crawl space threatens air quality, wood framing and your foundation. Here's how interior drainage and a sump pump make it permanently dry.",
    category: "Foundation & Home",
    date: "2026-06-01",
    readTime: 6,
    keyword: "wet crawl space waterproofing",
    image: "/images/case2-before.jpg",
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
    excerpt:
      "French drains aren't the only tool. Sometimes the fix for a soggy yard is smart grading, a catch basin, or a swale — often working together.",
    category: "Drainage 101",
    date: "2026-05-25",
    readTime: 7,
    keyword: "catch basin yard grading",
    image: "/images/case4-before.jpg",
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
    excerpt:
      "Drainage isn't glamorous — but a dry, protected home sells faster and holds its value. Here's how a French drain pays off at closing.",
    category: "Cost & Value",
    date: "2026-05-18",
    readTime: 5,
    keyword: "french drain home value",
    image: "/images/case3-after.jpg",
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
