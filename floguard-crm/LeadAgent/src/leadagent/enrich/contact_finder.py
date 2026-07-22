"""Find and normalize prospect contact fields: website, phone, email.

Used by research enrichment — works with Apify actor output and free
HTTP fetches of known (or newly discovered) websites.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

# Practical business-email patterns (skip image/css noise)
EMAIL_RE = re.compile(
    r"(?i)\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b"
)
# US-centric phones; keeps common (xxx) xxx-xxxx and 386.xxx.xxxx forms
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})(?!\d)"
)

# Domains / local-parts that are almost never usable sales contacts
_EMAIL_BLOCKLIST_DOMAINS = frozenset(
    {
        "example.com",
        "example.org",
        "sentry.io",
        "wixpress.com",
        "wordpress.com",
        "schema.org",
        "w3.org",
        "googleapis.com",
        "gstatic.com",
        "cloudflare.com",
        "jquery.com",
        "github.com",
        "gravatar.com",
        "placeholder.com",
        "email.com",
        "domain.com",
        "yourdomain.com",
        "sentry.wixpress.com",
    }
)
_EMAIL_BLOCKLIST_LOCAL = frozenset(
    {
        "noreply",
        "no-reply",
        "donotreply",
        "do-not-reply",
        "mailer-daemon",
        "postmaster",
        "webmaster",
        "hostmaster",
        "abuse",
        "privacy",
        "legal",
        "support+noreply",
    }
)
_EMAIL_FILE_EXTS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".css",
    ".js",
    ".woff",
    ".woff2",
)

_USER_AGENT = (
    "Mozilla/5.0 (compatible; FloGuardLeadAgent/0.1; +https://floguardfl.com)"
)


def normalize_website(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    low = raw.lower()
    if low in ("none", "n/a", "na", "facebook", "fb only", "-", "null"):
        return ""
    if low.startswith("facebook.com") or "facebook.com/" in low:
        # Treat bare Facebook pages as social, not a real website sale target
        if "facebook.com" in low and not any(
            x in low for x in (".com/p/",)  # keep as-is if weird
        ):
            pass
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw.lstrip("/")
    try:
        parsed = urlparse(raw)
        if not parsed.netloc:
            return ""
        # Drop trailing slash noise for storage consistency
        path = parsed.path.rstrip("/") or ""
        cleaned = f"{parsed.scheme}://{parsed.netloc}{path}"
        if parsed.query:
            cleaned += f"?{parsed.query}"
        return cleaned
    except Exception:
        return raw


def is_usable_website(url: str) -> bool:
    n = normalize_website(url)
    if not n:
        return False
    low = n.lower()
    if any(
        x in low
        for x in (
            "facebook.com",
            "fb.com",
            "instagram.com",
            "yelp.com",
            "maps.google",
            "goo.gl/maps",
            "linktr.ee",
        )
    ):
        return False
    return True


def normalize_phone(phone: str) -> str:
    raw = (phone or "").strip()
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("1") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) == 10:
        # NANP: area code and exchange cannot start with 0 or 1
        if digits[0] in "01" or digits[3] in "01":
            return ""
        return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"
    # Keep original if international / odd length but still phone-like
    if 7 <= len(digits) <= 15:
        return raw
    return ""


def is_plausible_email(email: str) -> bool:
    e = (email or "").strip().lower()
    if not e or "@" not in e:
        return False
    if any(e.endswith(ext) for ext in _EMAIL_FILE_EXTS):
        return False
    local, _, domain = e.partition("@")
    if not local or not domain or "." not in domain:
        return False
    if domain in _EMAIL_BLOCKLIST_DOMAINS:
        return False
    if local in _EMAIL_BLOCKLIST_LOCAL:
        return False
    if local.startswith("noreply") or local.startswith("no-reply"):
        return False
    # Skip pure numeric / hex tokens that look like tracking
    if re.fullmatch(r"[0-9a-f]{16,}", local):
        return False
    return True


def extract_emails(text: str) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for m in EMAIL_RE.finditer(text):
        e = m.group(1).strip().lower().rstrip(".,;:)>\"'")
        if not is_plausible_email(e):
            continue
        if e not in seen:
            seen.add(e)
            found.append(e)
    return found


def extract_phones(text: str) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for m in PHONE_RE.finditer(text):
        n = normalize_phone(m.group(0))
        if not n:
            continue
        key = re.sub(r"\D", "", n)
        if key not in seen:
            seen.add(key)
            found.append(n)
    return found


def _mailto_emails(html: str) -> list[str]:
    if not html:
        return []
    out: list[str] = []
    for m in re.finditer(r"(?i)mailto:([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})", html):
        e = m.group(1).strip().lower()
        if is_plausible_email(e):
            out.append(e)
    return out


def _tel_phones(html: str) -> list[str]:
    if not html:
        return []
    out: list[str] = []
    for m in re.finditer(r"(?i)tel:([+\d\s().\-]{7,20})", html):
        n = normalize_phone(m.group(1))
        if n:
            out.append(n)
    return out


def extract_contacts_from_text(text: str) -> dict[str, list[str]]:
    emails = extract_emails(text)
    phones = extract_phones(text)
    # Prefer mailto/tel when present in same blob
    for e in _mailto_emails(text):
        if e not in emails:
            emails.insert(0, e)
    for p in _tel_phones(text):
        digits = re.sub(r"\D", "", p)
        if not any(re.sub(r"\D", "", x) == digits for x in phones):
            phones.insert(0, p)
    return {"emails": emails, "phones": phones}


def fetch_url_text(url: str, *, timeout: float = 15.0) -> str:
    """Fetch a page and return text (HTML body). Empty string on failure."""
    target = normalize_website(url)
    if not target:
        return ""
    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        ) as client:
            r = client.get(target)
            if r.status_code >= 400:
                return ""
            ctype = (r.headers.get("content-type") or "").lower()
            if "html" not in ctype and "text" not in ctype and ctype:
                return ""
            return r.text or ""
    except Exception:
        return ""


def _contact_path_candidates(base_url: str) -> list[str]:
    base = normalize_website(base_url)
    if not base:
        return []
    paths = [
        "",
        "/contact",
        "/contact-us",
        "/contactus",
        "/about",
        "/about-us",
        "/locations",
    ]
    urls: list[str] = []
    for p in paths:
        u = urljoin(base.rstrip("/") + "/", p.lstrip("/")) if p else base
        if u not in urls:
            urls.append(u)
    return urls


def scrape_website_contacts(
    website: str,
    *,
    max_pages: int = 4,
    timeout: float = 12.0,
) -> dict[str, Any]:
    """
    Fetch homepage + common contact paths; extract emails and phones.
    Returns {emails, phones, pages_checked, source_url}.
    """
    emails: list[str] = []
    phones: list[str] = []
    seen_e: set[str] = set()
    seen_p: set[str] = set()
    pages = 0
    source = ""

    for url in _contact_path_candidates(website)[:max_pages]:
        html = fetch_url_text(url, timeout=timeout)
        if not html:
            continue
        pages += 1
        contacts = extract_contacts_from_text(html)
        for e in contacts["emails"]:
            if e not in seen_e:
                seen_e.add(e)
                emails.append(e)
                if not source:
                    source = url
        for p in contacts["phones"]:
            key = re.sub(r"\D", "", p)
            if key not in seen_p:
                seen_p.add(key)
                phones.append(p)
                if not source:
                    source = url
        # Early exit once we have both
        if emails and phones:
            break

    return {
        "emails": emails,
        "phones": phones,
        "pages_checked": pages,
        "source_url": source,
    }


def discover_website_via_search(
    business_name: str,
    city: str = "",
    *,
    timeout: float = 12.0,
) -> str:
    """
    Best-effort free website discovery via DuckDuckGo HTML results.
    Returns normalized website URL or empty string.
    """
    name = (business_name or "").strip()
    if not name:
        return ""
    q = f"{name} {city} official website".strip()
    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        ) as client:
            r = client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": q},
            )
            if r.status_code >= 400:
                return ""
            html = r.text or ""
    except Exception:
        return ""

    # DuckDuckGo result links: uddg= encoded URL or plain result__url
    candidates: list[str] = []
    for m in re.finditer(
        r'(?:uddg=|class="result__url"[^>]*>)([^"&\s<]+)',
        html,
        flags=re.I,
    ):
        raw = m.group(1)
        try:
            from urllib.parse import unquote

            raw = unquote(raw)
        except Exception:
            pass
        if not raw.startswith("http"):
            if "." in raw and " " not in raw:
                raw = "https://" + raw
            else:
                continue
        candidates.append(raw)

    # Also catch plain https hrefs in results
    for m in re.finditer(r'href="(https?://[^"]+)"', html):
        candidates.append(m.group(1))

    block = (
        "duckduckgo.com",
        "google.com",
        "bing.com",
        "yelp.com",
        "facebook.com",
        "instagram.com",
        "tripadvisor.com",
        "yellowpages.com",
        "bbb.org",
        "wikipedia.org",
        "mapquest.com",
        "apple.com",
        "play.google",
    )
    name_tokens = [t.lower() for t in re.findall(r"[a-z0-9]+", name.lower()) if len(t) > 2][
        :4
    ]

    ranked: list[tuple[int, str]] = []
    seen: set[str] = set()
    for c in candidates:
        n = normalize_website(c)
        if not n or not is_usable_website(n):
            continue
        host = urlparse(n).netloc.lower().removeprefix("www.")
        if any(b in host for b in block):
            continue
        if host in seen:
            continue
        seen.add(host)
        score = 0
        for t in name_tokens:
            if t in host:
                score += 3
        if city and city.lower().split()[0] in host:
            score += 1
        ranked.append((score, n))

    if not ranked:
        return ""
    ranked.sort(key=lambda x: (-x[0], x[1]))
    # Prefer a name-matching host when available
    if ranked[0][0] > 0:
        return ranked[0][1]
    return ranked[0][1]


def contacts_from_apify_items(items: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Merge website / phone / emails from heterogeneous Apify actor payloads
    (Google Maps, website crawler, contact-info scraper, etc.).
    """
    emails: list[str] = []
    phones: list[str] = []
    websites: list[str] = []
    address = ""
    rating = ""
    category = ""
    review_themes: list[str] = []
    seen_e: set[str] = set()
    seen_p: set[str] = set()
    seen_w: set[str] = set()

    def _add_email(v: Any) -> None:
        if not v:
            return
        if isinstance(v, list):
            for x in v:
                _add_email(x)
            return
        e = str(v).strip().lower()
        if is_plausible_email(e) and e not in seen_e:
            seen_e.add(e)
            emails.append(e)

    def _add_phone(v: Any) -> None:
        if not v:
            return
        if isinstance(v, list):
            for x in v:
                _add_phone(x)
            return
        n = normalize_phone(str(v))
        if not n:
            return
        key = re.sub(r"\D", "", n)
        if key not in seen_p:
            seen_p.add(key)
            phones.append(n)

    def _add_website(v: Any) -> None:
        if not v:
            return
        if isinstance(v, list):
            for x in v:
                _add_website(x)
            return
        if isinstance(v, dict):
            _add_website(v.get("url") or v.get("href"))
            return
        n = normalize_website(str(v))
        if n and n not in seen_w:
            seen_w.add(n)
            websites.append(n)

    for item in items:
        if not isinstance(item, dict):
            continue
        _add_phone(item.get("phone") or item.get("phoneNumber") or item.get("telephone"))
        _add_website(
            item.get("website")
            or item.get("websiteUrl")
            or item.get("url")
            or item.get("domain")
        )
        _add_email(item.get("email") or item.get("emails") or item.get("mail"))
        # contact-info scraper variants
        for key in ("emails", "phones", "phoneNumbers", "mobile"):
            if key in item:
                if "mail" in key.lower() or key == "emails":
                    _add_email(item[key])
                else:
                    _add_phone(item[key])
        # Nested contact objects
        contact = item.get("contact") or item.get("contacts")
        if isinstance(contact, dict):
            _add_email(contact.get("email") or contact.get("emails"))
            _add_phone(contact.get("phone") or contact.get("phoneNumber"))
            _add_website(contact.get("website") or contact.get("url"))
        elif isinstance(contact, list):
            for c in contact:
                if isinstance(c, dict):
                    _add_email(c.get("email"))
                    _add_phone(c.get("phone"))

        # Website crawler text fields
        for text_key in ("text", "markdown", "html", "content", "pageContent"):
            blob = item.get(text_key)
            if isinstance(blob, str) and len(blob) > 20:
                extracted = extract_contacts_from_text(blob)
                for e in extracted["emails"]:
                    _add_email(e)
                for p in extracted["phones"]:
                    _add_phone(p)

        if not address and item.get("address"):
            address = str(item["address"])
        elif not address and item.get("location"):
            loc = item["location"]
            if isinstance(loc, dict):
                address = str(loc.get("address") or loc.get("formatted") or "")
            else:
                address = str(loc)
        if not rating and (item.get("totalScore") is not None or item.get("rating") is not None):
            rating = str(item.get("totalScore") if item.get("totalScore") is not None else item.get("rating"))
        cats = item.get("categories") or item.get("categoryName") or item.get("category")
        if cats and not category:
            category = str(cats if isinstance(cats, str) else cats[0])
        # Review snippets → light themes
        for rev_key in ("reviews", "reviewsDistribution", "placeReviews"):
            revs = item.get(rev_key)
            if isinstance(revs, list):
                for rev in revs[:5]:
                    if isinstance(rev, dict):
                        t = (rev.get("text") or rev.get("snippet") or "")[:120]
                        if t:
                            review_themes.append(t)
                    elif isinstance(rev, str):
                        review_themes.append(rev[:120])

    # Prefer real websites over social in ordering
    websites_sorted = sorted(
        websites, key=lambda w: (0 if is_usable_website(w) else 1, w)
    )

    return {
        "emails": emails,
        "phones": phones,
        "websites": websites_sorted,
        "address": address,
        "rating": rating,
        "category": category,
        "review_themes": review_themes[:5],
    }
