// Per-page SEO via React 19 document-metadata hoisting + imperative dedupe.
// SPA shells ship homepage meta in index.html; this component always wins after mount.
import { useLayoutEffect } from "react";
import { COMPANY } from "../data/site";

export const SITE = "https://floguardfl.com";
export const ORG_ID = `${SITE}/#organization`;

function absUrl(pathOrUrl) {
  if (!pathOrUrl) return undefined;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  return `${SITE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** Keep a single tag per selector; update attributes; drop extras (static shell leftovers). */
function upsertHeadTag(selector, create, attrs) {
  const all = Array.from(document.head.querySelectorAll(selector));
  let el = all[all.length - 1] || null;
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null) el.removeAttribute(k);
    else el.setAttribute(k, v);
  });
  // Remove duplicates so crawlers never see homepage + page meta together
  all.forEach((node) => {
    if (node !== el) node.remove();
  });
  return el;
}

/**
 * @param {{ title: string, description: string, path?: string, image?: string, type?: string, jsonLd?: object|object[], noindex?: boolean, robots?: string }} props
 */
export const Seo = ({
  title,
  description,
  path = "/",
  image,
  type = "website",
  jsonLd,
  noindex = false,
  robots,
}) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${SITE}${normalizedPath === "/" ? "/" : normalizedPath.replace(/\/$/, "")}`;
  const ogImage = absUrl(image) || `${SITE}/images/hero-poster.jpg`;
  const robotsContent =
    robots || (noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1");

  const ld = jsonLd
    ? Array.isArray(jsonLd)
      ? { "@context": "https://schema.org", "@graph": jsonLd }
      : jsonLd["@context"]
        ? jsonLd
        : { "@context": "https://schema.org", ...jsonLd }
    : null;

  // Force self-referential canonical + unique description after every route change.
  // Static index.html always ships homepage tags; without this, audits and some crawlers
  // report every URL as a homepage duplicate.
  useLayoutEffect(() => {
    document.title = title;

    upsertHeadTag('link[rel="canonical"]', () => {
      const n = document.createElement("link");
      n.setAttribute("rel", "canonical");
      return n;
    }, { href: url });

    upsertHeadTag('meta[name="description"]', () => {
      const n = document.createElement("meta");
      n.setAttribute("name", "description");
      return n;
    }, { content: description });

    upsertHeadTag('meta[name="robots"]', () => {
      const n = document.createElement("meta");
      n.setAttribute("name", "robots");
      return n;
    }, { content: robotsContent });

    upsertHeadTag('meta[property="og:url"]', () => {
      const n = document.createElement("meta");
      n.setAttribute("property", "og:url");
      return n;
    }, { content: url });

    upsertHeadTag('meta[property="og:title"]', () => {
      const n = document.createElement("meta");
      n.setAttribute("property", "og:title");
      return n;
    }, { content: title });

    upsertHeadTag('meta[property="og:description"]', () => {
      const n = document.createElement("meta");
      n.setAttribute("property", "og:description");
      return n;
    }, { content: description });

    upsertHeadTag('meta[property="og:image"]', () => {
      const n = document.createElement("meta");
      n.setAttribute("property", "og:image");
      return n;
    }, { content: ogImage });

    // Drop static LocalBusiness from index.html so only React @graph emits the entity
    document.head
      .querySelectorAll('script[type="application/ld+json"][data-static-org="true"]')
      .forEach((n) => n.remove());
  }, [title, description, url, robotsContent, ogImage]);

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={robotsContent} />
      <meta name="googlebot" content={robotsContent} />
      <link rel="canonical" href={url} />
      <meta property="og:site_name" content="FloGuard, LLC" />
      <meta property="og:locale" content="en_US" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      {ld && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      )}
    </>
  );
};

/** Shared business entity — emit once per page via @graph only */
export const organizationLd = {
  "@type": "HomeAndConstructionBusiness",
  "@id": ORG_ID,
  name: "FloGuard, LLC",
  legalName: "FloGuard, LLC",
  url: SITE,
  telephone: "+13862590023",
  email: "sales@floguardfl.com",
  logo: {
    "@type": "ImageObject",
    url: `${SITE}/images/logo-schema.png`,
    width: 448,
    height: 448,
    contentUrl: `${SITE}/images/logo-schema.png`,
  },
  image: [`${SITE}/images/logo-schema.png`, `${SITE}/images/hero-poster.jpg`],
  description:
    "Residential French drain and sump pump contractor serving Central Florida — Port Orange, Daytona Beach, Sanford, Orlando corridor.",
  address: {
    "@type": "PostalAddress",
    streetAddress: "5114 S Ridgewood Ave",
    addressLocality: "Port Orange",
    addressRegion: "FL",
    postalCode: "32127",
    addressCountry: "US",
  },
  // Nominatim: 5114 S Ridgewood Ave, Port Orange, FL 32127
  geo: {
    "@type": "GeoCoordinates",
    latitude: 29.1288,
    longitude: -80.9802,
  },
  areaServed: [
    { "@type": "City", name: "Port Orange" },
    { "@type": "City", name: "Daytona Beach" },
    { "@type": "City", name: "Ormond Beach" },
    { "@type": "City", name: "New Smyrna Beach" },
    { "@type": "City", name: "DeLand" },
    { "@type": "City", name: "Deltona" },
    { "@type": "City", name: "Sanford" },
    { "@type": "City", name: "Orlando" },
    { "@type": "AdministrativeArea", name: "Volusia County" },
  ],
  priceRange: "$$",
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:00",
      closes: "17:00",
    },
  ],
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Drainage services",
    itemListElement: [
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "French drain installation", serviceType: "French drain installation", url: `${SITE}/services/french-drains`, provider: { "@id": ORG_ID } } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Sump pump installation", serviceType: "Sump pump installation", url: `${SITE}/services/sump-pumps`, provider: { "@id": ORG_ID } } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Yard drainage and grading", serviceType: "Yard drainage and grading", url: `${SITE}/services/yard-drainage`, provider: { "@id": ORG_ID } } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Sump pump maintenance and monitoring", serviceType: "Pump maintenance", url: `${SITE}/services/pump-maintenance`, provider: { "@id": ORG_ID } } },
    ],
  },
  sameAs: COMPANY.sameAs || [],
  // NOTE (Google review-snippet policy, updated 2026-07-24): a business may NOT mark up
  // aggregateRating/review for itself — pages using LocalBusiness/Organization types with
  // self-controlled reviews are ineligible for stars and risk a structured-data manual
  // action. Star claims stay in visible page text only. Do not re-add aggregateRating.
};

/**
 * BreadcrumbList for deep pages.
 * @param {{ name: string, path: string }[]} items
 */
export function breadcrumbListLd(items = []) {
  if (!items?.length) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absUrl(item.path) || item.path,
    })),
  };
}

export function faqPageLd(faqs = []) {
  if (!faqs?.length) return null;
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
