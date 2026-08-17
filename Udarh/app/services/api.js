import { Platform } from "react-native";

// ============================================================
// AIRROUTE API CONFIGURATION
// ============================================================
//
// Android emulator:
//   10.0.2.2 → Windows host machine
//
// Physical Android device + USB:
//   adb reverse tcp:5000 tcp:5000
//   then 127.0.0.1:5000 can be used.
//
// We use 10.0.2.2 for Android emulator development.
// ============================================================

const DEV_BACKEND_URL =
  "http://127.0.0.1:5000";

const BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  DEV_BACKEND_URL;

// ============================================================
// DEBUG
// ============================================================

console.log(
  "[api] Platform:",
  Platform.OS
);

console.log(
  "[api] BASE_URL:",
  BASE_URL
);

// ============================================================
// REQUEST HELPER
// ============================================================

async function request(
  endpoint,
  options = {}
) {
  const url =
    `${BASE_URL}${endpoint}`;

  const config = {
    ...options,

    headers: {
      "Content-Type":
        "application/json",

      ...(options.headers || {}),
    },
  };

  // ----------------------------------------------------------
  // Convert object body to JSON
  // ----------------------------------------------------------

  if (
    config.body &&
    typeof config.body !== "string"
  ) {
    config.body =
      JSON.stringify(
        config.body
      );
  }

  console.log(
    `[api] ${
      config.method || "GET"
    } ${url}`
  );

  try {
    const response =
      await fetch(
        url,
        config
      );

    // --------------------------------------------------------
    // Response type
    // --------------------------------------------------------

    const contentType =
      response.headers.get(
        "content-type"
      );

    const isJson =
      contentType &&
      contentType.includes(
        "application/json"
      );

    const data = isJson
      ? await response.json()
      : await response.text();

    // --------------------------------------------------------
    // HTTP error
    // --------------------------------------------------------

    if (!response.ok) {
      const message =
        data &&
        typeof data === "object"
          ? data.message ||
            data.error
          : null;

      throw new Error(
        message ||
          `Request failed: ${response.status}`
      );
    }

    console.log(
      `[api] ${
        config.method || "GET"
      } ${endpoint} → ${
        response.status
      }`
    );

    return data;
  } catch (err) {
    console.error(
      `[api] ${
        config.method || "GET"
      } ${endpoint} FAILED`
    );

    console.error(
      "[api] URL:",
      url
    );

    console.error(
      "[api] Error:",
      err?.message ||
        err
    );

    throw err;
  }
}

// ============================================================
// API
// ============================================================

export const api = {
  // ----------------------------------------------------------
  // Health
  // ----------------------------------------------------------

  healthCheck: () =>
    request(
      "/health"
    ),

  // ----------------------------------------------------------
  // Routes
  // ----------------------------------------------------------

  getRoutes: ({
    origin,
    destination,
    profile = "normal",
  }) =>
    request(
      "/routes",
      {
        method: "POST",

        body: {
          origin,
          destination,
          profile,
        },
      }
    ),

  // ----------------------------------------------------------
  // Geocoding
  // ----------------------------------------------------------

  geocode: (
    address
  ) =>
    request(
      "/routes/geocode",
      {
        method: "POST",

        body: {
          address,
        },
      }
    ),

  // ----------------------------------------------------------
  // Route by ID
  // ----------------------------------------------------------

  getRouteById: (
    routeId
  ) =>
    request(
      `/routes/${routeId}`
    ),

  // ----------------------------------------------------------
  // AQI Grid
  // ----------------------------------------------------------

  getAqiGrid: () =>
    request(
      "/aqi-grid"
    ),

  // ----------------------------------------------------------
  // Advisory
  // ----------------------------------------------------------

  getAdvisory: ({
    routeId,
    profile,
    route,
  }) =>
    request(
      "/advisory",
      {
        method: "POST",

        body: {
          routeId,
          profile,
          route,
        },
      }
    ),
};

// ============================================================
// DEFAULT EXPORT
// ============================================================

export default api;