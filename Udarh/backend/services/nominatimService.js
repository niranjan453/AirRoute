const axios = require("axios");

// ============================================================
// CONFIGURATION
// ============================================================

const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ||
  "https://nominatim.openstreetmap.org";

const APP_NAME =
  process.env.APP_NAME || "AirRoute";

const APP_CONTACT =
  process.env.APP_CONTACT ||
  "niranjankumarnb45@gmail.com";

const HEADERS = {
  "User-Agent": `${APP_NAME}/1.0 (${APP_CONTACT})`,
  Accept: "application/json",
};

// Number of candidates to request from Nominatim
const SEARCH_LIMIT = Number(
  process.env.NOMINATIM_SEARCH_LIMIT || 5
);

// Request timeout
const REQUEST_TIMEOUT = Number(
  process.env.NOMINATIM_TIMEOUT_MS || 10000
);

console.log(
  "[Nominatim] User-Agent:",
  HEADERS["User-Agent"]
);

// ============================================================
// HELPERS
// ============================================================

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isValidCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Check whether Nominatim result belongs to India.
 */
function isIndiaResult(result) {
  const countryCode =
    result?.address?.country_code;

  if (
    countryCode &&
    countryCode.toLowerCase() === "in"
  ) {
    return true;
  }

  const country =
    normalizeText(
      result?.address?.country
    );

  return country === "india";
}

/**
 * Calculate a simple candidate score.
 *
 * We prefer:
 * - India result
 * - higher Nominatim importance
 * - exact query/name matches
 * - named places / POIs
 */
function scoreCandidate(
  result,
  originalQuery
) {
  let score = 0;

  const query =
    normalizeText(originalQuery);

  const displayName =
    normalizeText(
      result?.display_name
    );

  const name =
    normalizeText(
      result?.name
    );

  // ----------------------------------------------------------
  // India
  // ----------------------------------------------------------

  if (isIndiaResult(result)) {
    score += 100;
  }

  // ----------------------------------------------------------
  // Nominatim importance
  // ----------------------------------------------------------

  const importance =
    Number(result?.importance);

  if (
    Number.isFinite(importance)
  ) {
    score += importance * 30;
  }

  // ----------------------------------------------------------
  // Exact name match
  // ----------------------------------------------------------

  if (
    name &&
    query === name
  ) {
    score += 50;
  }

  // ----------------------------------------------------------
  // Name contains query
  // ----------------------------------------------------------

  if (
    name &&
    name.includes(query)
  ) {
    score += 30;
  }

  // ----------------------------------------------------------
  // Display name contains query
  // ----------------------------------------------------------

  if (
    displayName.includes(query)
  ) {
    score += 20;
  }

  // ----------------------------------------------------------
  // Useful POI types
  // ----------------------------------------------------------

  const type =
    normalizeText(
      result?.type
    );

  const category =
    normalizeText(
      result?.category
    );

  const usefulTypes = [
    "station",
    "railway",
    "airport",
    "terminal",
    "bus_station",
    "aerodrome",
    "place",
    "city",
    "town",
    "suburb",
  ];

  if (
    usefulTypes.includes(type)
  ) {
    score += 15;
  }

  if (
    category === "place" ||
    category === "railway" ||
    category === "aeroway"
  ) {
    score += 10;
  }

  return score;
}

// ============================================================
// FORMAT RESULT
// ============================================================

function formatGeocodeResult(
  result
) {
  const lat =
    Number(result?.lat);

  const lng =
    Number(result?.lon);

  if (
    !isValidCoordinate(
      lat,
      lng
    )
  ) {
    throw new Error(
      "Nominatim returned invalid coordinates."
    );
  }

  return {
    lat,
    lng,

    formattedAddress:
      result.display_name,

    placeId:
      result.osm_type &&
      result.osm_id
        ? `${result.osm_type}-${result.osm_id}`
        : null,

    name:
      result.name ||
      null,

    type:
      result.type ||
      null,

    category:
      result.category ||
      null,

    importance:
      Number.isFinite(
        Number(
          result.importance
        )
      )
        ? Number(
            result.importance
          )
        : null,

    address:
      result.address ||
      null,

    source:
      "nominatim",
  };
}

// ============================================================
// SEARCH NOMINATIM
// ============================================================

async function searchNominatim(
  query
) {
  const response =
    await axios.get(
      `${NOMINATIM_BASE_URL}/search`,
      {
        headers: HEADERS,

        params: {
          q: query,

          format: "jsonv2",

          limit: SEARCH_LIMIT,

          addressdetails: 1,

          // IMPORTANT:
          // Only return Indian results.
          countrycodes: "in",

          // Improve POI / station / airport results.
          dedupe: 1,

          extratags: 1,

          namedetails: 1,
        },

        timeout:
          REQUEST_TIMEOUT,
      }
    );

  if (
    !Array.isArray(
      response.data
    )
  ) {
    throw new Error(
      "Invalid response from Nominatim."
    );
  }

  return response.data;
}

// ============================================================
// GEOCODE
// ============================================================

async function geocode(
  address
) {
  if (
    !address ||
    typeof address !==
      "string" ||
    !address.trim()
  ) {
    throw new Error(
      "Address is required."
    );
  }

  const originalAddress =
    address.trim();

  console.log(
    `[Nominatim] Searching: "${originalAddress}"`
  );

  try {
    let results =
      await searchNominatim(
        originalAddress
      );

    // --------------------------------------------------------
    // If no result, retry with India appended.
    // --------------------------------------------------------

    if (
      results.length === 0 &&
      !normalizeText(
        originalAddress
      ).includes("india")
    ) {
      const retryQuery =
        `${originalAddress}, India`;

      console.log(
        `[Nominatim] No result. Retrying: "${retryQuery}"`
      );

      results =
        await searchNominatim(
          retryQuery
        );
    }

    if (
      !results ||
      results.length === 0
    ) {
      throw new Error(
        `No location found for "${originalAddress}".`
      );
    }

    // --------------------------------------------------------
    // Remove invalid/non-India results
    // --------------------------------------------------------

    const validResults =
      results.filter(
        (result) => {
          const lat =
            Number(result?.lat);

          const lng =
            Number(result?.lon);

          return (
            isIndiaResult(result) &&
            isValidCoordinate(
              lat,
              lng
            )
          );
        }
      );

    if (
      validResults.length === 0
    ) {
      throw new Error(
        `No valid Indian location found for "${originalAddress}".`
      );
    }

    // --------------------------------------------------------
    // Score candidates
    // --------------------------------------------------------

    const ranked =
      validResults
        .map(
          (result) => ({
            result,

            score:
              scoreCandidate(
                result,
                originalAddress
              ),
          })
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    const selected =
      ranked[0].result;

    const formatted =
      formatGeocodeResult(
        selected
      );

    console.log(
      `[Nominatim] Selected: ${formatted.formattedAddress}`
    );

    console.log(
      `[Nominatim] Coordinates: ${formatted.lat}, ${formatted.lng}`
    );

    console.log(
      `[Nominatim] Type: ${formatted.type || "unknown"}`
    );

    console.log(
      `[Nominatim] Candidates: ${validResults.length}`
    );

    return formatted;
  } catch (error) {
    console.error(
      "[Nominatim] Geocoding Error:",
      error.message
    );

    if (error.response) {
      console.error(
        "[Nominatim] Status:",
        error.response.status
      );

      console.error(
        "[Nominatim] Response:",
        error.response.data
      );
    }

    throw error;
  }
}

// ============================================================
// REVERSE GEOCODING
// ============================================================

async function reverseGeocode(
  lat,
  lng
) {
  const latitude =
    Number(lat);

  const longitude =
    Number(lng);

  if (
    !isValidCoordinate(
      latitude,
      longitude
    )
  ) {
    throw new Error(
      "Valid latitude and longitude are required."
    );
  }

  try {
    const response =
      await axios.get(
        `${NOMINATIM_BASE_URL}/reverse`,
        {
          headers: HEADERS,

          params: {
            lat: latitude,
            lon: longitude,

            format: "jsonv2",

            addressdetails: 1,

            zoom: 18,
          },

          timeout:
            REQUEST_TIMEOUT,
        }
      );

    if (
      !response.data
    ) {
      throw new Error(
        "Reverse geocoding failed."
      );
    }

    const result =
      response.data;

    const resultLat =
      Number(result.lat);

    const resultLng =
      Number(result.lon);

    if (
      !isValidCoordinate(
        resultLat,
        resultLng
      )
    ) {
      throw new Error(
        "Invalid coordinates returned by reverse geocoder."
      );
    }

    return {
      lat: resultLat,

      lng: resultLng,

      formattedAddress:
        result.display_name,

      placeId:
        result.osm_type &&
        result.osm_id
          ? `${result.osm_type}-${result.osm_id}`
          : null,

      name:
        result.name ||
        null,

      type:
        result.type ||
        null,

      category:
        result.category ||
        null,

      address:
        result.address ||
        null,

      source:
        "nominatim",
    };
  } catch (error) {
    console.error(
      "[Nominatim] Reverse Geocoding Error:",
      error.message
    );

    throw error;
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  geocode,
  reverseGeocode,
};