/** Shared wording for the lead page and the email, built only from the stored page record. */

export const COMPANY = {
  name: 'FloGuard LLC',
  phone: '(386) 259-0023',
  tel: '+13862590023',
  site: 'floguardfl.com',
  town: 'Port Orange, FL',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function addressLine(rec) {
  const a = rec.address || '';
  if (!a) return rec.city ? `${rec.city}, FL` : 'Your property';
  if (rec.city && !a.toLowerCase().includes(rec.city.toLowerCase())) return `${a}, ${rec.city}`;
  return a;
}

/** Street part only, for subjects: "504 NW 31st St". */
export const streetOnly = (rec) => (rec.address || '').split(',')[0].trim();

const lower = (s) => String(s || '').toLowerCase();

/** One sentence on what they told us, in their own answer words. */
export function problemSentence(rec) {
  const where = rec.water_location?.length ? rec.water_location.map(lower).join(', ') : '';
  const what = rec.issues?.length ? rec.issues.map(lower).join(', ') : '';
  const parts = [];
  if (what) parts.push(`You told us about ${what}`);
  if (where) parts.push(`${parts.length ? 'mostly in the' : 'You told us water collects in the'} ${where}`);
  let s = parts.join(', ');
  if (rec.water_duration) s += `${s ? ', and' : 'You said'} water hangs around ${lower(rec.water_duration)}`;
  return s ? `${s}.` : 'Thanks for telling us about the water on your property.';
}

/** Short findings for the full version, from lidar + lot data. */
export function findings(rec) {
  const out = [];
  if (rec.parcel?.lot_sqft) out.push({ k: `${Math.round(rec.parcel.lot_sqft).toLocaleString('en-US')} sq ft`, v: 'Your lot, from the county parcel map' });
  if (rec.low_ground) {
    out.push({ k: `~${(rec.low_ground.cut - rec.low_ground.min).toFixed(1)} ft`, v: 'Bowl inside the lot (USGS lidar)' });
    out.push({ k: `~${(rec.low_ground.max - rec.low_ground.min).toFixed(1)} ft`, v: 'High side to low spot' });
  } else if (rec.flat_lot) out.push({ k: '< 0.3 ft', v: 'Fall across the whole lot (USGS lidar)' });
  if (rec.layout?.discharge_ft) out.push({ k: `~${rec.layout.discharge_ft} ft`, v: 'Concept line from the low spot to the street side' });
  return out.slice(0, 4);
}

export function whyText(rec) {
  if (rec.low_ground) {
    return `The lidar shows a low area inside your lot, about ${(rec.low_ground.cut - rec.low_ground.min).toFixed(1)} ft deep at its lowest spot (shaded blue). Rain runs into it and has nowhere to go until it soaks in, which on Central Florida's high water table can take days.`;
  }
  if (rec.flat_lot) {
    return 'The lidar shows your lot is nearly flat, with less than a few inches of fall from one side to the other. With no downhill path, rain sits until it soaks in, and on Central Florida\'s high water table that can take days.';
  }
  return 'Most Central Florida lots are flat and sit over a water table only a few feet down. When rain has no downhill path, it sits until it soaks in. We confirm exactly where your water goes with lidar and a walk of the yard.';
}

export const NEXT_STEPS = [
  ['We review your yard', 'We look over your answers and the county aerial and lidar for your lot, usually within one business day.'],
  ['Free on-site assessment', 'We walk the property, find where the water collects and where it can go, and check utilities and access.'],
  ['Your design proposal', 'You get a full plan for your lot: flood map, drain routing, the build stage by stage, and a clear price.'],
  ['The build', 'Most residential systems go in within 1 to 3 days, with the lawn restored when we finish.'],
];
