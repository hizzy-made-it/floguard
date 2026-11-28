/**
 * The auto-reply. Table layout, inline styles, 600 px, images as hosted PNGs (no SVG, no background
 * images) so it holds up in Gmail, Outlook and Apple Mail. Plain-text part included.
 */
import { COMPANY, esc, addressLine, streetOnly, problemSentence, NEXT_STEPS } from './copy.js';

const NAVY = '#1C2B52';
const ORANGE = '#EC7A1C';
const INK = '#1B2540';
const INK2 = '#59647A';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function img(src, alt, href) {
  return `<a href="${esc(href)}" style="text-decoration:none"><img src="${esc(src)}" alt="${esc(alt)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:8px"></a>`;
}

export function buildAutoReply(rec, { url, imgBase, logoUrl }) {
  const full = rec.version === 'full';
  const first = rec.first_name || 'there';
  const addr = addressLine(rec);
  const street = streetOnly(rec);
  const subject = full && street ? `Your drainage plan for ${street}` : `Thanks, ${first}. Here's your FloGuard next step`;
  const intro = full
    ? `Thanks for reaching out. We pulled the county aerial and USGS lidar for ${addr} and put together a first look at where water sits on your lot and how we'd move it.`
    : `Thanks for reaching out. We got your request${rec.address ? ` for ${addr}` : ''} and set up a page with what happens next.`;

  const visuals = full
    ? `<tr><td style="padding:8px 20px 4px;font:600 13px/1.4 ${FONT};color:#1F6FD1;letter-spacing:.06em;text-transform:uppercase">Today</td></tr>
       <tr><td style="padding:0 20px 14px">${img(`${imgBase}/before.png`, `Aerial of ${addr} with low ground shaded blue`, url)}</td></tr>
       <tr><td style="padding:4px 20px 4px;font:600 13px/1.4 ${FONT};color:#2E7D32;letter-spacing:.06em;text-transform:uppercase">After · concept</td></tr>
       <tr><td style="padding:0 20px 6px">${img(`${imgBase}/after.png`, `Concept drain layout for ${addr}`, url)}</td></tr>
       <tr><td style="padding:0 20px 18px;font:13px/1.5 ${FONT};color:${INK2}">A first look from public aerial and lidar data. We set the final routing on the free site walk.</td></tr>`
    : '';

  const steps = NEXT_STEPS.slice(0, 3)
    .map(([h, b], i) => `<tr><td valign="top" style="padding:6px 10px 6px 0;font:700 15px/1.4 ${FONT};color:${ORANGE}">${i + 1}.</td><td style="padding:6px 0;font:15px/1.5 ${FONT};color:${INK}"><b>${esc(h)}.</b> ${esc(b)}</td></tr>`)
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F6">
<div style="display:none;max-height:0;overflow:hidden">${esc(full ? 'A first look at where water sits on your lot and how we would move it.' : 'What happens next with your drainage request.')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td style="background:${NAVY};padding:16px 20px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px"><img src="${esc(logoUrl)}" alt="FloGuard" width="44" height="44" style="display:block;border-radius:8px;background:#fff"></td>
      <td><div style="font:700 19px/1.2 ${FONT};color:#ffffff">FloGuard LLC</div>
          <div style="font:600 11px/1.4 ${FONT};color:${ORANGE};letter-spacing:.12em;text-transform:uppercase">Flood solutions &amp; management</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:22px 20px 6px;font:700 22px/1.25 ${FONT};color:${INK}">Hi ${esc(first)},</td></tr>
  <tr><td style="padding:0 20px 10px;font:16px/1.55 ${FONT};color:${INK}">${esc(intro)}</td></tr>
  <tr><td style="padding:0 20px 16px;font:15px/1.55 ${FONT};color:${INK2}">${esc(problemSentence(rec))}</td></tr>
  ${visuals}
  <tr><td align="center" style="padding:4px 20px 22px">
    <a href="${esc(url)}" style="display:inline-block;background:${ORANGE};color:#ffffff;font:700 16px/1 ${FONT};text-decoration:none;padding:15px 26px;border-radius:8px">${full ? 'See your drainage plan' : 'See your next steps'}</a>
  </td></tr>
  <tr><td style="padding:0 20px 6px;font:700 13px/1.4 ${FONT};color:${INK};letter-spacing:.06em;text-transform:uppercase;border-top:3px solid ${ORANGE};padding-top:16px">What happens next</td></tr>
  <tr><td style="padding:4px 20px 18px"><table role="presentation" cellpadding="0" cellspacing="0">${steps}</table></td></tr>
  <tr><td style="padding:0 20px 22px;font:15px/1.55 ${FONT};color:${INK}">Want to get on the schedule sooner? Call or text <a href="tel:${COMPANY.tel}" style="color:#1F6FD1;font-weight:700;text-decoration:none">${COMPANY.phone}</a>, or just reply to this email.</td></tr>
  <tr><td style="padding:0 20px 24px;font:15px/1.5 ${FONT};color:${INK}">Heath Daniel<br><span style="color:${INK2}">FloGuard LLC · ${COMPANY.town} · ${COMPANY.phone}</span></td></tr>
  <tr><td style="background:#F5F7FB;padding:14px 20px;font:12px/1.5 ${FONT};color:${INK2}">You're getting this because you asked FloGuard about drainage at ${esc(COMPANY.site)}. Your page is private to this link and isn't listed anywhere. Not looking for help anymore? Reply "stop" and we won't email again.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Hi ${first},`,
    '',
    intro,
    problemSentence(rec),
    '',
    `${full ? 'See your drainage plan' : 'See your next steps'}: ${url}`,
    '',
    'What happens next:',
    ...NEXT_STEPS.slice(0, 3).map(([h, b], i) => `${i + 1}. ${h}. ${b}`),
    '',
    `Want to get on the schedule sooner? Call or text ${COMPANY.phone}, or reply to this email.`,
    '',
    'Heath Daniel',
    `FloGuard LLC · ${COMPANY.town} · ${COMPANY.phone}`,
  ].join('\n');

  return { subject, html, text };
}
