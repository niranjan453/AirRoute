const express = require('express');
const router = express.Router();

const { getDirections, geocode } = require('../services/googleDirections');
const { scoreRoute, sortRoutesByExposure, PROFILE_SENSITIVITY } = require('../services/exposureScoring');
const { encode } = require('@googlemaps/polyline-codec');

let storedRoutes = {};

function parseOriginDest(origin, destination) {
  const parse = (v) => {
    if (!v) return null;
    if (typeof v === 'object' && v.lat) return { lat: parseFloat(v.lat), lng: parseFloat(v.lng) };
    if (typeof v === 'string') {
      const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    }
    return null;
  };
  return { o: parse(origin), d: parse(destination) };
}

function generateMockRoutes(origin, destination) {
  let { o, d } = parseOriginDest(origin, destination);
  if (!o) o = { lat: 28.6139, lng: 77.2090 };
  if (!d) d = { lat: 28.5971, lng: 77.3162 };

  function mkPts(start, end, n, jitter) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const lat = start.lat + (end.lat - start.lat) * t + (Math.sin(t * Math.PI * 4) * jitter);
      const lng = start.lng + (end.lng - start.lng) * t + (Math.cos(t * Math.PI * 3) * jitter);
      pts.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
    }
    return pts;
  }

  const route1Pts = mkPts(o, d, 30, 0.0015);
  const route2Pts = mkPts(o, d, 28, -0.0035);
  const route3Pts = mkPts(o, d, 32, 0.0055);

  const legFor = (pts, factorSecs, factorMeters) => {
    const distanceMeters = Math.round(8000 * factorMeters + Math.random() * 1000);
    const durationSeconds = Math.round(900 * factorSecs + Math.random() * 300);
    const steps = [];
    for (let i = 0; i < 4; i++) {
      const startIdx = Math.floor((i / 4) * (pts.length - 1));
      const endIdx = Math.floor(((i + 1) / 4) * (pts.length - 1));
      steps.push({
        distanceMeters: Math.round(distanceMeters / 4),
        durationSeconds: Math.round(durationSeconds / 4),
        startLocation: { lat: pts[startIdx][0], lng: pts[startIdx][1] },
        endLocation: { lat: pts[endIdx][0], lng: pts[endIdx][1] },
        polyline: encode(pts.slice(startIdx, endIdx + 1), 5),
        htmlInstructions: `Step ${i + 1}: Continue straight`,
      });
    }
    return {
      startAddress: 'Origin (mock)',
      endAddress: 'Destination (mock)',
      startLocation: { lat: pts[0][0], lng: pts[0][1] },
      endLocation: { lat: pts[pts.length - 1][0], lng: pts[pts.length - 1][1] },
      distanceMeters,
      durationSeconds,
      steps,
    };
  };

  return [
    {
      id: `mock-fast-${Date.now()}`,
      summary: 'Fastest via Ring Road',
      distanceMeters: 9500,
      durationSeconds: 1050,
      polyline: encode(route1Pts, 5),
      legs: [legFor(route1Pts, 1.0, 1.0)],
      warnings: [],
    },
    {
      id: `mock-clean-${Date.now()}`,
      summary: 'Scenic via Green Belt',
      distanceMeters: 11000,
      durationSeconds: 1320,
      polyline: encode(route2Pts, 5),
      legs: [legFor(route2Pts, 1.26, 1.18)],
      warnings: [],
    },
    {
      id: `mock-alt-${Date.now()}`,
      summary: 'Alternate via Sector Road',
      distanceMeters: 10200,
      durationSeconds: 1200,
      polyline: encode(route3Pts, 5),
      legs: [legFor(route3Pts, 1.14, 1.08)],
      warnings: [],
    },
  ];
}

function parseLatLng(v) {
  if (typeof v === 'object' && v.lat != null) return { lat: Number(v.lat), lng: Number(v.lng) };
  if (typeof v === 'string') {
    const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return { lat: 28.6139, lng: 77.2090 };
}

function generateMockGeocode(address) {
  const seed = Math.abs(
    Math.sin(
      [...address].reduce((a, c) => a + c.charCodeAt(0), 0) * 12.9898
    ) * 43758.5453
  );
  const noise = seed - Math.floor(seed);
  return {
    lat: 28.5 + noise * 0.25,
    lng: 77.1 + noise * 0.25,
    formattedAddress: address || 'Mock Address, Delhi',
    placeId: `mock-${Math.floor(seed * 1e6)}`,
    _mock: true,
  };
}

router.post('/', async (req, res, next) => {
  try {
    const { origin, destination, profile = 'normal' } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'origin and destination are required',
      });
    }

    const validProfiles = Object.keys(PROFILE_SENSITIVITY);
    if (!validProfiles.includes(profile)) {
      return res.status(400).json({
        error: 'Invalid profile',
        message: `profile must be one of: ${validProfiles.join(', ')}`,
      });
    }

    let rawRoutes;
let mockMode = false;

try {
  // Convert address strings to coordinates using Nominatim
  const originCoords =
    typeof origin === "string" ? await geocode(origin) : origin;

  const destinationCoords =
    typeof destination === "string" ? await geocode(destination) : destination;

  rawRoutes = await getDirections(originCoords, destinationCoords);

} catch (dirErr) {
  mockMode = true;

  console.log(
    `[routes] Routing failed (${dirErr.message}). Falling back to mock routes.`
  );

  rawRoutes = generateMockRoutes(origin, destination);
}

    if (!rawRoutes || rawRoutes.length === 0) {
      rawRoutes = generateMockRoutes(origin, destination);
      mockMode = true;
    }

    const scoredRoutes = [];
    for (const route of rawRoutes) {
      try {
        const scored = await scoreRoute(route, profile);
        scoredRoutes.push(scored);
      } catch (scoringErr) {
        console.warn(`[routes] Scoring failed for route ${route.id}: ${scoringErr.message}. Keeping raw values.`);
        scoredRoutes.push({
          ...route,
          exposureScore: 50000,
          exposureScorePerHour: 120,
          peakAqi: 140,
          avgAqi: 90,
          exposureBand: 'Moderate',
          hotspots: [],
          hasHotspotWarning: false,
          sampledAqiPoints: [],
        });
      }
    }

    const sortedRoutes = sortRoutesByExposure(scoredRoutes);
    const recommendedId = sortedRoutes[0].id;

    const finalRoutes = sortedRoutes.map((r, idx) => ({
      ...r,
      rank: idx + 1,
      isRecommended: idx === 0,
    }));

    for (const r of finalRoutes) {
      storedRoutes[r.id] = r;
    }

    const { o: oParsed, d: dParsed } = (() => {
      try {
        return { o: parseLatLng(origin), d: parseLatLng(destination) };
      } catch (e) {
        return {
          o: { lat: 28.6139, lng: 77.2090 },
          d: { lat: 28.5971, lng: 77.3162 },
        };
      }
    })();

    res.json({
      origin: typeof origin === 'string' ? origin : oParsed,
      destination: typeof destination === 'string' ? destination : dParsed,
      profile,
      recommendedId,
      count: finalRoutes.length,
      mockMode,
      originParsed: oParsed,
      destinationParsed: dParsed,
      routes: finalRoutes,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/geocode', async (req, res, next) => {
  try {
    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ error: 'address is required' });
    }
    try {
      const result = await geocode(address);
      return res.json(result);
    } catch (geoErr) {
      console.log(`[routes] Geocoding API failed (${geoErr.message}). Using mock geocoder.`);
      return res.json(generateMockGeocode(address));
    }
  } catch (error) {
    next(error);
  }
});

router.get('/:routeId', (req, res) => {
  const { routeId } = req.params;
  const route = storedRoutes[routeId];
  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }
  res.json(route);
});

router._store = storedRoutes;
router.getStore = () => storedRoutes;

module.exports = router;
