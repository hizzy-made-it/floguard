import { useEffect } from "react";

/**
 * Optional GA4 loader. Set REACT_APP_GA_MEASUREMENT_ID=G-XXXXXXXX in env to enable.
 * Does nothing when unset (safe for local/dev).
 */
export function Analytics() {
  useEffect(() => {
    const id = process.env.REACT_APP_GA_MEASUREMENT_ID;
    if (!id || typeof document === "undefined") return;
    if (document.getElementById("fg-ga4")) return;

    window.dataLayer = window.dataLayer || [];
    function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", id, { anonymize_ip: true });

    const s = document.createElement("script");
    s.id = "fg-ga4";
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(s);
  }, []);

  return null;
}

/** Fire a custom event when GA is present */
export function trackEvent(name, params = {}) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", name, params);
  }
}
