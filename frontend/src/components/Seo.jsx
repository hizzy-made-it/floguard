// Per-page SEO. Every head tag (title, description, robots, googlebot, canonical, OG,
// Twitter) is written imperatively into ONE element per selector. We deliberately do NOT
// render <title>/<meta> JSX: React 19 metadata hoisting appends its own copies next to the
// static index.html shell tags and the prerendered ones, which shipped every tag twice.
// index.html keeps a homepage fallback set; this component updates those same nodes in place.
import { useLayoutEffect } from "react";
import { COMPANY } from "../data/site";
import { stripInline } from "../lib/markdownText";

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

/** <meta name|property="key" content="..."> — exactly one per key. */
function setMeta(attr, key, content) {
  upsertHeadTag(
    `meta[${attr}="${key}"]`,
    () => {
      const n = document.createElement("meta");
      n.setAttribute(attr, key);
      return n;
    },
    { content }
  );
}

function setTitle(title) {
  const titles = Array.from(document.head.querySelectorAll("title"));
  let el = titles[titles.length - 1];
  if (!el) {
    el = document.createElement("title");
    document.head.appendChild(el);
  }
  el.textContent = title;
  titles.forEach((t) => t !== el && t.remove());
}

/**
 * @param {{ title: string, description: string, path?: string, image?: string, imageAlt?: string, type?: string, jsonLd?: object|object[], noindex?: boolean, robots?: string }} props
 */
export const Seo = ({
  title,
  description,
  path = "/",
  image,
  imageAlt,
  type = "website",
  jsonLd,
  noindex = false,
  robots,
}) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${SITE}${normalizedPath === "/" ? "/" : normalizedPath.replace(/\/$/, "")}`;
  const ogImage = absUrl(image) || `${SITE}/images/hero-poster.jpg`;
  const ogImageAlt = imageAlt || title;
  const robotsContent =
    robots || (noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1");

  const ld = jsonLd
    ? Array.isArray(jsonLd)
      ? { "@context": "https://schema.org", "@graph": jsonLd }
      : jsonLd["@context"]
        ? jsonLd
        : { "@context": "https://schema.org", ...jsonLd }
    : null;

  // Self-referential canonical + unique title/description/OG/Twitter after every route change.
  // Runs before paint, and before scripts/prerender.mjs snapshots the DOM.
  useLayoutEffect(() => {
    setTitle(title);

    upsertHeadTag('link[rel="canonical"]', () => {
      const n = document.createElement("link");
      n.setAttribute("rel", "canonical");
      return n;
    }, { href: url });

    setMeta("name", "description", description);
    setMeta("name", "robots", robotsContent);
    setMeta("name", "googlebot", robotsContent);

    setMeta("property", "og:site_name", "FloGuard, LLC");
    setMeta("property", "og:locale", "en_US");
    setMeta("property", "og:type", type);
    setMeta("property", "og:url", url);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:image", ogImage);
    setMeta("property", "og:image:alt", ogImageAlt);

    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", ogImage);

    // Drop static LocalBusiness from index.html so only React @graph emits the entity
    document.head
      .querySelectorAll('script[type="application/ld+json"][data-static-org="true"]')
      .forEach((n) => n.remove());
  }, [title, description, url, robotsContent, ogImage, ogImageAlt, type]);

  // JSON-LD is not hoisted by React (renders in place in <body>), so it hydrates cleanly
  // against the prerendered copy and never duplicates.
  return ld ? (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
  ) : null;
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
    { "@type": "City", name: "Edgewater" },
    { "@type": "City", name: "DeBary" },
    { "@type": "City", name: "Lake Mary" },
    { "@type": "City", name: "Winter Park" },
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
      name: stripInline(f.q),
      acceptedAnswer: { "@type": "Answer", text: stripInline(f.a) },
    })),
  };
}
