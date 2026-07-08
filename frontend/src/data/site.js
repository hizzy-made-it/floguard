// Central content + media for the FloGuard site.

export const COMPANY = {
  name: "FloGuard",
  legal: "FloGuard, LLC",
  tagline: "Smart drainage systems for Florida homes.",
  phone: "(386) 259-0023",
  phoneHref: "tel:+13862590023",
  smsHref: "sms:+13862590023",
  email: "sales@floguardfl.com",
  emailHref: "mailto:sales@floguardfl.com",
  website: "FloGuardFL.com",
  address: "5114 S Ridgewood Ave, Port Orange, FL 32127",
  hours: "Mon–Fri · 8:00 AM – 5:00 PM",
  rating: "5.0",
  reviewCount: "2",
  mapEmbed:
    "https://www.google.com/maps?q=5114+S+Ridgewood+Ave,+Port+Orange,+FL+32127&output=embed",
};

export const IMAGES = {
  // Logo (lettering diagram) — DO NOT REPLACE
  logo: "https://customer-assets.emergentagent.com/job_171d6f38-0b46-45ff-9e6c-f9747eec3455/artifacts/raba3tpe_image.png",
  // Small icon fallback for logo — DO NOT REPLACE
  logoIcon: "https://customer-assets.emergentagent.com/job_171d6f38-0b46-45ff-9e6c-f9747eec3455/artifacts/rks20kgd_image.png",

  // All images are unique per usage (no duplicates)
  storm: "/images/storm.jpg",
  diagram: "/images/diagram.jpg",
  crew: "/images/crew.jpg",
  case1Before: "/images/case1-before.jpg",
  case1After: "/images/case1-after.jpg",
  case2Before: "/images/case2-before.jpg",
  case2After: "/images/case2-after.jpg",
  case3Before: "/images/case3-before.jpg",
  case3After: "/images/case3-after.jpg",
  case4Before: "/images/case4-before.jpg",
  case4After: "/images/case4-after.jpg",
  frenchDrain: "/images/french-drain.jpg",
  sumpPump: "/images/sump-pump.jpg",
  catchBasin: "/images/catch-basin.jpg",
  foundation: "/images/foundation.jpg",
  landscaped: "/images/landscaped.jpg",
  yardDry: "/images/yard-dry.jpg",
  blogStormAlt: "/images/blog-storm-alt.jpg",
};

export const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "How It Works", to: "/process" },
  { label: "Services", to: "/services" },
  { label: "Areas", to: "/areas" },
  { label: "Results", to: "/case-studies" },
  { label: "Blog", to: "/blog" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

export const STATS = [
  { value: 100, suffix: "+", label: "Yards Protected" },
  { value: 5.0, suffix: "★", label: "Google Rating", decimals: 1 },
  { value: 24, suffix: "hr", label: "Response Time" },
  { value: 5, suffix: "yr", label: "Warranty" },
];

export const SERVICE_AREAS = [
  "Port Orange", "Daytona Beach", "New Smyrna Beach", "Ormond Beach",
  "Sanford", "Orlando", "DeLand", "Deltona", "Lake Mary", "Winter Park",
  "Edgewater", "DeBary",
];

export const SERVICES = [
  {
    id: "exterior",
    title: "Exterior French Drains",
    blurb:
      "Perimeter trench systems that intercept surface runoff and groundwater before it reaches your foundation or pools on the lawn. Contains perforated pipe in clean gravel wrapped with filter fabric to keep sediment out.",
    image: IMAGES.case1Before,
    features: ["Custom trench + slope design", "Filter fabric + clean gravel", "Perforated collection pipe"],
    span: "wide",
  },
  {
    id: "interior",
    title: "Interior Drains + Sump Pumps",
    blurb:
      "For crawlspaces and low, flat lots: a sub-surface drain routed to a sump basin that automatically lifts water to a safe discharge. The active defense when gravity alone isn’t enough. A waterproof basin collects water; a submersible pump with float switch pushes it far away.",
    image: IMAGES.case2Before,
    features: ["Automatic float-switch pumps", "Sealed basin + discharge line", "Battery / monitoring options"],
    span: "tall",
  },
  {
    id: "yard",
    title: "Yard Drainage & Grading",
    blurb:
      "Catch basins, channel drains and precision grading that move water off patios, lanais and low spots without eroding your landscape.",
    image: IMAGES.case3Before,
    features: ["Catch basins & channel drains", "Re-grading & swales", "Downspout tie-ins"],
    span: "tall",
  },
  {
    id: "maintenance",
    title: "Pump Maintenance & Monitoring",
    blurb:
      "Seasonal service plans and smart monitoring that keep your system storm-ready year round — so it works the day you need it most.",
    image: IMAGES.case4Before,
    features: ["Scheduled inspections", "Pump testing & cleaning", "Storm-season readiness"],
    span: "wide",
  },
];

export const PROCESS = [
  {
    step: "01",
    title: "Site Evaluation",
    body:
      "We walk the property, map low spots, water tables and runoff paths, and pinpoint exactly where water enters and pools.",
  },
  {
    step: "02",
    title: "Custom System Design",
    body:
      "No one-size-fits-all kits. We engineer trench layout, slopes, pipe routing, fabric and discharge for your specific yard.",
  },
  {
    step: "03",
    title: "Clean Installation",
    body:
      "Our crew digs, lines, backfills and restores — leaving an invisible system beneath a lawn that looks untouched.",
  },
  {
    step: "04",
    title: "Maintenance & Monitoring",
    body:
      "We test pumps, clear basins and keep the system storm-ready with optional monitoring and seasonal service plans.",
  },
];

// The technical water path: surface water -> gravel -> pipe -> sump -> discharge
export const FLOW_PATH = [
  { label: "Surface Water", desc: "Rain and runoff collect in problem areas around the home." },
  { label: "Gravel Trench", desc: "A trench with clean gravel and filter fabric intercepts water before it reaches the foundation." },
  { label: "Perforated Pipe", desc: "4\" perforated pipe in the trench captures water and carries it by gravity to the sump pit." },
  { label: "Sump Basin", desc: "Waterproof basin at the lowest point collects water. Automatic pump activates via float switch." },
  { label: "Safe Discharge", desc: "Pump pushes water far from the foundation (10–20+ ft) to a swale, storm drain, or approved location." },
];

// Detailed system explanation distributed across the site (Florida-specific)
export const SYSTEM_EXPLANATION = {
  intro: "A sump pump + French drain system is one of the most effective ways to protect a home from water damage caused by heavy Florida rain and high groundwater. It is especially useful in places like Daytona Beach and Volusia County.",
  whyMatters: "Florida has a high water table (often only 2–6 feet below the surface), flat terrain where gravity drainage alone often doesn’t work well, intense rainfall (2+ inches per hour during summer thunderstorms or tropical systems), and sandy soils that drain quickly but can shift or allow fine sediment to clog pipes.",
  benefits: "A properly installed French drain + sump pump system actively lowers the water table around your foundation and removes water before it can damage your home, crawl space, or slab.",
  parts: [
    {
      title: "1. French Drain (Perimeter Drain)",
      desc: "A trench is dug around the outside or inside of the foundation. It contains a perforated pipe (usually 4\"), clean gravel or crushed stone surrounding the pipe, and filter fabric wrapped around the gravel to keep sand and sediment out. Water flows into the gravel, then into the pipe, which slopes by gravity toward the sump pit.",
    },
    {
      title: "2. Sump Pump + Sump Pit",
      desc: "A waterproof basin (sump pit) is installed at the lowest point. A submersible pump sits inside. When water reaches a certain level, a float switch turns the pump on and pushes water out through a discharge pipe to a safe location away from the house (10–20+ feet to a swale, storm drain, or lower area). Many systems include a check valve and battery backup for power outages.",
    },
  ],
  howItWorks: [
    "Heavy rain soaks the ground around your house.",
    "Water tries to push against the foundation (hydrostatic pressure).",
    "The French drain intercepts the water in the gravel trench before it reaches the walls or slab.",
    "Water enters the perforated pipe and flows by gravity to the sump pit.",
    "Water level rises in the pit → float switch activates the pump.",
    "The pump turns on and forcefully pushes the water out the discharge pipe, far away from your foundation.",
    "Once the water level drops, the pump shuts off.",
  ],
  floridaSpecific: [
    "High water table — During the wet season (May–October), the sump pump actively removes water even when gravity alone can’t move it.",
    "Flat lots — Many homes in Daytona Beach and surrounding areas need a sump pump because there isn’t enough natural slope.",
    "Crawl spaces (very common in Florida) — Interior French drains are often installed under the crawl space floor and tied into the sump.",
    "Power outages — Hurricanes frequently knock out power. Battery backup is highly recommended.",
    "Sandy soil — Proper filter fabric is essential to prevent clogging.",
    "Discharge rules — Water must be directed to an approved location. Local stormwater rules apply.",
  ],
  protects: "Groundwater seepage, heavy rain soaking the soil, minor yard flooding near the house, musty smells and mold in crawl spaces.",
  doesNotProtect: "Major hurricane storm surge, river or street flooding above slab/crawl space, extremely prolonged rainfall that overwhelms pump capacity.",
  maintenance: [
    "Test the pump monthly (pour water into the pit).",
    "Check/replace battery backup every 2–3 years.",
    "Professional service once a year, especially before hurricane season.",
    "Keep the discharge area clear.",
    "Watch for roots or sediment buildup (common in Florida’s warm, wet environment).",
  ],
  bottomLine: "A French drain + sump pump system is like giving your house an active drainage system that fights back against Florida’s high water table and heavy rains. It won’t stop a direct hurricane flood, but it dramatically reduces the risk of foundation damage, crawl space flooding, and moisture problems that are very common in our area. Professional installation with proper sizing, filter fabric, check valves, and battery backup makes a big difference.",
};

export const CASE_STUDIES = [
  {
    id: "cs1",
    title: "Chronic Backyard Flooding",
    location: "Port Orange, FL",
    category: "Yard Drainage",
    before: IMAGES.case1Before,
    after: IMAGES.case1After,
    summary:
      "A low backyard held water for days after every storm. We installed catch basins, an exterior French drain (perforated pipe in gravel with filter fabric) and re-graded the turf. The system actively lowers the water table.",
    result: "Dry within hours of heavy rain — lawn fully restored.",
  },
  {
    id: "cs2",
    title: "Wet Crawlspace & Foundation Moisture",
    location: "Daytona Beach, FL",
    category: "Interior + Sump",
    before: IMAGES.case2Before,
    after: IMAGES.case2After,
    summary:
      "Standing water under the home threatened the foundation. An interior drain routed to a sealed sump basin with an automatic pump. A sump pump + French drain system is one of the most effective ways to protect homes here from high groundwater.",
    result: "Zero standing water through a full storm season.",
  },
  {
    id: "cs3",
    title: "Eroding Slope Behind Retaining Wall",
    location: "New Smyrna Beach, FL",
    category: "Exterior French Drain",
    before: IMAGES.case3Before,
    after: IMAGES.case3After,
    summary:
      "Runoff was undermining a retaining wall and washing out mulch beds. A hidden French drain (trench with perforated pipe in gravel + filter fabric) intercepts water uphill of the wall before it causes damage.",
    result: "Erosion stopped; planting beds thriving.",
  },
  {
    id: "cs4",
    title: "Flooded Lanai & Patio",
    location: "Sanford, FL",
    category: "Yard Drainage",
    before: IMAGES.case4Before,
    after: IMAGES.case4After,
    summary:
      "A screened lanai flooded during summer storms. Catch basins, channel drains, and a French drain + sump system carry water to a safe discharge point far from the foundation.",
    result: "Usable patio all summer, even in heavy rain.",
  },
];

export const CASE_FILTERS = ["All", "Yard Drainage", "Exterior French Drain", "Interior + Sump"];

export const TESTIMONIALS = [
  {
    quote:
      "After every storm our backyard was a swamp. FloGuard designed a drain system that actually solved it — no more standing water, and you can't even see the work.",
    name: "Marcus D.",
    location: "Port Orange, FL",
    rating: 5,
  },
  {
    quote:
      "Professional, on time, and they explained the whole French drain and sump plan in plain English. Our crawlspace has been dry ever since.",
    name: "Renee K.",
    location: "Daytona Beach, FL",
    rating: 5,
  },
  {
    quote:
      "We manage several rentals and FloGuard is our go-to for drainage. Reliable systems, clean installs, and they protect the foundation which protects our investment.",
    name: "Property Group",
    location: "Orlando Corridor",
    rating: 5,
  },
];

export const VALUES = [
  { title: "Engineered, not guessed", body: "Every system is designed for your soil, slope and water table." },
  { title: "Local & family-run", body: "Central Florida homeowners trust their neighbors, not a call center." },
  { title: "Invisible when done", body: "We restore your yard so the only thing you notice is that it's finally dry." },
  { title: "Built for Florida storms", body: "Systems sized for the real rainfall this coast throws at your home." },
];

export const ISSUE_OPTIONS = [
  "Flooded yard / standing water",
  "Wet basement or crawlspace",
  "Foundation moisture",
  "Soil erosion",
  "Flooded patio / lanai",
  "Not sure — need an assessment",
];

export const PROPERTY_TYPES = ["Single-family home", "Townhome", "Rental property", "Commercial", "Other"];

// ---- Conversational lead-scoping quiz (landing page) ----
export const QUIZ = [
  {
    id: "issues",
    type: "multi",
    q: "What's happening on your property?",
    sub: "Select everything that applies.",
    options: ISSUE_OPTIONS,
  },
  {
    id: "water_location",
    type: "multi",
    q: "Where does the water collect?",
    sub: "Select all the spots you're seeing water.",
    options: [
      "Backyard", "Front yard", "Side yard", "Driveway", "Patio or lanai",
      "Around the foundation", "Crawlspace / under the home", "Garage", "Near the AC unit",
    ],
  },
  {
    id: "water_duration",
    type: "single",
    q: "After it rains, how long does the water stick around?",
    sub: "This tells us how severe the drainage problem is.",
    options: ["Drains within an hour", "A few hours", "About a day", "Several days", "It never fully dries"],
  },
  {
    id: "frequency",
    type: "single",
    q: "How often does the flooding happen?",
    options: ["Only in heavy storms", "Every time it rains", "Seasonally (rainy season)", "It's constant"],
  },
  {
    id: "affected_size",
    type: "single",
    q: "Roughly how large is the problem area?",
    options: ["A small spot", "A section of the yard", "Most of the yard", "Multiple areas", "Not sure"],
  },
  {
    id: "existing_drainage",
    type: "multi",
    q: "Do you have any drainage in place now?",
    sub: "Select all that apply.",
    options: ["None", "Just gutters & downspouts", "An old French drain", "A sump pump", "A catch basin", "Not sure"],
  },
  {
    id: "damages",
    type: "multi",
    q: "Noticed any of these signs of damage?",
    sub: "Select all that apply.",
    options: [
      "Foundation cracks or moisture", "Mold or musty smell", "Dead grass or erosion",
      "Water inside the home", "Damaged patio or driveway", "None yet",
    ],
  },
  {
    id: "timeline",
    type: "single",
    q: "How soon do you want this solved?",
    options: ["ASAP — it's urgent", "Within the next month", "1–3 months", "Just researching"],
  },
  {
    id: "property_type",
    type: "single",
    q: "What type of property is it?",
    options: PROPERTY_TYPES,
  },
  {
    id: "location",
    type: "single",
    q: "Which area are you in?",
    options: [...SERVICE_AREAS, "Other / nearby"],
  },
  {
    id: "photos",
    type: "photos",
    q: "Show us the problem area",
    sub: "Optional — a few photos help us scope your project accurately before we arrive.",
  },
  {
    id: "contact",
    type: "contact",
    q: "Where should we send your free assessment?",
    sub: "A FloGuard specialist will reach out within 24 hours.",
  },
];

export const LANDING_FAQ = [
  { q: "Is the assessment really free?", a: "Yes. We come to your property, evaluate the water problem and give you a clear plan and quote at no cost and with no obligation." },
  { q: "How fast can you come out?", a: "We typically schedule assessments within 24 hours and prioritize urgent, active flooding situations." },
  { q: "Will my yard be torn up?", a: "No. We install beneath the surface and fully restore your landscaping — most systems are invisible once we're done." },
  { q: "Do you guarantee the work?", a: "Every FloGuard system is engineered for your soil and slope and backed by a 15-year warranty-backed design." },
  { q: "What areas do you serve?", a: "All of Central Florida — from Daytona and Port Orange through Sanford, Orlando and the surrounding communities." },
];
