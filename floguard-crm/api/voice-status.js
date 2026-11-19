/**
 * Twilio <Dial action> callback (and <Record action> with ?stage=recorded).
 * Missed call → note on lead, one auto text-back (if enabled), then voicemail.
 */
import { formParams, validTwilioRequest, sendTwiml, forbidden } from '../server/lib/twilio.js';
import { upsertPhoneLead, maybeAutoText } from '../server/lib/phone-intake.js';
import { voicemailTwiml, withTimeout } from '../server/lib/voice-flow.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendTwiml(res, '<Hangup/>');
  const p = formParams(req);
  if (!validTwilioRequest(req, '/api/voice-status', p)) return forbidden(res);

  const stage = new URL(String(req.url || '/'), 'http://x').searchParams.get('stage');
  if (stage === 'recorded') {
    const secs = Number(p.RecordingDuration || 0);
    if (secs > 0 && p.RecordingUrl) {
      await withTimeout(
        upsertPhoneLead({ phone: p.From, note: `Voicemail left (${secs}s): ${p.RecordingUrl}.mp3` }),
        5000,
      ).catch((e) => console.error('[voice-status] recording note failed:', e?.message));
    }
    return sendTwiml(res, '<Hangup/>');
  }

  const status = String(p.DialCallStatus || '');
  if (status === 'completed' || status === 'answered') {
    await withTimeout(upsertPhoneLead({ phone: p.From, note: 'Call answered.' }), 5000).catch(() => {});
    return sendTwiml(res, '<Hangup/>');
  }

  try {
    const { lead } = await withTimeout(
      upsertPhoneLead({ phone: p.From, note: `Missed call (${status || 'no answer'}).` }),
      5000,
    );
    const result = await withTimeout(maybeAutoText(lead, p.From), 6000).catch(() => 'error');
    console.log('[voice-status] auto text:', result);
  } catch (e) {
    console.error('[voice-status] missed-call handling failed:', e?.message);
  }
  return sendTwiml(res, voicemailTwiml());
}
