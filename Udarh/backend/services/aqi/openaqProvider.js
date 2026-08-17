"use strict";

// ============================================================
// AIRROUTE - OPENAQ PRIMARY AQI PROVIDER
// ============================================================
//
// PRIMARY  : OpenAQ
// FALLBACK : WAQI
//
// IMPORTANT:
// - Uses OpenAQ /locations for station discovery.
// - Uses OpenAQ /locations/:id/latest for latest readings.
// - Uses sensor metadata when available.
// - ALSO accepts parameter/unit information directly from
//   the latest measurement response.
// - Does not repeatedly call /sensors/:id.
// - Never fabricates AQI.
// - Freshness is handled robustly for OpenAQ UTC/local datetime.
// ============================================================

const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

// ============================================================
// INTERNAL MODULES
// ============================================================

const {
  openaqRequest: managedOpenAqRequest,
} = require("./openaqRequest");

const {
  calculateUsEpaAqi,
  getAqiCategory,
} = require("./usEpaAqi");

// ============================================================
// CONFIG
// ============================================================

function cleanBaseUrl(value, fallback) {
  if (!value) {
    return fallback;
  }

  let url = String(value).trim();

  const markdownMatch = url.match(
    /^\[https?:\/\/[^\]]+\]\((https?:\/\/[^)]+)\)$/
  );

  if (markdownMatch) {
    url = markdownMatch[1];
  }

  return url.replace(/\/+$/, "");
}

const OPENAQ_BASE_URL = cleanBaseUrl(
  process.env.OPENAQ_BASE_URL,
  "https://api.openaq.org/v3"
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

const MAX_STATION_AGE_MINUTES = Math.max(
  Number(
    process.env.AQI_MAX_STATION_AGE_MINUTES || 180
  ),
  30
);

const LIVE_MAX_AGE_MINUTES = Math.max(
  Number(
    process.env.AQI_LIVE_MAX_AGE_MINUTES || 60
  ),
  5
);

const MIN_NEARBY_STATIONS = Math.max(
  Number(
    process.env.AQI_MIN_NEARBY_STATIONS || 2
  ),
  1
);

const MAX_NEARBY_STATIONS = Math.max(
  Number(
    process.env.AQI_MAX_NEARBY_STATIONS || 5
  ),
  MIN_NEARBY_STATIONS
);

const MAX_CANDIDATE_STATIONS = Math.max(
  MAX_NEARBY_STATIONS * 2,
  10
);

const OPENAQ_LATEST_LIMIT = Math.min(
  Math.max(
    Number(
      process.env.OPENAQ_LATEST_LIMIT || 100
    ),
    1
  ),
  100
);

const OPENAQ_VERBOSE =
  String(
    process.env.OPENAQ_VERBOSE || "false"
  ).toLowerCase() === "true";

// ============================================================
// SUPPORTED POLLUTANTS
// ============================================================

const SUPPORTED_POLLUTANTS = [
  "pm25",
  "pm10",
  "o3",
  "co",
  "so2",
  "no2",
];

// ============================================================
// API KEY
// ============================================================

function hasOpenAqApiKey() {
  return Boolean(
    process.env.OPENAQ_API_KEY &&
      String(
        process.env.OPENAQ_API_KEY
      ).trim()
  );
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
// OPENAQ REQUEST
// ============================================================

async function openaqRequest(
  endpoint,
  params = {}
) {
  const url = new URL(
    `${OPENAQ_BASE_URL}${endpoint}`
  );

  Object.entries(params).forEach(
    ([key, value]) => {
      if (
        value !== undefined &&
        value !== null
      ) {
        url.searchParams.set(
          key,
          String(value)
        );
      }
    }
  );

  return managedOpenAqRequest(
    url.toString(),
    {
      method: "GET",
      cacheKey: url.toString(),
      useCache: true,
    }
  );
}

// ============================================================
// ERROR LOGGER
// ============================================================

function logOpenAqError(
  error,
  endpoint,
  params = {}
) {
  console.error(
    "[OpenAQ API ERROR]",
    {
      endpoint,
      params,

      status:
        error?.response?.status ||
        error?.status ||
        null,

      data:
        error?.response?.data ||
        error?.data ||
        error?.message ||
        null,
    }
  );
}

// ============================================================
// DISTANCE
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

  const dLat = toRadians(
    lat2 - lat1
  );

  const dLng = toRadians(
    lng2 - lng1
  );

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(
      toRadians(lat1)
    ) *
      Math.cos(
        toRadians(lat2)
      ) *
      Math.sin(dLng / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

// ============================================================
// PARAMETER NORMALIZATION
// ============================================================

function normalizeParameter(
  parameter
) {
  if (!parameter) {
    return null;
  }

  const original = String(
    parameter
  )
    .toLowerCase()
    .trim();

  const normalized = original
    .replace(/[\s_-]/g, "")
    .replace(/\./g, "");

 const aliases = {
  pm25: "pm25",
  pm2_5: "pm25",
  "pm2.5": "pm25",
    pm10: "pm10",

    no2: "no2",
    nitrogendioxide: "no2",

    so2: "so2",
    sulfurdioxide: "so2",
    sulphurdioxide: "so2",

    o3: "o3",
    ozone: "o3",

    co: "co",
    carbonmonoxide: "co",

    nh3: "nh3",
    ammonia: "nh3",

    pb: "pb",
    lead: "pb",
  };

  return (
    aliases[normalized] ||
    aliases[original] ||
    null
  );
}

const normalizeParameterName =
  normalizeParameter;

// ============================================================
// UNIT NORMALIZATION
// ============================================================

function normalizeUnit(unit) {
  if (!unit) {
    return null;
  }

  const normalized = String(unit)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/³/g, "3");

  if (
    normalized === "µg/m3" ||
    normalized === "μg/m3" ||
    normalized === "ug/m3" ||
    normalized === "µg/m^3" ||
    normalized === "μg/m^3" ||
    normalized === "ug/m^3"
  ) {
    return "ug/m3";
  }

  if (
    normalized === "mg/m3" ||
    normalized === "mg/m^3"
  ) {
    return "mg/m3";
  }

  if (
    normalized === "ppb" ||
    normalized === "partsperbillion"
  ) {
    return "ppb";
  }

  if (
    normalized === "ppm" ||
    normalized === "partspermillion"
  ) {
    return "ppm";
  }

  return normalized;
}

// ============================================================
// CANONICAL UNIT
// ============================================================

function convertToCanonicalUnit(
  parameter,
  value,
  unit
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }

  const normalizedUnit =
    normalizeUnit(unit);

  // ----------------------------------------------------------
  // PM2.5 / PM10
  // ----------------------------------------------------------

  if (
    parameter === "pm25" ||
    parameter === "pm10"
  ) {
    if (
      normalizedUnit === "ug/m3"
    ) {
      return {
        value: numericValue,
        unit: "µg/m³",
        converted: false,
      };
    }

    // Some providers may expose PM values as mg/m3.
    if (
      normalizedUnit === "mg/m3"
    ) {
      return {
        value:
          numericValue * 1000,
        unit: "µg/m³",
        converted: true,
      };
    }

    return null;
  }

  // ----------------------------------------------------------
  // GASES
  // ----------------------------------------------------------

  if (
    normalizedUnit === "ug/m3"
  ) {
    return {
      value: numericValue,
      unit: "µg/m³",
      converted: false,
    };
  }

  if (
    parameter === "co" &&
    normalizedUnit === "mg/m3"
  ) {
    return {
      value: numericValue,
      unit: "mg/m³",
      converted: false,
    };
  }

  // Keep ppm/ppb available for downstream AQI logic.
  if (
    normalizedUnit === "ppm" ||
    normalizedUnit === "ppb"
  ) {
    return {
      value: numericValue,
      unit: normalizedUnit,
      converted: false,
    };
  }

  return null;
}

// ============================================================
// STATION PRIORITY
// ============================================================

function getStationPriority(
  station
) {
  const text = [
    station?.name,
    station?.provider,
    station?.owner,
    station?.raw?.owner?.name,
    station?.raw?.provider?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    text.includes("cpcb") ||
    text.includes(
      "central pollution control"
    )
  ) {
    return 100;
  }

  if (
    text.includes("dpcc") ||
    text.includes(
      "delhi pollution control"
    )
  ) {
    return 95;
  }

  if (
    text.includes(
      "pollution control"
    )
  ) {
    return 85;
  }

  if (
    text.includes("government")
  ) {
    return 80;
  }

  if (station?.isMonitor) {
    return 50;
  }

  return 10;
}

// ============================================================
// NORMALIZE STATION
// ============================================================

function normalizeStation(
  station
) {
  const latitude =
    Number(
      station?.coordinates?.latitude
    );

  const longitude =
    Number(
      station?.coordinates?.longitude
    );

  const owner =
    station?.owner?.name ||
    null;

  const provider =
    station?.provider?.name ||
    station?.provider ||
    null;

  return {
    id: station?.id,

    name:
      station?.name ||
      "Unknown station",

    locality:
      station?.locality ||
      null,

    country:
      station?.country ||
      null,

    timezone:
      station?.timezone ||
      null,

    owner,
    provider,

    coordinates: {
      lat: latitude,
      lng: longitude,
    },

    isMobile:
      Boolean(
        station?.isMobile
      ),

    isMonitor:
      Boolean(
        station?.isMonitor
      ),

    sensors:
      Array.isArray(
        station?.sensors
      )
        ? station.sensors
        : [],

    priority:
      getStationPriority({
        ...station,
        owner,
        provider,
      }),

    raw: station,
  };
}

const normalizeOpenAqStation =
  normalizeStation;

// ============================================================
// DEDUPLICATE STATIONS
// ============================================================

function deduplicateStations(
  stations,
  duplicateDistanceMeters = 100
) {
  const unique = [];

  for (
    const station of stations
  ) {
    const duplicate =
      unique.find(
        (existing) =>
          calculateDistanceMeters(
            existing.coordinates.lat,
            existing.coordinates.lng,
            station.coordinates.lat,
            station.coordinates.lng
          ) <=
          duplicateDistanceMeters
      );

    if (!duplicate) {
      unique.push(station);
      continue;
    }

    if (
      station.priority >
      duplicate.priority
    ) {
      const index =
        unique.indexOf(
          duplicate
        );

      unique[index] =
        station;
    }
  }

  return unique;
}

// ============================================================
// FIND NEARBY STATIONS
// ============================================================

async function findNearbyStations(
  lat,
  lng,
  radiusMeters =
    DEFAULT_RADIUS_METERS
) {
  const point =
    validateCoordinates(
      lat,
      lng
    );

  const radius = Math.min(
    Math.max(
      Number(radiusMeters) ||
        DEFAULT_RADIUS_METERS,
      1000
    ),
    25000
  );

  if (!hasOpenAqApiKey()) {
    console.error(
      "[OpenAQ] OPENAQ_API_KEY is missing."
    );

    return [];
  }

  let data;

  try {
    data =
      await openaqRequest(
        "/locations",
        {
          coordinates:
            `${point.lat},${point.lng}`,

          radius,

          limit: 100,

          page: 1,
        }
      );
  } catch (error) {
    logOpenAqError(
      error,
      "/locations",
      {
        coordinates:
          `${point.lat},${point.lng}`,
        radius,
        limit: 100,
        page: 1,
      }
    );

    return [];
  }

  const locations =
    Array.isArray(
      data?.results
    )
      ? data.results
      : [];

  const stations =
    locations
      .map(
        normalizeStation
      )
      .filter(
        (station) =>
          !station.isMobile &&
          Number.isFinite(
            station.coordinates.lat
          ) &&
          Number.isFinite(
            station.coordinates.lng
          )
      )
      .map(
        (station) => ({
          ...station,

          distanceMeters:
            calculateDistanceMeters(
              point.lat,
              point.lng,
              station.coordinates.lat,
              station.coordinates.lng
            ),
        })
      );

  const deduplicated =
    deduplicateStations(
      stations
    );

  return deduplicated
    .sort(
      (a, b) => {
        if (
          b.priority !==
          a.priority
        ) {
          return (
            b.priority -
            a.priority
          );
        }

        return (
          a.distanceMeters -
          b.distanceMeters
        );
      }
    )
    .slice(
      0,
      MAX_CANDIDATE_STATIONS
    );
}

// ============================================================
// GET STATION
// ============================================================

async function getStation(
  stationId
) {
  if (!stationId) {
    throw new Error(
      "stationId is required"
    );
  }

  const data =
    await openaqRequest(
      `/locations/${stationId}`
    );

  const station =
    Array.isArray(
      data?.results
    )
      ? data.results[0]
      : data;

  if (!station) {
    throw new Error(
      `OpenAQ station ${stationId} was not found`
    );
  }

  return normalizeStation(
    station
  );
}

// ============================================================
// GET SENSOR
// ============================================================

async function getSensor(
  sensorId
) {
  if (!sensorId) {
    return null;
  }

  try {
    const data =
      await openaqRequest(
        `/sensors/${sensorId}`
      );

    const sensor =
      Array.isArray(
        data?.results
      )
        ? data.results[0]
        : data;

    return sensor || null;
  } catch (error) {
    logOpenAqError(
      error,
      `/sensors/${sensorId}`
    );

    return null;
  }
}

// ============================================================
// SENSOR PARAMETER
// ============================================================

function getSensorParameter(
  sensor
) {
  return normalizeParameter(
    sensor?.parameter?.name ||
      sensor?.parameter?.displayName
  );
}

// ============================================================
// OBSERVATION TIME
// ============================================================

function getObservationTime(
  measurement
) {
  if (!measurement) {
    return null;
  }

  // ----------------------------------------------------------
  // Direct observedAt
  // ----------------------------------------------------------

  if (
    typeof measurement.observedAt ===
      "string" &&
    measurement.observedAt.trim()
  ) {
    return measurement.observedAt;
  }

  // ----------------------------------------------------------
  // OpenAQ datetime object
  // ----------------------------------------------------------

  const datetime =
    measurement?.datetime;

  if (datetime) {
    if (
      typeof datetime ===
      "string"
    ) {
      return datetime;
    }

    if (
      typeof datetime ===
      "object"
    ) {
      if (
        datetime.utc
      ) {
        return datetime.utc;
      }

      if (
        datetime.local
      ) {
        return datetime.local;
      }
    }
  }

  // ----------------------------------------------------------
  // Aggregated/alternate payload compatibility
  // ----------------------------------------------------------

  const period =
    measurement?.period;

  if (
    period?.datetimeTo
  ) {
    if (
      period.datetimeTo.utc
    ) {
      return period.datetimeTo.utc;
    }

    if (
      period.datetimeTo.local
    ) {
      return period.datetimeTo.local;
    }
  }

  if (
    period?.datetimeFrom
  ) {
    if (
      period.datetimeFrom.utc
    ) {
      return period.datetimeFrom.utc;
    }

    if (
      period.datetimeFrom.local
    ) {
      return period.datetimeFrom.local;
    }
  }

  return null;
}

// ============================================================
// NORMALIZE RAW MEASUREMENT
// ============================================================

function normalizeMeasurement(
  measurement
) {
  if (!measurement) {
    return null;
  }

  const parameter =
    normalizeParameter(
      measurement?.parameter?.name ||
        measurement?.parameter?.displayName ||
        measurement?.parameter
    );

  const value =
    Number(
      measurement?.value
    );

  if (
    !parameter ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const unit =
    measurement?.parameter?.units ||
    measurement?.unit ||
    null;

  return {
    id:
      measurement?.id ||
      null,

    locationId:
      measurement?.locationsId ||
      measurement?.locationId ||
      null,

    sensorId:
      measurement?.sensorsId ||
      measurement?.sensorId ||
      null,

    parameter,

    rawParameter:
      measurement?.parameter?.name ||
      measurement?.parameter?.displayName ||
      measurement?.parameter ||
      null,

    value,

    unit,

    observedAt:
      getObservationTime(
        measurement
      ),

    coordinates:
      measurement?.coordinates ||
      null,

    raw: measurement,
  };
}

const normalizeOpenAqMeasurement =
  normalizeMeasurement;

// ============================================================
// NORMALIZE SENSOR LATEST
// ============================================================

function normalizeSensorLatest(
  sensor
) {
  if (!sensor) {
    return null;
  }

  const parameter =
    getSensorParameter(
      sensor
    );

  const latest =
    sensor?.latest;

  if (
    !parameter ||
    !latest
  ) {
    return null;
  }

  const value =
    Number(
      latest?.value
    );

  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  return {
    sensorId:
      sensor.id,

    parameter,

    rawParameter:
      sensor?.parameter?.name ||
      sensor?.parameter?.displayName ||
      null,

    value,

    unit:
      sensor?.parameter?.units ||
      null,

    observedAt:
      getObservationTime(
        latest
      ),

    raw: sensor,
  };
}

// ============================================================
// GET SENSOR LATEST
// ============================================================

async function getSensorLatest(
  sensorOrId
) {
  if (
    sensorOrId &&
    typeof sensorOrId ===
      "object" &&
    sensorOrId.latest
  ) {
    return normalizeSensorLatest(
      sensorOrId
    );
  }

  const sensorId =
    typeof sensorOrId ===
    "object"
      ? sensorOrId?.id
      : sensorOrId;

  if (!sensorId) {
    return null;
  }

  const sensor =
    await getSensor(
      sensorId
    );

  return normalizeSensorLatest(
    sensor
  );
}

// ============================================================
// FETCH LOCATION LATEST
// ============================================================

async function fetchLocationLatest(
  locationId,
  options = {}
) {
  const id =
    Number(locationId);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return [];
  }

  const limit =
    Math.min(
      Math.max(
        Number(
          options.limit ||
            OPENAQ_LATEST_LIMIT
        ),
        1
      ),
      100
    );

  try {
    const data =
      await openaqRequest(
        `/locations/${id}/latest`,
        {
          limit,
          page: 1,
        }
      );

    return Array.isArray(
      data?.results
    )
      ? data.results
      : [];
  } catch (error) {
    logOpenAqError(
      error,
      `/locations/${id}/latest`,
      {
        limit,
        page: 1,
      }
    );

    return [];
  }
}

// ============================================================
// GET LATEST MEASUREMENTS
// ============================================================
//
// IMPORTANT FIX:
//
// We no longer depend ONLY on:
//
// station.sensors[].parameter
//
// The latest OpenAQ measurement itself can contain:
//
// measurement.parameter.name
// measurement.parameter.units
//
// We use sensor metadata first and measurement metadata
// second.
// ============================================================

async function getLatestMeasurements(
  stationOrId
) {
  let station = null;

  if (
    stationOrId &&
    typeof stationOrId ===
      "object"
  ) {
    station =
      stationOrId;
  } else {
    station =
      await getStation(
        stationOrId
      );
  }

  if (!station) {
    return [];
  }

  const stationId =
    station.id;

  if (!stationId) {
    return [];
  }

  const sensors =
    Array.isArray(
      station.sensors
    )
      ? station.sensors
      : [];

  // ----------------------------------------------------------
  // SENSOR MAP
  // ----------------------------------------------------------

  const sensorMap =
    new Map();

  for (
    const sensor of sensors
  ) {
    const sensorId =
      Number(
        sensor?.id
      );

    if (
      !Number.isFinite(
        sensorId
      )
    ) {
      continue;
    }

    const parameter =
      getSensorParameter(
        sensor
      );

    const unit =
      sensor?.parameter?.units ||
      null;

    sensorMap.set(
      sensorId,
      {
        parameter,
        unit,
        sensor,
      }
    );
  }

  // ----------------------------------------------------------
  // ONE LATEST REQUEST
  // ----------------------------------------------------------

  const latest =
    await fetchLocationLatest(
      stationId,
      {
        limit:
          OPENAQ_LATEST_LIMIT,
      }
    );

  // ----------------------------------------------------------
  // DEBUG
  // ----------------------------------------------------------

  if (
    OPENAQ_VERBOSE
  ) {
    console.log(
      `[OpenAQ] Station ${stationId} latest measurements: ${latest.length}`
    );

    if (
      latest.length
    ) {
      console.dir(
        latest.slice(
          0,
          5
        ),
        {
          depth: 5,
        }
      );
    }
  }

  // ----------------------------------------------------------
  // JOIN
  // ----------------------------------------------------------

  const mapped = [];

  for (
    const measurement of latest
  ) {
    const sensorId =
      Number(
        measurement?.sensorsId ??
          measurement?.sensorId
      );

    const sensorMetadata =
      Number.isFinite(
        sensorId
      )
        ? sensorMap.get(
            sensorId
          )
        : null;

    // --------------------------------------------------------
    // PARAMETER
    // --------------------------------------------------------

    const directParameter =
      normalizeParameter(
        measurement?.parameter?.name ||
          measurement?.parameter?.displayName ||
          measurement?.parameter
      );

    const parameter =
      directParameter ||
      sensorMetadata?.parameter ||
      null;

    if (!parameter) {
      continue;
    }

    // --------------------------------------------------------
    // UNIT
    // --------------------------------------------------------

    const directUnit =
      measurement?.parameter
        ?.units ||
      measurement?.unit ||
      null;

    const unit =
      directUnit ||
      sensorMetadata?.unit ||
      null;

    // --------------------------------------------------------
    // VALUE
    // --------------------------------------------------------

    const value =
      Number(
        measurement?.value
      );

    if (
      !Number.isFinite(value)
    ) {
      continue;
    }

    mapped.push({
      ...measurement,

      sensorId:
        Number.isFinite(
          sensorId
        )
          ? sensorId
          : null,

      locationId:
        measurement?.locationsId ||
        measurement?.locationId ||
        stationId,

      parameter,

      unit,

      observedAt:
        getObservationTime(
          measurement
        ),
    });
  }

  return mapped;
}

// ============================================================
// FETCH STATION MEASUREMENTS
// ============================================================

async function fetchStationMeasurements(
  station,
  options = {}
) {
  if (!station) {
    return [];
  }

  return fetchLocationLatest(
    station.id ??
      station.locationId,
    options
  );
}

// ============================================================
// FRESHNESS
// ============================================================

function getMeasurementFreshness(
  measurement
) {
  const observedAt =
    getObservationTime(
      measurement
    );

  if (!observedAt) {
    return {
      observedAt: null,

      ageMinutes: Infinity,

      freshness: "unknown",

      isLive: false,

      isRecent: false,

      isStale: true,

      isUsable: false,
    };
  }

  let timestamp =
    Date.parse(
      observedAt
    );

  // ----------------------------------------------------------
  // Some APIs may return timezone-less local timestamps.
  //
  // Treat timezone-less ISO datetime as UTC rather than
  // allowing Node's local timezone to create an incorrect age.
  // ----------------------------------------------------------

  if (
    !Number.isFinite(timestamp) &&
    typeof observedAt ===
      "string"
  ) {
    const normalized =
      observedAt.match(
        /Z$/i
      ) ||
      /[+-]\d{2}:\d{2}$/.test(
        observedAt
      )
        ? observedAt
        : `${observedAt}Z`;

    timestamp =
      Date.parse(
        normalized
      );
  }

  if (
    !Number.isFinite(timestamp)
  ) {
    return {
      observedAt,

      ageMinutes: Infinity,

      freshness: "invalid",

      isLive: false,

      isRecent: false,

      isStale: true,

      isUsable: false,
    };
  }

  const ageMinutes =
    Math.max(
      0,
      (Date.now() -
        timestamp) /
        60000
    );

  const isLive =
    ageMinutes <=
    LIVE_MAX_AGE_MINUTES;

  const isRecent =
    ageMinutes <=
    MAX_STATION_AGE_MINUTES;

  return {
    observedAt,

    ageMinutes,

    freshness:
      isLive
        ? "live"
        : isRecent
        ? "recent"
        : "stale",

    isLive,

    isRecent,

    isStale:
      !isRecent,

    isUsable:
      isRecent,
  };
}

// ============================================================
// NORMALIZE + VALIDATE MEASUREMENT
// ============================================================

function normalizeAndValidateMeasurement(
  measurement
) {
  if (!measurement) {
    return null;
  }

  // ----------------------------------------------------------
  // Normalize parameter from direct or nested payload.
  // ----------------------------------------------------------

  const parameter =
    normalizeParameter(
      measurement?.parameter?.name ||
        measurement?.parameter?.displayName ||
        measurement?.parameter
    );

  if (!parameter) {
    return null;
  }

  if (
    !SUPPORTED_POLLUTANTS.includes(
      parameter
    )
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // Freshness
  // ----------------------------------------------------------

  const freshness =
    getMeasurementFreshness(
      measurement
    );

  if (
    !freshness.isUsable
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // Unit
  // ----------------------------------------------------------

  const unit =
    measurement?.parameter
      ?.units ||
    measurement?.unit ||
    null;

  // ----------------------------------------------------------
  // Convert
  // ----------------------------------------------------------

  const converted =
    convertToCanonicalUnit(
      parameter,

      measurement.value,

      unit
    );

  if (!converted) {
    return null;
  }

  return {
    id:
      measurement.id ||
      null,

    locationId:
      measurement.locationId ||
      measurement.locationsId ||
      null,

    sensorId:
      measurement.sensorId ||
      measurement.sensorsId ||
      null,

    parameter,

    value:
      converted.value,

    unit:
      converted.unit,

    originalValue:
      measurement.value,

    originalUnit:
      unit,

    observedAt:
      freshness.observedAt,

    ageMinutes:
      freshness.ageMinutes,

    freshness:
      freshness.freshness,

    isLive:
      freshness.isLive,

    isRecent:
      freshness.isRecent,

    isStale:
      freshness.isStale,

    isUsable:
      freshness.isUsable,

    source:
      "openaq",

    raw:
      measurement,
  };
}

const enrichOpenAqMeasurement =
  normalizeAndValidateMeasurement;

// ============================================================
// SELECT BEST MEASUREMENTS
// ============================================================

function selectBestMeasurements(
  measurements
) {
  const selected = {};

  for (
    const measurement of
      measurements || []
  ) {
    const normalized =
      normalizeAndValidateMeasurement(
        measurement
      );

    if (!normalized) {
      continue;
    }

    const key =
      normalized.parameter;

    const existing =
      selected[key];

    if (!existing) {
      selected[key] =
        normalized;

      continue;
    }

    // Live beats recent.
    if (
      normalized.isLive &&
      !existing.isLive
    ) {
      selected[key] =
        normalized;

      continue;
    }

    // Newer beats older.
    if (
      normalized.ageMinutes <
      existing.ageMinutes
    ) {
      selected[key] =
        normalized;
    }
  }

  return selected;
}

// ============================================================
// POLLUTANT SNAPSHOT
// ============================================================

function buildPollutantSnapshot(
  measurements
) {
  return selectBestMeasurements(
    measurements
  );
}

// ============================================================
// STATION FRESHNESS
// ============================================================

function getStationFreshness(
  stationData
) {
  const measurements =
    Array.isArray(
      stationData?.measurements
    )
      ? stationData.measurements
      : [];

  const live =
    measurements.filter(
      (item) =>
        item.isLive
    );

  const recent =
    measurements.filter(
      (item) =>
        item.isRecent
    );

  const stale =
    measurements.filter(
      (item) =>
        item.isStale
    );

  if (
    live.length > 0
  ) {
    return {
      freshness: "live",

      isLive: true,

      isRecent: true,

      isStale: false,

      liveCount:
        live.length,

      recentCount:
        recent.length,

      ageMinutes:
        Math.min(
          ...live.map(
            (item) =>
              Number(
                item.ageMinutes
              )
          )
        ),
    };
  }

  if (
    recent.length > 0
  ) {
    return {
      freshness: "recent",

      isLive: false,

      isRecent: true,

      isStale: false,

      liveCount: 0,

      recentCount:
        recent.length,

      ageMinutes:
        Math.min(
          ...recent.map(
            (item) =>
              Number(
                item.ageMinutes
              )
          )
        ),
    };
  }

  if (
    stale.length > 0
  ) {
    const staleAges =
      stale
        .map(
          (item) =>
            Number(
              item.ageMinutes
            )
        )
        .filter(
          Number.isFinite
        );

    return {
      freshness: "stale",

      isLive: false,

      isRecent: false,

      isStale: true,

      liveCount: 0,

      recentCount: 0,

      ageMinutes:
        staleAges.length
          ? Math.min(
              ...staleAges
            )
          : null,
    };
  }

  return {
    freshness: "none",

    isLive: false,

    isRecent: false,

    isStale: false,

    liveCount: 0,

    recentCount: 0,

    ageMinutes: null,
  };
}

// ============================================================
// DATA QUALITY
// ============================================================

function calculateStationDataQuality(
  pollutants
) {
  const corePollutants = [
    "pm25",
    "pm10",
  ];

  const supportingPollutants = [
    "no2",
    "so2",
    "o3",
    "co",
  ];

  const coreCount =
    corePollutants.filter(
      (key) =>
        Boolean(
          pollutants?.[key]
        )
    ).length;

  const supportingCount =
    supportingPollutants.filter(
      (key) =>
        Boolean(
          pollutants?.[key]
        )
    ).length;

  return {
    corePollutants:
      coreCount,

    supportingPollutants:
      supportingCount,

    score:
      coreCount * 20 +
      supportingCount * 5,
  };
}

// ============================================================
// COMPLETE STATION DATA
// ============================================================

async function getStationData(
  station
) {
  const rawMeasurements =
    await getLatestMeasurements(
      station
    );

  // ----------------------------------------------------------
  // DIAGNOSTIC
  // ----------------------------------------------------------

  if (
    OPENAQ_VERBOSE
  ) {
    console.log(
      `[OpenAQ] ${station.name} raw usable candidates: ${rawMeasurements.length}`
    );
  }

  const allFresh =
    rawMeasurements
      .map(
        normalizeAndValidateMeasurement
      )
      .filter(Boolean);

  const selected =
    selectBestMeasurements(
      rawMeasurements
    );

  const liveMeasurements =
    allFresh.filter(
      (measurement) =>
        measurement.isLive
    );

  const recentMeasurements =
    allFresh.filter(
      (measurement) =>
        measurement.isRecent
    );

  return {
    station,

    rawMeasurements,

    measurements:
      allFresh,

    liveMeasurements,

    recentMeasurements,

    pollutants:
      selected,

    measurementCount:
      rawMeasurements.length,

    usableMeasurementCount:
      allFresh.length,

    liveMeasurementCount:
      liveMeasurements.length,

    selectedPollutantCount:
      Object.keys(
        selected
      ).length,

    hasUsableData:
      allFresh.length > 0,

    hasLiveData:
      liveMeasurements.length >
      0,

    hasCompleteCoreData:
      Boolean(
        selected.pm25 &&
        selected.pm10
      ),
  };
}

// ============================================================
// STATION US EPA AQI
// ============================================================

function calculateStationUsEpaAqi(
  stationData
) {
  const selected =
    stationData?.pollutants ||
    selectBestMeasurements(
      stationData?.rawMeasurements ||
        []
    );

  if (
    !selected ||
    Object.keys(
      selected
    ).length === 0
  ) {
    return null;
  }

  const pollutants = {
    pm25:
      selected.pm25?.value ??
      null,

    pm10:
      selected.pm10?.value ??
      null,

    o3:
      selected.o3?.value ??
      null,

    co:
      selected.co?.value ??
      null,

    so2:
      selected.so2?.value ??
      null,

    no2:
      selected.no2?.value ??
      null,
  };

  const coUnit =
    selected.co?.unit;

  let result;

  try {
    result =
      calculateUsEpaAqi(
        pollutants,
        {
          coUnit:
            coUnit === "mg/m³"
              ? "mg/m3"
              : undefined,

          averagingPeriod:
            "current-observation",
        }
      );
  } catch (error) {
    console.error(
      "[OpenAQ] AQI calculation error:",
      error.message
    );

    return null;
  }

  if (
    !result ||
    !Number.isFinite(
      Number(result.aqi)
    )
  ) {
    return null;
  }

  return {
    ...result,

    aqi:
      Math.round(
        Number(
          result.aqi
        )
      ),

    source:
      "openaq",

    provider:
      "openaq",

    standard:
      "US_EPA_ESTIMATE",

    estimate: true,

    warning:
      result.warning ||
      "OpenAQ current pollutant observations mapped to U.S. EPA AQI breakpoints.",

    pollutantsRaw:
      selected,
  };
}

const calculateStationAqi =
  calculateStationUsEpaAqi;

// ============================================================
// AQI BAND
// ============================================================

function getAqiBand(
  aqi
) {
  if (
    !Number.isFinite(
      Number(aqi)
    )
  ) {
    return null;
  }

  return getAqiCategory(
    Number(aqi)
  );
}

// ============================================================
// STATION RANKING
// ============================================================

function stationRankingScore(
  stationData
) {
  const station =
    stationData?.station ||
    {};

  const distance =
    Number(
      station.distanceMeters
    );

  const quality =
    Number(
      stationData?.dataQuality
        ?.score || 0
    );

  const liveCount =
    Number(
      stationData?.liveMeasurementCount ||
        0
    );

  const freshness =
    getStationFreshness(
      stationData
    );

  let freshnessScore = 0;

  if (
    freshness.freshness ===
    "live"
  ) {
    freshnessScore =
      50000;
  } else if (
    freshness.freshness ===
    "recent"
  ) {
    freshnessScore =
      20000;
  }

  const priorityScore =
    Number(
      station.priority || 0
    ) * 100;

  const distanceScore =
    Math.max(
      0,
      DEFAULT_RADIUS_METERS -
        distance
    );

  const liveScore =
    liveCount * 500;

  return (
    freshnessScore +
    priorityScore +
    quality +
    distanceScore +
    liveScore
  );
}

// ============================================================
// MAIN OPENAQ RESOLVER
// ============================================================

async function getNearbyStationData(
  lat,
  lng,
  radiusMeters =
    DEFAULT_RADIUS_METERS,
  options = {}
) {
  const point =
    validateCoordinates(
      lat,
      lng
    );

  const start =
    Date.now();

  console.log(
    "\n========== OPENAQ PRIMARY =========="
  );

  console.log(
    "[OpenAQ] AQI lookup center:",
    {
      lat: point.lat,
      lng: point.lng,
    }
  );

  if (!hasOpenAqApiKey()) {
    console.error(
      "[OpenAQ] OPENAQ_API_KEY is missing."
    );

    return [];
  }

  let candidates = [];

  try {
    candidates =
      await findNearbyStations(
        point.lat,
        point.lng,
        radiusMeters
      );
  } catch (error) {
    console.error(
      "[OpenAQ] Station discovery failed:",
      error.message
    );

    return [];
  }

  console.log(
    `[OpenAQ] Candidate stations: ${candidates.length}`
  );

  if (
    candidates.length ===
    0
  ) {
    console.log(
      `[OpenAQ] Completed in ${
        Date.now() - start
      }ms`
    );

    console.log(
      "[OpenAQ] Selected stations: 0"
    );

    console.log(
      "====================================\n"
    );

    return [];
  }

  const stationResults =
    [];

  // ----------------------------------------------------------
  // SEQUENTIAL PROCESSING
  // ----------------------------------------------------------

  for (
    const station of candidates
  ) {
    try {
      const data =
        await getStationData(
          station
        );

      // --------------------------------------------------------
      // IMPORTANT DIAGNOSTIC
      // --------------------------------------------------------

      if (
        OPENAQ_VERBOSE
      ) {
        console.log(
          `[OpenAQ DEBUG] ${station.name}`
        );

        console.log(
          "  Raw measurements:",
          data.measurementCount
        );

        console.log(
          "  Usable measurements:",
          data.usableMeasurementCount
        );

        console.log(
          "  Live measurements:",
          data.liveMeasurementCount
        );

        console.log(
          "  Pollutants:",
          Object.keys(
            data.pollutants
          )
        );
      }

      if (
        !data.hasUsableData
      ) {
        console.log(
          `[OpenAQ] ${station.name} → no current usable measurements`
        );

        continue;
      }

      const dataQuality =
        calculateStationDataQuality(
          data.pollutants
        );

      const freshness =
        getStationFreshness(
          data
        );

      const aqiResult =
        calculateStationUsEpaAqi(
          data
        );

      if (
        !aqiResult ||
        !Number.isFinite(
          Number(
            aqiResult.aqi
          )
        )
      ) {
        console.log(
          `[OpenAQ] ${station.name} → AQI calculation unavailable`
        );

        continue;
      }

      const rankingScore =
        stationRankingScore({
          ...data,
          dataQuality,
        });

      const result = {
        ...data,

        station,

        stationId:
          station.id,

        stationName:
          station.name,

        distanceMeters:
          station.distanceMeters,

        aqi:
          aqiResult.aqi,

        standard:
          "US_EPA_ESTIMATE",

        estimate: true,

        category:
          aqiResult.category ||
          getAqiBand(
            aqiResult.aqi
          ),

        band:
          aqiResult.category ||
          getAqiBand(
            aqiResult.aqi
          ),

        dominantPollutant:
          aqiResult.dominantPollutant ||
          null,

        subIndices:
          aqiResult.subIndices ||
          {},

        aqiDetails:
          aqiResult,

        confidence:
          aqiResult.confidence ||
          "low",

        averagingPeriod:
          aqiResult.averagingPeriod ||
          "current-observation",

        warning:
          aqiResult.warning,

        freshness:
          freshness.freshness,

        resolverFreshness:
          freshness,

        isLive:
          freshness.isLive,

        isRecent:
          freshness.isRecent,

        isStale:
          freshness.isStale,

        ageMinutes:
          freshness.ageMinutes,

        provider:
          "openaq",

        source:
          "openaq",

        fallback: false,

        fallbackUsed:
          false,

        dataQuality,

        rankingScore,

        dominant:
          aqiResult.dominantPollutant ||
          null,
      };

      stationResults.push(
        result
      );

      console.log(
        `[OpenAQ] ${station.name} | ` +
        `AQI=${result.aqi} | ` +
        `distance=${Math.round(
          station.distanceMeters
        )}m | ` +
        `freshness=${result.freshness} | ` +
        `live=${data.liveMeasurementCount} | ` +
        `usable=${data.usableMeasurementCount} | ` +
        `pollutants=${data.selectedPollutantCount}`
      );

      if (
        OPENAQ_VERBOSE
      ) {
        console.dir(
          result.pollutants,
          {
            depth: null,
          }
        );
      }
    } catch (error) {
      console.warn(
        `[OpenAQ] Station ${station.id} failed: ${error.message}`
      );
    }
  }

  // ----------------------------------------------------------
  // SORT
  // ----------------------------------------------------------

  stationResults.sort(
    (a, b) =>
      b.rankingScore -
      a.rankingScore
  );

  // ----------------------------------------------------------
  // CURRENT / RECENT ONLY
  // ----------------------------------------------------------

  const usableStations =
    stationResults.filter(
      (station) =>
        station.isLive ||
        station.isRecent
    );

  const selected =
    (
      usableStations.length >=
      MIN_NEARBY_STATIONS
        ? usableStations
        : stationResults
    ).slice(
      0,
      MAX_NEARBY_STATIONS
    );

  console.log(
    `[OpenAQ] Completed in ${
      Date.now() - start
    }ms`
  );

  console.log(
    `[OpenAQ] Selected stations: ${selected.length}`
  );

  for (
    const station of selected
  ) {
    console.log(
      `[OpenAQ] ${station.stationName} | ` +
      `AQI=${station.aqi} | ` +
      `distance=${Math.round(
        station.distanceMeters
      )}m | ` +
      `freshness=${station.freshness} | ` +
      `dominant=${
        station.dominantPollutant ||
        "unknown"
      }`
    );
  }

  console.log(
    "====================================\n"
  );

  return selected;
}

// ============================================================
// GET USABLE STATIONS
// ============================================================

async function getUsableStations(
  lat,
  lng,
  options = {}
) {
  return getNearbyStationData(
    lat,
    lng,

    options.radius ||
      options.radiusMeters ||
      DEFAULT_RADIUS_METERS,

    options
  );
}

// ============================================================
// ROUTE AQI
// ============================================================

async function getRouteAqi(
  latitude,
  longitude,
  options = {}
) {
  const stations =
    await getNearbyStationData(
      latitude,
      longitude,

      options.radius ||
        DEFAULT_RADIUS_METERS,

      options
    );

  if (
    stations.length ===
    0
  ) {
    return {
      provider:
        "openaq",

      standard:
        "US_EPA_ESTIMATE",

      stations: [],

      usableStations: [],

      stationCount: 0,

      aqi: null,

      peakAqi: null,

      avgAqi: null,

      weightedAqi: null,

      exposureBand: null,

      source:
        "openaq",

      fallback: false,
    };
  }

  const values =
    stations
      .map(
        (station) =>
          Number(
            station.aqi
          )
      )
      .filter(
        Number.isFinite
      );

  if (
    values.length ===
    0
  ) {
    return {
      provider:
        "openaq",

      standard:
        "US_EPA_ESTIMATE",

      stations,

      usableStations:
        stations,

      stationCount:
        stations.length,

      aqi: null,

      peakAqi: null,

      avgAqi: null,

      weightedAqi: null,

      exposureBand: null,

      source:
        "openaq",

      fallback: false,
    };
  }

  const peakAqi =
    Math.max(...values);

  const avgAqi =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length;

  // ----------------------------------------------------------
  // DISTANCE WEIGHTED AQI
  // ----------------------------------------------------------

  let weightedSum = 0;
  let weightSum = 0;

  for (
    const station of stations
  ) {
    const distance =
      Math.max(
        Number(
          station.distanceMeters
        ) || 0,
        100
      );

    const weight =
      1 / distance;

    weightedSum +=
      Number(
        station.aqi
      ) * weight;

    weightSum +=
      weight;
  }

  const weightedAqi =
    weightSum > 0
      ? weightedSum /
        weightSum
      : avgAqi;

  return {
    provider:
      "openaq",

    standard:
      "US_EPA_ESTIMATE",

    stations,

    usableStations:
      stations,

    stationCount:
      stations.length,

    aqi:
      Math.round(
        weightedAqi
      ),

    peakAqi:
      Math.round(
        peakAqi
      ),

    avgAqi:
      Math.round(
        avgAqi
      ),

    weightedAqi:
      Math.round(
        weightedAqi
      ),

    exposureBand:
      getAqiBand(
        weightedAqi
      ),

    dominantPollutant:
      stations[0]
        ?.dominantPollutant ||
      null,

    source:
      "openaq",

    fallback: false,
  };
}

// ============================================================
// OPENAQ STATION DATA
// ============================================================

async function getOpenAqStationData(
  stationId
) {
  const station =
    await getStation(
      stationId
    );

  if (!station) {
    return null;
  }

  const data =
    await getStationData(
      station
    );

  const aqi =
    calculateStationUsEpaAqi(
      data
    );

  return {
    ...data,

    aqi,

    provider:
      "openaq",

    standard:
      "US_EPA_ESTIMATE",
  };
}

// ============================================================
// FETCH OPENAQ LOCATIONS
// ============================================================

async function fetchOpenAqLocations(
  latitude,
  longitude,
  options = {}
) {
  const point =
    validateCoordinates(
      latitude,
      longitude
    );

  const radius =
    Math.min(
      Math.max(
        Number(
          options.radius ??
            DEFAULT_RADIUS_METERS
        ),
        1000
      ),
      25000
    );

  const limit =
    Math.min(
      Math.max(
        Number(
          options.limit ??
            25
        ),
        1
      ),
      100
    );

  const params = {
    coordinates:
      `${point.lat},${point.lng}`,

    radius,

    limit,

    page:
      Number(
        options.page || 1
      ),
  };

  try {
    const data =
      await openaqRequest(
        "/locations",
        params
      );

    return Array.isArray(
      data?.results
    )
      ? data.results
      : [];
  } catch (error) {
    logOpenAqError(
      error,
      "/locations",
      params
    );

    return [];
  }
}

// ============================================================
// RAW STATION MEASUREMENTS
// ============================================================

async function fetchStationMeasurementsRaw(
  stationId,
  options = {}
) {
  return fetchLocationLatest(
    stationId,
    options
  );
}

// ============================================================
// TEST
// ============================================================

async function testOpenAqDelhi() {
  const lat = 28.6139;
  const lng = 77.209;

  console.log(
    "\n============================================"
  );

  console.log(
    "       AIRROUTE OPENAQ TEST"
  );

  console.log(
    "============================================"
  );

  console.log(
    "Coordinate:",
    {
      lat,
      lng,
    }
  );

  console.log(
    "Radius:",
    DEFAULT_RADIUS_METERS,
    "meters"
  );

  console.log(
    "API key configured:",
    hasOpenAqApiKey()
  );

  const stations =
    await getNearbyStationData(
      lat,
      lng,
      DEFAULT_RADIUS_METERS
    );

  console.log(
    "\nSelected stations:",
    stations.length
  );

  for (
    const station of stations
  ) {
    console.log(
      "\n--------------------------------------------"
    );

    console.log(
      "Station:",
      station.stationName
    );

    console.log(
      "ID:",
      station.stationId
    );

    console.log(
      "Distance:",
      Math.round(
        station.distanceMeters
      ),
      "m"
    );

    console.log(
      "AQI:",
      station.aqi
    );

    console.log(
      "Standard:",
      station.standard
    );

    console.log(
      "Category:",
      station.category
    );

    console.log(
      "Dominant:",
      station.dominantPollutant
    );

    console.log(
      "Freshness:",
      station.freshness
    );

    console.log(
      "Age:",
      station.ageMinutes,
      "minutes"
    );

    console.log(
      "Live:",
      station.isLive
    );

    console.log(
      "Usable measurements:",
      station.usableMeasurementCount
    );

    console.log(
      "Selected pollutants:",
      station.selectedPollutantCount
    );

    console.dir(
      station.pollutants,
      {
        depth: null,
      }
    );
  }

  console.log(
    "\n============================================"
  );

  return stations;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Resolver
  getNearbyStationData,
  getUsableStations,

  // Main provider
  getRouteAqi,
  getOpenAqStationData,

  // HTTP/API
  fetchOpenAqLocations,
  fetchStationMeasurements:
    fetchStationMeasurementsRaw,
  fetchLocationLatest,

  // Station
  findNearbyStations,
  getStation,
  getSensor,
  getSensorLatest,
  getLatestMeasurements,
  getStationData,
  normalizeStation,
  normalizeOpenAqStation,
  getStationPriority,
  deduplicateStations,

  // Measurement
  normalizeMeasurement,
  normalizeOpenAqMeasurement,
  normalizeAndValidateMeasurement,
  enrichOpenAqMeasurement,
  normalizeSensorLatest,
  selectBestMeasurements,
  buildPollutantSnapshot,

  // AQI
  calculateStationAqi,
  calculateStationUsEpaAqi,
  getAqiBand,

  // Freshness / quality
  getMeasurementFreshness,
  getStationFreshness,
  calculateStationDataQuality,

  // Math
  calculateDistanceMeters,

  // Validation / normalization
  validateCoordinates,
  normalizeParameter,
  normalizeParameterName,
  normalizeUnit,
  convertToCanonicalUnit,

  // Test
  testOpenAqDelhi,
};