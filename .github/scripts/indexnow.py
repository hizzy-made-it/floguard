"""Validate FloGuard's served sitemap; submit its canonical URLs to IndexNow."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

HOST = "floguardfl.com"
ORIGIN = f"https://{HOST}"
NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
PUBLIC = Path(__file__).resolve().parents[2] / "frontend" / "public"


def key_from(directory):
    keys = [p for p in directory.glob("*.txt") if re.fullmatch(r"[a-f0-9]{32}", p.stem)]
    if len(keys) != 1 or keys[0].read_text(encoding="utf-8").strip() != keys[0].stem:
        raise ValueError("Expected exactly one correctly named public IndexNow key file")
    return keys[0].stem


def sitemap_urls(xml):
    root = ET.fromstring(xml)
    if root.tag != NS + "urlset":
        raise ValueError("Expected a namespaced sitemap urlset")
    urls = [(row.findtext(NS + "loc") or "").strip() for row in root.findall(NS + "url")]
    if not 1 <= len(urls) <= 10_000 or len(urls) != len(set(urls)):
        raise ValueError("Sitemap must contain 1–10,000 unique URLs")
    for url in urls:
        part = urlsplit(url)
        if (part.scheme, part.netloc) != ("https", HOST) or not part.path.startswith("/") or part.query or part.fragment or (part.path != "/" and part.path.endswith("/")):
            raise ValueError(f"Noncanonical sitemap URL: {url!r}")
    return urls


class Metadata(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.canonicals = []
        self.noindex = False
        self.obfuscated_links = 0
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if tag == "link" and props.get("rel") == "canonical":
            self.canonicals.append(props.get("href"))
        if tag == "meta" and props.get("name", "").lower() in {"robots", "googlebot", "bingbot"}:
            self.noindex |= "noindex" in props.get("content", "").lower()
        if tag == "a" and "/cdn-cgi/l/email-protection" in props.get("href", ""):
            self.obfuscated_links += 1


def request(url, payload=None):
    headers = {"User-Agent": "FloGuard-Indexing-Check/1.0"}
    if payload is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    with urlopen(Request(url, data=payload, headers=headers), timeout=15) as response:
        if response.url != url:
            raise ValueError(f"Unexpected redirect: {url} -> {response.url}")
        return response.status, response.headers, response.read().decode("utf-8")


def validate_page(url):
    _, headers, html = request(url)
    meta = Metadata(html)
    if meta.canonicals != [url] or meta.noindex or "noindex" in headers.get("X-Robots-Tag", "").lower():
        raise ValueError(f"Invalid canonical or noindex at {url}: {meta.canonicals}")
    return meta.obfuscated_links


def check(host, key, expected, attempts, pages):
    key_url = f"{host}/{key}.txt"
    for attempt in range(attempts):
        try:
            _, headers, body = request(key_url)
            if headers.get_content_type() != "text/plain" or body.strip() != key:
                raise ValueError("IndexNow key response is not the expected plain text")
            _, _, xml = request(host + "/sitemap.xml")
            urls = sitemap_urls(xml)
            if set(urls) != set(expected):
                raise ValueError("Live sitemap URLs differ from the released sitemap")
        except (OSError, ValueError, ET.ParseError) as exc:
            if attempt + 1 == attempts:
                raise
            print(f"Production not ready ({attempt + 1}/{attempts}): {exc}", flush=True)
            time.sleep(30)
            continue
        if pages:
            with ThreadPoolExecutor(max_workers=6) as pool:
                obfuscated = sum(pool.map(validate_page, urls))
            print(f"{len(urls)} live pages: direct 200, matching canonical, indexable robots; {obfuscated} obfuscated email links.")
        return key_url, urls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempts", type=int, choices=range(1, 21), default=1)
    parser.add_argument("--pages", action="store_true", help="Also audit every sitemap page")
    parser.add_argument("--build", type=Path, help="Validate a local build without networking")
    parser.add_argument("--submit", action="store_true", help="Submit after live validation")
    args = parser.parse_args()
    key = key_from(PUBLIC)
    expected = sitemap_urls((PUBLIC / "sitemap.xml").read_text(encoding="utf-8"))
    if args.build:
        if args.submit or args.pages:
            parser.error("--build cannot be combined with --submit or --pages")
        if key_from(args.build) != key:
            raise ValueError("Built key does not match source")
        if set(sitemap_urls((args.build / "sitemap.xml").read_text(encoding="utf-8"))) != set(expected):
            raise ValueError("Built sitemap differs from source")
        for url in expected:
            route = urlsplit(url).path
            file = args.build / ("index.html" if route == "/" else route[1:] + ".html")
            html = file.read_text(encoding="utf-8")
            meta = Metadata(html)
            if meta.canonicals != [url] or meta.noindex:
                raise ValueError(f"Invalid canonical or noindex in build: {file}")
        print(f"Build contains the IndexNow key and {len(expected)} indexable pages.")
        return
    location, urls = check(ORIGIN, key, expected, args.attempts, args.pages)
    if not args.submit:
        print(f"Live IndexNow key and {len(urls)} sitemap URLs verified (no submission).")
        return
    payload = json.dumps({"host": HOST, "key": key, "keyLocation": location, "urlList": urls}).encode()
    try:
        status, _, _ = request("https://api.indexnow.org/indexnow", payload)
    except HTTPError as exc:
        raise SystemExit(f"IndexNow rejected submission: HTTP {exc.code}") from exc
    if status not in {200, 202}:
        raise SystemExit(f"Unexpected IndexNow status: HTTP {status}")
    note = "received" if status == 200 else "received, key verification pending"
    print(f"IndexNow HTTP {status}: {len(urls)} URLs {note}; indexing is not guaranteed.")


if __name__ == "__main__":
    try:
        main()
    except (URLError, OSError, ValueError, ET.ParseError) as exc:
        raise SystemExit(str(exc)) from exc
