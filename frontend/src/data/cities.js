import { IMAGES } from "./site";

// High-intent local landing pages for Central Florida service areas.
export const CITIES = [
  {
    slug: "daytona-beach",
    name: "Daytona Beach",
    county: "Volusia County",
    image: "/images/crew.jpg",
    intro:
      "Coastal Daytona Beach homes face a high water table and intense summer storms. A sump pump + French drain system is one of the most effective ways to protect a home from water damage caused by heavy Florida rain and high groundwater. FloGuard designs these systems built to keep your yard dry and your foundation protected — even feet from the Atlantic.",
    deepDive:
      "Daytona Beach’s proximity to the Halifax River and Atlantic means groundwater responds quickly to rain and tidal influence. Neighborhoods from Daytona Beach Shores through Holly Hill and South Daytona often see yards that stay wet for days, salt-air wear on outdoor equipment, and crawlspaces that never fully dry. We engineer French drains with proper filter fabric for coastal sands, corrosion-aware pump selections, and battery backup recommendations for hurricane outages. Discharge paths are planned for local stormwater rules so water leaves your foundation without creating a neighbor problem. Whether you are near the beachside or inland toward Clyde Morris, the fix is property-specific — not a catalog trench.",
    problems: [
      "High water table saturating soil quickly near the coast",
      "Flooded yards and lanais after afternoon storms",
      "Salt-air corrosion demanding durable, monitored pumps",
      "Crawlspace humidity and musty odors after multi-day wet periods",
    ],
    neighborhoods: ["Daytona Beach Shores", "Ormond-by-the-Sea", "Holly Hill", "South Daytona", "Wilbur-by-the-Sea"],
    zip: "32118",
    faqs: [
      { q: "What drainage works best for coastal Daytona Beach homes?", a: "Most coastal lots need a French drain that intercepts groundwater plus a sump pump to lift water to a safe discharge — gravity alone rarely works on flat, high water table properties." },
      { q: "Do salt air and storms affect sump pumps?", a: "Yes. We specify durable components, recommend sealed basins, check valves, and battery backup so the system survives outages during tropical weather." },
      { q: "How fast can FloGuard assess a Daytona Beach property?", a: "We typically schedule free on-site assessments within 24 hours and prioritize active flooding." },
      { q: "Is French drain installation disruptive on beachside lots?", a: "We plan access carefully, restore landscaping, and leave systems invisible under the lawn when finished." },
    ],
  },
  {
    slug: "port-orange",
    name: "Port Orange",
    county: "Volusia County",
    image: "/images/french-drain.jpg",
    intro:
      "Right here in our hometown of Port Orange, flat lots and clay-heavy pockets trap water against foundations. FloGuard is your local drainage crew — we know how Port Orange properties flood and how to stop it.",
    deepDive:
      "Port Orange is FloGuard’s home base at 5114 S Ridgewood Ave. Flat terrain from Spruce Creek to Town Park and Cypress Head means water often has nowhere to go after summer downpours. Older homes can show foundation moisture and soft soil at the slab edge; newer subdivisions still pond on driveways and lanais when grading and downspouts fight each other. We design perimeter and yard systems that match Port Orange’s soils, tie downspouts into controlled paths, and use sump pumps where gravity cannot finish the job. Local knowledge matters: discharge to approved locations, respect for HOA aesthetics, and installs timed around Florida’s rainy season. When neighbors ask who fixed the swampy backyard, the answer is usually a custom French drain + sump — not a store-bought kit.",
    problems: [
      "Flat lots with no natural downhill discharge",
      "Standing water on patios, driveways and low lawns",
      "Foundation moisture in older Port Orange homes",
      "Downspouts dumping roof water into the lowest corner of the yard",
    ],
    neighborhoods: ["Cypress Head", "Sabal Creek", "Waters Edge", "Spruce Creek", "Town Park"],
    zip: "32127",
    faqs: [
      { q: "Why do Port Orange yards flood so easily?", a: "Flat lots, high water tables, and intense seasonal rain mean water sits unless you intercept and pump it to a safe discharge." },
      { q: "Are you a local Port Orange company?", a: "Yes. FloGuard is based in Port Orange and serves Volusia, Seminole, and Orange County corridors." },
      { q: "How much does a French drain cost in Port Orange?", a: "Most complete systems range roughly $4,500–$12,000 depending on scope. We give a firm number only after a free on-site assessment." },
      { q: "Can you fix standing water without wrecking my landscaping?", a: "Yes. We restore turf and beds after install so the system is underground and the yard looks continuous." },
    ],
  },
  {
    slug: "sanford",
    name: "Sanford",
    county: "Seminole County",
    image: "/images/case4-before.jpg",
    intro:
      "Near Lake Monroe, Sanford homes deal with rising groundwater and slow-draining soils. FloGuard engineers custom drainage that channels water safely away from your home and landscaping. Check our [services](/services) and [areas](/areas) for more.",
    problems: [
      "Rising groundwater near Lake Monroe and the St. Johns River",
      "Chronic standing water in historic-district yards",
      "Erosion on sloped and lakefront lots",
    ],
    neighborhoods: ["Historic Downtown Sanford", "Lake Forest", "Heathrow", "Markham Woods", "Wynwood"],
    zip: "32771",
  },
  {
    slug: "orlando",
    name: "Orlando",
    county: "Orange County",
    image: "/images/case1-after.jpg",
    intro:
      "Across the Orlando metro, heavy seasonal rain overwhelms yards and threatens foundations. FloGuard brings engineered French drain and sump pump systems to homeowners and investors throughout the region. Explore our [services](/services) for Orlando or read the [how it works](/process).",
    problems: [
      "Intense wet-season downpours overwhelming yards",
      "Rental and flip properties needing reliable drainage fixes",
      "Sandy-then-clay soils that pool water unpredictably",
    ],
    neighborhoods: ["Winter Park", "Baldwin Park", "Lake Nona", "College Park", "Dr. Phillips"],
    zip: "32801",
  },
  {
    slug: "new-smyrna-beach",
    name: "New Smyrna Beach",
    county: "Volusia County",
    image: "/images/catch-basin.jpg",
    intro:
      "New Smyrna Beach's coastal lots and high water table make drainage essential. We install discreet, durable systems that protect beach homes and inland properties alike.",
    problems: [
      "High coastal water table",
      "Runoff eroding dunes and landscaping",
      "Flooded driveways and crawlspaces",
    ],
    neighborhoods: ["Bethune Beach", "Coronado", "Venetian Bay", "Sugar Mill", "Turnbull Bay"],
    zip: "32168",
  },
  {
    slug: "ormond-beach",
    name: "Ormond Beach",
    county: "Volusia County",
    image: "/images/foundation.jpg",
    intro:
      "Ormond Beach's mature neighborhoods and riverfront lots are prone to pooling and foundation moisture. FloGuard's custom systems keep water where it belongs — away from your home.",
    problems: [
      "Riverfront and low-lying lot flooding",
      "Foundation moisture in established homes",
      "Clogged or failing legacy drainage",
    ],
    neighborhoods: ["Ormond-by-the-Sea", "Halifax Plantation", "Breakaway Trails", "Plantation Bay", "Tomoka Estates"],
    zip: "32174",
  },
  {
    slug: "deland",
    name: "DeLand",
    county: "Volusia County",
    image: "/images/landscaped.jpg",
    intro:
      "Inland DeLand's soils and seasonal rain call for smart grading and French drains. We design systems that protect historic and new homes from standing water and erosion.",
    problems: [
      "Slow-draining inland soils",
      "Standing water in large-lot yards",
      "Erosion on sloped properties",
    ],
    neighborhoods: ["Historic Downtown DeLand", "Victoria Park", "Glenwood", "Lake Winnemissett", "Cresswind"],
    zip: "32720",
  },
  {
    slug: "deltona",
    name: "Deltona",
    county: "Volusia County",
    image: "/images/sump-pump.jpg",
    intro:
      "Deltona's many lakes and flat terrain create persistent drainage challenges. A sump pump + French drain system is especially useful here because gravity drainage alone often doesn’t work well. The system actively lowers the water table around foundations using perforated pipe in gravel trenches and automatic pumps. FloGuard installs these systems sized for the region's heavy rainfall.",
    problems: [
      "Flat terrain with poor natural runoff",
      "High groundwater near Deltona's lakes",
      "Wet crawlspaces and yard flooding",
    ],
    neighborhoods: ["Deltona Lakes", "Arbor Ridge", "Saxon Woods", "Timbercrest", "Courtland Estates"],
    zip: "32725",
  },
];

export const getCity = (slug) => CITIES.find((c) => c.slug === slug);
