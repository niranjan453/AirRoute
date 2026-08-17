"use strict";

// ============================================================
// AIRROUTE - OPENAQ REQUEST MANAGER
// ============================================================
//
// Purpose:
// - Centralize OpenAQ HTTP requests
// - Attach OPENAQ_API_KEY
// - Provide lightweight in-memory caching
// - Reduce duplicate OpenAQ requests
// - Handle OpenAQ errors consistently
//
// This file DOES NOT calculate AQI.
// This file DOES NOT select stations.
// This file only handles HTTP requests to OpenAQ.
// ============================================================

const path = require("path");
const axios = require("axios");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

// ============================================================
// CONFIG
// ============================================================

function cleanBaseUrl(value, fallback) {
  if (!value) {
    return fallback;
  }

  let url = String(value).trim();

  const markdownMatch = url.match(
    /^\[https?:\/\/[^\]]+\]\((https?:\/\/[^)]+)\)$/
  );

  if (markdownMatch) {
    url = markdownMatch[1];
  }

  return url.replace(/\/+$/, "");
}

const OPENAQ_BASE_URL = cleanBaseUrl(
  process.env.OPENAQ_BASE_URL,
  "https://api.openaq.org/v3"
);

const OPENAQ_API_KEY =
  process.env.OPENAQ_API_KEY
    ? String(process.env.OPENAQ_API_KEY).trim()
    : "";

const REQUEST_TIMEOUT_MS = Math.max(
  Number(process.env.OPENAQ_TIMEOUT_MS || 15000),
  3000
);

const CACHE_TTL_MS = Math.max(
  Number(process.env.OPENAQ_REQUEST_CACHE_TTL_MS || 120000),
  10000
);

const MAX_CACHE_ENTRIES = Math.max(
  Number(process.env.OPENAQ_REQUEST_CACHE_MAX_ENTRIES || 500),
  50
);

// ============================================================
// CACHE
// ============================================================

const requestCache = new Map();

const pendingRequests = new Map();

// ============================================================
// HELPERS
// ============================================================

function hasApiKey() {
  return Boolean(OPENAQ_API_KEY);
}

function buildCacheKey(url, options = {}) {
  if (options.cacheKey) {
    return String(options.cacheKey);
  }

  return url;
}

function cleanupCache() {
  const now = Date.now();

  for (const [key, entry] of requestCache.entries()) {
    if (
      !entry ||
      now - entry.createdAt > entry.ttl
    ) {
      requestCache.delete(key);
    }
  }

  // Protect memory if too many entries exist.
  if (requestCache.size <= MAX_CACHE_ENTRIES) {
    return;
  }

  const entries = [...requestCache.entries()].sort(
    (a, b) =>
      a[1].createdAt - b[1].createdAt
  );

  const removeCount =
    requestCache.size - MAX_CACHE_ENTRIES;

  for (let i = 0; i < removeCount; i += 1) {
    requestCache.delete(entries[i][0]);
  }
}

function getCached(cacheKey) {
  const entry = requestCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  const age = Date.now() - entry.createdAt;

  if (age > entry.ttl) {
    requestCache.delete(cacheKey);
    return null;
  }

  return entry.data;
}

function setCached(cacheKey, data, ttl) {
  cleanupCache();

  requestCache.set(cacheKey, {
    data,
    createdAt: Date.now(),
    ttl,
  });
}

// ============================================================
// URL BUILDER
// ============================================================

function buildUrl(endpoint) {
  if (!endpoint) {
    throw new Error(
      "OpenAQ endpoint is required"
    );
  }

  const normalizedEndpoint =
    String(endpoint).startsWith("/")
      ? String(endpoint)
      : `/${endpoint}`;

  return `${OPENAQ_BASE_URL}${normalizedEndpoint}`;
}

// ============================================================
// REQUEST
// ============================================================

async function openaqRequest(
  urlOrEndpoint,
  options = {}
) {
  if (!hasApiKey()) {
    const error = new Error(
      "OPENAQ_API_KEY is missing"
    );

    error.code = "OPENAQ_API_KEY_MISSING";

    throw error;
  }

  const {
    method = "GET",
    params = undefined,
    headers = {},
    timeout = REQUEST_TIMEOUT_MS,
    useCache = true,
    cacheKey = null,
    cacheTtl = CACHE_TTL_MS,
    skipCache = false,
  } = options;

  let url = String(urlOrEndpoint);

  // Allow both:
  //
  // "/locations"
  //
  // and:
  //
  // "https://api.openaq.org/v3/locations"
  //
  if (!/^https?:\/\//i.test(url)) {
    url = buildUrl(url);
  }

  // ==========================================================
  // CACHE KEY
  // ==========================================================

  let finalCacheKey = null;

  if (
    method.toUpperCase() === "GET" &&
    useCache &&
    !skipCache
  ) {
    if (cacheKey) {
      finalCacheKey = String(cacheKey);
    } else {
      const queryString = new URLSearchParams();

      if (params && typeof params === "object") {
        Object.entries(params).forEach(
          ([key, value]) => {
            if (
              value !== undefined &&
              value !== null
            ) {
              queryString.set(
                key,
                String(value)
              );
            }
          }
        );
      }

      finalCacheKey =
        `${url}?${queryString.toString()}`;
    }

    const cached = getCached(
      finalCacheKey
    );

    if (cached !== null) {
      return cached;
    }
  }

  // ==========================================================
  // DUPLICATE REQUEST PROTECTION
  // ==========================================================

  if (
    method.toUpperCase() === "GET" &&
    finalCacheKey &&
    pendingRequests.has(finalCacheKey)
  ) {
    return pendingRequests.get(
      finalCacheKey
    );
  }

  // ==========================================================
  // REQUEST PROMISE
  // ==========================================================

  const requestPromise = (async () => {
    try {
      const response = await axios({
        method,
        url,
        params,
        timeout,

        headers: {
          Accept: "application/json",

          "X-API-Key":
            OPENAQ_API_KEY,

          ...headers,
        },

        validateStatus: () => true,
      });

      // ======================================================
      // RATE LIMIT
      // ======================================================

      if (response.status === 429) {
        const error = new Error(
          "OpenAQ rate limit exceeded"
        );

        error.code =
          "OPENAQ_RATE_LIMIT";

        error.response = response;

        throw error;
      }

      // ======================================================
      // AUTH ERROR
      // ======================================================

      if (
        response.status === 401 ||
        response.status === 403
      ) {
        const error = new Error(
          `OpenAQ authentication failed (${response.status})`
        );

        error.code =
          "OPENAQ_AUTH_ERROR";

        error.response = response;

        throw error;
      }

      // ======================================================
      // SERVER ERROR
      // ======================================================

      if (response.status >= 500) {
        const error = new Error(
          `OpenAQ server error (${response.status})`
        );

        error.code =
          "OPENAQ_SERVER_ERROR";

        error.response = response;

        throw error;
      }

      // ======================================================
      // OTHER CLIENT ERROR
      // ======================================================

      if (response.status >= 400) {
        const error = new Error(
          `OpenAQ request failed (${response.status})`
        );

        error.code =
          "OPENAQ_REQUEST_ERROR";

        error.response = response;

        throw error;
      }

      const data = response.data;

      // ======================================================
      // CACHE SUCCESSFUL GET
      // ======================================================

      if (
        method.toUpperCase() === "GET" &&
        finalCacheKey &&
        useCache &&
        !skipCache
      ) {
        setCached(
          finalCacheKey,
          data,
          cacheTtl
        );
      }

      return data;
    } catch (error) {
      // Keep useful OpenAQ metadata.
      if (!error.code) {
        error.code =
          "OPENAQ_NETWORK_ERROR";
      }

      throw error;
    } finally {
      if (finalCacheKey) {
        pendingRequests.delete(
          finalCacheKey
        );
      }
    }
  })();

  // ==========================================================
  // STORE PENDING REQUEST
  // ==========================================================

  if (
    method.toUpperCase() === "GET" &&
    finalCacheKey
  ) {
    pendingRequests.set(
      finalCacheKey,
      requestPromise
    );
  }

  return requestPromise;
}

// ============================================================
// CONVENIENCE GET
// ============================================================

async function openaqGet(
  endpoint,
  params = {},
  options = {}
) {
  const url =
    buildUrl(endpoint);

  return openaqRequest(
    url,
    {
      ...options,

      method: "GET",

      params,
    }
  );
}

// ============================================================
// CACHE MANAGEMENT
// ============================================================

function clearOpenAqCache() {
  requestCache.clear();
}

function getOpenAqCacheStats() {
  cleanupCache();

  return {
    entries:
      requestCache.size,

    pending:
      pendingRequests.size,

    ttlMs:
      CACHE_TTL_MS,

    maxEntries:
      MAX_CACHE_ENTRIES,
  };
}

// ============================================================
// HEALTH
// ============================================================

function getOpenAqRequestConfig() {
  return {
    baseUrl:
      OPENAQ_BASE_URL,

    apiKeyConfigured:
      hasApiKey(),

    timeoutMs:
      REQUEST_TIMEOUT_MS,

    cacheTtlMs:
      CACHE_TTL_MS,

    cacheEntries:
      requestCache.size,

    pendingRequests:
      pendingRequests.size,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  openaqRequest,
  openaqGet,

  clearOpenAqCache,
  getOpenAqCacheStats,

  getOpenAqRequestConfig,

  hasApiKey,
};