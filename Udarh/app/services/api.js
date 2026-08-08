import { Platform } from "react-native";

const DEV_BACKEND_URL = "http://192.168.1.54:5000";
const BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL || DEV_BACKEND_URL;

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;

  const config = {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  };

  if (options.body && typeof options.body !== "string") {
    config.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, config);

    const contentType = response.headers.get("content-type");

    const isJson =
      contentType && contentType.includes("application/json");

    const data = isJson
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      throw new Error(
        data?.message ||
          data?.error ||
          `Request failed: ${response.status}`
      );
    }

    return data;
  } catch (err) {
    console.error(
      `[api] ${options.method || "GET"} ${endpoint}`,
      err.message
    );
    throw err;
  }
}

export const api = {
  healthCheck: () => request("/health"),

  getRoutes: ({ origin, destination, profile }) =>
    request("/routes", {
      method: "POST",
      body: { origin, destination, profile },
    }),

  geocode: (address) =>
    request("/routes/geocode", {
      method: "POST",
      body: { address },
    }),

  getRouteById: (routeId) =>
    request(`/routes/${routeId}`),

  getAqiGrid: () =>
    request("/aqi-grid"),

  getAdvisory: ({ routeId, profile, route }) =>
    request("/advisory", {
      method: "POST",
      body: { routeId, profile, route },
    }),
};

export default api;