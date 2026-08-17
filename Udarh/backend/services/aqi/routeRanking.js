"use strict";

// ============================================================
// AIRROUTE - ROUTE RANKING / RECOMMENDATION ENGINE
// ============================================================
//
// DAY 8 HARDENING
//
// Canonical AirRoute MVP decision model:
//
//   1. Acceptable travel-time detour constraint
//   2. Lowest estimated pollution exposure
//   3. Faster travel time as tie-breaker
//   4. Shorter distance as final tie-breaker
//
// Fallback:
//
//   If no route satisfies the preferred exposure + detour
//   constraints, select the fastest route WITH valid exposure.
//
// Safety:
//
//   - Missing exposure stays NULL
//   - NULL is NEVER converted to 0
//   - Unavailable AQI routes cannot win
//   - Failed routes remain visible
//   - Rank 1 does NOT automatically mean recommended
//   - Recommendation metadata MUST match the actual strategy
//
// ============================================================


// ============================================================
// EXPOSURE ENGINE
// ============================================================

let exposureEngine = null;

try {
  exposureEngine =
    require("../exposureScoring");
} catch (error) {
  console.warn(
    "[routeRanking] Exposure engine could not be loaded:",
    error.message
  );
}


// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

const DEFAULT_MAX_DETOUR_PERCENT =
  Number.isFinite(
    Number(
      process.env.AIRROUTE_MAX_DETOUR_PERCENT
    )
  )
    ? Number(
        process.env.AIRROUTE_MAX_DETOUR_PERCENT
      )
    : 20;

const DEFAULT_EXPOSURE_TIE_PERCENT =
  Number.isFinite(
    Number(
      process.env.AIRROUTE_EXPOSURE_TIE_PERCENT
    )
  )
    ? Number(
        process.env.AIRROUTE_EXPOSURE_TIE_PERCENT
      )
    : 1;

const DEFAULT_CRITICAL_HOTSPOT_AQI =
  Number.isFinite(
    Number(
      process.env.AIRROUTE_CRITICAL_HOTSPOT_AQI
    )
  )
    ? Number(
        process.env.AIRROUTE_CRITICAL_HOTSPOT_AQI
      )
    : 300;

const DEFAULT_CRITICAL_HOTSPOT_DURATION_MINUTES =
  Number.isFinite(
    Number(
      process.env
        .AIRROUTE_CRITICAL_HOTSPOT_DURATION_MINUTES
    )
  )
    ? Number(
        process.env
          .AIRROUTE_CRITICAL_HOTSPOT_DURATION_MINUTES
      )
    : 5;

const DEFAULT_CRITICAL_HOTSPOT_EXPOSURE_SHARE =
  Number.isFinite(
    Number(
      process.env
        .AIRROUTE_CRITICAL_HOTSPOT_EXPOSURE_SHARE
    )
  )
    ? Number(
        process.env
          .AIRROUTE_CRITICAL_HOTSPOT_EXPOSURE_SHARE
      )
    : 0.5;


// ============================================================
// PROFILE CONFIGURATION
// ============================================================

const PROFILE_CONFIG = {
  normal: {
    maxDetourPercent:
      DEFAULT_MAX_DETOUR_PERCENT,

    criticalHotspotAqi:
      DEFAULT_CRITICAL_HOTSPOT_AQI,

    criticalHotspotDurationMinutes:
      DEFAULT_CRITICAL_HOTSPOT_DURATION_MINUTES,

    criticalHotspotExposureShare:
      DEFAULT_CRITICAL_HOTSPOT_EXPOSURE_SHARE,
  },

  child: {
    maxDetourPercent:
      15,

    criticalHotspotAqi:
      DEFAULT_CRITICAL_HOTSPOT_AQI,

    criticalHotspotDurationMinutes:
      DEFAULT_CRITICAL_HOTSPOT_DURATION_MINUTES,

    criticalHotspotExposureShare:
      DEFAULT_CRITICAL_HOTSPOT_EXPOSURE_SHARE,
  },

  elderly: {
    maxDetourPercent:
      15,

    criticalHotspotAqi:
      DEFAULT_CRITICAL_HOTSPOT_AQI,

    criticalHotspotDurationMinutes:
      DEFAULT_CRITICAL_HOTSPOT_DURATION_MINUTES,

    criticalHotspotExposureShare:
      DEFAULT_CRITICAL_HOTSPOT_EXPOSURE_SHARE,
  },

  asthma: {
    maxDetourPercent:
      15,

    criticalHotspotAqi:
      DEFAULT_CRITICAL_HOTSPOT_AQI,

    criticalHotspotDurationMinutes:
      DEFAULT_CRITICAL_HOTSPOT_DURATION_MINUTES,

    criticalHotspotExposureShare:
      DEFAULT_CRITICAL_HOTSPOT_EXPOSURE_SHARE,
  },

  pregnant: {
    maxDetourPercent:
      15,

    criticalHotspotAqi:
      DEFAULT_CRITICAL_HOTSPOT_AQI,

    criticalHotspotDurationMinutes:
      DEFAULT_CRITICAL_HOTSPOT_DURATION_MINUTES,

    criticalHotspotExposureShare:
      DEFAULT_CRITICAL_HOTSPOT_EXPOSURE_SHARE,
  },
};

const DEFAULT_PROFILE =
  "normal";


// ============================================================
// LEGACY WEIGHTS
// ============================================================
//
// Retained for compatibility with older callers.
//
// They are NOT used by the canonical recommendation model.
//

const DEFAULT_TIME_WEIGHT =
  0.5;

const DEFAULT_EXPOSURE_WEIGHT =
  0.5;


// ============================================================
// GENERIC NUMBER HELPER
// ============================================================
//
// IMPORTANT:
//
// Do NOT use this helper for exposure values.
//
// Number(null) === 0
//
// That can incorrectly make unavailable exposure look like
// zero pollution exposure.
//

function number(
  value,
  fallback = 0
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


// ============================================================
// SAFE EXPOSURE VALIDATION
// ============================================================

function isValidExposureValue(
  value
) {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(value)
  );
}

function getValidExposureValue(
  value
) {
  return isValidExposureValue(
    value
  )
    ? value
    : null;
}


// ============================================================
// CLAMP
// ============================================================

function clamp(
  value,
  min,
  max
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return min;
  }

  return Math.min(
    Math.max(
      n,
      min
    ),
    max
  );
}


// ============================================================
// ROUND
// ============================================================

function round(
  value,
  decimals = 2
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      n * factor
    ) / factor
  );
}


// ============================================================
// PROFILE NORMALIZATION
// ============================================================

function normalizeProfile(
  profile
) {
  const normalized =
    String(
      profile ||
        DEFAULT_PROFILE
    )
      .trim()
      .toLowerCase();

  if (
    Object.prototype.hasOwnProperty.call(
      PROFILE_CONFIG,
      normalized
    )
  ) {
    return normalized;
  }

  return DEFAULT_PROFILE;
}


// ============================================================
// ROUTE DISTANCE
// ============================================================

function getRouteDistanceMeters(
  route
) {
  const values = [
    route?.distanceMeters,
    route?.distance,
    route?.travelDistanceMeters,
  ];

  for (
    const value of
      values
  ) {
    const n =
      Number(value);

    if (
      Number.isFinite(n) &&
      n >= 0
    ) {
      return n;
    }
  }

  return 0;
}


// ============================================================
// ROUTE DURATION
// ============================================================

function getRouteDurationSeconds(
  route
) {
  const values = [
    route?.durationSeconds,
    route?.duration,
    route?.travelTimeSeconds,
    route?.travelDurationSeconds,
  ];

  for (
    const value of
      values
  ) {
    const n =
      Number(value);

    if (
      Number.isFinite(n) &&
      n >= 0
    ) {
      return n;
    }
  }

  const distanceMeters =
    getRouteDistanceMeters(
      route
    );

  if (
    distanceMeters <=
    0
  ) {
    return 0;
  }

  const DEFAULT_SPEED_KMH =
    30;

  return (
    distanceMeters /
    1000 /
    DEFAULT_SPEED_KMH
  ) * 3600;
}


// ============================================================
// GET ROUTE EXPOSURE
// ============================================================
//
// CRITICAL RULE:
//
// If route explicitly contains:
//
//   exposure: null
//
// exposure is unavailable.
//
// DO NOT call a fallback exposure engine.
//
// This prevents:
//
//   exposure: null
//
// from becoming:
//
//   totalExposure: 0
//
// ============================================================

function getRouteExposure(
  route
) {
  if (
    route &&
    Object.prototype.hasOwnProperty.call(
      route,
      "exposure"
    )
  ) {
    return route.exposure;
  }

  if (
    exposureEngine &&
    typeof exposureEngine.computeExposureScore ===
      "function"
  ) {
    try {
      return exposureEngine.computeExposureScore(
        route
      );
    } catch (
      error
    ) {
      console.warn(
        "[routeRanking] Exposure calculation failed:",
        error.message
      );
    }
  }

  if (
    exposureEngine &&
    typeof exposureEngine.scoreRoute ===
      "function"
  ) {
    try {
      return exposureEngine.scoreRoute(
        route
      );
    } catch (
      error
    ) {
      console.warn(
        "[routeRanking] Route scoring failed:",
        error.message
      );
    }
  }

  return {
    totalExposure:
      null,

    exposureScore:
      null,

    averageAqi:
      null,

    peakAqi:
      null,

    exposurePerKm:
      null,

    coverage:
      null,

    coveragePercent:
      null,

    confidence:
      "none",

    hotspots:
      [],
  };
}


// ============================================================
// GET AVERAGE AQI
// ============================================================

function getRouteAverageAqi(
  route,
  exposure
) {
  const value =
    exposure?.averageAqi ??
    route?.aqiSummary
      ?.averageAqi ??
    route?.averageAqi ??
    null;

  return getValidExposureValue(
    value
  );
}


// ============================================================
// GET PEAK AQI
// ============================================================

function getRoutePeakAqi(
  route,
  exposure
) {
  const value =
    exposure?.peakAqi ??
    route?.aqiSummary
      ?.peakAqi ??
    route?.peakAqi ??
    null;

  return getValidExposureValue(
    value
  );
}


// ============================================================
// GET HOTSPOTS
// ============================================================

function getRouteHotspots(
  route,
  exposure
) {
  if (
    Array.isArray(
      exposure?.hotspots
    )
  ) {
    return exposure.hotspots;
  }

  if (
    Array.isArray(
      route?.hotspots
    )
  ) {
    return route.hotspots;
  }

  return [];
}


// ============================================================
// HOTSPOT AQI
// ============================================================

function getHotspotAqi(
  hotspot
) {
  const value =
    hotspot?.peakAqi ??
    hotspot?.aqi ??
    null;

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}


// ============================================================
// HOTSPOT DURATION
// ============================================================

function getHotspotDurationSeconds(
  hotspot
) {
  const seconds =
    Number(
      hotspot?.durationSeconds
    );

  if (
    Number.isFinite(
      seconds
    ) &&
    seconds >= 0
  ) {
    return seconds;
  }

  const minutes =
    Number(
      hotspot?.durationMinutes ??
        hotspot?.durationMin
    );

  if (
    Number.isFinite(
      minutes
    ) &&
    minutes >= 0
  ) {
    return minutes * 60;
  }

  return 0;
}


// ============================================================
// HOTSPOT COUNT
// ============================================================

function getHotspotCount(
  route,
  exposure
) {
  const hotspots =
    getRouteHotspots(
      route,
      exposure
    );

  if (
    Array.isArray(
      hotspots
    )
  ) {
    return hotspots.length;
  }

  return number(
    route?.hotspotCount,
    0
  );
}


// ============================================================
// HOTSPOT SEVERITY
// ============================================================

function getHotspotSeverity(
  route,
  exposure
) {
  const hotspots =
    getRouteHotspots(
      route,
      exposure
    );

  if (
    !Array.isArray(
      hotspots
    ) ||
    hotspots.length ===
      0
  ) {
    return 0;
  }

  let severity =
    0;

  for (
    const hotspot of
      hotspots
  ) {
    const aqi =
      getHotspotAqi(
        hotspot
      );

    severity +=
      Math.max(
        0,
        aqi - 100
      );
  }

  return severity;
}


// ============================================================
// CALCULATE HOTSPOT METRICS
// ============================================================

function calculateHotspotMetrics(
  route,
  exposure
) {
  const hotspots =
    getRouteHotspots(
      route,
      exposure
    );

  if (
    !Array.isArray(
      hotspots
    ) ||
    hotspots.length ===
      0
  ) {
    return {
      count:
        0,

      peakAqi:
        0,

      totalDurationSeconds:
        0,

      totalDurationMinutes:
        0,

      hotspotExposure:
        0,

      hotspotExposureShare:
        null,

      severity:
        0,
    };
  }

  let peakAqi =
    0;

  let totalDurationSeconds =
    0;

  let hotspotExposure =
    0;

  let severity =
    0;

  for (
    const hotspot of
      hotspots
  ) {
    const aqi =
      getHotspotAqi(
        hotspot
      );

    const durationSeconds =
      getHotspotDurationSeconds(
        hotspot
      );

    peakAqi =
      Math.max(
        peakAqi,
        aqi
      );

    totalDurationSeconds +=
      durationSeconds;

    hotspotExposure +=
      aqi *
      durationSeconds;

    severity +=
      Math.max(
        0,
        aqi - 100
      );
  }

  const totalExposure =
    getValidExposureValue(
      exposure?.totalExposure
    );

  const hotspotExposureShare =
    totalExposure !== null &&
    totalExposure > 0
      ? clamp(
          hotspotExposure /
            totalExposure,
          0,
          1
        )
      : null;

  return {
    count:
      hotspots.length,

    peakAqi:
      round(
        peakAqi,
        1
      ),

    totalDurationSeconds,

    totalDurationMinutes:
      totalDurationSeconds /
      60,

    hotspotExposure,

    hotspotExposureShare:
      hotspotExposureShare ===
      null
        ? null
        : round(
            hotspotExposureShare,
            4
          ),

    severity,
  };
}


// ============================================================
// BUILD ROUTE METRICS
// ============================================================
//
// Missing exposure remains null.
//

function buildRouteMetrics(
  routes
) {
  if (
    !Array.isArray(
      routes
    )
  ) {
    return [];
  }

  return routes.map(
    (
      route,
      index
    ) => {
      const durationSeconds =
        getRouteDurationSeconds(
          route
        );

      const distanceMeters =
        getRouteDistanceMeters(
          route
        );

      const exposure =
        getRouteExposure(
          route
        );

      const totalExposure =
        getValidExposureValue(
          exposure?.totalExposure
        );

      const exposurePerKm =
        getValidExposureValue(
          exposure?.exposurePerKm
        );

      const exposureScore =
        getValidExposureValue(
          exposure?.exposureScore
        );

      const averageAqi =
        getRouteAverageAqi(
          route,
          exposure
        );

      const peakAqi =
        getRoutePeakAqi(
          route,
          exposure
        );

      const hotspotMetrics =
        calculateHotspotMetrics(
          route,
          exposure
        );

      const coverage =
        exposure?.coverage ??
        exposure?.coveragePercent ??
        route?.aqiSummary
          ?.coveragePercent ??
        route?.aqiCoverage ??
        route?.coverage ??
        null;

      return {
        route,

        routeIndex:
          index,

        routeId:
          route?.routeId ||
          route?.id ||
          `route-${index}`,

        distanceMeters,

        distanceKm:
          distanceMeters /
          1000,

        durationSeconds,

        durationMinutes:
          durationSeconds /
          60,

        durationHours:
          durationSeconds /
          3600,

        totalExposure,

        exposurePerKm,

        averageAqi,

        peakAqi,

        exposureScore,

        coverage,

        confidence:
          exposure?.confidence ??
          route?.aqiConfidence ??
          "none",

        hotspotCount:
          hotspotMetrics.count,

        hotspotSeverity:
          hotspotMetrics.severity,

        hotspotPeakAqi:
          hotspotMetrics.peakAqi,

        hotspotDurationSeconds:
          hotspotMetrics.totalDurationSeconds,

        hotspotDurationMinutes:
          hotspotMetrics.totalDurationMinutes,

        hotspotExposure:
          hotspotMetrics.hotspotExposure,

        hotspotExposureShare:
          hotspotMetrics.hotspotExposureShare,

        criticalHotspot:
          false,

        detourPercent:
          null,

        withinAcceptableDetour:
          false,

        invalidRoute:
          false,
      };
    }
  );
}


// ============================================================
// BUILD RECOMMENDATION CONTEXT
// ============================================================

function buildRecommendationContext(
  metrics
) {
  if (
    !Array.isArray(
      metrics
    ) ||
    metrics.length ===
      0
  ) {
    return {
      fastestTimeSeconds:
        0,

      slowestTimeSeconds:
        0,

      shortestDistanceMeters:
        0,

      longestDistanceMeters:
        0,

      lowestExposure:
        null,

      highestExposure:
        null,

      mode:
        "unavailable",
    };
  }

  const durations =
    metrics
      .map(
        (metric) =>
          Number(
            metric.durationSeconds
          )
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          ) &&
          value >= 0
      );

  const distances =
    metrics
      .map(
        (metric) =>
          Number(
            metric.distanceMeters
          )
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          ) &&
          value >= 0
      );

  const exposures =
    metrics
      .map(
        (metric) =>
          metric.totalExposure
      )
      .filter(
        isValidExposureValue
      );

  const fastestTimeSeconds =
    durations.length >
    0
      ? Math.min(
          ...durations
        )
      : 0;

  const slowestTimeSeconds =
    durations.length >
    0
      ? Math.max(
          ...durations
        )
      : 0;

  const shortestDistanceMeters =
    distances.length >
    0
      ? Math.min(
          ...distances
        )
      : 0;

  const longestDistanceMeters =
    distances.length >
    0
      ? Math.max(
          ...distances
        )
      : 0;

  const lowestExposure =
    exposures.length >
    0
      ? Math.min(
          ...exposures
        )
      : null;

  const highestExposure =
    exposures.length >
    0
      ? Math.max(
          ...exposures
        )
      : null;

  return {
    fastestTimeSeconds,

    slowestTimeSeconds,

    shortestDistanceMeters,

    longestDistanceMeters,

    lowestExposure,

    highestExposure,

    mode:
      "constrained-exposure-minimization",
  };
}


// ============================================================
// CALCULATE DETOUR
// ============================================================

function calculateDetourPercent(
  duration,
  fastest
) {
  const durationNumber =
    Number(
      duration
    );

  const fastestNumber =
    Number(
      fastest
    );

  if (
    !Number.isFinite(
      fastestNumber
    ) ||
    fastestNumber <= 0
  ) {
    return 0;
  }

  if (
    !Number.isFinite(
      durationNumber
    )
  ) {
    return Infinity;
  }

  return Math.max(
    0,
    round(
      (
        (
          durationNumber -
          fastestNumber
        ) /
        fastestNumber
      ) *
        100,
      2
    )
  );
}


// ============================================================
// ACCEPTABLE DETOUR
// ============================================================

function isWithinAcceptableDetour(
  metric,
  context,
  maxDetourPercent
) {
  if (
    !metric ||
    !context
  ) {
    return false;
  }

  const detourPercent =
    calculateDetourPercent(
      metric.durationSeconds,
      context.fastestTimeSeconds
    );

  return (
    detourPercent <=
    Number(
      maxDetourPercent
    )
  );
}


// ============================================================
// CRITICAL HOTSPOT
// ============================================================

function hasCriticalHotspot(
  metric,
  config
) {
  if (
    !metric
  ) {
    return false;
  }

  const severeAndSustained =
    Number(
      metric.hotspotPeakAqi
    ) >=
      Number(
        config.criticalHotspotAqi
      ) &&
    Number(
      metric.hotspotDurationMinutes
    ) >=
      Number(
        config.criticalHotspotDurationMinutes
      );

  const excessiveExposureShare =
    isValidExposureValue(
      metric.hotspotExposureShare
    ) &&
    metric.hotspotExposureShare >=
      Number(
        config.criticalHotspotExposureShare
      );

  return (
    severeAndSustained ||
    excessiveExposureShare
  );
}


// ============================================================
// EXPOSURE TIE
// ============================================================
//
// null is NEVER considered equivalent to a real exposure.
//

function isExposureApproximatelyEqual(
  exposureA,
  exposureB,
  tiePercent =
    DEFAULT_EXPOSURE_TIE_PERCENT
) {
  const a =
    getValidExposureValue(
      exposureA
    );

  const b =
    getValidExposureValue(
      exposureB
    );

  if (
    a === null ||
    b === null
  ) {
    return false;
  }

  const safeA =
    Math.max(
      0,
      a
    );

  const safeB =
    Math.max(
      0,
      b
    );

  const reference =
    Math.max(
      safeA,
      safeB
    );

  if (
    reference ===
    0
  ) {
    return true;
  }

  const difference =
    Math.abs(
      safeA -
        safeB
    );

  const differencePercent =
    (
      difference /
      reference
    ) *
    100;

  return (
    differencePercent <=
    Number(
      tiePercent
    )
  );
}


// ============================================================
// SELECT LOWEST EXPOSURE
// ============================================================

function selectLowestExposure(
  metrics
) {
  if (
    !Array.isArray(
      metrics
    ) ||
    metrics.length ===
      0
  ) {
    return null;
  }

  const validMetrics =
    metrics.filter(
      (metric) =>
        isValidExposureValue(
          metric?.totalExposure
        )
    );

  if (
    validMetrics.length ===
    0
  ) {
    return null;
  }

  return [
    ...validMetrics,
  ].sort(
    (
      a,
      b
    ) => {
      const exposureDifference =
        Number(
          a.totalExposure
        ) -
        Number(
          b.totalExposure
        );

      if (
        exposureDifference !==
        0
      ) {
        return exposureDifference;
      }

      const timeDifference =
        Number(
          a.durationSeconds
        ) -
        Number(
          b.durationSeconds
        );

      if (
        timeDifference !==
        0
      ) {
        return timeDifference;
      }

      return (
        Number(
          a.distanceMeters
        ) -
        Number(
          b.distanceMeters
        )
      );
    }
  )[0];
}


// ============================================================
// SELECT RECOMMENDED ROUTE
// ============================================================
//
// Canonical strategy:
//
// 1. Valid exposure
// 2. Within maximum detour
// 3. No critical hotspot
// 4. Lowest exposure
// 5. Faster time
// 6. Shorter distance
//
// Fallback:
//
// If no route survives the preferred constraints:
//
//   fastest route with valid exposure
//
// IMPORTANT:
//
// Fallback DOES NOT require acceptable detour.
// This is intentional and matches the Day 8 test contract.
//

function selectRecommendedRoute(
  metrics,
  context,
  config,
  options = {}
) {
  const maxDetourPercent =
    Number.isFinite(
      Number(
        options.maxDetourPercent
      )
    )
      ? Number(
          options.maxDetourPercent
        )
      : Number(
          config.maxDetourPercent
        );

  const exposureTiePercent =
    Number.isFinite(
      Number(
        options.exposureTiePercent
      )
    )
      ? Number(
          options.exposureTiePercent
        )
      : DEFAULT_EXPOSURE_TIE_PERCENT;

  const rejectedRoutes =
    [];

  if (
    !Array.isArray(
      metrics
    ) ||
    metrics.length ===
      0
  ) {
    return {
      winner:
        null,

      mode:
        "unavailable",

      reason:
        "No routes are available.",

      eligibleRoutes:
        [],

      rejectedRoutes,
    };
  }

  const exposureEligible =
    [];

  const detourEligible =
    [];

  const criticalEligible =
    [];

  // ==========================================================
  // EVALUATE EVERY ROUTE
  // ==========================================================

  for (
    const metric of
      metrics
  ) {
    const hasExposure =
      isValidExposureValue(
        metric?.totalExposure
      );

    if (
      !hasExposure
    ) {
      rejectedRoutes.push({
        routeId:
          metric.routeId,

        routeIndex:
          metric.routeIndex,

        reason:
          "AQI exposure unavailable.",
      });

      continue;
    }

    const withinDetour =
      isWithinAcceptableDetour(
        metric,
        context,
        maxDetourPercent
      );

    if (
      !withinDetour
    ) {
      rejectedRoutes.push({
        routeId:
          metric.routeId,

        routeIndex:
          metric.routeIndex,

        reason:
          "Exceeds maximum acceptable travel-time detour.",

        detourPercent:
          metric.detourPercent,
      });

      continue;
    }

    detourEligible.push(
      metric
    );

    if (
      metric.criticalHotspot
    ) {
      rejectedRoutes.push({
        routeId:
          metric.routeId,

        routeIndex:
          metric.routeIndex,

        reason:
          "Critical pollution hotspot risk.",
      });

      continue;
    }

    criticalEligible.push(
      metric
    );

    exposureEligible.push(
      metric
    );
  }

  // ==========================================================
  // PREFERRED CONSTRAINED SELECTION
  // ==========================================================

  if (
    exposureEligible.length >
    0
  ) {
    const sorted =
      [
        ...exposureEligible,
      ].sort(
        (
          a,
          b
        ) => {
          const exposureA =
            a.totalExposure;

          const exposureB =
            b.totalExposure;

          // --------------------------------------------------
          // PRIMARY OBJECTIVE:
          // LOWEST ESTIMATED EXPOSURE
          // --------------------------------------------------

          if (
            exposureA !==
            exposureB
          ) {
            return (
              exposureA -
              exposureB
            );
          }

          // --------------------------------------------------
          // TIE BREAKER:
          // FASTER TRAVEL TIME
          // --------------------------------------------------

          const timeDifference =
            Number(
              a.durationSeconds
            ) -
            Number(
              b.durationSeconds
            );

          if (
            timeDifference !==
            0
          ) {
            return timeDifference;
          }

          // --------------------------------------------------
          // FINAL TIE BREAKER:
          // SHORTER DISTANCE
          // --------------------------------------------------

          return (
            Number(
              a.distanceMeters
            ) -
            Number(
              b.distanceMeters
            )
          );
        }
      );

    const winner =
      sorted[0];

    return {
      winner,

      mode:
        "constrained-exposure-minimization",

      reason:
        "Lowest estimated exposure within acceptable travel-time detour.",

      eligibleRoutes:
        exposureEligible,

      rejectedRoutes,

      context,

      maxDetourPercent,

      exposureTiePercent,
    };
  }

  // ==========================================================
  // FALLBACK
  // ==========================================================
  //
  // No route survived the preferred constraints.
  //
  // Select the fastest route WITH valid exposure.
  //
  // NOTE:
  //
  // This fallback intentionally does NOT require the route to
  // satisfy maxDetourPercent because otherwise there may be
  // no recommendation at all when at least one route has
  // usable exposure data.
  // ==========================================================

  const fastestValidRoute =
    [
      ...metrics,
    ]
      .filter(
        (metric) =>
          isValidExposureValue(
            metric?.totalExposure
          )
      )
      .sort(
        (
          a,
          b
        ) => {
          const timeDifference =
            Number(
              a.durationSeconds
            ) -
            Number(
              b.durationSeconds
            );

          if (
            timeDifference !==
            0
          ) {
            return timeDifference;
          }

          const exposureDifference =
            Number(
              a.totalExposure
            ) -
            Number(
              b.totalExposure
            );

          if (
            exposureDifference !==
            0
          ) {
            return exposureDifference;
          }

          return (
            Number(
              a.distanceMeters
            ) -
            Number(
              b.distanceMeters
            )
          );
        }
      )[0] ||
    null;

  if (
    fastestValidRoute
  ) {
    return {
      winner:
        fastestValidRoute,

      mode:
        "fastest-valid-exposure-fallback",

      reason:
        "No route satisfied the preferred exposure and detour constraints; fastest route with valid exposure selected.",

      eligibleRoutes:
        [],

      rejectedRoutes,

      context,

      maxDetourPercent,

      exposureTiePercent,
    };
  }

  // ==========================================================
  // NO USABLE EXPOSURE
  // ==========================================================

  return {
    winner:
      null,

    mode:
      "unavailable",

    reason:
      "No route has valid AQI exposure data.",

    eligibleRoutes:
      [],

    rejectedRoutes,

    context,

    maxDetourPercent,

    exposureTiePercent,
  };
}


// ============================================================
// BUILD RECOMMENDATION REASON
// ============================================================

function buildRecommendationReason(
  route,
  allRoutes,
  context = {}
) {
  if (
    !route
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // CANONICAL CONSTRAINED MODE
  // ----------------------------------------------------------

  if (
    context.mode ===
    "constrained-exposure-minimization"
  ) {
    return (
      "Lowest estimated exposure within acceptable travel-time detour."
    );
  }

  // ----------------------------------------------------------
  // FASTEST VALID EXPOSURE FALLBACK
  // ----------------------------------------------------------

  if (
    context.mode ===
    "fastest-valid-exposure-fallback"
  ) {
    return (
      "No route satisfied the preferred exposure and detour constraints; fastest route with valid exposure selected."
    );
  }

  // ----------------------------------------------------------
  // UNAVAILABLE
  // ----------------------------------------------------------

  if (
    context.mode ===
    "unavailable"
  ) {
    return (
      "No route has valid AQI exposure data."
    );
  }

  // ----------------------------------------------------------
  // GENERIC VALID EXPOSURE
  // ----------------------------------------------------------

  const validRoutes =
    Array.isArray(
      allRoutes
    )
      ? allRoutes.filter(
          (metric) =>
            isValidExposureValue(
              metric?.totalExposure
            )
        )
      : [];

  if (
    validRoutes.length ===
    0
  ) {
    return (
      "No route has valid AQI exposure data."
    );
  }

  return (
    "Lowest valid exposure among available routes."
  );
}


// ============================================================
// BUILD ROUTE OUTPUT
// ============================================================
//
// IMPORTANT DAY 8 FIX:
//
// recommendationMethod MUST reflect the actual strategy.
//
// Previously this was hard-coded to:
//
//   constrained-exposure-minimization
//
// That caused the fallback test to report the wrong method.
//
// ============================================================

function buildRouteOutput(
  metric,
  recommendation,
  rank
) {
  const recommendedIndex =
    recommendation
      ?.winner
      ?.routeIndex;

  const isRecommended =
    metric.routeIndex ===
    recommendedIndex;

  const rejected =
    recommendation
      ?.rejectedRoutes
      ?.find(
        (item) =>
          item.routeIndex ===
          metric.routeIndex
      );

  let withinAcceptableDetour;

  if (
    rejected?.reason ===
    "Exceeds maximum acceptable travel-time detour."
  ) {
    withinAcceptableDetour =
      false;
  } else if (
    rejected?.reason ===
    "AQI exposure unavailable."
  ) {
    withinAcceptableDetour =
      false;
  } else if (
    rejected?.reason ===
    "Critical pollution hotspot risk."
  ) {
    withinAcceptableDetour =
      false;
  } else {
    withinAcceptableDetour =
      isValidExposureValue(
        metric.totalExposure
      ) &&
      Number.isFinite(
        metric.detourPercent
      );
  }

  const recommendationMethod =
    recommendation?.mode ||
    "unavailable";

  return {
    ...metric,

    rank,

    recommended:
      isRecommended,

    recommendationScore:
      null,

    // ========================================================
    // DAY 8 FIX
    // ========================================================
    recommendationMethod,

    detourPercent:
      round(
        metric.detourPercent,
        2
      ),

    withinAcceptableDetour,

    criticalHotspot:
      metric.criticalHotspot,

    recommendation:
      isRecommended
        ? [
            "RECOMMENDED",
          ]
        : [],

    rejectionReason:
      rejected?.reason ??
      null,
  };
}


// ============================================================
// RANK ROUTES
// ============================================================

function rankRoutes(
  routes,
  options = {}
) {
  // ----------------------------------------------------------
  // Backwards compatibility:
  //
  // rankRoutes(routes, "normal")
  // ----------------------------------------------------------

  if (
    typeof options ===
    "string"
  ) {
    options = {
      profile:
        options,
    };
  }

  if (
    !options ||
    typeof options !==
    "object"
  ) {
    options = {};
  }

  // ==========================================================
  // PROFILE
  // ==========================================================

  const profile =
    normalizeProfile(
      options.profile
    );

  // ==========================================================
  // CONFIG
  // ==========================================================

  const config = {
    ...PROFILE_CONFIG[
      profile
    ],

    ...(options.recommendationConfig ||
      {}),

    ...(options.config ||
      {}),
  };

  if (
    Number.isFinite(
      Number(
        options.maxDetourPercent
      )
    )
  ) {
    config.maxDetourPercent =
      Number(
        options.maxDetourPercent
      );
  }

  if (
    Number.isFinite(
      Number(
        options.criticalHotspotAqi
      )
    )
  ) {
    config.criticalHotspotAqi =
      Number(
        options.criticalHotspotAqi
      );
  }

  if (
    Number.isFinite(
      Number(
        options.criticalHotspotDurationMinutes
      )
    )
  ) {
    config.criticalHotspotDurationMinutes =
      Number(
        options.criticalHotspotDurationMinutes
      );
  }

  if (
    Number.isFinite(
      Number(
        options.criticalHotspotExposureShare
      )
    )
  ) {
    config.criticalHotspotExposureShare =
      Number(
        options.criticalHotspotExposureShare
      );
  }

  const exposureTiePercent =
    Number.isFinite(
      Number(
        options.exposureTiePercent
      )
    )
      ? Number(
          options.exposureTiePercent
        )
      : DEFAULT_EXPOSURE_TIE_PERCENT;

  // ==========================================================
  // EMPTY INPUT
  // ==========================================================

  if (
    !Array.isArray(
      routes
    ) ||
    routes.length ===
      0
  ) {
    return {
      routes: [],

      recommendedRoute:
        null,

      recommendedRouteId:
        null,

      reason:
        "No routes are available.",

      recommendationMode:
        "unavailable",

      fastestRoute:
        null,

      cleanestRoute:
        null,

      balancedRoute:
        null,

      profile,

      // IMPORTANT:
      // This must agree with recommendationMode.
      recommendationMethod:
        "unavailable",

      formula: {
        primaryObjective:
          "minimize estimated AQI-time exposure",

        exposureFormula:
          "SUM(AQI_i × deltaTime_i)",

        primaryConstraint:
          "detourPercent <= maxDetourPercent",

        detourFormula:
          "((routeTime - fastestTime) / fastestTime) × 100",

        tieBreaker:
          "faster travel time, then shorter distance when exposure is tied",

        fallback:
          "fastest route with valid exposure when no preferred route survives",
      },

      recommendationConfig:
        config,

      eligibleRouteCount:
        0,

      rejectedRouteCount:
        0,

      rejectedRoutes:
        [],

      generatedAt:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // BUILD METRICS
  // ==========================================================

  const metrics =
    buildRouteMetrics(
      routes
    );

  // ==========================================================
  // BUILD CONTEXT
  // ==========================================================

  const context =
    buildRecommendationContext(
      metrics
    );

  // ==========================================================
  // DETOUR / HOTSPOT FLAGS
  // ==========================================================

  for (
    const metric of
      metrics
  ) {
    metric.detourPercent =
      calculateDetourPercent(
        metric.durationSeconds,
        context.fastestTimeSeconds
      );

    metric.withinAcceptableDetour =
      isWithinAcceptableDetour(
        metric,
        context,
        config.maxDetourPercent
      );

    metric.criticalHotspot =
      hasCriticalHotspot(
        metric,
        config
      );
  }

  // ==========================================================
  // SELECT WINNER
  // ==========================================================

  const recommendation =
    selectRecommendedRoute(
      metrics,
      context,
      config,
      {
        maxDetourPercent:
          config.maxDetourPercent,

        exposureTiePercent,
      }
    );

  // ==========================================================
  // RECOMMENDATION MODE
  // ==========================================================

  const recommendationMode =
    recommendation.mode ||
    "unavailable";

  // ==========================================================
  // FASTEST VALID-EXPOSURE ROUTE
  // ==========================================================

  const fastestRoute =
    [
      ...metrics,
    ]
      .filter(
        (metric) =>
          isValidExposureValue(
            metric.totalExposure
          )
      )
      .sort(
        (
          a,
          b
        ) => {
          const timeDifference =
            Number(
              a.durationSeconds
            ) -
            Number(
              b.durationSeconds
            );

          if (
            timeDifference !==
            0
          ) {
            return timeDifference;
          }

          return (
            Number(
              a.totalExposure
            ) -
            Number(
              b.totalExposure
            )
          );
        }
      )[0] ||
    null;

  // ==========================================================
  // CLEANEST ROUTE
  // ==========================================================

  const cleanestRoute =
    selectLowestExposure(
      metrics
    );

  // ==========================================================
  // BALANCED ROUTE
  // ==========================================================
  //
  // Retained as compatibility output.
  //
  // It does NOT override canonical recommendation.
  // ==========================================================

  const balancedRoute =
    [
      ...metrics,
    ]
      .filter(
        (metric) =>
          isValidExposureValue(
            metric.totalExposure
          )
      )
      .sort(
        (
          a,
          b
        ) => {
          const exposureDifference =
            Number(
              a.totalExposure
            ) -
            Number(
              b.totalExposure
            );

          if (
            exposureDifference !==
            0
          ) {
            return exposureDifference;
          }

          return (
            Number(
              a.durationSeconds
            ) -
            Number(
              b.durationSeconds
            )
          );
        }
      )[0] ||
    null;

  // ==========================================================
  // RECOMMENDED ROUTE
  // ==========================================================

  const recommendedRoute =
    recommendation.winner ||
    null;

  const recommendedRouteId =
    recommendedRoute?.routeId ||
    null;

  // ==========================================================
  // BUILD FINAL RANKING ORDER
  // ==========================================================

  const rankingOrder =
    [
      ...metrics,
    ].sort(
      (
        a,
        b
      ) => {
        const aRecommended =
          a.routeIndex ===
          recommendedRoute?.routeIndex;

        const bRecommended =
          b.routeIndex ===
          recommendedRoute?.routeIndex;

        // Recommended route first.
        if (
          aRecommended &&
          !bRecommended
        ) {
          return -1;
        }

        if (
          !aRecommended &&
          bRecommended
        ) {
          return 1;
        }

        // Valid exposure first.
        const aExposure =
          isValidExposureValue(
            a.totalExposure
          )
            ? a.totalExposure
            : Infinity;

        const bExposure =
          isValidExposureValue(
            b.totalExposure
          )
            ? b.totalExposure
            : Infinity;

        if (
          aExposure !==
          bExposure
        ) {
          return (
            aExposure -
            bExposure
          );
        }

        // Faster time.
        const timeDifference =
          Number(
            a.durationSeconds
          ) -
          Number(
            b.durationSeconds
          );

        if (
          timeDifference !==
          0
        ) {
          return timeDifference;
        }

        // Shorter distance.
        return (
          Number(
            a.distanceMeters
          ) -
          Number(
            b.distanceMeters
          )
        );
      }
    );

  // ==========================================================
  // BUILD FINAL ROUTES
  // ==========================================================

  const finalRoutes =
    rankingOrder.map(
      (
        metric,
        index
      ) =>
        buildRouteOutput(
          metric,
          recommendation,
          index + 1
        )
    );

  // ==========================================================
  // BUILD EXPLANATION
  // ==========================================================

  const reason =
    buildRecommendationReason(
      recommendedRoute,
      metrics,
      {
        ...context,

        mode:
          recommendationMode,
      }
    );

  // ==========================================================
  // LOGGING
  // ==========================================================

  console.log(
    "\n========================================"
  );

  console.log(
    "       AIRROUTE ROUTE RANKING"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Profile: ${profile}`
  );

  console.log(
    `Max Detour: ${config.maxDetourPercent}%`
  );

  console.log(
    `Critical Hotspot AQI: ${config.criticalHotspotAqi}`
  );

  console.log(
    `Critical Hotspot Duration: ${config.criticalHotspotDurationMinutes} min`
  );

  console.log(
    `Critical Hotspot Exposure Share: ${
      config.criticalHotspotExposureShare *
      100
    }%`
  );

  console.log(
    "----------------------------------------"
  );

  console.log(
    `Recommended Route: ${
      recommendedRouteId ||
      "none"
    }`
  );

  console.log(
    `Mode: ${
      recommendationMode ||
      "none"
    }`
  );

  console.log(
    `Reason: ${
      reason ||
      "No recommendation"
    }`
  );

  console.log(
    "----------------------------------------"
  );

  console.table(
    finalRoutes.map(
      (route) => ({
        route:
          route.routeId,

        rank:
          route.rank,

        distanceKm:
          round(
            route.distanceKm,
            2
          ),

        timeMin:
          round(
            route.durationMinutes,
            1
          ),

        avgAQI:
          round(
            route.averageAqi,
            1
          ),

        peakAQI:
          round(
            route.peakAqi,
            1
          ),

        exposure:
          route.totalExposure,

        detourPercent:
          route.detourPercent,

        acceptableDetour:
          route.withinAcceptableDetour,

        hotspotCount:
          route.hotspotCount,

        hotspotPeakAQI:
          route.hotspotPeakAqi,

        hotspotDurationMin:
          round(
            route.hotspotDurationMinutes,
            2
          ),

        hotspotExposureSharePercent:
          isValidExposureValue(
            route.hotspotExposureShare
          )
            ? round(
                route.hotspotExposureShare *
                  100,
                2
              )
            : null,

        criticalHotspot:
          route.criticalHotspot,

        recommended:
          route.recommended,

        recommendationMethod:
          route.recommendationMethod,
      })
    )
  );

  console.log(
    "========================================\n"
  );

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    routes:
      finalRoutes,

    recommendedRoute,

    recommendedRouteId,

    reason,

    recommendationMode,

    fastestRoute,

    cleanestRoute,

    balancedRoute,

    profile,

    // ========================================================
    // DAY 8 FIX
    //
    // This MUST reflect the actual strategy.
    //
    // constrained-exposure-minimization
    // fastest-valid-exposure-fallback
    // unavailable
    // ========================================================

    recommendationMethod:
      recommendationMode,

    formula: {
      primaryObjective:
        "minimize estimated AQI-time exposure",

      exposureFormula:
        "SUM(AQI_i × deltaTime_i)",

      primaryConstraint:
        "detourPercent <= maxDetourPercent",

      detourFormula:
        "((routeTime - fastestTime) / fastestTime) × 100",

      tieBreaker:
        "faster travel time, then shorter distance when exposure is tied",

      fallback:
        "fastest route with valid exposure when no preferred route survives",
    },

    recommendationConfig:
      config,

    eligibleRouteCount:
      recommendation
        .eligibleRoutes
        ?.length ||
      0,

    rejectedRouteCount:
      recommendation
        .rejectedRoutes
        ?.length ||
      0,

    rejectedRoutes:
      recommendation
        .rejectedRoutes ||
      [],

    generatedAt:
      new Date().toISOString(),
  };
}


// ============================================================
// STRATEGY RESULT
// ============================================================

function getStrategyResult(
  ranking,
  strategy
) {
  if (
    !ranking
  ) {
    return null;
  }

  const normalized =
    String(
      strategy ||
        "RECOMMENDED"
    )
      .trim()
      .toUpperCase();

  if (
    normalized ===
    "FASTEST"
  ) {
    return ranking.fastestRoute;
  }

  if (
    normalized ===
    "CLEANEST"
  ) {
    return ranking.cleanestRoute;
  }

  if (
    normalized ===
    "BALANCED"
  ) {
    return ranking.balancedRoute;
  }

  if (
    normalized ===
    "RECOMMENDED"
  ) {
    return ranking.recommendedRoute;
  }

  return ranking.recommendedRoute;
}


// ============================================================
// TEST ROUTES
// ============================================================

function createTestRoutes() {
  return [
    {
      id:
        "route-A",

      distanceMeters:
        10000,

      durationSeconds:
        1000,

      exposure: {
        totalExposure:
          500,

        exposureScore:
          500,

        averageAqi:
          80,

        peakAqi:
          120,

        coverage:
          100,

        coveragePercent:
          100,

        hotspots: [],
      },
    },

    {
      id:
        "route-B",

      distanceMeters:
        10200,

      durationSeconds:
        1020,

      exposure: {
        totalExposure:
          300,

        exposureScore:
          300,

        averageAqi:
          60,

        peakAqi:
          90,

        coverage:
          100,

        coveragePercent:
          100,

        hotspots: [],
      },
    },

    {
      id:
        "route-C",

      distanceMeters:
        15000,

      durationSeconds:
        1500,

      exposure: {
        totalExposure:
          100,

        exposureScore:
          100,

        averageAqi:
          40,

        peakAqi:
          70,

        coverage:
          100,

        coveragePercent:
          100,

        hotspots: [],
      },
    },
  ];
}


// ============================================================
// RANKING SELF TEST
// ============================================================

function testRouteRanking() {
  const routes =
    createTestRoutes();

  return rankRoutes(
    routes,
    {
      profile:
        "normal",
    }
  );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Route helpers
  getRouteDurationSeconds,
  getRouteDistanceMeters,
  getRouteExposure,

  // Metrics
  buildRouteMetrics,

  // Profile
  normalizeProfile,

  // AQI
  getRouteAverageAqi,
  getRoutePeakAqi,

  // Hotspots
  getRouteHotspots,
  getHotspotCount,
  getHotspotSeverity,
  calculateHotspotMetrics,

  // Detour
  calculateDetourPercent,
  isWithinAcceptableDetour,

  // Safety
  hasCriticalHotspot,
  isExposureApproximatelyEqual,

  // Selection
  selectLowestExposure,
  selectRecommendedRoute,

  // Recommendation
  buildRecommendationContext,
  buildRecommendationReason,
  buildRouteOutput,

  // Main
  rankRoutes,
  getStrategyResult,

  // Testing
  createTestRoutes,
  testRouteRanking,

  // Configuration
  PROFILE_CONFIG,
  DEFAULT_MAX_DETOUR_PERCENT,
  DEFAULT_EXPOSURE_TIE_PERCENT,
  DEFAULT_CRITICAL_HOTSPOT_AQI,
  DEFAULT_CRITICAL_HOTSPOT_DURATION_MINUTES,
  DEFAULT_CRITICAL_HOTSPOT_EXPOSURE_SHARE,

  // Legacy constants
  DEFAULT_TIME_WEIGHT,
  DEFAULT_EXPOSURE_WEIGHT,

  // Day-6 helper exports
  isValidExposureValue,
  getValidExposureValue,
};