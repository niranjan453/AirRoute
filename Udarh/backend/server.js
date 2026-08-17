"use strict";

// ============================================================
// AIRROUTE BACKEND SERVER
// ============================================================
//
// DAY 8
//
// Production hardening:
// - Request parsing
// - Request logging
// - Standard 404 responses
// - Centralized API error handling
// - Safe production error responses
// - Malformed JSON handling
// - Body-size protection
//
// AQI architecture:
//
//   OpenAQ PRIMARY
//       ↓
//   WAQI FALLBACK
//
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");

const routeRoutes = require("./routes/route");
const advisoryRoutes = require("./routes/advisory");

const aqiCache = require("./services/aqiCache");

// ============================================================
// APP
// ============================================================

const app =
  express();

const PORT =
  Number(
    process.env.PORT
  ) || 5000;

// ============================================================
// ENVIRONMENT
// ============================================================

const NODE_ENV =
  String(
    process.env.NODE_ENV ||
      "development"
  )
    .trim()
    .toLowerCase();

const IS_PRODUCTION =
  NODE_ENV ===
  "production";

// ============================================================
// MIDDLEWARE
// ============================================================

// ============================================================
// CORS
// ============================================================
//
// Current behavior is preserved.
//
// Production CORS should eventually use an explicit allowlist.
// ============================================================

app.use(
  cors({
    origin:
      true,

    credentials:
      true,
  })
);

// ============================================================
// JSON BODY PARSER
// ============================================================
//
// 1 MB limit prevents unnecessarily large request bodies.
//
// Malformed JSON is handled by the centralized error handler
// below.
// ============================================================

app.use(
  express.json({
    limit:
      "1mb",
  })
);

// ============================================================
// URL-ENCODED BODY PARSER
// ============================================================

app.use(
  express.urlencoded({
    extended:
      true,

    limit:
      "1mb",
  })
);

// ============================================================
// REQUEST LOGGER
// ============================================================

app.use(
  (
    req,
    res,
    next
  ) => {
    const startedAt =
      Date.now();

    res.on(
      "finish",
      () => {
        const duration =
          Date.now() -
          startedAt;

        console.log(
          `[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
        );
      }
    );

    next();
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (
    req,
    res
  ) => {
    return res.json({
      success:
        true,

      status:
        "ok",

      message:
        "AirRoute Backend is running",

      aqiCacheReady:
        aqiCache.isReady(),

      aqiCacheLastUpdated:
        aqiCache.getLastUpdated(),

      aqiCacheCells:
        aqiCache.getCellCount(),

      // Day 5 AQI architecture
      aqiProvider:
        "openaq",

      aqiFallback:
        "waqi",

      aqiStandard:
        "US_EPA_ESTIMATE",

      aqiMode:
        aqiCache.getLastRefreshSource(),

      aqiProviderPoints:
        aqiCache.getProviderPointCount(),

      routingProvider:
        "openrouteservice",
    });
  }
);

// ============================================================
// ROUTES
// ============================================================

app.use(
  "/routes",
  routeRoutes
);

app.use(
  "/advisory",
  advisoryRoutes
);

// ============================================================
// AQI GRID
// ============================================================

app.get(
  "/aqi-grid",
  (
    req,
    res
  ) => {
    const grid =
      aqiCache.getGrid();

    return res.json({
      success:
        true,

      lastUpdated:
        aqiCache.getLastUpdated(),

      cellSizeMeters:
        aqiCache.getCellSize(),

      // Day 5 AQI architecture
      provider:
        "openaq",

      fallbackProvider:
        "waqi",

      aqiStandard:
        "US_EPA_ESTIMATE",

      providerPoints:
        aqiCache.getProviderPointCount(),

      source:
        aqiCache.getLastRefreshSource(),

      count:
        grid.length,

      grid,
    });
  }
);

// ============================================================
// ROOT
// ============================================================

app.get(
  "/",
  (
    req,
    res
  ) => {
    return res.json({
      success:
        true,

      name:
        "AirRoute Backend",

      status:
        "running",

      version:
        "1.0.0",

      routing:
        "OpenRouteService",

      aqi: {
        primary:
          "OpenAQ",

        fallback:
          "WAQI",

        standard:
          "US_EPA_ESTIMATE",
      },

      endpoints: {
        health:
          "/health",

        routes:
          "/routes",

        advisory:
          "/advisory",

        aqiGrid:
          "/aqi-grid",
      },
    });
  }
);

// ============================================================
// 404 HANDLER
// ============================================================
//
// Any request that reaches this point did not match a route.
//
// ============================================================

app.use(
  (
    req,
    res
  ) => {
    return res
      .status(404)
      .json({
        success:
          false,

        error:
          "ROUTE_NOT_FOUND",

        message:
          "The requested API endpoint was not found.",

        path:
          req.originalUrl,
      });
  }
);

// ============================================================
// CENTRAL ERROR HANDLER
// ============================================================
//
// IMPORTANT:
//
// This middleware MUST remain after all routes.
//
// Express identifies an error handler by its four arguments:
//
//   error, req, res, next
//
// ============================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    // ----------------------------------------------------------
    // Server-side logging
    // ----------------------------------------------------------

    console.error(
      "[SERVER ERROR]",
      {
        method:
          req.method,

        path:
          req.originalUrl,

        message:
          error?.message,

        name:
          error?.name,

        stack:
          error?.stack,
      }
    );

    // ----------------------------------------------------------
    // Headers already sent
    // ----------------------------------------------------------

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    // ----------------------------------------------------------
    // Malformed JSON
    // ----------------------------------------------------------
    //
    // express.json() throws SyntaxError when the request body
    // contains invalid JSON.
    //
    // Example:
    //
    // {
    //   "origin":
    //
    // ----------------------------------------------------------

    const isJsonSyntaxError =
      error instanceof
        SyntaxError &&
      error?.status ===
        400 &&
      (
        error?.type ===
          "entity.parse.failed" ||
        error?.body !==
          undefined
      );

    if (
      isJsonSyntaxError
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          error:
            "INVALID_JSON",

          message:
            "Request body contains malformed JSON.",
        });
    }

    // ----------------------------------------------------------
    // Request entity too large
    // ----------------------------------------------------------

    if (
      error?.type ===
      "entity.too.large"
    ) {
      return res
        .status(413)
        .json({
          success:
            false,

          error:
            "REQUEST_TOO_LARGE",

          message:
            "Request body exceeds the maximum allowed size.",
        });
    }

    // ----------------------------------------------------------
    // Determine HTTP status
    // ----------------------------------------------------------

    const requestedStatus =
      Number(
        error?.status ??
          error?.statusCode
      );

    const status =
      Number.isInteger(
        requestedStatus
      ) &&
      requestedStatus >=
        400 &&
      requestedStatus <
        600
        ? requestedStatus
        : 500;

    // ----------------------------------------------------------
    // Safe public error message
    // ----------------------------------------------------------
    //
    // In production we intentionally do NOT expose arbitrary
    // internal error.message values.
    //
    // Detailed information remains in server logs.
    // ----------------------------------------------------------

    let publicMessage =
      "Internal server error.";

    if (
      status >=
        400 &&
      status <
        500 &&
      !IS_PRODUCTION &&
      typeof error?.message ===
        "string" &&
      error.message.trim()
    ) {
      publicMessage =
        error.message;
    }

    // ----------------------------------------------------------
    // Known client-side errors
    // ----------------------------------------------------------

    if (
      status >=
        400 &&
      status <
        500
    ) {
      if (
        typeof error?.message ===
          "string" &&
        error.message.trim()
      ) {
        publicMessage =
          error.message;
      }
    }

    // ----------------------------------------------------------
    // Final response
    // ----------------------------------------------------------

    return res
      .status(status)
      .json({
        success:
          false,

        error:
          status >=
          500
            ? "INTERNAL_SERVER_ERROR"
            : "REQUEST_ERROR",

        message:
          publicMessage,
      });
  }
);

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
  try {
    // ----------------------------------------------------------
    // Initialize AQI cache
    // ----------------------------------------------------------

    if (
      typeof aqiCache.initialize ===
      "function"
    ) {
      await aqiCache.initialize();
    } else if (
      typeof aqiCache.init ===
      "function"
    ) {
      await aqiCache.init();
    }

    // ----------------------------------------------------------
    // Start HTTP server
    // ----------------------------------------------------------

    app.listen(
      PORT,
      () => {
        console.log(
          "================================================"
        );

        console.log(
          "  AirRoute Backend"
        );

        console.log(
          `  Environment      : ${NODE_ENV}`
        );

        console.log(
          `  Port             : ${PORT}`
        );

        console.log(
          "  Routing          : OpenRouteService"
        );

        console.log(
          "  AQI Provider     : OpenAQ"
        );

        console.log(
          "  AQI Fallback     : WAQI"
        );

        console.log(
          "  AQI Standard     : US EPA Estimate"
        );

        console.log(
          `  AQI Cells        : ${aqiCache.getCellCount()}`
        );

        console.log(
          `  AQI Provider Pts : ${aqiCache.getProviderPointCount()}`
        );

        console.log(
          `  AQI Source       : ${aqiCache.getLastRefreshSource()}`
        );

        console.log(
          "================================================"
        );

        console.log(
          `  Health   → http://localhost:${PORT}/health`
        );

        console.log(
          `  AQI Grid → http://localhost:${PORT}/aqi-grid`
        );

        console.log(
          `  Routes   → http://localhost:${PORT}/routes`
        );

        console.log(
          `  Advisory → http://localhost:${PORT}/advisory`
        );

        console.log(
          "================================================"
        );
      }
    );
  } catch (error) {
    console.error(
      "[SERVER STARTUP ERROR]",
      error
    );

    process.exit(
      1
    );
  }
}

// ============================================================
// PROCESS ERROR HANDLING
// ============================================================
//
// These are process-level failures and are intentionally
// different from HTTP request errors.
//
// HTTP errors:
//   centralized Express error handler above
//
// Process errors:
//   uncaughtException / unhandledRejection
//
// ============================================================

process.on(
  "uncaughtException",
  (
    error
  ) => {
    console.error(
      "[UNCAUGHT EXCEPTION]",
      error
    );

    process.exit(
      1
    );
  }
);

process.on(
  "unhandledRejection",
  (
    reason
  ) => {
    console.error(
      "[UNHANDLED REJECTION]",
      reason
    );

    process.exit(
      1
    );
  }
);

// ============================================================
// START
// ============================================================

startServer();

// ============================================================
// EXPORT
// ============================================================

module.exports =
  app;