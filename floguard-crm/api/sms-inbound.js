/**
 * Twilio Messaging webhook — "A message comes in":
 *   POST https://crm.floguardfl.com/crm/api/sms-inbound
 * Logs the text on the sender's lead (creating it if new) and tracks STOP/START.
 * Does not auto-reply; Twilio's built-in opt-out handling answers STOP/HELP.
 */
import { formParams, validTwilioRequest, sendTwiml, forbidden } from '../server/lib/twilio.js';
import { upsertPhoneLead } from '../server/lib/phone-intake.js';

export const config = { maxDuration: 15 };

const STOP = /^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)$/i;
const START = /^(start|unstop|yes)$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendTwiml(res, '');
  const p = formParams(req);
  if (!validTwilioRequest(req, '/api/sms-inbound', p)) return forbidden(res);
  const body = String(p.Body || '').trim();
  const patch = {};
  if (STOP.test(body)) patch.sms_opt_out = true;
  else if (START.test(body)) patch.sms_opt_out = false;
  const media = Number(p.NumMedia || 0) > 0 ? ` [+${p.NumMedia} photo(s): ${p.MediaUrl0 || ''}]` : '';
  try {
    await upsertPhoneLead({
      phone: p.From,
      city: p.FromCity || '',
      note: `Text received: "${body.slice(0, 1000)}"${media}`,
      patch,
    });
  } catch (e) {
    console.error('[sms-inbound] failed:', e?.message);
  }
  return sendTwiml(res, '');
}
