"use strict";

// ============================================================
// AIRROUTE - EXPOSURE SCORING
// ============================================================
//
// OpenRouteService
//      ↓
// Route geometry
//      ↓
// Route AQI Engine
//      ↓
// AQI cache
//      ↓
// OpenAQ PRIMARY
//      ↓
// WAQI FALLBACK
//      ↓
// US EPA AQI ESTIMATE
//      ↓
// Time-weighted exposure
//      ↓
// Hotspot detection
//      ↓
// Route ranking
//
// IMPORTANT
// ------------------------------------------------------------
// - This file does NOT fetch AQI providers directly.
// - routeAqiEngine.js owns route AQI retrieval.
// - aqiCache.js owns AQI caching.
// - aqiProviderResolver.js owns OpenAQ → WAQI fallback.
// - This file performs exposure mathematics.
//
// Core MVP formula:
//
//     Exposure = Σ(AQI × time)
//
// IMPORTANT AQI SAFETY
// ------------------------------------------------------------
// - A real numeric AQI is authoritative.
// - Missing AQI is NEVER converted to AQI 0.
// - null / undefined / NaN are unavailable.
// - AQI 0 remains a legitimate AQI value.
// - OpenAQ remains PRIMARY.
// - WAQI remains FALLBACK.
// ============================================================

const {
  decode,
} = require("@googlemaps/polyline-codec");

const {
  processRouteAqi,
} = require("./aqi/routeAqiEngine");

// ============================================================
// PROFILE SENSITIVITY
// ============================================================

const PROFILE_SENSITIVITY = {
  normal: {
    hotSpotThreshold: 200,
    label: "Normal",
  },

  child: {
    hotSpotThreshold: 150,
    label: "Child",
  },

  elderly: {
    hotSpotThreshold: 150,
    label: "Elderly",
  },

  asthma: {
    hotSpotThreshold: 150,
    label: "Asthma / Respiratory",
  },

  pregnant: {
    hotSpotThreshold: 175,
    label: "Pregnant",
  },
};

// ============================================================
// CRITICAL HOTSPOT CONFIGURATION
// ============================================================

const CRITICAL_HOTSPOT_AQI = Number(
  process.env.AQI_CRITICAL_HOTSPOT_AQI || 300
);

const CRITICAL_HOTSPOT_DURATION_MINUTES = Number(
  process.env.AQI_CRITICAL_HOTSPOT_DURATION_MINUTES || 5
);

const CRITICAL_HOTSPOT_EXPOSURE_SHARE = Number(
  process.env.AQI_CRITICAL_HOTSPOT_EXPOSURE_SHARE || 0.50
);

// ============================================================
// ROUTE SAMPLING CONFIGURATION
// ============================================================

const ROUTE_SAMPLE_INTERVAL_METERS = Number(
  process.env.AQI_ROUTE_SAMPLE_METERS || 400
);

// ============================================================
// VALIDATION
// ============================================================

function isValidCoordinate(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function haversineDistanceMeters(
  lat1,
  lng1,
  lat2,
  lng2
) {
  const R = 6371000;

  const toRadians = (value) =>
    (value * Math.PI) / 180;

  const phi1 = toRadians(Number(lat1));
  const phi2 = toRadians(Number(lat2));

  const deltaPhi = toRadians(
    Number(lat2) - Number(lat1)
  );

  const deltaLambda = toRadians(
    Number(lng2) - Number(lng1)
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
// POLYLINE → GEOJSON
// ============================================================

function routePolylineToGeometry(polyline) {
  if (
    typeof polyline !== "string" ||
    !polyline.trim()
  ) {
    throw new Error(
      "Route polyline is required"
    );
  }

  let decoded;

  try {
    decoded = decode(polyline, 5);
  } catch (error) {
    throw new Error(
      `Failed to decode route polyline: ${error.message}`
    );
  }

  if (
    !Array.isArray(decoded) ||
    decoded.length < 2
  ) {
    throw new Error(
      "Route polyline contains insufficient coordinates"
    );
  }

  const coordinates = decoded
    .map((point) => {
      const lat = Number(point?.[0]);
      const lng = Number(point?.[1]);

      if (!isValidCoordinate(lat, lng)) {
        return null;
      }

      return [
        lng,
        lat,
      ];
    })
    .filter(Boolean);

  if (coordinates.length < 2) {
    throw new Error(
      "Route polyline contains no valid coordinates"
    );
  }

  return {
    type: "LineString",
    coordinates,
  };
}

// ============================================================
// ROUTE CENTER
// ============================================================

function getRouteCenter(geometry) {
  if (
    !geometry ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length === 0
  ) {
    return {
      lat: 0,
      lng: 0,
    };
  }

  let latSum = 0;
  let lngSum = 0;
  let count = 0;

  for (
    const coordinate of geometry.coordinates
  ) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2
    ) {
      continue;
    }

    const lng = Number(coordinate[0]);
    const lat = Number(coordinate[1]);

    if (!isValidCoordinate(lat, lng)) {
      continue;
    }

    latSum += lat;
    lngSum += lng;
    count += 1;
  }

  if (count === 0) {
    return {
      lat: 0,
      lng: 0,
    };
  }

  return {
    lat: latSum / count,
    lng: lngSum / count,
  };
}

// ============================================================
// AQI VALUE NORMALIZATION
// ============================================================
//
// IMPORTANT:
//
// Number(null) === 0
//
// Therefore this helper intentionally checks the ORIGINAL value
// before converting it.
//
// Valid:
//   0
//   25
//   79
//   300
//
// Invalid:
//   null
//   undefined
//   ""
//   NaN
//
// ============================================================

function getNumericAqi(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric < 0 || numeric > 500) {
    return null;
  }

  return numeric;
}

// ============================================================
// AQI SAMPLE VALIDATION
// ============================================================
//
// IMPORTANT FIX:
//
// Previously a sample could be rejected only because:
//
//     sample.aqiAvailable !== true
//
// But the route AQI engine/cache already gives us the actual
// numeric AQI.
//
// A numeric AQI from an accepted OpenAQ/WAQI sample is enough.
//
// If aqiAvailable explicitly says false, reject it.
// If the flag is absent but AQI/provider/freshness are valid,
// accept the sample.
//
// ============================================================

function isUsableRouteAqiSample(sample) {
  if (!sample) {
    return false;
  }

  const aqi =
    getNumericAqi(sample.aqi);

  if (aqi === null) {
    return false;
  }

  // Explicit false means unavailable.
  if (
    sample.aqiAvailable === false
  ) {
    return false;
  }

  const provider =
    String(
      sample.provider ||
        sample.source ||
        ""
    )
      .trim()
      .toLowerCase();

  if (
    provider !== "openaq" &&
    provider !== "waqi"
  ) {
    return false;
  }

  const freshness =
    String(
      sample.freshness || ""
    )
      .trim()
      .toLowerCase();

  if (
    freshness === "stale" ||
    freshness === "invalid"
  ) {
    return false;
  }

  if (
    sample.isUsable === false
  ) {
    return false;
  }

  return true;
}

// ============================================================
// NORMALIZE EXPOSURE SAMPLES
// ============================================================

function normalizeExposureSamples(
  samples,
  totalDistanceMeters
) {
  if (
    !Array.isArray(samples) ||
    samples.length === 0
  ) {
    return [];
  }

  const totalDistance =
    Number(totalDistanceMeters);

  const validTotalDistance =
    Number.isFinite(totalDistance) &&
    totalDistance > 0
      ? totalDistance
      : null;

  const normalized = [];

  let previousDistance = 0;

  for (
    let i = 0;
    i < samples.length;
    i += 1
  ) {
    const sample = samples[i];

    const aqi =
      getNumericAqi(sample?.aqi);

    if (aqi === null) {
      continue;
    }

    // Explicitly unavailable samples are rejected.
    if (
      sample?.aqiAvailable === false
    ) {
      continue;
    }

    const provider =
      String(
        sample?.provider ||
          sample?.source ||
          ""
      )
        .trim()
        .toLowerCase();

    if (
      provider !== "openaq" &&
      provider !== "waqi"
    ) {
      continue;
    }

    const freshness =
      String(
        sample?.freshness || ""
      )
        .trim()
        .toLowerCase();

    if (
      freshness === "stale" ||
      freshness === "invalid"
    ) {
      continue;
    }

    if (
      sample?.isUsable === false
    ) {
      continue;
    }

    let distance =
      Number(
        sample?.distanceAlongRoute
      );

    if (
      !Number.isFinite(distance)
    ) {
      if (
        validTotalDistance &&
        samples.length > 1
      ) {
        distance =
          (i /
            (samples.length - 1)) *
          validTotalDistance;
      } else {
        distance =
          previousDistance;
      }
    }

    if (
      distance < previousDistance
    ) {
      distance =
        previousDistance;
    }

    if (
      validTotalDistance &&
      distance > validTotalDistance
    ) {
      distance =
        validTotalDistance;
    }

    normalized.push({
      ...sample,

      aqi,

      aqiAvailable: true,

      provider:
        provider,

      source:
        sample?.source ||
        provider,

      distanceAlongRoute:
        distance,
    });

    previousDistance =
      distance;
  }

  if (
    normalized.length > 0 &&
    validTotalDistance
  ) {
    normalized[
      normalized.length - 1
    ].distanceAlongRoute =
      validTotalDistance;
  }

  return normalized;
}

// ============================================================
// TIME-WEIGHTED EXPOSURE
// ============================================================

function computeExposureScore(
  sampledPointsWithAqi,
  routeDurationSeconds,
  totalDistanceMeters,
  profileType = "normal"
) {
  const profile =
    PROFILE_SENSITIVITY[
      profileType
    ] ||
    PROFILE_SENSITIVITY.normal;

  const hotSpotThreshold =
    Number(
      profile.hotSpotThreshold
    );

  const duration =
    Number(routeDurationSeconds);

  const distance =
    Number(totalDistanceMeters);

  const emptyResult = {
    exposureScore: 0,

    exposureScorePerHour: 0,

    peakAqi: null,

    avgAqi: null,

    exposureBand:
      "Unknown",

    hotspots: [],

    hotspotCount: 0,

    hotspotPeakAqi: 0,

    hotspotDurationMin: 0,

    hotspotExposureShare: 0,

    criticalHotspot: false,

    hasHotspotWarning: false,

    validSamples: 0,

    totalTimeSeconds: 0,

    validTimeSeconds: 0,
  };

  if (
    !Array.isArray(
      sampledPointsWithAqi
    ) ||
    sampledPointsWithAqi.length ===
      0
  ) {
    return emptyResult;
  }

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return emptyResult;
  }

  if (
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return emptyResult;
  }

  const samples =
    normalizeExposureSamples(
      sampledPointsWithAqi,
      distance
    );

  if (
    samples.length === 0
  ) {
    return emptyResult;
  }

  let exposureScore = 0;

  let peakAqi = null;

  let totalTime = 0;

  let validTimeSeconds = 0;

  const hotspots = [];

  let currentHotspot = null;

  for (
    let i = 0;
    i < samples.length;
    i += 1
  ) {
    const point =
      samples[i];

    const aqi =
      getNumericAqi(
        point?.aqi
      );

    if (aqi === null) {
      continue;
    }

    const safeAqi =
      Math.min(
        500,
        Math.max(0, aqi)
      );

    let segmentDistance = 0;

    if (
      i <
      samples.length - 1
    ) {
      segmentDistance =
        Number(
          samples[i + 1]
            .distanceAlongRoute
        ) -
        Number(
          point.distanceAlongRoute
        );
    } else {
      segmentDistance =
        distance -
        Number(
          point.distanceAlongRoute
        );
    }

    if (
      !Number.isFinite(
        segmentDistance
      ) ||
      segmentDistance < 0
    ) {
      segmentDistance = 0;
    }

    const segmentTime =
      (
        segmentDistance /
        distance
      ) *
      duration;

    const segmentExposure =
      safeAqi *
      segmentTime;

    exposureScore +=
      segmentExposure;

    totalTime +=
      segmentTime;

    validTimeSeconds +=
      segmentTime;

    peakAqi =
      peakAqi === null
        ? safeAqi
        : Math.max(
            peakAqi,
            safeAqi
          );

    // ========================================================
    // HOTSPOT
    // ========================================================

    if (
      safeAqi >
      hotSpotThreshold
    ) {
      if (
        !currentHotspot
      ) {
        currentHotspot = {
          startDistance:
            Number(
              point.distanceAlongRoute
            ),

          endDistance:
            Number(
              point.distanceAlongRoute
            ),

          startLat:
            point.lat,

          startLng:
            point.lng,

          endLat:
            point.lat,

          endLng:
            point.lng,

          peakAqi:
            safeAqi,

          exposure:
            segmentExposure,

          durationSeconds:
            segmentTime,
        };
      } else {
        currentHotspot.peakAqi =
          Math.max(
            currentHotspot.peakAqi,
            safeAqi
          );

        currentHotspot.endDistance =
          Number(
            point.distanceAlongRoute
          );

        currentHotspot.endLat =
          point.lat;

        currentHotspot.endLng =
          point.lng;

        currentHotspot.exposure +=
          segmentExposure;

        currentHotspot.durationSeconds +=
          segmentTime;
      }
    } else if (
      currentHotspot
    ) {
      hotspots.push(
        finalizeHotspot(
          currentHotspot,
          exposureScore
        )
      );

      currentHotspot =
        null;
    }
  }

  if (
    currentHotspot
  ) {
    hotspots.push(
      finalizeHotspot(
        currentHotspot,
        exposureScore
      )
    );
  }

  const exposureScorePerHour =
    validTimeSeconds > 0
      ? exposureScore /
        validTimeSeconds
      : 0;

  // ========================================================
  // AQI SUMMARY
  // ========================================================

  const validAqiValues =
    samples
      .map(
        (point) =>
          getNumericAqi(
            point?.aqi
          )
      )
      .filter(
        (value) =>
          value !== null
      );

  const avgAqi =
    validAqiValues.length > 0
      ? validAqiValues.reduce(
          (
            sum,
            value
          ) =>
            sum + value,
          0
        ) /
        validAqiValues.length
      : null;

  let exposureBand =
    validAqiValues.length > 0
      ? "Low"
      : "Unknown";

  if (
    exposureScorePerHour >=
    200
  ) {
    exposureBand =
      "High";
  } else if (
    exposureScorePerHour >=
    100
  ) {
    exposureBand =
      "Moderate";
  }

  const hotspotCount =
    hotspots.length;

  const hotspotPeakAqi =
    hotspotCount > 0
      ? Math.max(
          ...hotspots.map(
            (hotspot) =>
              Number(
                hotspot.peakAqi
              )
          )
        )
      : 0;

  const hotspotDurationMin =
    hotspotCount > 0
      ? Math.max(
          ...hotspots.map(
            (hotspot) =>
              Number(
                hotspot.durationMin
              )
          )
        )
      : 0;

  const hotspotExposureShare =
    exposureScore > 0 &&
    hotspotCount > 0
      ? hotspots.reduce(
          (
            sum,
            hotspot
          ) =>
            sum +
            Number(
              hotspot.exposureShare
            ),
          0
        )
      : 0;

  const criticalHotspot =
    hotspots.some(
      (hotspot) =>
        hotspot.peakAqi >=
          CRITICAL_HOTSPOT_AQI &&
        hotspot.durationMin >=
          CRITICAL_HOTSPOT_DURATION_MINUTES &&
        hotspot.exposureShare >=
          CRITICAL_HOTSPOT_EXPOSURE_SHARE
    );

  return {
    exposureScore:
      Math.round(
        exposureScore
      ),

    exposureScorePerHour:
      Math.round(
        exposureScorePerHour
      ),

    peakAqi:
      peakAqi === null
        ? null
        : Math.round(
            peakAqi
          ),

    avgAqi:
      avgAqi === null
        ? null
        : Math.round(
            avgAqi
          ),

    exposureBand,

    hotspots,

    hotspotCount,

    hotspotPeakAqi:
      Math.round(
        hotspotPeakAqi
      ),

    hotspotDurationMin:
      Number(
        hotspotDurationMin.toFixed(
          2
        )
      ),

    hotspotExposureShare:
      Number(
        hotspotExposureShare.toFixed(
          4
        )
      ),

    criticalHotspot,

    hasHotspotWarning:
      hotspotCount > 0,

    validSamples:
      samples.length,

    totalTimeSeconds:
      Math.round(
        totalTime
      ),

    validTimeSeconds:
      Math.round(
        validTimeSeconds
      ),
  };
}

// ============================================================
// FINALIZE HOTSPOT
// ============================================================

function finalizeHotspot(
  hotspot,
  totalExposure
) {
  const durationSeconds =
    Number(
      hotspot.durationSeconds
    ) || 0;

  const exposure =
    Number(
      hotspot.exposure
    ) || 0;

  const exposureShare =
    totalExposure > 0
      ? exposure /
        totalExposure
      : 0;

  const durationMin =
    durationSeconds /
    60;

  const peakAqi =
    Number(
      hotspot.peakAqi
    ) || 0;

  const critical =
    peakAqi >=
      CRITICAL_HOTSPOT_AQI &&
    durationMin >=
      CRITICAL_HOTSPOT_DURATION_MINUTES &&
    exposureShare >=
      CRITICAL_HOTSPOT_EXPOSURE_SHARE;

  return {
    startDistance:
      Math.round(
        hotspot.startDistance
      ),

    endDistance:
      Math.round(
        hotspot.endDistance
      ),

    distanceMeters:
      Math.max(
        0,
        Math.round(
          hotspot.endDistance -
            hotspot.startDistance
        )
      ),

    startLat:
      hotspot.startLat,

    startLng:
      hotspot.startLng,

    endLat:
      hotspot.endLat,

    endLng:
      hotspot.endLng,

    peakAqi:
      Math.round(
        peakAqi
      ),

    durationSeconds:
      Math.round(
        durationSeconds
      ),

    durationMin:
      Number(
        durationMin.toFixed(
          2
        )
      ),

    exposure:
      Math.round(
        exposure
      ),

    exposureShare:
      Number(
        exposureShare.toFixed(
          4
        )
      ),

    exposureSharePercent:
      Number(
        (
          exposureShare *
          100
        ).toFixed(
          2
        )
      ),

    critical,

    threshold:
      CRITICAL_HOTSPOT_AQI,

    label:
      `High AQI ${(
        hotspot.startDistance /
        1000
      ).toFixed(
        1
      )}-${(
        hotspot.endDistance /
        1000
      ).toFixed(
        1
      )} km`,
  };
}

// ============================================================
// BUILD NO-AQI RESULT
// ============================================================
//
// IMPORTANT:
//
// If routeAqiEngine already has a valid AQI summary, preserve it.
// We do NOT replace valid values with zero.
//
// ============================================================

function buildNoAqiResult(
  route,
  routeAqiResult,
  aqiSamples,
  scoringStartedAt
) {
  const upstreamSummary =
    routeAqiResult?.aqiSummary ||
    null;

  const upstreamAverage =
    getNumericAqi(
      upstreamSummary?.averageAqi
    );

  const upstreamPeak =
    getNumericAqi(
      upstreamSummary?.peakAqi
    );

  const upstreamCoverage =
    Number(
      upstreamSummary?.coveragePercent
    );

  const hasValidUpstreamCoverage =
    Number.isFinite(
      upstreamCoverage
    ) &&
    upstreamCoverage >= 0 &&
    upstreamCoverage <= 100;

  return {
    ...route,

    exposureScore:
      null,

    exposureScorePerHour:
      null,

    // Preserve valid upstream AQI summary.
    peakAqi:
      upstreamPeak,

    avgAqi:
      upstreamAverage,

    exposureBand:
      "Unknown",

    hotspots: [],

    hotspotCount: 0,

    hotspotPeakAqi: 0,

    hotspotDurationMin: 0,

    hotspotExposureShare: 0,

    criticalHotspot: false,

    hasHotspotWarning: false,

    sampledAqiPoints: [],

    aqiSummary:
      upstreamSummary
        ? {
            ...upstreamSummary,

            averageAqi:
              upstreamAverage,

            peakAqi:
              upstreamPeak,

            coveragePercent:
              hasValidUpstreamCoverage
                ? upstreamCoverage
                : null,
          }
        : null,

    aqiDiagnostics: {
      provider:
        routeAqiResult?.provider ??
        null,

      standard:
        routeAqiResult?.standard ??
        "US_EPA_ESTIMATE",

      stationCount:
        Number(
          routeAqiResult?.stationCount
        ) || 0,

      sampleCount:
        Array.isArray(
          aqiSamples
        )
          ? aqiSamples.length
          : 0,

      validSamples: 0,

      coveragePercent:
        hasValidUpstreamCoverage
          ? upstreamCoverage
          : null,

      fallbackCount:
        Array.isArray(
          aqiSamples
        )
          ? aqiSamples.filter(
              (sample) =>
                sample?.fallbackUsed ===
                true
            ).length
          : 0,

      sources: [
        ...new Set(
          (
            Array.isArray(
              aqiSamples
            )
              ? aqiSamples
              : []
          )
            .map(
              (sample) =>
                sample?.source ||
                sample?.provider
            )
            .filter(Boolean)
        ),
      ],

      sampleIntervalMeters:
        ROUTE_SAMPLE_INTERVAL_METERS,

      cacheHit: true,

      scoringTimeMs:
        Date.now() -
        scoringStartedAt,

      uniqueAqiCells:
        Number(
          routeAqiResult
            ?.cache
            ?.uniqueCellCount
        ) || 0,

      aqiLookups:
        Number(
          routeAqiResult
            ?.cache
            ?.aqiLookupCount
        ) || 0,

      lookupReduction:
        Number(
          routeAqiResult
            ?.cache
            ?.lookupReduction
        ) || 0,

      lookupReductionPercent:
        Number(
          routeAqiResult
            ?.cache
            ?.lookupReductionPercent
        ) || 0,
    },
  };
}

// ============================================================
// SCORE SINGLE ROUTE
// ============================================================

async function scoreRoute(
  route,
  profileType = "normal"
) {
  if (!route) {
    throw new Error(
      "Route is required"
    );
  }

  if (!route.polyline) {
    throw new Error(
      "Route polyline is required"
    );
  }

  const scoringStartedAt =
    Date.now();

  // ==========================================================
  // 1. POLYLINE → GEOJSON
  // ==========================================================

  const geometry =
    routePolylineToGeometry(
      route.polyline
    );

  // ==========================================================
  // 2. ROUTE AQI ENGINE
  // ==========================================================

  let routeAqiResult;

  try {
    routeAqiResult =
      await processRouteAqi(
        {
          routeId:
            route.id ?? null,

          routeIndex:
            route.routeIndex ?? null,

          geometry,
        },
        {
          sampleDistanceMeters:
            ROUTE_SAMPLE_INTERVAL_METERS,
        }
      );
  } catch (error) {
    console.error(
      `[exposureScoring] Route AQI engine failed for ${
        route.id ??
        "unknown-route"
      }:`,
      error.message
    );

    throw error;
  }

  // ==========================================================
  // 3. AQI SAMPLES
  // ==========================================================

  const aqiSamples =
    Array.isArray(
      routeAqiResult?.aqiSamples
    )
      ? routeAqiResult.aqiSamples
      : [];

  // ==========================================================
  // 4. ROUTE DISTANCE
  // ==========================================================

  const routeDistanceMeters =
    Number(
      routeAqiResult?.distanceMeters
    ) ||
    Number(
      route.distanceMeters
    ) ||
    0;

  const routeDurationSeconds =
    Number(
      route.durationSeconds
    ) || 0;

  // ==========================================================
  // 5. VALID AQI SAMPLES
  // ==========================================================

  const liveAqiSamples =
    aqiSamples.filter(
      isUsableRouteAqiSample
    );

  console.log(
    `[exposureScoring] Route ${
      route.id ??
      "unknown"
    } AQI samples=${aqiSamples.length} valid=${liveAqiSamples.length}`
  );

  // ==========================================================
  // 6. NO USABLE AQI
  // ==========================================================

  if (
    liveAqiSamples.length ===
    0
  ) {
    console.warn(
      `[exposureScoring] No usable OpenAQ/WAQI AQI available for route ${
        route.id ??
        "unknown-route"
      }`
    );

    return buildNoAqiResult(
      route,
      routeAqiResult,
      aqiSamples,
      scoringStartedAt
    );
  }

  // ==========================================================
  // 7. NORMALIZE SAMPLES
  // ==========================================================

  const normalizedSamples =
    normalizeExposureSamples(
      liveAqiSamples,
      routeDistanceMeters
    );

  if (
    normalizedSamples.length ===
    0
  ) {
    return buildNoAqiResult(
      route,
      routeAqiResult,
      aqiSamples,
      scoringStartedAt
    );
  }

  // ==========================================================
  // 8. COMPUTE EXPOSURE
  // ==========================================================

  const exposure =
    computeExposureScore(
      normalizedSamples,
      routeDurationSeconds,
      routeDistanceMeters,
      profileType
    );

  // ==========================================================
  // 9. FRONTEND AQI POINTS
  // ==========================================================

  const sampledAqiPoints =
    normalizedSamples.map(
      (sample) => ({
        lat:
          sample.lat,

        lng:
          sample.lng,

        aqi:
          getNumericAqi(
            sample.aqi
          ),

        aqiBand:
          sample.band ||
          sample.category ||
          null,

        category:
          sample.category ||
          sample.band ||
          null,

        source:
          sample.source ||
          sample.provider ||
          "unknown",

        provider:
          sample.provider ||
          null,

        standard:
          sample.standard ||
          sample.aqiStandard ||
          "US_EPA_ESTIMATE",

        fallbackUsed:
          sample.fallbackUsed ===
          true,

        freshness:
          sample.freshness ||
          null,

        confidence:
          sample.aqiConfidence ??
          sample.confidence ??
          null,

        dominantPollutant:
          sample.dominantPollutant ??
          null,

        distanceAlongRoute:
          Number(
            sample.distanceAlongRoute
          ) || 0,

        stationCount:
          Number(
            sample.interpolationProviders
          ) ||
          Number(
            sample.stationCount
          ) ||
          0,

        nearestStationDistanceMeters:
          Number(
            sample.nearestProviderDistanceMeters
          ) || null,

        resolvedLat:
          sample.lat,

        resolvedLng:
          sample.lng,

        aqiCellKey:
          sample.aqiCellKey ??
          null,

        // IMPORTANT:
        // Every sample reaching this point has a valid
        // numeric AQI and has passed validation.
        aqiAvailable:
          true,
      })
    );

  // ==========================================================
  // 10. VALID SAMPLE DIAGNOSTICS
  // ==========================================================

  const validSamples =
    sampledAqiPoints.filter(
      (point) =>
        getNumericAqi(
          point?.aqi
        ) !== null
    );

  const fallbackCount =
    aqiSamples.filter(
      (point) =>
        point?.fallbackUsed ===
        true
    ).length;

  const sources = [
    ...new Set(
      aqiSamples
        .map(
          (point) =>
            point?.source ||
            point?.provider
        )
        .filter(Boolean)
    ),
  ];

  const scoringTime =
    Date.now() -
    scoringStartedAt;

  // ==========================================================
  // 11. AQI SUMMARY
  // ==========================================================
  //
  // IMPORTANT FIX:
  //
  // routeAqiEngine is the first AQI summary source.
  //
  // But if it is absent/incomplete, calculate from the actual
  // validated AQI samples instead of producing zero.
  //
  // ==========================================================

  const calculatedAqiValues =
    validSamples
      .map(
        (point) =>
          getNumericAqi(
            point.aqi
          )
      )
      .filter(
        (value) =>
          value !== null
      );

  const calculatedAverageAqi =
    calculatedAqiValues.length >
    0
      ? calculatedAqiValues.reduce(
          (
            sum,
            value
          ) =>
            sum + value,
          0
        ) /
        calculatedAqiValues.length
      : null;

  const calculatedPeakAqi =
    calculatedAqiValues.length >
    0
      ? Math.max(
          ...calculatedAqiValues
        )
      : null;

  const upstreamSummary =
    routeAqiResult?.aqiSummary ||
    {};

  const upstreamAverageAqi =
    getNumericAqi(
      upstreamSummary.averageAqi
    );

  const upstreamPeakAqi =
    getNumericAqi(
      upstreamSummary.peakAqi
    );

  const upstreamCoverage =
    Number(
      upstreamSummary.coveragePercent
    );

  const safeCoverage =
    Number.isFinite(
      upstreamCoverage
    ) &&
    upstreamCoverage >= 0 &&
    upstreamCoverage <= 100
      ? upstreamCoverage
      : (
          aqiSamples.length >
            0
            ? (
                validSamples.length /
                aqiSamples.length
              ) *
              100
            : null
        );

  const finalAverageAqi =
    upstreamAverageAqi !== null
      ? upstreamAverageAqi
      : calculatedAverageAqi;

  const finalPeakAqi =
    upstreamPeakAqi !== null
      ? upstreamPeakAqi
      : calculatedPeakAqi;

  const aqiSummary = {
    ...upstreamSummary,

    averageAqi:
      finalAverageAqi === null
        ? null
        : Math.round(
            finalAverageAqi
          ),

    peakAqi:
      finalPeakAqi === null
        ? null
        : Math.round(
            finalPeakAqi
          ),

    minimumAqi:
      calculatedAqiValues.length >
      0
        ? Math.round(
            Math.min(
              ...calculatedAqiValues
            )
          )
        : (
            getNumericAqi(
              upstreamSummary.minimumAqi
            )
          ),

    maximumAqi:
      calculatedPeakAqi !== null
        ? Math.round(
            calculatedPeakAqi
          )
        : (
            getNumericAqi(
              upstreamSummary.maximumAqi
            )
          ),

    validSamples:
      validSamples.length,

    totalSamples:
      aqiSamples.length,

    coveragePercent:
      safeCoverage === null
        ? null
        : Number(
            safeCoverage.toFixed(
              2
            )
          ),

    source:
      upstreamSummary.source ||
      routeAqiResult?.aqiSource ||
      "unavailable",

    provider:
      upstreamSummary.provider ||
      routeAqiResult?.provider ||
      null,

    standard:
      upstreamSummary.standard ||
      routeAqiResult?.standard ||
      "US_EPA_ESTIMATE",
  };

  // ==========================================================
  // 12. LOG AQI RESULT
  // ==========================================================

  console.log(
    `[exposureScoring] AQI RESULT route=${
      route.id ??
      "unknown"
    } | average=${
      aqiSummary.averageAqi ??
      "unavailable"
    } | peak=${
      aqiSummary.peakAqi ??
      "unavailable"
    } | valid=${
      aqiSummary.validSamples
    }/${aqiSummary.totalSamples} | coverage=${
      aqiSummary.coveragePercent ??
      "unavailable"
    }%`
  );

  console.log(
    `[exposureScoring] Hotspots=${
      exposure.hotspotCount
    } | peak=${
      exposure.hotspotPeakAqi
    } | duration=${
      exposure.hotspotDurationMin
    }min | share=${
      (
        exposure.hotspotExposureShare *
        100
      ).toFixed(2)
    }% | critical=${
      exposure.criticalHotspot
    }`
  );

  if (
    exposure.hotspots.length >
    0
  ) {
    exposure.hotspots.forEach(
      (
        hotspot,
        index
      ) => {
        console.log(
          `[exposureScoring] Hotspot ${
            index + 1
          } | AQI=${
            hotspot.peakAqi
          } | duration=${
            hotspot.durationMin
          }min | exposureShare=${
            hotspot.exposureSharePercent
          }% | critical=${
            hotspot.critical
          }`
        );
      }
    );
  }

  console.log(
    `[exposureScoring] Unique AQI cells=${
      routeAqiResult?.cache
        ?.uniqueCellCount ??
      0
    } | lookups=${
      routeAqiResult?.cache
        ?.aqiLookupCount ??
      0
    } | reduction=${
      routeAqiResult?.cache
        ?.lookupReductionPercent ??
      0
    }%`
  );

  // ==========================================================
  // 13. FINAL SCORED ROUTE
  // ==========================================================

  return {
    ...route,

    exposureScore:
      exposure.exposureScore,

    exposureScorePerHour:
      exposure.exposureScorePerHour,

    peakAqi:
      exposure.peakAqi,

    avgAqi:
      exposure.avgAqi,

    exposureBand:
      exposure.exposureBand,

    hotspots:
      exposure.hotspots,

    hotspotCount:
      exposure.hotspotCount,

    hotspotPeakAqi:
      exposure.hotspotPeakAqi,

    hotspotDurationMin:
      exposure.hotspotDurationMin,

    hotspotExposureShare:
      exposure.hotspotExposureShare,

    criticalHotspot:
      exposure.criticalHotspot,

    hasHotspotWarning:
      exposure.hasHotspotWarning,

    sampledAqiPoints,

    aqiSummary,

    aqiSource:
      routeAqiResult?.aqiSource ??
      "unknown",

    aqiProvider:
      routeAqiResult?.provider ??
      null,

    aqiStandard:
      routeAqiResult?.standard ??
      "US_EPA_ESTIMATE",

    aqiDiagnostics: {
      provider:
        routeAqiResult?.provider ??
        null,

      standard:
        routeAqiResult?.standard ??
        "US_EPA_ESTIMATE",

      stationCount:
        Number(
          routeAqiResult?.stationCount
        ) || 0,

      sampleCount:
        aqiSamples.length,

      validSamples:
        validSamples.length,

      coveragePercent:
        aqiSummary.coveragePercent,

      fallbackCount,

      sources,

      sampleIntervalMeters:
        ROUTE_SAMPLE_INTERVAL_METERS,

      cacheHit:
        true,

      scoringTimeMs:
        scoringTime,

      uniqueAqiCells:
        Number(
          routeAqiResult?.cache
            ?.uniqueCellCount
        ) || 0,

      aqiLookups:
        Number(
          routeAqiResult?.cache
            ?.aqiLookupCount
        ) || 0,

      lookupReduction:
        Number(
          routeAqiResult?.cache
            ?.lookupReduction
        ) || 0,

      lookupReductionPercent:
        Number(
          routeAqiResult?.cache
            ?.lookupReductionPercent
        ) || 0,

      lookupFailures:
        Number(
          routeAqiResult?.cache
            ?.lookupFailures
        ) || 0,

      exposureCalculation: {
        distanceMeters:
          routeDistanceMeters,

        durationSeconds:
          routeDurationSeconds,

        totalTimeSeconds:
          exposure.totalTimeSeconds,

        validTimeSeconds:
          exposure.validTimeSeconds,

        validSamples:
          exposure.validSamples,

        hotspotCount:
          exposure.hotspotCount,

        criticalHotspot:
          exposure.criticalHotspot,
      },
    },
  };
}

// ============================================================
// SCORE MULTIPLE ROUTES
// ============================================================

async function scoreRoutes(
  routes,
  profileType = "normal"
) {
  if (
    !Array.isArray(routes)
  ) {
    throw new Error(
      "routes must be an array"
    );
  }

  if (
    routes.length === 0
  ) {
    return [];
  }

  const startedAt =
    Date.now();

  console.log(
    `[exposureScoring] Batch scoring ${routes.length} route(s) concurrently`
  );

  const results =
    await Promise.allSettled(
      routes.map(
        (
          route,
          index
        ) =>
          scoreRoute(
            {
              ...route,

              routeIndex:
                route?.routeIndex ??
                index,
            },
            profileType
          )
      )
    );

  const scoredRoutes = [];

  results.forEach(
    (
      result,
      index
    ) => {
      const originalRoute =
        routes[index];

      if (
        result.status ===
        "fulfilled"
      ) {
        scoredRoutes.push({
          ...result.value,

          routeIndex:
            originalRoute?.routeIndex ??
            index,
        });

        return;
      }

      console.warn(
        `[exposureScoring] Scoring failed for route ${
          originalRoute?.id ??
          index
        }: ${
          result.reason?.message ||
          result.reason
        }`
      );

      // --------------------------------------------------------
      // IMPORTANT:
      // Never invent AQI/exposure values.
      // --------------------------------------------------------

      scoredRoutes.push({
        ...originalRoute,

        routeIndex:
          originalRoute?.routeIndex ??
          index,

        exposureScore:
          null,

        exposureScorePerHour:
          null,

        peakAqi:
          null,

        avgAqi:
          null,

        exposureBand:
          "Unknown",

        hotspots: [],

        hotspotCount:
          0,

        hotspotPeakAqi:
          0,

        hotspotDurationMin:
          0,

        hotspotExposureShare:
          0,

        criticalHotspot:
          false,

        hasHotspotWarning:
          false,

        sampledAqiPoints:
          [],

        aqiSummary:
          null,

        scoringError:
          result.reason?.message ||
          String(
            result.reason
          ),
      });
    }
  );

  console.log(
    `[exposureScoring] Batch completed in ${
      Date.now() -
      startedAt
    }ms`
  );

  return scoredRoutes;
}

// ============================================================
// ROUTE SORTING
// ============================================================
//
// Priority:
//
// 1. Valid exposure score
// 2. Non-critical route
// 3. Lower exposure
// 4. Faster route
// 5. Shorter distance
//
// ============================================================

function sortRoutesByExposure(
  routes
) {
  if (
    !Array.isArray(routes)
  ) {
    return [];
  }

  return [
    ...routes,
  ].sort(
    (
      a,
      b
    ) => {
      const aRaw =
        a?.exposureScore;

      const bRaw =
        b?.exposureScore;

      const aValid =
        typeof aRaw ===
          "number" &&
        Number.isFinite(
          aRaw
        );

      const bValid =
        typeof bRaw ===
          "number" &&
        Number.isFinite(
          bRaw
        );

      if (
        aValid &&
        !bValid
      ) {
        return -1;
      }

      if (
        !aValid &&
        bValid
      ) {
        return 1;
      }

      if (
        !aValid &&
        !bValid
      ) {
        return 0;
      }

      if (
        a?.criticalHotspot ===
          true &&
        b?.criticalHotspot !==
          true
      ) {
        return 1;
      }

      if (
        a?.criticalHotspot !==
          true &&
        b?.criticalHotspot ===
          true
      ) {
        return -1;
      }

      if (
        aRaw !==
        bRaw
      ) {
        return (
          aRaw -
          bRaw
        );
      }

      const aDuration =
        Number(
          a?.durationSeconds
        );

      const bDuration =
        Number(
          b?.durationSeconds
        );

      const safeADuration =
        Number.isFinite(
          aDuration
        )
          ? aDuration
          : Infinity;

      const safeBDuration =
        Number.isFinite(
          bDuration
        )
          ? bDuration
          : Infinity;

      if (
        safeADuration !==
        safeBDuration
      ) {
        return (
          safeADuration -
          safeBDuration
        );
      }

      const aDistance =
        Number(
          a?.distanceMeters
        );

      const bDistance =
        Number(
          b?.distanceMeters
        );

      const safeADistance =
        Number.isFinite(
          aDistance
        )
          ? aDistance
          : Infinity;

      const safeBDistance =
        Number.isFinite(
          bDistance
        )
          ? bDistance
          : Infinity;

      return (
        safeADistance -
        safeBDistance
      );
    }
  );
}

// ============================================================
// TEST
// ============================================================

async function testRouteAqiEngine(
  polyline
) {
  if (!polyline) {
    throw new Error(
      "Polyline is required"
    );
  }

  const geometry =
    routePolylineToGeometry(
      polyline
    );

  const result =
    await processRouteAqi(
      {
        routeId:
          "test-route",

        geometry,
      },
      {
        sampleDistanceMeters:
          ROUTE_SAMPLE_INTERVAL_METERS,
      }
    );

  return {
    provider:
      result?.provider ??
      null,

    standard:
      result?.standard ??
      "US_EPA_ESTIMATE",

    stationCount:
      Number(
        result?.stationCount
      ) || 0,

    sampleCount:
      Number(
        result?.sampleCount
      ) || 0,

    averageAqi:
      result?.aqiSummary
        ?.averageAqi ??
      null,

    peakAqi:
      result?.aqiSummary
        ?.peakAqi ??
      null,

    coveragePercent:
      Number(
        result?.aqiSummary
          ?.coveragePercent
      ) || 0,

    uniqueAqiCells:
      Number(
        result?.cache
          ?.uniqueCellCount
      ) || 0,

    aqiLookups:
      Number(
        result?.cache
          ?.aqiLookupCount
      ) || 0,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  computeExposureScore,

  scoreRoute,

  scoreRoutes,

  sortRoutesByExposure,

  PROFILE_SENSITIVITY,

  CRITICAL_HOTSPOT_AQI,

  CRITICAL_HOTSPOT_DURATION_MINUTES,

  CRITICAL_HOTSPOT_EXPOSURE_SHARE,

  haversineDistanceMeters,

  routePolylineToGeometry,

  getRouteCenter,

  normalizeExposureSamples,

  testRouteAqiEngine,
};