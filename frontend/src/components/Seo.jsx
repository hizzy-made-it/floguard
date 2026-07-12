// Per-page SEO via React 19 native document-metadata hoisting.
export const SITE = "https://www.floguardfl.com";
export const ORG_ID = `${SITE}/#organization`;

function absUrl(pathOrUrl) {
  if (!pathOrUrl) return undefined;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  return `${SITE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
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
  const url = `${SITE}${path.startsWith("/") ? path : `/${path}`}`;
  const ogImage = absUrl(image) || `${SITE}/images/hero-poster.jpg`;
  const robotsContent = robots || (noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1");

  const ld = jsonLd
    ? Array.isArray(jsonLd)
      ? { "@context": "https://schema.org", "@graph": jsonLd }
      : jsonLd["@context"]
        ? jsonLd
        : { "@context": "https://schema.org", ...jsonLd }
    : null;

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

/** Shared Organization / LocalBusiness entity for graphs */
export const organizationLd = {
  "@type": "LocalBusiness",
  "@id": ORG_ID,
  name: "FloGuard, LLC",
  url: SITE,
  telephone: "+13862590023",
  image: `${SITE}/images/hero-poster.jpg`,
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
  geo: { "@type": "GeoCoordinates", latitude: 29.077, longitude: -80.966 },
  areaServed: [
    "Port Orange",
    "Daytona Beach",
    "Sanford",
    "Orlando",
    "New Smyrna Beach",
    "Ormond Beach",
    "DeLand",
    "Deltona",
    "Central Florida",
  ],
  priceRange: "$$",
  openingHours: "Mo-Fr 08:00-17:00",
};

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
