# Phone intake: missed-call text-back (Twilio → CRM)

Every call to the FloGuard Twilio number becomes (or updates) a lead in the CRM's shared lead list.
Calls ring Heath's cell first. If nobody answers, the caller gets **one** auto text pointing to
https://floguardfl.com/contact, then hears a voicemail greeting. The recording link and transcript land
in the lead's notes. Inbound texts are logged on the lead; STOP opts the number out.

## Endpoints (Vercel, served under /crm via the existing rewrite)

| Twilio setting | URL |
|---|---|
| Voice → "A call comes in" (HTTP POST) | `https://crm.floguardfl.com/crm/api/voice-inbound` |
| Messaging → "A message comes in" (HTTP POST) | `https://crm.floguardfl.com/crm/api/sms-inbound` |

`/api/voice-status` and `/api/voice-transcript` are called by Twilio automatically from the TwiML.
All four reject requests without a valid `X-Twilio-Signature`.

## Environment variables (Vercel project for crm.floguardfl.com)

| Var | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | from the Twilio console |
| `TWILIO_FROM_NUMBER` | the FloGuard Twilio number, E.164 (`+1386…`) |
| `TWILIO_MESSAGING_SERVICE_SID` | optional; use once the A2P campaign is attached to a Messaging Service |
| `FORWARD_TO_NUMBER` | Heath's cell, E.164. Leave unset to send every call straight to voicemail |
| `FORWARD_RING_SECONDS` | optional, default 20 |
| `PUBLIC_BASE_URL` | `https://crm.floguardfl.com/crm` (must match what Twilio calls, for signatures) |
| `AUTO_SMS_ENABLED` | **leave unset until go-live.** Only `true` sends texts |
| `AUTO_SMS_TEST_ONLY` | optional: E.164 number; when set, auto texts go only to this number |
| `AUTO_SMS_TEXT` | optional override of the default message |
| `AUTO_SMS_COOLDOWN_HOURS` | optional, default 72 (one auto text per number per window) |
| `VOICEMAIL_GREETING` | optional override of the spoken greeting |

Default auto text (edit via `AUTO_SMS_TEXT` once approved):

> Hi, it's Heath with FloGuard. Sorry we missed your call! The first step is a quick form at
> https://floguardfl.com/contact so we can get a good picture of the issue. We'll follow up shortly.
> Reply STOP to opt out.

## Go-live checklist

1. Twilio account (upgrade from trial so it can text non-verified numbers).
2. Number: port the Google Voice number to Twilio (keeps the number on the trucks/site), or buy a new 386 local number.
3. A2P 10DLC: FloGuard LLC has an EIN → **Low Volume Standard** brand + "Customer Care"/mixed campaign.
   Opt-in description: "Customer calls our business line; after a missed call we send one text with our contact form link. Reply STOP to opt out."
   Texts to US numbers are blocked by carriers until the campaign is approved.
4. Point the number's Voice and Messaging webhooks at the URLs above; set env vars; deploy.
5. Test with `AUTO_SMS_ENABLED=true` + `AUTO_SMS_TEST_ONLY=<Heath's cell>`; call from that phone, let it ring out.
6. Remove `AUTO_SMS_TEST_ONLY` to go live.

## Cost (Twilio list prices, Nov 2026)

- Local number $1.15/mo; inbound voice $0.0085/min; forwarding leg to the cell $0.014/min; recording $0.0025/min; legacy `<Record transcribe>` is billed per transcribed minute.
- SMS $0.0083/segment out or in, plus carrier fees.
- A2P 10DLC Low Volume Standard: $4.50 brand (one time) + $15 campaign vetting (one time) + $1.50/mo campaign.

## Tests

`node --test tests/phone-intake.test.mjs` (mocks Supabase Storage and the Twilio API; set
`TWILIO_LIB=<path>/node_modules/twilio/lib/index.js` to also cross-check signatures against the official SDK).
