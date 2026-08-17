"use strict";

// ============================================================
// AIRROUTE - AQI PROVIDER RESOLVER
// ============================================================
//
// PROVIDER ARCHITECTURE
//
//   1. OpenAQ -> PRIMARY
//   2. WAQI   -> FALLBACK
//
// IMPORTANT
// ------------------------------------------------------------
// - OpenAQ remains PRIMARY.
// - WAQI remains FALLBACK.
// - Missing AQI is NEVER converted to 0.
// - Unavailable results are NEVER cached.
// - OpenAQ circuit breaker ONLY reacts to real provider errors.
// - "No stations" is a LOCATION/data-availability issue,
//   NOT a provider outage.
// ============================================================

const openaqProvider = require("./openaqProvider");

// ============================================================
// WAQI - OPTIONAL FALLBACK
// ============================================================

let waqiProvider = null;

try {
  waqiProvider = require("./waqiProvider");
} catch (error) {
  console.warn(
    "[AQI Resolver] WAQI provider not available yet"
  );

  waqiProvider = null;
}

// ============================================================
// CONFIG
// ============================================================

const MIN_STATIONS = Math.max(
  Number(
    process.env.AQI_MIN_NEARBY_STATIONS || 2
  ),
  1
);

const MAX_STATIONS = Math.max(
  Number(
    process.env.AQI_MAX_NEARBY_STATIONS || 5
  ),
  MIN_STATIONS
);

const LIVE_MAX_AGE_MINUTES = Math.max(
  Number(
    process.env.AQI_LIVE_MAX_AGE_MINUTES || 60
  ),
  1
);

const MAX_STATION_AGE_MINUTES = Math.max(
  Number(
    process.env.AQI_MAX_STATION_AGE_MINUTES || 180
  ),
  LIVE_MAX_AGE_MINUTES
);

const DEFAULT_RADIUS_METERS = Math.min(
  Math.max(
    Number(
      process.env.AQI_STATION_RADIUS_METERS || 25000
    ),
    1000
  ),
  25000
);

// ============================================================
// RESOLVER CACHE
// ============================================================

const RESOLVER_CACHE_TTL_MS = Math.max(
  Number(
    process.env.AQI_RESOLVER_CACHE_TTL_MS ||
      5 * 60 * 1000
  ),
  1000
);

const RESOLVER_CACHE_GRID_DECIMALS = Math.max(
  Number(
    process.env.AQI_RESOLVER_CACHE_GRID_DECIMALS || 3
  ),
  1
);

// ============================================================
// OPENAQ CIRCUIT BREAKER
// ============================================================
//
// IMPORTANT CHANGE:
//
// Circuit breaker ONLY counts actual provider failures.
//
// It does NOT count:
//
// - zero stations
// - stale stations
// - unusable station data
// - location-specific absence of AQI
//
// This is critical because route AQI performs many spatial
// lookups. One area without a station must NOT shut down
// OpenAQ for the rest of the route.
// ============================================================

const OPENAQ_FAILURE_COOLDOWN_MS = Math.max(
  Number(
    process.env.OPENAQ_FAILURE_COOLDOWN_MS ||
      15 * 1000
  ),
  5000
);

const OPENAQ_FAILURE_THRESHOLD = Math.max(
  Number(
    process.env.OPENAQ_FAILURE_THRESHOLD || 3
  ),
  2
);

const OPENAQ_CIRCUIT_STATES = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
};

// ============================================================
// STATE
// ============================================================

const providerCache = new Map();

let openAQFailureCount = 0;

let openAQCircuitState =
  OPENAQ_CIRCUIT_STATES.CLOSED;

let openAQCircuitOpenUntil = 0;

let openAQProbeInFlight = false;

// ============================================================
// HELPERS
// ============================================================

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

// ============================================================
// CACHE KEY
// ============================================================

function createSpatialCacheKey(
  lat,
  lng,
  radiusMeters
) {
  const decimals =
    RESOLVER_CACHE_GRID_DECIMALS;

  const normalizedLat =
    Number(lat).toFixed(decimals);

  const normalizedLng =
    Number(lng).toFixed(decimals);

  const radius = Math.round(
    Number(radiusMeters) ||
      DEFAULT_RADIUS_METERS
  );

  return `${normalizedLat}:${normalizedLng}:${radius}`;
}

// ============================================================
// CACHE GET
// ============================================================

function getCachedResult(key) {
  const entry = providerCache.get(key);

  if (!entry) {
    return null;
  }

  if (
    Date.now() - entry.createdAt >
    RESOLVER_CACHE_TTL_MS
  ) {
    providerCache.delete(key);
    return null;
  }

  return {
    ...entry.result,

    cacheHit: true,

    cachedAt: new Date(
      entry.createdAt
    ).toISOString(),
  };
}

// ============================================================
// CACHE SET
// ============================================================

function setCachedResult(key, result) {
  // Never cache unavailable results.
  if (
    !result ||
    result.usable !== true ||
    !Array.isArray(result.stations) ||
    result.stations.length === 0
  ) {
    return result;
  }

  providerCache.set(key, {
    createdAt: Date.now(),

    result: {
      ...result,

      cacheHit: false,
    },
  });

  return result;
}

// ============================================================
// CACHE CLEANUP
// ============================================================

function cleanupCache() {
  const now = Date.now();

  for (
    const [key, entry] of providerCache.entries()
  ) {
    if (
      now - entry.createdAt >
      RESOLVER_CACHE_TTL_MS
    ) {
      providerCache.delete(key);
    }
  }
}

// ============================================================
// OPENAQ CIRCUIT STATE
// ============================================================

function getOpenAQCircuitState() {
  if (
    openAQCircuitState ===
    OPENAQ_CIRCUIT_STATES.CLOSED
  ) {
    return {
      state:
        OPENAQ_CIRCUIT_STATES.CLOSED,

      retryAfterMs: 0,

      probeAllowed: true,
    };
  }

  if (
    openAQCircuitState ===
    OPENAQ_CIRCUIT_STATES.OPEN
  ) {
    const remaining = Math.max(
      0,
      openAQCircuitOpenUntil -
        Date.now()
    );

    if (remaining === 0) {
      openAQCircuitState =
        OPENAQ_CIRCUIT_STATES.HALF_OPEN;

      openAQProbeInFlight = false;

      console.log(
        "[AQI Resolver] OpenAQ circuit → HALF_OPEN"
      );

      return {
        state:
          OPENAQ_CIRCUIT_STATES.HALF_OPEN,

        retryAfterMs: 0,

        probeAllowed: true,
      };
    }

    return {
      state:
        OPENAQ_CIRCUIT_STATES.OPEN,

      retryAfterMs: remaining,

      probeAllowed: false,
    };
  }

  return {
    state:
      OPENAQ_CIRCUIT_STATES.HALF_OPEN,

    retryAfterMs: 0,

    probeAllowed:
      !openAQProbeInFlight,
  };
}

// ============================================================
// OPENAQ REQUEST PERMISSION
// ============================================================

function canTryOpenAQ() {
  const circuit =
    getOpenAQCircuitState();

  if (
    circuit.state ===
    OPENAQ_CIRCUIT_STATES.CLOSED
  ) {
    return true;
  }

  if (
    circuit.state ===
    OPENAQ_CIRCUIT_STATES.OPEN
  ) {
    return false;
  }

  if (
    circuit.state ===
    OPENAQ_CIRCUIT_STATES.HALF_OPEN
  ) {
    if (openAQProbeInFlight) {
      return false;
    }

    openAQProbeInFlight = true;

    console.log(
      "[AQI Resolver] OpenAQ HALF_OPEN probe allowed"
    );

    return true;
  }

  return false;
}

// ============================================================
// RECORD REAL OPENAQ FAILURE
// ============================================================
//
// ONLY call this for:
// - network error
// - timeout
// - provider exception
// - HTTP/API failure
// - missing provider implementation
//
// DO NOT call this for:
// - zero stations
// - stale data
// - no usable stations
// ============================================================

function recordOpenAQFailure(reason) {
  if (
    openAQCircuitState ===
    OPENAQ_CIRCUIT_STATES.HALF_OPEN
  ) {
    openAQProbeInFlight = false;

    openAQCircuitState =
      OPENAQ_CIRCUIT_STATES.OPEN;

    openAQCircuitOpenUntil =
      Date.now() +
      OPENAQ_FAILURE_COOLDOWN_MS;

    console.warn(
      `[AQI Resolver] OpenAQ recovery probe failed → OPEN for ${OPENAQ_FAILURE_COOLDOWN_MS}ms:`,
      reason || "unknown"
    );

    return;
  }

  openAQFailureCount += 1;

  console.warn(
    `[AQI Resolver] OpenAQ provider failure ${openAQFailureCount}/${OPENAQ_FAILURE_THRESHOLD}:`,
    reason || "unknown"
  );

  if (
    openAQFailureCount <
    OPENAQ_FAILURE_THRESHOLD
  ) {
    return;
  }

  openAQCircuitState =
    OPENAQ_CIRCUIT_STATES.OPEN;

  openAQCircuitOpenUntil =
    Date.now() +
    OPENAQ_FAILURE_COOLDOWN_MS;

  openAQProbeInFlight = false;

  console.warn(
    `[AQI Resolver] OpenAQ circuit OPEN for ${OPENAQ_FAILURE_COOLDOWN_MS}ms`
  );
}

// ============================================================
// RESET ON SUCCESS
// ============================================================

function recordOpenAQSuccess() {
  const recovered =
    openAQCircuitState !==
      OPENAQ_CIRCUIT_STATES.CLOSED ||
    openAQFailureCount > 0;

  openAQFailureCount = 0;

  openAQCircuitState =
    OPENAQ_CIRCUIT_STATES.CLOSED;

  openAQCircuitOpenUntil = 0;

  openAQProbeInFlight = false;

  if (recovered) {
    console.log(
      "[AQI Resolver] OpenAQ recovered → CLOSED"
    );
  }
}

// ============================================================
// CACHE STATS
// ============================================================

function getCacheStats() {
  cleanupCache();

  const circuit =
    getOpenAQCircuitState();

  return {
    entries:
      providerCache.size,

    ttlMs:
      RESOLVER_CACHE_TTL_MS,

    gridDecimals:
      RESOLVER_CACHE_GRID_DECIMALS,

    openAQFailureCount,

    openAQCircuitState:
      circuit.state,

    openAQCircuitOpen:
      circuit.state ===
      OPENAQ_CIRCUIT_STATES.OPEN,

    openAQProbeInFlight,

    openAQCircuitOpenUntil:
      openAQCircuitOpenUntil
        ? new Date(
            openAQCircuitOpenUntil
          ).toISOString()
        : null,

    openAQRetryAfterMs:
      circuit.retryAfterMs,
  };
}

// ============================================================
// STATION DISTANCE
// ============================================================

function getStationDistance(station) {
  const values = [
    station?.distanceMeters,
    station?.station?.distanceMeters,
    station?.distance,
    station?.station?.distance,
  ];

  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return Infinity;
}

// ============================================================
// STATION PRIORITY
// ============================================================

function getStationPriority(station) {
  const values = [
    station?.priority,
    station?.station?.priority,
  ];

  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return 0;
}

// ============================================================
// STATION QUALITY
// ============================================================

function getStationQualityScore(station) {
  const values = [
    station?.dataQuality?.score,
    station?.qualityScore,
  ];

  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return 0;
}

// ============================================================
// STATION MEASUREMENTS
// ============================================================

function getStationMeasurements(station) {
  if (
    Array.isArray(
      station?.measurements
    )
  ) {
    return station.measurements;
  }

  if (
    Array.isArray(
      station?.data?.measurements
    )
  ) {
    return station.data.measurements;
  }

  return [];
}

// ============================================================
// FRESHNESS
// ============================================================

function normalizeFreshness(value) {
  const normalized = String(
    value || ""
  )
    .trim()
    .toLowerCase();

  if (
    normalized === "live" ||
    normalized === "recent" ||
    normalized === "stale" ||
    normalized === "invalid"
  ) {
    return normalized;
  }

  return null;
}

function freshnessRank(value) {
  switch (
    normalizeFreshness(value)
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

function getBestFreshness(values) {
  return (
    values
      .map(normalizeFreshness)
      .filter(Boolean)
      .sort(
        (a, b) =>
          freshnessRank(b) -
          freshnessRank(a)
      )[0] || null
  );
}

// ============================================================
// STATION FRESHNESS
// ============================================================

function getStationFreshness(station) {
  if (
    station?.hasLiveData === true ||
    Number(
      station?.liveMeasurementCount || 0
    ) > 0
  ) {
    return {
      freshness: "live",
      isLive: true,
      isRecent: true,
      isStale: false,

      usableCount: Number(
        station?.liveMeasurementCount || 0
      ),
    };
  }

  if (
    station?.freshness === "live"
  ) {
    return {
      freshness: "live",
      isLive: true,
      isRecent: true,
      isStale: false,

      usableCount: Number(
        station?.usableMeasurementCount || 0
      ),
    };
  }

  if (
    station?.freshness === "recent"
  ) {
    return {
      freshness: "recent",
      isLive: false,
      isRecent: true,
      isStale: false,

      usableCount: Number(
        station?.usableMeasurementCount || 0
      ),
    };
  }

  if (
    station?.freshness === "stale"
  ) {
    return {
      freshness: "stale",
      isLive: false,
      isRecent: false,
      isStale: true,

      usableCount: Number(
        station?.usableMeasurementCount || 0
      ),
    };
  }

  const measurements =
    getStationMeasurements(station);

  const usable =
    measurements.filter(
      (measurement) =>
        measurement &&
        measurement.isUsable === true
    );

  const live =
    usable.filter(
      (measurement) =>
        measurement.isLive === true
    );

  const recent =
    usable.filter(
      (measurement) =>
        measurement.isRecent === true
    );

  const stale =
    usable.filter(
      (measurement) =>
        measurement.isStale === true
    );

  if (live.length > 0) {
    return {
      freshness: "live",
      isLive: true,
      isRecent: true,
      isStale: false,
      usableCount: usable.length,
    };
  }

  if (recent.length > 0) {
    return {
      freshness: "recent",
      isLive: false,
      isRecent: true,
      isStale: false,
      usableCount: usable.length,
    };
  }

  if (stale.length > 0) {
    return {
      freshness: "stale",
      isLive: false,
      isRecent: false,
      isStale: true,
      usableCount: usable.length,
    };
  }

  return {
    freshness: "none",
    isLive: false,
    isRecent: false,
    isStale: false,
    usableCount: 0,
  };
}

// ============================================================
// FRESHNESS STATS
// ============================================================

function getFreshnessStats(stations) {
  const allMeasurements = [];

  for (
    const station of safeArray(stations)
  ) {
    const measurements =
      getStationMeasurements(station);

    for (
      const measurement of measurements
    ) {
      if (
        measurement &&
        measurement.isUsable === true
      ) {
        allMeasurements.push(
          measurement
        );
      }
    }
  }

  const liveMeasurements =
    allMeasurements.filter(
      (measurement) =>
        measurement.isLive === true
    );

  const recentMeasurements =
    allMeasurements.filter(
      (measurement) =>
        measurement.isRecent === true
    );

  const staleMeasurements =
    allMeasurements.filter(
      (measurement) =>
        measurement.isStale === true
    );

  return {
    totalMeasurements:
      allMeasurements.length,

    liveMeasurements:
      liveMeasurements.length,

    recentMeasurements:
      recentMeasurements.length,

    staleMeasurements:
      staleMeasurements.length,

    hasLiveData:
      liveMeasurements.length > 0,

    hasRecentData:
      recentMeasurements.length > 0,
  };
}

// ============================================================
// STATION USABILITY
// ============================================================

function isStationUsable(station) {
  if (!station) {
    return false;
  }

  if (
    station.hasUsableData === true
  ) {
    return true;
  }

  if (
    Number(
      station.usableMeasurementCount || 0
    ) > 0
  ) {
    return true;
  }

  const measurements =
    getStationMeasurements(station);

  return measurements.some(
    (measurement) =>
      measurement &&
      measurement.isUsable === true
  );
}

// ============================================================
// STATION SCORE
// ============================================================

function calculateStationScore(station) {
  const distance =
    getStationDistance(station);

  const priority =
    getStationPriority(station);

  const qualityScore =
    getStationQualityScore(station);

  const freshness =
    getStationFreshness(station);

  let freshnessScore = 0;

  if (
    freshness.freshness === "live"
  ) {
    freshnessScore = 50000;
  } else if (
    freshness.freshness === "recent"
  ) {
    freshnessScore = 20000;
  }

  const priorityScore =
    priority * 100;

  const distanceScore =
    Math.max(
      0,
      DEFAULT_RADIUS_METERS -
        distance
    );

  return (
    freshnessScore +
    priorityScore +
    qualityScore +
    distanceScore
  );
}

// ============================================================
// RANK STATIONS
// ============================================================

function rankStations(stations) {
  return safeArray(stations)
    .filter(isStationUsable)
    .map((station) => {
      const freshness =
        getStationFreshness(
          station
        );

      return {
        ...station,

        resolverScore:
          calculateStationScore(
            station
          ),

        resolverFreshness:
          freshness,
      };
    })
    .sort(
      (a, b) =>
        b.resolverScore -
        a.resolverScore
    )
    .slice(0, MAX_STATIONS);
}

// ============================================================
// OPENAQ UNAVAILABLE
// ============================================================

function createOpenAQUnavailableResult(
  reason
) {
  return {
    provider: "openaq",

    status: "unavailable",

    usable: false,

    live: false,

    recent: false,

    stations: [],

    stationCount: 0,

    confidence: "none",

    reason:
      reason ||
      "OpenAQ unavailable",

    error: true,
  };
}

// ============================================================
// OPENAQ RESOLVER
// ============================================================

async function resolveOpenAQ(
  lat,
  lng,
  radiusMeters
) {
  const circuit =
    getOpenAQCircuitState();

  // ----------------------------------------------------------
  // CIRCUIT OPEN
  // ----------------------------------------------------------

  if (
    circuit.state ===
    OPENAQ_CIRCUIT_STATES.OPEN
  ) {
    console.warn(
      `[AQI Resolver] OpenAQ circuit is OPEN. Retry in ${circuit.retryAfterMs}ms.`
    );

    return {
      ...createOpenAQUnavailableResult(
        "OpenAQ temporarily disabled after repeated provider errors"
      ),

      circuitOpen: true,

      circuitState:
        OPENAQ_CIRCUIT_STATES.OPEN,

      retryAfterMs:
        circuit.retryAfterMs,
    };
  }

  // ----------------------------------------------------------
  // HALF OPEN
  // ----------------------------------------------------------

  if (
    circuit.state ===
    OPENAQ_CIRCUIT_STATES.HALF_OPEN
  ) {
    if (!canTryOpenAQ()) {
      return {
        ...createOpenAQUnavailableResult(
          "OpenAQ recovery probe already in progress"
        ),

        circuitOpen: true,

        circuitState:
          OPENAQ_CIRCUIT_STATES.HALF_OPEN,
      };
    }
  }

  try {
    console.log(
      "\n[AQI Resolver] Trying OpenAQ..."
    );

    if (
      !openaqProvider ||
      typeof openaqProvider.getNearbyStationData !==
        "function"
    ) {
      recordOpenAQFailure(
        "OpenAQ provider method unavailable"
      );

      return createOpenAQUnavailableResult(
        "OpenAQ provider method is unavailable"
      );
    }

    const stations =
      await openaqProvider.getNearbyStationData(
        lat,
        lng,
        radiusMeters
      );

    // ========================================================
    // IMPORTANT:
    // Empty station response is NOT a provider failure.
    // It only means this spatial cell has no usable AQI.
    // ========================================================

    if (
      !Array.isArray(stations)
    ) {
      recordOpenAQFailure(
        "OpenAQ returned non-array result"
      );

      return createOpenAQUnavailableResult(
        "OpenAQ returned a non-array result"
      );
    }

    if (
      stations.length === 0
    ) {
      console.warn(
        `[AQI Resolver] OpenAQ returned no stations at ${lat},${lng}`
      );

      // DO NOT trip circuit breaker.
      return createOpenAQUnavailableResult(
        "OpenAQ returned no nearby stations"
      );
    }

    const rankedStations =
      rankStations(stations);

    // ========================================================
    // IMPORTANT:
    // Stations failing usability is NOT provider failure.
    // ========================================================

    if (
      rankedStations.length === 0
    ) {
      console.warn(
        `[AQI Resolver] OpenAQ stations found but no usable AQI at ${lat},${lng}`
      );

      // DO NOT trip circuit breaker.
      return createOpenAQUnavailableResult(
        "OpenAQ stations returned but none passed resolver usability checks"
      );
    }

    const freshness =
      getFreshnessStats(
        rankedStations
      );

    const liveStationCount =
      rankedStations.filter(
        (station) =>
          station?.resolverFreshness
            ?.isLive === true
      ).length;

    const recentStationCount =
      rankedStations.filter(
        (station) =>
          station?.resolverFreshness
            ?.isRecent === true
      ).length;

    const status =
      liveStationCount > 0
        ? "live"
        : recentStationCount > 0
        ? "recent"
        : "unavailable";

    // ========================================================
    // IMPORTANT:
    // Stale data is not provider outage.
    // ========================================================

    if (
      status === "unavailable"
    ) {
      console.warn(
        `[AQI Resolver] OpenAQ data stale/unusable at ${lat},${lng}`
      );

      return createOpenAQUnavailableResult(
        "OpenAQ data is not sufficiently fresh"
      );
    }

    let confidence = "low";

    if (
      liveStationCount >= 2 &&
      rankedStations.length >= 3
    ) {
      confidence = "high";
    } else if (
      liveStationCount >= 1 ||
      recentStationCount >= 2
    ) {
      confidence = "medium";
    }

    // ========================================================
    // SUCCESS
    // ========================================================

    recordOpenAQSuccess();

    console.log(
      `[AQI Resolver] OpenAQ selected ${rankedStations.length} stations | live=${liveStationCount} | recent=${recentStationCount} | confidence=${confidence}`
    );

    return {
      provider: "openaq",

      status,

      usable: true,

      live:
        liveStationCount > 0,

      recent:
        recentStationCount > 0,

      stations:
        rankedStations,

      stationCount:
        rankedStations.length,

      liveStationCount,

      recentStationCount,

      freshness,

      confidence,

      fallbackUsed: false,

      fallbackReason: null,

      primaryProvider: "openaq",

      generatedAt:
        new Date().toISOString(),

      resolvedAt:
        new Date().toISOString(),

      circuitOpen: false,

      circuitState:
        OPENAQ_CIRCUIT_STATES.CLOSED,
    };
  } catch (error) {
    // ========================================================
    // ONLY REAL PROVIDER ERROR TRIPS CIRCUIT
    // ========================================================

    recordOpenAQFailure(
      error?.message ||
        "Unknown OpenAQ error"
    );

    console.error(
      "[AQI Resolver] OpenAQ failed:",
      error?.message || error
    );

    return {
      ...createOpenAQUnavailableResult(
        error?.message ||
          "Unknown OpenAQ error"
      ),

      errorName:
        error?.name || null,
    };
  } finally {
    if (
      openAQCircuitState !==
      OPENAQ_CIRCUIT_STATES.HALF_OPEN
    ) {
      openAQProbeInFlight = false;
    }
  }
}

// ============================================================
// WAQI RESOLVER
// ============================================================

async function resolveWAQI(
  lat,
  lng,
  radiusMeters
) {
  if (!waqiProvider) {
    return {
      provider: "waqi",

      status: "unavailable",

      usable: false,

      live: false,

      recent: false,

      stations: [],

      stationCount: 0,

      confidence: "none",

      reason:
        "WAQI provider is not available",
    };
  }

  try {
    console.log(
      "[AQI Resolver] Trying WAQI..."
    );

    let result;

    if (
      typeof waqiProvider.getNearbyStationData ===
      "function"
    ) {
      result =
        await waqiProvider.getNearbyStationData(
          lat,
          lng,
          radiusMeters
        );
    } else if (
      typeof waqiProvider.getNearbyStations ===
      "function"
    ) {
      result =
        await waqiProvider.getNearbyStations(
          lat,
          lng,
          radiusMeters
        );
    } else {
      return {
        provider: "waqi",

        status: "unavailable",

        usable: false,

        live: false,

        recent: false,

        stations: [],

        stationCount: 0,

        confidence: "none",

        reason:
          "WAQI provider has no supported station method",
      };
    }

    const stations =
      Array.isArray(result)
        ? result
        : safeArray(
            result?.stations
          );

    if (
      stations.length === 0
    ) {
      return {
        provider: "waqi",

        status: "unavailable",

        usable: false,

        live: false,

        recent: false,

        stations: [],

        stationCount: 0,

        confidence: "none",

        reason:
          "WAQI returned no usable stations",
      };
    }

    const normalizedStations =
      stations
        .filter(Boolean)
        .map((station) => {
          const freshness =
            getStationFreshness(
              station
            );

          return {
            ...station,

            resolverFreshness:
              freshness,

            resolverScore:
              calculateStationScore(
                station
              ),
          };
        })
        .filter(
          isStationUsable
        )
        .sort(
          (a, b) =>
            b.resolverScore -
            a.resolverScore
        )
        .slice(
          0,
          MAX_STATIONS
        );

    if (
      normalizedStations.length ===
      0
    ) {
      return {
        provider: "waqi",

        status: "unavailable",

        usable: false,

        live: false,

        recent: false,

        stations: [],

        stationCount: 0,

        confidence: "none",

        reason:
          "WAQI stations failed resolver usability checks",
      };
    }

    const liveStationCount =
      normalizedStations.filter(
        (station) =>
          station
            ?.resolverFreshness
            ?.isLive === true
      ).length;

    const recentStationCount =
      normalizedStations.filter(
        (station) =>
          station
            ?.resolverFreshness
            ?.isRecent === true
      ).length;

    const status =
      liveStationCount > 0
        ? "live"
        : recentStationCount > 0
        ? "recent"
        : "unavailable";

    if (
      status === "unavailable"
    ) {
      return {
        provider: "waqi",

        status,

        usable: false,

        live: false,

        recent: false,

        stations: [],

        stationCount: 0,

        confidence: "none",

        reason:
          "WAQI data is not sufficiently fresh",
      };
    }

    let confidence = "low";

    if (
      liveStationCount >= 2
    ) {
      confidence = "high";
    } else if (
      liveStationCount >= 1 ||
      recentStationCount >= 2
    ) {
      confidence = "medium";
    }

    console.log(
      `[AQI Resolver] WAQI selected ${normalizedStations.length} stations | live=${liveStationCount} | recent=${recentStationCount}`
    );

    return {
      provider: "waqi",

      status,

      usable: true,

      live:
        liveStationCount > 0,

      recent:
        recentStationCount > 0,

      stations:
        normalizedStations,

      stationCount:
        normalizedStations.length,

      liveStationCount,

      recentStationCount,

      confidence,

      fallbackUsed: true,

      generatedAt:
        new Date().toISOString(),

      resolvedAt:
        new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      "[AQI Resolver] WAQI failed:",
      error?.message || error
    );

    return {
      provider: "waqi",

      status: "error",

      usable: false,

      live: false,

      recent: false,

      stations: [],

      stationCount: 0,

      confidence: "none",

      reason:
        error?.message ||
        "Unknown WAQI error",

      error: true,
    };
  }
}

// ============================================================
// MAIN RESOLVER
// ============================================================

async function resolveAQIProvider(
  lat,
  lng,
  radiusMeters =
    DEFAULT_RADIUS_METERS,
  options = {}
) {
  const start = Date.now();

  const latitude =
    finiteNumber(lat);

  const longitude =
    finiteNumber(lng);

  if (
    latitude === null ||
    longitude === null
  ) {
    return {
      provider: null,

      status: "unavailable",

      usable: false,

      live: false,

      recent: false,

      stations: [],

      stationCount: 0,

      confidence: "none",

      fallbackUsed: false,

      reason:
        "Invalid AQI coordinates",

      resolutionTimeMs:
        Date.now() - start,
    };
  }

  const forceWAQI =
    options.forceWAQI === true;

  const cacheKey =
    createSpatialCacheKey(
      latitude,
      longitude,
      radiusMeters
    );

  // ==========================================================
  // CACHE
  // ==========================================================

  if (
    !forceWAQI &&
    options.bypassCache !== true
  ) {
    const cached =
      getCachedResult(
        cacheKey
      );

    if (cached) {
      console.log(
        `[AQI Resolver] CACHE HIT ${cacheKey} | provider=${cached.provider || "none"}`
      );

      return {
        ...cached,

        cacheHit: true,

        resolutionTimeMs:
          Date.now() - start,
      };
    }
  }

  // ==========================================================
  // FORCE WAQI
  // ==========================================================

  if (forceWAQI) {
    const waqi =
      await resolveWAQI(
        latitude,
        longitude,
        radiusMeters
      );

    const result = {
      ...waqi,

      provider:
        waqi.usable
          ? "waqi"
          : null,

      fallbackUsed: true,

      fallbackReason:
        "Forced WAQI test",

      primaryProvider:
        "openaq",

      resolvedAt:
        new Date().toISOString(),

      resolutionTimeMs:
        Date.now() - start,
    };

    return setCachedResult(
      cacheKey,
      result
    );
  }

  // ==========================================================
  // OPENAQ PRIMARY
  // ==========================================================

  const openAQ =
    await resolveOpenAQ(
      latitude,
      longitude,
      radiusMeters
    );

  if (
    openAQ.usable &&
    (
      openAQ.live ||
      openAQ.recent
    )
  ) {
    const result = {
      ...openAQ,

      provider: "openaq",

      fallbackUsed: false,

      fallbackReason: null,

      primaryProvider: "openaq",

      resolvedAt:
        new Date().toISOString(),

      resolutionTimeMs:
        Date.now() - start,
    };

    return setCachedResult(
      cacheKey,
      result
    );
  }

  // ==========================================================
  // OPENAQ → WAQI
  // ==========================================================

  console.log(
    "[AQI Resolver] OpenAQ unavailable → WAQI fallback"
  );

  const waqi =
    await resolveWAQI(
      latitude,
      longitude,
      radiusMeters
    );

  if (
    waqi.usable &&
    (
      waqi.live ||
      waqi.recent
    )
  ) {
    const result = {
      ...waqi,

      provider: "waqi",

      fallbackUsed: true,

      fallbackReason:
        openAQ.reason ||
        "OpenAQ unavailable",

      primaryProvider:
        "openaq",

      providers: {
        openaq: openAQ,
        waqi,
      },

      resolvedAt:
        new Date().toISOString(),

      resolutionTimeMs:
        Date.now() - start,
    };

    return setCachedResult(
      cacheKey,
      result
    );
  }

  // ==========================================================
  // BOTH UNAVAILABLE
  // ==========================================================

  return {
    provider: null,

    status: "unavailable",

    usable: false,

    live: false,

    recent: false,

    stations: [],

    stationCount: 0,

    confidence: "none",

    fallbackUsed: true,

    primaryProvider: "openaq",

    fallbackReason:
      "OpenAQ and WAQI unavailable",

    reason:
      "No usable AQI provider available",

    providers: {
      openaq: openAQ,
      waqi,
    },

    resolvedAt:
      new Date().toISOString(),

    resolutionTimeMs:
      Date.now() - start,
  };
}

// ============================================================
// PROVIDER HELPERS
// ============================================================

function hasUsableProvider(result) {
  return Boolean(
    result &&
    result.usable === true &&
    Number(
      result.stationCount || 0
    ) > 0
  );
}

function isLiveProvider(result) {
  return Boolean(
    result &&
    result.usable === true &&
    result.live === true
  );
}

function isRecentProvider(result) {
  return Boolean(
    result &&
    result.usable === true &&
    result.recent === true
  );
}

function getBestStations(result) {
  if (
    !hasUsableProvider(result)
  ) {
    return [];
  }

  return safeArray(
    result.stations
  ).slice(
    0,
    MAX_STATIONS
  );
}

function getBestStation(result) {
  const stations =
    getBestStations(result);

  return stations[0] || null;
}

// ============================================================
// SUMMARY
// ============================================================

function summarizeProviderResult(
  result
) {
  if (!result) {
    return {
      provider: null,

      status: "unavailable",

      usable: false,

      live: false,

      recent: false,

      stationCount: 0,

      confidence: "none",
    };
  }

  return {
    provider:
      result.provider || null,

    status:
      result.status ||
      "unknown",

    usable:
      result.usable === true,

    live:
      result.live === true,

    recent:
      result.recent === true,

    stationCount:
      Number(
        result.stationCount || 0
      ),

    liveStationCount:
      Number(
        result.liveStationCount || 0
      ),

    recentStationCount:
      Number(
        result.recentStationCount || 0
      ),

    confidence:
      result.confidence ||
      "none",

    fallbackUsed:
      result.fallbackUsed === true,

    fallbackReason:
      result.fallbackReason ||
      null,

    reason:
      result.reason ||
      null,

    cacheHit:
      result.cacheHit === true,

    resolutionTimeMs:
      result.resolutionTimeMs ||
      null,
  };
}

// ============================================================
// TEST - GENERAL
// ============================================================

async function testAQIResolver() {
  const lat = 28.6139;
  const lng = 77.2090;

  console.log(
    "\n============================================"
  );

  console.log(
    "       AQI PROVIDER RESOLVER TEST"
  );

  console.log(
    "============================================"
  );

  const first =
    await resolveAQIProvider(
      lat,
      lng,
      DEFAULT_RADIUS_METERS,
      {
        bypassCache: true,
      }
    );

  console.log(
    "\nFIRST REQUEST"
  );

  console.dir(
    summarizeProviderResult(first),
    {
      depth: 10,
    }
  );

  const second =
    await resolveAQIProvider(
      lat,
      lng,
      DEFAULT_RADIUS_METERS
    );

  console.log(
    "\nSECOND REQUEST"
  );

  console.dir(
    summarizeProviderResult(second),
    {
      depth: 10,
    }
  );

  console.log(
    "\nCACHE"
  );

  console.dir(
    getCacheStats(),
    {
      depth: 10,
    }
  );

  return second;
}

// ============================================================
// TEST - WAQI FALLBACK
// ============================================================

async function testWAQIFallback() {
  const lat = 28.6139;
  const lng = 77.2090;

  const result =
    await resolveAQIProvider(
      lat,
      lng,
      DEFAULT_RADIUS_METERS,
      {
        forceWAQI: true,

        bypassCache: true,
      }
    );

  console.dir(
    summarizeProviderResult(result),
    {
      depth: 10,
    }
  );

  return result;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  resolveAQIProvider,

  resolveOpenAQ,

  resolveWAQI,

  rankStations,

  calculateStationScore,

  getStationFreshness,

  getStationDistance,

  getStationPriority,

  getStationQualityScore,

  getFreshnessStats,

  hasUsableProvider,

  isLiveProvider,

  isRecentProvider,

  getBestStations,

  getBestStation,

  summarizeProviderResult,

  getCacheStats,

  cleanupCache,

  testAQIResolver,

  testWAQIFallback,
};