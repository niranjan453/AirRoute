const axios = require("axios");
const { encode } = require("@googlemaps/polyline-codec");

// ============================================================
// OPENROUTESERVICE CONFIGURATION
// ============================================================

const ORS_BASE_URL =
  process.env.ORS_BASE_URL ||
  "https://api.openrouteservice.org";

const ORS_API_KEY =
  process.env.ORS_API_KEY;

const ORS_PROFILE =
  process.env.ORS_PROFILE ||
  "driving-car";

// ============================================================
// ALTERNATIVE ROUTE LIMIT
// ============================================================

/*
 * OpenRouteService alternative routes have a server-side
 * distance restriction.
 *
 * ORS reports approximately 100 km as the maximum for the
 * alternative Routes algorithm.
 *
 * We intentionally use a lower safety threshold because
 * road distance can be considerably longer than straight-line
 * distance.
 */
const ORS_ALTERNATIVE_ROUTE_SAFE_LIMIT_METERS = 90000;

// ============================================================
// VALIDATION
// ============================================================

function validateCoordinates(
  location,
  name
) {
  if (
    !location ||
    typeof location !== "object"
  ) {
    throw new Error(
      `${name} coordinates are required.`
    );
  }

  const lat = Number(
    location.lat
  );

  const lng = Number(
    location.lng
  );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new Error(
      `${name} coordinates must contain valid lat and lng values.`
    );
  }

  if (
    lat < -90 ||
    lat > 90
  ) {
    throw new Error(
      `${name} latitude must be between -90 and 90.`
    );
  }

  if (
    lng < -180 ||
    lng > 180
  ) {
    throw new Error(
      `${name} longitude must be between -180 and 180.`
    );
  }

  return {
    lat,
    lng,
  };
}

// ============================================================
// LOCATION NORMALIZATION
// ============================================================

function normalizeLocation(
  location,
  name
) {
  if (
    typeof location === "string"
  ) {
    throw new Error(
      `${name} must be coordinates. Geocode the address before calling getRoutes().`
    );
  }

  return validateCoordinates(
    location,
    name
  );
}

// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function calculateApproximateDistanceMeters(
  origin,
  destination
) {
  const EARTH_RADIUS_METERS =
    6371000;

  const lat1 =
    origin.lat *
    Math.PI /
    180;

  const lat2 =
    destination.lat *
    Math.PI /
    180;

  const deltaLat =
    (destination.lat -
      origin.lat) *
    Math.PI /
    180;

  const deltaLng =
    (destination.lng -
      origin.lng) *
    Math.PI /
    180;

  const a =
    Math.sin(
      deltaLat / 2
    ) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(
        deltaLng / 2
      ) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return (
    EARTH_RADIUS_METERS *
    c
  );
}

// ============================================================
// POLYLINE CONVERSION
// ============================================================

function encodeCoordinates(
  coordinates
) {
  if (
    !Array.isArray(
      coordinates
    ) ||
    coordinates.length < 2
  ) {
    return "";
  }

  /*
   * ORS coordinates:
   * [lng, lat]
   *
   * Google polyline codec:
   * [lat, lng]
   */
  const latLngPoints =
    coordinates.map(
      ([lng, lat]) => [
        lat,
        lng,
      ]
    );

  return encode(
    latLngPoints,
    5
  );
}

// ============================================================
// STEP LOCATION
// ============================================================

function getStepLocation(
  step,
  geometryCoordinates
) {
  /*
   * ORS step usually contains
   * way_points: [startIndex, endIndex]
   *
   * Geometry coordinates are:
   * [lng, lat]
   */

  if (
    Array.isArray(
      step.way_points
    ) &&
    step.way_points.length >= 2 &&
    Array.isArray(
      geometryCoordinates
    )
  ) {
    const startIndex =
      step.way_points[0];

    const endIndex =
      step.way_points[1];

    const start =
      geometryCoordinates[
        startIndex
      ];

    const end =
      geometryCoordinates[
        endIndex
      ];

    if (
      Array.isArray(start) &&
      Array.isArray(end)
    ) {
      return {
        startLocation: {
          lat: Number(
            start[1]
          ),

          lng: Number(
            start[0]
          ),
        },

        endLocation: {
          lat: Number(
            end[1]
          ),

          lng: Number(
            end[0]
          ),
        },
      };
    }
  }

  return {
    startLocation: null,

    endLocation: null,
  };
}

// ============================================================
// STEP NORMALIZATION
// ============================================================

function normalizeStep(
  step,
  geometryCoordinates
) {
  const {
    startLocation,
    endLocation,
  } = getStepLocation(
    step,
    geometryCoordinates
  );

  return {
    distanceMeters: Math.round(
      Number(
        step.distance || 0
      )
    ),

    durationSeconds: Math.round(
      Number(
        step.duration || 0
      )
    ),

    startLocation,

    endLocation,

    polyline: "",

    htmlInstructions:
      step.instruction ||
      `${step.type || "Continue"} ${
        step.maneuver &&
        step.maneuver.modifier
          ? step.maneuver
              .modifier
          : ""
      }`.trim(),
  };
}

// ============================================================
// SEGMENT NORMALIZATION
// ============================================================

function normalizeSegment(
  segment,
  geometryCoordinates
) {
  const steps =
    Array.isArray(
      segment.steps
    )
      ? segment.steps.map(
          (step) =>
            normalizeStep(
              step,
              geometryCoordinates
            )
        )
      : [];

  const firstStep =
    segment.steps?.[0];

  const lastStep =
    segment.steps?.[
      segment.steps.length - 1
    ];

  let startLocation =
    null;

  let endLocation =
    null;

  if (
    firstStep
  ) {
    const first =
      getStepLocation(
        firstStep,
        geometryCoordinates
      );

    startLocation =
      first.startLocation;
  }

  if (
    lastStep
  ) {
    const last =
      getStepLocation(
        lastStep,
        geometryCoordinates
      );

    endLocation =
      last.endLocation;
  }

  return {
    startAddress: "",

    endAddress: "",

    startLocation,

    endLocation,

    distanceMeters:
      Math.round(
        Number(
          segment.distance || 0
        )
      ),

    durationSeconds:
      Math.round(
        Number(
          segment.duration || 0
        )
      ),

    steps,
  };
}

// ============================================================
// ROUTE NORMALIZATION
// ============================================================

function normalizeRoute(
  route,
  index
) {
  const summary =
    route.summary || {};

  const geometry =
    route.geometry || "";

  /*
   * ORS JSON response normally returns
   * encoded polyline geometry.
   */
  let polyline = geometry;

  /*
   * If geometry is somehow returned as
   * coordinates, convert it to polyline.
   */
  if (
    Array.isArray(
      geometry
    )
  ) {
    polyline =
      encodeCoordinates(
        geometry
      );
  }

  /*
   * Try to decode geometry only when
   * coordinates are available.
   */
  let geometryCoordinates =
    [];

  if (
    Array.isArray(
      route.geometry
    )
  ) {
    geometryCoordinates =
      route.geometry;
  }

  const segments =
    Array.isArray(
      route.segments
    )
      ? route.segments.map(
          (segment) =>
            normalizeSegment(
              segment,
              geometryCoordinates
            )
        )
      : [];

  return {
    id: `route-${index}-${Date.now()}`,

    summary:
      `Route ${index + 1}`,

    distanceMeters:
      Math.round(
        Number(
          summary.distance || 0
        )
      ),

    durationSeconds:
      Math.round(
        Number(
          summary.duration || 0
        )
      ),

    polyline,

    legs: segments,

    warnings: [],

    routingProvider:
      "openrouteservice",

    routingProfile:
      ORS_PROFILE,
  };
}

// ============================================================
// ORS REQUEST
// ============================================================

async function requestRoutes(
  url,
  coordinates,
  useAlternatives
) {
  const requestBody = {
    coordinates,

    instructions:
      true,

    instructions_format:
      "text",
  };

  /*
   * Only request alternative routes
   * when the distance is within the
   * safe ORS limit.
   */
  if (
    useAlternatives
  ) {
    requestBody.alternative_routes = {
      target_count: 3,

      share_factor: 0.6,

      weight_factor: 1.4,
    };
  }

  return axios.post(
    url,
    requestBody,
    {
      headers: {
        Authorization:
          ORS_API_KEY,

        "Content-Type":
          "application/json",

        Accept:
          "application/json",
      },

      timeout: 15000,
    }
  );
}

// ============================================================
// GET ROUTES
// ============================================================

async function getRoutes(
  origin,
  destination
) {
  if (!ORS_API_KEY) {
    throw new Error(
      "ORS_API_KEY is not configured."
    );
  }

  const normalizedOrigin =
    normalizeLocation(
      origin,
      "Origin"
    );

  const normalizedDestination =
    normalizeLocation(
      destination,
      "Destination"
    );

  /*
   * ORS expects:
   *
   * [longitude, latitude]
   */
  const coordinates = [
    [
      normalizedOrigin.lng,
      normalizedOrigin.lat,
    ],
    [
      normalizedDestination.lng,
      normalizedDestination.lat,
    ],
  ];

  const url =
    `${ORS_BASE_URL}/v2/directions/${ORS_PROFILE}`;

  /*
   * Calculate straight-line distance.
   *
   * This is only used to decide whether
   * requesting alternatives is safe.
   */
  const approximateDistanceMeters =
    calculateApproximateDistanceMeters(
      normalizedOrigin,
      normalizedDestination
    );

  const approximateDistanceKm =
    approximateDistanceMeters /
    1000;

  /*
   * Decide whether alternatives should
   * be requested.
   */
  const shouldRequestAlternatives =
    approximateDistanceMeters <=
    ORS_ALTERNATIVE_ROUTE_SAFE_LIMIT_METERS;

  console.log(
    "========== OpenRouteService =========="
  );

  console.log(
    "Profile:",
    ORS_PROFILE
  );

  console.log(
    "Origin:",
    normalizedOrigin
  );

  console.log(
    "Destination:",
    normalizedDestination
  );

  console.log(
    "Approximate straight-line distance:",
    `${approximateDistanceKm.toFixed(2)} km`
  );

  console.log(
    "Alternative routes:",
    shouldRequestAlternatives
      ? "ENABLED"
      : "DISABLED"
  );

  if (
    !shouldRequestAlternatives
  ) {
    console.log(
      "[OpenRouteService] Trip is too long for safe alternative-route request."
    );

    console.log(
      "[OpenRouteService] Requesting single standard route."
    );
  }

  try {
    let response;

    try {
      response =
        await requestRoutes(
          url,
          coordinates,
          shouldRequestAlternatives
        );
    } catch (error) {
      /*
       * ORS can still reject an alternative
       * request near the server-side limit.
       *
       * If ORS returns error 2004, retry
       * once without alternative routes.
       */
      const orsCode =
        error?.response?.data
          ?.error?.code;

      if (
        shouldRequestAlternatives &&
        orsCode === 2004
      ) {
        console.warn(
          "[OpenRouteService] Alternative-route request exceeded ORS distance limit."
        );

        console.warn(
          "[OpenRouteService] Retrying with a standard route."
        );

        response =
          await requestRoutes(
            url,
            coordinates,
            false
          );
      } else {
        throw error;
      }
    }

    if (
      !response.data
    ) {
      throw new Error(
        "Empty response received from OpenRouteService."
      );
    }

    if (
      !Array.isArray(
        response.data.routes
      ) ||
      response.data.routes.length ===
        0
    ) {
      throw new Error(
        "OpenRouteService returned no routes."
      );
    }

    const routes =
      response.data.routes.map(
        (
          route,
          index
        ) =>
          normalizeRoute(
            route,
            index
          )
      );

    console.log(
      "Routes Returned:",
      routes.length
    );

    routes.forEach(
      (
        route,
        index
      ) => {
        console.log(
          `Route ${index + 1}:`,
          Math.round(
            route.distanceMeters
          ),
          "meters /",
          Math.round(
            route.durationSeconds
          ),
          "seconds"
        );
      }
    );

    console.log(
      "======================================"
    );

    return routes;
  } catch (error) {
    console.error(
      "[OpenRouteService] Routing Error:",
      error.message
    );

    if (
      error.response
    ) {
      console.error(
        "[OpenRouteService] Status:",
        error.response.status
      );

      console.error(
        "[OpenRouteService] Response:",
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
// EXPORTS
// ============================================================

module.exports = {
  getRoutes,
};