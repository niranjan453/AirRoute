const { decode } = require('@googlemaps/polyline-codec');

const { lookupCurrentConditions, getFallbackAqi, getAqiBand } = require('./aqiProvider');
const aqiCache = require('./aqiCache');

const PROFILE_SENSITIVITY = {
  normal: { hotSpotThreshold: 200, label: 'Normal' },
  child: { hotSpotThreshold: 150, label: 'Child' },
  elderly: { hotSpotThreshold: 150, label: 'Elderly' },
  asthma: { hotSpotThreshold: 150, label: 'Asthma / Respiratory' },
  pregnant: { hotSpotThreshold: 175, label: 'Pregnant' },
};

function sampleRoutePoints(polyline, sampleIntervalMeters = 400) {
  const decoded = decode(polyline, 5);
  if (decoded.length < 2) return [];

  const samples = [];
  let accumulatedDistance = 0;

  for (let i = 0; i < decoded.length; i++) {
    const point = { lat: decoded[i][0], lng: decoded[i][1] };

    if (i === 0) {
      samples.push({ ...point, distanceAlongRoute: 0 });
      continue;
    }

    const prevPoint = decoded[i - 1];
    const segmentDistance = haversineDistanceMeters(
      prevPoint[0], prevPoint[1],
      point.lat, point.lng
    );
    accumulatedDistance += segmentDistance;

    let lastSample = samples[samples.length - 1];
    let lastDist = lastSample.distanceAlongRoute;

    while (accumulatedDistance - lastDist >= sampleIntervalMeters) {
      const interpolateFactor = ((lastDist + sampleIntervalMeters) - (accumulatedDistance - segmentDistance)) / segmentDistance;
      const newLat = prevPoint[0] + interpolateFactor * (point.lat - prevPoint[0]);
      const newLng = prevPoint[1] + interpolateFactor * (point.lng - prevPoint[1]);
      lastDist += sampleIntervalMeters;
      samples.push({ lat: newLat, lng: newLng, distanceAlongRoute: lastDist });
      lastSample = samples[samples.length - 1];
    }
  }

  const last = decoded[decoded.length - 1];
  samples.push({ lat: last[0], lng: last[1], distanceAlongRoute: accumulatedDistance });

  return { points: samples, totalDistanceMeters: accumulatedDistance };
}

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

function getAqiForPoint(lat, lng) {
  const cached = aqiCache.lookup(lat, lng);
  if (cached) {
    return cached;
  }
  return getFallbackAqi(lat, lng);
}

async function lookupLiveAqiForPoints(points) {
  const results = [];
  for (const point of points) {
    const cached = aqiCache.lookup(point.lat, point.lng);
    if (cached) {
      results.push({ ...point, aqi: cached.aqi, aqiBand: cached.band });
    } else {
      const live = await lookupCurrentConditions(point.lat, point.lng);
      results.push({ ...point, aqi: live.aqi, aqiBand: live.band });
    }
  }
  return results;
}

function computeExposureScore(sampledPointsWithAqi, routeDurationSeconds, totalDistanceMeters, profileType = 'normal') {
  const profile = PROFILE_SENSITIVITY[profileType] || PROFILE_SENSITIVITY.normal;
  const hotSpotThreshold = profile.hotSpotThreshold;

  if (sampledPointsWithAqi.length === 0) {
    return {
      exposureScore: 0,
      peakAqi: 0,
      avgAqi: 0,
      exposureBand: 'Low',
      hotspots: [],
      hasHotspotWarning: false,
    };
  }

  let exposureScore = 0;
  let peakAqi = 0;
  let totalTime = 0;
  const hotspots = [];
  let currentHotspot = null;

  for (let i = 0; i < sampledPointsWithAqi.length; i++) {
    const point = sampledPointsWithAqi[i];
    const aqi_i = point.aqi;

    let segmentDistance;
    if (i < sampledPointsWithAqi.length - 1) {
      segmentDistance = sampledPointsWithAqi[i + 1].distanceAlongRoute - point.distanceAlongRoute;
    } else {
      segmentDistance = totalDistanceMeters - point.distanceAlongRoute;
    }

    const t_i = totalDistanceMeters > 0
      ? (segmentDistance / totalDistanceMeters) * routeDurationSeconds
      : routeDurationSeconds / sampledPointsWithAqi.length;

    exposureScore += aqi_i * t_i;
    totalTime += t_i;

    if (aqi_i > peakAqi) peakAqi = aqi_i;

    if (aqi_i > hotSpotThreshold) {
      if (!currentHotspot) {
        currentHotspot = {
          startDistance: point.distanceAlongRoute,
          startLat: point.lat,
          startLng: point.lng,
          peakAqi: aqi_i,
          label: `High AQI ${Math.round(point.distanceAlongRoute / 1000)}km in`,
        };
      } else {
        if (aqi_i > currentHotspot.peakAqi) currentHotspot.peakAqi = aqi_i;
      }
    } else if (currentHotspot) {
      const prevPoint = sampledPointsWithAqi[i - 1];
      currentHotspot.endDistance = prevPoint.distanceAlongRoute;
      currentHotspot.endLat = prevPoint.lat;
      currentHotspot.endLng = prevPoint.lng;
      hotspots.push({ ...currentHotspot });
      currentHotspot = null;
    }
  }

  if (currentHotspot) {
    const last = sampledPointsWithAqi[sampledPointsWithAqi.length - 1];
    currentHotspot.endDistance = last.distanceAlongRoute;
    currentHotspot.endLat = last.lat;
    currentHotspot.endLng = last.lng;
    hotspots.push({ ...currentHotspot });
  }

  const exposureScorePerHour = totalTime > 0 ? (exposureScore / totalTime) : 0;
  let exposureBand;
  if (exposureScorePerHour < 100) exposureBand = 'Low';
  else if (exposureScorePerHour < 200) exposureBand = 'Moderate';
  else exposureBand = 'High';

  const hasHotspotWarning = peakAqi > 200 || (profileType !== 'normal' && peakAqi > hotSpotThreshold);

  return {
    exposureScore,
    exposureScorePerHour: Math.round(exposureScorePerHour),
    peakAqi,
    avgAqi: Math.round(sampledPointsWithAqi.reduce((s, p) => s + p.aqi, 0) / sampledPointsWithAqi.length),
    exposureBand,
    hotspots,
    hasHotspotWarning,
  };
}

async function scoreRoute(route, profileType) {
  const { points: sampledPoints, totalDistanceMeters } = sampleRoutePoints(route.polyline, 400);
  const pointsWithAqi = await lookupLiveAqiForPoints(sampledPoints);
  const exposure = computeExposureScore(
    pointsWithAqi,
    route.durationSeconds,
    totalDistanceMeters,
    profileType
  );

  return {
    ...route,
    exposureScore: exposure.exposureScore,
    exposureScorePerHour: exposure.exposureScorePerHour,
    peakAqi: exposure.peakAqi,
    avgAqi: exposure.avgAqi,
    exposureBand: exposure.exposureBand,
    hotspots: exposure.hotspots,
    hasHotspotWarning: exposure.hasHotspotWarning,
    sampledAqiPoints: pointsWithAqi.map((p) => ({
      lat: p.lat, lng: p.lng, aqi: p.aqi,
      distanceAlongRoute: p.distanceAlongRoute,
    })),
  };
}

function sortRoutesByExposure(routes) {
  return [...routes].sort((a, b) => {
    if (a.hasHotspotWarning && !b.hasHotspotWarning) return 1;
    if (!a.hasHotspotWarning && b.hasHotspotWarning) return -1;
    return a.exposureScore - b.exposureScore;
  });
}

module.exports = {
  sampleRoutePoints,
  computeExposureScore,
  scoreRoute,
  sortRoutesByExposure,
  PROFILE_SENSITIVITY,
  haversineDistanceMeters,
  getAqiForPoint,
  lookupLiveAqiForPoints,
};
