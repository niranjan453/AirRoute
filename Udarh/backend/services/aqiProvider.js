const AQI_BANDS = {
  GOOD: { min: 0, max: 50, label: "Good", color: "green" },
  MODERATE: { min: 51, max: 100, label: "Moderate", color: "yellow" },
  UNHEALTHY_SENSITIVE: {
    min: 101,
    max: 150,
    label: "Unhealthy for Sensitive Groups",
    color: "orange",
  },
  UNHEALTHY: {
    min: 151,
    max: 200,
    label: "Unhealthy",
    color: "red",
  },
  VERY_UNHEALTHY: {
    min: 201,
    max: 300,
    label: "Very Unhealthy",
    color: "purple",
  },
  HAZARDOUS: {
    min: 301,
    max: 500,
    label: "Hazardous",
    color: "maroon",
  },
};

function getAqiBand(aqi) {
  if (aqi <= 50) return AQI_BANDS.GOOD;
  if (aqi <= 100) return AQI_BANDS.MODERATE;
  if (aqi <= 150) return AQI_BANDS.UNHEALTHY_SENSITIVE;
  if (aqi <= 200) return AQI_BANDS.UNHEALTHY;
  if (aqi <= 300) return AQI_BANDS.VERY_UNHEALTHY;
  return AQI_BANDS.HAZARDOUS;
}

function getFallbackAqi(lat, lng) {
  const seed = Math.abs(
    Math.sin(lat * 12.9898 + lng * 78.233) * 43758.5453
  );

  const noise = seed - Math.floor(seed);

  const aqi = 30 + Math.floor(noise * 200);

  return {
    aqi,
    band: getAqiBand(aqi),
    category: getAqiBand(aqi).label,
    _fallback: true,
  };
}

/**
 * Day 2
 * Temporary AQI provider.
 * Google Air Quality API removed.
 * Day 3 will replace this with a real provider.
 */
async function lookupCurrentConditions(lat, lng) {
  return getFallbackAqi(lat, lng);
}

module.exports = {
  lookupCurrentConditions,
  getFallbackAqi,
  getAqiBand,
  AQI_BANDS,
};