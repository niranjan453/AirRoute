"use strict";

const express = require("express");

const router = express.Router();

const {
  getRoutes,
} = require("../services/openRouteService");

const {
  scoreRoutes,
  PROFILE_SENSITIVITY,
} = require("../services/exposureScoring");

const {
  rankRoutes,
} = require("../services/aqi/routeRanking");

const {
  encode,
} = require("@googlemaps/polyline-codec");

const {
  buildRouteAdvisory,
  buildOverallAdvisory,
} = require("../services/advisory/routeAdvisory");

// ============================================================
// AIRROUTE - ROUTES API
// ============================================================
//
// POST /routes
//
// Request validation
//      ↓
// Location resolution
//      ↓
// Routing provider
//      ↓
// Route validation
//      ↓
// AQI + exposure scoring
//      ↓
// AQI coverage safety
//      ↓
// Route ranking
//      ↓
// Advisory
//      ↓
// Clean frontend response
//
// IMPORTANT:
// - Routing remains OpenRouteService.
// - AQI remains OpenAQ PRIMARY / WAQI FALLBACK.
// - Route ranking remains authoritative.
// - Geocoding is protected against wrong-country matches.
// ============================================================

// ============================================================
// CONFIGURATION
// ============================================================

const MOCK_MODE =
  String(
    process.env.ROUTE_MOCK_MODE ||
      "false"
  ).toLowerCase() === "true";

// Current MVP analysis limit.
// DO NOT increase this to hide bad geocoding.
const MAX_ROUTE_DISTANCE_METERS =
  Number(
    process.env.AIRROUTE_MAX_ROUTE_DISTANCE_METERS ||
      100000
  );

// AQI data-quality threshold.
// This is NOT a medical threshold.
const MIN_AQI_COVERAGE_PERCENT =
  Number(
    process.env.AIRROUTE_MIN_AQI_COVERAGE_PERCENT ||
      50
  );

// ============================================================
// GEOCODING CONFIGURATION
// ============================================================
//
// AirRoute MVP is currently India-focused.
//
// We therefore:
//
// 1. Bias Pelias toward India.
// 2. Validate that the returned result is actually India.
// 3. Reject wrong-country results.
// 4. Try OpenRouteService geocoder.
// 5. Try Nominatim with countrycodes=in.
//
// This prevents:
//
// Jaipur Railway Station
//      ↓
// Uzbekistan
//
// or:
//
// Anand Vihar Metro Station
//      ↓
// USA
//
// ============================================================

const GEOCODING_BASE_URL =
  process.env.GEOCODING_BASE_URL ||
  "https://api.heigit.org/pelias/v1";

const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ||
  "https://nominatim.openstreetmap.org";

const ORS_API_KEY =
  process.env.ORS_API_KEY ||
  "";

const APP_NAME =
  process.env.APP_NAME ||
  "AirRoute";

const APP_CONTACT =
  process.env.APP_CONTACT ||
  "your-email@example.com";

const GEOCODING_COUNTRY_CODE =
  String(
    process.env.GEOCODING_COUNTRY_CODE ||
      "IND"
  )
    .trim()
    .toUpperCase();

const GEOCODING_COUNTRY_NAME =
  String(
    process.env.GEOCODING_COUNTRY_NAME ||
      "India"
  )
    .trim()
    .toLowerCase();

// ============================================================
// PERFORMANCE TIMER
// ============================================================

function createPerformanceTimer() {
  const startedAt =
    process.hrtime.bigint();

  const marks = {};

  function nowMs() {
    return (
      Number(
        process.hrtime.bigint() -
          startedAt
      ) /
      1e6
    );
  }

  function mark(name) {
    marks[name] =
      nowMs();
  }

  function duration(
    start,
    end
  ) {
    const startValue =
      marks[start];

    const endValue =
      marks[end] ??
      nowMs();

    if (
      typeof startValue !==
        "number" ||
      typeof endValue !==
        "number"
    ) {
      return null;
    }

    return Number(
      (
        endValue -
        startValue
      ).toFixed(2)
    );
  }

  function print() {
    const total =
      nowMs();

    console.log(
      "\n================================================"
    );

    console.log(
      "        AIRROUTE ROUTE PERFORMANCE"
    );

    console.log(
      "================================================"
    );

    console.log(
      `Validation             : ${(
        marks.validationEnd ??
        total
      ).toFixed(2)} ms`
    );

    console.log(
      `Origin resolution      : ${(
        duration(
          "originStart",
          "originEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Destination resolution : ${(
        duration(
          "destinationStart",
          "destinationEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Routing provider       : ${(
        duration(
          "routingStart",
          "routingEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Route normalization    : ${(
        duration(
          "normalizeStart",
          "normalizeEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Geometry preparation   : ${(
        duration(
          "geometryStart",
          "geometryEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `AQI + exposure scoring : ${(
        duration(
          "scoringStart",
          "scoringEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Ranking                : ${(
        duration(
          "rankingStart",
          "rankingEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Final route building   : ${(
        duration(
          "finalBuildStart",
          "finalBuildEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Advisory               : ${(
        duration(
          "advisoryStart",
          "advisoryEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      `Response preparation   : ${(
        duration(
          "responseStart",
          "responseEnd"
        ) ?? 0
      ).toFixed(2)} ms`
    );

    console.log(
      "------------------------------------------------"
    );

    console.log(
      `TOTAL                  : ${total.toFixed(
        2
      )} ms`
    );

    console.log(
      "================================================\n"
    );
  }

  return {
    mark,
    duration,
    print,
    nowMs,
  };
}

// ============================================================
// GEOCODING HELPERS
// ============================================================

function buildGeocodingUserAgent() {
  return `${APP_NAME}/1.0 (${APP_CONTACT})`;
}

// ------------------------------------------------------------
// COUNTRY NORMALIZATION
// ------------------------------------------------------------

function normalizeCountryValue(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );
}

// ------------------------------------------------------------
// COUNTRY CHECK
// ------------------------------------------------------------
//
// Pelias can expose country information in several fields.
//
// Examples:
// country_a = IND
// country = India
// country_gid = whosonfirst:country:85632457
//
// We accept IND or India.
//
// ------------------------------------------------------------

function isIndiaPeliasResult(
  properties
) {
  if (!properties) {
    return false;
  }

  const countryCode =
    normalizeCountryValue(
      properties.country_a ||
        properties.country_code ||
        properties.countryCode
    );

  const countryName =
    normalizeCountryValue(
      properties.country ||
        properties.country_name ||
        properties.countryName
    );

  if (
    countryCode ===
    GEOCODING_COUNTRY_CODE.toLowerCase()
  ) {
    return true;
  }

  if (
    countryName ===
    GEOCODING_COUNTRY_NAME
  ) {
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// NOMINATIM COUNTRY CHECK
// ------------------------------------------------------------

function isIndiaNominatimResult(
  result
) {
  if (!result) {
    return false;
  }

  const countryCode =
    normalizeCountryValue(
      result.country_code
    );

  const country =
    normalizeCountryValue(
      result.country
    );

  return (
    countryCode ===
      "in" ||
    country ===
      GEOCODING_COUNTRY_NAME
  );
}

// ============================================================
// NORMALIZE PELIAS RESULT
// ============================================================

function normalizePeliasResult(
  data,
  originalAddress,
  source
) {
  const feature =
    data?.features?.[0];

  if (!feature) {
    return null;
  }

  const properties =
    feature?.properties ||
    {};

  // ----------------------------------------------------------
  // CRITICAL:
  // Reject results outside India.
  // ----------------------------------------------------------

  if (
    !isIndiaPeliasResult(
      properties
    )
  ) {
    const returnedCountry =
      properties.country ||
      properties.country_a ||
      "unknown";

    throw new Error(
      `Geocoder returned a non-India result: ${returnedCountry}`
    );
  }

  const coordinates =
    feature?.geometry
      ?.coordinates;

  const lng =
    Number(
      coordinates?.[0]
    );

  const lat =
    Number(
      coordinates?.[1]
    );

  if (
    !Number.isFinite(
      lat
    ) ||
    !Number.isFinite(
      lng
    ) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return {
    lat,

    lng,

    formattedAddress:
      properties.label ||
      properties.name ||
      properties.locality ||
      originalAddress,

    placeId:
      properties.id ||
      feature?.id ||
      null,

    country:
      properties.country ||
      "India",

    countryCode:
      properties.country_a ||
      GEOCODING_COUNTRY_CODE,

    source,
  };
}

// ============================================================
// HEIGIT / PELIAS
// ============================================================

async function geocodeWithHeiGit(
  address
) {
  const url =
    new URL(
      `${GEOCODING_BASE_URL.replace(
        /\/+$/,
        ""
      )}/search`
    );

  // Original search text.
  url.searchParams.set(
    "text",
    address
  );

  // Return only the best result.
  url.searchParams.set(
    "size",
    "1"
  );

  // ----------------------------------------------------------
  // India country bias
  // ----------------------------------------------------------

  url.searchParams.set(
    "boundary.country",
    GEOCODING_COUNTRY_CODE
  );

  // ----------------------------------------------------------
  // Existing ORS API key
  // ----------------------------------------------------------

  if (
    ORS_API_KEY
  ) {
    url.searchParams.set(
      "api_key",
      ORS_API_KEY
    );
  }

  const response =
    await fetch(
      url.toString(),
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json",

          "User-Agent":
            buildGeocodingUserAgent(),
        },
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `HeiGIT geocoder HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  const result =
    normalizePeliasResult(
      data,
      address,
      "heigit-pelias"
    );

  if (!result) {
    throw new Error(
      "HeiGIT returned no usable India geocoding result"
    );
  }

  return result;
}

// ============================================================
// OPENROUTESERVICE GEOCODER
// ============================================================

async function geocodeWithLegacyORS(
  address
) {
  if (
    !ORS_API_KEY
  ) {
    throw new Error(
      "ORS_API_KEY is not configured"
    );
  }

  const url =
    new URL(
      "https://api.openrouteservice.org/geocode/search"
    );

  url.searchParams.set(
    "text",
    address
  );

  url.searchParams.set(
    "size",
    "1"
  );

  url.searchParams.set(
    "api_key",
    ORS_API_KEY
  );

  // ORS geocoder also supports country restriction.
  url.searchParams.set(
    "boundary.country",
    GEOCODING_COUNTRY_CODE
  );

  const response =
    await fetch(
      url.toString(),
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json",

          "User-Agent":
            buildGeocodingUserAgent(),
        },
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `OpenRouteService geocoder HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  const result =
    normalizePeliasResult(
      data,
      address,
      "openrouteservice-geocoder"
    );

  if (!result) {
    throw new Error(
      "OpenRouteService returned no usable India geocoding result"
    );
  }

  return result;
}

// ============================================================
// NOMINATIM
// ============================================================

async function geocodeWithNominatim(
  address
) {
  const url =
    new URL(
      `${NOMINATIM_BASE_URL.replace(
        /\/+$/,
        ""
      )}/search`
    );

  url.searchParams.set(
    "q",
    address
  );

  url.searchParams.set(
    "format",
    "jsonv2"
  );

  url.searchParams.set(
    "limit",
    "1"
  );

  // ----------------------------------------------------------
  // India-only fallback.
  // ----------------------------------------------------------

  url.searchParams.set(
    "countrycodes",
    "in"
  );

  const response =
    await fetch(
      url.toString(),
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json",

          "User-Agent":
            buildGeocodingUserAgent(),
        },
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Nominatim HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  const result =
    Array.isArray(data) &&
    data.length > 0
      ? data[0]
      : null;

  if (!result) {
    throw new Error(
      "Nominatim returned no geocoding result"
    );
  }

  if (
    !isIndiaNominatimResult(
      result
    )
  ) {
    throw new Error(
      `Nominatim returned a non-India result: ${
        result.country ||
        "unknown"
      }`
    );
  }

  const lat =
    Number(
      result.lat
    );

  const lng =
    Number(
      result.lon
    );

  if (
    !Number.isFinite(
      lat
    ) ||
    !Number.isFinite(
      lng
    ) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new Error(
      "Nominatim returned invalid coordinates"
    );
  }

  return {
    lat,

    lng,

    formattedAddress:
      result.display_name ||
      address,

    placeId:
      result.osm_id
        ? `osm-${
            result.osm_type ||
            "object"
          }-${result.osm_id}`
        : null,

    country:
      result.country ||
      "India",

    countryCode:
      result.country_code ||
      "in",

    source:
      "nominatim",
  };
}

// ============================================================
// MAIN GEOCODER
// ============================================================
//
// Provider order:
//
// 1. HeiGIT / Pelias
// 2. OpenRouteService geocoder
// 3. Nominatim
//
// A wrong-country result is treated as a failed provider,
// not as a successful geocode.
// ============================================================

async function geocode(
  address
) {
  const input =
    String(
      address || ""
    ).trim();

  if (!input) {
    throw new Error(
      "Address is required."
    );
  }

  const errors = [];

  // ----------------------------------------------------------
  // 1. HEIGIT
  // ----------------------------------------------------------

  try {
    const result =
      await geocodeWithHeiGit(
        input
      );

    console.log(
      `[routes] Geocoder: HeiGIT/Pelias resolved "${input}" → ${result.lat}, ${result.lng}`
    );

    console.log(
      `[routes] Geocoder country: ${
        result.country ||
        "India"
      }`
    );

    return result;
  } catch (
    error
  ) {
    errors.push(
      `HeiGIT: ${error.message}`
    );

    console.warn(
      `[routes] HeiGIT geocoder rejected "${input}": ${error.message}`
    );
  }

  // ----------------------------------------------------------
  // 2. OPENROUTESERVICE
  // ----------------------------------------------------------

  try {
    const result =
      await geocodeWithLegacyORS(
        input
      );

    console.log(
      `[routes] Geocoder: OpenRouteService resolved "${input}" → ${result.lat}, ${result.lng}`
    );

    console.log(
      `[routes] Geocoder country: ${
        result.country ||
        "India"
      }`
    );

    return result;
  } catch (
    error
  ) {
    errors.push(
      `OpenRouteService: ${error.message}`
    );

    console.warn(
      `[routes] OpenRouteService geocoder rejected "${input}": ${error.message}`
    );
  }

  // ----------------------------------------------------------
  // 3. NOMINATIM
  // ----------------------------------------------------------

  try {
    const result =
      await geocodeWithNominatim(
        input
      );

    console.log(
      `[routes] Geocoder: Nominatim resolved "${input}" → ${result.lat}, ${result.lng}`
    );

    console.log(
      `[routes] Geocoder country: ${
        result.country ||
        "India"
      }`
    );

    return result;
  } catch (
    error
  ) {
    errors.push(
      `Nominatim: ${error.message}`
    );

    console.error(
      `[routes] All India geocoding providers failed for "${input}"`
    );

    throw new Error(
      `Could not geocode "${input}". ${errors.join(
        " | "
      )}`
    );
  }
}

// ============================================================
// TEMPORARY ROUTE STORE
// ============================================================

const storedRoutes = {};

// ============================================================
// NUMBER HELPERS
// ============================================================

function finiteNumber(
  value,
  fallback = null
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

function round(
  value,
  decimals = 2
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      number * factor
    ) / factor
  );
}

// ============================================================
// COORDINATE STRING
// ============================================================

function parseCoordinateString(
  value
) {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const match =
    value.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
    );

  if (!match) {
    return null;
  }

  const lat =
    Number(
      match[1]
    );

  const lng =
    Number(
      match[2]
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

  if (
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return {
    lat,
    lng,
  };
}

// ============================================================
// COORDINATE OBJECT
// ============================================================

function parseCoordinateObject(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const lat =
    Number(
      value.lat
    );

  const lng =
    Number(
      value.lng
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

  if (
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return {
    lat,
    lng,
  };
}

// ============================================================
// PARSE ORIGIN / DESTINATION
// ============================================================

function parseOriginDest(
  origin,
  destination
) {
  return {
    o:
      parseCoordinateObject(
        origin
      ) ||
      parseCoordinateString(
        origin
      ),

    d:
      parseCoordinateObject(
        destination
      ) ||
      parseCoordinateString(
        destination
      ),
  };
}

// ============================================================
// MOCK ROUTES
// ============================================================

function generateMockRoutes(
  origin,
  destination
) {
  let {
    o,
    d,
  } =
    parseOriginDest(
      origin,
      destination
    );

  if (!o) {
    o = {
      lat: 28.6139,
      lng: 77.209,
    };
  }

  if (!d) {
    d = {
      lat: 28.5971,
      lng: 77.3162,
    };
  }

  function mkPts(
    start,
    end,
    n,
    jitter
  ) {
    const pts = [];

    for (
      let i = 0;
      i <= n;
      i++
    ) {
      const t =
        i / n;

      const lat =
        start.lat +
        (end.lat -
          start.lat) *
          t +
        Math.sin(
          t *
            Math.PI *
            4
        ) *
          jitter;

      const lng =
        start.lng +
        (end.lng -
          start.lng) *
          t +
        Math.cos(
          t *
            Math.PI *
            3
        ) *
          jitter;

      pts.push([
        Number(
          lat.toFixed(
            6
          )
        ),

        Number(
          lng.toFixed(
            6
          )
        ),
      ]);
    }

    return pts;
  }

  const route1Pts =
    mkPts(
      o,
      d,
      30,
      0.0015
    );

  const route2Pts =
    mkPts(
      o,
      d,
      28,
      -0.0035
    );

  const route3Pts =
    mkPts(
      o,
      d,
      32,
      0.0055
    );

  const legFor = (
    pts,
    factorSecs,
    factorMeters
  ) => {
    const distanceMeters =
      Math.round(
        8000 *
          factorMeters +
          Math.random() *
            1000
      );

    const durationSeconds =
      Math.round(
        900 *
          factorSecs +
          Math.random() *
            300
      );

    const steps = [];

    for (
      let i = 0;
      i <
      Math.max(
        1,
        pts.length - 1
      );
      i++
    ) {
      const start =
        pts[i];

      const end =
        pts[
          Math.min(
            i + 1,
            pts.length - 1
          )
        ];

      steps.push({
        instruction:
          "Continue",

        distanceMeters:
          Math.round(
            distanceMeters /
              Math.max(
                1,
                pts.length - 1
              )
          ),

        durationSeconds:
          Math.round(
            durationSeconds /
              Math.max(
                1,
                pts.length - 1
              )
          ),

        startLocation: {
          lat:
            start[0],

          lng:
            start[1],
        },

        endLocation: {
          lat:
            end[0],

          lng:
            end[1],
        },
      });
    }

    return {
      distanceMeters,
      durationSeconds,
      steps,
    };
  };

  return [
    {
      id:
        `mock-fast-${Date.now()}`,

      summary:
        "Fastest via Ring Road",

      distanceMeters:
        9500,

      durationSeconds:
        1050,

      polyline:
        encode(
          route1Pts,
          5
        ),

      legs: [
        legFor(
          route1Pts,
          1.0,
          1.0
        ),
      ],

      warnings: [],
    },

    {
      id:
        `mock-clean-${Date.now()}`,

      summary:
        "Scenic via Green Belt",

      distanceMeters:
        11000,

      durationSeconds:
        1320,

      polyline:
        encode(
          route2Pts,
          5
        ),

      legs: [
        legFor(
          route2Pts,
          1.26,
          1.18
        ),
      ],

      warnings: [],
    },

    {
      id:
        `mock-alt-${Date.now()}`,

      summary:
        "Alternate via Sector Road",

      distanceMeters:
        10200,

      durationSeconds:
        1200,

      polyline:
        encode(
          route3Pts,
          5
        ),

      legs: [
        legFor(
          route3Pts,
          1.14,
          1.08
        ),
      ],

      warnings: [],
    },
  ];
}

// ============================================================
// LOCATION RESOLVER
// ============================================================

async function resolveLocation(
  value,
  fieldName
) {
  // ----------------------------------------------------------
  // COORDINATE OBJECT
  // ----------------------------------------------------------

  if (
    typeof value ===
      "object" &&
    value !== null
  ) {
    const parsed =
      parseCoordinateObject(
        value
      );

    if (!parsed) {
      throw new Error(
        `${fieldName} contains invalid coordinates.`
      );
    }

    console.log(
      `[routes] ${fieldName}: using supplied coordinates ${parsed.lat}, ${parsed.lng}`
    );

    return {
      ...parsed,

      source:
        "coordinates",
    };
  }

  // ----------------------------------------------------------
  // STRING
  // ----------------------------------------------------------

  if (
    typeof value !==
      "string" ||
    !value.trim()
  ) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  const input =
    value.trim();

  // ----------------------------------------------------------
  // COORDINATE STRING
  // ----------------------------------------------------------

  const coordinateResult =
    parseCoordinateString(
      input
    );

  if (
    coordinateResult
  ) {
    console.log(
      `[routes] ${fieldName}: using supplied coordinates ${coordinateResult.lat}, ${coordinateResult.lng}`
    );

    return {
      ...coordinateResult,

      source:
        "coordinates",
    };
  }

  // ----------------------------------------------------------
  // GEOCODE
  // ----------------------------------------------------------

  console.log(
    `[routes] ${fieldName}: geocoding "${input}"`
  );

  const result =
    await geocode(
      input
    );

  const lat =
    Number(
      result?.lat
    );

  const lng =
    Number(
      result?.lng
    );

  if (
    !Number.isFinite(
      lat
    ) ||
    !Number.isFinite(
      lng
    ) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new Error(
      `Geocoder returned invalid coordinates for ${fieldName}.`
    );
  }

  console.log(
    `[routes] ${fieldName}: "${input}" → ${lat}, ${lng}`
  );

  console.log(
    `[routes] ${fieldName} resolved as: ${
      result.formattedAddress ||
      "Unknown"
    }`
  );

  console.log(
    `[routes] ${fieldName} country: ${
      result.country ||
      "India"
    }`
  );

  return {
    lat,

    lng,

    formattedAddress:
      result.formattedAddress ||
      null,

    placeId:
      result.placeId ||
      null,

    country:
      result.country ||
      "India",

    countryCode:
      result.countryCode ||
      GEOCODING_COUNTRY_CODE,

    source:
      result.source ||
      "geocoder",
  };
}

// ============================================================
// PROFILE
// ============================================================

function normalizeProfile(
  profile
) {
  const normalized =
    String(
      profile ||
        "normal"
    )
      .trim()
      .toLowerCase();

  if (
    PROFILE_SENSITIVITY &&
    typeof PROFILE_SENSITIVITY ===
      "object" &&
    Object.prototype.hasOwnProperty.call(
      PROFILE_SENSITIVITY,
      normalized
    )
  ) {
    return normalized;
  }

  return "normal";
}

// ============================================================
// SAME LOCATION
// ============================================================

function areSameLocation(
  origin,
  destination
) {
  if (
    !origin ||
    !destination
  ) {
    return false;
  }

  return (
    Math.abs(
      Number(
        origin.lat
      ) -
        Number(
          destination.lat
        )
    ) <
      0.000001 &&
    Math.abs(
      Number(
        origin.lng
      ) -
        Number(
          destination.lng
        )
    ) <
      0.000001
  );
}

// ============================================================
// ROUTE NORMALIZATION
// ============================================================

function normalizeRoute(
  route,
  index
) {
  const distanceMeters =
    finiteNumber(
      route?.distanceMeters ??
        route?.distance
    );

  const durationSeconds =
    finiteNumber(
      route?.durationSeconds ??
        route?.duration
    );

  return {
    ...route,

    id:
      route?.id ||
      `route-${index}-${Date.now()}`,

    routeIndex:
      index,

    distanceMeters,

    durationSeconds,

    distanceKm:
      distanceMeters !== null
        ? round(
            distanceMeters /
              1000,
            2
          )
        : null,

    durationMinutes:
      durationSeconds !== null
        ? round(
            durationSeconds /
              60,
            1
          )
        : null,
  };
}

// ============================================================
// ROUTE POLYLINE
// ============================================================

function ensureRoutePolyline(
  route
) {
  if (
    typeof route?.polyline ===
      "string" &&
    route.polyline.length >
      0
  ) {
    return route.polyline;
  }

  const coordinates =
    route?.geometry
      ?.coordinates;

  if (
    Array.isArray(
      coordinates
    ) &&
    coordinates.length >
      1
  ) {
    const latLng =
      coordinates.map(
        (point) => [
          Number(
            point[1]
          ),
          Number(
            point[0]
          ),
        ]
      );

    return encode(
      latLng
    );
  }

  return null;
}

// ============================================================
// ROUTE GEOMETRY
// ============================================================

function decodeRouteGeometry(
  route
) {
  if (
    route?.geometry &&
    route.geometry.type ===
      "LineString" &&
    Array.isArray(
      route.geometry.coordinates
    )
  ) {
    return {
      type:
        "LineString",

      coordinates:
        route.geometry.coordinates,
    };
  }

  if (
    Array.isArray(
      route?.geometry
    )
  ) {
    const coordinates =
      route.geometry
        .map(
          (point) => {
            if (
              Array.isArray(
                point
              ) &&
              point.length >= 2
            ) {
              return [
                Number(
                  point[0]
                ),
                Number(
                  point[1]
                ),
              ];
            }

            return null;
          }
        )
        .filter(
          Boolean
        );

    if (
      coordinates.length >=
      2
    ) {
      return {
        type:
          "LineString",

        coordinates,
      };
    }
  }

  if (
    typeof route?.polyline ===
      "string" &&
    route.polyline.length >
      0
  ) {
    try {
      const {
        decode,
      } =
        require(
          "@googlemaps/polyline-codec"
        );

      const points =
        decode(
          route.polyline,
          5
        );

      const coordinates =
        points
          .map(
            ([lat, lng]) => [
              Number(lng),
              Number(lat),
            ]
          )
          .filter(
            (point) =>
              Number.isFinite(
                point[0]
              ) &&
              Number.isFinite(
                point[1]
              )
          );

      if (
        coordinates.length >=
        2
      ) {
        return {
          type:
            "LineString",

          coordinates,
        };
      }
    } catch (
      error
    ) {
      console.warn(
        "[routes] Unable to decode route polyline:",
        error.message
      );
    }
  }

  return null;
}

// ============================================================
// AQI SEGMENTS
// ============================================================

function buildAqiSegments(
  route
) {
  const samples =
    Array.isArray(
      route?.sampledAqiPoints
    )
      ? route.sampledAqiPoints
      : [];

  return samples
    .filter(
      (sample) =>
        Number.isFinite(
          Number(
            sample?.aqi
          )
        )
    )
    .map(
      (sample) => ({
        distanceMeters:
          Math.round(
            Number(
              sample.distanceAlongRoute
            ) || 0
          ),

        aqi:
          Math.round(
            Number(
              sample.aqi
            )
          ),

        category:
          sample.category ??
          sample.aqiBand ??
          sample.band ??
          null,

        source:
          sample.source ??
          sample.provider ??
          "unknown",

        confidence:
          sample.confidence ??
          sample.aqiConfidence ??
          null,

        lat:
          finiteNumber(
            sample.lat
          ),

        lng:
          finiteNumber(
            sample.lng
          ),
      })
    );
}

// ============================================================
// HOTSPOTS
// ============================================================

function buildHotspots(
  route
) {
  const hotspots =
    Array.isArray(
      route?.hotspots
    )
      ? route.hotspots
      : [];

  return hotspots.map(
    (hotspot) => {
      const startDistance =
        Number(
          hotspot?.startDistance ??
            hotspot?.startDistanceMeters
        ) || 0;

      const endDistance =
        Number(
          hotspot?.endDistance ??
            hotspot?.endDistanceMeters
        ) || 0;

      const peakAqi =
        Number(
          hotspot?.peakAqi ??
            hotspot?.maxAqi ??
            hotspot?.aqi
        ) || 0;

      const durationMinutes =
        Number(
          hotspot?.durationMin ??
            hotspot?.durationMinutes
        ) || 0;

      const exposureShare =
        Number(
          hotspot?.exposureShare
        );

      const exposureSharePercent =
        Number.isFinite(
          Number(
            hotspot?.exposureSharePercent
          )
        )
          ? Number(
              hotspot.exposureSharePercent
            )
          : Number.isFinite(
              exposureShare
            )
          ? exposureShare *
            100
          : 0;

      return {
        startDistanceMeters:
          Math.round(
            startDistance
          ),

        endDistanceMeters:
          Math.round(
            endDistance
          ),

        peakAqi:
          Math.round(
            peakAqi
          ),

        durationMinutes:
          round(
            durationMinutes,
            2
          ),

        exposureSharePercent:
          round(
            exposureSharePercent,
            2
          ),

        critical:
          hotspot?.critical ===
          true,

        startLocation:
          Number.isFinite(
            Number(
              hotspot?.startLat
            )
          ) &&
          Number.isFinite(
            Number(
              hotspot?.startLng
            )
          )
            ? {
                lat:
                  Number(
                    hotspot.startLat
                  ),

                lng:
                  Number(
                    hotspot.startLng
                  ),
              }
            : null,

        endLocation:
          Number.isFinite(
            Number(
              hotspot?.endLat
            )
          ) &&
          Number.isFinite(
            Number(
              hotspot?.endLng
            )
          )
            ? {
                lat:
                  Number(
                    hotspot.endLat
                  ),

                lng:
                  Number(
                    hotspot.endLng
                  ),
              }
            : null,

        label:
          hotspot?.label ||
          `High AQI ${(
            startDistance /
            1000
          ).toFixed(
            1
          )}-${(
            endDistance /
            1000
          ).toFixed(
            1
          )} km`,
      };
    }
  );
}

// ============================================================
// AIR QUALITY
// ============================================================

function buildAirQuality(
  route
) {
  const averageAqi =
    finiteNumber(
      route?.avgAqi ??
        route?.averageAqi ??
        route?.aqiSummary
          ?.averageAqi
    );

  const peakAqi =
    finiteNumber(
      route?.peakAqi ??
        route?.aqiSummary
          ?.peakAqi
    );

  const coverage =
    finiteNumber(
      route?.aqiCoverage ??
        route?.coverage ??
        route?.aqiSummary
          ?.coveragePercent
    );

  return {
    averageAqi:
      averageAqi !== null
        ? Math.round(
            averageAqi
          )
        : null,

    peakAqi:
      peakAqi !== null
        ? Math.round(
            peakAqi
          )
        : null,

    coverage:
      coverage !== null
        ? round(
            coverage,
            2
          )
        : 0,

    confidence:
      route?.aqiDiagnostics
        ?.coverageConfidence ??
      route?.aqiSummary
        ?.coverageConfidence ??
      null,

    source:
      route?.aqiSource ??
      route?.aqiSummary
        ?.source ??
      "unknown",

    provider:
      route?.provider ??
      route?.aqiSummary
        ?.provider ??
      null,

    standard:
      route?.standard ??
      route?.aqiSummary
        ?.standard ??
      "US_EPA_ESTIMATE",

    segments:
      buildAqiSegments(
        route
      ),
  };
}

// ============================================================
// EXPOSURE
// ============================================================

function buildExposure(
  route
) {
  const score =
    finiteNumber(
      route?.exposureScore
    );

  const perHour =
    finiteNumber(
      route?.exposureScorePerHour
    );

  return {
    score:
      score !== null
        ? Math.round(
            score
          )
        : null,

    perHour:
      perHour !== null
        ? Math.round(
            perHour
          )
        : null,

    band:
      route?.exposureBand ??
      "Unknown",
  };
}

// ============================================================
// HOTSPOT SUMMARY
// ============================================================

function buildHotspotSummary(
  route
) {
  const items =
    buildHotspots(
      route
    );

  const peakAqi =
    finiteNumber(
      route?.hotspotPeakAqi
    );

  const duration =
    finiteNumber(
      route?.hotspotDurationMin
    );

  const exposureShare =
    finiteNumber(
      route?.hotspotExposureShare
    );

  return {
    count:
      Number(
        route?.hotspotCount
      ) ||
      items.length,

    peakAqi:
      peakAqi !== null
        ? Math.round(
            peakAqi
          )
        : 0,

    durationMinutes:
      duration !== null
        ? round(
            duration,
            2
          )
        : 0,

    exposureSharePercent:
      exposureShare !== null
        ? round(
            exposureShare *
              100,
            2
          )
        : 0,

    critical:
      route?.criticalHotspot ===
        true ||
      items.some(
        (item) =>
          item.critical ===
          true
      ),

    items,
  };
}

// ============================================================
// DETOUR
// ============================================================

function buildDetour(
  route
) {
  const percent =
    finiteNumber(
      route?.detourPercent
    );

  return {
    percent:
      percent !== null
        ? round(
            percent,
            2
          )
        : null,

    acceptable:
      route?.withinAcceptableDetour !==
      false,

    criticalHotspot:
      route?.criticalHotspot ===
      true,
  };
}

// ============================================================
// RANKING INPUT
// ============================================================

function buildRecommendationInput(
  route,
  routeIndex
) {
  const exposureScore =
    Number(
      route?.exposureScore
    );

  const avgAqi =
    Number(
      route?.avgAqi ??
        route?.averageAqi ??
        route?.aqiSummary
          ?.averageAqi
    );

  const peakAqi =
    Number(
      route?.peakAqi ??
        route?.aqiSummary
          ?.peakAqi
    );

  const distanceMeters =
    Number(
      route?.distanceMeters
    );

  const durationSeconds =
    Number(
      route?.durationSeconds
    );

  const coverageCandidates = [
    route?.aqiSummary
      ?.coveragePercent,

    route?.aqiCoverage,

    route?.coverage,
  ];

  let coveragePercent =
    null;

  for (
    const candidate of
      coverageCandidates
  ) {
    const value =
      Number(
        candidate
      );

    if (
      Number.isFinite(
        value
      ) &&
      value >= 0 &&
      value <= 100
    ) {
      coveragePercent =
        value;

      break;
    }
  }

  const samples =
    Array.isArray(
      route?.sampledAqiPoints
    )
      ? route.sampledAqiPoints
      : [];

  if (
    coveragePercent ===
      null &&
    samples.length > 0
  ) {
    const samplesWithAvailability =
      samples.filter(
        (sample) =>
          sample &&
          Object.prototype.hasOwnProperty.call(
            sample,
            "aqiAvailable"
          )
      );

    if (
      samplesWithAvailability.length >
      0
    ) {
      const validSamples =
        samplesWithAvailability.filter(
          (sample) =>
            sample?.aqiAvailable ===
              true &&
            Number.isFinite(
              Number(
                sample?.aqi
              )
            )
        ).length;

      coveragePercent =
        (
          validSamples /
          samplesWithAvailability.length
        ) *
        100;
    }
  }

  const lowCoverage =
    coveragePercent ===
      null ||
    coveragePercent <
      MIN_AQI_COVERAGE_PERCENT;

  const hotspots =
    Array.isArray(
      route?.hotspots
    )
      ? route.hotspots
      : [];

  const hotspotExposureShare =
    Number(
      route?.hotspotExposureShare
    );

  const exposurePerKm =
    Number(
      route?.exposureScorePerKm
    );

  const safeExposurePerKm =
    Number.isFinite(
      exposurePerKm
    )
      ? exposurePerKm
      : null;

  return {
    ...route,

    routeIndex,

    distanceMeters:
      Number.isFinite(
        distanceMeters
      )
        ? distanceMeters
        : null,

    durationSeconds:
      Number.isFinite(
        durationSeconds
      )
        ? durationSeconds
        : null,

    exposure: {
      totalExposure:
        Number.isFinite(
          exposureScore
        )
          ? exposureScore
          : null,

      averageAqi:
        Number.isFinite(
          avgAqi
        )
          ? avgAqi
          : null,

      peakAqi:
        Number.isFinite(
          peakAqi
        )
          ? peakAqi
          : null,

      exposureScore:
        Number.isFinite(
          exposureScore
        )
          ? exposureScore
          : null,

      exposurePerKm:
        safeExposurePerKm,

      coverage:
        coveragePercent,

      coveragePercent,

      lowCoverage,

      hotspots,

      hotspotCount:
        Number(
          route?.hotspotCount
        ) ||
        hotspots.length,

      hotspotPeakAqi:
        Number(
          route?.hotspotPeakAqi
        ) || 0,

      hotspotDurationMinutes:
        Number(
          route?.hotspotDurationMin
        ) || 0,

      hotspotExposureShare:
        Number.isFinite(
          hotspotExposureShare
        )
          ? hotspotExposureShare
          : 0,

      criticalHotspot:
        route?.criticalHotspot ===
        true,
    },

    coverage:
      coveragePercent,

    aqiCoverage:
      coveragePercent,

    lowCoverage,

    hasExposure:
      Number.isFinite(
        exposureScore
      ),
  };
}

// ============================================================
// CLEAN ROUTE
// ============================================================

function buildCleanRoute(
  route
) {
  const routeId =
    route?.id ??
    route?.routeId ??
    null;

  const distanceMeters =
    Number(
      route?.distanceMeters
    );

  const durationSeconds =
    Number(
      route?.durationSeconds
    );

  return {
    routeId,

    rank:
      Number.isFinite(
        Number(
          route?.rank
        )
      )
        ? Number(
            route.rank
          )
        : null,

    geometry:
      decodeRouteGeometry(
        route
      ),

    summary:
      route?.summary ??
      null,

    distance: {
      meters:
        Number.isFinite(
          distanceMeters
        )
          ? Math.round(
              distanceMeters
            )
          : null,

      km:
        Number.isFinite(
          distanceMeters
        )
          ? round(
              distanceMeters /
                1000,
              2
            )
          : null,
    },

    duration: {
      seconds:
        Number.isFinite(
          durationSeconds
        )
          ? Math.round(
              durationSeconds
            )
          : null,

      minutes:
        Number.isFinite(
          durationSeconds
        )
          ? round(
              durationSeconds /
                60,
              1
            )
          : null,
    },

    airQuality:
      buildAirQuality(
        route
      ),

    exposure:
      buildExposure(
        route
      ),

    hotspots:
      buildHotspotSummary(
        route
      ),

    detour:
      buildDetour(
        route
      ),

    recommended:
      route?.isRecommended ===
        true ||
      route?.recommended ===
        true,

    advisory:
      safeBuildRouteAdvisory(
        route
      ),
  };
}

// ============================================================
// FINAL ROUTE
// ============================================================

function buildFinalRoute(
  originalRoute,
  rankingRoute,
  rank
) {
  return {
    ...originalRoute,

    rank,

    recommendationRank:
      rank,

    recommendationScore:
      rankingRoute
        ?.recommendationScore ??
      null,

    recommendation:
      rankingRoute
        ?.recommendation ??
      [],

    recommendationComponents:
      rankingRoute
        ?.recommendationComponents ??
      null,

    // Ranking engine is authoritative.
    isRecommended:
      rankingRoute
        ?.recommended ===
      true,

    fastestScore:
      rankingRoute
        ?.fastestScore ??
      null,

    cleanestScore:
      rankingRoute
        ?.cleanestScore ??
      null,

    balancedScore:
      rankingRoute
        ?.balancedScore ??
      null,

    rankingExposure:
      rankingRoute
        ?.totalExposure ??
      originalRoute
        ?.exposureScore ??
      null,

    rankingAverageAqi:
      rankingRoute
        ?.averageAqi ??
      originalRoute
        ?.avgAqi ??
      null,

    rankingPeakAqi:
      rankingRoute
        ?.peakAqi ??
      originalRoute
        ?.peakAqi ??
      null,

    rankingHotspotCount:
      rankingRoute
        ?.hotspotCount ??
      0,

    detourPercent:
      rankingRoute
        ?.detourPercent ??
      null,

    withinAcceptableDetour:
      rankingRoute
        ?.withinAcceptableDetour ??
      false,

    criticalHotspot:
      rankingRoute
        ?.criticalHotspot ??
      false,
  };
}

// ============================================================
// ROUTE ADVISORY SAFETY
// ============================================================

function safeBuildRouteAdvisory(
  route
) {
  try {
    return buildRouteAdvisory(
      route
    );
  } catch (
    error
  ) {
    console.warn(
      "[routes] Route advisory failed:",
      error.message
    );

    return null;
  }
}

// ============================================================
// REQUEST VALUE
// ============================================================

function getRequestValue(
  req,
  key
) {
  if (
    req?.body &&
    Object.prototype.hasOwnProperty.call(
      req.body,
      key
    )
  ) {
    return req.body[key];
  }

  if (
    req?.query &&
    Object.prototype.hasOwnProperty.call(
      req.query,
      key
    )
  ) {
    return req.query[key];
  }

  return undefined;
}

// ============================================================
// STANDARD API ERROR
// ============================================================

function sendApiError(
  res,
  status,
  error,
  message,
  extra = {}
) {
  return res
    .status(status)
    .json({
      success:
        false,

      error,

      message,

      ...extra,
    });
}

// ============================================================
// MAIN ROUTE ENDPOINT
// ============================================================

router.post(
  "/",
  async (
    req,
    res,
    next
  ) => {
    const timer =
      createPerformanceTimer();

    try {
      // ------------------------------------------------------
      // REQUEST
      // ------------------------------------------------------

      const origin =
        getRequestValue(
          req,
          "origin"
        );

      const destination =
        getRequestValue(
          req,
          "destination"
        );

      const profile =
        getRequestValue(
          req,
          "profile"
        );

      // ------------------------------------------------------
      // BASIC VALIDATION
      // ------------------------------------------------------

      if (
        origin ===
          undefined ||
        origin ===
          null
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_ORIGIN",
          "Origin is required."
        );
      }

      if (
        destination ===
          undefined ||
        destination ===
          null
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_DESTINATION",
          "Destination is required."
        );
      }

      if (
        typeof origin ===
          "string" &&
        !origin.trim()
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_ORIGIN",
          "Origin cannot be empty."
        );
      }

      if (
        typeof destination ===
          "string" &&
        !destination.trim()
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_DESTINATION",
          "Destination cannot be empty."
        );
      }

      // ------------------------------------------------------
      // COORDINATE OBJECT VALIDATION
      // ------------------------------------------------------

      if (
        typeof origin ===
          "object" &&
        origin !== null
      ) {
        const validation =
          parseCoordinateObject(
            origin
          );

        if (!validation) {
          return sendApiError(
            res,
            400,
            "INVALID_ORIGIN",
            "Origin contains invalid coordinates."
          );
        }
      }

      if (
        typeof destination ===
          "object" &&
        destination !== null
      ) {
        const validation =
          parseCoordinateObject(
            destination
          );

        if (!validation) {
          return sendApiError(
            res,
            400,
            "INVALID_DESTINATION",
            "Destination contains invalid coordinates."
          );
        }
      }

      // ------------------------------------------------------
      // PROFILE
      // ------------------------------------------------------

      const normalizedProfile =
        normalizeProfile(
          profile
        );

      if (
        profile !==
          undefined &&
        profile !==
          null
      ) {
        const rawProfile =
          String(
            profile
          )
            .trim()
            .toLowerCase();

        const validProfile =
          PROFILE_SENSITIVITY &&
          typeof PROFILE_SENSITIVITY ===
            "object" &&
          Object.prototype.hasOwnProperty.call(
            PROFILE_SENSITIVITY,
            rawProfile
          );

        if (
          !validProfile
        ) {
          return sendApiError(
            res,
            400,
            "INVALID_PROFILE",
            `Unsupported profile "${profile}".`
          );
        }
      }

      timer.mark(
        "validationEnd"
      );

      // ------------------------------------------------------
      // ORIGIN
      // ------------------------------------------------------

      timer.mark(
        "originStart"
      );

      let originCoords;

      try {
        originCoords =
          await resolveLocation(
            origin,
            "origin"
          );
      } catch (
        error
      ) {
        timer.mark(
          "originEnd"
        );

        console.error(
          "[routes] Origin resolution failed:",
          error.message
        );

        return res
          .status(422)
          .json({
            success:
              false,

            error:
              "ORIGIN_RESOLUTION_FAILED",

            message:
              error.message ||
              "Could not resolve origin.",
          });
      }

      timer.mark(
        "originEnd"
      );

      // ------------------------------------------------------
      // DESTINATION
      // ------------------------------------------------------

      timer.mark(
        "destinationStart"
      );

      let destinationCoords;

      try {
        destinationCoords =
          await resolveLocation(
            destination,
            "destination"
          );
      } catch (
        error
      ) {
        timer.mark(
          "destinationEnd"
        );

        console.error(
          "[routes] Destination resolution failed:",
          error.message
        );

        return res
          .status(422)
          .json({
            success:
              false,

            error:
              "DESTINATION_RESOLUTION_FAILED",

            message:
              error.message ||
              "Could not resolve destination.",
          });
      }

      timer.mark(
        "destinationEnd"
      );

      // ------------------------------------------------------
      // SAME LOCATION
      // ------------------------------------------------------

      if (
        areSameLocation(
          originCoords,
          destinationCoords
        )
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_ROUTE",
          "Origin and destination must be different locations."
        );
      }

      // ------------------------------------------------------
      // RESOLVED LOCATIONS LOG
      // ------------------------------------------------------

      console.log(
        "========================================"
      );

      console.log(
        "[routes] RESOLVED LOCATIONS"
      );

      console.log(
        "Origin:",
        originCoords
      );

      console.log(
        "Destination:",
        destinationCoords
      );

      console.log(
        "Profile:",
        normalizedProfile
      );

      console.log(
        "========================================"
      );

      // ------------------------------------------------------
      // ROUTING
      // ------------------------------------------------------

      timer.mark(
        "routingStart"
      );

      let rawRoutes;

      let mockMode =
        false;

      try {
        if (
          MOCK_MODE
        ) {
          console.log(
            "[routes] ROUTE_MOCK_MODE=true — using mock routes."
          );

          rawRoutes =
            generateMockRoutes(
              originCoords,
              destinationCoords
            );

          mockMode =
            true;
        } else {
          rawRoutes =
            await getRoutes(
              originCoords,
              destinationCoords
            );
        }
      } catch (
        routingError
      ) {
        timer.mark(
          "routingEnd"
        );

        console.error(
          "[routes] Routing failed:",
          routingError.message
        );

        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "ROUTING_FAILED",

            message:
              "Unable to calculate the route right now. Please try again.",
          });
      }

      timer.mark(
        "routingEnd"
      );

      // ------------------------------------------------------
      // ROUTING RESULT VALIDATION
      // ------------------------------------------------------

      if (
        !Array.isArray(
          rawRoutes
        ) ||
        rawRoutes.length ===
          0
      ) {
        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "NO_ROUTES",

            message:
              "The routing provider returned no routes.",
          });
      }

      // ------------------------------------------------------
      // NORMALIZE ROUTES
      // ------------------------------------------------------

      timer.mark(
        "normalizeStart"
      );

      const normalizedRoutes =
        rawRoutes.map(
          normalizeRoute
        );

      timer.mark(
        "normalizeEnd"
      );

      console.log(
        `[routes] Routing returned ${normalizedRoutes.length} route(s).`
      );

      // ------------------------------------------------------
      // ROUTE DATA VALIDATION
      // ------------------------------------------------------

      const invalidRoute =
        normalizedRoutes.find(
          (route) =>
            !route ||
            route.distanceMeters ===
              null ||
            route.durationSeconds ===
              null ||
            route.distanceMeters <
              0 ||
            route.durationSeconds <
              0
        );

      if (
        invalidRoute
      ) {
        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "INVALID_ROUTE_DATA",

            message:
              "The routing provider returned incomplete or invalid route data.",
          });
      }

      // ------------------------------------------------------
      // EXTREMELY LONG ROUTE CHECK
      // ------------------------------------------------------
      //
      // This remains intentionally strict.
      //
      // If this triggers after the geocoder fix,
      // then the actual trip is genuinely too long
      // for the current MVP analysis pipeline.
      // ------------------------------------------------------

      const longestRouteDistance =
        Math.max(
          ...normalizedRoutes.map(
            (route) =>
              Number(
                route?.distanceMeters
              ) || 0
          )
        );

      if (
        longestRouteDistance >
        MAX_ROUTE_DISTANCE_METERS
      ) {
        console.warn(
          `[routes] Route exceeds MVP limit: ${longestRouteDistance}m > ${MAX_ROUTE_DISTANCE_METERS}m`
        );

        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "ROUTE_TOO_LONG",

            message:
              "The selected trip is too long for the current AirRoute MVP analysis limit.",

            maxDistanceMeters:
              MAX_ROUTE_DISTANCE_METERS,

            requestedDistanceMeters:
              longestRouteDistance,
          });
      }

      // ------------------------------------------------------
      // GEOMETRY
      // ------------------------------------------------------

      timer.mark(
        "geometryStart"
      );

      const routesForScoring =
        normalizedRoutes.map(
          (
            route,
            index
          ) => ({
            ...route,

            routeIndex:
              index,

            polyline:
              ensureRoutePolyline(
                route
              ),
          })
        );

      timer.mark(
        "geometryEnd"
      );

      const missingPolyline =
        routesForScoring.find(
          (route) =>
            !route.polyline
        );

      if (
        missingPolyline
      ) {
        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "ROUTE_GEOMETRY_UNAVAILABLE",

            message:
              "The routing provider did not return usable route geometry for AQI analysis.",
          });
      }

      // ------------------------------------------------------
      // AQI + EXPOSURE SCORING
      // ------------------------------------------------------

      console.log(
        "========================================"
      );

      console.log(
        "[routes] Starting concurrent route scoring"
      );

      console.log(
        `[routes] Routes to score: ${routesForScoring.length}`
      );

      console.log(
        `[routes] Profile: ${normalizedProfile}`
      );

      console.log(
        "========================================"
      );

      timer.mark(
        "scoringStart"
      );

      let scoredRoutes;

      try {
        scoredRoutes =
          await scoreRoutes(
            routesForScoring,
            normalizedProfile
          );
      } catch (
        scoringError
      ) {
        timer.mark(
          "scoringEnd"
        );

        console.error(
          "[routes] Concurrent route scoring failed:",
          scoringError
        );

        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "ROUTE_SCORING_FAILED",

            message:
              "Routes were calculated, but AQI/exposure analysis failed.",
          });
      }

      timer.mark(
        "scoringEnd"
      );

      // ------------------------------------------------------
      // SCORING RESULT VALIDATION
      // ------------------------------------------------------

      if (
        !Array.isArray(
          scoredRoutes
        )
      ) {
        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "INVALID_SCORING_RESULT",

            message:
              "The exposure scoring service returned an invalid result.",
          });
      }

      console.log(
        `[routes] Concurrent scoring completed for ${scoredRoutes.length} route(s).`
      );


      // ============================================================
// AIRROUTE - AQI RUNTIME DEBUG
// ============================================================
//
// TEMPORARY DEBUG ONLY
//
// Purpose:
// Determine exactly where AQI becomes 0.
//
// We inspect the raw result returned by scoreRoutes()
// BEFORE route ranking and BEFORE buildCleanRoute().
//
// ============================================================

console.log(
  "\n================================================"
);

console.log(
  "        AIRROUTE AQI RUNTIME DEBUG"
);

console.log(
  "================================================"
);

console.log(
  `[AQI DEBUG] scoredRoutes count: ${
    Array.isArray(scoredRoutes)
      ? scoredRoutes.length
      : "NOT_ARRAY"
  }`
);

if (
  Array.isArray(scoredRoutes)
) {
  scoredRoutes.forEach(
    (
      route,
      index
    ) => {
      const aqiSummary =
        route?.aqiSummary ||
        null;

      const sampledAqiPoints =
        Array.isArray(
          route?.sampledAqiPoints
        )
          ? route.sampledAqiPoints
          : [];

      const validSampledAqi =
        sampledAqiPoints.filter(
          (sample) =>
            sample?.aqi !==
              null &&
            sample?.aqi !==
              undefined &&
            sample?.aqi !==
              "" &&
            Number.isFinite(
              Number(
                sample?.aqi
              )
            )
        );

      console.log(
        "\n----------------------------------------"
      );

      console.log(
        `[AQI DEBUG] ROUTE ${index + 1}`
      );

      console.log(
        "routeId:",
        route?.routeId ??
          route?.id ??
          null
      );

      console.log(
        "routeIndex:",
        route?.routeIndex ??
          index
      );

      console.log(
        "avgAqi:",
        route?.avgAqi
      );

      console.log(
        "averageAqi:",
        route?.averageAqi
      );

      console.log(
        "peakAqi:",
        route?.peakAqi
      );

      console.log(
        "aqiSummary:",
        aqiSummary
      );

      console.log(
        "aqiSummary.averageAqi:",
        aqiSummary?.averageAqi
      );

      console.log(
        "aqiSummary.peakAqi:",
        aqiSummary?.peakAqi
      );

      console.log(
        "aqiSummary.coveragePercent:",
        aqiSummary?.coveragePercent
      );

      console.log(
        "aqiSource:",
        route?.aqiSource
      );

      console.log(
        "aqiProvider:",
        route?.aqiProvider
      );

      console.log(
        "aqiStandard:",
        route?.aqiStandard
      );

      console.log(
        "scoringError:",
        route?.scoringError ??
          null
      );

      console.log(
        "sampledAqiPoints count:",
        sampledAqiPoints.length
      );

      console.log(
        "valid sampled AQI count:",
        validSampledAqi.length
      );

      console.log(
        "first 10 sampled AQI:",
        sampledAqiPoints
          .slice(
            0,
            10
          )
          .map(
            (sample) => ({
              lat:
                sample?.lat ??
                null,

              lng:
                sample?.lng ??
                null,

              aqi:
                sample?.aqi ??
                null,

              source:
                sample?.source ??
                null,

              provider:
                sample?.provider ??
                null,

              category:
                sample?.category ??
                null,

              confidence:
                sample?.confidence ??
                null,
            })
          )
      );

      console.log(
        "valid sampled AQI values:",
        validSampledAqi
          .slice(
            0,
            20
          )
          .map(
            (sample) =>
              Number(
                sample.aqi
              )
          )
      );

      console.log(
        "exposureScore:",
        route?.exposureScore
      );

      console.log(
        "exposureBand:",
        route?.exposureBand
      );

      console.log(
        "coverage:",
        route?.aqiCoverage ??
          route?.coverage ??
          aqiSummary?.coveragePercent ??
          null
      );

      console.log(
        "----------------------------------------"
      );
    }
  );
}

console.log(
  "================================================\n"
);

      // ------------------------------------------------------
      // RANKABLE ROUTES
      // ------------------------------------------------------

      const rankableRoutes =
        scoredRoutes.filter(
          (route) =>
            !route?.scoringError &&
            Number.isFinite(
              Number(
                route?.exposureScore
              )
            )
        );

      if (
        rankableRoutes.length ===
        0
      ) {
        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "ROUTE_SCORING_FAILED",

            message:
              "Routes were calculated, but no route has valid AQI/exposure data for recommendation.",
          });
      }

      // ------------------------------------------------------
      // AQI COVERAGE SAFETY
      // ------------------------------------------------------

      const reliableRankableRoutes =
        rankableRoutes.filter(
          (route) => {
            const coverage =
              finiteNumber(
                route?.aqiSummary
                  ?.coveragePercent ??
                  route?.aqiCoverage ??
                  route?.coverage
              );

            return (
              coverage !==
                null &&
              coverage >=
                MIN_AQI_COVERAGE_PERCENT
            );
          }
        );

      const hasReliableCoverageRoutes =
        reliableRankableRoutes.length >
        0;

      const routesForRanking =
        hasReliableCoverageRoutes
          ? reliableRankableRoutes
          : rankableRoutes;

      console.log(
        `[routes] Rankable routes: ${rankableRoutes.length}`
      );

      console.log(
        `[routes] Reliable AQI coverage routes: ${reliableRankableRoutes.length}`
      );

      console.log(
        `[routes] Ranking ${
          hasReliableCoverageRoutes
            ? "reliable-coverage routes"
            : "best available routes (degraded AQI coverage)"
        }`
      );

      // ------------------------------------------------------
      // RANKING INPUT
      // ------------------------------------------------------

      const recommendationInputs =
        routesForRanking.map(
          (
            route,
            index
          ) =>
            buildRecommendationInput(
              route,
              route.routeIndex ??
                index
            )
        );

      // ------------------------------------------------------
      // RANK ROUTES
      // ------------------------------------------------------

      console.log(
        "========================================"
      );

      console.log(
        "[routeRanking] Starting recommendation engine"
      );

      console.log(
        `[routeRanking] Routes: ${recommendationInputs.length}`
      );

      console.log(
        `[routeRanking] Profile: ${normalizedProfile}`
      );

      console.log(
        "========================================"
      );

      timer.mark(
        "rankingStart"
      );

      let ranking;

      try {
        ranking =
          rankRoutes(
            recommendationInputs,
            {
              profile:
                normalizedProfile,
            }
          );
      } catch (
        rankingError
      ) {
        timer.mark(
          "rankingEnd"
        );

        console.error(
          "[routes] Ranking failed:",
          rankingError
        );

        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "ROUTE_RANKING_FAILED",

            message:
              "Routes were calculated, but route ranking failed.",
          });
      }

      timer.mark(
        "rankingEnd"
      );

      const rankingRoutes =
        Array.isArray(
          ranking?.routes
        )
          ? ranking.routes
          : [];

      if (
        rankingRoutes.length ===
        0
      ) {
        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "NO_RANKED_ROUTES",

            message:
              "No ranked route was returned by the recommendation engine.",
          });
      }

      // ------------------------------------------------------
      // MATCH RANKING RESULTS
      // ------------------------------------------------------

      const rankingByIndex =
        new Map();

      for (
        const rankingRoute of
          rankingRoutes
      ) {
        rankingByIndex.set(
          rankingRoute.routeIndex,
          rankingRoute
        );
      }

      // ------------------------------------------------------
      // BUILD FINAL ROUTES
      // ------------------------------------------------------

      timer.mark(
        "finalBuildStart"
      );

      const finalRoutes =
        scoredRoutes.map(
          (
            route,
            index
          ) => {
            const routeIndex =
              route.routeIndex ??
              index;

            const rankingRoute =
              rankingByIndex.get(
                routeIndex
              );

            if (
              rankingRoute
            ) {
              return buildFinalRoute(
                route,
                rankingRoute,
                rankingRoute.rank ??
                  index + 1
              );
            }

            return {
              ...route,

              rank:
                null,

              recommendationRank:
                null,

              recommendationScore:
                null,

              recommendation:
                [],

              recommendationComponents:
                null,

              isRecommended:
                false,

              fastestScore:
                null,

              cleanestScore:
                null,

              balancedScore:
                null,

              rankingExposure:
                null,

              rankingAverageAqi:
                null,

              rankingPeakAqi:
                null,

              rankingHotspotCount:
                0,

              detourPercent:
                null,

              withinAcceptableDetour:
                false,

              criticalHotspot:
                false,
            };
          }
        );

      finalRoutes.sort(
        (a, b) => {
          const aRank =
            Number.isFinite(
              Number(
                a.rank
              )
            )
              ? Number(
                  a.rank
                )
              : Number.MAX_SAFE_INTEGER;

          const bRank =
            Number.isFinite(
              Number(
                b.rank
              )
            )
              ? Number(
                  b.rank
                )
              : Number.MAX_SAFE_INTEGER;

          return (
            aRank -
            bRank
          );
        }
      );

      // ------------------------------------------------------
      // DO NOT OVERRIDE RANKING DECISION
      // ------------------------------------------------------

      finalRoutes.forEach(
        (
          route
        ) => {
          if (
            route.rank !==
            null
          ) {
            route.rank =
              Number(
                route.rank
              );
          }

          route.isRecommended =
            route.isRecommended ===
              true ||
            route.recommended ===
              true;
        }
      );

      timer.mark(
        "finalBuildEnd"
      );

      // ------------------------------------------------------
      // RECOMMENDED ROUTE
      // ------------------------------------------------------

      const recommendedRoute =
        finalRoutes.find(
          (route) =>
            route.isRecommended ===
            true
        ) || null;

      const recommendedId =
        recommendedRoute?.id ||
        ranking?.recommendedRouteId ||
        null;

      // ------------------------------------------------------
      // AQI COVERAGE CHECK
      // ------------------------------------------------------

      const lowCoverageRoutes =
        finalRoutes.filter(
          (route) => {
            const coverage =
              finiteNumber(
                route?.aqiSummary
                  ?.coveragePercent ??
                  route?.aqiCoverage ??
                  route?.coverage
              );

            return (
              coverage ===
                null ||
              coverage <
                MIN_AQI_COVERAGE_PERCENT
            );
          }
        );

      const reliableCoverageRouteCount =
        finalRoutes.filter(
          (route) => {
            const coverage =
              finiteNumber(
                route?.aqiSummary
                  ?.coveragePercent ??
                  route?.aqiCoverage ??
                  route?.coverage
              );

            return (
              coverage !==
                null &&
              coverage >=
                MIN_AQI_COVERAGE_PERCENT
            );
          }
        ).length;

      const hasLowCoverage =
        lowCoverageRoutes.length >
        0;

      const coverageDegraded =
        reliableCoverageRouteCount ===
          0 &&
        finalRoutes.length >
          0;

      // ------------------------------------------------------
      // CLEAN FRONTEND ROUTES
      // ------------------------------------------------------

      const cleanRoutes =
        finalRoutes.map(
          buildCleanRoute
        );



        // ============================================================
// FINAL RESPONSE AQI DEBUG
// ============================================================

console.log(
  "\n================================================"
);

console.log(
  "        AIRROUTE FINAL AQI DEBUG"
);

console.log(
  "================================================"
);

console.table(
  cleanRoutes.map(
    (
      route,
      index
    ) => ({
      index,

      routeId:
        route?.routeId ??
        null,

      averageAqi:
        route?.airQuality
          ?.averageAqi ??
        null,

      peakAqi:
        route?.airQuality
          ?.peakAqi ??
        null,

      coverage:
        route?.airQuality
          ?.coverage ??
        null,

      exposure:
        route?.exposure
          ?.score ??
        null,

      provider:
        route?.airQuality
          ?.provider ??
        null,

      source:
        route?.airQuality
          ?.source ??
        null,
    })
  )
);

console.log(
  "================================================\n"
);

      const cleanRecommendedRoute =
        cleanRoutes.find(
          (route) =>
            route.recommended ===
            true
        ) || null;

      // ------------------------------------------------------
      // OVERALL ADVISORY
      // ------------------------------------------------------

      timer.mark(
        "advisoryStart"
      );

      let overallAdvisory =
        null;

      try {
        overallAdvisory =
          buildOverallAdvisory(
            cleanRoutes,
            cleanRecommendedRoute
          );
      } catch (
        advisoryError
      ) {
        console.warn(
          "[routes] Overall advisory failed:",
          advisoryError.message
        );
      }

      timer.mark(
        "advisoryEnd"
      );

      // ------------------------------------------------------
      // LOGGING
      // ------------------------------------------------------

      console.log(
        "\n========================================"
      );

      console.log(
        "       AIRROUTE ROUTE RESULT"
      );

      console.log(
        "========================================"
      );

      console.log(
        `Profile: ${normalizedProfile}`
      );

      console.log(
        `Routes: ${cleanRoutes.length}`
      );

      console.log(
        `Recommended Route: ${
          recommendedId ||
          "none"
        }`
      );

      console.log(
        `Mode: ${
          ranking?.recommendationMode ||
          ranking?.recommendationMethod ||
          "unknown"
        }`
      );

      console.log(
        `Reliable AQI coverage routes: ${
          reliableCoverageRouteCount
        }`
      );

      console.log(
        `Low AQI coverage routes: ${
          lowCoverageRoutes.length
        }`
      );

      console.log(
        `Coverage degraded: ${
          coverageDegraded
        }`
      );

      console.log(
        "----------------------------------------"
      );

      console.table(
        cleanRoutes.map(
          (route) => ({
            route:
              route.routeId,

            rank:
              route.rank,

            distanceKm:
              route.distance.km,

            timeMin:
              route.duration.minutes,

            avgAQI:
              route.airQuality.averageAqi,

            peakAQI:
              route.airQuality.peakAqi,

            coverage:
              route.airQuality.coverage,

            exposure:
              route.exposure.score,

            detour:
              route.detour.percent,

            hotspotCount:
              route.hotspots.count,

            hotspotPeak:
              route.hotspots.peakAqi,

            critical:
              route.hotspots.critical,

            recommended:
              route.recommended,
          })
        )
      );

      console.log(
        "========================================\n"
      );

      // ------------------------------------------------------
      // STORE CLEAN ROUTES
      // ------------------------------------------------------

      for (
        const route of
          cleanRoutes
      ) {
        if (
          route.routeId
        ) {
          storedRoutes[
            route.routeId
          ] = route;
        }
      }

      // ------------------------------------------------------
      // FINAL COORDINATES
      // ------------------------------------------------------

      const originParsed = {
        lat:
          Number(
            originCoords.lat
          ),

        lng:
          Number(
            originCoords.lng
          ),
      };

      const destinationParsed = {
        lat:
          Number(
            destinationCoords.lat
          ),

        lng:
          Number(
            destinationCoords.lng
          ),
      };

      // ------------------------------------------------------
      // RESPONSE
      // ------------------------------------------------------

      timer.mark(
        "responseStart"
      );

      const responsePayload = {
        success:
          true,

        origin:
          typeof origin ===
          "string"
            ? {
                input:
                  origin,

                resolvedAddress:
                  originCoords.formattedAddress ||
                  origin,

                lat:
                  originParsed.lat,

                lng:
                  originParsed.lng,

                source:
                  originCoords.source ??
                  null,

                placeId:
                  originCoords.placeId ??
                  null,

                country:
                  originCoords.country ??
                  "India",

                countryCode:
                  originCoords.countryCode ??
                  "IND",
              }
            : {
                ...originParsed,

                source:
                  originCoords.source ??
                  "coordinates",

                country:
                  originCoords.country ??
                  "India",

                countryCode:
                  originCoords.countryCode ??
                  "IND",
              },

        destination:
          typeof destination ===
          "string"
            ? {
                input:
                  destination,

                resolvedAddress:
                  destinationCoords.formattedAddress ||
                  destination,

                lat:
                  destinationParsed.lat,

                lng:
                  destinationParsed.lng,

                source:
                  destinationCoords.source ??
                  null,

                placeId:
                  destinationCoords.placeId ??
                  null,

                country:
                  destinationCoords.country ??
                  "India",

                countryCode:
                  destinationCoords.countryCode ??
                  "IND",
              }
            : {
                ...destinationParsed,

                source:
                  destinationCoords.source ??
                  "coordinates",

                country:
                  destinationCoords.country ??
                  "India",

                countryCode:
                  destinationCoords.countryCode ??
                  "IND",
              },

        profile:
          normalizedProfile,

        recommendation:
          cleanRecommendedRoute
            ? {
                routeId:
                  cleanRecommendedRoute.routeId,

                reason:
                  coverageDegraded
                    ? "Recommendation is based on limited AQI coverage."
                    : ranking?.reason ||
                      "Lowest estimated exposure among acceptable routes.",

                mode:
                  coverageDegraded
                    ? "degraded-aqi-coverage"
                    : ranking?.recommendationMode ||
                      ranking?.recommendationMethod ||
                      "constrained-exposure-minimization",

                coverageWarning:
                  coverageDegraded
                    ? "All available routes have AQI coverage below the recommended data-quality threshold."
                    : hasLowCoverage
                    ? "Some routes have limited AQI coverage and may be less reliable for comparison."
                    : null,
              }
            : null,

        advisory:
          overallAdvisory,

        routes:
          cleanRoutes,

        meta: {
          count:
            cleanRoutes.length,

          mockMode,

          geocodingCountry:
            GEOCODING_COUNTRY_CODE,

          aqiCoverageThreshold:
            MIN_AQI_COVERAGE_PERCENT,

          lowCoverageRouteCount:
            lowCoverageRoutes.length,

          reliableCoverageRouteCount,

          hasLowCoverage,

          coverageDegraded,

          generatedAt:
            new Date().toISOString(),
        },
      };

      timer.mark(
        "responseEnd"
      );

      timer.print();

      return res.json(
        responsePayload
      );
    } catch (
      error
    ) {
      timer.mark(
        "errorEnd"
      );

      timer.print();

      console.error(
        "[routes] Unexpected route API error:",
        error
      );

      next(error);
    }
  }
);

// ============================================================
// GEOCODE ENDPOINT
// ============================================================

router.post(
  "/geocode",
  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        address,
      } =
        req.body || {};

      if (
        !address ||
        typeof address !==
          "string" ||
        !address.trim()
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_ADDRESS",
          "address is required."
        );
      }

      try {
        const result =
          await geocode(
            address.trim()
          );

        return res.json({
          success:
            true,

          ...result,
        });
      } catch (
        geocodeError
      ) {
        console.error(
          "[routes] Geocoding failed:",
          geocodeError.message
        );

        return res
          .status(422)
          .json({
            success:
              false,

            error:
              "GEOCODING_FAILED",

            message:
              `Could not find "${address}". Please enter a more specific location.`,
          });
      }
    } catch (
      error
    ) {
      next(error);
    }
  }
);

// ============================================================
// GET STORED ROUTE
// ============================================================

router.get(
  "/:routeId",
  (
    req,
    res
  ) => {
    const {
      routeId,
    } =
      req.params;

    const route =
      storedRoutes[
        routeId
      ];

    if (!route) {
      return sendApiError(
        res,
        404,
        "ROUTE_NOT_FOUND",
        "Route not found."
      );
    }

    return res.json({
      success:
        true,

      route,
    });
  }
);

// ============================================================
// INTERNAL ACCESS
// ============================================================

router._store =
  storedRoutes;

router.getStore =
  () =>
    storedRoutes;

// ============================================================
// EXPORT
// ============================================================

module.exports =
  router;