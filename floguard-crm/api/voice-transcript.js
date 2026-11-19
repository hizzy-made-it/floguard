/** Twilio transcribeCallback — appends the voicemail transcript to the caller's lead. */
import { formParams, validTwilioRequest, sendTwiml, forbidden } from '../server/lib/twilio.js';
import { upsertPhoneLead } from '../server/lib/phone-intake.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendTwiml(res, '');
  const p = formParams(req);
  if (!validTwilioRequest(req, '/api/voice-transcript', p)) return forbidden(res);
  const text = String(p.TranscriptionText || '').trim();
  const note =
    p.TranscriptionStatus === 'completed' && text
      ? `Voicemail transcript: "${text.slice(0, 1500)}"`
      : 'Voicemail transcript unavailable (listen to the recording).';
  try {
    await upsertPhoneLead({ phone: p.From, note });
  } catch (e) {
    console.error('[voice-transcript] failed:', e?.message);
  }
  return sendTwiml(res, '');
}
