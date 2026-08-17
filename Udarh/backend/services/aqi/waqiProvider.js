// ============================================================
// AIRROUTE - WAQI SECONDARY AQI PROVIDER
// ============================================================
//
// WAQI = SECONDARY provider
//
// Primary:
//   OpenAQ
//
// Secondary:
//   WAQI
//
// Responsibilities:
// - Find nearby WAQI stations
// - Fetch station feed
// - Normalize station data
// - Normalize pollutant IAQI
// - Calculate freshness
// - Return station AQI
//
// WAQI provides AQI + pollutant IAQI through its JSON API.
// ============================================================

const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

const {
  classifyFreshness,
} = require("./aqiFreshness");

// ============================================================
// CONFIG
// ============================================================

function cleanBaseUrl(
  value,
  fallback
) {
  if (!value) {
    return fallback;
  }

  let url =
    String(value).trim();

  // Handles accidentally pasted markdown URLs.
  const markdownMatch =
    url.match(
      /^\[https?:\/\/[^\]]+\]\((https?:\/\/[^)]+)\)$/
    );

  if (markdownMatch) {
    url =
      markdownMatch[1];
  }

  return url.replace(
    /\/+$/,
    ""
  );
}

const WAQI_BASE_URL =
  cleanBaseUrl(
    process.env.WAQI_BASE_URL,
    "https://api.waqi.info"
  );

const WAQI_API_TOKEN =
  process.env.WAQI_API_TOKEN;

const MAX_STATION_AGE_MINUTES =
  Number(
    process.env.AQI_MAX_STATION_AGE_MINUTES ||
      180
  );

const LIVE_MAX_AGE_MINUTES =
  Number(
    process.env.AQI_LIVE_MAX_AGE_MINUTES ||
      60
  );

const MAX_STATIONS =
  Math.max(
    Number(
      process.env.AQI_MAX_NEARBY_STATIONS ||
        5
    ),
    1
  );

// ============================================================
// SUPPORTED POLLUTANTS
// ============================================================

const SUPPORTED_POLLUTANTS = [
  "pm25",
  "pm10",
  "no2",
  "so2",
  "o3",
  "co",
];

// ============================================================
// VALIDATION
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
    )
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
// DISTANCE
// ============================================================

function calculateDistanceMeters(
  lat1,
  lng1,
  lat2,
  lng2
) {
  const R =
    6371000;

  const toRadians =
    (value) =>
      (value * Math.PI) /
      180;

  const dLat =
    toRadians(
      lat2 - lat1
    );

  const dLng =
    toRadians(
      lng2 - lng1
    );

  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +
    Math.cos(
      toRadians(lat1)
    ) *
      Math.cos(
        toRadians(lat2)
      ) *
      Math.sin(
        dLng / 2
      ) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

// ============================================================
// API TOKEN CHECK
// ============================================================

function validateToken() {
  if (
    !WAQI_API_TOKEN ||
    WAQI_API_TOKEN.trim() === "" ||
    WAQI_API_TOKEN ===
      "YOUR_WAQI_API_TOKEN"
  ) {
    throw new Error(
      "WAQI_API_TOKEN is missing from backend .env"
    );
  }
}

// ============================================================
// WAQI REQUEST
// ============================================================

async function waqiRequest(
  endpoint,
  params = {}
) {
  validateToken();

  const url =
    new URL(
      `${WAQI_BASE_URL}${endpoint}`
    );

  Object.entries(
    params
  ).forEach(
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

  url.searchParams.set(
    "token",
    WAQI_API_TOKEN
  );

  const response =
    await fetch(
      url.toString(),
      {
        method: "GET",

        headers: {
          Accept:
            "application/json",
        },
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `WAQI HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    !data ||
    data.status !== "ok"
  ) {
    throw new Error(
      data?.data ||
        "WAQI returned unsuccessful response"
    );
  }

  return data;
}

// ============================================================
// NORMALIZE POLLUTANT
// ============================================================

function normalizePollutant(
  name
) {
  if (!name) {
    return null;
  }

  const normalized =
    String(name)
      .toLowerCase()
      .trim();

  const aliases = {
    pm25:
      "pm25",

    "pm2.5":
      "pm25",

    pm10:
      "pm10",

    no2:
      "no2",

    so2:
      "so2",

    o3:
      "o3",

    co:
      "co",
  };

  return (
    aliases[
      normalized
    ] || null
  );
}

// ============================================================
// PARSE WAQI TIMESTAMP
// ============================================================

function parseObservationTime(
  data
) {
  const value =
    data?.time?.s;

  if (
    !value
  ) {
    return null;
  }

  const timestamp =
    Date.parse(
      value
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return null;
  }

  return new Date(
    timestamp
  ).toISOString();
}

// ============================================================
// FRESHNESS
// ============================================================

function getFreshness(
  observedAt
) {
  if (!observedAt) {
    return {
      freshness:
        "stale",

      isUsable:
        false,

      isLive:
        false,

      isRecent:
        false,

      isStale:
        true,

      ageMinutes:
        null,

      observedAt:
        null,

      reason:
        "WAQI observation time unavailable",
    };
  }

  return classifyFreshness(
    observedAt,
    {
      liveMaxAgeMinutes:
        LIVE_MAX_AGE_MINUTES,

      maxAgeMinutes:
        MAX_STATION_AGE_MINUTES,
    }
  );
}

// ============================================================
// NORMALIZE IAQI
// ============================================================

function normalizeIAQI(
  iaqi
) {
  const result = {};

  if (
    !iaqi ||
    typeof iaqi !==
      "object"
  ) {
    return result;
  }

  for (
    const [
      rawPollutant,
      rawValue,
    ] of Object.entries(
      iaqi
    )
  ) {
    const pollutant =
      normalizePollutant(
        rawPollutant
      );

    if (
      !pollutant
    ) {
      continue;
    }

    const value =
      Number(
        rawValue?.v ??
          rawValue
      );

    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    result[
      pollutant
    ] = {
      pollutant,

      aqi:
        Math.round(
          value
        ),

      rawValue:
        value,

      source:
        "waqi",
    };
  }

  return result;
}

// ============================================================
// NORMALIZE STATION
// ============================================================

function normalizeStation(
  data,
  origin = null
) {
  const city =
    data?.city || {};

  const geo =
    Array.isArray(
      city.geo
    )
      ? city.geo
      : [];

  const lat =
    Number(
      geo[0]
    );

  const lng =
    Number(
      geo[1]
    );

  const uid =
    data?.idx ??
    data?.station?.uid ??
    null;

  const stationName =
    city.name ||
    data?.station?.name ||
    "Unknown WAQI station";

  let distanceMeters =
    null;

  if (
    origin &&
    Number.isFinite(
      lat
    ) &&
    Number.isFinite(
      lng
    )
  ) {
    distanceMeters =
      calculateDistanceMeters(
        origin.lat,
        origin.lng,
        lat,
        lng
      );
  }

  return {
    id:
      uid,

    uid,

    name:
      stationName,

    coordinates: {
      lat,
      lng,
    },

    distanceMeters,

    timezone:
      city.timezone ||
      null,

    url:
      city.url ||
      null,

    source:
      "waqi",

    raw:
      data,
  };
}

// ============================================================
// GET STATION FEED
// ============================================================

async function getStation(
  stationId
) {
  if (
    stationId ===
    undefined ||
    stationId ===
    null
  ) {
    throw new Error(
      "WAQI stationId is required"
    );
  }

  const data =
    await waqiRequest(
      `/feed/@${stationId}/`
    );

  return data?.data ||
    null;
}

// ============================================================
// GET STATION BY NAME / SLUG
// ============================================================

async function getStationByName(
  stationName
) {
  if (
    !stationName
  ) {
    throw new Error(
      "Station name is required"
    );
  }

  const data =
    await waqiRequest(
      `/feed/${encodeURIComponent(
        stationName
      )}/`
    );

  return data?.data ||
    null;
}

// ============================================================
// GET NEARBY STATIONS
// ============================================================
//
// WAQI's map API works using a bounding box:
//
// north,west,south,east
//
// We create a bounding box around the requested point.
// ============================================================

async function getNearbyStations(
  lat,
  lng,
  radiusMeters = 25000
) {
  const origin =
    validateCoordinates(
      lat,
      lng
    );

  const radius =
    Math.max(
      Number(
        radiusMeters
      ) || 25000,
      1000
    );

  const latDelta =
    radius / 111320;

  const lngDelta =
    radius /
    (111320 *
      Math.cos(
        (origin.lat *
          Math.PI) /
          180
      ));

  const north =
    origin.lat +
    latDelta;

  const south =
    origin.lat -
    latDelta;

  const west =
    origin.lng -
    lngDelta;

  const east =
    origin.lng +
    lngDelta;

  const bounds =
    [
      north,
      west,
      south,
      east,
    ].join(",");

  const data =
    await waqiRequest(
      "/v2/map/bounds/",
      {
        latlng:
          bounds,
      }
    );

  const stations =
    Array.isArray(
      data?.data
    )
      ? data.data
      : [];

  return stations
    .map(
      (station) => {
        const stationLat =
          Number(
            station?.lat
          );

        const stationLng =
          Number(
            station?.lon
          );

        const distance =
          Number.isFinite(
            stationLat
          ) &&
          Number.isFinite(
            stationLng
          )
            ? calculateDistanceMeters(
                origin.lat,
                origin.lng,
                stationLat,
                stationLng
              )
            : null;

        return {
          id:
            station?.uid,

          uid:
            station?.uid,

          name:
            station?.station?.name ||
            "Unknown WAQI station",

          coordinates: {
            lat:
              stationLat,

            lng:
              stationLng,
          },

          distanceMeters:
            distance,

          aqi:
            parseWAQIAQI(
              station?.aqi
            ),

          source:
            "waqi",

          raw:
            station,
        };
      }
    )

    .filter(
      (station) =>
        Number.isFinite(
          station.coordinates
            .lat
        ) &&
        Number.isFinite(
          station.coordinates
            .lng
        ) &&
        (
          station.distanceMeters ===
            null ||
          station.distanceMeters <=
            radius
        )
    )

    .sort(
      (a, b) =>
        (
          a.distanceMeters ??
          Infinity
        ) -
        (
          b.distanceMeters ??
          Infinity
        )
    );
}

// ============================================================
// PARSE WAQI AQI
// ============================================================

function parseWAQIAQI(
  value
) {
  if (
    value ===
    undefined ||
    value ===
    null ||
    value ===
    "-"
  ) {
    return null;
  }

  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return null;
  }

  return Math.round(
    numeric
  );
}

// ============================================================
// BUILD POLLUTANT SNAPSHOT
// ============================================================

function buildPollutantSnapshot(
  data
) {
  const iaqi =
    normalizeIAQI(
      data?.iaqi
    );

  return {
    pm25:
      iaqi.pm25 ||
      null,

    pm10:
      iaqi.pm10 ||
      null,

    no2:
      iaqi.no2 ||
      null,

    so2:
      iaqi.so2 ||
      null,

    o3:
      iaqi.o3 ||
      null,

    co:
      iaqi.co ||
      null,
  };
}

// ============================================================
// GET STATION DATA
// ============================================================

async function getStationData(
  stationId,
  origin = null
) {
  const data =
    await getStation(
      stationId
    );

  if (!data) {
    throw new Error(
      `WAQI station ${stationId} returned no data`
    );
  }

  const observedAt =
    parseObservationTime(
      data
    );

  const freshness =
    getFreshness(
      observedAt
    );

  const station =
    normalizeStation(
      data,
      origin
    );

  const pollutants =
    buildPollutantSnapshot(
      data
    );

  const stationAQI =
    parseWAQIAQI(
      data?.aqi
    );

  const usablePollutants =
    Object.values(
      pollutants
    ).filter(Boolean);

  return {
    station,

    provider:
      "waqi",

    source:
      "waqi",

    standard:
      "US_EPA",

    aqi:
      stationAQI,

    pollutants,

    pollutantCount:
      usablePollutants.length,

    dominantPollutant:
      data?.dominentpol ||
      data?.dominantpol ||
      null,

    observedAt,

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

    raw:
      data,
  };
}

// ============================================================
// GET NEARBY STATION DATA
// ============================================================

async function getNearbyStationData(
  lat,
  lng,
  radiusMeters = 25000
) {
  const origin =
    validateCoordinates(
      lat,
      lng
    );

  const nearby =
    await getNearbyStations(
      origin.lat,
      origin.lng,
      radiusMeters
    );

  if (
    nearby.length === 0
  ) {
    return [];
  }

  const selected =
    nearby.slice(
      0,
      Math.max(
        MAX_STATIONS * 2,
        10
      )
    );

  const results = [];

  for (
    const station of selected
  ) {
    try {
      if (
        station.id ===
        null ||
        station.id ===
        undefined
      ) {
        continue;
      }

      const data =
        await getStationData(
          station.id,
          origin
        );

      // ------------------------------------------------------
      // Do not use stale WAQI data.
      // ------------------------------------------------------

      if (
        !data.isUsable
      ) {
        continue;
      }

      results.push(
        data
      );
    } catch (error) {
      console.warn(
        `[WAQI] Station ${station.id} failed: ${error.message}`
      );
    }
  }

  return results
    .sort(
      (a, b) => {
        // Live first
        if (
          a.isLive !==
          b.isLive
        ) {
          return a.isLive
            ? -1
            : 1;
        }

        // Then recent
        if (
          a.isRecent !==
          b.isRecent
        ) {
          return a.isRecent
            ? -1
            : 1;
        }

        // Then nearest
        return (
          (
            a.station
              .distanceMeters ??
            Infinity
          ) -
          (
            b.station
              .distanceMeters ??
            Infinity
          )
        );
      }
    )
    .slice(
      0,
      MAX_STATIONS
    );
}

// ============================================================
// SELECT BEST STATION
// ============================================================

function selectBestStation(
  stations
) {
  if (
    !Array.isArray(
      stations
    ) ||
    stations.length === 0
  ) {
    return null;
  }

  return (
    stations
      .filter(
        (station) =>
          station.isUsable
      )
      .sort(
        (a, b) => {
          // Live
          if (
            a.isLive !==
            b.isLive
          ) {
            return a.isLive
              ? -1
              : 1;
          }

          // Recent
          if (
            a.isRecent !==
            b.isRecent
          ) {
            return a.isRecent
              ? -1
              : 1;
          }

          // More pollutants
          if (
            a.pollutantCount !==
            b.pollutantCount
          ) {
            return (
              b.pollutantCount -
              a.pollutantCount
            );
          }

          // Nearest
          return (
            (
              a.station
                .distanceMeters ??
              Infinity
            ) -
            (
              b.station
                .distanceMeters ??
              Infinity
            )
          );
        }
      )[0] ||
    null
  );
}

// ============================================================
// TEST - DELHI
// ============================================================

async function testWaqiDelhi() {
  const lat =
    28.6139;

  const lng =
    77.2090;

  console.log(
    "\n================================="
  );

  console.log(
    "        WAQI TEST - DELHI"
  );

  console.log(
    "================================="
  );

  console.log(
    "Coordinate:",
    lat,
    lng
  );

  console.log(
    "Radius:",
    25000,
    "meters"
  );

  const stations =
    await getNearbyStationData(
      lat,
      lng,
      25000
    );

  console.log(
    `\n[WAQI] Usable stations: ${stations.length}`
  );

  for (
    const station of stations
  ) {
    console.log(
      "\n---------------------------------"
    );

    console.log(
      "Station:",
      station.station.name
    );

    console.log(
      "ID:",
      station.station.id
    );

    console.log(
      "Distance:",
      Math.round(
        station.station
          .distanceMeters ??
          0
      ),
      "meters"
    );

    console.log(
      "AQI:",
      station.aqi
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
      "Recent:",
      station.isRecent
    );

    console.log(
      "Dominant pollutant:",
      station.dominantPollutant
    );

    console.log(
      "Pollutants:"
    );

    console.dir(
      station.pollutants,
      {
        depth: 5,
      }
    );
  }

  const best =
    selectBestStation(
      stations
    );

  console.log(
    "\n================================="
  );

  console.log(
    "BEST WAQI STATION"
  );

  console.dir(
    best,
    {
      depth: 5,
    }
  );

  return {
    stations,

    best,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getNearbyStations,

  getStation,

  getStationByName,

  getStationData,

  getNearbyStationData,

  normalizeStation,

  normalizeIAQI,

  normalizePollutant,

  parseObservationTime,

  parseWAQIAQI,

  calculateDistanceMeters,

  selectBestStation,

  testWaqiDelhi,
};