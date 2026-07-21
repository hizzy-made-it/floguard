/** Minimal geo helpers — no turf dependency. */

/** Ray-cast point-in-polygon. ring = [[lon,lat], ...] */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates;
    if (!rings?.length) return false;
    if (!pointInRing(lon, lat, rings[0])) return false;
    for (let h = 1; h < rings.length; h++) {
      if (pointInRing(lon, lat, rings[h])) return false; // hole
    }
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) {
      if (pointInPolygon(lon, lat, { type: 'Polygon', coordinates: poly })) return true;
    }
  }
  return false;
}

/** Bbox of a polygon/multipolygon geometry. */
export function geomBbox(geometry) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  function walk(coords, depth) {
    if (depth === 0) {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) walk(c, depth - 1);
  }
  if (geometry.type === 'Polygon') walk(geometry.coordinates, 2);
  else if (geometry.type === 'MultiPolygon') walk(geometry.coordinates, 3);
  if (!isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

/**
 * Grid index for fast PIP against many polygons.
 * cellDeg ~ 0.02 for county-scale NFHL.
 */
export function buildGridIndex(features, cellDeg = 0.02) {
  const cells = new Map();
  const items = [];
  for (const f of features) {
    const bb = geomBbox(f.geometry);
    if (!bb) continue;
    const item = { f, bb };
    items.push(item);
    const c0 = Math.floor(bb[0] / cellDeg);
    const c1 = Math.floor(bb[2] / cellDeg);
    const r0 = Math.floor(bb[1] / cellDeg);
    const r1 = Math.floor(bb[3] / cellDeg);
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = `${c},${r}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    }
  }
  return { cells, cellDeg, items };
}

export function queryGrid(index, lon, lat) {
  const c = Math.floor(lon / index.cellDeg);
  const r = Math.floor(lat / index.cellDeg);
  return index.cells.get(`${c},${r}`) || [];
}

export function findContaining(index, lon, lat) {
  const candidates = queryGrid(index, lon, lat);
  // Prefer SFHA / higher-risk zones when overlapping
  let best = null;
  let bestRank = -1;
  for (const { f, bb } of candidates) {
    if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
    if (!pointInPolygon(lon, lat, f.geometry)) continue;
    const rank = zoneRank(f.properties || f.attributes || {});
    if (rank > bestRank) {
      bestRank = rank;
      best = f;
    }
  }
  return best;
}

function zoneRank(props) {
  const z = String(props.FLD_ZONE || props.fld_zone || '').toUpperCase();
  if (z === 'VE' || z === 'V') return 100;
  if (z === 'AE' || z === 'A' || z === 'AH' || z === 'AO') return 90;
  if (z === 'X' || z === 'C' || z === 'B') {
    const sub = String(props.ZONE_SUBTY || '').toUpperCase();
    if (sub.includes('0.2') || sub.includes('500')) return 40;
    return 20;
  }
  return 10;
}

/** Grid cell key for claim heat. */
export function gridKey(lon, lat, cellDeg = 0.02) {
  const c = Math.floor(Number(lon) / cellDeg);
  const r = Math.floor(Number(lat) / cellDeg);
  return `${c},${r}`;
}
