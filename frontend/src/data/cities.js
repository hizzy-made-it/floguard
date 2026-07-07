import { IMAGES } from "./site";

// High-intent local landing pages for Central Florida service areas.
export const CITIES = [
  {
    slug: "daytona-beach",
    name: "Daytona Beach",
    county: "Volusia County",
    image: IMAGES.storm,
    intro:
      "Coastal Daytona Beach homes face a high water table and intense summer storms. FloGuard designs French drain and sump pump systems built to keep your yard dry and your foundation protected — even feet from the Atlantic.",
    problems: [
      "High water table saturating soil quickly near the coast",
      "Flooded yards and lanais after afternoon storms",
      "Salt-air corrosion demanding durable, monitored pumps",
    ],
    neighborhoods: ["Daytona Beach Shores", "Ormond-by-the-Sea", "Holly Hill", "South Daytona", "Wilbur-by-the-Sea"],
    zip: "32118",
  },
  {
    slug: "port-orange",
    name: "Port Orange",
    county: "Volusia County",
    image: IMAGES.frenchDrain,
    intro:
      "Right here in our hometown of Port Orange, flat lots and clay-heavy soil trap water against foundations. As your local drainage crew, we know exactly how Port Orange properties flood — and how to stop it.",
    problems: [
      "Flat lots with no natural downhill discharge",
      "Standing water on patios, driveways and low lawns",
      "Foundation moisture in older Port Orange homes",
    ],
    neighborhoods: ["Cypress Head", "Sabal Creek", "Waters Edge", "Spruce Creek", "Town Park"],
    zip: "32127",
  },
  {
    slug: "sanford",
    name: "Sanford",
    county: "Seminole County",
    image: IMAGES.beforeFlooded,
    intro:
      "Near Lake Monroe, Sanford homes deal with rising groundwater and slow-draining soils. FloGuard engineers custom drainage that channels water safely away from your home and landscaping.",
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
    image: IMAGES.afterDry,
    intro:
      "Across the Orlando metro, heavy seasonal rain overwhelms yards and threatens foundations. FloGuard brings engineered French drain and sump pump systems to homeowners and investors throughout the region.",
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
    image: IMAGES.catchBasin,
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
    image: IMAGES.foundation,
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
    image: IMAGES.diagram,
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
    image: IMAGES.sumpPump,
    intro:
      "Deltona's many lakes and flat terrain create persistent drainage challenges. FloGuard installs French drain and sump pump systems sized for the region's heavy rainfall.",
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
