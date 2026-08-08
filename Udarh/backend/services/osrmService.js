const axios = require("axios");

const OSRM_BASE_URL =
  process.env.OSRM_BASE_URL || "https://router.project-osrm.org";

function normalizeLocation(location) {
  if (typeof location === "string") {
    throw new Error(
      "OSRM requires coordinates. Geocode addresses before calling getRoutes()."
    );
  }

  return {
    lat: Number(location.lat),
    lng: Number(location.lng),
  };
}

async function getRoutes(origin, destination) {
  try {
    origin = normalizeLocation(origin);
    destination = normalizeLocation(destination);

    const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

    const url = `${OSRM_BASE_URL}/route/v1/driving/${coordinates}`;

    const response = await axios.get(url, {
      params: {
        alternatives: true,
        overview: "full",
        geometries: "polyline",
        steps: true,
      },
      timeout: 15000,
    });

    if (response.data.code !== "Ok") {
      throw new Error(response.data.message || "OSRM routing failed.");
    }

    console.log("========== OSRM ==========");
    console.log("Routes Returned:", response.data.routes.length);

    response.data.routes.forEach((route, index) => {
      console.log(`Route ${index + 1}`);
      console.log("Geometry Length:", route.geometry.length);
      console.log(
        "Geometry Preview:",
        route.geometry.substring(0, 80)
      );
      console.log(
        "Distance:",
        Math.round(route.distance),
        "meters"
      );
      console.log(
        "Duration:",
        Math.round(route.duration),
        "seconds"
      );
    });

    console.log("==========================");

    return response.data.routes.map((route, idx) => {
      return {
        id: `route-${idx}-${Date.now()}`,

        summary: route.legs?.[0]?.summary || `Route ${idx + 1}`,

        distanceMeters: Math.round(route.distance),

        durationSeconds: Math.round(route.duration),

        polyline: route.geometry,

        legs: route.legs.map((leg) => ({
          startAddress: "",
          endAddress: "",

          startLocation: {
            lat: leg.steps[0].maneuver.location[1],
            lng: leg.steps[0].maneuver.location[0],
          },

          endLocation: {
            lat:
              leg.steps[leg.steps.length - 1].maneuver.location[1],
            lng:
              leg.steps[leg.steps.length - 1].maneuver.location[0],
          },

          distanceMeters: Math.round(leg.distance),

          durationSeconds: Math.round(leg.duration),

          steps: leg.steps.map((step) => ({
            distanceMeters: Math.round(step.distance),

            durationSeconds: Math.round(step.duration),

            startLocation: {
              lat: step.maneuver.location[1],
              lng: step.maneuver.location[0],
            },

            endLocation: {
              lat: step.maneuver.location[1],
              lng: step.maneuver.location[0],
            },

            polyline: route.geometry,

            htmlInstructions:
              step.maneuver.instruction ||
              `${step.maneuver.type} ${step.maneuver.modifier || ""}`,
          })),
        })),

        warnings: [],
      };
    });
  } catch (error) {
    console.error("[OSRM] Routing Error:", error.message);

    if (error.response) {
      console.error(error.response.data);
    }

    throw error;
  }
}

module.exports = {
  getRoutes,
};