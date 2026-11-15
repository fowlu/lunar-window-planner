'use strict';

const radians = Math.PI / 180;
const degrees = 1 / radians;
let rasterLoad;

async function loadRaster(grid) {
  const pieces = await Promise.all(['lola-custom-1.bin', 'lola-custom-2.bin'].map(async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error('The terrain grid could not be downloaded.');
    return response.arrayBuffer();
  }));
  const stream = new Blob(pieces).stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  const cells = new Int16Array(bytes);
  if (cells.length !== grid.shape[0] * grid.shape[1]) throw new Error('The terrain grid is incomplete.');
  return cells;
}

function elevationAt(grid, cells, lat, lon) {
  const rho = 2 * grid.radius * Math.tan((lat + Math.PI / 2) / 2);
  const row = grid.row0 - rho * Math.cos(lon) / grid.scale;
  const col = grid.col0 + rho * Math.sin(lon) / grid.scale;
  const i = Math.floor(row), j = Math.floor(col), [height, width] = grid.shape;
  if (lat > -75 * radians || i < 0 || i + 1 >= height || j < 0 || j + 1 >= width) return NaN;
  const offset = i * width + j;
  const a = cells[offset], b = cells[offset + 1];
  const c = cells[offset + width], d = cells[offset + width + 1];
  if (Math.min(a,b,c,d) < grid.minimum || Math.max(a,b,c,d) > grid.maximum) return NaN;
  const x = col - j, y = row - i;
  return grid.quant * ((a + (b - a) * x) * (1 - y) + (c + (d - c) * x) * y);
}

const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const localTrack = (vectors, up, east, north, radius, cadence) => vectors.map((vector, i) => {
  const e = dot(vector, east), n = dot(vector, north);
  return [i * cadence, (Math.atan2(e, n) * degrees + 360) % 360,
    Math.atan2(dot(vector, up) - radius, Math.hypot(e, n)) * degrees];
});

function calculate({lat, lon, grid, extent, bodyVectors, cadence}, cells) {
  const p = lat * radians, q = lon * radians;
  const sp = Math.sin(p), cp = Math.cos(p), sq = Math.sin(q), cq = Math.cos(q);
  const up = [cp*cq, cp*sq, sp], east = [-sq, cq, 0], north = [-sp*cq, -sp*sq, cp];
  const ground = elevationAt(grid, cells, p, q);
  if (!Number.isFinite(ground)) throw new Error('The coordinate falls outside usable LOLA terrain.');
  const radii = [2, 5].map(height => grid.radius + ground + height);
  const terrain = [[], []], missing = [];
  const distances = [];
  for (let distance = 120; distance <= extent; distance += 120) {
    const angle = distance / grid.radius;
    distances.push([Math.sin(angle), Math.cos(angle)]);
  }
  for (let az = 0; az < 360; az++) {
    const s = Math.sin(az * radians), c = Math.cos(az * radians);
    const tangent = east.map((v, i) => v*s + north[i]*c);
    const best = [null, null];
    let gap = false;
    for (const [along, lifted] of distances) {
      const latitude = Math.asin(Math.max(-1, Math.min(1, up[2]*lifted + tangent[2]*along)));
      const longitude = Math.atan2(up[1]*lifted + tangent[1]*along, up[0]*lifted + tangent[0]*along);
      const height = elevationAt(grid, cells, latitude, longitude);
      if (!Number.isFinite(height)) { gap = true; continue; }
      const surface = grid.radius + height, distance = surface * along;
      for (let i = 0; i < radii.length; i++) {
        const y = surface * lifted - radii[i], angle = Math.atan2(y, distance) * degrees;
        if (!best[i] || angle > best[i][0]) best[i] = [angle, distance, y, latitude*degrees, longitude*degrees];
      }
    }
    terrain[0].push(best[0]);
    terrain[1].push(best[1]);
    missing.push(gap);
  }
  const limit = extent / grid.radius, relief = grid.radius + 12000;
  const far = radii.map(radius => Math.atan2(relief*Math.cos(limit) - radius, relief*Math.sin(limit)) * degrees);
  const sun = localTrack(bodyVectors.sun, up, east, north, radii[0], cadence);
  return {lat, lon, ground, heights: Object.fromEntries(radii.map((radius, i) => [i ? 5 : 2, {
    earth: localTrack(bodyVectors.earth, up, east, north, radius, cadence), sun,
    terrain: {earth: terrain[i], sun: terrain[0]}, far: {earth: far[i], sun: far[0]}, missing, profiles: {}
  }]))};
}

self.onmessage = async ({data: request}) => {
  try {
    rasterLoad ??= loadRaster(request.grid);
    self.postMessage({site: calculate(request, await rasterLoad)});
  } catch (error) {
    rasterLoad = null;
    self.postMessage({error: error.message || 'Could not calculate terrain at this site.'});
  }
};
