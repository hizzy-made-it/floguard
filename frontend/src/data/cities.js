import { IMAGES } from "./site";

// High-intent local landing pages for Central Florida service areas.
// Quality gate: each city needs unique intro + deepDive + problems + faqs (not Mad-Libs).
export const CITIES = [
  {
    slug: "daytona-beach",
    name: "Daytona Beach",
    county: "Volusia County",
    image: "/images/crew.jpg",
    intro:
      "Coastal Daytona Beach homes face a high water table and intense summer storms. A sump pump + French drain system is one of the most effective ways to protect a home from water damage caused by heavy Florida rain and high groundwater. FloGuard designs these systems to keep yards dry and foundations protected — even near the Atlantic.",
    deepDive:
      "Daytona Beach’s proximity to the Halifax River and Atlantic means groundwater responds quickly to rain and tidal influence. Neighborhoods from Daytona Beach Shores through Holly Hill and South Daytona often see yards that stay wet for days, salt-air wear on outdoor equipment, and crawlspaces that never fully dry. We engineer French drains with proper filter fabric for coastal sands, corrosion-aware pump selections, and battery backup recommendations for hurricane outages. Discharge paths follow local stormwater rules so water leaves your foundation without creating a neighbor problem.",
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
      "Port Orange is FloGuard’s home base at 5114 S Ridgewood Ave. Flat terrain from Spruce Creek to Town Park and Cypress Head means water often has nowhere to go after summer downpours. Older homes can show foundation moisture and soft soil at the slab edge; newer subdivisions still pond on driveways and lanais when grading and downspouts fight each other. We design perimeter and yard systems that match Port Orange soils, tie downspouts into controlled paths, and use sump pumps where gravity cannot finish the job.",
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
      "Near Lake Monroe and the St. Johns River, Sanford homes deal with rising groundwater and slow-draining soils. FloGuard engineers custom drainage that channels water safely away from foundations and landscaping.",
    deepDive:
      "Sanford’s lakefront and historic districts combine high seasonal water tables with clay-leaning soils that hold moisture after storms. Properties near Lake Monroe, Heathrow, and Markham Woods often report chronic backyard ponds, crawlspace dampness, and erosion on any grade change. We map groundwater influence from the St. Johns corridor, size French drains for saturated soils, and specify sump discharge that respects neighborhood drainage patterns. Historic homes may need careful access planning and interior drain options under crawlspaces.",
    problems: [
      "Rising groundwater near Lake Monroe and the St. Johns River",
      "Chronic standing water in historic-district yards",
      "Erosion on sloped and lakefront lots",
      "Damp crawlspaces in older Sanford homes",
    ],
    neighborhoods: ["Historic Downtown Sanford", "Lake Forest", "Heathrow", "Markham Woods", "Wynwood"],
    zip: "32771",
    faqs: [
      { q: "Does living near Lake Monroe change drainage design?", a: "Yes. High groundwater and lake-influenced soils often require active pumping (sump) plus French drains — not gravity-only trenches." },
      { q: "Can you work on historic Sanford homes?", a: "Yes. We plan access carefully, protect landscaping, and can use interior crawlspace drains when exterior trenching is limited." },
      { q: "Do you serve Heathrow and Lake Forest?", a: "Yes. FloGuard serves Sanford neighborhoods including Heathrow, Lake Forest, Markham Woods, and downtown." },
      { q: "How do I know if I need a sump pump in Sanford?", a: "If water lingers after storms or the crawlspace stays damp, a free on-site assessment will confirm whether a sump is required with your French drain." },
    ],
  },
  {
    slug: "orlando",
    name: "Orlando",
    county: "Orange County",
    image: "/images/case1-after.jpg",
    intro:
      "Across the Orlando metro, heavy seasonal rain overwhelms yards and threatens foundations. FloGuard installs engineered French drain and sump pump systems for homeowners and property investors throughout the region.",
    deepDive:
      "Orlando’s wet season delivers intense short-duration storms that overwhelm sandy-then-clay soil layers. Winter Park, Baldwin Park, Lake Nona, College Park, and Dr. Phillips each have different lot grades and HOA constraints, but the pattern is similar: water piles against slabs, lanais flood, and rentals need reliable fixes that hold up under tenant turnover. We engineer systems for Florida rainfall rates, recommend battery backup for summer storms, and restore landscapes so properties stay marketable. Investors often pair drainage work with foundation protection as part of long-term asset care.",
    problems: [
      "Intense wet-season downpours overwhelming yards",
      "Rental and flip properties needing reliable drainage fixes",
      "Sandy-then-clay soils that pool water unpredictably",
      "HOA-sensitive landscaping that must look untouched after install",
    ],
    neighborhoods: ["Winter Park", "Baldwin Park", "Lake Nona", "College Park", "Dr. Phillips"],
    zip: "32801",
    faqs: [
      { q: "Do you install French drains in Orlando and Winter Park?", a: "Yes. FloGuard serves the Orlando metro including Winter Park, Baldwin Park, Lake Nona, College Park, and Dr. Phillips." },
      { q: "Is drainage worth it for investment properties?", a: "Reliable drainage protects foundations and curb appeal — critical for rentals and resale. We design systems that stay invisible after backfill." },
      { q: "How long does a typical Orlando install take?", a: "Many residential systems complete in 1–3 days depending on trench length, access, and sump requirements." },
      { q: "Can you fix a flooded lanai in Central Florida?", a: "Yes — channel drains, catch basins, and French drain/sump combinations are common fixes for lanai and patio flooding." },
    ],
  },
  {
    slug: "new-smyrna-beach",
    name: "New Smyrna Beach",
    county: "Volusia County",
    image: "/images/catch-basin.jpg",
    intro:
      "New Smyrna Beach coastal and inland lots deal with high water tables and storm runoff. FloGuard installs discreet French drain and sump systems that protect beach homes and neighborhoods from standing water.",
    deepDive:
      "From Coronado and Venetian Bay to Sugar Mill and Turnbull Bay, NSB properties sit on coastal sands with a high water table and frequent storm surge-adjacent rainfall (not the same as surge flooding into the home, but enough to saturate yards for days). Filter fabric is essential to keep sand out of perforated pipe. We also plan durable pumps and discharge that won’t undermine dunes or landscaping. Beachside access can be tight; we stage work to minimize disruption and restore finished grade cleanly.",
    problems: [
      "High coastal water table",
      "Runoff eroding landscaping and soft soils",
      "Flooded driveways and crawlspaces",
      "Sand intrusion clogging poorly built DIY drains",
    ],
    neighborhoods: ["Bethune Beach", "Coronado", "Venetian Bay", "Sugar Mill", "Turnbull Bay"],
    zip: "32168",
    faqs: [
      { q: "Why do DIY French drains fail in New Smyrna Beach sand?", a: "Without proper filter fabric and clean gravel, fine sand clogs pipe quickly. We use fabric-wrapped systems sized for coastal soils." },
      { q: "Do you serve Coronado and Venetian Bay?", a: "Yes. FloGuard serves New Smyrna Beach neighborhoods including Coronado, Venetian Bay, Sugar Mill, and Turnbull Bay." },
      { q: "Will a French drain stop beach flooding from the ocean?", a: "No. Our systems manage yard groundwater and storm soak — not ocean storm surge entering the structure." },
      { q: "Should NSB homes use battery backup sumps?", a: "Strongly recommended. Power outages often coincide with the wettest weather." },
    ],
  },
  {
    slug: "ormond-beach",
    name: "Ormond Beach",
    county: "Volusia County",
    image: "/images/foundation.jpg",
    intro:
      "Ormond Beach mature neighborhoods and riverfront lots are prone to pooling and foundation moisture. FloGuard’s custom French drain and sump systems keep water away from your home.",
    deepDive:
      "Ormond Beach mixes river-influenced low lots with established canopy neighborhoods like Halifax Plantation, Breakaway Trails, and Plantation Bay. Aging or missing drainage, compacted soils, and flat grades create foundation moisture and chronic puddles. We evaluate legacy French drains that may be clogged, then design replacements with correct slope, fabric, and sump capacity. Riverfront properties often need careful discharge planning so water moves off the structure without worsening low spots.",
    problems: [
      "Riverfront and low-lying lot flooding",
      "Foundation moisture in established homes",
      "Clogged or failing legacy drainage",
      "Standing water under mature tree canopies with compacted soil",
    ],
    neighborhoods: ["Ormond-by-the-Sea", "Halifax Plantation", "Breakaway Trails", "Plantation Bay", "Tomoka Estates"],
    zip: "32174",
    faqs: [
      { q: "Can you replace an old clogged French drain in Ormond Beach?", a: "Yes. We inspect legacy systems and redesign with proper fabric, gravel, slope, and discharge — often adding a sump where gravity failed." },
      { q: "Do you work in Halifax Plantation and Plantation Bay?", a: "Yes. FloGuard serves Ormond Beach including Halifax Plantation, Breakaway Trails, Plantation Bay, and Ormond-by-the-Sea." },
      { q: "Why is my foundation damp after rain?", a: "Hydrostatic pressure from a high water table and poor perimeter drainage is common. A free assessment maps where water is entering." },
      { q: "How soon can you schedule an assessment?", a: "Typically within 24 hours for Ormond Beach and Volusia County properties." },
    ],
  },
  {
    slug: "deland",
    name: "DeLand",
    county: "Volusia County",
    image: "/images/landscaped.jpg",
    intro:
      "Inland DeLand soils and seasonal rain call for smart grading and French drains. FloGuard designs systems that protect historic and new homes from standing water and erosion.",
    deepDive:
      "DeLand’s inland soils and larger lots can hold water after multi-day rain events. Historic downtown properties, Victoria Park, Glenwood, and Lake Winnemissett areas each need different trench layouts — especially where trees, septic setbacks, or long discharge runs matter. We combine grading corrections with subsurface French drains and sumps when lots are too flat for gravity alone. Erosion on slopes is addressed with collection points uphill of problem areas so water is captured before it undermines landscaping.",
    problems: [
      "Slow-draining inland soils",
      "Standing water in large-lot yards",
      "Erosion on sloped properties",
      "Long discharge distances on multi-acre lots",
    ],
    neighborhoods: ["Historic Downtown DeLand", "Victoria Park", "Glenwood", "Lake Winnemissett", "Cresswind"],
    zip: "32720",
    faqs: [
      { q: "Do larger DeLand lots need different drainage?", a: "Often yes — longer trenches, multiple collection points, or dual sumps may be required. Design is property-specific." },
      { q: "Can grading alone fix my yard?", a: "Sometimes for mild surface pooling. Chronic high water table or foundation moisture usually needs subsurface drains plus discharge." },
      { q: "Do you serve Victoria Park and Cresswind?", a: "Yes. FloGuard serves DeLand including Victoria Park, Glenwood, Lake Winnemissett, and Cresswind." },
      { q: "Will installation damage mature trees?", a: "We plan trench paths to respect major roots and utilities. Some routes use hand work or alternate layouts to protect canopy trees." },
    ],
  },
  {
    slug: "deltona",
    name: "Deltona",
    county: "Volusia County",
    image: "/images/sump-pump.jpg",
    intro:
      "Deltona’s many lakes and flat terrain create persistent drainage challenges. FloGuard installs French drain + sump pump systems sized for heavy rainfall when gravity alone is not enough.",
    deepDive:
      "Deltona is defined by lakes, flat grades, and subdivisions where water has few natural outlets. Neighborhoods like Deltona Lakes, Arbor Ridge, and Timbercrest often report multi-day standing water, wet crawlspaces, and pumps that run constantly after storms. We design active systems that lower the water table around foundations using fabric-lined trenches, perforated pipe, sealed sumps, and code-aware discharge. Lake-adjacent lots get special attention to groundwater levels and electrical reliability (battery backup recommended for outages).",
    problems: [
      "Flat terrain with poor natural runoff",
      "High groundwater near Deltona’s lakes",
      "Wet crawlspaces and yard flooding",
      "Existing pumps undersized for wet-season storms",
    ],
    neighborhoods: ["Deltona Lakes", "Arbor Ridge", "Saxon Woods", "Timbercrest", "Courtland Estates"],
    zip: "32725",
    faqs: [
      { q: "Why doesn’t gravity drainage work well in Deltona?", a: "Lots are often too flat and the water table too high for water to leave by slope alone — a sump provides the lift." },
      { q: "Do you install battery backup sump pumps in Deltona?", a: "Yes. We strongly recommend battery backup for hurricane and storm outages." },
      { q: "Can you fix wet crawlspaces?", a: "Yes — interior drains to a sealed sump are a common solution for Florida crawlspaces." },
      { q: "How much does a system cost in Deltona?", a: "Most complete systems fall roughly in the $4,500–$12,000 range depending on scope. Free assessments provide exact pricing." },
    ],
  },
];

export const getCity = (slug) => CITIES.find((c) => c.slug === slug);
