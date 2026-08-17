"use strict";

// ============================================================
// AIRROUTE - ROUTE ENVIRONMENTAL ADVISORY
// ============================================================
//
// DAY 8 HARDENING
//
// Purpose:
// - Convert route environmental data into user-facing advisory
// - Explain route recommendation when ranking metadata exists
// - Explain travel-time / exposure trade-off
// - Surface AQI coverage quality
// - Surface AQI provider information
// - Surface hotspot information
// - Never treat missing AQI as AQI 0
// - Never treat missing exposure as exposure 0
//
// IMPORTANT:
// - These are environmental travel advisories.
// - They are NOT medical diagnoses.
// - They are NOT medical safety thresholds.
// - Advisory text describes environmental conditions only.
//
// Provider architecture:
//
//   OpenAQ PRIMARY
//        ↓
//   WAQI FALLBACK
//
// This file does NOT perform provider selection.
// ============================================================

// ============================================================
// CONFIGURATION
// ============================================================

function readFiniteEnvNumber(
  envName,
  fallback,
  minimum = null,
  maximum = null
) {
  const raw =
    process.env[envName];

  if (
    raw === undefined ||
    raw === null ||
    raw === ""
  ) {
    return fallback;
  }

  const value =
    Number(raw);

  if (
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  if (
    minimum !== null &&
    value < minimum
  ) {
    return fallback;
  }

  if (
    maximum !== null &&
    value > maximum
  ) {
    return fallback;
  }

  return value;
}

const DEFAULT_HIGH_AQI =
  readFiniteEnvNumber(
    "AIRROUTE_ADVISORY_HIGH_AQI",
    200,
    0,
    1000
  );

const DEFAULT_CRITICAL_AQI =
  readFiniteEnvNumber(
    "AIRROUTE_ADVISORY_CRITICAL_AQI",
    300,
    0,
    1000
  );

const DEFAULT_MIN_AQI_COVERAGE =
  readFiniteEnvNumber(
    "AIRROUTE_ADVISORY_MIN_AQI_COVERAGE",
    50,
    0,
    100
  );

// ============================================================
// NUMBER HELPERS
// ============================================================

function toFiniteNumber(
  value,
  fallback = null
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  const numeric =
    Number(value);

  return Number.isFinite(
    numeric
  )
    ? numeric
    : fallback;
}

// ============================================================
// ROUND
// ============================================================

function round(
  value,
  decimals = 2
) {
  const numeric =
    toFiniteNumber(
      value
    );

  if (
    numeric === null
  ) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      numeric * factor
    ) / factor
  );
}

// ============================================================
// FORMAT NUMBER
// ============================================================

function formatNumber(
  value,
  decimals = 1
) {
  const numeric =
    toFiniteNumber(
      value
    );

  if (
    numeric === null
  ) {
    return "unavailable";
  }

  return numeric.toFixed(
    decimals
  );
}

// ============================================================
// HOTSPOT NORMALIZATION
// ============================================================

function normalizeHotspots(
  route
) {
  if (
    !route ||
    typeof route !==
      "object"
  ) {
    return [];
  }

  // Direct route.hotspots
  if (
    Array.isArray(
      route.hotspots
    )
  ) {
    return route.hotspots;
  }

  // Object-style hotspot container
  if (
    route.hotspots &&
    typeof route.hotspots ===
      "object" &&
    Array.isArray(
      route.hotspots.items
    )
  ) {
    return route.hotspots.items;
  }

  // New ranking/exposure structure
  if (
    Array.isArray(
      route.exposure
        ?.hotspots
    )
  ) {
    return route.exposure.hotspots;
  }

  // Alternate AQI structure
  if (
    Array.isArray(
      route.airQuality
        ?.hotspots
    )
  ) {
    return route.airQuality.hotspots;
  }

  return [];
}

// ============================================================
// HOTSPOT COUNT
// ============================================================

function getHotspotCount(
  route,
  hotspots
) {
  if (
    Array.isArray(
      hotspots
    )
  ) {
    return hotspots.length;
  }

  const count =
    toFiniteNumber(
      route?.hotspotCount ??
        route?.hotspots?.count ??
        route?.exposure?.hotspotCount,
      null
    );

  if (
    count === null
  ) {
    return 0;
  }

  return Math.max(
    0,
    count
  );
}

// ============================================================
// HOTSPOT PEAK AQI
// ============================================================

function getHotspotPeakAqi(
  route,
  hotspots
) {
  const routePeak =
    toFiniteNumber(
      route?.hotspotPeakAqi ??
        route?.hotspots?.peakAqi ??
        route?.exposure
          ?.hotspotPeakAqi,
      null
    );

  if (
    routePeak !== null
  ) {
    return routePeak;
  }

  if (
    !Array.isArray(
      hotspots
    ) ||
    hotspots.length === 0
  ) {
    return null;
  }

  let peak =
    null;

  for (
    const hotspot of
      hotspots
  ) {
    const hotspotAqi =
      toFiniteNumber(
        hotspot?.peakAqi ??
          hotspot?.maxAqi ??
          hotspot?.aqi,
        null
      );

    if (
      hotspotAqi === null
    ) {
      continue;
    }

    peak =
      peak === null
        ? hotspotAqi
        : Math.max(
            peak,
            hotspotAqi
          );
  }

  return peak;
}

// ============================================================
// CRITICAL HOTSPOT CHECK
// ============================================================

function hasCriticalHotspot(
  route,
  hotspots
) {
  if (
    route?.criticalHotspot ===
    true
  ) {
    return true;
  }

  if (
    route?.hotspots &&
    typeof route.hotspots ===
      "object" &&
    route.hotspots.critical ===
      true
  ) {
    return true;
  }

  if (
    route?.exposure
      ?.criticalHotspot ===
    true
  ) {
    return true;
  }

  if (
    Array.isArray(
      hotspots
    )
  ) {
    return hotspots.some(
      (
        hotspot
      ) =>
        hotspot?.critical ===
        true
    );
  }

  return false;
}

// ============================================================
// AQI LEVEL
// ============================================================

function getAqiLevel(
  aqi
) {
  const value =
    toFiniteNumber(
      aqi
    );

  if (
    value === null
  ) {
    return {
      level:
        "unknown",

      label:
        "AQI unavailable",
    };
  }

  if (
    value >=
    DEFAULT_CRITICAL_AQI
  ) {
    return {
      level:
        "critical",

      label:
        "Very high pollution",
    };
  }

  if (
    value >=
    DEFAULT_HIGH_AQI
  ) {
    return {
      level:
        "high",

      label:
        "High pollution",
    };
  }

  if (
    value >=
    100
  ) {
    return {
      level:
        "moderate",

      label:
        "Moderate pollution",
    };
  }

  return {
    level:
      "acceptable",

    label:
      "Lower pollution",
  };
}

// ============================================================
// COVERAGE STATUS
// ============================================================

function getCoverageStatus(
  coverage
) {
  const numericCoverage =
    toFiniteNumber(
      coverage,
      null
    );

  if (
    numericCoverage ===
    null
  ) {
    return {
      available:
        false,

      sufficient:
        false,

      value:
        null,
    };
  }

  const normalizedCoverage =
    Math.max(
      0,
      Math.min(
        100,
        numericCoverage
      )
    );

  return {
    available:
      true,

    sufficient:
      normalizedCoverage >=
      DEFAULT_MIN_AQI_COVERAGE,

    value:
      normalizedCoverage,
  };
}

// ============================================================
// GET ROUTE ID
// ============================================================

function getRouteId(
  route
) {
  return (
    route?.routeId ??
    route?.id ??
    null
  );
}

// ============================================================
// GET ROUTE DURATION
// ============================================================

function getDurationSeconds(
  route
) {
  if (
    !route ||
    typeof route !==
      "object"
  ) {
    return null;
  }

  const value =
    toFiniteNumber(
      route.durationSeconds ??
        route.duration?.seconds ??
        route.travelTimeSeconds ??
        route.travelDurationSeconds,
      null
    );

  if (
    value === null
  ) {
    return null;
  }

  return Math.max(
    0,
    value
  );
}

// ============================================================
// GET ROUTE DISTANCE
// ============================================================

function getDistanceMeters(
  route
) {
  if (
    !route ||
    typeof route !==
      "object"
  ) {
    return null;
  }

  const value =
    toFiniteNumber(
      route.distanceMeters ??
        route.distance?.meters ??
        route.travelDistanceMeters,
      null
    );

  if (
    value === null
  ) {
    return null;
  }

  return Math.max(
    0,
    value
  );
}

// ============================================================
// GET AVERAGE AQI
// ============================================================
//
// Supports the hardened routeRanking output:
//
//   route.averageAqi
//   route.exposure.averageAqi
//
// and legacy structures.
//
// ============================================================

function getAverageAqi(
  route
) {
  return toFiniteNumber(
    route?.averageAqi ??
      route?.avgAqi ??
      route?.exposure
        ?.averageAqi ??
      route?.airQuality
        ?.averageAqi ??
      route?.aqiSummary
        ?.averageAqi,
    null
  );
}

// ============================================================
// GET PEAK AQI
// ============================================================

function getPeakAqi(
  route
) {
  return toFiniteNumber(
    route?.peakAqi ??
      route?.exposure
        ?.peakAqi ??
      route?.airQuality
        ?.peakAqi ??
      route?.aqiSummary
        ?.peakAqi,
    null
  );
}

// ============================================================
// GET COVERAGE
// ============================================================
//
// Supports:
//
//   route.coverage
//   route.coveragePercent
//   route.exposure.coverage
//   route.exposure.coveragePercent
//   route.airQuality.coverage
//   route.aqiSummary.coveragePercent
//
// ============================================================

function getCoverage(
  route
) {
  return toFiniteNumber(
    route?.coverage ??
      route?.coveragePercent ??
      route?.aqiCoverage ??
      route?.exposure
        ?.coverage ??
      route?.exposure
        ?.coveragePercent ??
      route?.airQuality
        ?.coverage ??
      route?.aqiSummary
        ?.coveragePercent,
    null
  );
}

// ============================================================
// GET EXPOSURE
// ============================================================
//
// IMPORTANT DAY 8 FIX:
//
// routeRanking.js produces:
//
//   route.exposure.totalExposure
//
// The old advisory engine did NOT read that field.
//
// We now support:
//
//   exposure.totalExposure
//   exposure.exposureScore
//   exposure.score
//   route.exposureScore
//   route.rankingExposure
//
// Missing exposure remains null.
// It is NEVER converted to zero.
// ============================================================

function getExposure(
  route
) {
  const candidates = [
    route?.exposure
      ?.totalExposure,

    route?.exposure
      ?.exposureScore,

    route?.exposure
      ?.score,

    route?.exposureScore,

    route?.rankingExposure,
  ];

  for (
    const candidate of
      candidates
  ) {
    const numeric =
      toFiniteNumber(
        candidate,
        null
      );

    if (
      numeric !== null
    ) {
      return numeric;
    }
  }

  return null;
}

// ============================================================
// GET EXPOSURE BAND
// ============================================================

function getExposureBand(
  route
) {
  return (
    route?.exposureBand ??
    route?.exposure
      ?.band ??
    "Unknown"
  );
}

// ============================================================
// GET DETOUR
// ============================================================

function getDetourPercent(
  route
) {
  return toFiniteNumber(
    route?.detourPercent ??
      route?.detour
        ?.percent,
    null
  );
}

// ============================================================
// GET PROVIDER
// ============================================================

function getProvider(
  route
) {
  const provider =
    route?.provider ??
    route?.aqiProvider ??
    route?.aqiSource ??
    route?.exposure
      ?.provider ??
    route?.airQuality
      ?.provider ??
    route?.aqiSummary
      ?.provider ??
    null;

  if (
    provider === null ||
    provider ===
      undefined
  ) {
    return null;
  }

  const normalized =
    String(
      provider
    ).trim();

  return normalized
    ? normalized
    : null;
}

// ============================================================
// GET FALLBACK STATUS
// ============================================================

function getFallbackUsed(
  route
) {
  return (
    route?.fallbackUsed ===
      true ||
    route?.aqiDiagnostics
      ?.fallbackUsed ===
      true ||
    route?.aqiSummary
      ?.fallbackUsed ===
      true ||
    route?.exposure
      ?.fallbackUsed ===
      true
  );
}

// ============================================================
// PROVIDER LABEL
// ============================================================
//
// Canonical provider architecture:
//
//   OpenAQ PRIMARY
//   WAQI FALLBACK
//
// ============================================================

function getProviderLabel(
  route
) {
  const provider =
    getProvider(
      route
    );

  const fallbackUsed =
    getFallbackUsed(
      route
    );

  if (
    fallbackUsed
  ) {
    return "WAQI fallback";
  }

  if (
    !provider
  ) {
    return null;
  }

  const normalized =
    provider
      .toLowerCase()
      .trim();

  if (
    normalized ===
    "openaq"
  ) {
    return "OpenAQ";
  }

  if (
    normalized ===
    "waqi"
  ) {
    return "WAQI fallback";
  }

  return provider;
}

// ============================================================
// RECOMMENDATION STATUS
// ============================================================

function isRecommendedRoute(
  route
) {
  return (
    route?.isRecommended ===
      true ||
    route?.recommended ===
      true
  );
}

// ============================================================
// RECOMMENDATION MODE
// ============================================================

function getRecommendationMode(
  route
) {
  return (
    route?.recommendationMode ??
    route?.recommendation
      ?.mode ??
    route?.recommendationMethod ??
    null
  );
}

// ============================================================
// RECOMMENDATION REASON
// ============================================================

function getRecommendationReason(
  route
) {
  return (
    route?.recommendationReason ??
    route?.recommendation
      ?.reason ??
    route?.reason ??
    null
  );
}

// ============================================================
// AQI ADVISORY TEXT
// ============================================================

function buildAqiMessage(
  averageAqi,
  peakAqi
) {
  if (
    averageAqi ===
    null
  ) {
    return {
      level:
        "unknown",

      title:
        "Air quality unavailable",

      message:
        "Air-quality data could not be reliably determined for this route.",
    };
  }

  const level =
    getAqiLevel(
      averageAqi
    );

  if (
    level.level ===
    "critical"
  ) {
    return {
      level:
        "critical",

      title:
        "Very high pollution conditions",

      message:
        "Very high pollution levels are estimated along this route.",
    };
  }

  if (
    level.level ===
    "high"
  ) {
    return {
      level:
        "high",

      title:
        "High pollution conditions",

      message:
        "High pollution levels are estimated along this route.",
    };
  }

  if (
    level.level ===
    "moderate"
  ) {
    return {
      level:
        "moderate",

      title:
        "Moderate pollution conditions",

      message:
        "Moderate pollution levels are estimated along this route.",
    };
  }

  return {
    level:
      "acceptable",

    title:
      "Lower pollution conditions",

    message:
      "Estimated air-quality conditions are relatively lower along this route.",
  };
}

// ============================================================
// COVERAGE MESSAGE
// ============================================================

function buildCoverageMessage(
  coverage
) {
  const status =
    getCoverageStatus(
      coverage
    );

  if (
    !status.available
  ) {
    return {
      available:
        false,

      sufficient:
        false,

      message:
        "AQI coverage is unavailable, so the environmental estimate may be less reliable.",
    };
  }

  if (
    !status.sufficient
  ) {
    return {
      available:
        true,

      sufficient:
        false,

      message:
        `AQI coverage is limited (${formatNumber(
          status.value,
          0
        )}%). This route's environmental estimate has lower confidence.`,
    };
  }

  return {
    available:
      true,

    sufficient:
      true,

    message:
      `AQI coverage is sufficient (${formatNumber(
        status.value,
        0
      )}%).`,
  };
}

// ============================================================
// HOTSPOT MESSAGE
// ============================================================

function buildHotspotMessage(
  route,
  hotspots,
  hotspotCount,
  hotspotPeakAqi,
  criticalHotspot
) {
  if (
    hotspotCount <= 0
  ) {
    return {
      warning:
        false,

      critical:
        false,

      message:
        "No significant pollution hotspots detected along this route.",
    };
  }

  if (
    criticalHotspot
  ) {
    return {
      warning:
        true,

      critical:
        true,

      message:
        hotspotPeakAqi !==
        null
          ? `A critical pollution hotspot is present along this route (peak AQI ${Math.round(
              hotspotPeakAqi
            )}).`
          : "A critical pollution hotspot is present along this route.",
    };
  }

  return {
    warning:
      true,

    critical:
      false,

    message:
      `${hotspotCount} pollution hotspot${
        hotspotCount ===
        1
          ? ""
          : "s"
      } detected along this route${
        hotspotPeakAqi !==
        null
          ? `, with peak AQI ${Math.round(
              hotspotPeakAqi
            )}`
          : ""
      }.`,
  };
}

// ============================================================
// ROUTE TRADE-OFF
// ============================================================

function buildRouteTradeoff(
  route,
  referenceRoute
) {
  if (
    !route ||
    !referenceRoute
  ) {
    return {
      available:
        false,

      extraTimeSeconds:
        null,

      extraTimeMinutes:
        null,

      exposureReductionPercent:
        null,

      referenceRouteId:
        getRouteId(
          referenceRoute
        ),
    };
  }

  const routeId =
    getRouteId(
      route
    );

  const referenceRouteId =
    getRouteId(
      referenceRoute
    );

  if (
    routeId !== null &&
    referenceRouteId !==
      null &&
    routeId ===
      referenceRouteId
  ) {
    return {
      available:
        false,

      extraTimeSeconds:
        0,

      extraTimeMinutes:
        0,

      exposureReductionPercent:
        0,

      referenceRouteId,
    };
  }

  const routeDuration =
    getDurationSeconds(
      route
    );

  const referenceDuration =
    getDurationSeconds(
      referenceRoute
    );

  const routeExposure =
    getExposure(
      route
    );

  const referenceExposure =
    getExposure(
      referenceRoute
    );

  const extraTimeSeconds =
    routeDuration !==
        null &&
    referenceDuration !==
        null
      ? Math.max(
          0,
          routeDuration -
            referenceDuration
        )
      : null;

  let exposureReductionPercent =
    null;

  if (
    routeExposure !==
      null &&
    referenceExposure !==
      null &&
    referenceExposure >
      0
  ) {
    exposureReductionPercent =
      (
        (
          referenceExposure -
          routeExposure
        ) /
        referenceExposure
      ) *
      100;
  }

  return {
    available:
      true,

    extraTimeSeconds,

    extraTimeMinutes:
      extraTimeSeconds !==
      null
        ? extraTimeSeconds /
          60
        : null,

    exposureReductionPercent:
      exposureReductionPercent !==
      null
        ? round(
            exposureReductionPercent,
            2
          )
        : null,

    referenceRouteId:
      referenceRouteId,
  };
}

// ============================================================
// RECOMMENDATION EXPLANATION
// ============================================================

function buildRecommendationExplanation(
  route,
  referenceRoute = null
) {
  if (
    !route
  ) {
    return null;
  }

  const recommended =
    isRecommendedRoute(
      route
    );

  const mode =
    getRecommendationMode(
      route
    );

  const reason =
    getRecommendationReason(
      route
    );

  const detour =
    getDetourPercent(
      route
    );

  const exposure =
    getExposure(
      route
    );

  const tradeoff =
    buildRouteTradeoff(
      route,
      referenceRoute
    );

  // ----------------------------------------------------------
  // Canonical recommendation mode
  // ----------------------------------------------------------

  if (
    recommended &&
    mode ===
      "constrained-exposure-minimization"
  ) {
    let message =
      "This route has the lowest estimated pollution exposure within the acceptable travel-time detour.";

    if (
      tradeoff.available &&
      tradeoff.extraTimeMinutes !==
        null &&
      tradeoff.exposureReductionPercent !==
        null &&
      tradeoff.exposureReductionPercent >
        0
    ) {
      message +=
        ` It adds about ${formatNumber(
          tradeoff.extraTimeMinutes,
          1
        )} min and reduces estimated exposure by about ${formatNumber(
          tradeoff.exposureReductionPercent,
          0
        )}%.`;
    } else if (
      detour !==
      null
    ) {
      message +=
        ` Current detour is ${formatNumber(
          detour,
          1
        )}%.`;
    }

    return {
      type:
        "constrained-exposure-minimization",

      message,

      detourPercent:
        detour,

      exposure,

      exposureReductionPercent:
        tradeoff.exposureReductionPercent,

      extraTimeMinutes:
        tradeoff.extraTimeMinutes,

      referenceRouteId:
        tradeoff.referenceRouteId,
    };
  }

  // ----------------------------------------------------------
  // Fastest fallback
  // ----------------------------------------------------------

  if (
    mode ===
      "fastest-valid-exposure-fallback" ||
    String(
      reason || ""
    )
      .toLowerCase()
      .includes(
        "fastest route"
      )
  ) {
    return {
      type:
        "fastest-valid-exposure-fallback",

      message:
        "No route satisfied the preferred exposure and travel-time constraints, so the fastest route with valid exposure data was selected.",

      detourPercent:
        detour,

      exposure,

      exposureReductionPercent:
        tradeoff.exposureReductionPercent,

      extraTimeMinutes:
        tradeoff.extraTimeMinutes,

      referenceRouteId:
        tradeoff.referenceRouteId,
    };
  }

  // ----------------------------------------------------------
  // AQI unavailable
  // ----------------------------------------------------------

  if (
    mode ===
      "unavailable"
  ) {
    return {
      type:
        "unavailable",

      message:
        "No route has valid AQI exposure data, so a pollution-based recommendation cannot be established.",

      detourPercent:
        detour,

      exposure:
        null,

      exposureReductionPercent:
        null,

      extraTimeMinutes:
        tradeoff.extraTimeMinutes,

      referenceRouteId:
        tradeoff.referenceRouteId,
    };
  }

  // ----------------------------------------------------------
  // Degraded coverage
  // ----------------------------------------------------------

  if (
    mode ===
      "degraded-aqi-coverage"
  ) {
    return {
      type:
        "degraded-aqi-coverage",

      message:
        "This recommendation is based on limited AQI coverage. Treat the environmental comparison as lower-confidence.",

      detourPercent:
        detour,

      exposure,

      exposureReductionPercent:
        tradeoff.exposureReductionPercent,

      extraTimeMinutes:
        tradeoff.extraTimeMinutes,

      referenceRouteId:
        tradeoff.referenceRouteId,
    };
  }

  // ----------------------------------------------------------
  // Ranking reason
  // ----------------------------------------------------------

  if (
    reason
  ) {
    return {
      type:
        "ranking-reason",

      message:
        String(
          reason
        ),

      detourPercent:
        detour,

      exposure,

      exposureReductionPercent:
        tradeoff.exposureReductionPercent,

      extraTimeMinutes:
        tradeoff.extraTimeMinutes,

      referenceRouteId:
        tradeoff.referenceRouteId,
    };
  }

  // ----------------------------------------------------------
  // Generic recommendation
  // ----------------------------------------------------------

  if (
    recommended
  ) {
    return {
      type:
        "recommended",

      message:
        "This route is recommended based on the available route and environmental data.",

      detourPercent:
        detour,

      exposure,

      exposureReductionPercent:
        tradeoff.exposureReductionPercent,

      extraTimeMinutes:
        tradeoff.extraTimeMinutes,

      referenceRouteId:
        tradeoff.referenceRouteId,
    };
  }

  return null;
}

// ============================================================
// ROUTE ADVISORY
// ============================================================

function buildRouteAdvisory(
  route,
  options = {}
) {
  // ----------------------------------------------------------
  // Invalid / missing route
  // ----------------------------------------------------------

  if (
    !route ||
    typeof route !==
      "object" ||
    Array.isArray(route)
  ) {
    return {
      level:
        "unknown",

      title:
        "Air quality unavailable",

      message:
        "Environmental air-quality information is currently unavailable for this route.",

      hotspotWarning:
        false,

      critical:
        false,

      averageAqi:
        null,

      peakAqi:
        null,

      coverage:
        null,

      coverageSufficient:
        false,

      coverageAvailable:
        false,

      provider:
        null,

      providerLabel:
        null,

      fallbackUsed:
        false,

      exposure:
        null,

      exposureBand:
        "Unknown",

      detourPercent:
        null,

      recommendation:
        null,

      tradeoff:
        null,

      hotspotCount:
        0,

      hotspotPeakAqi:
        null,
    };
  }

  // ==========================================================
  // EXTRACT DATA
  // ==========================================================

  const averageAqi =
    getAverageAqi(
      route
    );

  const peakAqi =
    getPeakAqi(
      route
    );

  const coverage =
    getCoverage(
      route
    );

  const coverageStatus =
    getCoverageStatus(
      coverage
    );

  const hotspots =
    normalizeHotspots(
      route
    );

  const hotspotCount =
    getHotspotCount(
      route,
      hotspots
    );

  const hotspotPeakAqi =
    getHotspotPeakAqi(
      route,
      hotspots
    );

  const criticalHotspot =
    hasCriticalHotspot(
      route,
      hotspots
    );

  const hotspotWarning =
    hotspotCount >
    0;

  const aqiMessage =
    buildAqiMessage(
      averageAqi,
      peakAqi
    );

  const coverageMessage =
    buildCoverageMessage(
      coverage
    );

  const hotspotMessage =
    buildHotspotMessage(
      route,
      hotspots,
      hotspotCount,
      hotspotPeakAqi,
      criticalHotspot
    );

  const referenceRoute =
    options &&
    typeof options ===
      "object"
      ? options.referenceRoute ??
        null
      : null;

  const recommendation =
    buildRecommendationExplanation(
      route,
      referenceRoute
    );

  const provider =
    getProvider(
      route
    );

  const providerLabel =
    getProviderLabel(
      route
    );

  const fallbackUsed =
    getFallbackUsed(
      route
    );

  const exposure =
    getExposure(
      route
    );

  const exposureBand =
    getExposureBand(
      route
    );

  const detourPercent =
    getDetourPercent(
      route
    );

  // ==========================================================
  // MISSING AQI
  // ==========================================================
  //
  // IMPORTANT:
  //
  // Missing AQI is represented by null.
  //
  // It is NEVER converted to 0.
  // ==========================================================

  if (
    averageAqi ===
    null
  ) {
    const unavailableMessage =
      coverageMessage.available
        ? "Air-quality data could not be reliably determined for this route."
        : "Air-quality data is unavailable for this route, so environmental exposure cannot be estimated reliably.";

    return {
      level:
        "unknown",

      title:
        "Air quality unavailable",

      message:
        unavailableMessage,

      hotspotWarning,

      critical:
        criticalHotspot,

      averageAqi:
        null,

      peakAqi:
        peakAqi !==
        null
          ? peakAqi
          : hotspotPeakAqi,

      coverage:
        coverage !==
        null
          ? coverage
          : null,

      coverageSufficient:
        coverageStatus.sufficient,

      coverageAvailable:
        coverageStatus.available,

      coverageWarning:
        coverageMessage.message,

      provider,

      providerLabel,

      fallbackUsed,

      exposure,

      exposureBand,

      detourPercent,

      recommendation,

      hotspotCount,

      hotspotPeakAqi,

      hotspotMessage:
        hotspotMessage.message,

      referenceRouteId:
        referenceRoute
          ? getRouteId(
              referenceRoute
            )
          : null,
    };
  }

  // ==========================================================
  // BASE MESSAGE
  // ==========================================================

  let message =
    aqiMessage.message;

  if (
    aqiMessage.level ===
    "critical"
  ) {
    message =
      "Very high pollution levels are estimated along this route. Consider limiting prolonged outdoor exposure where practical.";
  } else if (
    aqiMessage.level ===
    "high"
  ) {
    message =
      "High pollution levels are estimated along this route. Consider reducing prolonged outdoor exposure where practical.";
  } else if (
    aqiMessage.level ===
    "moderate"
  ) {
    message =
      "Moderate pollution levels are estimated along this route.";
  } else {
    message =
      "Estimated air-quality conditions are relatively lower along this route.";
  }

  // ==========================================================
  // HOTSPOT
  // ==========================================================

  if (
    criticalHotspot
  ) {
    message +=
      " A critical pollution hotspot is present along part of the route.";
  } else if (
    hotspotWarning
  ) {
    message +=
      ` ${hotspotCount} pollution hotspot${
        hotspotCount ===
        1
          ? ""
          : "s"
      } detected along the route.`;
  }

  // ==========================================================
  // LIMITED COVERAGE
  // ==========================================================

  if (
    coverageStatus.available &&
    !coverageStatus.sufficient
  ) {
    message +=
      " AQI coverage is limited, so this environmental estimate has lower confidence.";
  }

  // ==========================================================
  // FINAL ADVISORY
  // ==========================================================

  return {
    level:
      aqiMessage.level,

    title:
      aqiMessage.title,

    message,

    hotspotWarning,

    critical:
      criticalHotspot,

    averageAqi,

    peakAqi:
      peakAqi !==
      null
        ? peakAqi
        : averageAqi,

    coverage:
      coverage !==
      null
        ? coverage
        : null,

    coverageSufficient:
      coverageStatus.sufficient,

    coverageAvailable:
      coverageStatus.available,

    coverageWarning:
      coverageMessage.message,

    hotspotCount,

    hotspotPeakAqi,

    hotspotMessage:
      hotspotMessage.message,

    provider,

    providerLabel,

    fallbackUsed,

    exposure,

    exposureBand,

    detourPercent,

    recommendation,

    referenceRouteId:
      referenceRoute
        ? getRouteId(
            referenceRoute
          )
        : null,
  };
}

// ============================================================
// BUILD ROUTE COMPARISON
// ============================================================

function buildRouteComparison(
  routes,
  recommendedRoute
) {
  const routeList =
    Array.isArray(
      routes
    )
      ? routes
      : [];

  if (
    !recommendedRoute
  ) {
    return null;
  }

  const recommendedId =
    getRouteId(
      recommendedRoute
    );

  const validRoutes =
    routeList.filter(
      (
        route
      ) =>
        getRouteId(
          route
        ) !==
          null &&
        getDurationSeconds(
          route
        ) !==
          null
    );

  if (
    validRoutes.length ===
    0
  ) {
    return null;
  }

  const fastestRoute =
    [
      ...validRoutes,
    ].sort(
      (
        a,
        b
      ) => {
        const aDuration =
          getDurationSeconds(
            a
          );

        const bDuration =
          getDurationSeconds(
            b
          );

        return (
          aDuration -
          bDuration
        );
      }
    )[0];

  const tradeoff =
    buildRouteTradeoff(
      recommendedRoute,
      fastestRoute
    );

  const recommendedExposure =
    getExposure(
      recommendedRoute
    );

  const fastestExposure =
    getExposure(
      fastestRoute
    );

  return {
    recommendedRouteId:
      recommendedId,

    fastestRouteId:
      getRouteId(
        fastestRoute
      ),

    isFastest:
      recommendedId ===
      getRouteId(
        fastestRoute
      ),

    extraTimeMinutes:
      tradeoff.extraTimeMinutes,

    exposureReductionPercent:
      tradeoff.exposureReductionPercent,

    recommendedExposure,

    fastestExposure,

    detourPercent:
      getDetourPercent(
        recommendedRoute
      ),
  };
}

// ============================================================
// OVERALL ADVISORY
// ============================================================

function buildOverallAdvisory(
  routes,
  recommendedRoute
) {
  const routeList =
    Array.isArray(
      routes
    )
      ? routes
      : [];

  // ----------------------------------------------------------
  // No recommendation
  // ----------------------------------------------------------

  if (
    !recommendedRoute
  ) {
    return {
      level:
        "unknown",

      title:
        "Route advisory unavailable",

      message:
        "A recommended route could not be determined from the available environmental data.",

      routeId:
        null,

      routeCount:
        routeList.length,

      recommendation:
        null,

      comparison:
        null,

      exposure:
        null,

      averageAqi:
        null,

      peakAqi:
        null,

      coverage:
        null,

      coverageSufficient:
        false,

      provider:
        null,

      fallbackUsed:
        false,
    };
  }

  // ==========================================================
  // FIND FASTEST ROUTE
  // ==========================================================

  const validRoutes =
    routeList.filter(
      (
        route
      ) =>
        getDurationSeconds(
          route
        ) !==
        null
    );

  const fastestRoute =
    validRoutes.length >
    0
      ? [
          ...validRoutes,
        ].sort(
          (
            a,
            b
          ) => {
            const aDuration =
              getDurationSeconds(
                a
              );

            const bDuration =
              getDurationSeconds(
                b
              );

            return (
              aDuration -
              bDuration
            );
          }
        )[0]
      : null;

  // ==========================================================
  // BUILD SHARED ADVISORY
  // ==========================================================

  const routeAdvisory =
    buildRouteAdvisory(
      recommendedRoute,
      {
        referenceRoute:
          fastestRoute,
      }
    );

  // ==========================================================
  // BUILD COMPARISON
  // ==========================================================

  const comparison =
    buildRouteComparison(
      routeList,
      recommendedRoute
    );

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    ...routeAdvisory,

    routeId:
      getRouteId(
        recommendedRoute
      ),

    routeCount:
      routeList.length,

    recommendation:
      routeAdvisory
        .recommendation,

    comparison,

    fastestRouteId:
      fastestRoute
        ? getRouteId(
            fastestRoute
          )
        : null,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // AQI
  getAqiLevel,

  // Hotspots
  normalizeHotspots,
  getHotspotCount,
  getHotspotPeakAqi,
  hasCriticalHotspot,

  // Coverage
  getCoverageStatus,

  // Route data
  getRouteId,
  getDurationSeconds,
  getDistanceMeters,
  getAverageAqi,
  getPeakAqi,
  getCoverage,
  getExposure,
  getExposureBand,
  getDetourPercent,

  // Provider
  getProvider,
  getFallbackUsed,
  getProviderLabel,

  // Recommendation
  isRecommendedRoute,
  getRecommendationMode,
  getRecommendationReason,
  buildRecommendationExplanation,
  buildRouteTradeoff,

  // Advisory
  buildRouteAdvisory,
  buildOverallAdvisory,
  buildRouteComparison,
};