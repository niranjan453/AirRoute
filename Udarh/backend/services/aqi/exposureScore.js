// ============================================================
// AIRROUTE - EXPOSURE SCORE ENGINE
// ============================================================
//
// Input:
//   Route + AQI samples
//
// Output:
//   - Total exposure
//   - Exposure per km
//   - Exposure per hour
//   - AQI statistics
//   - Time spent in AQI categories
//   - Exposure score
//   - Confidence
//
// IMPORTANT:
// This module does NOT calculate AQI.
// AQI must already be calculated by aqiEngine / routeAQI.
// ============================================================

"use strict";

// ============================================================
// CONFIG
// ============================================================

const DEFAULT_SPEED_KMH = 30;

// AQI category thresholds.
// These follow the category structure already being used
// by the AirRoute AQI engine.
const AQI_CATEGORIES = [
  {
    min: 0,
    max: 50,
    label: "Good",
  },
  {
    min: 51,
    max: 100,
    label: "Satisfactory",
  },
  {
    min: 101,
    max: 200,
    label: "Moderate",
  },
  {
    min: 201,
    max: 300,
    label: "Poor",
  },
  {
    min: 301,
    max: 400,
    label: "Very Poor",
  },
  {
    min: 401,
    max: Infinity,
    label: "Severe",
  },
];

// ============================================================
// BASIC HELPERS
// ============================================================

function toFiniteNumber(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function round(value, decimals = 2) {
  const factor =
    10 ** decimals;

  return (
    Math.round(
      value * factor
    ) / factor
  );
}

// ============================================================
// AQI CATEGORY
// ============================================================

function getAQICategory(aqi) {
  const value =
    toFiniteNumber(aqi);

  if (value === null) {
    return {
      min: null,
      max: null,
      label: "Unknown",
    };
  }

  return (
    AQI_CATEGORIES.find(
      (category) =>
        value >= category.min &&
        value <= category.max
    ) || {
      min: null,
      max: null,
      label: "Unknown",
    }
  );
}

// ============================================================
// VALID AQI SAMPLE
// ============================================================

function isValidAQISample(sample) {
  if (!sample) {
    return false;
  }

  const aqi =
    toFiniteNumber(
      sample.aqi
    );

  return (
    aqi !== null &&
    aqi >= 0
  );
}

// ============================================================
// NORMALIZE AQI SAMPLES
// ============================================================

function normalizeAQISamples(
  samples
) {
  if (!Array.isArray(samples)) {
    return [];
  }

  return samples
    .filter(
      isValidAQISample
    )
    .map(
      (sample, index) => ({
        ...sample,

        sampleIndex:
          Number.isInteger(
            sample.sampleIndex
          )
            ? sample.sampleIndex
            : index,

        aqi:
          round(
            toFiniteNumber(
              sample.aqi,
              0
            ),
            2
          ),

        distanceMeters:
          Math.max(
            0,
            toFiniteNumber(
              sample.distanceMeters,
              0
            )
          ),
      })
    )
    .sort(
      (a, b) =>
        a.distanceMeters -
        b.distanceMeters
    );
}

// ============================================================
// SEGMENT DISTANCE
// ============================================================
//
// Segment i:
//   sample[i] -> sample[i + 1]
//
// AQI for the segment:
//   average of the two endpoints
//
// For the final point there is no next point,
// therefore no independent segment is created.
// ============================================================

function calculateSegmentDistance(
  current,
  next
) {
  const currentDistance =
    toFiniteNumber(
      current?.distanceMeters,
      0
    );

  const nextDistance =
    toFiniteNumber(
      next?.distanceMeters,
      currentDistance
    );

  return Math.max(
    0,
    nextDistance -
      currentDistance
  );
}

// ============================================================
// SEGMENT AQI
// ============================================================

function calculateSegmentAQI(
  current,
  next
) {
  const currentAQI =
    toFiniteNumber(
      current?.aqi
    );

  const nextAQI =
    toFiniteNumber(
      next?.aqi,
      currentAQI
    );

  if (
    currentAQI === null &&
    nextAQI === null
  ) {
    return null;
  }

  if (
    currentAQI === null
  ) {
    return nextAQI;
  }

  if (
    nextAQI === null
  ) {
    return currentAQI;
  }

  return (
    currentAQI +
    nextAQI
  ) / 2;
}

// ============================================================
// TRAVEL TIME
// ============================================================
//
// If route duration is provided, use it.
//
// Otherwise estimate time from speed.
//
// Default:
//   30 km/h
//
// IMPORTANT:
// Real routing duration should be supplied by the routing
// provider whenever available.
// ============================================================

function calculateSegmentTimeMinutes(
  distanceMeters,
  routeDistanceMeters,
  routeDurationSeconds,
  fallbackSpeedKmh = DEFAULT_SPEED_KMH
) {
  const distance =
    Math.max(
      0,
      toFiniteNumber(
        distanceMeters,
        0
      )
    );

  // ----------------------------------------------------------
  // Preferred: route duration from routing provider.
  // ----------------------------------------------------------

  const duration =
    toFiniteNumber(
      routeDurationSeconds
    );

  const totalDistance =
    toFiniteNumber(
      routeDistanceMeters
    );

  if (
    duration !== null &&
    duration > 0 &&
    totalDistance !== null &&
    totalDistance > 0
  ) {
    return (
      (distance /
        totalDistance) *
      duration /
      60
    );
  }

  // ----------------------------------------------------------
  // Fallback: speed based estimate.
  // ----------------------------------------------------------

  const speed =
    Math.max(
      1,
      toFiniteNumber(
        fallbackSpeedKmh,
        DEFAULT_SPEED_KMH
      )
    );

  return (
    distance /
    1000 /
    speed
  ) * 60;
}

// ============================================================
// SEGMENT EXPOSURE
// ============================================================
//
// Exposure unit:
//
//   AQI × minutes
//
// Example:
//
//   AQI = 100
//   time = 2 minutes
//
//   exposure = 200
// ============================================================

function calculateSegmentExposure({
  distanceMeters,
  aqi,
  timeMinutes,
}) {
  const distance =
    Math.max(
      0,
      toFiniteNumber(
        distanceMeters,
        0
      )
    );

  const aqiValue =
    Math.max(
      0,
      toFiniteNumber(
        aqi,
        0
      )
    );

  const time =
    Math.max(
      0,
      toFiniteNumber(
        timeMinutes,
        0
      )
    );

  const exposure =
    aqiValue *
    time;

  return {
    distanceMeters:
      round(distance, 2),

    timeMinutes:
      round(time, 4),

    aqi:
      round(aqiValue, 2),

    exposure:
      round(exposure, 4),

    category:
      getAQICategory(
        aqiValue
      ),
  };
}

// ============================================================
// CATEGORY TIME
// ============================================================

function addCategoryTime(
  categoryTimes,
  category,
  minutes
) {
  if (!categoryTimes) {
    return;
  }

  const label =
    category?.label ||
    "Unknown";

  if (
    !Object.prototype.hasOwnProperty.call(
      categoryTimes,
      label
    )
  ) {
    categoryTimes[label] = 0;
  }

  categoryTimes[label] +=
    Math.max(
      0,
      toFiniteNumber(
        minutes,
        0
      )
    );
}

// ============================================================
// CATEGORY PERCENTAGES
// ============================================================

function calculateCategoryPercentages(
  categoryTimes,
  totalMinutes
) {
  const result = {};

  const total =
    Math.max(
      0,
      toFiniteNumber(
        totalMinutes,
        0
      )
    );

  for (
    const [
      category,
      minutes,
    ] of Object.entries(
      categoryTimes || {}
    )
  ) {
    result[category] =
      total > 0
        ? round(
            (minutes /
              total) *
              100,
            2
          )
        : 0;
  }

  return result;
}

// ============================================================
// AQI STATISTICS
// ============================================================

function calculateAQIStatistics(
  samples
) {
  const valid =
    normalizeAQISamples(
      samples
    );

  if (
    valid.length === 0
  ) {
    return {
      averageAqi: null,
      peakAqi: null,
      minimumAqi: null,
      validSamples: 0,
      totalSamples:
        Array.isArray(samples)
          ? samples.length
          : 0,
      coveragePercent: 0,
      dominantPollutant: null,
    };
  }

  const values =
    valid.map(
      (sample) =>
        sample.aqi
    );

  const sum =
    values.reduce(
      (total, value) =>
        total + value,
      0
    );

  const average =
    sum / values.length;

  const peak =
    Math.max(...values);

  const minimum =
    Math.min(...values);

  const dominantPollutants =
    valid
      .map(
        (sample) =>
          sample.dominantPollutant
      )
      .filter(Boolean);

  let dominantPollutant =
    null;

  if (
    dominantPollutants.length > 0
  ) {
    const counts = {};

    for (
      const pollutant of
        dominantPollutants
    ) {
      counts[pollutant] =
        (counts[pollutant] || 0) +
        1;
    }

    dominantPollutant =
      Object.entries(
        counts
      ).sort(
        (a, b) =>
          b[1] - a[1]
      )[0]?.[0] || null;
  }

  const totalSamples =
    Array.isArray(samples)
      ? samples.length
      : 0;

  return {
    averageAqi:
      round(average, 2),

    peakAqi:
      round(peak, 2),

    minimumAqi:
      round(minimum, 2),

    validSamples:
      valid.length,

    totalSamples,

    coveragePercent:
      totalSamples > 0
        ? round(
            (valid.length /
              totalSamples) *
              100,
            2
          )
        : 0,

    dominantPollutant,
  };
}

// ============================================================
// EXPOSURE SCORE
// ============================================================
//
// We keep the raw exposure value separately.
//
// exposureScore is normalized to 0–100.
//
// Lower exposure = better.
//
// Score:
//
//   100 -> very low exposure
//    0  -> very high exposure
//
// The score is NOT AQI.
//
// It is a route-level environmental exposure score.
// ============================================================

function calculateExposureScore(
  totalExposure,
  totalMinutes
) {
  const exposure =
    Math.max(
      0,
      toFiniteNumber(
        totalExposure,
        0
      )
    );

  const minutes =
    Math.max(
      0,
      toFiniteNumber(
        totalMinutes,
        0
      )
    );

  if (
    minutes <= 0
  ) {
    return 0;
  }

  const averageExposure =
    exposure /
    minutes;

  // ----------------------------------------------------------
  // Average AQI-like exposure intensity.
  //
  // 0      -> 100 score
  // 50     -> ~80
  // 100    -> ~60
  // 200    -> ~20
  // 250+   -> 0
  //
  // This keeps the score bounded.
  // ----------------------------------------------------------

  const score =
    100 -
    (
      averageExposure /
      2.5
    );

  return round(
    clamp(
      score,
      0,
      100
    ),
    2
  );
}

// ============================================================
// ROUTE EXPOSURE
// ============================================================

function calculateRouteExposure(
  route,
  options = {}
) {
  const routeObject =
    route || {};

  const rawSamples =
    routeObject.aqiSamples ||
    routeObject.samples ||
    [];

  const samples =
    normalizeAQISamples(
      rawSamples
    );

  const routeDistanceMeters =
    Math.max(
      0,
      toFiniteNumber(
        routeObject.distanceMeters,
        0
      )
    );

  const routeDistanceKm =
    routeDistanceMeters /
    1000;

  const routeDurationSeconds =
    toFiniteNumber(
      routeObject.durationSeconds ??
        routeObject.duration ??
        routeObject.travelTimeSeconds
    );

  const fallbackSpeedKmh =
    Math.max(
      1,
      toFiniteNumber(
        options.speedKmh,
        DEFAULT_SPEED_KMH
      )
    );

  // ----------------------------------------------------------
  // No samples
  // ----------------------------------------------------------

  if (
    samples.length === 0
  ) {
    return {
      totalExposure: 0,

      exposurePerKm: 0,

      exposurePerHour: 0,

      averageAqi: null,

      peakAqi: null,

      minimumAqi: null,

      validSamples: 0,

      totalSamples:
        rawSamples.length,

      coveragePercent: 0,

      totalDistanceMeters:
        routeDistanceMeters,

      totalDistanceKm:
        round(
          routeDistanceKm,
          3
        ),

      totalTimeMinutes: 0,

      totalTimeHours: 0,

      exposureScore: 0,

      categoryTimeMinutes: {},

      categoryTimePercent: {},

      segments: [],

      confidence: "low",

      dominantPollutant: null,

      generatedAt:
        new Date().toISOString(),
    };
  }

  // ----------------------------------------------------------
  // Segment processing
  // ----------------------------------------------------------

  const segments = [];

  let totalExposure = 0;

  let totalTimeMinutes = 0;

  const categoryTimeMinutes = {};

  for (
    let i = 0;
    i < samples.length - 1;
    i++
  ) {
    const current =
      samples[i];

    const next =
      samples[i + 1];

    const distanceMeters =
      calculateSegmentDistance(
        current,
        next
      );

    if (
      distanceMeters <= 0
    ) {
      continue;
    }

    const segmentAQI =
      calculateSegmentAQI(
        current,
        next
      );

    if (
      segmentAQI === null
    ) {
      continue;
    }

    const timeMinutes =
      calculateSegmentTimeMinutes(
        distanceMeters,
        routeDistanceMeters,
        routeDurationSeconds,
        fallbackSpeedKmh
      );

    const segment =
      calculateSegmentExposure({
        distanceMeters,
        aqi:
          segmentAQI,
        timeMinutes,
      });

    totalExposure +=
      segment.exposure;

    totalTimeMinutes +=
      segment.timeMinutes;

    addCategoryTime(
      categoryTimeMinutes,
      segment.category,
      segment.timeMinutes
    );

    segments.push({
      segmentIndex: i,

      fromSampleIndex:
        current.sampleIndex,

      toSampleIndex:
        next.sampleIndex,

      startDistanceMeters:
        current.distanceMeters,

      endDistanceMeters:
        next.distanceMeters,

      distanceMeters:
        segment.distanceMeters,

      timeMinutes:
        segment.timeMinutes,

      aqi:
        segment.aqi,

      category:
        segment.category,

      exposure:
        segment.exposure,
    });
  }

  // ----------------------------------------------------------
  // If routing duration exists, use it as the authoritative
  // total time for the route.
  //
  // Segment times are proportionally based on distance,
  // so total should match routing duration.
  // ----------------------------------------------------------

  if (
    routeDurationSeconds !==
      null &&
    routeDurationSeconds > 0 &&
    routeDistanceMeters > 0
  ) {
    totalTimeMinutes =
      routeDurationSeconds /
      60;
  }

  // ----------------------------------------------------------
  // Statistics
  // ----------------------------------------------------------

  const statistics =
    calculateAQIStatistics(
      samples
    );

  // ----------------------------------------------------------
  // Exposure metrics
  // ----------------------------------------------------------

  const exposurePerKm =
    routeDistanceKm > 0
      ? totalExposure /
        routeDistanceKm
      : 0;

  const totalTimeHours =
    totalTimeMinutes /
    60;

  const exposurePerHour =
    totalTimeHours > 0
      ? totalExposure /
        totalTimeHours
      : 0;

  const exposureScore =
    calculateExposureScore(
      totalExposure,
      totalTimeMinutes
    );

  const categoryTimePercent =
    calculateCategoryPercentages(
      categoryTimeMinutes,
      totalTimeMinutes
    );

  // ----------------------------------------------------------
  // Confidence
  // ----------------------------------------------------------

  let confidence = "low";

  if (
    statistics.coveragePercent >= 90
  ) {
    confidence = "high";
  } else if (
    statistics.coveragePercent >= 70
  ) {
    confidence = "medium";
  }

  // If AQI data itself contains low confidence,
  // don't claim high route confidence.
  const lowConfidenceSample =
    samples.some(
      (sample) =>
        sample.aqiConfidence ===
        "low"
    );

  if (
    lowConfidenceSample
  ) {
    confidence = "low";
  }

  return {
    // --------------------------------------------------------
    // Core exposure
    // --------------------------------------------------------

    totalExposure:
      round(
        totalExposure,
        2
      ),

    exposurePerKm:
      round(
        exposurePerKm,
        2
      ),

    exposurePerHour:
      round(
        exposurePerHour,
        2
      ),

    exposureScore,

    // --------------------------------------------------------
    // AQI
    // --------------------------------------------------------

    averageAqi:
      statistics.averageAqi,

    peakAqi:
      statistics.peakAqi,

    minimumAqi:
      statistics.minimumAqi,

    dominantPollutant:
      statistics.dominantPollutant,

    // --------------------------------------------------------
    // Route
    // --------------------------------------------------------

    totalDistanceMeters:
      round(
        routeDistanceMeters,
        2
      ),

    totalDistanceKm:
      round(
        routeDistanceKm,
        3
      ),

    totalTimeMinutes:
      round(
        totalTimeMinutes,
        2
      ),

    totalTimeHours:
      round(
        totalTimeHours,
        3
      ),

    // --------------------------------------------------------
    // Coverage
    // --------------------------------------------------------

    validSamples:
      statistics.validSamples,

    totalSamples:
      statistics.totalSamples,

    coveragePercent:
      statistics.coveragePercent,

    // --------------------------------------------------------
    // Pollution category time
    // --------------------------------------------------------

    categoryTimeMinutes:
      Object.fromEntries(
        Object.entries(
          categoryTimeMinutes
        ).map(
          ([
            category,
            minutes,
          ]) => [
            category,
            round(
              minutes,
              2
            ),
          ]
        )
      ),

    categoryTimePercent,

    // --------------------------------------------------------
    // Segment-level exposure
    // --------------------------------------------------------

    segments,

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    confidence,

    speedUsedKmh:
      routeDurationSeconds
        ? null
        : fallbackSpeedKmh,

    usedRoutingDuration:
      Boolean(
        routeDurationSeconds !==
          null &&
          routeDurationSeconds > 0
      ),

    generatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// ROUTE COMPARISON
// ============================================================
//
// Lower exposure is better.
//
// Used later for:
//   FASTEST
//   CLEANEST
//   BALANCED
// ============================================================

function compareExposure(
  routeA,
  routeB
) {
  const exposureA =
    toFiniteNumber(
      routeA?.totalExposure,
      Infinity
    );

  const exposureB =
    toFiniteNumber(
      routeB?.totalExposure,
      Infinity
    );

  if (
    exposureA <
    exposureB
  ) {
    return -1;
  }

  if (
    exposureA >
    exposureB
  ) {
    return 1;
  }

  return 0;
}

// ============================================================
// SORT ROUTES BY CLEANLINESS
// ============================================================

function rankRoutesByExposure(
  routes
) {
  if (
    !Array.isArray(routes)
  ) {
    return [];
  }

  return routes
    .map(
      (route, index) => ({
        ...route,

        _originalIndex:
          index,

        _exposure:
          calculateRouteExposure(
            route
          ),
      })
    )
    .sort(
      (a, b) =>
        compareExposure(
          a._exposure,
          b._exposure
        )
    )
    .map(
      (route, rank) => ({
        ...route,

        exposureRank:
          rank + 1,

        exposure:
          route._exposure,

        _originalIndex:
          undefined,

        _exposure:
          undefined,
      })
    );
}

// ============================================================
// TEST DATA
// ============================================================

function createTestRoute() {
  return {
    routeId:
      "test-exposure-route",

    distanceMeters:
      2459,

    durationSeconds:
      492,

    aqiSamples: [
      {
        sampleIndex: 0,
        distanceMeters: 0,
        aqi: 79,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },

      {
        sampleIndex: 1,
        distanceMeters: 400,
        aqi: 79,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },

      {
        sampleIndex: 2,
        distanceMeters: 800,
        aqi: 80,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },

      {
        sampleIndex: 3,
        distanceMeters: 1200,
        aqi: 81,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },

      {
        sampleIndex: 4,
        distanceMeters: 1600,
        aqi: 83,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },

      {
        sampleIndex: 5,
        distanceMeters: 2000,
        aqi: 86,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },

      {
        sampleIndex: 6,
        distanceMeters: 2400,
        aqi: 88,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },

      {
        sampleIndex: 7,
        distanceMeters: 2459,
        aqi: 89,
        aqiConfidence: "high",
        dominantPollutant:
          "pm10",
      },
    ],
  };
}

// ============================================================
// TEST
// ============================================================

function testExposureScore() {
  console.log(
    "\n============================================"
  );

  console.log(
    "       AIRROUTE EXPOSURE SCORE TEST"
  );

  console.log(
    "============================================"
  );

  const route =
    createTestRoute();

  const result =
    calculateRouteExposure(
      route
    );

  console.log(
    "\n========== EXPOSURE RESULT =========="
  );

  console.dir(
    result,
    {
      depth: 10,
    }
  );

  console.log(
    "\n========== SUMMARY =========="
  );

  console.table({
    totalExposure:
      result.totalExposure,

    exposurePerKm:
      result.exposurePerKm,

    exposurePerHour:
      result.exposurePerHour,

    exposureScore:
      result.exposureScore,

    averageAqi:
      result.averageAqi,

    peakAqi:
      result.peakAqi,

    minimumAqi:
      result.minimumAqi,

    distanceKm:
      result.totalDistanceKm,

    timeMinutes:
      result.totalTimeMinutes,

    coverage:
      `${result.coveragePercent}%`,

    confidence:
      result.confidence,
  });

  return result;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getAQICategory,

  isValidAQISample,

  normalizeAQISamples,

  calculateSegmentDistance,

  calculateSegmentAQI,

  calculateSegmentTimeMinutes,

  calculateSegmentExposure,

  calculateAQIStatistics,

  calculateExposureScore,

  calculateRouteExposure,

  compareExposure,

  rankRoutesByExposure,

  createTestRoute,

  testExposureScore,
};