# FloGuard Site Chatbot — Design Spec

**Date:** 2026-07-10  
**Status:** Approved for implementation planning  
**Product:** FloGuard LLC marketing site (React CRA + FastAPI + MongoDB)

## 1. Goals

### Primary goal
Help homeowners understand FloGuard drainage systems using **only existing site data**, then convert high-intent visitors into leads via the **existing Contact assessment questionnaire**.

### Locked decisions
| Decision | Choice |
|----------|--------|
| Role | Lead-qualifying sales assistant (public) |
| Intelligence | No LLM — client-side retrieval / keyword scoring |
| Placement | Floating chat widget on all marketing pages |
| Architecture | Approach 1: knowledge pack + matcher in the frontend |
| Lead capture | **Do not capture in chat** — hand off ASAP to Contact `/contact` **AssessmentQuiz** (12-step `QUIZ` in `site.js`) |

### Success criteria
- Visitors can get accurate answers about services, process, Florida drainage specifics, service areas, and FAQs without leaving the page.
- Pricing / quote / “get someone out” intents route to the Contact quiz within one bot turn (primary CTA).
- Soft handoff appears early (after first solid answer or any sales intent).
- Assessment quiz remains the single lead source of truth (same `POST /api/leads` path used today by `AssessmentQuiz`).
- Matcher unit tests cover high-confidence hits, city names, and low-confidence fallback.
- Widget is keyboard accessible, reduced-motion safe, and does not appear on admin/studio routes.

### Out of scope (v1)
- LLM / external AI APIs
- In-widget multi-step lead form that posts to `/api/leads`
- Server-side chat transcript storage or admin chat UI
- Multi-language
- Rebuilding the 12-step quiz inside the widget

---

## 2. Architecture

### Stack
No new backend services or API keys. Chat runs entirely in the CRA frontend. Lead submission stays on the Contact page via existing `AssessmentQuiz` → `submitLead`.

```
Layout (marketing pages only)
  └── ChatWidget (FAB + panel)
        ├── ChatPanel
        ├── chatKnowledge.js   (structured entries)
        ├── chatMatcher.js     (score → answer | fallback)
        └── handoff → /contact#assessment (+ sessionStorage prefill)
```

### Components & files

| Path | Responsibility |
|------|----------------|
| `frontend/src/data/chatKnowledge.js` | Knowledge entries derived from site data |
| `frontend/src/lib/chatMatcher.js` | Normalize query, score entries, return best match or fallback |
| `frontend/src/lib/chatHandoff.js` | Write/read `sessionStorage` handoff payload; navigate helpers |
| `frontend/src/components/chat/ChatWidget.jsx` | FAB, open/close, panel shell, session persistence |
| `frontend/src/components/chat/ChatPanel.jsx` | Messages, chips, input, handoff CTAs |
| `frontend/src/components/chat/ChatMessage.jsx` | User/bot bubbles |
| Mount in `frontend/src/components/Layout.jsx` | Widget on every marketing route |

**Touch (small, required for handoff prefill):**
| Path | Change |
|------|--------|
| `frontend/src/pages/Contact.jsx` | Ensure quiz section has stable `id="assessment"`; scroll-into-view on hash |
| `frontend/src/components/AssessmentQuiz.jsx` | On mount, read handoff from `sessionStorage` once; prefill `contact.message` and optionally `answers.location` if a known area was inferred |

### Knowledge pack sources
Compile into scored entries (do not invent facts beyond these):
- `site.js`: `COMPANY`, `SERVICES`, `PROCESS`, `FLOW_PATH`, `SYSTEM_EXPLANATION`, `CASE_STUDIES`, `STATS`, `SERVICE_AREAS`, `LANDING_FAQ`, issue/property language from `ISSUE_OPTIONS` / `QUIZ` wording where useful as FAQ phrasing
- `cities.js`: service-area cities and local angles
- `blog.js`: themes/titles distilled into short FAQ-style answers (not full article dumps)

Each knowledge entry shape:
```js
{
  id: string,
  category: "company" | "service" | "process" | "system" | "area" | "case" | "faq" | "cta",
  title: string,
  answer: string,           // bot reply prose
  keywords: string[],       // match tokens / phrases
  relatedChips?: string[],  // follow-up chip labels
  boostIntent?: "handoff",  // if matched, include strong assessment CTA
}
```

### Matching algorithm (v1)
1. Normalize user text: lowercase, strip punctuation, collapse whitespace.
2. Score each entry: keyword hits (+phrase bonus for multi-word keywords), light category boosts.
3. If top score ≥ threshold → return that answer + related chips.
4. Else → fallback copy + phone/SMS + **Start free assessment** CTA.
5. **Handoff intent** (independent of score): if message matches sales intent phrases (`assessment`, `quote`, `price`, `how much`, `cost`, `schedule`, `call me`, `book`, `free estimate`, etc.) → bot reply that defers to Contact quiz + primary CTA (do not invent prices).

### Data flow
```
User message / chip
  → chatMatcher
  → bot message (answer or fallback)
  → if handoff intent or soft-prompt rules fire:
        chatHandoff.write({ topics, lastUserMessage, inferredLocation? })
        Link/button → /contact#assessment
  → Contact page mounts AssessmentQuiz
  → AssessmentQuiz reads handoff once, prefills message (and location if valid)
  → User completes 12-step QUIZ → existing submitLead API
```

---

## 3. Lead handoff (Contact questionnaire)

### Source of truth
Contact page **`AssessmentQuiz`** driven by `QUIZ` (12 steps) in `site.js`:
issues → water_location → water_duration → frequency → affected_size → existing_drainage → damages → timeline → property_type → location → photos → contact.

### Chatbot rules
1. **Never** collect name/phone/email inside the widget for lead submission.
2. Sales / pricing / “get help out” intent → **immediate** handoff message and CTA to `/contact#assessment`.
3. Soft handoff after the **first successful knowledge answer** (or first pricing-adjacent question if earlier):  
   *“For a free on-site assessment we use a short questionnaire on our Contact page so the crew gets the full picture.”*
4. Persistent chip: **“Book free assessment”** → same handoff.
5. Secondary CTAs always available in handoff messages: Call / Text using `COMPANY.phoneHref` / `COMPANY.smsHref`.

### Handoff payload (`sessionStorage` key: `fg_chat_handoff`)
```js
{
  v: 1,
  createdAt: ISO string,
  lastUserMessage: string,
  topics: string[],          // matched entry titles / categories
  inferredLocation?: string, // only if matched a known SERVICE_AREAS value
  source: "chatbot"
}
```
- Written immediately before navigation (or when user clicks the assessment CTA).
- Consumed once by `AssessmentQuiz` (then removed or marked `consumed: true`).
- Prefill: append a short note into the quiz contact `message` field (or a visible pre-contact note if only message exists on last step — implement by initializing `contact.message` on mount). If `inferredLocation` is in `SERVICE_AREAS` or `"Other / nearby"`, set `answers.location` so that step can skip-friendly display (quiz may still show the step; pre-select is enough).
- Include `source: "chatbot"` on the eventual lead only if `AssessmentQuiz` already supports a source field; if not, append `[Source: chatbot]` into the message body so admin can filter — prefer extending submit payload with `source: "chatbot"` if the API already accepts `source` (it does).

### AssessmentQuiz submit note
When handoff was present, ensure lead `message` includes a compact summary, e.g.  
`[Chatbot] Topics: French drains, Port Orange | Last question: How much does a sump cost?`  
plus any user free-text from the contact step.

---

## 4. UI / UX

### Visual
- Brand tokens: navy / slate / orange; reuse existing `Button` / input styles where practical.
- FAB: bottom-right, `z-index` above footer, safe-area padding on mobile.
- Panel: ~380×min(520, 70vh) desktop; near full-width sheet on small screens.
- Header: “FloGuard Assistant” · subtitle “Drainage help · Central Florida”.

### Widget states
1. **Collapsed** — chat icon FAB; optional one-time session pulse (disabled under `prefers-reduced-motion`).
2. **Open / Q&A** — message list, suggestion chips, text input, send.
3. **Handoff message** — bot card with primary button “Start free assessment” (navigates to Contact) + Call / Text links. Input remains available if user wants more Q&A.

### Default chips (examples)
- How does a French drain + sump work?
- Do you serve my area?
- Standing water after rain
- What’s the process?
- Book free assessment

### Opening line
Bot greets once per session: short value prop + privacy line  
(“Answers use FloGuard site information. Ready for a free assessment? We’ll send you to a short questionnaire on Contact.”) + chips.

### Accessibility
- `aria-expanded` on FAB; dialog/panel labeling.
- Focus moves into panel on open; Esc closes; focus returns to FAB.
- `aria-live="polite"` region for new bot messages.
- Inputs labeled; touch targets ≥ 44px where possible.

### Persistence
- `sessionStorage`: open/closed preference optional; message history for the browser session so refresh does not wipe mid-conversation (cap ~40 messages).

### Where not shown
- Not mounted on `/admin`, `/admin/login`, `/studio` (outside `Layout` already).

---

## 5. Edge cases

| Case | Behavior |
|------|----------|
| Empty / gibberish | Nudge + default chips |
| Low match confidence | Fallback + assessment CTA + phone |
| Outside service area | List primary areas; still offer Contact quiz to confirm |
| Price / cost questions | No dollar amounts; explain free assessment; **immediate handoff CTA** |
| Active flooding urgency | Empathy + Call now + assessment CTA (no false emergency-service claims) |
| User wants to keep chatting after handoff prompt | Allowed; chip remains available |
| Hash navigation on Contact | Scroll/focus quiz `#assessment` |
| Stale handoff (>24h or missing) | Ignore prefill |
| Reduced motion | No pulse / heavy motion |

---

## 6. Testing

### Automated
- Unit tests for `chatMatcher.js`:
  - Known service keywords → expected entry id
  - City / area phrases → area entries
  - Handoff intent detection true/false
  - Low-confidence → fallback
- Optional: pure tests for handoff serialize/parse

### Manual smoke
1. Home: open widget → chip “How it works” → coherent answer + soft handoff line.
2. Type “How much does it cost?” → handoff CTA → lands on Contact quiz (`#assessment`).
3. Prefill: message (and location if city mentioned) reflected in quiz when reaching those steps / on init.
4. Complete quiz → lead appears in admin; message notes chatbot source.
5. Mobile: FAB usable; panel doesn’t cover critical CTAs unreasonably.
6. Keyboard: open, type, Esc close.

---

## 7. Implementation notes

- Prefer importing structured constants from `site.js` / `cities.js` / `blog.js` into `chatKnowledge.js` builders rather than duplicating long copy blindly; answers may be lightly rewritten for chat length.
- Keep matcher deterministic and dependency-free (no new npm packages required for v1).
- Do not block first paint: lazy-load chat panel chunk if easy (`React.lazy`), optional for v1.
- Follow existing brand components and Tailwind tokens; surgical diffs only.

---

## 8. Open items resolved in design

| Item | Resolution |
|------|------------|
| Capture leads in chat? | **No** — Contact `AssessmentQuiz` only |
| LLM? | **No** |
| Backend search? | **No** for v1 |
| Admin chat logs? | **No** for v1 |

---

## 9. Approval

Design sections approved in session (goals, architecture, UI/handoff), with explicit revision that chatbot defers to the Contact 12-step questionnaire as soon as lead intent appears.
