const axios = require("axios");

const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";

const APP_NAME = process.env.APP_NAME || "AirRoute";
const APP_CONTACT =
  process.env.APP_CONTACT || "niranjankumarnb45@gmail.com";

const HEADERS = {
  "User-Agent": `${APP_NAME}/1.0 (${APP_CONTACT})`,
  Accept: "application/json",
};

console.log("Nominatim User-Agent:", HEADERS["User-Agent"]);

/**
 * Search an address or place name
 * @param {string} address
 * @returns {Promise<Object>}
 */
async function geocode(address) {
  try {
    if (!address || typeof address !== "string") {
      throw new Error("Address is required.");
    }

    const response = await axios.get(
      `${NOMINATIM_BASE_URL}/search`,
      {
        headers: HEADERS,
        params: {
          q: address,
          format: "jsonv2",
          limit: 1,
          addressdetails: 1,
        },
        timeout: 15000,
      }
    );

    if (!response.data || response.data.length === 0) {
      throw new Error(`No results found for "${address}"`);
    }

    const result = response.data[0];

    return {
      lat: Number(result.lat),
      lng: Number(result.lon),
      formattedAddress: result.display_name,
      placeId: `${result.osm_type}-${result.osm_id}`,
    };
  } catch (error) {
    console.error("[Nominatim] Geocoding Error:", error.message);

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    }

    if (error.config) {
      console.error("Request URL:", error.config.url);
      console.error("Request Headers:", error.config.headers);
    }

    throw error;
  }
}

/**
 * Reverse geocoding
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<Object>}
 */
async function reverseGeocode(lat, lng) {
  try {
    const response = await axios.get(
      `${NOMINATIM_BASE_URL}/reverse`,
      {
        headers: HEADERS,
        params: {
          lat,
          lon: lng,
          format: "jsonv2",
          addressdetails: 1,
        },
        timeout: 15000,
      }
    );

    if (!response.data) {
      throw new Error("Reverse geocoding failed.");
    }

    return {
      lat: Number(response.data.lat),
      lng: Number(response.data.lon),
      formattedAddress: response.data.display_name,
      placeId: response.data.osm_id
        ? `${response.data.osm_type}-${response.data.osm_id}`
        : null,
    };
  } catch (error) {
    console.error("[Nominatim] Reverse Geocoding Error:", error.message);

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    }

    if (error.config) {
      console.error("Request URL:", error.config.url);
      console.error("Request Headers:", error.config.headers);
    }

    throw error;
  }
}

module.exports = {
  geocode,
  reverseGeocode,
};