"""Render Sales Docs/*.md into branded print PDFs -> Sales Docs/pdf/.

Design: retro-Florida field spec-sheets matched to the FloGuard logo —
cream masthead plate (#F0E8C3, sampled from logo.png), Oswald condensed
display, Barlow body, IBM Plex Mono utility, navy waterline signature.

Run (uses LeadAgent's venv for playwright + its installed chromium):
    LeadAgent\\.venv\\Scripts\\python.exe scripts\\build_sales_pdfs.py
Then: npm run sync-docs   (catalogs the PDFs into public/crm/docs/)

Google Fonts load at build time; system fallbacks apply offline.
"""

from __future__ import annotations

import base64
import html as html_mod
import re
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "Sales Docs"
OUT = SRC / "pdf"
LOGO = ROOT / "public" / "crm" / "logo.png"

# Keep in sync with scripts/sync-sales-docs.mjs MANIFEST
DOCS = [
    ("FloGuard_Drainage_Sales_Playbook.md", "Drainage Sales Playbook", "Playbook",
     "The consultative cold-selling system: ROI reframe, triggers, assumptive close, real urgency, category discipline."),
    ("FloGuard_Pricing_and_Offers.md", "Pricing & Offers (SSOT)", "Pricing",
     "The single source of truth for what reps may quote — the $4,500–$12,000 band, proof points, and the never-quote list."),
    ("FloGuard_Call_Scripts.md", "Call Scripts", "Scripts",
     "First-call openers, sump/maintenance/B2B variants, voicemail, follow-up text, and the never-say list."),
    ("FloGuard_Objection_Encyclopedia.md", "Objection Encyclopedia", "Scripts",
     "Validate → reframe → proof → assessment close, for every objection."),
    ("FloGuard_System_Explainer.md", "How the System Works", "Product",
     "Florida water physics, the five-step water path, what the system does and does NOT protect against."),
    ("FloGuard_Quiz_Lead_Reading_Guide.md", "Quiz Lead Reading Guide", "Leads",
     "How to read floguardfl.com quiz submissions as pre-done discovery and dial with speed."),
    ("DRAINAGE-NEED-SCORE.md", "Drainage Need Score (DNS)", "Leads",
     "0–100 sales-urgency score: wire format, scoring model, grades/bands, talk tracks."),
]

# Sections that are prohibitions get the navy HARD RULE treatment
HARD_RULE_HEADING = re.compile(
    r"(never say|never claim|not confirmed|do-not-call|does not protect)", re.I
)

E = html_mod.escape


def _inline(text: str) -> str:
    """Inline markdown: bold, code, CONFIRM chips. Escapes first."""
    s = E(text, quote=False)
    s = re.sub(
        r"\*\*\[CONFIRM WITH OWNER:?\s*(.*?)\]\*\*|\[CONFIRM WITH OWNER:?\s*(.*?)\]",
        lambda m: (
            '<span class="confirm">CONFIRM WITH OWNER'
            + ((" — " + (m.group(1) or m.group(2))) if (m.group(1) or m.group(2)) else "")
            + "</span>"
        ),
        s,
    )
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


_SPEECH = re.compile(r'^(?:<strong>(?P<blabel>[^<]+?):?</strong>|(?P<plabel>[A-Z][A-Za-z –-]{1,28}):)?\s*(?P<rest>[“"].*)$', re.S)


def _para(text: str) -> str:
    """Paragraph — quoted rep lines become speech cards with a label eyebrow."""
    rendered = _inline(text.strip())
    m = _SPEECH.match(rendered)
    if m:
        label = m.group("blabel") or m.group("plabel") or ""
        body = m.group("rest").strip()
        return (
            '<div class="speech">'
            + (f'<div class="speech-label">{label}</div>' if label else "")
            + f"<p>{body}</p></div>"
        )
    return f"<p>{rendered}</p>"


_GRADE_CELL = re.compile(r"^[A-F]$")
_BAND_CELL = re.compile(r"^(urgent|priority|monitor)$", re.I)


def _cell(text: str, header: bool) -> str:
    tag = "th" if header else "td"
    t = text.strip()
    if not header and _GRADE_CELL.match(t):
        return f'<td class="c-grade"><span class="grade">{t}</span></td>'
    if not header and _BAND_CELL.match(t):
        b = t.lower()
        return f'<{tag}><span class="band band-{b}">{t}</span></{tag}>'
    return f"<{tag}>{_inline(t)}</{tag}>"


def md_to_sections(md: str) -> list[dict]:
    """Parse the doc into sections: {heading, num, html, hard}."""
    lines = md.replace("\r\n", "\n").split("\n")
    sections: list[dict] = [{"heading": "", "num": "", "html": [], "hard": False}]
    i = 0
    while i < len(lines):
        line = lines[i]

        if line.startswith("# "):  # H1 → masthead already carries it
            i += 1
            continue

        if line.startswith("## "):
            heading = line[3:].strip()
            num = ""
            m = re.match(r"^(\d+)\.\s+(.*)$", heading)
            if m:
                num, heading = m.group(1), m.group(2)
            sections.append({
                "heading": heading,
                "num": num,
                "html": [],
                "hard": bool(HARD_RULE_HEADING.search(heading)),
            })
            i += 1
            continue

        out = sections[-1]["html"]

        if line.startswith("```"):
            block: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            out.append('<pre class="wire">' + E("\n".join(block)) + "</pre>")
            continue

        if line.startswith("|"):
            rows: list[str] = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            body_rows: list[str] = []
            header_cells: list[str] = []
            for ri, row in enumerate(rows):
                if re.match(r"^\|[\s:|-]+\|$", row):
                    continue
                cells = [c for c in row.strip().strip("|").split("|")]
                if ri == 0:
                    header_cells = [_cell(c, True) for c in cells]
                else:
                    body_rows.append("<tr>" + "".join(_cell(c, False) for c in cells) + "</tr>")
            out.append(
                "<table><thead><tr>" + "".join(header_cells) + "</tr></thead>"
                + "<tbody>" + "".join(body_rows) + "</tbody></table>"
            )
            continue

        if line.startswith("> "):
            quote: list[str] = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(lines[i].lstrip("> "))
                i += 1
            out.append('<div class="plate">' + _inline(" ".join(quote)) + "</div>")
            continue

        if re.match(r"^[-*]\s+", line):
            items: list[str] = []
            while i < len(lines) and re.match(r"^[-*]\s+", lines[i]):
                items.append("<li>" + _inline(re.sub(r"^[-*]\s+", "", lines[i])) + "</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            continue

        if re.match(r"^\d+\.\s+", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i]):
                items.append("<li>" + _inline(re.sub(r"^\d+\.\s+", "", lines[i])) + "</li>")
                i += 1
            out.append('<ol class="steps">' + "".join(items) + "</ol>")
            continue

        if not line.strip():
            i += 1
            continue

        # Paragraph: gather until blank/structural line, then segment so each
        # labelled utterance (`Reframe: "..."` / `**Opener:**` + quote) becomes
        # its own speech card instead of merging with its neighbours.
        para: list[str] = []
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#|\||>|```|[-*]\s|\d+\.\s)", lines[i]
        ):
            para.append(lines[i].strip())
            i += 1
        starts_speech = re.compile(
            r'^(?:\*\*[^*]+?:\*\*\s*$'          # bold label alone on its line
            r'|(?:\*\*[^*]+?:\*\*|[A-Z][A-Za-z /–-]{1,28}:)\s*["“])'
        )
        segments: list[list[str]] = []
        for pl in para:
            if segments and starts_speech.match(pl):
                segments.append([pl])
            elif not segments:
                segments.append([pl])
            else:
                segments[-1].append(pl)
        for seg in segments:
            out.append(_para(" ".join(seg)))

    return [s for s in sections if s["heading"] or s["html"]]


WAVE = (
    '<svg class="wave" viewBox="0 0 1000 18" preserveAspectRatio="none" aria-hidden="true">'
    '<path d="M0 9 Q 31 0 62 9 T 125 9 T 188 9 T 250 9 T 313 9 T 375 9 T 438 9 T 500 9 '
    "T 563 9 T 625 9 T 688 9 T 750 9 T 813 9 T 875 9 T 938 9 T 1000 9\" "
    'fill="none" stroke="#272C51" stroke-width="2.6"/>'
    '<path d="M0 14 Q 31 6 62 14 T 125 14 T 188 14 T 250 14 T 313 14 T 375 14 T 438 14 '
    "T 500 14 T 563 14 T 625 14 T 688 14 T 750 14 T 813 14 T 875 14 T 938 14 T 1000 14\" "
    'fill="none" stroke="#1E88C7" stroke-width="1.6" opacity="0.55"/></svg>'
)

CSS = """
:root{
  --paper:#FFFFFF; --cream:#F0E8C3; --ink:#1B2030; --indigo:#272C51;
  --orange:#F57C1F; --water:#1E88C7; --wash:#F3F7FA; --line:#DDE4EA;
  --muted:#5B636B;
}
*{margin:0;padding:0;box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@page{size:Letter;}
body{font-family:'Barlow','Segoe UI',Arial,sans-serif;font-size:13.5px;
  line-height:1.55;color:var(--ink);background:var(--paper);}

/* ── Masthead: cream plate with waterline ─────────────────────── */
.masthead{background:var(--cream);border-radius:6px;padding:26px 28px 0;
  display:flex;gap:24px;align-items:center;overflow:hidden;}
.masthead .logo{width:118px;height:118px;flex:none;margin-bottom:14px;}
.masthead .id{flex:1;min-width:0;margin-bottom:14px;}
.chip{display:inline-block;font-family:'IBM Plex Mono',Consolas,monospace;
  font-size:9.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:#fff;background:var(--orange);padding:3px 9px 2px;border-radius:3px;}
h1{font-family:'Oswald','Arial Narrow',sans-serif;font-weight:600;
  font-size:31px;line-height:1.12;letter-spacing:.015em;text-transform:uppercase;
  color:var(--indigo);margin:8px 0 6px;}
.masthead .desc{font-size:12.5px;color:#4A4630;max-width:52ch;}
.wave{display:block;width:100%;height:16px;margin-top:2px;}
.wave-wrap{background:var(--cream);border-radius:0 0 6px 6px;
  margin-top:-6px;padding:0;}
.meta{font-family:'IBM Plex Mono',Consolas,monospace;font-size:9px;
  letter-spacing:.08em;color:var(--muted);text-transform:uppercase;
  display:flex;justify-content:space-between;gap:12px;
  padding:9px 4px 0;margin-bottom:20px;}

/* ── Sections ─────────────────────────────────────────────────── */
section{margin-bottom:18px;}
h2{font-family:'Oswald','Arial Narrow',sans-serif;font-weight:500;
  font-size:16.5px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--indigo);display:flex;align-items:baseline;gap:9px;
  border-bottom:2px solid var(--line);padding-bottom:5px;margin-bottom:10px;
  break-after:avoid;page-break-after:avoid;}
h2 .n{font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;
  font-weight:600;color:#fff;background:var(--orange);border-radius:3px;
  padding:2px 6px 1px;transform:translateY(-2px);}
p{margin-bottom:8px;}
strong{font-weight:600;color:var(--indigo);}
ul,ol{margin:2px 0 10px 20px;break-inside:avoid;page-break-inside:avoid;}
li{margin-bottom:4px;}
li::marker{color:var(--orange);font-weight:700;}
ol.steps{counter-reset:step;list-style:none;margin-left:0;}
ol.steps li{counter-increment:step;position:relative;padding-left:34px;
  margin-bottom:7px;}
ol.steps li::before{content:counter(step);position:absolute;left:0;top:1px;
  width:22px;height:22px;border-radius:50%;background:var(--water);color:#fff;
  font-family:'Oswald',sans-serif;font-size:12px;font-weight:600;
  display:flex;align-items:center;justify-content:center;}
code{font-family:'IBM Plex Mono',Consolas,monospace;font-size:11.5px;
  background:var(--wash);border:1px solid var(--line);border-radius:3px;
  padding:0 4px;color:var(--indigo);}

/* Speech: what the rep says out loud */
.speech{background:var(--wash);border-left:3px solid var(--water);
  border-radius:0 5px 5px 0;padding:9px 13px 9px 14px;margin:0 0 9px;
  break-inside:avoid;page-break-inside:avoid;}
.speech-label{font-family:'IBM Plex Mono',Consolas,monospace;font-size:9px;
  font-weight:600;letter-spacing:.13em;text-transform:uppercase;
  color:var(--water);margin-bottom:3px;}
.speech p{margin:0;font-size:13.5px;}

/* The quotable plate (price band) */
.plate{background:var(--cream);border-radius:6px;padding:14px 18px;
  font-size:14.5px;line-height:1.6;margin:4px 0 12px;
  border-left:4px solid var(--orange);break-inside:avoid;}

/* HARD RULE: prohibitions */
section.hard{background:var(--indigo);border-radius:6px;color:#EDEFF7;
  padding:14px 18px 10px;break-inside:avoid;page-break-inside:avoid;}
section.hard h2{color:#fff;border-bottom-color:rgba(255,255,255,.25);}
section.hard h2::after{content:'HARD RULE';margin-left:auto;
  font-family:'IBM Plex Mono',Consolas,monospace;font-size:8.5px;
  letter-spacing:.14em;color:var(--orange);border:1px solid var(--orange);
  border-radius:3px;padding:2px 6px 1px;transform:translateY(-2px);}
section.hard strong{color:#fff;}
section.hard li::marker{color:var(--orange);}
section.hard .speech{background:rgba(255,255,255,.07);border-left-color:var(--orange);}
section.hard .speech p{color:#EDEFF7;}
section.hard .speech-label{color:var(--orange);}
section.hard code{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff;}

/* Confirm-with-owner chip */
.confirm{font-family:'IBM Plex Mono',Consolas,monospace;font-size:10px;
  font-weight:600;letter-spacing:.04em;color:#8A4B00;background:#FDF0E3;
  border:1px dashed var(--orange);border-radius:3px;padding:1px 6px;}
section.hard .confirm{background:rgba(245,124,31,.15);color:#FFC896;}

/* Tables */
table{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:12.5px;
  break-inside:avoid;page-break-inside:avoid;}
th{font-family:'Oswald','Arial Narrow',sans-serif;font-weight:500;
  font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#fff;
  background:var(--indigo);text-align:left;padding:7px 10px;}
td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top;}
tbody tr:nth-child(even) td{background:var(--wash);}
.c-grade{text-align:center;}
.grade{font-family:'Oswald',sans-serif;font-weight:600;font-size:14px;
  color:var(--indigo);}
.band{font-family:'IBM Plex Mono',Consolas,monospace;font-size:9.5px;
  font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  border-radius:3px;padding:2px 7px 1px;color:#fff;}
.band-urgent{background:var(--orange);}
.band-priority{background:var(--water);}
.band-monitor{background:#8A93A0;}

/* Wire format block */
pre.wire{font-family:'IBM Plex Mono',Consolas,monospace;font-size:11.5px;
  background:var(--indigo);color:#D9E6F2;border-radius:5px;
  padding:11px 14px;margin:4px 0 12px;white-space:pre-wrap;
  break-inside:avoid;}
"""

FOOTER = (
    '<div style="width:100%;font-size:8px;font-family:Arial,sans-serif;'
    'color:#8A93A0;padding:0 0.55in;display:flex;justify-content:space-between;">'
    "<span>FloGuard, LLC — Internal sales enablement · {title}</span>"
    '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
)


def build_html(md: str, title: str, category: str, description: str, logo_b64: str) -> str:
    sections = md_to_sections(md)
    body: list[str] = []
    for s in sections:
        if not s["heading"]:  # intro block under the H1
            body.append('<div class="intro">' + "".join(s["html"]) + "</div>")
            continue
        num = f'<span class="n">{s["num"]}</span>' if s["num"] else ""
        cls = ' class="hard"' if s["hard"] else ""
        body.append(
            f"<section{cls}><h2>{num}{E(s['heading'], quote=False)}</h2>"
            + "".join(s["html"]) + "</section>"
        )

    today = date.today().isoformat()
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Barlow:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>{CSS}</style></head>
<body>
<header>
  <div class="masthead">
    <img class="logo" src="data:image/png;base64,{logo_b64}" alt="FloGuard, LLC">
    <div class="id">
      <span class="chip">{E(category)}</span>
      <h1>{E(title, quote=False)}</h1>
      <div class="desc">{E(description, quote=False)}</div>
    </div>
  </div>
  <div class="wave-wrap">{WAVE}</div>
  <div class="meta">
    <span>FloGuard, LLC · Flood Solutions &amp; Management · FloGuardFL.com</span>
    <span>Sales library · {today}</span>
  </div>
</header>
{"".join(body)}
</body></html>"""


def main() -> int:
    from playwright.sync_api import sync_playwright

    OUT.mkdir(exist_ok=True)
    logo_b64 = base64.b64encode(LOGO.read_bytes()).decode()
    html_dir = Path(tempfile.mkdtemp(prefix="floguard-pdf-"))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for fname, title, category, description in DOCS:
            src = SRC / fname
            if not src.exists():
                print("MISSING", fname)
                continue
            doc_html = build_html(
                src.read_text(encoding="utf-8"), title, category, description, logo_b64
            )
            html_path = html_dir / (src.stem + ".html")
            html_path.write_text(doc_html, encoding="utf-8")
            page.goto(html_path.as_uri())
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass  # offline — system font fallbacks
            page.evaluate("document.fonts.ready")
            pdf_path = OUT / (src.stem + ".pdf")
            page.pdf(
                path=str(pdf_path),
                format="Letter",
                print_background=True,
                margin={"top": "0.42in", "bottom": "0.6in", "left": "0.55in", "right": "0.55in"},
                display_header_footer=True,
                header_template="<span></span>",
                footer_template=FOOTER.format(title=E(title)),
            )
            print("OK", pdf_path.relative_to(ROOT))
        browser.close()
    print(f"\nPDFs -> {OUT.relative_to(ROOT)}  (run: npm run sync-docs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
