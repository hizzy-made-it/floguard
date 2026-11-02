// Inline markdown for content strings in src/data/* (blog bodies, list items, table cells,
// FAQ answers). Supports [label](href) links and **bold** only — enough for editorial copy,
// without pulling a markdown parser into the bundle.
//   - internal hrefs ("/services") → react-router <Link> (crawlable <a href>, SPA navigation)
//   - tel:/mailto:/sms: and http(s) hrefs → plain <a>; external ones open in a new tab
import { Fragment } from "react";
import { Link } from "react-router-dom";

const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
const LINK_CLASS = "text-brand-orange font-medium underline-offset-4 hover:underline";

/** Render a content string with inline links/bold as React nodes. */
export function renderInline(text, { linkClassName = LINK_CLASS } = {}) {
  if (typeof text !== "string" || !text) return text;
  const out = [];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${m.index}-${out.length}`;
    if (m[1] != null) {
      const label = m[1];
      const href = m[2];
      if (href.startsWith("/") && !href.startsWith("//")) {
        out.push(
          <Link key={key} to={href} className={linkClassName}>
            {label}
          </Link>
        );
      } else {
        const external = /^https?:\/\//.test(href);
        out.push(
          <a
            key={key}
            href={href}
            className={linkClassName}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {label}
          </a>
        );
      }
    } else {
      out.push(<strong key={key}>{m[3]}</strong>);
    }
    last = TOKEN.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 && typeof out[0] === "string" ? out[0] : <Fragment>{out}</Fragment>;
}

export { stripInline } from "./markdownText";
