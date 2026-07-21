/**
 * Synthetic FIXTURE-* parcels for the CRM Flood Map when public.parcel_risk
 * is not migrated yet. Same rows as fsi/sql/002_seed_fixtures.sql /
 * fsi/fixtures/parcel_risk.json. Removable once Postgres + ingest are live.
 */
export const FIXTURE_PARCELS = [
  { parcel_id: 'FIXTURE-001', address: 'FIXTURE - 100 Sample St', owner_name: 'Fixture Owner 01', lat: 29.0283, lon: -81.3031, twi_n: 0.95, hand_n: 0.05, hsg: 'D', fema_zone: 'X', fsi_static: 0.885, fsi_live: 66.37 },
  { parcel_id: 'FIXTURE-002', address: 'FIXTURE - 200 Sample St', owner_name: 'Fixture Owner 02', lat: 29.2858, lon: -81.0559, twi_n: 0.1, hand_n: 0.9, hsg: 'A', fema_zone: 'X', fsi_static: 0.1725, fsi_live: 12.94 },
  { parcel_id: 'FIXTURE-003', address: 'FIXTURE - 300 Sample St', owner_name: 'Fixture Owner 03', lat: 29.2108, lon: -81.0228, twi_n: 0.95, hand_n: 0.05, hsg: 'D', fema_zone: 'AE', fsi_static: 0.9675, fsi_live: 72.56 },
  { parcel_id: 'FIXTURE-004', address: 'FIXTURE - 400 Sample St', owner_name: 'Fixture Owner 04', lat: 28.9005, lon: -81.2637, twi_n: 0.88, hand_n: 0.12, hsg: 'C', fema_zone: 'X', fsi_static: 0.7795, fsi_live: 58.46 },
  { parcel_id: 'FIXTURE-005', address: 'FIXTURE - 500 Sample St', owner_name: 'Fixture Owner 05', lat: 28.9489, lon: -81.2984, twi_n: 0.82, hand_n: 0.2, hsg: 'D', fema_zone: 'X-SHADED', fsi_static: 0.818, fsi_live: 61.35 },
  { parcel_id: 'FIXTURE-006', address: 'FIXTURE - 600 Sample St', owner_name: 'Fixture Owner 06', lat: 29.1383, lon: -81.0059, twi_n: 0.75, hand_n: 0.25, hsg: 'C', fema_zone: 'X', fsi_static: 0.695, fsi_live: 52.13 },
  { parcel_id: 'FIXTURE-007', address: 'FIXTURE - 700 Sample St', owner_name: 'Fixture Owner 07', lat: 29.0258, lon: -80.927, twi_n: 0.7, hand_n: 0.3, hsg: 'D', fema_zone: 'AO', fsi_static: 0.775, fsi_live: 58.12 },
  { parcel_id: 'FIXTURE-008', address: 'FIXTURE - 800 Sample St', owner_name: 'Fixture Owner 08', lat: 28.9889, lon: -80.9023, twi_n: 0.65, hand_n: 0.35, hsg: 'B', fema_zone: 'X', fsi_static: 0.57, fsi_live: 42.75 },
  { parcel_id: 'FIXTURE-009', address: 'FIXTURE - 900 Sample St', owner_name: 'Fixture Owner 09', lat: 28.8831, lon: -81.3087, twi_n: 0.6, hand_n: 0.4, hsg: 'C', fema_zone: 'AH', fsi_static: 0.65, fsi_live: 48.75 },
  { parcel_id: 'FIXTURE-010', address: 'FIXTURE - 1000 Sample St', owner_name: 'Fixture Owner 10', lat: 29.0611, lon: -81.2094, twi_n: 0.55, hand_n: 0.45, hsg: 'A/D', fema_zone: 'X', fsi_static: 0.625, fsi_live: 46.88 },
  { parcel_id: 'FIXTURE-011', address: 'FIXTURE - 1100 Sample St', owner_name: 'Fixture Owner 11', lat: 29.1702, lon: -81.0784, twi_n: 0.5, hand_n: 0.5, hsg: 'B', fema_zone: 'X-SHADED', fsi_static: 0.495, fsi_live: 37.12 },
  { parcel_id: 'FIXTURE-012', address: 'FIXTURE - 1200 Sample St', owner_name: 'Fixture Owner 12', lat: 29.2295, lon: -81.1122, twi_n: 0.45, hand_n: 0.55, hsg: 'C', fema_zone: 'X', fsi_static: 0.5, fsi_live: 37.5 },
  { parcel_id: 'FIXTURE-013', address: 'FIXTURE - 1300 Sample St', owner_name: 'Fixture Owner 13', lat: 29.0447, lon: -80.9138, twi_n: 0.4, hand_n: 0.6, hsg: 'B', fema_zone: 'VE', fsi_static: 0.49, fsi_live: 36.75 },
  { parcel_id: 'FIXTURE-014', address: 'FIXTURE - 1400 Sample St', owner_name: 'Fixture Owner 14', lat: 28.9312, lon: -81.1855, twi_n: 0.35, hand_n: 0.65, hsg: 'A', fema_zone: 'X', fsi_static: 0.335, fsi_live: 25.12 },
  { parcel_id: 'FIXTURE-015', address: 'FIXTURE - 1500 Sample St', owner_name: 'Fixture Owner 15', lat: 29.1055, lon: -81.2508, twi_n: 0.3, hand_n: 0.7, hsg: 'B', fema_zone: 'X', fsi_static: 0.3425, fsi_live: 25.69 },
  { parcel_id: 'FIXTURE-016', address: 'FIXTURE - 1600 Sample St', owner_name: 'Fixture Owner 16', lat: 29.2571, lon: -81.139, twi_n: 0.25, hand_n: 0.75, hsg: 'C', fema_zone: 'X', fsi_static: 0.37, fsi_live: 27.75 },
  { parcel_id: 'FIXTURE-017', address: 'FIXTURE - 1700 Sample St', owner_name: 'Fixture Owner 17', lat: 28.972, lon: -81.0466, twi_n: 0.2, hand_n: 0.8, hsg: 'A', fema_zone: 'X-SHADED', fsi_static: 0.26, fsi_live: 19.5 },
  { parcel_id: 'FIXTURE-018', address: 'FIXTURE - 1800 Sample St', owner_name: 'Fixture Owner 18', lat: 29.193, lon: -81.2233, twi_n: 0.15, hand_n: 0.85, hsg: 'B', fema_zone: 'X', fsi_static: 0.245, fsi_live: 18.38 },
  { parcel_id: 'FIXTURE-019', address: 'FIXTURE - 1900 Sample St', owner_name: 'Fixture Owner 19', lat: 28.9166, lon: -81.0912, twi_n: 0.92, hand_n: 0.08, hsg: 'D', fema_zone: 'X', fsi_static: 0.8655, fsi_live: 64.91 },
  { parcel_id: 'FIXTURE-020', address: 'FIXTURE - 2000 Sample St', owner_name: 'Fixture Owner 20', lat: 29.274, lon: -80.9581, twi_n: 0.05, hand_n: 0.95, hsg: 'A', fema_zone: 'X', fsi_static: 0.14, fsi_live: 10.5 },
  { parcel_id: 'FIXTURE-021', address: 'FIXTURE - 2100 Sample St', owner_name: 'Fixture Owner 21', lat: 29.0938, lon: -81.1647, twi_n: 0.72, hand_n: 0.28, hsg: null, fema_zone: null, fsi_static: 0.668, fsi_live: 50.1 },
];

/**
 * Filter/sort fixture parcels the same way PostgREST would for viewport|top.
 * @param {{ action: string, minFsi: number, limit: number, box: null|{w:number,s:number,e:number,n:number} }} q
 */
function enrichFixture(p, i) {
  // Synthetic dial fields so Must / claim-hot presets work offline
  const live = Number(p.fsi_live) || 0;
  const heat = Math.min(1, Math.max(0, (live - 20) / 80));
  const mhs = Math.round(Math.min(100, live * 0.9 + heat * 15 + (String(p.hsg || '').includes('D') ? 8 : 0)));
  // Rough top-tier fixtures as must so Must dial preset works offline
  let band = 'skip';
  if (mhs >= 58) band = 'must';
  else if (mhs >= 42) band = 'should';
  else if (mhs >= 28) band = 'maybe';
  const commercial = i % 7 === 0;
  return {
    ...p,
    claim_heat: Math.round(heat * 1000) / 1000,
    claim_count_10y: Math.round(heat * 20),
    claim_last_year: heat > 0.4 ? 2024 : null,
    must_have_score: mhs,
    must_have_band: band,
    must_have_reasons:
      band === 'must'
        ? commercial
          ? ['high_fsi', 'commercial_scale', 'fixture']
          : ['high_fsi', 'gold_segment', 'fixture']
        : [],
    year_built: 1975 + (i % 40),
    living_area: commercial ? 8000 + i * 200 : 1400 + i * 50,
    just_value: commercial ? 1_200_000 + i * 50000 : 220000 + i * 12000,
    city: 'Port Orange',
    zip: '32127',
    homestead: commercial ? null : i % 3 === 0 ? 'Y' : null,
    dor_use: commercial ? '11' : '01',
    use_desc: commercial ? 'COMMERCIAL STORE' : 'SINGLE FAMILY',
  };
}

export function queryFixtures(q) {
  const minFsi = Number(q.minFsi) || 0;
  const minMust = Number(q.minMust) || 0;
  const mustBand = q.mustBand ? String(q.mustBand).toLowerCase() : '';
  const sort = String(q.sort || 'fsi').toLowerCase();
  const limit = Math.max(1, Number(q.limit) || 500);
  let rows = FIXTURE_PARCELS.map(enrichFixture).filter((p) => Number(p.fsi_live) >= minFsi);
  if (minMust > 0) rows = rows.filter((p) => Number(p.must_have_score) >= minMust);
  if (mustBand) rows = rows.filter((p) => String(p.must_have_band) === mustBand);
  if (q.action === 'viewport' && q.box) {
    const { w, s, e, n } = q.box;
    rows = rows.filter(
      (p) =>
        Number(p.lon) >= w &&
        Number(p.lon) <= e &&
        Number(p.lat) >= s &&
        Number(p.lat) <= n,
    );
  }
  const sorter =
    sort === 'must'
      ? (a, b) => Number(b.must_have_score) - Number(a.must_have_score)
      : sort === 'heat'
        ? (a, b) => Number(b.claim_heat) - Number(a.claim_heat)
        : (a, b) => Number(b.fsi_live) - Number(a.fsi_live);
  rows = rows
    .slice()
    .sort(sorter)
    .slice(0, limit);
  return rows;
}
