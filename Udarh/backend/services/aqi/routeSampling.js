// ============================================================
// AIRROUTE - ROUTE SAMPLING
// ============================================================
//
// Purpose:
// Convert an ORS route geometry into approximately 400m
// spaced sample points.
//
// Input:
// ORS route geometry
//
// Output:
// [
//   {
//     sampleIndex,
//     lat,
//     lng,
//     distanceMeters
//   },
//   ...
// ]
//
// IMPORTANT:
// This module does NOT call OpenAQ.
// This module does NOT calculate AQI.
// It only samples the actual route geometry.
// ============================================================

const DEFAULT_SAMPLE_DISTANCE_METERS = Number(
  process.env.AQI_ROUTE_SAMPLE_METERS || 400
);


// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function calculateDistanceMeters(
  lat1,
  lng1,
  lat2,
  lng2
) {
  const R = 6371000;

  const toRadians = (value) =>
    (value * Math.PI) / 180;

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);

  const deltaPhi = toRadians(
    lat2 - lat1
  );

  const deltaLambda = toRadians(
    lng2 - lng1
  );

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}


// ============================================================
// VALIDATE POINT
// ============================================================

function normalizePoint(point) {
  if (!point) {
    return null;
  }

  const lat = Number(
    point.lat ??
      point.latitude
  );

  const lng = Number(
    point.lng ??
      point.longitude
  );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  return {
    lat,
    lng,
  };
}


// ============================================================
// INTERPOLATE BETWEEN TWO COORDINATES
// ============================================================

function interpolatePoint(
  start,
  end,
  ratio
) {
  return {
    lat:
      start.lat +
      (end.lat - start.lat) *
        ratio,

    lng:
      start.lng +
      (end.lng - start.lng) *
        ratio,
  };
}


// ============================================================
// NORMALIZE ORS GEOMETRY
// ============================================================
//
// ORS normally returns:
// coordinates: [
//   [lng, lat],
//   [lng, lat]
// ]
//
// This function supports both:
// [lng, lat]
// and
// { lat, lng }
// ============================================================

function normalizeGeometry(
  geometry
) {
  if (!geometry) {
    return [];
  }

  let coordinates = geometry;

  if (
    !Array.isArray(
      coordinates
    )
  ) {
    coordinates =
      geometry.coordinates;
  }

  if (
    !Array.isArray(
      coordinates
    )
  ) {
    return [];
  }

  return coordinates
    .map((point) => {
      // ORS format: [lng, lat]
      if (
        Array.isArray(point) &&
        point.length >= 2
      ) {
        const lng =
          Number(point[0]);

        const lat =
          Number(point[1]);

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng)
        ) {
          return {
            lat,
            lng,
          };
        }

        return null;
      }

      // Generic object format
      return normalizePoint(
        point
      );
    })
    .filter(Boolean);
}


// ============================================================
// SAMPLE ROUTE
// ============================================================

function sampleRoute(
  geometry,
  options = {}
) {
  const sampleDistanceMeters =
    Number(
      options.sampleDistanceMeters ||
        DEFAULT_SAMPLE_DISTANCE_METERS
    );

  if (
    !Number.isFinite(
      sampleDistanceMeters
    ) ||
    sampleDistanceMeters <= 0
  ) {
    throw new Error(
      "sampleDistanceMeters must be greater than 0"
    );
  }

  const points =
    normalizeGeometry(
      geometry
    );

  if (
    points.length === 0
  ) {
    return [];
  }

  if (
    points.length === 1
  ) {
    return [
      {
        sampleIndex: 0,

        lat:
          points[0].lat,

        lng:
          points[0].lng,

        distanceMeters: 0,
      },
    ];
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  const samples = [];

  let accumulatedDistance =
    0;

  let nextSampleDistance = 0;

  let previousPoint =
    points[0];

  // Always include route start
  samples.push({
    sampleIndex: 0,

    lat:
      previousPoint.lat,

    lng:
      previousPoint.lng,

    distanceMeters: 0,
  });

  nextSampleDistance =
    sampleDistanceMeters;


  // ==========================================================
  // WALK THROUGH ROUTE GEOMETRY
  // ==========================================================

  for (
    let i = 1;
    i < points.length;
    i++
  ) {
    const currentPoint =
      points[i];

    const segmentDistance =
      calculateDistanceMeters(
        previousPoint.lat,
        previousPoint.lng,
        currentPoint.lat,
        currentPoint.lng
      );

    if (
      segmentDistance <= 0
    ) {
      previousPoint =
        currentPoint;

      continue;
    }

    const segmentStartDistance =
      accumulatedDistance;

    const segmentEndDistance =
      accumulatedDistance +
      segmentDistance;


    // ========================================================
    // CREATE ALL SAMPLE POINTS
    // THAT FALL INSIDE THIS SEGMENT
    // ========================================================

    while (
      nextSampleDistance <=
      segmentEndDistance
    ) {
      const distanceIntoSegment =
        nextSampleDistance -
        segmentStartDistance;

      const ratio =
        distanceIntoSegment /
        segmentDistance;

      const samplePoint =
        interpolatePoint(
          previousPoint,
          currentPoint,
          ratio
        );

      samples.push({
        sampleIndex:
          samples.length,

        lat:
          samplePoint.lat,

        lng:
          samplePoint.lng,

        distanceMeters:
          Math.round(
            nextSampleDistance
          ),
      });

      nextSampleDistance +=
        sampleDistanceMeters;
    }


    accumulatedDistance =
      segmentEndDistance;

    previousPoint =
      currentPoint;
  }


  // ==========================================================
  // ALWAYS INCLUDE DESTINATION
  // ==========================================================

  const destination =
    points[
      points.length - 1
    ];

  const totalDistance =
    accumulatedDistance;

  const lastSample =
    samples[
      samples.length - 1
    ];

  const distanceFromLastSample =
    totalDistance -
    lastSample.distanceMeters;

  /*
   * If destination isn't already
   * very close to the final sample,
   * append it.
   */

  if (
    distanceFromLastSample >
    1
  ) {
    samples.push({
      sampleIndex:
        samples.length,

      lat:
        destination.lat,

      lng:
        destination.lng,

      distanceMeters:
        Math.round(
          totalDistance
        ),
    });
  }

  return samples;
}


// ============================================================
// SAMPLE ROUTE WITH METADATA
// ============================================================

function sampleRouteWithMetadata(
  geometry,
  options = {}
) {
  const samples =
    sampleRoute(
      geometry,
      options
    );

  const totalDistance =
    samples.length > 0
      ? samples[
          samples.length - 1
        ].distanceMeters
      : 0;

  return {
    samples,

    sampleCount:
      samples.length,

    totalDistanceMeters:
      totalDistance,

    totalDistanceKm:
      Number(
        (
          totalDistance /
          1000
        ).toFixed(2)
      ),

    sampleSpacingMeters:
      Number(
        options.sampleDistanceMeters ||
          DEFAULT_SAMPLE_DISTANCE_METERS
      ),
  };
}


// ============================================================
// SAMPLE MULTIPLE ROUTES
// ============================================================

function sampleRoutes(
  routes,
  options = {}
) {
  if (
    !Array.isArray(routes)
  ) {
    throw new Error(
      "routes must be an array"
    );
  }

  return routes.map(
    (route, routeIndex) => {
      /*
       * Support common route formats:
       *
       * route.geometry
       * route.geometry.coordinates
       */

      const geometry =
        route?.geometry;

      const sampled =
        sampleRouteWithMetadata(
          geometry,
          options
        );

      return {
        ...route,

        routeIndex,

        aqiSamples:
          sampled.samples,

        aqiSampleCount:
          sampled.sampleCount,

        aqiSampleDistanceMeters:
          sampled.sampleSpacingMeters,

        sampledDistanceMeters:
          sampled.totalDistanceMeters,

        sampledDistanceKm:
          sampled.totalDistanceKm,
      };
    }
  );
}


// ============================================================
// TEST
// ============================================================

function testRouteSampling() {
  /*
   * Fake ORS-style geometry.
   *
   * This is ONLY for testing the
   * sampling algorithm.
   */

  const geometry = {
    type: "LineString",

    coordinates: [
      [77.2090, 28.6139],

      [77.2120, 28.6150],

      [77.2150, 28.6170],

      [77.2200, 28.6200],

      [77.2250, 28.6230],
    ],
  };


  const result =
    sampleRouteWithMetadata(
      geometry,
      {
        sampleDistanceMeters: 400,
      }
    );


  console.log(
    "\n================================="
  );

  console.log(
    "       ROUTE SAMPLING TEST"
  );

  console.log(
    "================================="
  );

  console.log(
    "Samples:",
    result.sampleCount
  );

  console.log(
    "Distance:",
    result.totalDistanceKm,
    "km"
  );

  console.log(
    "Spacing:",
    result.sampleSpacingMeters,
    "meters"
  );

  console.dir(
    result.samples,
    {
      depth: null,
    }
  );

  console.log(
    "=================================\n"
  );

  return result;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  calculateDistanceMeters,

  normalizeGeometry,

  interpolatePoint,

  sampleRoute,

  sampleRouteWithMetadata,

  sampleRoutes,

  testRouteSampling,
};