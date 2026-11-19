import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockGroupIndex, assignBlockGroup, buildParcelPatches } from '../../scripts/ingest-nfip-claims.mjs';
import { findFirstContaining } from '../../scripts/lib/geo.mjs';

const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

// 121270000001: plain square (-81.00..-80.90, 29.00..29.10)
// 121270000002: neighbour to the east, shares the edge at lon -80.90
// 121270000003: donut around (-81.5, 29.5); the hole belongs to 121270000004
// 121270000005: MultiPolygon with two islands
const META = new Map([
  ['121270000001', { geometry: { type: 'Polygon', coordinates: [sq(-81.0, 29.0, 0.1)] } }],
  ['121270000002', { geometry: { type: 'Polygon', coordinates: [sq(-80.9, 29.0, 0.1)] } }],
  ['121270000003', { geometry: { type: 'Polygon', coordinates: [sq(-81.6, 29.4, 0.2), sq(-81.55, 29.45, 0.1)] } }],
  ['121270000004', { geometry: { type: 'Polygon', coordinates: [sq(-81.55, 29.45, 0.1)] } }],
  ['121270000005', { geometry: { type: 'MultiPolygon', coordinates: [[sq(-80.5, 28.9, 0.05)], [sq(-80.3, 28.9, 0.05)]] } }],
  ['121270000009', { geometry: null }], // no polygon: ignored by the index
]);
const index = buildBlockGroupIndex(META);

test('point in polygon assigns the containing block group', () => {
  assert.equal(assignBlockGroup(index, -80.95, 29.05), '121270000001');
  assert.equal(assignBlockGroup(index, -80.85, 29.05), '121270000002');
});

test('holes: a point in the donut hole belongs to the inner block group, not the donut', () => {
  assert.equal(assignBlockGroup(index, -81.5, 29.5), '121270000004');
  assert.equal(assignBlockGroup(index, -81.58, 29.42), '121270000003', 'on the ring part');
});

test('multipolygon: either island matches, the gap does not', () => {
  assert.equal(assignBlockGroup(index, -80.48, 28.92), '121270000005');
  assert.equal(assignBlockGroup(index, -80.28, 28.92), '121270000005');
  assert.equal(assignBlockGroup(index, -80.4, 28.92), null);
});

test('outside every polygon, or bad coordinates, gives null', () => {
  assert.equal(assignBlockGroup(index, -82.5, 30.5), null);
  assert.equal(assignBlockGroup(index, 'x', 29), null);
  assert.equal(assignBlockGroup(index, null, null), null);
});

test('index spans grid cells: a polygon larger than one 0.02 cell is found from any cell', () => {
  for (const lon of [-80.99, -80.95, -80.91]) for (const lat of [29.01, 29.05, 29.09]) {
    assert.equal(findFirstContaining(index, lon, lat).properties.fips, '121270000001', `${lon},${lat}`);
  }
});

test('buildParcelPatches: only changed assignments are written; counters add up', () => {
  const parcels = [
    { parcel_id: 'p1', lat: 29.05, lon: -80.95, block_group: null },
    { parcel_id: 'p2', lat: 29.05, lon: -80.85, block_group: '121270000002' }, // unchanged
    { parcel_id: 'p3', lat: 29.05, lon: -80.85, block_group: '121270000001' }, // stale assignment
    { parcel_id: 'p4', lat: 30.5, lon: -82.5, block_group: null }, // outside
    { parcel_id: 'p5', lat: 'n/a', lon: -82.5, block_group: null }, // bad coords
    { parcel_id: 'p6', lat: 30.5, lon: -82.5, block_group: '121270000001' }, // was assigned, now outside -> cleared
  ];
  const { patches, counts } = buildParcelPatches(parcels, index);
  assert.deepEqual(patches, [
    { parcel_id: 'p1', block_group: '121270000001' },
    { parcel_id: 'p3', block_group: '121270000002' },
    { parcel_id: 'p6', block_group: null },
  ]);
  assert.deepEqual(counts, { seen: 6, assigned: 3, outside: 2, bad_coords: 1, unchanged: 2 });
  assert.equal(buildParcelPatches(parcels, index, { reassignAll: true }).patches.length, 5);
});
