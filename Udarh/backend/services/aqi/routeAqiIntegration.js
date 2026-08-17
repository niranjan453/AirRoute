"use strict";

// ============================================================
// AIRROUTE - ROUTE AQI REAL DATA INTEGRATION
// ============================================================
//
// PERFORMANCE-OPTIMIZED FLOW:
//
// ORS Routes
//    ↓
// Combined route area
//    ↓
// AQI Provider Resolver
//    ↓
// OpenAQ PRIMARY
//    ↓ failure / unusable
// WAQI FALLBACK
//    ↓
/* normalized stations */
//    ↓
// Shared station AQI dataset
//    ↓
// Route 1 → spatial interpolation
// Route 2 → spatial interpolation
// Route 3 → spatial interpolation
//
// IMPORTANT:
// - OpenAQ is PRIMARY.
// - WAQI is FALLBACK.
// - Provider selection is handled by a single resolver.
// - Route integration must NOT bypass the resolver.
// - Missing AQI is represented as null.
// - Missing AQI is NEVER converted to AQI 0.
// ============================================================

const {
  sampleRouteWithMetadata,
} = require("./routeSampling");

const {
  interpolateRouteSamples,
  summarizeRouteAqi,
} = require("./aqiSpatialInterpolation");

const {
  resolveAQIProvider,
} = require("./aqiProviderResolver");

// ============================================================
// CONFIG
// ============================================================

const DEFAULT_STATION_RADIUS_METERS =
  Number(
    process.env.AQI_STATION_RADIUS_METERS ||
      25000
  );

const DEFAULT_SAMPLE_DISTANCE_METERS =
  Number(
    process.env.AQI_ROUTE_SAMPLE_METERS ||
      400
  );

const DEFAULT_MAX_STATIONS =
  Number(
    process.env.AQI_MAX_NEARBY_STATIONS ||
      5
  );

const DEFAULT_MIN_STATIONS =
  Number(
    process.env.AQI_MIN_NEARBY_STATIONS ||
      2
  );

const DEFAULT_MAX_INTERPOLATION_DISTANCE_METERS =
  Number(
    process.env.AQI_INTERPOLATION_MAX_DISTANCE_METERS ||
      25000
  );

// ============================================================
// BASIC VALIDATION
// ============================================================

function isValidCoordinate(
  lat,
  lng
) {
  return (
    Number.isFinite(
      Number(lat)
    ) &&
    Number.isFinite(
      Number(lng)
    ) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180
  );
}

// ============================================================
// FIND ROUTE CENTER
// ============================================================

function getRouteCenter(
  samples
) {
  if (
    !Array.isArray(
      samples
    ) ||
    samples.length === 0
  ) {
    throw new Error(
      "Cannot calculate route center without samples"
    );
  }

  let totalLat = 0;
  let totalLng = 0;
  let validCount = 0;

  for (
    const sample of samples
  ) {
    const lat =
      Number(
        sample?.lat
      );

    const lng =
      Number(
        sample?.lng
      );

    if (
      !isValidCoordinate(
        lat,
        lng
      )
    ) {
      continue;
    }

    totalLat += lat;
    totalLng += lng;
    validCount += 1;
  }

  if (
    validCount === 0
  ) {
    throw new Error(
      "No valid coordinates available for route center"
    );
  }

  return {
    lat:
      totalLat /
      validCount,

    lng:
      totalLng /
      validCount,
  };
}

// ============================================================
// GET ROUTE BOUNDS
// ============================================================

function getRouteBounds(
  samples
) {
  if (
    !Array.isArray(
      samples
    ) ||
    samples.length === 0
  ) {
    return null;
  }

  let minLat = Infinity;
  let maxLat = -Infinity;

  let minLng = Infinity;
  let maxLng = -Infinity;

  let validCount = 0;

  for (
    const sample of samples
  ) {
    const lat =
      Number(
        sample?.lat
      );

    const lng =
      Number(
        sample?.lng
      );

    if (
      !isValidCoordinate(
        lat,
        lng
      )
    ) {
      continue;
    }

    minLat =
      Math.min(
        minLat,
        lat
      );

    maxLat =
      Math.max(
        maxLat,
        lat
      );

    minLng =
      Math.min(
        minLng,
        lng
      );

    maxLng =
      Math.max(
        maxLng,
        lng
      );

    validCount += 1;
  }

  if (
    validCount === 0
  ) {
    return null;
  }

  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
  };
}

// ============================================================
// COMBINE ROUTE SAMPLES
// ============================================================

function combineRouteSamples(
  sampledRoutes
) {
  const combined = [];

  if (
    !Array.isArray(
      sampledRoutes
    )
  ) {
    return combined;
  }

  for (
    const sampled of sampledRoutes
  ) {
    if (
      !Array.isArray(
        sampled?.samples
      )
    ) {
      continue;
    }

    for (
      const sample of
        sampled.samples
    ) {
      const lat =
        Number(
          sample?.lat
        );

      const lng =
        Number(
          sample?.lng
        );

      if (
        isValidCoordinate(
          lat,
          lng
        )
      ) {
        combined.push({
          lat,
          lng,
        });
      }
    }
  }

  return combined;
}

// ============================================================
// GET COMBINED ROUTE BOUNDS
// ============================================================

function getCombinedRouteBounds(
  sampledRoutes
) {
  const samples =
    combineRouteSamples(
      sampledRoutes
    );

  return getRouteBounds(
    samples
  );
}

// ============================================================
// GET COMBINED ROUTE CENTER
// ============================================================

function getCombinedRouteCenter(
  sampledRoutes
) {
  const samples =
    combineRouteSamples(
      sampledRoutes
    );

  return getRouteCenter(
    samples
  );
}

// ============================================================
// BUILD ROUTE AQI QUERY AREA
// ============================================================

function getStationSearchConfig(
  samples,
  options = {}
) {
  const center =
    getRouteCenter(
      samples
    );

  const routeBounds =
    getRouteBounds(
      samples
    );

  return {
    center,

    bounds:
      routeBounds,

    radiusMeters:
      Number(
        options.stationRadiusMeters ||
          DEFAULT_STATION_RADIUS_METERS
      ),
  };
}

// ============================================================
// BUILD MULTI-ROUTE STATION SEARCH CONFIG
// ============================================================

function getMultiRouteStationSearchConfig(
  sampledRoutes,
  options = {}
) {
  const center =
    getCombinedRouteCenter(
      sampledRoutes
    );

  const bounds =
    getCombinedRouteBounds(
      sampledRoutes
    );

  return {
    center,

    bounds,

    radiusMeters:
      Number(
        options.stationRadiusMeters ||
          DEFAULT_STATION_RADIUS_METERS
      ),
  };
}

// ============================================================
// NORMALIZE STATION AQI
// ============================================================
//
// Converts resolver station formats into the normalized format
// expected by route interpolation.
//
// Supports:
// - OpenAQ normalized stations
// - WAQI normalized stations
// - resolver station wrappers
// ============================================================

function normalizeStationAqi(
  station
) {
  if (!station) {
    return null;
  }

  const nestedStation =
    station?.station &&
    typeof station.station ===
      "object"
      ? station.station
      : station;

  const aqiCandidates = [
    station?.aqi,
    nestedStation?.aqi,
    station?.AQI,
    nestedStation?.AQI,
  ];

  let aqi = null;

  for (
    const candidate of
      aqiCandidates
  ) {
    const value =
      Number(
        candidate
      );

    if (
      Number.isFinite(
        value
      )
    ) {
      aqi = value;
      break;
    }
  }

  const latCandidates = [
    station?.lat,
    station?.latitude,
    station?.coordinates
      ?.lat,
    nestedStation?.lat,
    nestedStation?.latitude,
    nestedStation?.coordinates
      ?.lat,
  ];

  const lngCandidates = [
    station?.lng,
    station?.longitude,
    station?.coordinates
      ?.lng,
    nestedStation?.lng,
    nestedStation?.longitude,
    nestedStation?.coordinates
      ?.lng,
  ];

  let lat = null;
  let lng = null;

  for (
    const candidate of
      latCandidates
  ) {
    const value =
      Number(
        candidate
      );

    if (
      Number.isFinite(
        value
      )
    ) {
      lat = value;
      break;
    }
  }

  for (
    const candidate of
      lngCandidates
  ) {
    const value =
      Number(
        candidate
      );

    if (
      Number.isFinite(
        value
      )
    ) {
      lng = value;
      break;
    }
  }

  if (
    !Number.isFinite(
      aqi
    ) ||
    !isValidCoordinate(
      lat,
      lng
    )
  ) {
    return null;
  }

  const provider =
    String(
      station?.provider ||
        nestedStation?.provider ||
        ""
    )
      .trim()
      .toLowerCase();

  const source =
    station?.source ||
    nestedStation?.source ||
    provider ||
    "unknown";

  return {
    stationId:
      station?.stationId ??
      station?.id ??
      nestedStation?.stationId ??
      nestedStation?.id ??
      null,

    stationName:
      station?.stationName ??
      station?.name ??
      nestedStation?.stationName ??
      nestedStation?.name ??
      "Unknown station",

    lat,

    lng,

    aqi,

    category:
      station?.category ??
      station?.aqiCategory ??
      nestedStation?.category ??
      null,

    dominantPollutant:
      station?.dominantPollutant ??
      nestedStation?.dominantPollutant ??
      null,

    freshness:
      station?.freshness ??
      nestedStation?.freshness ??
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
        : Number.isFinite(
            Number(
              nestedStation?.ageMinutes
            )
          )
        ? Number(
            nestedStation.ageMinutes
          )
        : null,

    source,

    provider:
      provider ||
      source,

    standard:
      station?.standard ??
      nestedStation?.standard ??
      "US_EPA_ESTIMATE",

    fallbackUsed:
      station?.fallbackUsed ===
        true ||
      nestedStation?.fallbackUsed ===
        true,

    observedAt:
      station?.observedAt ??
      nestedStation?.observedAt ??
      null,

    isLive:
      station?.isLive === true ||
      nestedStation?.isLive === true,

    isRecent:
      station?.isRecent === true ||
      nestedStation?.isRecent === true,

    isStale:
      station?.isStale === true ||
      nestedStation?.isStale === true,
  };
}

// ============================================================
// FILTER USABLE STATIONS
// ============================================================

function filterUsableStations(
  stations,
  options = {}
) {
  const {
    excludeStale = true,
  } = options;

  if (
    !Array.isArray(
      stations
    )
  ) {
    return [];
  }

  return stations
    .map(
      normalizeStationAqi
    )
    .filter(Boolean)
    .filter(
      (station) => {
        if (
          excludeStale &&
          station.freshness ===
            "stale"
        ) {
          return false;
        }

        return (
          Number.isFinite(
            Number(
              station.aqi
            )
          ) &&
          isValidCoordinate(
            station.lat,
            station.lng
          )
        );
      }
    );
}

// ============================================================
// EXTRACT STATION AQI DATA
// ============================================================
//
// Provider resolver can return:
//
// {
//   stations: []
// }
//
// or an array directly.
//
// Normalize both forms.
// ============================================================

function extractStationAqiData(
  providerResult
) {
  if (
    Array.isArray(
      providerResult
    )
  ) {
    return providerResult;
  }

  if (
    Array.isArray(
      providerResult?.stations
    )
  ) {
    return providerResult.stations;
  }

  if (
    Array.isArray(
      providerResult?.data
    )
  ) {
    return providerResult.data;
  }

  return [];
}

// ============================================================
// EMPTY AQI RESULT
// ============================================================
//
// Used when both OpenAQ and WAQI are unavailable.
//
// IMPORTANT:
// AQI remains null.
// We do NOT return AQI = 0.
// ============================================================

function buildNoStationResult(
  route,
  sampled,
  searchConfig
) {
  const aqiSamples =
    sampled.samples.map(
      (sample) => ({
        ...sample,

        aqi:
          null,

        aqiCategory:
          null,

        aqiSource:
          "no-station-data",

        aqiConfidence:
          "none",

        stationCount:
          0,

        nearestStationDistanceMeters:
          null,

        dominantPollutant:
          null,

        stationInfluence:
          [],

        provider:
          null,

        fallbackUsed:
          false,
      })
    );

  return {
    routeId:
      route?.routeId ??
      route?.id ??
      null,

    routeIndex:
      route?.routeIndex ??
      null,

    geometry:
      route?.geometry,

    distanceMeters:
      sampled.totalDistanceMeters,

    distanceKm:
      sampled.totalDistanceKm,

    sampleDistanceMeters:
      sampled.sampleSpacingMeters,

    sampleCount:
      sampled.sampleCount,

    aqiSamples,

    aqiSummary:
      summarizeRouteAqi(
        aqiSamples
      ),

    stationCount:
      0,

    stationsUsed:
      [],

    stationSearch:
      searchConfig,

    provider:
      null,

    source:
      "unavailable",

    fallbackUsed:
      false,

    generatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// FETCH STATION AQI
// ============================================================
//
// DAY 6 FIX:
//
// The old implementation directly called OpenAQ:
//
// routeAqiIntegration
//        ↓
// openaqProvider
//
// That bypassed WAQI.
//
// New implementation:
//
// routeAqiIntegration
//        ↓
// aqiProviderResolver
//        ↓
// OpenAQ PRIMARY
//        ↓
// WAQI FALLBACK
//
// This keeps the provider architecture centralized.
// ============================================================

async function fetchStationAqi(
  center,
  radiusMeters,
  options = {}
) {
  if (
    !center ||
    !isValidCoordinate(
      center.lat,
      center.lng
    )
  ) {
    throw new Error(
      "Invalid station search center"
    );
  }

  const startedAt =
    Date.now();

  console.log(
    `[routeAqiIntegration] AQI provider lookup center=${center.lat},${center.lng} radius=${radiusMeters}m`
  );

  let providerResult;

  try {
    providerResult =
      await resolveAQIProvider(
        center.lat,
        center.lng,
        radiusMeters,
        {
          ...options,

          // Preserve the resolver's normal behavior.
          // forceWAQI can still be used by explicit tests.
          forceWAQI:
            options.forceWAQI === true,
        }
      );
  } catch (
    error
  ) {
    console.error(
      "[routeAqiIntegration] AQI provider resolver failed:",
      error.message
    );

    // Provider failure must not crash route AQI processing.
    return [];
  }

  const providerStations =
    extractStationAqiData(
      providerResult
    );

  const stations =
    providerStations
      .map(
        normalizeStationAqi
      )
      .filter(Boolean);

  console.log(
    `[routeAqiIntegration] Provider lookup completed in ${
      Date.now() -
      startedAt
    }ms`
  );

  console.log(
    `[routeAqiIntegration] provider=${
      providerResult?.provider ??
      "none"
    }`
  );

  console.log(
    `[routeAqiIntegration] usable=${
      providerResult?.usable ===
      true
    }`
  );

  console.log(
    `[routeAqiIntegration] fallbackUsed=${
      providerResult?.fallbackUsed ===
      true
    }`
  );

  console.log(
    `[routeAqiIntegration] stations=${
      stations.length
    }`
  );

  if (
    stations.length ===
    0
  ) {
    console.warn(
      "[routeAqiIntegration] No usable AQI stations available"
    );

    return [];
  }

  return stations;
}

// ============================================================
// SAMPLE ALL ROUTES FIRST
// ============================================================

function sampleAllRoutes(
  routes,
  options = {}
) {
  if (
    !Array.isArray(
      routes
    )
  ) {
    throw new Error(
      "routes must be an array"
    );
  }

  return routes.map(
    (
      route,
      index
    ) => {
      if (!route) {
        throw new Error(
          `Route ${index} is missing`
        );
      }

      if (
        !route.geometry
      ) {
        throw new Error(
          `Route ${index} geometry is missing`
        );
      }

      const sampled =
        sampleRouteWithMetadata(
          route.geometry,
          {
            sampleDistanceMeters:
              Number(
                options.sampleDistanceMeters ||
                  DEFAULT_SAMPLE_DISTANCE_METERS
              ),
          }
        );

      if (
        sampled.sampleCount ===
        0
      ) {
        throw new Error(
          `Route ${index} produced no AQI samples`
        );
      }

      return {
        route,

        sampled,

        routeIndex:
          route.routeIndex ??
          index,
      };
    }
  );
}

// ============================================================
// BUILD ROUTE RESULT
// ============================================================

function buildRouteResult(
  route,
  sampled,
  stations,
  options = {}
) {
  const aqiSamples =
    interpolateRouteSamples(
      sampled.samples,
      stations,
      {
        maxDistanceMeters:
          Number(
            options.maxInterpolationDistanceMeters ||
              DEFAULT_MAX_INTERPOLATION_DISTANCE_METERS
          ),

        minStations:
          Number(
            options.minStations ||
              DEFAULT_MIN_STATIONS
          ),

        maxStations:
          Number(
            options.maxStations ||
              DEFAULT_MAX_STATIONS
          ),

        excludeStale:
          options.excludeStale !==
          false,
      }
    );

  const aqiSummary =
    summarizeRouteAqi(
      aqiSamples
    );

  const providers = [
    ...new Set(
      stations
        .map(
          (station) =>
            station?.provider ||
            station?.source
        )
        .filter(Boolean)
    ),
  ];

  const fallbackUsed =
    stations.some(
      (station) =>
        station?.fallbackUsed ===
        true
    );

  return {
    routeId:
      route?.routeId ??
      route?.id ??
      null,

    routeIndex:
      route?.routeIndex ??
      null,

    geometry:
      route?.geometry,

    distanceMeters:
      sampled.totalDistanceMeters,

    distanceKm:
      sampled.totalDistanceKm,

    sampleDistanceMeters:
      sampled.sampleSpacingMeters,

    sampleCount:
      sampled.sampleCount,

    aqiSamples,

    aqiSummary,

    stationCount:
      stations.length,

    stationsUsed:
      stations.map(
        (station) => ({
          stationId:
            station.stationId,

          stationName:
            station.stationName,

          lat:
            station.lat,

          lng:
            station.lng,

          aqi:
            station.aqi,

          freshness:
            station.freshness,

          ageMinutes:
            station.ageMinutes,

          source:
            station.source,

          provider:
            station.provider,

          standard:
            station.standard,

          fallbackUsed:
            station.fallbackUsed,
        })
      ),

    provider:
      providers.length ===
      1
        ? providers[0]
        : providers.length >
          1
        ? providers
        : null,

    source:
      providers.length ===
      1
        ? providers[0]
        : providers.length >
          1
        ? "mixed"
        : "unavailable",

    fallbackUsed,

    generatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// PROCESS ONE REAL ROUTE
// ============================================================
//
// Compatibility API.
//
// Performs one provider lookup for this route.
// For multiple routes, prefer processRealRoutesAqi().
// ============================================================

async function processRealRouteAqi(
  route,
  options = {}
) {
  if (!route) {
    throw new Error(
      "Route is required"
    );
  }

  if (
    !route.geometry
  ) {
    throw new Error(
      "Route geometry is required"
    );
  }

  const sampled =
    sampleRouteWithMetadata(
      route.geometry,
      {
        sampleDistanceMeters:
          Number(
            options.sampleDistanceMeters ||
              DEFAULT_SAMPLE_DISTANCE_METERS
          ),
      }
    );

  if (
    sampled.sampleCount ===
    0
  ) {
    throw new Error(
      "Route produced no AQI samples"
    );
  }

  const searchConfig =
    getStationSearchConfig(
      sampled.samples,
      options
    );

  console.log(
    "\n================================="
  );

  console.log(
    "      REAL ROUTE AQI ENGINE"
  );

  console.log(
    "================================="
  );

  console.log(
    "Route:",
    route.routeId ??
      route.id ??
      "unknown"
  );

  console.log(
    "Route distance:",
    sampled.totalDistanceKm,
    "km"
  );

  console.log(
    "Route samples:",
    sampled.sampleCount
  );

  console.log(
    "Station search center:",
    searchConfig.center
  );

  console.log(
    "Station radius:",
    searchConfig.radiusMeters,
    "meters"
  );

  let rawStations = [];

  try {
    rawStations =
      await fetchStationAqi(
        searchConfig.center,
        searchConfig.radiusMeters,
        options
      );
  } catch (
    error
  ) {
    console.error(
      "[routeAqiIntegration] Station lookup failed:",
      error.message
    );

    rawStations = [];
  }

  const stations =
    filterUsableStations(
      rawStations,
      {
        excludeStale:
          options.excludeStale !==
          false,
      }
    );

  console.log(
    "[routeAqiIntegration] Raw stations:",
    rawStations.length
  );

  console.log(
    "[routeAqiIntegration] Usable AQI stations:",
    stations.length
  );

  if (
    stations.length ===
    0
  ) {
    return buildNoStationResult(
      route,
      sampled,
      searchConfig
    );
  }

  const result =
    buildRouteResult(
      route,
      sampled,
      stations,
      options
    );

  return {
    ...result,

    stationSearch:
      searchConfig,
  };
}

// ============================================================
// PROCESS MULTIPLE ROUTES - OPTIMIZED
// ============================================================
//
// IMPORTANT:
//
// BEFORE:
//
// Route 1 → provider lookup
// Route 2 → provider lookup
// Route 3 → provider lookup
//
// AFTER:
//
// Routes 1/2/3
//      ↓
// Combined route area
//      ↓
// ONE provider resolver lookup
//      ↓
// Shared stations
//      ↓
// Independent route interpolation
//
// This preserves the Day-5 performance optimization.
// ============================================================

async function processRealRoutesAqi(
  routes,
  options = {}
) {
  if (
    !Array.isArray(
      routes
    )
  ) {
    throw new Error(
      "routes must be an array"
    );
  }

  if (
    routes.length ===
    0
  ) {
    return [];
  }

  const overallStart =
    Date.now();

  console.log(
    "\n=============================================="
  );

  console.log(
    "[routeAqiIntegration] MULTI-ROUTE AQI ENGINE"
  );

  console.log(
    "=============================================="
  );

  console.log(
    `[routeAqiIntegration] Routes: ${routes.length}`
  );

  // ----------------------------------------------------------
  // STEP 1
  // SAMPLE ALL ROUTES
  // ----------------------------------------------------------

  const sampledRoutes =
    sampleAllRoutes(
      routes,
      options
    );

  let totalSamples = 0;

  for (
    const item of
      sampledRoutes
  ) {
    totalSamples +=
      item.sampled
        .sampleCount;
  }

  console.log(
    `[routeAqiIntegration] Total route samples: ${totalSamples}`
  );

  // ----------------------------------------------------------
  // STEP 2
  // BUILD ONE COMBINED SEARCH AREA
  // ----------------------------------------------------------

  const searchConfig =
    getMultiRouteStationSearchConfig(
      sampledRoutes.map(
        (item) =>
          item.sampled
      ),
      options
    );

  console.log(
    "[routeAqiIntegration] Shared station search center:",
    searchConfig.center
  );

  console.log(
    "[routeAqiIntegration] Shared station radius:",
    searchConfig.radiusMeters,
    "meters"
  );

  // ----------------------------------------------------------
  // STEP 3
  // ONE PROVIDER LOOKUP
  // ----------------------------------------------------------

  const providerStart =
    Date.now();

  let rawStations = [];

  try {
    rawStations =
      await fetchStationAqi(
        searchConfig.center,
        searchConfig.radiusMeters,
        options
      );
  } catch (
    error
  ) {
    console.error(
      "[routeAqiIntegration] Shared AQI provider lookup failed:",
      error.message
    );

    rawStations = [];
  }

  const stations =
    filterUsableStations(
      rawStations,
      {
        excludeStale:
          options.excludeStale !==
          false,
      }
    );

  console.log(
    `[routeAqiIntegration] Shared provider lookup: ${
      Date.now() -
      providerStart
    }ms`
  );

  console.log(
    `[routeAqiIntegration] Raw stations: ${rawStations.length}`
  );

  console.log(
    `[routeAqiIntegration] Usable stations: ${stations.length}`
  );

  // ----------------------------------------------------------
  // STEP 4
  // INTERPOLATE EACH ROUTE FROM SAME DATASET
  // ----------------------------------------------------------

  const results = [];

  for (
    const item of
      sampledRoutes
  ) {
    const route =
      item.route;

    const sampled =
      item.sampled;

    console.log(
      `[routeAqiIntegration] Processing route ${
        item.routeIndex
      }`
    );

    if (
      stations.length ===
      0
    ) {
      results.push(
        buildNoStationResult(
          {
            ...route,

            routeIndex:
              item.routeIndex,
          },
          sampled,
          searchConfig
        )
      );

      continue;
    }

    try {
      const result =
        buildRouteResult(
          {
            ...route,

            routeIndex:
              item.routeIndex,
          },
          sampled,
          stations,
          options
        );

      results.push({
        ...result,

        stationSearch:
          searchConfig,
      });
    } catch (
      error
    ) {
      console.error(
        `[routeAqiIntegration] Route ${item.routeIndex} interpolation failed:`,
        error.message
      );

      results.push(
        buildNoStationResult(
          {
            ...route,

            routeIndex:
              item.routeIndex,
          },
          sampled,
          searchConfig
        )
      );
    }
  }

  // ----------------------------------------------------------
  // STEP 5
  // FINAL DIAGNOSTICS
  // ----------------------------------------------------------

  console.log(
    "\n=============================================="
  );

  console.log(
    "[routeAqiIntegration] MULTI-ROUTE COMPLETE"
  );

  console.log(
    `Routes processed: ${results.length}`
  );

  console.log(
    `Shared stations: ${stations.length}`
  );

  console.log(
    `Total time: ${
      Date.now() -
      overallStart
    }ms`
  );

  console.log(
    "==============================================\n"
  );

  return results;
}

// ============================================================
// COMPARE REAL ROUTES
// ============================================================

function compareRealRoutes(
  routeResults
) {
  if (
    !Array.isArray(
      routeResults
    )
  ) {
    return {
      cleanestRoute:
        null,

      highestExposureRoute:
        null,

      routes: [],
    };
  }

  const valid =
    routeResults.filter(
      (route) =>
        Number.isFinite(
          Number(
            route?.aqiSummary
              ?.averageAqi
          )
        )
    );

  if (
    valid.length ===
    0
  ) {
    return {
      cleanestRoute:
        null,

      highestExposureRoute:
        null,

      routes: [],
    };
  }

  const ranked =
    valid
      .map(
        (route) => ({
          routeId:
            route.routeId,

          routeIndex:
            route.routeIndex,

          averageAqi:
            route
              .aqiSummary
              .averageAqi,

          peakAqi:
            route
              .aqiSummary
              .peakAqi,

          minimumAqi:
            route
              .aqiSummary
              .minimumAqi,

          distanceKm:
            route.distanceKm,

          coveragePercent:
            route
              .aqiSummary
              .coveragePercent,

          stationCount:
            route.stationCount,

          provider:
            route.provider ??
            null,

          fallbackUsed:
            route.fallbackUsed ===
            true,
        })
      )
      .sort(
        (a, b) =>
          a.averageAqi -
          b.averageAqi
      );

  return {
    cleanestRoute:
      ranked[0],

    highestExposureRoute:
      ranked[
        ranked.length - 1
      ],

    routes:
      ranked,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getRouteCenter,

  getRouteBounds,

  getCombinedRouteBounds,

  getCombinedRouteCenter,

  getStationSearchConfig,

  getMultiRouteStationSearchConfig,

  normalizeStationAqi,

  filterUsableStations,

  extractStationAqiData,

  fetchStationAqi,

  processRealRouteAqi,

  processRealRoutesAqi,

  compareRealRoutes,
};