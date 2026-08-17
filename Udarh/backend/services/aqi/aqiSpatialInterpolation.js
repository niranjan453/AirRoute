"use strict";

// ============================================================
// AIRROUTE - AQI SPATIAL INTERPOLATION
// ============================================================
//
// Flow:
//
// AQI Stations
//      ↓
// Station AQI + coordinates
//      ↓
// Find nearest stations
//      ↓
// Distance-weighted interpolation
//      ↓
// AQI for route point
//
// This module DOES NOT fetch AQI data.
// It works with already calculated station AQI values.
// ============================================================

// ============================================================
// CONFIG
// ============================================================

const DEFAULT_MAX_DISTANCE_METERS = Number(
  process.env.AQI_INTERPOLATION_MAX_DISTANCE_METERS ||
    25000
);

const DEFAULT_MIN_STATIONS = Number(
  process.env.AQI_MIN_NEARBY_STATIONS ||
    2
);

const DEFAULT_MAX_STATIONS = Number(
  process.env.AQI_MAX_NEARBY_STATIONS ||
    5
);

const DISTANCE_POWER = 2;

const MAX_AQI = 500;

// ============================================================
// AQI CATEGORY
// ============================================================

function getAqiCategory(aqi) {
  const value = Number(aqi);

  if (!Number.isFinite(value)) {
    return null;
  }

  if (value <= 50) {
    return {
      min: 0,
      max: 50,
      label: "Good",
      color: "green",
    };
  }

  if (value <= 100) {
    return {
      min: 51,
      max: 100,
      label: "Moderate",
      color: "yellow",
    };
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
    return {
      min: 151,
      max: 200,
      label: "Unhealthy",
      color: "red",
    };
  }

  if (value <= 300) {
    return {
      min: 201,
      max: 300,
      label: "Very Unhealthy",
      color: "purple",
    };
  }

  return {
    min: 301,
    max: 500,
    label: "Hazardous",
    color: "maroon",
  };
}

// ============================================================
// VALIDATE COORDINATES
// ============================================================

function validateCoordinates(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    throw new Error(
      "Invalid latitude or longitude"
    );
  }

  if (
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error(
      "Latitude must be between -90 and 90"
    );
  }

  if (
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(
      "Longitude must be between -180 and 180"
    );
  }

  return {
    lat: latitude,
    lng: longitude,
  };
}

// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function calculateDistanceMeters(
  lat1,
  lng1,
  lat2,
  lng2
) {
  const R = 6371000;

  const toRadians = (value) =>
    (value * Math.PI) / 180;

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);

  const deltaPhi = toRadians(
    lat2 - lat1
  );

  const deltaLambda = toRadians(
    lng2 - lng1
  );

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

// ============================================================
// NORMALIZE STATION
// ============================================================

function normalizeStation(station) {
  if (!station) {
    return null;
  }

  const lat = Number(
    station?.lat ??
      station?.latitude ??
      station?.coordinates?.lat ??
      station?.coordinates?.latitude
  );

  const lng = Number(
    station?.lng ??
      station?.longitude ??
      station?.coordinates?.lng ??
      station?.coordinates?.longitude
  );

  const aqi = Number(
    station?.aqi
  );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(aqi)
  ) {
    return null;
  }

  return {
    stationId:
      station?.stationId ??
      station?.id ??
      null,

    stationName:
      station?.stationName ??
      station?.name ??
      "Unknown station",

    lat,

    lng,

    aqi: Math.min(
      Math.max(aqi, 0),
      MAX_AQI
    ),

    category:
      station?.category ??
      getAqiCategory(aqi),

    dominantPollutant:
      station?.dominantPollutant ??
      null,

    freshness:
      station?.freshness ??
      null,

    ageMinutes:
      Number.isFinite(
        Number(
          station?.ageMinutes
        )
      )
        ? Number(
            station.ageMinutes
          )
        : null,

    provider:
      station?.provider ??
      (
        String(
          station?.source ||
            "openaq"
        )
          .toLowerCase()
          .startsWith("waqi")
          ? "waqi"
          : "openaq"
      ),

    source:
      station?.source ??
      "openaq",

    standard:
      station?.standard ??
      (
        String(
          station?.provider ||
            station?.source ||
            ""
        )
          .toLowerCase()
          .includes("waqi")
          ? "US_EPA"
          : "US_EPA_ESTIMATE"
      ),

    fallbackUsed:
      station?.fallbackUsed ===
        true ||
      String(
        station?.provider ||
          ""
      )
        .toLowerCase() ===
        "waqi",

    isUsable:
      station?.isUsable !==
      false,

    dataQuality:
      station?.dataQuality ??
      null,
  };
}

// ============================================================
// VALID STATIONS
// ============================================================

function getValidStations(
  stations
) {
  if (
    !Array.isArray(
      stations
    )
  ) {
    return [];
  }

  return stations
    .map(
      normalizeStation
    )
    .filter(Boolean);
}

// ============================================================
// GET NEARBY STATIONS
// ============================================================

function getNearbyStations(
  point,
  stations,
  options = {}
) {
  const {
    maxDistanceMeters =
      DEFAULT_MAX_DISTANCE_METERS,

    maxStations =
      DEFAULT_MAX_STATIONS,

    excludeStale = true,
  } = options;

  const coordinate =
    validateCoordinates(
      point.lat,
      point.lng
    );

  const validStations =
    getValidStations(
      stations
    );

  return validStations
    .filter(
      (station) => {
        if (
          station.isUsable ===
          false
        ) {
          return false;
        }

        if (
          excludeStale &&
          (
            station.freshness ===
              "stale" ||
            station.freshness ===
              "invalid"
          )
        ) {
          return false;
        }

        return true;
      }
    )
    .map(
      (station) => ({
        ...station,

        distanceMeters:
          calculateDistanceMeters(
            coordinate.lat,
            coordinate.lng,
            station.lat,
            station.lng
          ),
      })
    )
    .filter(
      (station) =>
        station.distanceMeters <=
        maxDistanceMeters
    )
    .sort(
      (a, b) =>
        a.distanceMeters -
        b.distanceMeters
    )
    .slice(
      0,
      maxStations
    );
}

// ============================================================
// DISTANCE WEIGHT
// ============================================================

function calculateWeight(
  distanceMeters
) {
  const distanceKm =
    Math.max(
      distanceMeters / 1000,
      0.001
    );

  return (
    1 /
    Math.pow(
      distanceKm,
      DISTANCE_POWER
    )
  );
}

// ============================================================
// INTERPOLATE AQI
// ============================================================

function interpolateAqi(
  point,
  stations,
  options = {}
) {
  const {
    maxDistanceMeters =
      DEFAULT_MAX_DISTANCE_METERS,

    minStations =
      DEFAULT_MIN_STATIONS,

    maxStations =
      DEFAULT_MAX_STATIONS,

    excludeStale = true,
  } = options;

  const coordinate =
    validateCoordinates(
      point.lat,
      point.lng
    );

  const nearby =
    getNearbyStations(
      coordinate,
      stations,
      {
        maxDistanceMeters,
        maxStations,
        excludeStale,
      }
    );

  // ==========================================================
  // NO STATION AVAILABLE
  // ==========================================================

  if (
    nearby.length ===
    0
  ) {
    return {
      aqi: null,

      category: null,

      provider:
        "unknown",

      source:
        "unavailable",

      standard:
        "US_EPA_ESTIMATE",

      fallbackUsed:
        false,

      confidence:
        "none",

      stationCount: 0,

      nearestStationDistanceMeters:
        null,

      dominantPollutant:
        null,

      stations: [],
    };
  }

  // ==========================================================
  // VERY CLOSE STATION
  // ==========================================================

  const exactStation =
    nearby.find(
      (station) =>
        station.distanceMeters <=
        50
    );

  if (exactStation) {
    const aqi =
      Math.round(
        exactStation.aqi
      );

    const category =
      getAqiCategory(
        aqi
      );

    return {
      aqi,

      category,

      provider:
        exactStation.provider,

      source:
        exactStation.provider ===
        "waqi"
          ? "waqi-station"
          : "openaq-station",

      standard:
        exactStation.standard,

      fallbackUsed:
        exactStation.fallbackUsed,

      confidence:
        "high",

      stationCount:
        nearby.length,

      nearestStationDistanceMeters:
        Math.round(
          exactStation.distanceMeters
        ),

      dominantPollutant:
        exactStation.dominantPollutant,

      stations:
        nearby.map(
          (station) => ({
            stationId:
              station.stationId,

            stationName:
              station.stationName,

            distanceMeters:
              Math.round(
                station.distanceMeters
              ),

            aqi:
              station.aqi,

            weight:
              station ===
              exactStation
                ? 1
                : 0,

            freshness:
              station.freshness,

            ageMinutes:
              station.ageMinutes,
          })
        ),
    };
  }

  // ==========================================================
  // WEIGHTED INTERPOLATION
  // ==========================================================

  let weightedAqi = 0;

  let totalWeight = 0;

  const stationDetails =
    nearby.map(
      (station) => {
        const weight =
          calculateWeight(
            station.distanceMeters
          );

        weightedAqi +=
          station.aqi *
          weight;

        totalWeight +=
          weight;

        return {
          stationId:
            station.stationId,

          stationName:
            station.stationName,

          distanceMeters:
            Math.round(
              station.distanceMeters
            ),

          aqi:
            station.aqi,

          weight,

          freshness:
            station.freshness,

          ageMinutes:
            station.ageMinutes,
        };
      }
    );

  // ==========================================================
  // INVALID WEIGHT
  // ==========================================================

  if (
    totalWeight <= 0 ||
    !Number.isFinite(
      weightedAqi
    )
  ) {
    return {
      aqi: null,

      category: null,

      provider:
        "unknown",

      source:
        "unavailable",

      standard:
        "US_EPA_ESTIMATE",

      fallbackUsed:
        false,

      confidence:
        "none",

      stationCount: 0,

      nearestStationDistanceMeters:
        null,

      dominantPollutant:
        null,

      stations: [],
    };
  }

  // ==========================================================
  // FINAL INTERPOLATED AQI
  // ==========================================================

  const interpolated =
    weightedAqi /
    totalWeight;

  const aqi =
    Math.round(
      Math.min(
        Math.max(
          interpolated,
          0
        ),
        MAX_AQI
      )
    );

  const category =
    getAqiCategory(
      aqi
    );

  // ==========================================================
  // CONFIDENCE
  // ==========================================================

  const nearestDistance =
    nearby[0]
      .distanceMeters;

  let confidence =
    "low";

  if (
    nearby.length >= 3 &&
    nearestDistance <= 10000
  ) {
    confidence =
      "high";
  } else if (
    nearby.length >=
      minStations &&
    nearestDistance <= 15000
  ) {
    confidence =
      "medium";
  }

  // ==========================================================
  // DOMINANT POLLUTANT
  // ==========================================================

  const pollutantCounts =
    {};

  nearby.forEach(
    (station) => {
      if (
        station.dominantPollutant
      ) {
        const key =
          station.dominantPollutant;

        pollutantCounts[key] =
          (pollutantCounts[key] ||
            0) + 1;
      }
    }
  );

  const dominantPollutant =
    Object.entries(
      pollutantCounts
    ).sort(
      (a, b) =>
        b[1] - a[1]
    )[0]?.[0] ||
    null;

  // ==========================================================
  // RESULT
  // ==========================================================

  const providerSet =
    new Set(
      nearby
        .map(
          (station) =>
            station.provider
        )
        .filter(Boolean)
    );

  const provider =
    providerSet.size ===
    1
      ? Array.from(
          providerSet
        )[0]
      : "mixed";

  const fallbackUsed =
    nearby.some(
      (station) =>
        station.fallbackUsed ===
        true
    );

  return {
    aqi,

    category,

    provider,

    source:
      provider === "waqi"
        ? "waqi-spatial"
        : provider === "mixed"
        ? "mixed-spatial"
        : "openaq-spatial",

    standard:
      provider === "waqi"
        ? "US_EPA"
        : "US_EPA_ESTIMATE",

    fallbackUsed,

    confidence,

    stationCount:
      nearby.length,

    nearestStationDistanceMeters:
      Math.round(
        nearestDistance
      ),

    dominantPollutant,

    stations:
      stationDetails,
  };
}

// ============================================================
// INTERPOLATE ROUTE SAMPLES
// ============================================================

function interpolateRouteSamples(
  routeSamples,
  stations,
  options = {}
) {
  if (
    !Array.isArray(
      routeSamples
    )
  ) {
    throw new Error(
      "routeSamples must be an array"
    );
  }

  return routeSamples.map(
    (
      sample,
      index
    ) => {
      const point =
        validateCoordinates(
          sample.lat,
          sample.lng
        );

      const interpolation =
        interpolateAqi(
          point,
          stations,
          options
        );

      return {
        ...sample,

        sampleIndex:
          sample.sampleIndex ??
          index,

        aqi:
          interpolation.aqi,

        aqiCategory:
          interpolation.category,

        aqiSource:
          interpolation.source,

        provider:
          interpolation.provider ||
          null,

        aqiStandard:
          interpolation.standard ||
          "US_EPA_ESTIMATE",

        fallbackUsed:
          interpolation.fallbackUsed ===
          true,

        aqiConfidence:
          interpolation.confidence,

        stationCount:
          interpolation.stationCount,

        nearestStationDistanceMeters:
          interpolation.nearestStationDistanceMeters,

        dominantPollutant:
          interpolation.dominantPollutant,

        stationInfluence:
          interpolation.stations,
      };
    }
  );
}

// ============================================================
// ROUTE AQI SUMMARY
// ============================================================
//
// IMPORTANT DAY-6 FIX:
//
// DO NOT use:
//
// Number(sample.aqi)
//
// for validity checking.
//
// Because:
//
// Number(null)      === 0
// Number(undefined) === NaN
// Number("")        === 0
//
// Therefore null AQI would incorrectly become AQI 0.
//
// Only an actual numeric AQI value is valid.
// ============================================================

function summarizeRouteAqi(
  samples
) {
  if (
    !Array.isArray(
      samples
    )
  ) {
    throw new Error(
      "samples must be an array"
    );
  }

  const validSamples =
    samples.filter(
      (sample) => {
        if (
          sample === null ||
          typeof sample !==
            "object"
        ) {
          return false;
        }

        // ======================================================
        // CRITICAL:
        // AQI must be an actual number.
        //
        // null MUST remain invalid.
        // ======================================================

        return (
          typeof sample.aqi ===
            "number" &&
          Number.isFinite(
            sample.aqi
          )
        );
      }
    );

  // ==========================================================
  // NO VALID AQI DATA
  // ==========================================================

  if (
    validSamples.length ===
    0
  ) {
    return {
      averageAqi: null,

      peakAqi: null,

      minimumAqi: null,

      validSamples: 0,

      totalSamples:
        samples.length,

      coveragePercent:
        0,

      dominantPollutant:
        null,
    };
  }

  // ==========================================================
  // VALID AQI VALUES
  // ==========================================================

  const values =
    validSamples.map(
      (sample) =>
        sample.aqi
    );

  const averageAqi =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length;

  const peakAqi =
    Math.max(
      ...values
    );

  const minimumAqi =
    Math.min(
      ...values
    );

  // ==========================================================
  // DOMINANT POLLUTANT
  // ==========================================================

  const pollutantCounts =
    {};

  validSamples.forEach(
    (sample) => {
      if (
        sample.dominantPollutant
      ) {
        const key =
          sample.dominantPollutant;

        pollutantCounts[key] =
          (pollutantCounts[key] ||
            0) + 1;
      }
    }
  );

  const dominantPollutant =
    Object.entries(
      pollutantCounts
    ).sort(
      (a, b) =>
        b[1] - a[1]
    )[0]?.[0] ||
    null;

  // ==========================================================
  // RESULT
  // ==========================================================

  const coveragePercent =
    samples.length > 0
      ? Math.round(
          (validSamples.length /
            samples.length) *
            100
        )
      : 0;

  return {
    averageAqi:
      Math.round(
        averageAqi
      ),

    peakAqi,

    minimumAqi,

    validSamples:
      validSamples.length,

    totalSamples:
      samples.length,

    coveragePercent,

    dominantPollutant,
  };
}

// ============================================================
// TEST
// ============================================================

function testSpatialInterpolation() {
  const stations = [
    {
      stationId: 1,

      stationName:
        "Station A",

      lat: 28.6139,

      lng: 77.2090,

      aqi: 70,

      freshness:
        "live",

      ageMinutes: 15,

      dominantPollutant:
        "pm10",
    },

    {
      stationId: 2,

      stationName:
        "Station B",

      lat: 28.6200,

      lng: 77.2200,

      aqi: 100,

      freshness:
        "live",

      ageMinutes: 20,

      dominantPollutant:
        "pm25",
    },

    {
      stationId: 3,

      stationName:
        "Station C",

      lat: 28.6000,

      lng: 77.1900,

      aqi: 50,

      freshness:
        "recent",

      ageMinutes: 90,

      dominantPollutant:
        "pm10",
    },
  ];

  const routeSamples = [
    {
      sampleIndex: 0,

      lat: 28.6139,

      lng: 77.2090,

      distanceMeters: 0,
    },

    {
      sampleIndex: 1,

      lat: 28.6150,

      lng: 77.2120,

      distanceMeters: 400,
    },

    {
      sampleIndex: 2,

      lat: 28.6170,

      lng: 77.2150,

      distanceMeters: 800,
    },
  ];

  const result =
    interpolateRouteSamples(
      routeSamples,
      stations
    );

  console.log(
    "\n================================="
  );

  console.log(
    "   SPATIAL INTERPOLATION TEST"
  );

  console.log(
    "================================="
  );

  console.dir(
    result,
    {
      depth: null,
    }
  );

  console.log(
    "\nSUMMARY"
  );

  console.dir(
    summarizeRouteAqi(
      result
    ),
    {
      depth: null,
    }
  );

  console.log(
    "=================================\n"
  );

  return result;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getAqiCategory,

  calculateDistanceMeters,

  normalizeStation,

  getValidStations,

  getNearbyStations,

  calculateWeight,

  interpolateAqi,

  interpolateRouteSamples,

  summarizeRouteAqi,

  testSpatialInterpolation,
};