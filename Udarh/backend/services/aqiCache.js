"use strict";

// ============================================================
// AIRROUTE - DYNAMIC SPATIAL AQI CACHE
// ============================================================
//
// PERFORMANCE-HARDENED VERSION
//
// Architecture:
//
// Route sample
//      ↓
// 500m spatial cell
//      ↓
// AQI cell cache HIT?
//   YES → return cached AQI
//   NO
//      ↓
// Provider-result cache HIT?
//   YES → reuse recent OpenAQ/WAQI stations
//   NO
//      ↓
// OpenAQ PRIMARY
//      ↓
// WAQI FALLBACK
//      ↓
// Cache provider result
//      ↓
// Spatial interpolation
//      ↓
// Cache 500m AQI cell
//
// IMPORTANT
// ------------------------------------------------------------
// OpenAQ = PRIMARY
// WAQI   = FALLBACK
//
// Open-Meteo is NOT used.
// No fabricated AQI values.
// AQI unavailable is NEVER converted to AQI 0.
//
// PERFORMANCE FIXES
// ------------------------------------------------------------
// 1. 500m AQI cell cache
// 2. In-flight cell deduplication
// 3. Provider-result cache
// 4. In-flight provider-result deduplication
// 5. Provider queries reused across nearby cells
// 6. No repeated OpenAQ request for every 500m cell
// 7. Existing OpenAQ → WAQI resolver remains authoritative
//
// ============================================================

const cron =
  require("node-cron");

const {
  resolveAQIProvider,
} = require("./aqi/aqiProviderResolver");

const {
  interpolateAqi,
} = require("./aqi/aqiSpatialInterpolation");

const {
  calculateUsEpaAqi,
  getAqiCategory,
} = require("./aqi/usEpaAqi");

// ============================================================
// CONFIG
// ============================================================

const CELL_SIZE_METERS =
  500;

const CACHE_TTL_MINUTES =
  Math.max(
    Number(
      process.env
        .AQI_STATION_CACHE_REFRESH_MINUTES ||
        10
    ),
    1
  );

const CACHE_TTL_MS =
  CACHE_TTL_MINUTES *
  60 *
  1000;

// ------------------------------------------------------------
// Provider-result cache
// ------------------------------------------------------------
//
// This is deliberately shorter than the 500m AQI cell TTL.
//
// Why?
//
// A provider result contains station observations.
// We can reuse that station set for nearby route cells,
// while still refreshing provider data periodically.
//
// Default: 2 minutes.
//
// Can be configured:
//
// AQI_PROVIDER_CACHE_MINUTES=2
//
// ------------------------------------------------------------

const PROVIDER_CACHE_MINUTES =
  Math.max(
    Number(
      process.env
        .AQI_PROVIDER_CACHE_MINUTES ||
        2
    ),
    1
  );

const PROVIDER_CACHE_TTL_MS =
  PROVIDER_CACHE_MINUTES *
  60 *
  1000;

// ------------------------------------------------------------
// Provider cache spatial bucket.
//
// 0.05 degrees is approximately 5km around Delhi latitude.
// This is intentionally much larger than the 500m AQI cell,
// because the provider request already uses a large radius.
//
// The provider resolver remains responsible for choosing
// OpenAQ PRIMARY / WAQI FALLBACK.
//
// ------------------------------------------------------------

const PROVIDER_CACHE_LAT_STEP =
  Number(
    process.env
      .AQI_PROVIDER_CACHE_LAT_STEP ||
      0.05
  );

const PROVIDER_CACHE_LNG_STEP =
  Number(
    process.env
      .AQI_PROVIDER_CACHE_LNG_STEP ||
      0.05
  );

// ============================================================
// STATION / INTERPOLATION CONFIG
// ============================================================

const STATION_RADIUS_METERS =
  Math.min(
    Math.max(
      Number(
        process.env
          .AQI_STATION_RADIUS_METERS ||
          25000
      ),
      1000
    ),
    25000
  );

const MAX_INTERPOLATION_DISTANCE_METERS =
  Math.min(
    Math.max(
      Number(
        process.env
          .AQI_INTERPOLATION_MAX_DISTANCE_METERS ||
          25000
      ),
      1000
    ),
    25000
  );

const MIN_NEARBY_STATIONS =
  Math.max(
    Number(
      process.env
        .AQI_MIN_NEARBY_STATIONS ||
        2
    ),
    1
  );

const MAX_NEARBY_STATIONS =
  Math.max(
    Number(
      process.env
        .AQI_MAX_NEARBY_STATIONS ||
        5
    ),
    MIN_NEARBY_STATIONS
  );

const REFRESH_MINUTES =
  Math.max(
    Number(
      process.env
        .AQI_STATION_CACHE_REFRESH_MINUTES ||
        10
    ),
    1
  );

// ============================================================
// STATE
// ============================================================

const state = {
  // Final normalized 500m AQI cells.
  cells:
    new Map(),

  // In-flight 500m cell refreshes.
  pending:
    new Map(),

  // Cached provider results.
  //
  // KEY:
  //   provider-region key
  //
  // VALUE:
  //   {
  //      providerResult,
  //      updatedAt
  //   }
  //
  providerResults:
    new Map(),

  // In-flight provider-result requests.
  providerPending:
    new Map(),

  // Dynamic region metadata.
  regions:
    new Map(),

  isReady:
    false,

  lastUpdated:
    null,

  lastRefreshSource:
    null,

  // ----------------------------------------------------------
  // CACHE DIAGNOSTICS
  // ----------------------------------------------------------

  hits:
    0,

  misses:
    0,

  pendingWaits:
    0,

  refreshes:
    0,

  failedRefreshes:
    0,

  // ----------------------------------------------------------
  // PROVIDER CACHE DIAGNOSTICS
  // ----------------------------------------------------------

  providerCacheHits:
    0,

  providerCacheMisses:
    0,

  providerPendingWaits:
    0,

  providerRefreshes:
    0,

  providerCacheExpired:
    0,
};

let cronStarted =
  false;

// ============================================================
// GEO HELPERS
// ============================================================

function metersToLat(
  meters
) {
  return (
    Number(meters) /
    111320
  );
}

function metersToLng(
  meters,
  lat
) {
  const cosLat =
    Math.cos(
      (
        Number(lat) *
        Math.PI
      ) /
        180
    );

  if (
    Math.abs(cosLat) <
    0.000001
  ) {
    return (
      Number(meters) /
      111320
    );
  }

  return (
    Number(meters) /
    (
      111320 *
      cosLat
    )
  );
}

// ============================================================
// VALIDATE COORDINATES
// ============================================================

function validateCoordinates(
  lat,
  lng
) {
  const latitude =
    Number(lat);

  const longitude =
    Number(lng);

  if (
    !Number.isFinite(
      latitude
    ) ||
    !Number.isFinite(
      longitude
    ) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(
      "Invalid latitude or longitude"
    );
  }

  return {
    lat:
      latitude,

    lng:
      longitude,
  };
}

// ============================================================
// 500M CELL KEY
// ============================================================

function getCellKey(
  lat,
  lng
) {
  const latitude =
    Number(lat);

  const longitude =
    Number(lng);

  if (
    !Number.isFinite(
      latitude
    ) ||
    !Number.isFinite(
      longitude
    )
  ) {
    return null;
  }

  const latStep =
    metersToLat(
      CELL_SIZE_METERS
    );

  const lngStep =
    metersToLng(
      CELL_SIZE_METERS,
      latitude
    );

  const latIndex =
    Math.floor(
      latitude /
        latStep
    );

  const lngIndex =
    Math.floor(
      longitude /
        lngStep
    );

  return `${latIndex}:${lngIndex}`;
}

// ============================================================
// PROVIDER CACHE KEY
// ============================================================
//
// Nearby 500m cells reuse the same provider-result cache.
//
// Example:
//
// 28.535
// 28.537
// 28.539
//
// may resolve to the same provider query region.
//
// ============================================================

function getProviderCacheKey(
  lat,
  lng
) {
  const latitude =
    Number(lat);

  const longitude =
    Number(lng);

  if (
    !Number.isFinite(
      latitude
    ) ||
    !Number.isFinite(
      longitude
    )
  ) {
    return null;
  }

  const latIndex =
    Math.floor(
      latitude /
        PROVIDER_CACHE_LAT_STEP
    );

  const lngIndex =
    Math.floor(
      longitude /
        PROVIDER_CACHE_LNG_STEP
    );

  return `provider:${latIndex}:${lngIndex}`;
}

// ============================================================
// PROVIDER CACHE CENTER
// ============================================================

function getProviderCacheCenter(
  lat,
  lng
) {
  const latitude =
    Number(lat);

  const longitude =
    Number(lng);

  const latIndex =
    Math.floor(
      latitude /
        PROVIDER_CACHE_LAT_STEP
    );

  const lngIndex =
    Math.floor(
      longitude /
        PROVIDER_CACHE_LNG_STEP
    );

  return {
    lat:
      (
        latIndex +
        0.5
      ) *
      PROVIDER_CACHE_LAT_STEP,

    lng:
      (
        lngIndex +
        0.5
      ) *
      PROVIDER_CACHE_LNG_STEP,
  };
}

// ============================================================
// REGION
// ============================================================

function getRegionId(
  lat,
  lng
) {
  return `dynamic:${Number(
    lat
  ).toFixed(
    2
  )}:${Number(
    lng
  ).toFixed(
    2
  )}`;
}

function updateRegionMetadata(
  lat,
  lng,
  providerResult,
  cellCountDelta = 0
) {
  const id =
    getRegionId(
      lat,
      lng
    );

  const existing =
    state.regions.get(
      id
    );

  state.regions.set(
    id,
    {
      id,

      centerLat:
        Number(lat),

      centerLng:
        Number(lng),

      radiusKm:
        STATION_RADIUS_METERS /
        1000,

      cellCount:
        (
          existing?.cellCount ||
          0
        ) +
        cellCountDelta,

      providerPointCount:
        Number(
          providerResult?.stationCount ||
            0
        ),

      isReady:
        true,

      lastUpdated:
        Date.now(),

      source:
        providerResult?.provider ||
        "unavailable",
    }
  );
}

// ============================================================
// FRESHNESS
// ============================================================

function normalizeFreshness(
  value
) {
  const freshness =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if (
    freshness ===
      "live" ||
    freshness ===
      "recent" ||
    freshness ===
      "stale" ||
    freshness ===
      "invalid"
  ) {
    return freshness;
  }

  return null;
}

function freshnessRank(
  value
) {
  switch (
    normalizeFreshness(
      value
    )
  ) {
    case "live":
      return 3;

    case "recent":
      return 2;

    case "stale":
      return 1;

    default:
      return 0;
  }
}

function getBestFreshness(
  values
) {
  return (
    values
      .map(
        normalizeFreshness
      )
      .filter(Boolean)
      .sort(
        (a, b) =>
          freshnessRank(
            b
          ) -
          freshnessRank(
            a
          )
      )[0] ||
    null
  );
}

// ============================================================
// CACHE USABILITY
// ============================================================

function isCellUsable(
  cell
) {
  if (!cell) {
    return false;
  }

  if (
    !Number.isFinite(
      Number(
        cell.aqi
      )
    )
  ) {
    return false;
  }

  if (
    cell.freshness ===
      "stale" ||
    cell.freshness ===
      "invalid"
  ) {
    return false;
  }

  if (
    cell.isUsable ===
    false
  ) {
    return false;
  }

  const updatedAt =
    Number(
      cell.updatedAt
    );

  if (
    !Number.isFinite(
      updatedAt
    )
  ) {
    return false;
  }

  if (
    Date.now() -
      updatedAt >
    CACHE_TTL_MS
  ) {
    return false;
  }

  return true;
}

// ============================================================
// PROVIDER RESULT USABILITY
// ============================================================

function isProviderResultUsable(
  entry
) {
  if (!entry) {
    return false;
  }

  if (
    !entry.providerResult
  ) {
    return false;
  }

  if (
    Date.now() -
      Number(
        entry.updatedAt
      ) >
    PROVIDER_CACHE_TTL_MS
  ) {
    return false;
  }

  const result =
    entry.providerResult;

  return Boolean(
    result.usable === true &&
      Array.isArray(
        result.stations
      ) &&
      result.stations.length >
        0
  );
}

// ============================================================
// GENERIC VALUE EXTRACTION
// ============================================================

function extractMeasurementValue(
  measurement
) {
  if (
    measurement === null ||
    measurement === undefined
  ) {
    return null;
  }

  if (
    typeof measurement ===
    "number"
  ) {
    return Number.isFinite(
      measurement
    )
      ? measurement
      : null;
  }

  if (
    typeof measurement ===
    "object"
  ) {
    const value =
      Number(
        measurement.value ??
          measurement.rawValue ??
          measurement.concentration
      );

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }

  return null;
}

function extractMeasurementUnit(
  measurement
) {
  if (
    !measurement ||
    typeof measurement !==
      "object"
  ) {
    return null;
  }

  return (
    measurement.unit ||
    measurement.units ||
    null
  );
}

// ============================================================
// OPENAQ POLLUTANTS
// ============================================================

function extractOpenAqPollutants(
  stationData
) {
  const source =
    stationData?.pollutants;

  if (
    !source ||
    typeof source !==
      "object"
  ) {
    return {
      pollutants: {},
      metadata: {},
    };
  }

  const pollutants =
    {};

  const metadata =
    {};

  const parameters = [
    "pm25",
    "pm10",
    "o3",
    "co",
    "so2",
    "no2",
  ];

  for (
    const parameter of
      parameters
  ) {
    const measurement =
      source[
        parameter
      ];

    const value =
      extractMeasurementValue(
        measurement
      );

    if (
      value === null
    ) {
      continue;
    }

    pollutants[
      parameter
    ] =
      value;

    metadata[
      parameter
    ] = {
      observedAt:
        measurement?.observedAt ||
        null,

      ageMinutes:
        Number.isFinite(
          Number(
            measurement?.ageMinutes
          )
        )
          ? Number(
              measurement.ageMinutes
            )
          : null,

      freshness:
        normalizeFreshness(
          measurement?.freshness
        ),

      isLive:
        measurement?.isLive ===
        true,

      isRecent:
        measurement?.isRecent ===
        true,

      unit:
        extractMeasurementUnit(
          measurement
        ),
    };
  }

  return {
    pollutants,

    metadata,
  };
}

// ============================================================
// STATION FRESHNESS
// ============================================================

function getStationFreshness(
  stationData,
  pollutantMetadata
) {
  return getBestFreshness([
    stationData?.freshness,

    stationData
      ?.resolverFreshness
      ?.freshness,

    ...Object.values(
      pollutantMetadata
    ).map(
      (item) =>
        item.freshness
    ),
  ]);
}

function getStationAgeMinutes(
  stationData,
  pollutantMetadata
) {
  const stationAge =
    Number(
      stationData?.ageMinutes
    );

  if (
    Number.isFinite(
      stationAge
    )
  ) {
    return stationAge;
  }

  const ages =
    Object.values(
      pollutantMetadata
    )
      .map(
        (item) =>
          Number(
            item.ageMinutes
          )
      )
      .filter(
        Number.isFinite
      );

  if (
    ages.length === 0
  ) {
    return null;
  }

  return Math.min(
    ...ages
  );
}

function getStationObservedAt(
  stationData,
  pollutantMetadata
) {
  if (
    stationData?.observedAt
  ) {
    return stationData.observedAt;
  }

  const entries =
    Object.values(
      pollutantMetadata
    )
      .filter(
        (item) =>
          item.observedAt
      )
      .sort(
        (a, b) => {
          const ageA =
            Number.isFinite(
              Number(
                a.ageMinutes
              )
            )
              ? Number(
                  a.ageMinutes
                )
              : Infinity;

          const ageB =
            Number.isFinite(
              Number(
                b.ageMinutes
              )
            )
              ? Number(
                  b.ageMinutes
                )
              : Infinity;

          return (
            ageA -
            ageB
          );
        }
      );

  return (
    entries[0]
      ?.observedAt ||
    null
  );
}

// ============================================================
// NORMALIZE PROVIDER STATIONS
// ============================================================

function normalizeStations(
  providerResult
) {
  const provider =
    String(
      providerResult?.provider ||
        ""
    )
      .trim()
      .toLowerCase();

  const stations =
    Array.isArray(
      providerResult?.stations
    )
      ? providerResult.stations
      : [];

  return stations
    .map(
      (
        stationData
      ) => {
        const station =
          stationData?.station ||
          stationData;

        const lat =
          Number(
            station
              ?.coordinates
              ?.lat ??
              station?.lat ??
              stationData?.lat
          );

        const lng =
          Number(
            station
              ?.coordinates
              ?.lng ??
              station?.lng ??
              stationData?.lng
          );

        if (
          !Number.isFinite(
            lat
          ) ||
          !Number.isFinite(
            lng
          )
        ) {
          return null;
        }

        const openAqData =
          extractOpenAqPollutants(
            stationData
          );

        let aqi =
          null;

        let standard =
          "US_EPA_ESTIMATE";

        let category =
          null;

        let dominantPollutant =
          stationData?.dominantPollutant ||
          null;

        let aqiConfidence =
          stationData?.confidence ||
          null;

        let subIndices =
          null;

        // ------------------------------------------------------
        // OPENAQ PRIMARY
        // ------------------------------------------------------

        if (
          provider ===
          "openaq"
        ) {
          const coUnit =
            openAqData
              .metadata
              ?.co
              ?.unit;

          const aqiResult =
            calculateUsEpaAqi(
              openAqData.pollutants,
              {
                coUnit:
                  coUnit ===
                  "mg/m3"
                    ? "mg/m3"
                    : undefined,
              }
            );

          if (
            !Number.isFinite(
              Number(
                aqiResult?.aqi
              )
            )
          ) {
            return null;
          }

          aqi =
            Number(
              aqiResult.aqi
            );

          standard =
            aqiResult.standard ||
            "US_EPA_ESTIMATE";

          category =
            aqiResult.category ||
            getAqiCategory(
              aqi
            );

          dominantPollutant =
            aqiResult.dominantPollutant ||
            dominantPollutant;

          aqiConfidence =
            aqiResult.confidence ||
            aqiConfidence;

          subIndices =
            aqiResult.subIndices ||
            null;
        }

        // ------------------------------------------------------
        // WAQI FALLBACK
        // ------------------------------------------------------

        if (
          provider ===
          "waqi"
        ) {
          const directAqi =
            Number(
              stationData?.aqi ??
                station?.aqi
            );

          if (
            !Number.isFinite(
              directAqi
            )
          ) {
            return null;
          }

          aqi =
            Math.min(
              Math.max(
                directAqi,
                0
              ),
              500
            );

          standard =
            "US_EPA";

          category =
            getAqiCategory(
              aqi
            );

          dominantPollutant =
            stationData?.dominantPollutant ||
            stationData?.dominantpol ||
            dominantPollutant;

          aqiConfidence =
            stationData?.confidence ||
            "provider";
        }

        if (
          !Number.isFinite(
            Number(aqi)
          )
        ) {
          return null;
        }

        const freshness =
          getStationFreshness(
            stationData,
            openAqData.metadata
          );

        const ageMinutes =
          getStationAgeMinutes(
            stationData,
            openAqData.metadata
          );

        const observedAt =
          getStationObservedAt(
            stationData,
            openAqData.metadata
          );

        const isLive =
          stationData?.isLive ===
            true ||
          stationData
            ?.resolverFreshness
            ?.isLive ===
            true ||
          Object.values(
            openAqData.metadata
          ).some(
            (item) =>
              item.isLive ===
              true
          ) ||
          freshness ===
            "live";

        const isRecent =
          stationData?.isRecent ===
            true ||
          stationData
            ?.resolverFreshness
            ?.isRecent ===
            true ||
          Object.values(
            openAqData.metadata
          ).some(
            (item) =>
              item.isRecent ===
              true
          ) ||
          freshness ===
            "live" ||
          freshness ===
            "recent";

        const isUsable =
          stationData?.isUsable !==
            false &&
          freshness !==
            "stale" &&
          freshness !==
            "invalid";

        return {
          stationId:
            stationData?.stationId ??
            stationData
              ?.station
              ?.id ??
            stationData
              ?.station
              ?.uid ??
            stationData?.id ??
            station?.id ??
            null,

          stationName:
            stationData
              ?.station
              ?.name ??
            stationData
              ?.station
              ?.stationName ??
            stationData?.name ??
            station?.name ??
            "Unknown station",

          lat,

          lng,

          aqi,

          category,

          dominantPollutant,

          provider,

          source:
            provider,

          standard,

          aqiConfidence,

          freshness,

          ageMinutes,

          observedAt,

          isLive,

          isRecent,

          isUsable,

          fallbackUsed:
            providerResult
              ?.fallbackUsed ===
            true,

          distanceMeters:
            Number.isFinite(
              Number(
                stationData
                  ?.station
                  ?.distanceMeters
              )
            )
              ? Number(
                  stationData
                    .station
                    .distanceMeters
                )
              : Number.isFinite(
                  Number(
                    stationData
                      ?.distanceMeters
                  )
                )
              ? Number(
                  stationData
                    .distanceMeters
                )
              : null,

          pollutantCount:
            Object.keys(
              openAqData
                .pollutants
            ).length,

          pollutants:
            openAqData
              .pollutants,

          subIndices,
        };
      }
    )
    .filter(Boolean)
    .filter(
      (station) =>
        station.isUsable &&
        Number.isFinite(
          Number(
            station.aqi
          )
        )
    );
}

// ============================================================
// BUILD NORMALIZED CELL
// ============================================================

function buildCell(
  coordinate,
  providerResult,
  interpolation,
  stations
) {
  if (
    !interpolation ||
    !Number.isFinite(
      Number(
        interpolation.aqi
      )
    )
  ) {
    return null;
  }

  const provider =
    String(
      providerResult?.provider ||
        "unknown"
    )
      .trim()
      .toLowerCase();

  const fallbackUsed =
    provider ===
      "waqi" ||
    providerResult
      ?.fallbackUsed ===
      true;

  const normalizedStations =
    Array.isArray(
      stations
    )
      ? stations
      : [];

  const freshness =
    getBestFreshness(
      normalizedStations.map(
        (station) =>
          station.freshness
      )
    );

  const category =
    interpolation.category ||
    getAqiCategory(
      interpolation.aqi
    );

  const observedTimes =
    normalizedStations
      .map(
        (station) =>
          station.observedAt
      )
      .filter(Boolean);

  const ages =
    normalizedStations
      .map(
        (station) =>
          station.ageMinutes
      )
      .filter(
        Number.isFinite
      );

  return {
    key:
      getCellKey(
        coordinate.lat,
        coordinate.lng
      ),

    lat:
      coordinate.lat,

    lng:
      coordinate.lng,

    aqi:
      Math.round(
        Number(
          interpolation.aqi
        )
      ),

    band:
      category?.label ||
      null,

    category,

    provider,

    source:
      provider,

    standard:
      provider ===
      "waqi"
        ? "US_EPA"
        : "US_EPA_ESTIMATE",

    fallbackUsed,

    freshness,

    isLive:
      freshness ===
      "live",

    isRecent:
      freshness ===
        "live" ||
      freshness ===
        "recent",

    isUsable:
      true,

    observedAt:
      observedTimes.length >
      0
        ? observedTimes[0]
        : null,

    ageMinutes:
      ages.length >
      0
        ? Math.min(
            ...ages
          )
        : null,

    confidence:
      interpolation.confidence ||
      "low",

    stationCount:
      interpolation.stationCount ||
      normalizedStations.length,

    nearestProviderDistanceMeters:
      interpolation
        .nearestStationDistanceMeters ??
      null,

    dominantPollutant:
      interpolation
        .dominantPollutant ||
      null,

    interpolation:
      Number(
        interpolation.stationCount
      ) > 1
        ? "idw"
        : "nearest-station",

    interpolationProviders:
      interpolation.stationCount ||
      normalizedStations.length,

    stations:
      interpolation.stations ||
      [],

    updatedAt:
      Date.now(),
  };
}

// ============================================================
// GET CACHED PROVIDER RESULT
// ============================================================

function getCachedProviderResult(
  key
) {
  const entry =
    state.providerResults.get(
      key
    );

  if (!entry) {
    state.providerCacheMisses +=
      1;

    return null;
  }

  if (
    !isProviderResultUsable(
      entry
    )
  ) {
    state.providerResults.delete(
      key
    );

    state.providerCacheExpired +=
      1;

    state.providerCacheMisses +=
      1;

    return null;
  }

  state.providerCacheHits +=
    1;

  return entry.providerResult;
}

// ============================================================
// RESOLVE PROVIDER RESULT WITH CACHE
// ============================================================
//
// This is the major performance optimization.
//
// A 500m cell does NOT directly call OpenAQ/WAQI.
//
// Instead:
//
//   cell
//     ↓
//   provider-region cache
//     ↓ hit
//   reuse stations
//
// ============================================================

async function resolveProviderResult(
  lat,
  lng
) {
  const center =
    getProviderCacheCenter(
      lat,
      lng
    );

  const key =
    getProviderCacheKey(
      lat,
      lng
    );

  if (!key) {
    return null;
  }

  // ==========================================================
  // PROVIDER CACHE HIT
  // ==========================================================

  const cached =
    getCachedProviderResult(
      key
    );

  if (cached) {
    return cached;
  }

  // ==========================================================
  // SAME PROVIDER QUERY ALREADY RUNNING
  // ==========================================================

  const existingPending =
    state.providerPending.get(
      key
    );

  if (
    existingPending
  ) {
    state.providerPendingWaits +=
      1;

    return existingPending;
  }

  // ==========================================================
  // NEW PROVIDER QUERY
  // ==========================================================

  state.providerRefreshes +=
    1;

  const promise =
    (async () => {
      const startedAt =
        Date.now();

      try {
        console.log(
          `[aqiCache] Provider cache MISS ${key} → querying resolver at ${center.lat},${center.lng}`
        );

        const providerResult =
          await resolveAQIProvider(
            center.lat,
            center.lng,
            STATION_RADIUS_METERS
          );

        if (
          !providerResult?.usable ||
          !Array.isArray(
            providerResult.stations
          ) ||
          providerResult
              .stations.length ===
            0
        ) {
          console.warn(
            `[aqiCache] Provider resolver returned no usable stations for ${key}`
          );

          return null;
        }

        // ------------------------------------------------------
        // Store provider result.
        // ------------------------------------------------------

        state.providerResults.set(
          key,
          {
            providerResult,

            updatedAt:
              Date.now(),
          }
        );

        console.log(
          `[aqiCache] Provider result cached ${key} → provider=${providerResult.provider} stations=${providerResult.stations.length} duration=${Date.now() - startedAt}ms`
        );

        return providerResult;
      } catch (error) {
        console.error(
          `[aqiCache] Provider resolver failed for ${key}: ${error.message}`
        );

        return null;
      }
    })();

  state.providerPending.set(
    key,
    promise
  );

  try {
    return await promise;
  } finally {
    if (
      state.providerPending.get(
        key
      ) === promise
    ) {
      state.providerPending.delete(
        key
      );
    }
  }
}

// ============================================================
// REFRESH ONE CELL
// ============================================================

async function refreshCell(
  lat,
  lng
) {
  const coordinate =
    validateCoordinates(
      lat,
      lng
    );

  const key =
    getCellKey(
      coordinate.lat,
      coordinate.lng
    );

  if (!key) {
    return null;
  }

  // ==========================================================
  // SAME CELL ALREADY REFRESHING
  // ==========================================================

  const existingPending =
    state.pending.get(
      key
    );

  if (
    existingPending
  ) {
    state.pendingWaits +=
      1;

    console.log(
      `[aqiCache] Waiting for existing refresh: ${key}`
    );

    return existingPending;
  }

  // ==========================================================
  // START CELL REFRESH
  // ==========================================================

  const promise =
    (async () => {
      state.refreshes +=
        1;

      const startedAt =
        Date.now();

      console.log(
        `[aqiCache] Refreshing cell ${key} at ${coordinate.lat},${coordinate.lng}`
      );

      try {
        // ------------------------------------------------------
        // PROVIDER RESULT
        // ------------------------------------------------------
        //
        // IMPORTANT:
        //
        // This no longer directly calls
        // resolveAQIProvider() for every cell.
        //
        // resolveProviderResult() handles provider caching.
        //
        // ------------------------------------------------------

        const providerResult =
          await resolveProviderResult(
            coordinate.lat,
            coordinate.lng
          );

        if (
          !providerResult?.usable ||
          !Array.isArray(
            providerResult.stations
          ) ||
          providerResult
              .stations.length ===
            0
        ) {
          state.lastRefreshSource =
            "unavailable";

          state.failedRefreshes +=
            1;

          return null;
        }

        // ------------------------------------------------------
        // NORMALIZE STATIONS ONCE
        // ------------------------------------------------------

        const stations =
          normalizeStations(
            providerResult
          );

        if (
          stations.length ===
          0
        ) {
          state.lastRefreshSource =
            "unavailable";

          state.failedRefreshes +=
            1;

          console.warn(
            `[aqiCache] Provider ${providerResult.provider} returned no usable AQI stations`
          );

          return null;
        }

        // ------------------------------------------------------
        // INTERPOLATION
        // ------------------------------------------------------

        const interpolation =
          interpolateAqi(
            coordinate,
            stations,
            {
              maxDistanceMeters:
                MAX_INTERPOLATION_DISTANCE_METERS,

              minStations:
                MIN_NEARBY_STATIONS,

              maxStations:
                MAX_NEARBY_STATIONS,

              excludeStale:
                true,
            }
          );

        if (
          !interpolation ||
          !Number.isFinite(
            Number(
              interpolation.aqi
            )
          )
        ) {
          state.lastRefreshSource =
            "unavailable";

          state.failedRefreshes +=
            1;

          console.warn(
            `[aqiCache] No usable interpolation for cell ${key}`
          );

          return null;
        }

        // ------------------------------------------------------
        // BUILD CELL
        // ------------------------------------------------------

        const cell =
          buildCell(
            coordinate,
            providerResult,
            interpolation,
            stations
          );

        if (!cell) {
          state.failedRefreshes +=
            1;

          return null;
        }

        const isNewCell =
          !state.cells.has(
            key
          );

        // ------------------------------------------------------
        // SAVE CELL
        // ------------------------------------------------------

        state.cells.set(
          key,
          cell
        );

        state.isReady =
          true;

        state.lastUpdated =
          Date.now();

        state.lastRefreshSource =
          providerResult.provider ||
          "unavailable";

        updateRegionMetadata(
          coordinate.lat,
          coordinate.lng,
          providerResult,
          isNewCell
            ? 1
            : 0
        );

        console.log(
          `[aqiCache] Cell ${key} → AQI=${cell.aqi} provider=${cell.provider} freshness=${cell.freshness} total=${Date.now() - startedAt}ms`
        );

        return cell;
      } catch (error) {
        state.failedRefreshes +=
          1;

        console.error(
          `[aqiCache] Refresh failed for ${key}: ${error.message}`
        );

        return null;
      }
    })();

  // Store BEFORE awaiting.
  state.pending.set(
    key,
    promise
  );

  try {
    return await promise;
  } finally {
    if (
      state.pending.get(
        key
      ) === promise
    ) {
      state.pending.delete(
        key
      );
    }
  }
}

// ============================================================
// PUBLIC LOOKUP
// ============================================================

async function lookup(
  lat,
  lng
) {
  const coordinate =
    validateCoordinates(
      lat,
      lng
    );

  const key =
    getCellKey(
      coordinate.lat,
      coordinate.lng
    );

  if (!key) {
    return null;
  }

  // ==========================================================
  // CELL CACHE HIT
  // ==========================================================

  const cached =
    state.cells.get(
      key
    );

  if (
    isCellUsable(
      cached
    )
  ) {
    state.hits +=
      1;

    return cached;
  }

  // ==========================================================
  // CELL CACHE MISS
  // ==========================================================

  state.misses +=
    1;

  return refreshCell(
    coordinate.lat,
    coordinate.lng
  );
}

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  state.cells.clear();

  state.pending.clear();

  state.providerResults.clear();

  state.providerPending.clear();

  state.regions.clear();

  state.isReady =
    false;

  state.lastUpdated =
    null;

  state.lastRefreshSource =
    null;

  state.hits =
    0;

  state.misses =
    0;

  state.pendingWaits =
    0;

  state.refreshes =
    0;

  state.failedRefreshes =
    0;

  state.providerCacheHits =
    0;

  state.providerCacheMisses =
    0;

  state.providerPendingWaits =
    0;

  state.providerRefreshes =
    0;

  state.providerCacheExpired =
    0;

  if (
    !cronStarted
  ) {
    const cronExpression =
      `*/${REFRESH_MINUTES} * * * *`;

    cron.schedule(
      cronExpression,
      async () => {
        try {
          await refreshGrid();
        } catch (error) {
          console.error(
            `[aqiCache] Scheduled refresh failed: ${error.message}`
          );
        }
      }
    );

    cronStarted =
      true;
  }

  console.log(
    `[aqiCache] Performance cache ready | cell=${CELL_SIZE_METERS}m | cellTTL=${CACHE_TTL_MINUTES}m | providerTTL=${PROVIDER_CACHE_MINUTES}m | providerBucket=${PROVIDER_CACHE_LAT_STEP}°x${PROVIDER_CACHE_LNG_STEP}° | radius=${STATION_RADIUS_METERS}m`
  );

  return true;
}

// ============================================================
// REFRESH EXISTING CELLS
// ============================================================

async function refreshGrid() {
  const cells =
    Array.from(
      state.cells.values()
    );

  if (
    cells.length ===
    0
  ) {
    return {
      refreshed:
        0,

      source:
        null,
    };
  }

  let refreshed =
    0;

  for (
    const cell of
      cells
  ) {
    try {
      const result =
        await refreshCell(
          cell.lat,
          cell.lng
        );

      if (
        result
      ) {
        refreshed +=
          1;
      }
    } catch (error) {
      console.warn(
        `[aqiCache] Cell refresh failed: ${error.message}`
      );
    }
  }

  return {
    refreshed,

    source:
      state.lastRefreshSource,
  };
}

// ============================================================
// CACHE STATISTICS
// ============================================================

function getCacheStats() {
  const totalLookups =
    state.hits +
    state.misses;

  const hitRate =
    totalLookups >
    0
      ? Number(
          (
            (
              state.hits /
              totalLookups
            ) *
            100
          ).toFixed(
            2
          )
        )
      : 0;

  return {
    // --------------------------------------------------------
    // CELL CACHE
    // --------------------------------------------------------

    cells:
      state.cells.size,

    pending:
      state.pending.size,

    hits:
      state.hits,

    misses:
      state.misses,

    pendingWaits:
      state.pendingWaits,

    refreshes:
      state.refreshes,

    failedRefreshes:
      state.failedRefreshes,

    totalLookups,

    hitRate,

    // --------------------------------------------------------
    // PROVIDER CACHE
    // --------------------------------------------------------

    providerCacheEntries:
      state.providerResults.size,

    providerPending:
      state.providerPending.size,

    providerCacheHits:
      state.providerCacheHits,

    providerCacheMisses:
      state.providerCacheMisses,

    providerPendingWaits:
      state.providerPendingWaits,

    providerRefreshes:
      state.providerRefreshes,

    providerCacheExpired:
      state.providerCacheExpired,

    providerCacheHitRate:
      (
        state.providerCacheHits +
        state.providerCacheMisses
      ) > 0
        ? Number(
            (
              (
                state.providerCacheHits /
                (
                  state.providerCacheHits +
                  state.providerCacheMisses
                )
              ) *
              100
            ).toFixed(
              2
            )
          )
        : 0,

    // --------------------------------------------------------
    // CONFIG
    // --------------------------------------------------------

    ttlMinutes:
      CACHE_TTL_MINUTES,

    providerCacheMinutes:
      PROVIDER_CACHE_MINUTES,

    providerCacheLatStep:
      PROVIDER_CACHE_LAT_STEP,

    providerCacheLngStep:
      PROVIDER_CACHE_LNG_STEP,

    cellSizeMeters:
      CELL_SIZE_METERS,

    stationRadiusMeters:
      STATION_RADIUS_METERS,
  };
}

// ============================================================
// DIAGNOSTICS
// ============================================================

function getGrid() {
  return Array.from(
    state.cells.values()
  ).map(
    (cell) => ({
      lat:
        cell.lat,

      lng:
        cell.lng,

      aqi:
        cell.aqi,

      band:
        cell.band,

      category:
        cell.category,

      provider:
        cell.provider,

      source:
        cell.source,

      standard:
        cell.standard,

      freshness:
        cell.freshness,

      confidence:
        cell.confidence,

      fallbackUsed:
        cell.fallbackUsed,
    })
  );
}

function getCellCount() {
  return state.cells.size;
}

function isReady() {
  return state.isReady;
}

function getLastUpdated() {
  return state.lastUpdated;
}

function getCellSize() {
  return CELL_SIZE_METERS;
}

function getLastRefreshSource() {
  return state.lastRefreshSource;
}

function getProviderPointCount() {
  let count =
    0;

  for (
    const cell of
      state.cells.values()
  ) {
    count +=
      Number(
        cell.stationCount ||
          0
      );
  }

  return count;
}

function getRegionCount() {
  return state.regions.size;
}

function getRegions() {
  return Array.from(
    state.regions.values()
  );
}

function getRegionForCoordinate(
  lat,
  lng
) {
  const coordinate =
    validateCoordinates(
      lat,
      lng
    );

  const id =
    getRegionId(
      coordinate.lat,
      coordinate.lng
    );

  return (
    state.regions.get(
      id
    ) ||
    null
  );
}

// ============================================================
// CLEAR CACHE
// ============================================================

function clear() {
  state.cells.clear();

  state.pending.clear();

  state.providerResults.clear();

  state.providerPending.clear();

  state.regions.clear();

  state.isReady =
    false;

  state.lastUpdated =
    null;

  state.lastRefreshSource =
    null;

  state.hits =
    0;

  state.misses =
    0;

  state.pendingWaits =
    0;

  state.refreshes =
    0;

  state.failedRefreshes =
    0;

  state.providerCacheHits =
    0;

  state.providerCacheMisses =
    0;

  state.providerPendingWaits =
    0;

  state.providerRefreshes =
    0;

  state.providerCacheExpired =
    0;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  init,

  refreshGrid,

  lookup,

  getCellKey,

  getGrid,

  getCellCount,

  isReady,

  getLastUpdated,

  getCellSize,

  getLastRefreshSource,

  getProviderPointCount,

  getRegionCount,

  getRegions,

  getRegionForCoordinate,

  getCacheStats,

  clear,
};