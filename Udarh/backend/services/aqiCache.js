const cron = require('node-cron');
const { lookupCurrentConditions, getFallbackAqi, getAqiBand } = require('./aqiProvider');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const CELL_SIZE_METERS = 500;
const DEFAULT_GRID_RADIUS_KM = process.env.DEFAULT_CITY_GRID_RADIUS_KM ? parseInt(process.env.DEFAULT_CITY_GRID_RADIUS_KM) : 15;
const CENTER_LAT = parseFloat(process.env.DEFAULT_CITY_LAT || '28.6139');
const CENTER_LNG = parseFloat(process.env.DEFAULT_CITY_LNG || '77.2090');
const REFRESH_MINUTES = parseInt(process.env.AQI_CACHE_REFRESH_MINUTES || '10');

const state = {
  grid: new Map(),
  gridList: [],
  lastUpdated: null,
  isReady: false,
  cellSizeMeters: CELL_SIZE_METERS,
  bounds: null,
  latStep: 0,
  lngStep: 0,
};

function metersToLat(meters) {
  return meters / 111320;
}

function metersToLng(meters, lat) {
  return meters / (111320 * Math.cos((lat * Math.PI) / 180));
}

function buildGridCells(centerLat, centerLng, radiusKm) {
  const cells = [];
  const latStep = metersToLat(CELL_SIZE_METERS);
  const lngStep = metersToLng(CELL_SIZE_METERS, centerLat);

  const radiusMeters = radiusKm * 1000;
  const latCount = Math.ceil(2 * radiusMeters / CELL_SIZE_METERS);
  const lngCount = Math.ceil(2 * radiusMeters / CELL_SIZE_METERS);

  const startLat = centerLat - (latCount / 2) * latStep;
  const startLng = centerLng - (lngCount / 2) * lngStep;

  for (let i = 0; i < latCount; i++) {
    for (let j = 0; j < lngCount; j++) {
      const lat = startLat + i * latStep;
      const lng = startLng + j * lngStep;
      const distFromCenter = haversineDistanceMeters(centerLat, centerLng, lat, lng);
      if (distFromCenter <= radiusMeters) {
        cells.push({
          key: `${i}_${j}`,
          lat,
          lng,
          gridI: i,
          gridJ: j,
        });
      }
    }
  }

  state.latStep = latStep;
  state.lngStep = lngStep;
  state.bounds = {
    minLat: startLat,
    maxLat: startLat + latCount * latStep,
    minLng: startLng,
    maxLng: startLng + lngCount * lngStep,
    centerLat,
    centerLng,
    radiusKm,
  };

  return cells;
}

function findNearestCellKey(lat, lng) {
  if (!state.bounds) return null;
  if (lat < state.bounds.minLat || lat > state.bounds.maxLat ||
      lng < state.bounds.minLng || lng > state.bounds.maxLng) {
    return null;
  }

  const i = Math.round((lat - state.bounds.minLat) / state.latStep);
  const j = Math.round((lng - state.bounds.minLng) / state.lngStep);
  return `${i}_${j}`;
}

function lookup(lat, lng) {
  if (!state.isReady || state.grid.size === 0) {
    return null;
  }

  const key = findNearestCellKey(lat, lng);
  if (key && state.grid.has(key)) {
    return state.grid.get(key);
  }

  let bestDist = Infinity;
  let bestVal = null;
  for (const cell of state.gridList) {
    const d = haversineDistanceMeters(lat, lng, cell.lat, cell.lng);
    if (d < bestDist && d < CELL_SIZE_METERS * 2) {
      bestDist = d;
      bestVal = cell;
    }
  }
  return bestVal;
}

async function refreshGrid() {
  if (GOOGLE_MAPS_API_KEY && !GOOGLE_MAPS_API_KEY.startsWith('your_')) {
    console.log(`[aqiCache] Refreshing grid (${state.gridList.length} cells) via live API...`);
  } else {
    console.log(`[aqiCache] Live API key not configured. Refreshing grid with deterministic fallback AQI values only.`);
    for (const cell of state.gridList) {
      const fb = getFallbackAqi(cell.lat, cell.lng);
      cell.aqi = fb.aqi;
      cell.band = fb.band;
      cell.category = fb.category;
      cell._fallback = true;
      cell.updatedAt = Date.now();
    }
    state.lastUpdated = Date.now();
    const aqiVals = state.gridList.map(c => c.aqi);
    console.log(`[aqiCache] Refresh (fallback) complete. ${state.grid.size} cells, AQI range: ${Math.min(...aqiVals)}-${Math.max(...aqiVals)}`);
    return;
  }

  console.log(`[aqiCache] Refreshing grid (${state.gridList.length} cells)...`);
  const batchSize = 10;
  const updatedCells = [];

  for (let i = 0; i < state.gridList.length; i += batchSize) {
    const batch = state.gridList.slice(i, i + batchSize);
    const batchPromises = batch.map(async (cell) => {
      try {
        let result;
        if (!cell.aqi || cell._fallback || Math.random() < 0.3) {
          result = await lookupCurrentConditions(cell.lat, cell.lng);
        } else {
          result = { aqi: cell.aqi, band: cell.band, category: cell.category };
        }
        return {
          ...cell,
          aqi: result.aqi,
          band: result.band,
          category: result.category,
          _fallback: result._fallback || false,
          updatedAt: Date.now(),
        };
      } catch (err) {
        const fallback = getFallbackAqi(cell.lat, cell.lng);
        return {
          ...cell,
          aqi: fallback.aqi,
          band: fallback.band,
          category: fallback.category,
          _fallback: true,
          updatedAt: Date.now(),
        };
      }
    });

    try {
      const batchResults = await Promise.all(batchPromises);
      updatedCells.push(...batchResults);
    } catch (batchErr) {
      for (const cell of batch) {
        const fb = getFallbackAqi(cell.lat, cell.lng);
        updatedCells.push({
          ...cell,
          aqi: fb.aqi,
          band: fb.band,
          category: fb.category,
          _fallback: true,
          updatedAt: Date.now(),
        });
      }
    }

    if (i + batchSize < state.gridList.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  state.grid.clear();
  for (const cell of updatedCells) {
    state.grid.set(cell.key, cell);
  }
  state.gridList = updatedCells;
  state.lastUpdated = Date.now();
  state.isReady = true;

  const aqiVals = updatedCells.map(c => c.aqi);
  console.log(`[aqiCache] Refresh complete. ${state.grid.size} cells, AQI range: ${Math.min(...aqiVals)}-${Math.max(...aqiVals)}`);
}

async function init() {
  const cells = buildGridCells(CENTER_LAT, CENTER_LNG, DEFAULT_GRID_RADIUS_KM);
  state.gridList = cells.map((cell) => {
    const initial = getFallbackAqi(cell.lat, cell.lng);
    return {
      ...cell,
      aqi: initial.aqi,
      band: initial.band,
      category: initial.category,
      _fallback: true,
      updatedAt: Date.now(),
    };
  });

  for (const cell of state.gridList) {
    state.grid.set(cell.key, cell);
  }

  state.lastUpdated = Date.now();
  state.isReady = true;

  const keyConfigured = GOOGLE_MAPS_API_KEY && !GOOGLE_MAPS_API_KEY.startsWith('your_');
  console.log(
    `[aqiCache] Initialized with ${state.gridList.length} fallback cells. ` +
    `Live refresh: ${keyConfigured ? 'ENABLED (Google API)' : 'DISABLED (fallback/demo mode)'}`
  );

  setImmediate(() => {
    refreshGrid().catch((err) => {
      console.error('[aqiCache] Initial refresh failed (using fallback):', err.message);
    });
  });

  const cronExpr = `*/${REFRESH_MINUTES} * * * *`;
  cron.schedule(cronExpr, () => {
    refreshGrid().catch((err) => {
      console.error('[aqiCache] Scheduled refresh failed:', err.message);
    });
  });

  return true;
}

function getGrid() {
  return state.gridList.map((c) => ({
    lat: c.lat,
    lng: c.lng,
    aqi: c.aqi,
    band: c.band,
    category: c.category,
  }));
}

function getCellCount() {
  return state.grid.size;
}

function isReady() {
  return state.isReady;
}

function getLastUpdated() {
  return state.lastUpdated;
}

function getCellSize() {
  return state.cellSizeMeters;
}

module.exports = {
  init,
  refreshGrid,
  lookup,
  getGrid,
  getCellCount,
  isReady,
  getLastUpdated,
  getCellSize,
};
