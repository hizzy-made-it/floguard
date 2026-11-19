/**
 * Twilio Voice webhook — set as the FloGuard number's "A call comes in" URL:
 *   POST https://crm.floguardfl.com/crm/api/voice-inbound
 * Logs the caller as a CRM lead, then rings FORWARD_TO_NUMBER (Heath's cell).
 * If nobody answers, Twilio posts to /api/voice-status (missed-call path).
 */
import { formParams, validTwilioRequest, sendTwiml, forbidden, xmlEscape } from '../server/lib/twilio.js';
import { upsertPhoneLead } from '../server/lib/phone-intake.js';
import { voicemailTwiml, withTimeout } from '../server/lib/voice-flow.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendTwiml(res, '<Reject/>');
  const p = formParams(req);
  if (!validTwilioRequest(req, '/api/voice-inbound', p)) return forbidden(res);

  await withTimeout(
    upsertPhoneLead({
      phone: p.From,
      callerName: p.CallerName,
      city: p.FromCity ? p.FromCity.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()) : '',
      note: 'Inbound call to FloGuard line.',
    }),
    5000,
  ).catch((e) => console.error('[voice-inbound] lead upsert failed:', e?.message));

  const forward = process.env.FORWARD_TO_NUMBER;
  if (!forward) return sendTwiml(res, voicemailTwiml());
  const base = (process.env.PUBLIC_BASE_URL || 'https://crm.floguardfl.com/crm').replace(/\/$/, '');
  const timeout = Number(process.env.FORWARD_RING_SECONDS || 20);
  return sendTwiml(
    res,
    `<Dial timeout="${timeout}" answerOnBridge="true" action="${xmlEscape(`${base}/api/voice-status`)}" method="POST">` +
      `<Number>${xmlEscape(forward)}</Number></Dial>`,
  );
}
