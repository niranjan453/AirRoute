const DEFAULT_LIVE_MAX_AGE_MINUTES = Number(
  process.env.AQI_LIVE_MAX_AGE_MINUTES || 60
);

const DEFAULT_MAX_AGE_MINUTES = Number(
  process.env.AQI_MAX_STATION_AGE_MINUTES || 180
);

/**
 * Convert an observation timestamp into a valid Date.
 *
 * Supports:
 * - Date object
 * - OpenAQ datetime object
 * - ISO string
 */
function parseObservationTime(observedAt) {
  if (!observedAt) {
    return null;
  }

  // Already a Date object
  if (observedAt instanceof Date) {
    if (!Number.isNaN(observedAt.getTime())) {
      return observedAt;
    }

    return null;
  }

  // OpenAQ datetime object
  //
  // Example:
  // {
  //   utc: "2026-08-11T15:00:00Z",
  //   local: "2026-08-11T20:30:00+05:30"
  // }
  if (
    typeof observedAt === "object"
  ) {
    if (observedAt.utc) {
      const date = new Date(
        observedAt.utc
      );

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    if (observedAt.local) {
      const date = new Date(
        observedAt.local
      );

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // ISO/string timestamp
  if (
    typeof observedAt === "string"
  ) {
    const date = new Date(
      observedAt
    );

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

/**
 * Calculate observation age in minutes.
 */
function getObservationAgeMinutes(
  observedAt,
  now = new Date()
) {
  const observedDate =
    parseObservationTime(
      observedAt
    );

  if (!observedDate) {
    return null;
  }

  const nowDate =
    now instanceof Date
      ? now
      : new Date(now);

  if (
    Number.isNaN(nowDate.getTime())
  ) {
    return null;
  }

  const ageMs =
    nowDate.getTime() -
    observedDate.getTime();

  return ageMs / 60000;
}

/**
 * Classify AQI observation freshness.
 *
 * LIVE:
 *   0–60 minutes
 *
 * RECENT:
 *   >60–180 minutes
 *
 * STALE:
 *   >180 minutes
 *
 * INVALID:
 *   Invalid timestamp or
 *   unexpectedly future timestamp
 */
function classifyFreshness(
  observedAt,
  options = {}
) {
  const liveMaxAgeMinutes =
    Number(
      options.liveMaxAgeMinutes ??
        DEFAULT_LIVE_MAX_AGE_MINUTES
    );

  const maxAgeMinutes =
    Number(
      options.maxAgeMinutes ??
        DEFAULT_MAX_AGE_MINUTES
    );

  const now =
    options.now instanceof Date
      ? options.now
      : new Date();

  const observedDate =
    parseObservationTime(
      observedAt
    );

  if (!observedDate) {
    return {
      freshness: "invalid",

      isUsable: false,
      isLive: false,
      isRecent: false,
      isStale: false,

      ageMinutes: null,
      observedAt: null,

      reason:
        "Invalid or missing observation timestamp",
    };
  }

  const ageMinutes =
    getObservationAgeMinutes(
      observedDate,
      now
    );

  if (ageMinutes === null) {
    return {
      freshness: "invalid",

      isUsable: false,
      isLive: false,
      isRecent: false,
      isStale: false,

      ageMinutes: null,

      observedAt:
        observedDate.toISOString(),

      reason:
        "Unable to calculate observation age",
    };
  }

  /**
   * Protect against timestamps
   * significantly in the future.
   *
   * Allow 5 minutes for small
   * clock differences.
   */
  if (ageMinutes < -5) {
    return {
      freshness: "invalid",

      isUsable: false,
      isLive: false,
      isRecent: false,
      isStale: false,

      ageMinutes,

      observedAt:
        observedDate.toISOString(),

      reason:
        "Observation timestamp is unexpectedly in the future",
    };
  }

  // Small future differences are
  // treated as zero age.
  const normalizedAgeMinutes =
    Math.max(0, ageMinutes);

  // --------------------------------------------------
  // LIVE
  // --------------------------------------------------

  if (
    normalizedAgeMinutes <=
    liveMaxAgeMinutes
  ) {
    return {
      freshness: "live",

      isUsable: true,
      isLive: true,
      isRecent: true,
      isStale: false,

      ageMinutes:
        normalizedAgeMinutes,

      observedAt:
        observedDate.toISOString(),

      reason:
        "Fresh monitoring observation",
    };
  }

  // --------------------------------------------------
  // RECENT
  // --------------------------------------------------

  if (
    normalizedAgeMinutes <=
    maxAgeMinutes
  ) {
    return {
      freshness: "recent",

      isUsable: true,
      isLive: false,
      isRecent: true,
      isStale: false,

      ageMinutes:
        normalizedAgeMinutes,

      observedAt:
        observedDate.toISOString(),

      reason:
        "Recent monitoring observation",
    };
  }

  // --------------------------------------------------
  // STALE
  // --------------------------------------------------

  return {
    freshness: "stale",

    isUsable: false,
    isLive: false,
    isRecent: false,
    isStale: true,

    ageMinutes:
      normalizedAgeMinutes,

    observedAt:
      observedDate.toISOString(),

    reason:
      `Observation is older than ${maxAgeMinutes} minutes`,
  };
}

/**
 * Check whether a measurement
 * can be used.
 */
function isFreshMeasurement(
  measurement,
  options = {}
) {
  if (!measurement) {
    return false;
  }

  const result =
    classifyFreshness(
      measurement.observedAt,
      options
    );

  return result.isUsable;
}

/**
 * Add freshness information
 * to a measurement.
 */
function enrichMeasurementFreshness(
  measurement,
  options = {}
) {
  const freshness =
    classifyFreshness(
      measurement?.observedAt,
      options
    );

  return {
    ...measurement,

    freshness:
      freshness.freshness,

    isUsable:
      freshness.isUsable,

    isLive:
      freshness.isLive,

    isRecent:
      freshness.isRecent,

    isStale:
      freshness.isStale,

    ageMinutes:
      freshness.ageMinutes,

    observedAt:
      freshness.observedAt,

    freshnessReason:
      freshness.reason,
  };
}

/**
 * Return only usable measurements.
 */
function filterFreshMeasurements(
  measurements,
  options = {}
) {
  if (
    !Array.isArray(
      measurements
    )
  ) {
    return [];
  }

  return measurements
    .map(
      (measurement) =>
        enrichMeasurementFreshness(
          measurement,
          options
        )
    )
    .filter(
      (measurement) =>
        measurement.isUsable
    );
}

/**
 * Return only LIVE measurements.
 */
function filterLiveMeasurements(
  measurements,
  options = {}
) {
  if (
    !Array.isArray(
      measurements
    )
  ) {
    return [];
  }

  return measurements
    .map(
      (measurement) =>
        enrichMeasurementFreshness(
          measurement,
          options
        )
    )
    .filter(
      (measurement) =>
        measurement.isLive
    );
}

/**
 * Create freshness summary.
 */
function summarizeFreshness(
  measurements,
  options = {}
) {
  if (
    !Array.isArray(
      measurements
    )
  ) {
    return {
      total: 0,
      live: 0,
      recent: 0,
      stale: 0,
      invalid: 0,
      usable: 0,
    };
  }

  const enriched =
    measurements.map(
      (measurement) =>
        enrichMeasurementFreshness(
          measurement,
          options
        )
    );

  return {
    total: enriched.length,

    live: enriched.filter(
      (item) =>
        item.isLive
    ).length,

    recent: enriched.filter(
      (item) =>
        item.isRecent &&
        !item.isLive
    ).length,

    stale: enriched.filter(
      (item) =>
        item.isStale
    ).length,

    invalid: enriched.filter(
      (item) =>
        item.freshness ===
        "invalid"
    ).length,

    usable: enriched.filter(
      (item) =>
        item.isUsable
    ).length,
  };
}

module.exports = {
  parseObservationTime,
  getObservationAgeMinutes,
  classifyFreshness,
  isFreshMeasurement,
  enrichMeasurementFreshness,
  filterFreshMeasurements,
  filterLiveMeasurements,
  summarizeFreshness,
};