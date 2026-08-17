"use strict";

// ============================================================
// AIRROUTE - ROUTE AQI ENGINE
// ============================================================
//
// Purpose:
//   Sample routes and attach AQI data from aqiCache.
//
// PERFORMANCE ARCHITECTURE
// ------------------------------------------------------------
//
// OLD:
//
//   Route 1
//      ↓
//   unique cells
//      ↓
//   AQI lookups
//
//   Route 2
//      ↓
//   unique cells
//      ↓
//   AQI lookups AGAIN
//
//   Route 3
//      ↓
//   unique cells
//      ↓
//   AQI lookups AGAIN
//
// PROBLEM:
//   The same 500m AQI cells can be requested multiple times
//   across different routes.
//
// NEW:
//
//   Route 1 ─┐
//   Route 2 ─┼──→ GLOBAL UNIQUE AQI CELLS
//   Route 3 ─┘             ↓
//                      AQI lookups
//                           ↓
//                  Shared cell results
//                           ↓
//                  Map back to routes
//
// This prevents duplicate AQI provider/cache lookups across
// multiple routes.
//
// Architecture:
//
//   Routes
//      ↓
//   Route sampling
//      ↓
//   Global unique AQI cells
//      ↓
//   Controlled concurrent cache lookups
//      ↓
//   OpenAQ PRIMARY
//      ↓
//   WAQI FALLBACK
//      ↓
//   Shared cell results
//      ↓
//   Spatial mapping
//      ↓
//   Route AQI summaries
//
// IMPORTANT
// ------------------------------------------------------------
// OpenAQ = PRIMARY
// WAQI   = FALLBACK
//
// AQI unavailable is NEVER converted to AQI 0.
//
// ============================================================

const aqiCache =
  require("../../services/aqiCache");

const {
  sampleRouteWithMetadata,
} = require("./routeSampling");

// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_SAMPLE_DISTANCE_METERS =
  Number(
    process.env.AQI_ROUTE_SAMPLE_METERS ||
      400
  );

// Minimum live AQI coverage required for usable AQI confidence.
const MIN_USABLE_COVERAGE_PERCENT =
  Number(
    process.env
      .AQI_MIN_USABLE_COVERAGE_PERCENT ||
      50
  );

// Coverage confidence thresholds.
const HIGH_COVERAGE_PERCENT = 90;
const GOOD_COVERAGE_PERCENT = 75;
const MODERATE_COVERAGE_PERCENT = 50;

// ============================================================
// PERFORMANCE
// ============================================================
//
// IMPORTANT:
//
// Keep this controlled.
//
// OpenAQ has rate limits. Unlimited Promise.all()
// can cause:
//
//   OpenAQ → 429
//   OpenAQ → 429
//   OpenAQ → 429
//
// Default is intentionally conservative.
//
// You can override:
//
//   AQI_LOOKUP_CONCURRENCY=2
//
// ============================================================

const AQI_LOOKUP_CONCURRENCY =
  Math.max(
    1,
    Math.min(
      Number(
        process.env.AQI_LOOKUP_CONCURRENCY ||
          2
      ),
      6
    )
  );

// ============================================================
// LIVE AQI PROVIDERS
// ============================================================

const LIVE_AQI_PROVIDERS =
  new Set([
    "openaq",
    "waqi",
  ]);

// ============================================================
// SOURCE VALIDATION
// ============================================================

function getSampleProvider(
  sample
) {
  const provider =
    String(
      sample?.provider ||
        sample?.source ||
        ""
    )
      .trim()
      .toLowerCase();

  if (
    provider.includes("waqi")
  ) {
    return "waqi";
  }

  if (
    provider.includes("openaq")
  ) {
    return "openaq";
  }

  return null;
}

function isUsableAqiSource(
  sample
) {
  const provider =
    getSampleProvider(
      sample
    );

  return (
    LIVE_AQI_PROVIDERS.has(
      provider
    ) &&
    sample?.aqiAvailable === true &&
    Number.isFinite(
      Number(sample?.aqi)
    ) &&
    sample?.isUsable !== false &&
    sample?.freshness !==
      "stale" &&
    sample?.freshness !==
      "invalid"
  );
}

// ============================================================
// FALLBACK SOURCE DETECTION
// ============================================================

function isFallbackAqiSample(
  sample
) {
  return (
    sample?.fallbackUsed ===
      true ||
    (
      sample?.provider ===
        "waqi" &&
      sample?.fallbackUsed ===
        true
    )
  );
}

// ============================================================
// NUMBER HELPERS
// ============================================================

function toFiniteNumber(
  value
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

// ============================================================
// COVERAGE CONFIDENCE
// ============================================================

function getCoverageConfidence(
  coveragePercent
) {
  const coverage =
    Number(
      coveragePercent
    );

  if (
    !Number.isFinite(
      coverage
    )
  ) {
    return {
      level: "LOW",
      usable: false,
      description:
        "AQI coverage is unavailable.",
    };
  }

  if (
    coverage >=
    HIGH_COVERAGE_PERCENT
  ) {
    return {
      level: "HIGH",
      usable: true,
      description:
        "AQI coverage is high and route AQI evaluation is reliable.",
    };
  }

  if (
    coverage >=
    GOOD_COVERAGE_PERCENT
  ) {
    return {
      level: "GOOD",
      usable: true,
      description:
        "AQI coverage is good and route AQI evaluation is usable.",
    };
  }

  if (
    coverage >=
    MODERATE_COVERAGE_PERCENT
  ) {
    return {
      level: "MODERATE",
      usable: true,
      description:
        "AQI coverage is moderate; route AQI evaluation has some uncertainty.",
    };
  }

  return {
    level: "LOW",
    usable: false,
    description:
      "AQI coverage is too low for a high-confidence route AQI evaluation.",
  };
}

// ============================================================
// ROUTE VALIDATION
// ============================================================

function validateRoute(
  route
) {
  if (!route) {
    throw new Error(
      "Route is required."
    );
  }

  if (!route.geometry) {
    throw new Error(
      "Route geometry is missing."
    );
  }

  if (
    route.geometry.type &&
    route.geometry.type !==
      "LineString"
  ) {
    throw new Error(
      "Route geometry must be a LineString."
    );
  }

  if (
    !Array.isArray(
      route.geometry
        .coordinates
    ) ||
    route.geometry
      .coordinates.length < 2
  ) {
    throw new Error(
      "Route geometry must contain at least 2 coordinates."
    );
  }

  return true;
}

// ============================================================
// CACHE VALIDATION
// ============================================================

function validateAqiCache() {
  if (!aqiCache) {
    throw new Error(
      "AQI cache module is unavailable."
    );
  }

  if (
    typeof aqiCache.lookup !==
    "function"
  ) {
    throw new Error(
      "aqiCache.lookup() is unavailable."
    );
  }

  if (
    typeof aqiCache.getCellKey !==
    "function"
  ) {
    throw new Error(
      "aqiCache.getCellKey() is unavailable."
    );
  }
}

// ============================================================
// SAMPLE COORDINATE NORMALIZATION
// ============================================================

function getCoordinateFromSample(
  sample
) {
  if (!sample) {
    return null;
  }

  // ----------------------------------------------------------
  // [lng, lat]
  // ----------------------------------------------------------

  if (
    Array.isArray(
      sample.coordinate
    ) &&
    sample.coordinate.length >=
      2
  ) {
    const lng =
      Number(
        sample.coordinate[0]
      );

    const lat =
      Number(
        sample.coordinate[1]
      );

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      return {
        lat,
        lng,
      };
    }
  }

  // ----------------------------------------------------------
  // [lng, lat]
  // ----------------------------------------------------------

  if (
    Array.isArray(
      sample.coordinates
    ) &&
    sample.coordinates.length >=
      2
  ) {
    const lng =
      Number(
        sample.coordinates[0]
      );

    const lat =
      Number(
        sample.coordinates[1]
      );

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      return {
        lat,
        lng,
      };
    }
  }

  // ----------------------------------------------------------
  // { lat, lng }
  // ----------------------------------------------------------

  const lat =
    toFiniteNumber(
      sample.lat
    );

  const lng =
    toFiniteNumber(
      sample.lng
    );

  if (
    lat !== null &&
    lng !== null
  ) {
    return {
      lat,
      lng,
    };
  }

  // ----------------------------------------------------------
  // { latitude, longitude }
  // ----------------------------------------------------------

  const latitude =
    toFiniteNumber(
      sample.latitude
    );

  const longitude =
    toFiniteNumber(
      sample.longitude
    );

  if (
    latitude !== null &&
    longitude !== null
  ) {
    return {
      lat: latitude,
      lng: longitude,
    };
  }

  return null;
}

// ============================================================
// AQI VALUE NORMALIZATION
// ============================================================

function getAqiFromCell(
  cell
) {
  if (!cell) {
    return null;
  }

  const aqi =
    Number(
      cell.aqi
    );

  if (
    !Number.isFinite(aqi)
  ) {
    return null;
  }

  return aqi;
}

// ============================================================
// BUILD AQI SUMMARY
// ============================================================

function summarizeAqiSamples(
  samples
) {
  const liveSamples =
    samples.filter(
      (sample) =>
        isUsableAqiSource(
          sample
        ) &&
        Number.isFinite(
          Number(
            sample?.aqi
          )
        )
    );

  // ----------------------------------------------------------
  // No live AQI
  // ----------------------------------------------------------

  if (
    liveSamples.length === 0
  ) {
    const coverageConfidence =
      getCoverageConfidence(
        0
      );

    return {
      averageAqi: null,

      peakAqi: null,

      minimumAqi: null,

      maximumAqi: null,

      validSamples: 0,

      totalSamples:
        samples.length,

      coveragePercent: 0,

      coverageConfidence:
        coverageConfidence.level,

      coverageUsable:
        coverageConfidence.usable,

      coverageDescription:
        coverageConfidence.description,

      minimumUsableCoveragePercent:
        MIN_USABLE_COVERAGE_PERCENT,

      band: "Unknown",

      category: "Unknown",

      source:
        "unavailable",
    };
  }

  const values =
    liveSamples.map(
      (sample) =>
        Number(
          sample.aqi
        )
    );

  const sum =
    values.reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    );

  const averageAqi =
    sum /
    values.length;

  const peakAqi =
    Math.max(
      ...values
    );

  const minimumAqi =
    Math.min(
      ...values
    );

  const maximumAqi =
    Math.max(
      ...values
    );

  const coveragePercent =
    samples.length > 0
      ? (
          liveSamples.length /
          samples.length
        ) *
        100
      : 0;

  const roundedCoveragePercent =
    Math.round(
      coveragePercent *
        10
    ) / 10;

  const coverageConfidence =
    getCoverageConfidence(
      roundedCoveragePercent
    );

  const peakSample =
    liveSamples.reduce(
      (
        highest,
        current
      ) => {
        if (!highest) {
          return current;
        }

        return Number(
          current.aqi
        ) >
          Number(
            highest.aqi
          )
          ? current
          : highest;
      },
      null
    );

  const providers =
    new Set(
      liveSamples
        .map(
          (sample) =>
            getSampleProvider(
              sample
            )
        )
        .filter(Boolean)
    );

  let source =
    "unavailable";

  if (
    providers.size === 1
  ) {
    source =
      Array.from(
        providers
      )[0];
  } else if (
    providers.size > 1
  ) {
    source = "mixed";
  }

  return {
    averageAqi:
      Math.round(
        averageAqi *
          10
      ) / 10,

    peakAqi:
      Math.round(
        peakAqi
      ),

    minimumAqi:
      Math.round(
        minimumAqi
      ),

    maximumAqi:
      Math.round(
        maximumAqi
      ),

    validSamples:
      liveSamples.length,

    totalSamples:
      samples.length,

    coveragePercent:
      roundedCoveragePercent,

    coverageConfidence:
      coverageConfidence.level,

    coverageUsable:
      coverageConfidence.usable,

    coverageDescription:
      coverageConfidence.description,

    minimumUsableCoveragePercent:
      MIN_USABLE_COVERAGE_PERCENT,

    band:
      peakSample?.band ||
      "Unknown",

    category:
      peakSample?.category ||
      "Unknown",

    source,
  };
}

// ============================================================
// ROUTE SOURCE SUMMARY
// ============================================================

function getRouteSourceSummary(
  samples
) {
  const liveSamples =
    samples.filter(
      (sample) =>
        isUsableAqiSource(
          sample
        )
    );

  const fallbackSamples =
    samples.filter(
      (sample) =>
        isFallbackAqiSample(
          sample
        )
    );

  const unavailableSamples =
    samples.filter(
      (sample) =>
        !isUsableAqiSource(
          sample
        )
    );

  const providers =
    new Set(
      liveSamples
        .map(
          (sample) =>
            getSampleProvider(
              sample
            )
        )
        .filter(Boolean)
    );

  let source =
    "unavailable";

  if (
    providers.size === 1
  ) {
    source =
      Array.from(
        providers
      )[0];
  } else if (
    providers.size > 1
  ) {
    source = "mixed";
  }

  return {
    source,

    liveSamples:
      liveSamples.length,

    fallbackSamples:
      fallbackSamples.length,

    unavailableSamples:
      unavailableSamples.length,
  };
}

// ============================================================
// BUILD UNAVAILABLE SAMPLE
// ============================================================

function buildUnavailableSample(
  sample,
  index,
  coordinate,
  reason,
  extra = {}
) {
  return {
    ...sample,

    sampleIndex:
      index,

    lat:
      coordinate?.lat ??
      null,

    lng:
      coordinate?.lng ??
      null,

    aqi: null,

    aqiAvailable:
      false,

    source:
      extra.source ||
      "unavailable",

    ...extra,

    lookupError:
      reason,
  };
}

// ============================================================
// RESOLVE ROUTE CELLS
// ============================================================

function resolveRouteCells(
  routeSamples
) {
  const resolvedSamples =
    [];

  const uniqueCells =
    new Map();

  for (
    let index = 0;
    index <
      routeSamples.length;
    index++
  ) {
    const sample =
      routeSamples[index];

    const coordinate =
      getCoordinateFromSample(
        sample
      );

    if (!coordinate) {
      resolvedSamples.push({
        sample,

        sampleIndex:
          index,

        coordinate:
          null,

        cellKey:
          null,

        validCoordinate:
          false,

        error:
          "Invalid route sample coordinate.",
      });

      continue;
    }

    let cellKey =
      null;

    try {
      cellKey =
        aqiCache.getCellKey(
          coordinate.lat,
          coordinate.lng
        );
    } catch (error) {
      resolvedSamples.push({
        sample,

        sampleIndex:
          index,

        coordinate,

        cellKey:
          null,

        validCoordinate:
          true,

        error:
          error.message,
      });

      continue;
    }

    if (!cellKey) {
      resolvedSamples.push({
        sample,

        sampleIndex:
          index,

        coordinate,

        cellKey:
          null,

        validCoordinate:
          true,

        error:
          "No AQI grid cell found.",
      });

      continue;
    }

    resolvedSamples.push({
      sample,

      sampleIndex:
        index,

      coordinate,

      cellKey,

      validCoordinate:
        true,

      error:
        null,
    });

    if (
      !uniqueCells.has(
        cellKey
      )
    ) {
      uniqueCells.set(
        cellKey,
        {
          lat:
            coordinate.lat,

          lng:
            coordinate.lng,
        }
      );
    }
  }

  return {
    resolvedSamples,

    uniqueCells,
  };
}

// ============================================================
// LOOKUP UNIQUE CELLS
// ============================================================
//
// This is the critical performance layer.
//
// The function receives UNIQUE cells only.
//
// It never intentionally looks up the same cell twice.
//
// ============================================================

async function lookupUniqueCells(
  uniqueCells
) {
  const cellResults =
    new Map();

  let lookupCount = 0;

  let lookupFailures = 0;

  const entries =
    Array.from(
      uniqueCells.entries()
    );

  if (
    entries.length === 0
  ) {
    return {
      cellResults,

      lookupCount,

      lookupFailures,

      durationMs: 0,

      workerCount: 0,
    };
  }

  const startedAt =
    Date.now();

  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex =
        nextIndex++;

      if (
        currentIndex >=
        entries.length
      ) {
        return;
      }

      const [
        cellKey,
        representative,
      ] =
        entries[
          currentIndex
        ];

      lookupCount++;

      try {
        const cell =
          await aqiCache.lookup(
            representative.lat,
            representative.lng
          );

        cellResults.set(
          cellKey,
          {
            cell,

            error:
              null,
          }
        );
      } catch (error) {
        lookupFailures++;

        cellResults.set(
          cellKey,
          {
            cell: null,

            error:
              error.message,
          }
        );

        console.error(
          `[routeAqiEngine] AQI lookup failed for cell ${cellKey}: ${error.message}`
        );
      }
    }
  }

  const workerCount =
    Math.min(
      AQI_LOOKUP_CONCURRENCY,
      entries.length
    );

  const workers =
    Array.from(
      {
        length:
          workerCount,
      },
      () =>
        worker()
    );

  await Promise.all(
    workers
  );

  const durationMs =
    Date.now() -
    startedAt;

  console.log(
    `[routeAqiEngine] Global AQI lookup: ${lookupCount} unique cells | concurrency=${workerCount} | duration=${durationMs}ms`
  );

  return {
    cellResults,

    lookupCount,

    lookupFailures,

    durationMs,

    workerCount,
  };
}

// ============================================================
// BUILD AQI SAMPLE FROM CELL
// ============================================================

function buildAqiSampleFromCell(
  sampleInfo,
  cellResult
) {
  const {
    sample,
    sampleIndex,
    coordinate,
    cellKey,
    error: sampleError,
  } = sampleInfo;

  const lat =
    coordinate?.lat ??
    null;

  const lng =
    coordinate?.lng ??
    null;

  if (!coordinate) {
    return buildUnavailableSample(
      sample,
      sampleIndex,
      null,
      sampleError ||
        "Invalid route sample coordinate."
    );
  }

  if (!cellKey) {
    return buildUnavailableSample(
      sample,
      sampleIndex,
      coordinate,
      sampleError ||
        "No AQI grid cell found."
    );
  }

  if (!cellResult) {
    return buildUnavailableSample(
      sample,
      sampleIndex,
      coordinate,
      "AQI cell lookup result is missing."
    );
  }

  if (
    cellResult.error
  ) {
    return buildUnavailableSample(
      sample,
      sampleIndex,
      coordinate,
      cellResult.error
    );
  }

  const cell =
    cellResult.cell;

  if (!cell) {
    return buildUnavailableSample(
      sample,
      sampleIndex,
      coordinate,
      "No AQI grid cell found."
    );
  }

  const cellSource =
    String(
      cell.source ||
        "unavailable"
    )
      .trim()
      .toLowerCase();

  const cellProvider =
    String(
      cell.provider ||
        cellSource ||
        ""
    )
      .trim()
      .toLowerCase();

  const aqi =
    getAqiFromCell(
      cell
    );

  if (
    aqi === null
  ) {
    return buildUnavailableSample(
      sample,
      sampleIndex,
      coordinate,
      "AQI grid cell does not contain a valid AQI.",
      {
        source:
          cellSource,

        band:
          cell.band ||
          null,

        category:
          cell.category ||
          null,

        cellLat:
          cell.lat ??
          null,

        cellLng:
          cell.lng ??
          null,
      }
    );
  }

  if (
    !LIVE_AQI_PROVIDERS.has(
      cellProvider
    )
  ) {
    return buildUnavailableSample(
      sample,
      sampleIndex,
      coordinate,
      "AQI provider is not supported for route scoring.",
      {
        source:
          cellSource,

        band:
          cell.band ||
          null,

        category:
          cell.category ||
          null,

        cellLat:
          cell.lat ??
          null,

        cellLng:
          cell.lng ??
          null,
      }
    );
  }

  return {
    ...sample,

    sampleIndex,

    lat,

    lng,

    aqi,

    aqiAvailable:
      true,

    source:
      cellSource,

    provider:
      cellProvider,

    standard:
      cell.standard ||
      (
        cellProvider ===
        "waqi"
          ? "US_EPA"
          : "US_EPA_ESTIMATE"
      ),

    fallbackUsed:
      cell.fallbackUsed ===
      true,

    freshness:
      cell.freshness ||
      null,

    isLive:
      cell.isLive ===
      true,

    isRecent:
      cell.isRecent ===
      true,

    isUsable:
      cell.isUsable !==
      false,

    ageMinutes:
      cell.ageMinutes ??
      null,

    observedAt:
      cell.observedAt ??
      null,

    band:
      cell.band ||
      null,

    category:
      cell.category ||
      null,

    cellLat:
      cell.lat ??
      null,

    cellLng:
      cell.lng ??
      null,

    providerLat:
      cell.providerLat ??
      null,

    providerLng:
      cell.providerLng ??
      null,

    interpolation:
      cell.interpolation ??
      null,

    interpolationProviders:
      cell.interpolationProviders ??
      null,

    nearestProviderDistanceMeters:
      cell.nearestProviderDistanceMeters ??
      null,

    timestamp:
      cell.timestamp ??
      null,

    updatedAt:
      cell.updatedAt ??
      null,

    aqiCellKey:
      cellKey,
  };
}

// ============================================================
// BUILD ROUTE RESULT
// ============================================================
//
// Shared helper used by both:
//   processRouteAqi()
//   processRoutesAqi()
//
// ============================================================

function buildRouteResultFromSamples(
  route,
  routeSamples,
  resolvedSamples,
  cellResults,
  metadata = {}
) {
  const startedAt =
    Date.now();

  const aqiSamples =
    resolvedSamples.map(
      (sampleInfo) => {
        const cellResult =
          sampleInfo.cellKey
            ? cellResults.get(
                sampleInfo.cellKey
              )
            : null;

        return buildAqiSampleFromCell(
          sampleInfo,
          cellResult
        );
      }
    );

  const mappingDurationMs =
    Date.now() -
    startedAt;

  const summary =
    summarizeAqiSamples(
      aqiSamples
    );

  const routeSource =
    getRouteSourceSummary(
      aqiSamples
    );

  const cacheMetadata = {
    ready:
      typeof aqiCache.isReady ===
      "function"
        ? aqiCache.isReady()
        : false,

    cellCount:
      typeof aqiCache.getCellCount ===
      "function"
        ? aqiCache.getCellCount()
        : 0,

    cellSizeMeters:
      typeof aqiCache.getCellSize ===
      "function"
        ? aqiCache.getCellSize()
        : null,

    providerPointCount:
      typeof aqiCache.getProviderPointCount ===
      "function"
        ? aqiCache.getProviderPointCount()
        : 0,

    lastUpdated:
      typeof aqiCache.getLastUpdated ===
      "function"
        ? aqiCache.getLastUpdated()
        : null,

    refreshSource:
      typeof aqiCache.getLastRefreshSource ===
      "function"
        ? aqiCache.getLastRefreshSource()
        : null,

    routeSource:
      routeSource.source,

    liveSamples:
      routeSource.liveSamples,

    fallbackSamples:
      routeSource.fallbackSamples,

    unavailableSamples:
      routeSource.unavailableSamples,

    coveragePercent:
      summary.coveragePercent,

    coverageConfidence:
      summary.coverageConfidence,

    coverageUsable:
      summary.coverageUsable,

    minimumUsableCoveragePercent:
      summary.minimumUsableCoveragePercent,

    routeSampleCount:
      routeSamples.length,

    uniqueCellCount:
      metadata.uniqueCellCount ??
      0,

    // IMPORTANT:
    // For multi-route processing this is the GLOBAL
    // lookup count, not route-local count.
    aqiLookupCount:
      metadata.lookupCount ??
      0,

    lookupFailures:
      metadata.lookupFailures ??
      0,

    lookupReduction:
      Math.max(
        0,
        routeSamples.length -
          (
            metadata.routeLocalUniqueCellCount ??
            0
          )
      ),

    lookupReductionPercent:
      routeSamples.length >
        0 &&
      Number.isFinite(
        metadata.routeLocalUniqueCellCount
      )
        ? Math.round(
            (
              (
                routeSamples.length -
                metadata.routeLocalUniqueCellCount
              ) /
              routeSamples.length
            ) *
              1000
          ) / 10
        : 0,

    // Global metrics.
    globalUniqueCellCount:
      metadata.globalUniqueCellCount ??
      metadata.uniqueCellCount ??
      0,

    globalLookupCount:
      metadata.globalLookupCount ??
      metadata.lookupCount ??
      0,

    globalDuplicateCellsAvoided:
      metadata.globalDuplicateCellsAvoided ??
      0,

    lookupConcurrency:
      AQI_LOOKUP_CONCURRENCY,

    lookupDurationMs:
      metadata.lookupDurationMs ??
      0,

    samplingDurationMs:
      metadata.samplingDurationMs ??
      0,

    cellResolutionDurationMs:
      metadata.cellResolutionDurationMs ??
      0,

    mappingDurationMs,
  };

  const distanceMeters =
    Number(
      metadata.distanceMeters
    ) || 0;

  const routeId =
    route.routeId ??
    route.id ??
    "unknown";

  return {
    routeId,

    routeIndex:
      route.routeIndex ??
      null,

    geometry:
      route.geometry,

    distanceMeters,

    distanceKm:
      distanceMeters / 1000,

    sampleDistanceMeters:
      metadata.sampleDistanceMeters ??
      DEFAULT_SAMPLE_DISTANCE_METERS,

    sampleCount:
      routeSamples.length,

    aqiSamples,

    aqiSummary:
      summary,

    stationCount:
      0,

    provider:
      routeSource.source ===
      "waqi"
        ? "waqi"
        : routeSource.source ===
          "openaq"
        ? "openaq"
        : routeSource.source ===
          "mixed"
        ? "mixed"
        : null,

    standard:
      routeSource.source ===
      "waqi"
        ? "US_EPA"
        : "US_EPA_ESTIMATE",

    aqiSource:
      routeSource.source,

    coverage: {
      percent:
        summary.coveragePercent,

      confidence:
        summary.coverageConfidence,

      usable:
        summary.coverageUsable,

      minimumRequired:
        summary.minimumUsableCoveragePercent,

      description:
        summary.coverageDescription,
    },

    cache:
      cacheMetadata,

    generatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// PROCESS ONE ROUTE
// ============================================================

async function processRouteAqi(
  route,
  options = {}
) {
  const startedAt =
    Date.now();

  validateRoute(
    route
  );

  validateAqiCache();

  const sampleDistanceMeters =
    Number(
      options.sampleDistanceMeters ||
        DEFAULT_SAMPLE_DISTANCE_METERS
    );

  if (
    !Number.isFinite(
      sampleDistanceMeters
    ) ||
    sampleDistanceMeters <= 0
  ) {
    throw new Error(
      "sampleDistanceMeters must be greater than 0."
    );
  }

  // ==========================================================
  // CACHE READY CHECK
  // ==========================================================

  if (
    typeof aqiCache.isReady ===
      "function" &&
    !aqiCache.isReady() &&
    typeof aqiCache.init ===
      "function"
  ) {
    await aqiCache.init();
  }

  // ==========================================================
  // ROUTE SAMPLING
  // ==========================================================

  const samplingStartedAt =
    Date.now();

  const sampled =
    sampleRouteWithMetadata(
      route.geometry,
      {
        sampleDistanceMeters,
      }
    );

  const samplingDurationMs =
    Date.now() -
    samplingStartedAt;

  const routeSamples =
    Array.isArray(
      sampled?.samples
    )
      ? sampled.samples
      : [];

  // ==========================================================
  // RESOLVE UNIQUE CELLS
  // ==========================================================

  const cellResolutionStartedAt =
    Date.now();

  const {
    resolvedSamples,
    uniqueCells,
  } =
    resolveRouteCells(
      routeSamples
    );

  const cellResolutionDurationMs =
    Date.now() -
    cellResolutionStartedAt;

  // ==========================================================
  // LOOKUP
  // ==========================================================

  const lookupResult =
    await lookupUniqueCells(
      uniqueCells
    );

  const result =
    buildRouteResultFromSamples(
      route,
      routeSamples,
      resolvedSamples,
      lookupResult.cellResults,
      {
        sampleDistanceMeters,

        distanceMeters:
          Number(
            sampled?.totalDistanceMeters
          ) || 0,

        uniqueCellCount:
          uniqueCells.size,

        routeLocalUniqueCellCount:
          uniqueCells.size,

        globalUniqueCellCount:
          uniqueCells.size,

        lookupCount:
          lookupResult.lookupCount,

        globalLookupCount:
          lookupResult.lookupCount,

        lookupFailures:
          lookupResult.lookupFailures,

        lookupDurationMs:
          lookupResult.durationMs,

        globalDuplicateCellsAvoided:
          0,

        samplingDurationMs,

        cellResolutionDurationMs,
      }
    );

  const totalDurationMs =
    Date.now() -
    startedAt;

  console.log(
    `[routeAqiEngine] Route ${
      result.routeId
    }`
  );

  console.log(
    `[routeAqiEngine] Distance: ${Math.round(
      result.distanceMeters
    )}m`
  );

  console.log(
    `[routeAqiEngine] Samples: ${
      routeSamples.length
    }`
  );

  console.log(
    `[routeAqiEngine] Unique AQI cells: ${
      uniqueCells.size
    }`
  );

  console.log(
    `[routeAqiEngine] AQI lookups: ${
      lookupResult.lookupCount
    }`
  );

  console.log(
    `[routeAqiEngine] AQI lookup concurrency: ${
      AQI_LOOKUP_CONCURRENCY
    }`
  );

  console.log(
    `[routeAqiEngine] AQI lookup duration: ${
      lookupResult.durationMs
    }ms`
  );

  console.log(
    `[routeAqiEngine] Valid LIVE AQI samples: ${
      result.aqiSummary.validSamples
    }/${
      result.aqiSummary.totalSamples
    }`
  );

  console.log(
    `[routeAqiEngine] AQI coverage: ${
      result.aqiSummary.coveragePercent
    }%`
  );

  console.log(
    `[routeAqiEngine] AQI source: ${
      result.aqiSource
    }`
  );

  console.log(
    `[routeAqiEngine] Timing → sampling=${
      samplingDurationMs
    }ms | cells=${
      cellResolutionDurationMs
    }ms | lookups=${
      lookupResult.durationMs
    }ms | total=${
      totalDurationMs
    }ms`
  );

  return result;
}

// ============================================================
// EMPTY ROUTE RESULT
// ============================================================

function buildEmptyRouteResult(
  route,
  reason
) {
  const routeId =
    route?.routeId ??
    route?.id ??
    null;

  const coverageConfidence =
    getCoverageConfidence(
      0
    );

  return {
    routeId,

    routeIndex:
      route?.routeIndex ??
      null,

    geometry:
      route?.geometry ??
      null,

    distanceMeters:
      0,

    distanceKm:
      0,

    sampleDistanceMeters:
      DEFAULT_SAMPLE_DISTANCE_METERS,

    sampleCount:
      0,

    aqiSamples:
      [],

    aqiSummary: {
      averageAqi: null,

      peakAqi: null,

      minimumAqi: null,

      maximumAqi: null,

      validSamples: 0,

      totalSamples: 0,

      coveragePercent: 0,

      coverageConfidence:
        coverageConfidence.level,

      coverageUsable:
        false,

      coverageDescription:
        coverageConfidence.description,

      minimumUsableCoveragePercent:
        MIN_USABLE_COVERAGE_PERCENT,

      band: "Unknown",

      category: "Unknown",

      source:
        "unavailable",
    },

    stationCount:
      0,

    provider:
      null,

    standard:
      "US_EPA_ESTIMATE",

    aqiSource:
      "unavailable",

    coverage: {
      percent: 0,

      confidence:
        coverageConfidence.level,

      usable: false,

      minimumRequired:
        MIN_USABLE_COVERAGE_PERCENT,

      description:
        coverageConfidence.description,
    },

    cache: {
      ready:
        typeof aqiCache.isReady ===
        "function"
          ? aqiCache.isReady()
          : false,

      cellCount:
        typeof aqiCache.getCellCount ===
        "function"
          ? aqiCache.getCellCount()
          : 0,

      routeSampleCount:
        0,

      uniqueCellCount:
        0,

      aqiLookupCount:
        0,

      lookupFailures:
        0,

      lookupReduction:
        0,

      lookupReductionPercent:
        0,

      globalUniqueCellCount:
        0,

      globalLookupCount:
        0,

      globalDuplicateCellsAvoided:
        0,

      coveragePercent: 0,

      coverageConfidence:
        coverageConfidence.level,

      coverageUsable:
        false,

      minimumUsableCoveragePercent:
        MIN_USABLE_COVERAGE_PERCENT,

      lookupConcurrency:
        AQI_LOOKUP_CONCURRENCY,

      lookupDurationMs:
        0,
    },

    error:
      reason,

    generatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// PROCESS MULTIPLE ROUTES
// ============================================================
//
// IMPORTANT PERFORMANCE CHANGE:
//
// All routes are sampled first.
//
// Then ALL route samples are converted into one GLOBAL
// unique AQI-cell map.
//
// Example:
//
// Route 1 → cells A B C D
// Route 2 → cells C D E F
// Route 3 → cells B C F G
//
// OLD LOOKUPS:
//
// A B C D
// C D E F
// B C F G
//
// = 11 potential lookups
//
// NEW:
//
// A B C D E F G
//
// = 7 lookups
//
// The same AQI cell result is then reused by all routes.
//
// ============================================================

async function processRoutesAqi(
  routes,
  options = {}
) {
  if (!Array.isArray(routes)) {
    throw new Error(
      "routes must be an array."
    );
  }

  validateAqiCache();

  if (
    routes.length === 0
  ) {
    return [];
  }

  // ==========================================================
  // CACHE READY
  // ==========================================================

  if (
    typeof aqiCache.isReady ===
      "function" &&
    !aqiCache.isReady() &&
    typeof aqiCache.init ===
      "function"
  ) {
    await aqiCache.init();
  }

  const sampleDistanceMeters =
    Number(
      options.sampleDistanceMeters ||
        DEFAULT_SAMPLE_DISTANCE_METERS
    );

  if (
    !Number.isFinite(
      sampleDistanceMeters
    ) ||
    sampleDistanceMeters <= 0
  ) {
    throw new Error(
      "sampleDistanceMeters must be greater than 0."
    );
  }

  const batchStartedAt =
    Date.now();

  // ==========================================================
  // PHASE 1
  // SAMPLE ALL ROUTES
  // ==========================================================

  const routeContexts =
    [];

  let totalRouteSamples =
    0;

  let totalLocalUniqueCells =
    0;

  let totalDistanceMeters =
    0;

  for (
    let index = 0;
    index <
      routes.length;
    index++
  ) {
    const route = {
      ...routes[index],

      routeIndex:
        routes[index]
          ?.routeIndex ??
        index,
    };

    validateRoute(
      route
    );

    const samplingStartedAt =
      Date.now();

    const sampled =
      sampleRouteWithMetadata(
        route.geometry,
        {
          sampleDistanceMeters,
        }
      );

    const samplingDurationMs =
      Date.now() -
      samplingStartedAt;

    const routeSamples =
      Array.isArray(
        sampled?.samples
      )
        ? sampled.samples
        : [];

    const cellResolutionStartedAt =
      Date.now();

    const {
      resolvedSamples,
      uniqueCells,
    } =
      resolveRouteCells(
        routeSamples
      );

    const cellResolutionDurationMs =
      Date.now() -
      cellResolutionStartedAt;

    totalRouteSamples +=
      routeSamples.length;

    totalLocalUniqueCells +=
      uniqueCells.size;

    totalDistanceMeters +=
      Number(
        sampled?.totalDistanceMeters
      ) || 0;

    routeContexts.push({
      route,

      sampled,

      routeSamples,

      resolvedSamples,

      uniqueCells,

      samplingDurationMs,

      cellResolutionDurationMs,
    });
  }

  // ==========================================================
  // PHASE 2
  // BUILD GLOBAL UNIQUE CELL MAP
  // ==========================================================

  const globalUniqueCells =
    new Map();

  for (
    const context of
      routeContexts
  ) {
    for (
      const [
        cellKey,
        representative,
      ] of context
        .uniqueCells
        .entries()
    ) {
      if (
        !globalUniqueCells.has(
          cellKey
        )
      ) {
        globalUniqueCells.set(
          cellKey,
          representative
        );
      }
    }
  }

  const globalUniqueCellCount =
    globalUniqueCells.size;

  const duplicateCellsAvoided =
    Math.max(
      0,
      totalLocalUniqueCells -
        globalUniqueCellCount
    );

  console.log(
    `[routeAqiEngine] MULTI-ROUTE GLOBAL DEDUP → routes=${routes.length} | samples=${totalRouteSamples} | localUniqueCells=${totalLocalUniqueCells} | globalUniqueCells=${globalUniqueCellCount} | duplicatesAvoided=${duplicateCellsAvoided}`
  );

  // ==========================================================
  // PHASE 3
  // ONE SHARED AQI LOOKUP PASS
  // ==========================================================

  const lookupResult =
    await lookupUniqueCells(
      globalUniqueCells
    );

  // ==========================================================
  // PHASE 4
  // BUILD EACH ROUTE FROM SHARED RESULTS
  // ==========================================================

  const results =
    routeContexts.map(
      (context) => {
        const {
          route,
          sampled,
          routeSamples,
          resolvedSamples,
          uniqueCells,
          samplingDurationMs,
          cellResolutionDurationMs,
        } =
          context;

        return buildRouteResultFromSamples(
          route,
          routeSamples,
          resolvedSamples,
          lookupResult.cellResults,
          {
            sampleDistanceMeters,

            distanceMeters:
              Number(
                sampled?.totalDistanceMeters
              ) || 0,

            uniqueCellCount:
              uniqueCells.size,

            routeLocalUniqueCellCount:
              uniqueCells.size,

            globalUniqueCellCount,

            lookupCount:
              lookupResult.lookupCount,

            globalLookupCount:
              lookupResult.lookupCount,

            lookupFailures:
              lookupResult.lookupFailures,

            lookupDurationMs:
              lookupResult.durationMs,

            globalDuplicateCellsAvoided:
              duplicateCellsAvoided,

            samplingDurationMs,

            cellResolutionDurationMs,
          }
        );
      }
    );

  // ==========================================================
  // FINAL BATCH METRICS
  // ==========================================================

  const totalDurationMs =
    Date.now() -
    batchStartedAt;

  const oldPotentialLookupCount =
    totalLocalUniqueCells;

  const newLookupCount =
    globalUniqueCellCount;

  const lookupReduction =
    Math.max(
      0,
      oldPotentialLookupCount -
        newLookupCount
    );

  const lookupReductionPercent =
    oldPotentialLookupCount >
    0
      ? Math.round(
          (
            lookupReduction /
            oldPotentialLookupCount
          ) *
            1000
        ) / 10
      : 0;

  console.log(
    "\n========================================"
  );

  console.log(
    "      AIRROUTE GLOBAL AQI PERFORMANCE"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Routes                    : ${routes.length}`
  );

  console.log(
    `Route samples             : ${totalRouteSamples}`
  );

  console.log(
    `Local unique cells        : ${oldPotentialLookupCount}`
  );

  console.log(
    `Global unique cells       : ${newLookupCount}`
  );

  console.log(
    `Duplicate cells avoided   : ${duplicateCellsAvoided}`
  );

  console.log(
    `AQI provider lookups      : ${lookupResult.lookupCount}`
  );

  console.log(
    `Lookup reduction          : ${lookupReductionPercent}%`
  );

  console.log(
    `Lookup concurrency        : ${AQI_LOOKUP_CONCURRENCY}`
  );

  console.log(
    `AQI lookup duration       : ${lookupResult.durationMs}ms`
  );

  console.log(
    `AQI lookup failures       : ${lookupResult.lookupFailures}`
  );

  console.log(
    `Total AQI engine duration : ${totalDurationMs}ms`
  );

  console.log(
    "========================================\n"
  );

  // ==========================================================
  // RETURN
  // ==========================================================

  return results;
}

// ============================================================
// COMPACT RESPONSE
// ============================================================

function buildRouteAqiResponse(
  routeResult
) {
  if (!routeResult) {
    return null;
  }

  const summary =
    routeResult.aqiSummary ||
    {};

  return {
    routeId:
      routeResult.routeId,

    routeIndex:
      routeResult.routeIndex,

    distanceKm:
      routeResult.distanceKm,

    sampleCount:
      routeResult.sampleCount,

    averageAqi:
      summary.averageAqi ??
      null,

    peakAqi:
      summary.peakAqi ??
      null,

    minimumAqi:
      summary.minimumAqi ??
      null,

    maximumAqi:
      summary.maximumAqi ??
      null,

    validSamples:
      summary.validSamples ??
      0,

    coveragePercent:
      summary.coveragePercent ??
      0,

    coverageConfidence:
      summary.coverageConfidence ??
      "LOW",

    coverageUsable:
      summary.coverageUsable ??
      false,

    minimumUsableCoveragePercent:
      summary.minimumUsableCoveragePercent ??
      MIN_USABLE_COVERAGE_PERCENT,

    provider:
      routeResult.provider ??
      null,

    standard:
      routeResult.standard ??
      "US_EPA_ESTIMATE",

    aqiSource:
      routeResult.aqiSource ??
      "unavailable",

    band:
      summary.band ??
      "Unknown",

    category:
      summary.category ??
      "Unknown",

    uniqueAqiCells:
      routeResult.cache
        ?.uniqueCellCount ??
      0,

    aqiLookups:
      routeResult.cache
        ?.aqiLookupCount ??
      0,

    lookupReduction:
      routeResult.cache
        ?.lookupReduction ??
      0,

    lookupReductionPercent:
      routeResult.cache
        ?.lookupReductionPercent ??
      0,

    globalUniqueAqiCells:
      routeResult.cache
        ?.globalUniqueCellCount ??
      0,

    globalAqiLookups:
      routeResult.cache
        ?.globalLookupCount ??
      0,

    globalDuplicateCellsAvoided:
      routeResult.cache
        ?.globalDuplicateCellsAvoided ??
      0,

    lookupConcurrency:
      routeResult.cache
        ?.lookupConcurrency ??
      AQI_LOOKUP_CONCURRENCY,

    lookupDurationMs:
      routeResult.cache
        ?.lookupDurationMs ??
      0,
  };
}

// ============================================================
// COMPARE ROUTES
// ============================================================
//
// Lower average AQI is better.
//
// Routes without valid live AQI are always placed after
// routes with valid AQI.
//
// Coverage confidence is reported separately.
//
// ============================================================

function compareRoutes(
  routes
) {
  if (!Array.isArray(routes)) {
    return [];
  }

  return [...routes].sort(
    (a, b) => {
      const aAqi =
        Number(
          a?.aqiSummary
            ?.averageAqi
        );

      const bAqi =
        Number(
          b?.aqiSummary
            ?.averageAqi
        );

      const aValid =
        Number.isFinite(
          aAqi
        );

      const bValid =
        Number.isFinite(
          bAqi
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

      return (
        aAqi -
        bAqi
      );
    }
  );
}

// ============================================================
// DEBUG PRINTER
// ============================================================

function printRouteAqiDebug(
  result
) {
  if (!result) {
    console.log(
      "[routeAqiEngine] No result."
    );

    return;
  }

  const summary =
    result.aqiSummary ||
    {};

  const cache =
    result.cache ||
    {};

  console.log(
    "\n========================================"
  );

  console.log(
    "          ROUTE AQI ENGINE"
  );

  console.log(
    "========================================"
  );

  console.log(
    "Route ID:",
    result.routeId
  );

  console.log(
    "Route Index:",
    result.routeIndex
  );

  console.log(
    "Distance:",
    result.distanceKm,
    "km"
  );

  console.log(
    "Samples:",
    result.sampleCount
  );

  console.log(
    "Unique AQI Cells:",
    cache.uniqueCellCount
  );

  console.log(
    "Global Unique AQI Cells:",
    cache.globalUniqueCellCount
  );

  console.log(
    "Duplicate Cells Avoided:",
    cache.globalDuplicateCellsAvoided
  );

  console.log(
    "AQI Lookups:",
    cache.aqiLookupCount
  );

  console.log(
    "Global AQI Lookups:",
    cache.globalLookupCount
  );

  console.log(
    "AQI Lookup Concurrency:",
    cache.lookupConcurrency
  );

  console.log(
    "AQI Lookup Duration:",
    cache.lookupDurationMs,
    "ms"
  );

  console.log(
    "Lookup Reduction:",
    cache.lookupReduction
  );

  console.log(
    "Lookup Reduction:",
    cache.lookupReductionPercent,
    "%"
  );

  console.log(
    "AQI Provider:",
    result.provider
  );

  console.log(
    "AQI Source:",
    result.aqiSource
  );

  console.log(
    "Average AQI:",
    summary.averageAqi
  );

  console.log(
    "Peak AQI:",
    summary.peakAqi
  );

  console.log(
    "Minimum AQI:",
    summary.minimumAqi
  );

  console.log(
    "Maximum AQI:",
    summary.maximumAqi
  );

  console.log(
    "Valid Samples:",
    summary.validSamples
  );

  console.log(
    "Coverage:",
    summary.coveragePercent,
    "%"
  );

  console.log(
    "Coverage Confidence:",
    summary.coverageConfidence
  );

  console.log(
    "Coverage Usable:",
    summary.coverageUsable
  );

  console.log(
    "Minimum Required Coverage:",
    summary.minimumUsableCoveragePercent,
    "%"
  );

  console.log(
    "========================================\n"
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  processRouteAqi,

  processRoutesAqi,

  buildRouteAqiResponse,

  compareRoutes,

  printRouteAqiDebug,

  getCoverageConfidence,
};