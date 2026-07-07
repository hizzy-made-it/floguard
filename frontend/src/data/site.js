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
  logo: "https://customer-assets.emergentagent.com/job_171d6f38-0b46-45ff-9e6c-f9747eec3455/artifacts/rks20kgd_image.png",
  logoAlt:
    "https://customer-assets.emergentagent.com/job_171d6f38-0b46-45ff-9e6c-f9747eec3455/artifacts/s0lwckrx_image.png",
  storm:
    "https://customer-assets.emergentagent.com/job_171d6f38-0b46-45ff-9e6c-f9747eec3455/artifacts/2kpa208u_image.png",
  diagram:
    "https://customer-assets.emergentagent.com/job_171d6f38-0b46-45ff-9e6c-f9747eec3455/artifacts/raba3tpe_image.png",
  crew:
    "https://customer-assets.emergentagent.com/job_171d6f38-0b46-45ff-9e6c-f9747eec3455/artifacts/ehy3alqa_image.png",
  beforeFlooded:
    "https://static.prod-images.emergentagent.com/jobs/171d6f38-0b46-45ff-9e6c-f9747eec3455/images/aca0cebc3026500817ffec8887d4139bd286b6061b806447e1cadfa3432790c3.png",
  afterDry:
    "https://static.prod-images.emergentagent.com/jobs/171d6f38-0b46-45ff-9e6c-f9747eec3455/images/32ba8bced66d063652eb8d61fa4709e5be26a6049cea97579b69424656c7f83e.png",
  frenchDrain:
    "https://static.prod-images.emergentagent.com/jobs/171d6f38-0b46-45ff-9e6c-f9747eec3455/images/0a99594e0710576b965a69c17eead7f48f364e0a93c71c40ec43d24609bafceb.png",
  sumpPump:
    "https://static.prod-images.emergentagent.com/jobs/171d6f38-0b46-45ff-9e6c-f9747eec3455/images/aa9413f2caa5bc6539c7ebffd1d2d9c0e533c5c63780fee501a4d78532e6362b.png",
  catchBasin:
    "https://static.prod-images.emergentagent.com/jobs/171d6f38-0b46-45ff-9e6c-f9747eec3455/images/4d486eab3a005e5ad287d4185b02e4f96ab33ebec20c4cdb36407577a44d7017.png",
  foundation:
    "https://static.prod-images.emergentagent.com/jobs/171d6f38-0b46-45ff-9e6c-f9747eec3455/images/8e843fbb01660c9f2238aaa807dd3be29ffef13413ff7f1beca5176a5fde23df.png",
  landscaped:
    "https://images.pexels.com/photos/17897581/pexels-photo-17897581.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
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
  { value: 100, suffix: "+", label: "Yards protected across Central Florida" },
  { value: 5.0, suffix: "★", label: "Average Google review rating", decimals: 1 },
  { value: 24, suffix: "hr", label: "Typical response for assessments" },
  { value: 15, suffix: "yr", label: "Warranty-backed system designs" },
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
      "Perimeter trench systems that intercept surface runoff and groundwater before it reaches your foundation or pools on the lawn.",
    image: IMAGES.frenchDrain,
    features: ["Custom trench + slope design", "Filter fabric + clean gravel", "Perforated collection pipe"],
    span: "wide",
  },
  {
    id: "interior",
    title: "Interior Drains + Sump Pumps",
    blurb:
      "For crawlspaces and low, flat lots: a sub-surface drain routed to a sump basin that automatically lifts water to a safe discharge.",
    image: IMAGES.sumpPump,
    features: ["Automatic float-switch pumps", "Sealed basin + discharge line", "Battery / monitoring options"],
    span: "tall",
  },
  {
    id: "yard",
    title: "Yard Drainage & Grading",
    blurb:
      "Catch basins, channel drains and precision grading that move water off patios, lanais and low spots without eroding your landscape.",
    image: IMAGES.catchBasin,
    features: ["Catch basins & channel drains", "Re-grading & swales", "Downspout tie-ins"],
    span: "tall",
  },
  {
    id: "maintenance",
    title: "Pump Maintenance & Monitoring",
    blurb:
      "Seasonal service plans and smart monitoring that keep your system storm-ready year round — so it works the day you need it most.",
    image: IMAGES.foundation,
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
  { label: "Gravel Trench", desc: "Water filters through fabric-lined gravel into the system." },
  { label: "Perforated Pipe", desc: "A buried pipe captures water and carries it by gravity." },
  { label: "Sump Basin", desc: "On flat lots, water gathers in a basin with an automatic pump." },
  { label: "Safe Discharge", desc: "The pump pushes water far from your foundation — dry and safe." },
];

export const CASE_STUDIES = [
  {
    id: "cs1",
    title: "Chronic Backyard Flooding",
    location: "Port Orange, FL",
    category: "Yard Drainage",
    before: IMAGES.beforeFlooded,
    after: IMAGES.afterDry,
    summary:
      "A low backyard held water for days after every storm. We installed catch basins, an exterior French drain and re-graded the turf.",
    result: "Dry within hours of heavy rain — lawn fully restored.",
  },
  {
    id: "cs2",
    title: "Wet Crawlspace & Foundation Moisture",
    location: "Daytona Beach, FL",
    category: "Interior + Sump",
    before: IMAGES.foundation,
    after: IMAGES.sumpPump,
    summary:
      "Standing water under the home threatened the foundation. An interior drain routed to a sealed sump basin with an automatic pump.",
    result: "Zero standing water through a full storm season.",
  },
  {
    id: "cs3",
    title: "Eroding Slope Behind Retaining Wall",
    location: "New Smyrna Beach, FL",
    category: "Exterior French Drain",
    before: IMAGES.frenchDrain,
    after: IMAGES.landscaped,
    summary:
      "Runoff was undermining a retaining wall and washing out mulch beds. A hidden French drain intercepts water uphill of the wall.",
    result: "Erosion stopped; planting beds thriving.",
  },
  {
    id: "cs4",
    title: "Flooded Lanai & Patio",
    location: "Sanford, FL",
    category: "Yard Drainage",
    before: IMAGES.storm,
    after: IMAGES.afterDry,
    summary:
      "A screened lanai flooded during summer storms. Channel drains and a discharge line now carry water to a safe swale.",
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
