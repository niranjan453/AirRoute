const axios = require("axios");

// ============================================================
// HEIGIT / OPENROUTESERVICE GEOCODING
// ============================================================
//
// Current HeiGIT migration:
// api.openrouteservice.org/geocode
//        ↓
// api.heigit.org/pelias/v1
//
// ============================================================

const GEOCODING_BASE_URL =
  process.env.GEOCODING_BASE_URL ||
  "https://api.heigit.org/pelias/v1";

const API_KEY =
  process.env.ORS_API_KEY;

const REQUEST_TIMEOUT = Number(
  process.env.GEOCODING_TIMEOUT_MS || 8000
);

const SEARCH_LIMIT = Number(
  process.env.GEOCODING_SEARCH_LIMIT || 5
);

// ============================================================
// VALIDATION
// ============================================================

function isValidCoordinate(
  lat,
  lng
) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// ============================================================
// RESULT NORMALIZATION
// ============================================================

function normalizeResult(
  feature
) {
  const coordinates =
    feature?.geometry?.coordinates;

  if (
    !Array.isArray(
      coordinates
    ) ||
    coordinates.length < 2
  ) {
    return null;
  }

  // GeoJSON:
  // [longitude, latitude]

  const lng =
    Number(coordinates[0]);

  const lat =
    Number(coordinates[1]);

  if (
    !isValidCoordinate(
      lat,
      lng
    )
  ) {
    return null;
  }

  const properties =
    feature?.properties || {};

  return {
    lat,
    lng,

    formattedAddress:
      properties.label ||
      null,

    placeId:
      properties.id ||
      null,

    name:
      properties.name ||
      null,

    type:
      properties.layer ||
      null,

    source:
      "heigit",
  };
}

// ============================================================
// FORWARD GEOCODING
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

  if (!API_KEY) {
    throw new Error(
      "ORS_API_KEY is not configured."
    );
  }

  const query =
    address.trim();

  console.log(
    `[Geocoder] Searching: "${query}"`
  );

  try {
    const response =
      await axios.get(
        `${GEOCODING_BASE_URL}/search`,
        {
          headers: {
            Authorization:
              API_KEY,

            Accept:
              "application/json",
          },

          params: {
            text:
              `${query}, India`,

            size:
              SEARCH_LIMIT,

            lang:
              "en",

            "boundary.country":
              "IND",
          },

          timeout:
            REQUEST_TIMEOUT,
        }
      );

    const features =
      Array.isArray(
        response.data?.features
      )
        ? response.data.features
        : [];

    if (
      features.length === 0
    ) {
      throw new Error(
        `No location found for "${query}".`
      );
    }

    const candidates =
      features
        .map(
          normalizeResult
        )
        .filter(Boolean);

    if (
      candidates.length === 0
    ) {
      throw new Error(
        `No valid coordinates found for "${query}".`
      );
    }

    const selected =
      candidates[0];

    console.log(
      `[Geocoder] Selected: ${
        selected.formattedAddress ||
        selected.name ||
        query
      }`
    );

    console.log(
      `[Geocoder] Coordinates: ${selected.lat}, ${selected.lng}`
    );

    return selected;
  } catch (error) {
    console.error(
      "[Geocoder] Error:",
      error.message
    );

    if (
      error.response
    ) {
      console.error(
        "[Geocoder] Status:",
        error.response.status
      );

      console.error(
        "[Geocoder] Response:",
        JSON.stringify(
          error.response.data,
          null,
          2
        )
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
  if (!API_KEY) {
    throw new Error(
      "ORS_API_KEY is not configured."
    );
  }

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
      "Invalid coordinates."
    );
  }

  try {
    const response =
      await axios.get(
        `${GEOCODING_BASE_URL}/reverse`,
        {
          headers: {
            Authorization:
              API_KEY,

            Accept:
              "application/json",
          },

          params: {
            point:
              `${longitude},${latitude}`,

            lang:
              "en",
          },

          timeout:
            REQUEST_TIMEOUT,
        }
      );

    const feature =
      response.data?.features?.[0];

    if (!feature) {
      throw new Error(
        "No reverse geocoding result."
      );
    }

    const result =
      normalizeResult(
        feature
      );

    if (!result) {
      throw new Error(
        "Invalid reverse geocoding result."
      );
    }

    return result;
  } catch (error) {
    console.error(
      "[Geocoder] Reverse error:",
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