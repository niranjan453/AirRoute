const express = require('express');
const router = express.Router();

const { PROFILE_SENSITIVITY } = require('../services/exposureScoring');

let routeModuleStore = null;
try {
  const routeMod = require('./route');
  if (routeMod && routeMod.getStore) routeModuleStore = routeMod.getStore;
} catch (e) {}

router.post('/', (req, res) => {
  const { routeId, profile = 'normal', route } = req.body;

  let routeData = route;
  if (!routeData && routeId && routeModuleStore) {
    routeData = routeModuleStore()[routeId];
  }

  if (!routeData) {
    return res.status(404).json({
      error: 'Route not found',
      message: 'Provide route data in the request body with the "route" field.',
    });
  }

  const profileInfo = PROFILE_SENSITIVITY[profile] || PROFILE_SENSITIVITY.normal;
  const hotspots = routeData.hotspots || [];
  const exposureBand = routeData.exposureBand || 'Low';
  const peakAqi = routeData.peakAqi || 0;
  const avgAqi = routeData.avgAqi || 0;
  const durationSeconds = routeData.durationSeconds || 0;
  const durationMinutes = Math.round(durationSeconds / 60);
  const distanceKm = (routeData.distanceMeters || 0) / 1000;
  const hasHotspotWarning =
    routeData.hasHotspotWarning || (Array.isArray(hotspots) && hotspots.length > 0);

  const advisory = generateAdvisory({
    profile,
    profileInfo,
    hotspots,
    exposureBand,
    peakAqi,
    avgAqi,
    durationMinutes,
    hasHotspotWarning,
    distanceKm,
  });

  res.json({
    routeId: routeId || (routeData && routeData.id),
    profile,
    advisory,
  });
});

function generateAdvisory({
  profile, profileInfo, hotspots, exposureBand, peakAqi, avgAqi,
  durationMinutes, hasHotspotWarning, distanceKm,
}) {
  const lines = [];
  const severity = hasHotspotWarning ? 'high' : exposureBand.toLowerCase();

  if (severity === 'low') {
    if (profile === 'normal') {
      lines.push('✅ Air quality is good along this route.');
      lines.push('No special precautions needed.');
    } else {
      lines.push('✅ Air quality is good along this route.');
      lines.push(`Your ${profileInfo.label.toLowerCase()} profile should be fine. Enjoy the trip.`);
    }
  } else if (severity === 'moderate') {
    if (profile === 'normal') {
      lines.push('ℹ️ Air quality is moderate along this route.');
      lines.push('If you have respiratory sensitivity, consider a mask.');
    } else if (profile === 'asthma') {
      lines.push('ℹ️ Air quality is moderate.');
      lines.push('As a respiratory patient, wear a mask and carry your inhaler.');
    } else if (profile === 'child') {
      lines.push('ℹ️ Air quality is moderate along this route.');
      lines.push('For children: consider a light mask on sensitive days.');
    } else {
      lines.push('ℹ️ Air quality is moderate along this route.');
      lines.push(`Your ${profileInfo.label.toLowerCase()} profile has elevated sensitivity — stay hydrated.`);
    }
  } else {
    if (profile === 'normal') {
      lines.push('⚠️ Air quality is poor along part of this route.');
      lines.push('Consider a mask if you have respiratory sensitivity.');
    } else if (profile === 'child') {
      lines.push('⚠️ Air quality is poor along part of this route.');
      lines.push('For children: use a N95 mask and minimize outdoor walk segments if possible.');
    } else if (profile === 'elderly') {
      lines.push('⚠️ Air quality is poor along part of this route.');
      lines.push('For elderly users: wear a N95 mask and avoid prolonged outdoor exposure.');
    } else if (profile === 'asthma') {
      lines.push('⚠️ Air quality is poor along part of this route.');
      lines.push('Wear a N95 mask and ensure you have your rescue inhaler accessible.');
      lines.push('If symptoms worsen, seek shelter indoors immediately.');
    } else if (profile === 'pregnant') {
      lines.push('⚠️ Air quality is poor along part of this route.');
      lines.push('Wear a mask and consider limiting exposure duration.');
    } else {
      lines.push('⚠️ Air quality is poor along part of this route.');
      lines.push('Wear a mask and minimize outdoor time where possible.');
    }
  }

  if (hotspots.length > 0) {
    lines.push('');
    lines.push(`🚨 ${hotspots.length} hotspot segment${hotspots.length > 1 ? 's' : ''} detected:`);
    hotspots.forEach((hs, i) => {
      const progressPct = distanceKm > 0
        ? Math.min(100, Math.round((hs.startDistance / 1000) / distanceKm * 100))
        : 50;
      const estArrivalMin = Math.max(0, Math.round((progressPct / 100) * durationMinutes));
      lines.push(
        `   • Segment ${i + 1}: Peak AQI ${hs.peakAqi} (${aqiLabel(hs.peakAqi)}) ` +
        `around ${(hs.startDistance / 1000).toFixed(1)}km into the route (ETA ~${estArrivalMin} min)`
      );
    });
  }

  lines.push('');
  lines.push('📊 Route AQI summary:');
  lines.push(`   • Average AQI: ${avgAqi} (${aqiLabel(avgAqi)})`);
  lines.push(`   • Peak AQI: ${peakAqi} (${aqiLabel(peakAqi)})`);
  lines.push(`   • Distance: ${distanceKm.toFixed(1)} km`);
  lines.push(`   • Travel time: ~${durationMinutes} min`);
  lines.push(`   • Exposure level: ${exposureBand}`);
  lines.push(`   • Profile sensitivity: ${profileInfo.label} (hotspot threshold AQI > ${profileInfo.hotSpotThreshold})`);

  if (hasHotspotWarning) {
    lines.push('');
    lines.push(
      '💡 Tip: The recommended route already minimizes exposure. ' +
      'If you have concerns, consider rescheduling travel or using a mode of transport ' +
      'with closed windows and cabin air filtration (e.g., AC vehicle with recirculation).'
    );
  }

  return lines.join('\n');
}

function aqiLabel(aqi) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

module.exports = router;
