"use strict";

const express = require("express");

const router =
  express.Router();

// ============================================================
// AIRROUTE - ADVISORY ROUTE
// ============================================================
//
// DAY 8
//
// The advisory endpoint uses the SAME advisory engine used by
// the main route-ranking flow.
//
// Source of truth:
//
//   routeAdvisory.js
//
// No duplicate advisory logic is maintained here.
//
// Architecture:
//
//   /routes
//       ↓
//   routeAdvisory.js
//
//   /advisory
//       ↓
//   routeAdvisory.js
//
// DAY 8 HARDENING:
//
// - Request validation
// - Route validation
// - routeId validation
// - routes collection validation
// - referenceRoute validation
// - Standard API errors
// - Safe production error responses
// - Ranking engine remains authoritative
// ============================================================

const {
  buildRouteAdvisory,
  buildOverallAdvisory,
} = require(
  "../services/advisory/routeAdvisory"
);

// ============================================================
// ROUTE STORE
// ============================================================
//
// route.js exposes its in-memory route store through getStore().
//
// We use it only when the client provides routeId and does not
// provide the complete route object.
//
// ============================================================

let routeModuleStore =
  null;

try {
  const routeModule =
    require("./route");

  if (
    routeModule &&
    typeof routeModule.getStore ===
      "function"
  ) {
    routeModuleStore =
      routeModule.getStore;
  }
} catch (error) {
  console.warn(
    "[advisory] Route module store unavailable:",
    error.message
  );
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
// GET ROUTE FROM STORE
// ============================================================

function getStoredRoute(
  routeId
) {
  if (
    !routeModuleStore ||
    !routeId
  ) {
    return null;
  }

  try {
    const store =
      routeModuleStore();

    if (
      !store ||
      typeof store !==
        "object"
    ) {
      return null;
    }

    return (
      store[routeId] ||
      null
    );
  } catch (error) {
    console.warn(
      "[advisory] Could not read route store:",
      error.message
    );

    return null;
  }
}

// ============================================================
// GET ROUTE ID
// ============================================================

function getRouteId(
  route
) {
  if (
    !route ||
    typeof route !==
      "object" ||
    Array.isArray(route)
  ) {
    return null;
  }

  return (
    route.routeId ??
    route.id ??
    null
  );
}

// ============================================================
// ROUTE OBJECT VALIDATION
// ============================================================
//
// A route must be a plain object.
//
// Arrays, strings, numbers, null, etc. are invalid.
//
// ============================================================

function isValidRouteObject(
  route
) {
  return (
    route !== null &&
    typeof route ===
      "object" &&
    !Array.isArray(route)
  );
}

// ============================================================
// ROUTE ID VALIDATION
// ============================================================

function normalizeRouteId(
  routeId
) {
  if (
    typeof routeId !==
    "string"
  ) {
    return null;
  }

  const normalized =
    routeId.trim();

  return normalized
    ? normalized
    : null;
}

// ============================================================
// PROFILE NORMALIZATION
// ============================================================
//
// Advisory-specific profile validation is intentionally not
// duplicated here because the authoritative profile definitions
// live elsewhere in the route/exposure system.
//
// We normalize the value consistently.
//
// ============================================================

function normalizeProfile(
  profile
) {
  return String(
    profile ||
      "normal"
  )
    .trim()
    .toLowerCase();
}

// ============================================================
// REQUEST BODY VALIDATION
// ============================================================

function validateRequestBody(
  body
) {
  if (
    body === null ||
    body === undefined
  ) {
    return {
      valid: false,

      error:
        "INVALID_REQUEST_BODY",

      message:
        "Request body is required.",
    };
  }

  if (
    typeof body !==
      "object" ||
    Array.isArray(body)
  ) {
    return {
      valid: false,

      error:
        "INVALID_REQUEST_BODY",

      message:
        "Request body must be a JSON object.",
    };
  }

  return {
    valid: true,
  };
}

// ============================================================
// VALIDATE REFERENCE ROUTE
// ============================================================

function validateReferenceRoute(
  referenceRoute
) {
  if (
    referenceRoute ===
      undefined ||
    referenceRoute ===
      null
  ) {
    return {
      valid: true,

      value: null,
    };
  }

  if (
    !isValidRouteObject(
      referenceRoute
    )
  ) {
    return {
      valid: false,

      error:
        "INVALID_REFERENCE_ROUTE",

      message:
        "referenceRoute must be a valid route object.",
    };
  }

  return {
    valid: true,

    value:
      referenceRoute,
  };
}

// ============================================================
// VALIDATE ROUTE COLLECTION
// ============================================================

function validateRouteCollection(
  routes
) {
  if (
    routes ===
      undefined ||
    routes ===
      null
  ) {
    return {
      valid: true,

      value: null,
    };
  }

  if (
    !Array.isArray(
      routes
    )
  ) {
    return {
      valid: false,

      error:
        "INVALID_ROUTES",

      message:
        "routes must be an array.",
    };
  }

  if (
    routes.length ===
    0
  ) {
    return {
      valid: false,

      error:
        "INVALID_ROUTES",

      message:
        "routes must contain at least one route.",
    };
  }

  const invalidIndex =
    routes.findIndex(
      (item) =>
        !isValidRouteObject(
          item
        )
    );

  if (
    invalidIndex !==
    -1
  ) {
    return {
      valid: false,

      error:
        "INVALID_ROUTES",

      message:
        `routes[${invalidIndex}] must be a valid route object.`,
    };
  }

  return {
    valid: true,

    value:
      routes,
  };
}

// ============================================================
// FIND RECOMMENDED ROUTE
// ============================================================
//
// IMPORTANT:
//
// This endpoint does NOT decide recommendation based on array
// position or rank.
//
// The ranking engine remains authoritative.
//
// ============================================================

function findRecommendedRoute(
  routeCollection,
  fallbackRoute
) {
  if (
    !Array.isArray(
      routeCollection
    )
  ) {
    return (
      fallbackRoute ||
      null
    );
  }

  const recommended =
    routeCollection.find(
      (item) =>
        item?.isRecommended ===
          true ||
        item?.recommended ===
          true
    );

  return (
    recommended ||
    fallbackRoute ||
    null
  );
}

// ============================================================
// POST /
// ============================================================
//
// Supported request:
//
// {
//   "routeId": "route-0-123",
//   "profile": "normal"
// }
//
// OR:
//
// {
//   "route": { ... },
//   "profile": "normal"
// }
//
// OR:
//
// {
//   "routeId": "route-0-123",
//   "route": { ... },
//   "profile": "normal"
// }
//
// OR:
//
// {
//   "route": { ... },
//   "routes": [ ... ],
//   "referenceRoute": { ... },
//   "profile": "normal"
// }
//
// ============================================================

router.post(
  "/",
  (
    req,
    res
  ) => {
    try {
      // --------------------------------------------------------
      // REQUEST BODY
      // --------------------------------------------------------

      const body =
        req.body;

      const bodyValidation =
        validateRequestBody(
          body
        );

      if (
        !bodyValidation.valid
      ) {
        return sendApiError(
          res,
          400,
          bodyValidation.error,
          bodyValidation.message
        );
      }

      const {
        routeId:
          rawRouteId,
        profile =
          "normal",
        route,
        referenceRoute,
        routes,
      } = body;

      // --------------------------------------------------------
      // NORMALIZE ROUTE ID
      // --------------------------------------------------------

      const routeId =
        normalizeRouteId(
          rawRouteId
        );

      // --------------------------------------------------------
      // ROUTE ID TYPE VALIDATION
      // --------------------------------------------------------

      if (
        rawRouteId !==
          undefined &&
        rawRouteId !==
          null &&
        routeId ===
          null
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_ROUTE_ID",
          "routeId must be a non-empty string."
        );
      }

      // --------------------------------------------------------
      // ROUTE OBJECT VALIDATION
      // --------------------------------------------------------

      if (
        route !==
          undefined &&
        route !==
          null &&
        !isValidRouteObject(
          route
        )
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_ROUTE",
          "route must be a valid route object."
        );
      }

      // --------------------------------------------------------
      // REFERENCE ROUTE VALIDATION
      // --------------------------------------------------------

      const referenceValidation =
        validateReferenceRoute(
          referenceRoute
        );

      if (
        !referenceValidation.valid
      ) {
        return sendApiError(
          res,
          400,
          referenceValidation.error,
          referenceValidation.message
        );
      }

      // --------------------------------------------------------
      // ROUTE COLLECTION VALIDATION
      // --------------------------------------------------------

      const routesValidation =
        validateRouteCollection(
          routes
        );

      if (
        !routesValidation.valid
      ) {
        return sendApiError(
          res,
          400,
          routesValidation.error,
          routesValidation.message
        );
      }

      const routeCollection =
        routesValidation.value;

      // --------------------------------------------------------
      // RESOLVE ROUTE
      // --------------------------------------------------------

      let routeData =
        route || null;

      // --------------------------------------------------------
      // STORED ROUTE FALLBACK
      // --------------------------------------------------------

      if (
        !routeData &&
        routeId
      ) {
        routeData =
          getStoredRoute(
            routeId
          );
      }

      // --------------------------------------------------------
      // ROUTE NOT FOUND
      // --------------------------------------------------------

      if (
        !routeData
      ) {
        return sendApiError(
          res,
          404,
          "ROUTE_NOT_FOUND",
          'Provide route data in the request body with the "route" field or provide a valid "routeId".'
        );
      }

      // --------------------------------------------------------
      // FINAL ROUTE VALIDATION
      // --------------------------------------------------------

      if (
        !isValidRouteObject(
          routeData
        )
      ) {
        return sendApiError(
          res,
          400,
          "INVALID_ROUTE",
          "The resolved route is not a valid route object."
        );
      }

      // --------------------------------------------------------
      // NORMALIZE PROFILE
      // --------------------------------------------------------

      const normalizedProfile =
        normalizeProfile(
          profile
        );

      // --------------------------------------------------------
      // OVERALL ADVISORY
      // --------------------------------------------------------
      //
      // If a complete route collection is supplied, use the
      // shared overall advisory engine.
      //
      // Recommendation remains authoritative from the route
      // ranking result.
      //
      // We never assume routes[0] is recommended.
      // --------------------------------------------------------

      if (
        Array.isArray(
          routeCollection
        ) &&
        routeCollection.length >
          0
      ) {
        const recommendedRoute =
          findRecommendedRoute(
            routeCollection,
            routeData
          );

        // ------------------------------------------------------
        // Safety validation
        // ------------------------------------------------------

        if (
          !isValidRouteObject(
            recommendedRoute
          )
        ) {
          return sendApiError(
            res,
            400,
            "INVALID_RECOMMENDED_ROUTE",
            "Unable to identify a valid recommended route."
          );
        }

        const advisory =
          buildOverallAdvisory(
            routeCollection,
            recommendedRoute
          );

        return res.json({
          success:
            true,

          routeId:
            routeId ||
            getRouteId(
              routeData
            ),

          profile:
            normalizedProfile,

          advisory,
        });
      }

      // --------------------------------------------------------
      // SINGLE-ROUTE ADVISORY
      // --------------------------------------------------------
      //
      // If an explicit referenceRoute was supplied, it is used
      // for travel-time / exposure trade-off explanation.
      //
      // Otherwise the advisory engine explains the supplied
      // route directly.
      // --------------------------------------------------------

      const advisory =
        buildRouteAdvisory(
          routeData,
          {
            profile:
              normalizedProfile,

            referenceRoute:
              referenceValidation.value,
          }
        );

      // --------------------------------------------------------
      // RESPONSE
      // --------------------------------------------------------

      return res.json({
        success:
          true,

        routeId:
          routeId ||
          getRouteId(
            routeData
          ),

        profile:
          normalizedProfile,

        advisory,
      });
    } catch (error) {
      console.error(
        "[advisory] Advisory generation failed:",
        error
      );

      // --------------------------------------------------------
      // DAY 8:
      // Do not expose internal error details in the API.
      //
      // Detailed error remains in server logs.
      // --------------------------------------------------------

      return sendApiError(
        res,
        500,
        "ADVISORY_GENERATION_FAILED",
        "Unable to generate route advisory right now."
      );
    }
  }
);

// ============================================================
// GET /
// ============================================================
//
// Optional health/info endpoint.
//
// Does not calculate an advisory.
// ============================================================

router.get(
  "/",
  (
    req,
    res
  ) => {
    return res.json({
      success:
        true,

      service:
        "AirRoute Route Advisory",

      status:
        "operational",

      advisoryEngine:
        "routeAdvisory",

      architecture:
        "shared-advisory-engine",

      providerArchitecture:
        "OpenAQ primary / WAQI fallback",
    });
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports =
  router;