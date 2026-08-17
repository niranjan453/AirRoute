"use strict";

// ============================================================
// AIRROUTE - U.S. EPA AQI ESTIMATOR
// ============================================================
//
// Uses the U.S. EPA/AirNow AQI breakpoint framework.
//
// IMPORTANT:
// OpenAQ gives current/latest pollutant observations, not the
// official EPA averaging windows. Therefore this module produces
// a CURRENT OBSERVATION ESTIMATE using EPA breakpoints. It must
// not be presented as an official regulatory AQI reading.
//
// WAQI already publishes an AQI on the U.S. EPA scale, so this
// module is primarily used for OpenAQ concentration data.
// ============================================================

const MAX_AQI = 500;
const STANDARD = "US_EPA_ESTIMATE";

const BREAKPOINTS = {
  pm25: [
    [0.0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500],
  ],
  pm10: [
    [0, 54, 0, 50],
    [55, 154, 51, 100],
    [155, 254, 101, 150],
    [255, 354, 151, 200],
    [355, 424, 201, 300],
    [425, 604, 301, 500],
  ],
  o3: [
    [0.000, 0.054, 0, 50],
    [0.055, 0.070, 51, 100],
    [0.071, 0.085, 101, 150],
    [0.086, 0.105, 151, 200],
    [0.106, 0.200, 201, 300],
  ],
  co: [
    [0.0, 4.4, 0, 50],
    [4.5, 9.4, 51, 100],
    [9.5, 12.4, 101, 150],
    [12.5, 15.4, 151, 200],
    [15.5, 30.4, 201, 300],
    [30.5, 40.4, 301, 400],
    [40.5, 50.4, 401, 500],
  ],
  so2: [
    [0, 35, 0, 50],
    [36, 75, 51, 100],
    [76, 185, 101, 150],
    [186, 304, 151, 200],
    [305, 604, 201, 300],
    [605, 804, 301, 400],
    [805, 1004, 401, 500],
  ],
  no2: [
    [0, 53, 0, 50],
    [54, 100, 51, 100],
    [101, 360, 101, 150],
    [361, 649, 151, 200],
    [650, 1249, 201, 300],
    [1250, 1649, 301, 400],
    [1650, 2049, 401, 500],
  ],
};

function getAqiCategory(aqi) {
  const value = Number(aqi);

  if (!Number.isFinite(value)) {
    return null;
  }

  if (value <= 50) {
    return { min: 0, max: 50, label: "Good", color: "green" };
  }
  if (value <= 100) {
    return { min: 51, max: 100, label: "Moderate", color: "yellow" };
  }
  if (value <= 150) {
    return {
      min: 101,
      max: 150,
      label: "Unhealthy for Sensitive Groups",
      color: "orange",
    };
  }
  if (value <= 200) {
    return { min: 151, max: 200, label: "Unhealthy", color: "red" };
  }
  if (value <= 300) {
    return { min: 201, max: 300, label: "Very Unhealthy", color: "purple" };
  }

  return { min: 301, max: 500, label: "Hazardous", color: "maroon" };
}

function linearAqi(concentration, low, high, aqiLow, aqiHigh) {
  return (
    ((aqiHigh - aqiLow) / (high - low)) *
      (concentration - low) +
    aqiLow
  );
}

function truncateConcentration(parameter, value) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }

  const numeric = Number(value);

  // EPA concentration truncation conventions used for AQI.
  if (parameter === "pm25") return Math.floor(numeric * 10) / 10;
  if (parameter === "pm10") return Math.floor(numeric);
  if (parameter === "o3") return Math.floor(numeric * 1000) / 1000;
  if (parameter === "co") return Math.floor(numeric * 10) / 10;
  if (parameter === "so2" || parameter === "no2") return Math.floor(numeric);

  return numeric;
}

function calculateSubIndex(parameter, rawValue) {
  const value = truncateConcentration(parameter, Number(rawValue));

  if (value === null) return null;

  const ranges = BREAKPOINTS[parameter];
  if (!ranges) return null;

  for (const [low, high, aqiLow, aqiHigh] of ranges) {
    if (value >= low && value <= high) {
      return Math.round(linearAqi(value, low, high, aqiLow, aqiHigh));
    }
  }

  // Values above the published 500 breakpoint are capped at 500.
  if (value > ranges[ranges.length - 1][1]) {
    return MAX_AQI;
  }

  return null;
}

function ugM3ToPpb(value, molecularWeight) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return (numeric * 24.45) / molecularWeight;
}

function ugM3ToPpm(value, molecularWeight) {
  const ppb = ugM3ToPpb(value, molecularWeight);
  return ppb === null ? null : ppb / 1000;
}

function normalizePollutants(input = {}) {
  const normalized = {};

  for (const key of ["pm25", "pm10", "o3", "co", "so2", "no2"]) {
    const value = Number(input[key]);
    if (Number.isFinite(value)) normalized[key] = value;
  }

  return normalized;
}

function calculateUsEpaAqi(pollutants = {}, options = {}) {
  const normalized = normalizePollutants(pollutants);
  const subIndices = {};

  if (normalized.pm25 !== undefined) {
    subIndices.pm25 = calculateSubIndex("pm25", normalized.pm25);
  }

  if (normalized.pm10 !== undefined) {
    subIndices.pm10 = calculateSubIndex("pm10", normalized.pm10);
  }

  // OpenAQ commonly supplies gases as µg/m³. Convert using the
  // standard 25°C/1-atm molar-volume approximation.
  if (normalized.o3 !== undefined) {
    const ppm = ugM3ToPpm(normalized.o3, 48.00);
    subIndices.o3 = calculateSubIndex("o3", ppm);
  }

  if (normalized.co !== undefined) {
    const coPpm =
      options.coUnit === "ppm"
        ? normalized.co
        : options.coUnit === "mg/m3"
        ? normalized.co / 1.145
        : ugM3ToPpm(normalized.co, 28.01);

    subIndices.co = calculateSubIndex("co", coPpm);
  }

  if (normalized.so2 !== undefined) {
    const ppb = ugM3ToPpb(normalized.so2, 64.066);
    subIndices.so2 = calculateSubIndex("so2", ppb);
  }

  if (normalized.no2 !== undefined) {
    const ppb = ugM3ToPpb(normalized.no2, 46.0055);
    subIndices.no2 = calculateSubIndex("no2", ppb);
  }

  const valid = Object.entries(subIndices).filter(([, value]) =>
    Number.isFinite(Number(value))
  );

  if (valid.length === 0) {
    return {
      aqi: null,
      standard: STANDARD,
      estimate: true,
      category: null,
      dominantPollutant: null,
      pollutants: normalized,
      subIndices: {},
      validPollutants: 0,
      confidence: "none",
      averagingPeriod: "current-observation",
      warning:
        "Current OpenAQ observations are mapped to U.S. EPA AQI breakpoints; official EPA AQI requires pollutant-specific averaging periods.",
    };
  }

  valid.sort((a, b) => Number(b[1]) - Number(a[1]));
  const dominantPollutant = valid[0][0];
  const aqi = Math.min(MAX_AQI, Math.max(0, Number(valid[0][1])));

  let confidence = "low";
  const particulate = normalized.pm25 !== undefined || normalized.pm10 !== undefined;
  if (valid.length >= 4 && particulate) confidence = "high";
  else if (valid.length >= 2 && particulate) confidence = "medium";

  return {
    aqi: Math.round(aqi),
    standard: STANDARD,
    estimate: true,
    category: getAqiCategory(aqi),
    dominantPollutant,
    pollutants: normalized,
    subIndices,
    validPollutants: valid.length,
    confidence,
    averagingPeriod: options.averagingPeriod || "current-observation",
    warning:
      "Current OpenAQ observations are mapped to U.S. EPA AQI breakpoints; official EPA AQI requires pollutant-specific averaging periods.",
  };
}

module.exports = {
  BREAKPOINTS,
  MAX_AQI,
  STANDARD,
  getAqiCategory,
  calculateSubIndex,
  calculateUsEpaAqi,
  normalizePollutants,
};
