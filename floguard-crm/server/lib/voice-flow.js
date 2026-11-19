import { xmlEscape } from './twilio.js';

export const DEFAULT_GREETING =
  "Thanks for calling FloGuard. We can't get to the phone right now. " +
  "Please leave your name, address, and a quick description of the drainage issue after the beep, and we'll text you right back.";

export function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://crm.floguardfl.com/crm').replace(/\/$/, '');
}

export function voicemailTwiml() {
  const b = baseUrl();
  return (
    `<Say voice="Polly.Joanna">${xmlEscape(process.env.VOICEMAIL_GREETING || DEFAULT_GREETING)}</Say>` +
    `<Record maxLength="180" playBeep="true" trim="trim-silence"` +
    ` action="${xmlEscape(`${b}/api/voice-status?stage=recorded`)}" method="POST"` +
    ` transcribe="true" transcribeCallback="${xmlEscape(`${b}/api/voice-transcript`)}"/>` +
    '<Hangup/>'
  );
}

export function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
