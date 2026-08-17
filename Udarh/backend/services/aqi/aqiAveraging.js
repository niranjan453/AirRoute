const {
  enrichMeasurementFreshness,
} = require("./aqiFreshness");

// ============================================================
// CONFIG
// ============================================================

const DEFAULT_24H_HOURS = 24;
const DEFAULT_8H_HOURS = 8;

const MIN_REQUIRED_HOURS = 16;

const DEFAULT_COVERAGE_PERCENT = 75;

const REQUEST_TIMEOUT_MS = 15000;

const MAX_RETRIES = 2;

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

const OPENAQ_API_KEY =
  process.env.OPENAQ_API_KEY;

// ============================================================
// POLLUTANT AVERAGING PERIODS
// ============================================================

const AVERAGING_PERIODS = {
  pm25: {
    hours: 24,
    minimumHours: 16,
    unit: "µg/m³",
  },

  pm10: {
    hours: 24,
    minimumHours: 16,
    unit: "µg/m³",
  },

  no2: {
    hours: 24,
    minimumHours: 16,
    unit: "µg/m³",
  },

  so2: {
    hours: 24,
    minimumHours: 16,
    unit: "µg/m³",
  },

  nh3: {
    hours: 24,
    minimumHours: 16,
    unit: "µg/m³",
  },

  pb: {
    hours: 24,
    minimumHours: 16,
    unit: "µg/m³",
  },

  o3: {
    hours: 8,
    minimumHours: 16,
    unit: "µg/m³",
  },

  co: {
    hours: 8,
    minimumHours: 16,
    unit: "mg/m³",
  },
};

// ============================================================
// HEADERS
// ============================================================

function getHeaders() {
  if (!OPENAQ_API_KEY) {
    throw new Error(
      "OPENAQ_API_KEY is missing from backend .env"
    );
  }

  return {
    Accept: "application/json",
    "X-API-Key": OPENAQ_API_KEY,
  };
}

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// OPENAQ REQUEST
// ============================================================

async function openaqRequest(
  endpoint,
  params = {},
  retryCount = 0
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

  let response;

  try {
    response =
      await fetchWithTimeout(
        url.toString(),
        {
          method: "GET",
          headers: getHeaders(),
        }
      );
  } catch (error) {
    if (
      retryCount < MAX_RETRIES
    ) {
      console.warn(
        `[AQI Averaging] Network error. Retrying ${retryCount + 1}/${MAX_RETRIES}...`
      );

      return openaqRequest(
        endpoint,
        params,
        retryCount + 1
      );
    }

    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "OpenAQ averaging request timed out"
      );
    }

    throw new Error(
      `OpenAQ averaging network request failed: ${error.message}`
    );
  }

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      "OpenAQ averaging response was not valid JSON"
    );
  }

  if (
    response.status >= 500 &&
    retryCount < MAX_RETRIES
  ) {
    return openaqRequest(
      endpoint,
      params,
      retryCount + 1
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.detail ||
        `OpenAQ averaging request failed with status ${response.status}`
    );
  }

  return data;
}

// ============================================================
// DATE HELPERS
// ============================================================

function toIsoString(date) {
  const value =
    date instanceof Date
      ? date
      : new Date(date);

  if (
    Number.isNaN(
      value.getTime()
    )
  ) {
    throw new Error(
      "Invalid date supplied"
    );
  }

  return value.toISOString();
}

function getWindowStart(
  endDate,
  hours
) {
  const end =
    new Date(endDate);

  if (
    Number.isNaN(
      end.getTime()
    )
  ) {
    throw new Error(
      "Invalid end date"
    );
  }

  return new Date(
    end.getTime() -
      hours *
        60 *
        60 *
        1000
  );
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

  const value =
    String(parameter)
      .toLowerCase()
      .trim()
      .replace(/[\s.-]/g, "");

  const aliases = {
    pm25: "pm25",
    pm2_5: "pm25",

    pm10: "pm10",

    no2: "no2",
    nitrogendioxide: "no2",

    so2: "so2",
    sulphurdioxide: "so2",
    sulfurdioxide: "so2",

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
    aliases[value] ||
    null
  );
}

// ============================================================
// UNIT NORMALIZATION
// ============================================================

function normalizeUnit(unit) {
  if (!unit) {
    return null;
  }

  const value =
    String(unit)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "");

  if (
    value === "µg/m³" ||
    value === "μg/m³" ||
    value === "ug/m3" ||
    value === "µg/m3" ||
    value === "μg/m3"
  ) {
    return "ug/m3";
  }

  if (
    value === "mg/m³" ||
    value === "mg/m3"
  ) {
    return "mg/m3";
  }

  return value;
}

// ============================================================
// CANONICAL UNIT CHECK
// ============================================================

function isCanonicalUnit(
  pollutant,
  unit
) {
  const normalized =
    normalizeUnit(unit);

  if (
    pollutant === "co"
  ) {
    return (
      normalized === "mg/m3"
    );
  }

  return (
    normalized === "ug/m3"
  );
}

// ============================================================
// NORMALIZE HOURLY RESULT
// ============================================================

function normalizeHourlyResult(
  item,
  expectedPollutant
) {
  if (!item) {
    return null;
  }

  const pollutant =
    normalizeParameter(
      item?.parameter?.name ||
        item?.parameter?.displayName
    );

  if (
    pollutant !==
    expectedPollutant
  ) {
    return null;
  }

  const value =
    Number(item?.value);

  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  const unit =
    item?.parameter?.units ||
    null;

  if (
    !isCanonicalUnit(
      pollutant,
      unit
    )
  ) {
    return null;
  }

  const datetime =
    item?.period?.datetimeTo?.utc ||
    item?.period?.datetimeFrom?.utc ||
    null;

  if (!datetime) {
    return null;
  }

  return {
    value,

    unit,

    pollutant,

    observedAt:
      datetime,

    coverage:
      item?.coverage ||
      null,

    period:
      item?.period ||
      null,

    raw:
      item,
  };
}

// ============================================================
// FETCH HOURLY SENSOR DATA
// ============================================================

async function getHourlySensorData(
  sensorId,
  pollutant,
  endDate = new Date(),
  hours = null
) {
  if (!sensorId) {
    throw new Error(
      "sensorId is required"
    );
  }

  const config =
    AVERAGING_PERIODS[
      pollutant
    ];

  if (!config) {
    throw new Error(
      `Unsupported pollutant: ${pollutant}`
    );
  }

  const windowHours =
    hours ||
    config.hours;

  const end =
    new Date(endDate);

  const start =
    getWindowStart(
      end,
      windowHours
    );

  /*
   * We fetch a little extra data
   * because the current hour can be
   * incomplete.
   */
  const extraHours = 2;

  const extendedStart =
    getWindowStart(
      end,
      windowHours +
        extraHours
    );

  const data =
    await openaqRequest(
      `/sensors/${sensorId}/hours`,
      {
        datetime_from:
          toIsoString(
            extendedStart
          ),

        datetime_to:
          toIsoString(end),

        limit: 100,

        page: 1,
      }
    );

  const results =
    Array.isArray(
      data?.results
    )
      ? data.results
      : [];

  return results
    .map(
      (item) =>
        normalizeHourlyResult(
          item,
          pollutant
        )
    )
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(
          a.observedAt
        ).getTime() -
        new Date(
          b.observedAt
        ).getTime()
    );
}

// ============================================================
// FILTER TO WINDOW
// ============================================================

function filterToWindow(
  measurements,
  endDate,
  hours
) {
  const end =
    new Date(endDate);

  const start =
    getWindowStart(
      end,
      hours
    );

  return measurements.filter(
    (measurement) => {
      const timestamp =
        new Date(
          measurement.observedAt
        );

      return (
        timestamp >= start &&
        timestamp <= end
      );
    }
  );
}

// ============================================================
// CALCULATE SIMPLE AVERAGE
// ============================================================

function calculateAverage(
  measurements
) {
  if (
    !Array.isArray(
      measurements
    ) ||
    measurements.length === 0
  ) {
    return null;
  }

  const values =
    measurements
      .map(
        (item) =>
          Number(item.value)
      )
      .filter(
        Number.isFinite
      );

  if (values.length === 0) {
    return null;
  }

  const sum =
    values.reduce(
      (total, value) =>
        total + value,
      0
    );

  return (
    sum / values.length
  );
}

// ============================================================
// COVERAGE
// ============================================================

function calculateCoverage(
  measurements,
  requiredHours
) {
  const count =
    measurements.length;

  const percentage =
    requiredHours > 0
      ? (count /
          requiredHours) *
        100
      : 0;

  return {
    observedHours: count,

    requiredHours,

    percent:
      Math.min(
        percentage,
        100
      ),

    sufficient:
      count >=
      MIN_REQUIRED_HOURS,
  };
}

// ============================================================
// CALCULATE RUNNING AVERAGE
// ============================================================

function calculateRunningAverage(
  measurements,
  pollutant,
  endDate = new Date()
) {
  const config =
    AVERAGING_PERIODS[
      pollutant
    ];

  if (!config) {
    throw new Error(
      `Unsupported pollutant: ${pollutant}`
    );
  }

  const windowed =
    filterToWindow(
      measurements,
      endDate,
      config.hours
    );

  const coverage =
    calculateCoverage(
      windowed,
      config.hours
    );

  const average =
    calculateAverage(
      windowed
    );

  return {
    pollutant,

    averagingHours:
      config.hours,

    minimumRequiredHours:
      config.minimumHours,

    average,

    unit:
      config.unit,

    observedHours:
      coverage.observedHours,

    requiredHours:
      coverage.requiredHours,

    coveragePercent:
      coverage.percent,

    sufficient:
      coverage.observedHours >=
      config.minimumHours,

    measurements:
      windowed,
  };
}

// ============================================================
// GET SENSOR RUNNING AVERAGE
// ============================================================

async function getSensorRunningAverage(
  sensorId,
  pollutant,
  endDate = new Date()
) {
  const config =
    AVERAGING_PERIODS[
      pollutant
    ];

  if (!config) {
    throw new Error(
      `Unsupported pollutant: ${pollutant}`
    );
  }

  const hourly =
    await getHourlySensorData(
      sensorId,
      pollutant,
      endDate,
      config.hours
    );

  const result =
    calculateRunningAverage(
      hourly,
      pollutant,
      endDate
    );

  return {
    sensorId,

    pollutant,

    ...result,
  };
}

// ============================================================
// SELECT BEST SENSOR
// ============================================================

async function getBestSensorAverage(
  sensors,
  pollutant,
  endDate = new Date()
) {
  if (
    !Array.isArray(
      sensors
    )
  ) {
    return null;
  }

  const candidates =
    sensors.filter(
      (sensor) => {
        const parameter =
          normalizeParameter(
            sensor?.parameter?.name ||
              sensor?.parameter?.displayName
          );

        if (
          parameter !==
          pollutant
        ) {
          return false;
        }

        return isCanonicalUnit(
          pollutant,
          sensor?.parameter
            ?.units
        );
      }
    );

  const results = [];

  for (
    const sensor of candidates
  ) {
    try {
      const result =
        await getSensorRunningAverage(
          sensor.id,
          pollutant,
          endDate
        );

      /*
       * Only use sensors with
       * enough historical data.
       */
      if (
        result.sufficient &&
        Number.isFinite(
          result.average
        )
      ) {
        results.push(
          result
        );
      }
    } catch (error) {
      console.warn(
        `[AQI Averaging] Sensor ${sensor.id} failed: ${error.message}`
      );
    }
  }

  if (
    results.length === 0
  ) {
    return null;
  }

  /*
   * Prefer:
   * 1. More coverage
   * 2. Newer/latest observation
   */
  results.sort(
    (a, b) => {
      if (
        b.coveragePercent !==
        a.coveragePercent
      ) {
        return (
          b.coveragePercent -
          a.coveragePercent
        );
      }

      return (
        b.observedHours -
        a.observedHours
      );
    }
  );

  return results[0];
}

// ============================================================
// STATION RUNNING AVERAGES
// ============================================================

async function getStationRunningAverages(
  station,
  endDate = new Date()
) {
  if (!station) {
    throw new Error(
      "station is required"
    );
  }

  const sensors =
    Array.isArray(
      station.sensors
    )
      ? station.sensors
      : [];

  const pollutants = [
    "pm25",
    "pm10",
    "no2",
    "so2",
    "o3",
    "co",
    "nh3",
    "pb",
  ];

  const averages = {};

  for (
    const pollutant of pollutants
  ) {
    try {
      const result =
        await getBestSensorAverage(
          sensors,
          pollutant,
          endDate
        );

      if (result) {
        averages[pollutant] =
          result;
      }
    } catch (error) {
      console.warn(
        `[AQI Averaging] ${pollutant} failed: ${error.message}`
      );
    }
  }

  return averages;
}

// ============================================================
// BUILD AQI INPUT
// ============================================================

function buildAqiInput(
  averages
) {
  const result = {};

  Object.entries(
    averages || {}
  ).forEach(
    ([pollutant, data]) => {
      if (
        !data ||
        !Number.isFinite(
          Number(data.average)
        )
      ) {
        return;
      }

      result[pollutant] = {
        value:
          Number(data.average),

        unit:
          data.unit,

        averagingHours:
          data.averagingHours,

        observedHours:
          data.observedHours,

        requiredHours:
          data.requiredHours,

        coveragePercent:
          data.coveragePercent,

        sufficient:
          data.sufficient,

        sensorId:
          data.sensorId,
      };
    }
  );

  return result;
}

// ============================================================
// OVERALL AQI DATA SUFFICIENCY
// ============================================================

function assessAqiSufficiency(
  aqiInput
) {
  const pollutants =
    Object.keys(
      aqiInput || {}
    );

  const hasPm =
    Boolean(
      aqiInput?.pm25 ||
      aqiInput?.pm10
    );

  const minimumPollutants =
    pollutants.length >= 3;

  const sufficient =
    minimumPollutants &&
    hasPm;

  return {
    sufficient,

    pollutantCount:
      pollutants.length,

    hasPm25OrPm10:
      hasPm,

    reason: sufficient
      ? "Sufficient data for overall AQI"
      : "Insufficient data: minimum 3 pollutants including PM2.5 or PM10 required",
  };
}

// ============================================================
// COMPLETE STATION AQI INPUT
// ============================================================

async function prepareStationAqiInput(
  station,
  endDate = new Date()
) {
  const averages =
    await getStationRunningAverages(
      station,
      endDate
    );

  const aqiInput =
    buildAqiInput(
      averages
    );

  const sufficiency =
    assessAqiSufficiency(
      aqiInput
    );

  return {
    stationId:
      station.id,

    stationName:
      station.name,

    averages,

    aqiInput,

    sufficiency,

    generatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// TEST
// ============================================================

async function testAveragingDelhi() {
  const stationId = 5613;

  const endDate =
    new Date();

  console.log(
    "\n================================="
  );

  console.log(
    "     AQI AVERAGING TEST - DELHI"
  );

  console.log(
    "================================="
  );

  console.log(
    "Station:",
    stationId
  );

  console.log(
    "End:",
    endDate.toISOString()
  );

  /*
   * This test requires the station
   * object from openaqProvider.
   */
  const {
    getStation,
  } = require(
    "./openaqProvider"
  );

  const station =
    await getStation(
      stationId
    );

  const result =
    await prepareStationAqiInput(
      station,
      endDate
    );

  console.dir(
    result,
    {
      depth: null,
    }
  );

  console.log(
    "\n================================="
  );

  return result;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AVERAGING_PERIODS,

  MIN_REQUIRED_HOURS,

  normalizeParameter,

  normalizeUnit,

  isCanonicalUnit,

  getHourlySensorData,

  filterToWindow,

  calculateAverage,

  calculateCoverage,

  calculateRunningAverage,

  getSensorRunningAverage,

  getBestSensorAverage,

  getStationRunningAverages,

  buildAqiInput,

  assessAqiSufficiency,

  prepareStationAqiInput,

  testAveragingDelhi,
};