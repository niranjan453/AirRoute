"use strict";

// ============================================================
// AIRROUTE - INDIAN NATIONAL AQI ENGINE
// ============================================================
//
// Standard:
//   CPCB National Air Quality Index (IND-AQI)
//
// Purpose:
//   Convert pollutant concentrations into an Indian AQI
//   estimate.
//
// Pipeline:
//
//   Pollutant concentrations
//          ↓
//   Individual pollutant sub-indices
//          ↓
//   Highest sub-index
//          ↓
//   IND-AQI estimate
//
// IMPORTANT
// ------------------------------------------------------------
// CPCB's formal AQI uses prescribed averaging periods.
// Our Open-Meteo MVP currently works with current/hourly
// pollutant observations.
//
// Therefore this module returns:
//
//   standard: "IND-AQI"
//   estimate: true
//
// until proper rolling-average observations are available.
//
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================

const MAX_AQI = 500;

// ============================================================
// CPCB AQI BREAKPOINTS
// ============================================================
//
// Each row represents:
//
// concentration low → concentration high
// AQI low           → AQI high
//
// CPCB pollutants:
//   PM10
//   PM2.5
//   NO2
//   SO2
//   CO
//   O3
//   NH3
//   Pb
//
// Our current Open-Meteo provider supplies:
//   PM10
//   PM2.5
//   NO2
//   SO2
//   CO
//   O3
//
// NH3 and Pb are therefore optional.
//
// ============================================================

const BREAKPOINTS = {
  pm10: [
    {
      concentrationLow: 0,
      concentrationHigh: 50,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 51,
      concentrationHigh: 100,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 101,
      concentrationHigh: 250,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 251,
      concentrationHigh: 350,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 351,
      concentrationHigh: 430,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 430,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],

  pm25: [
    {
      concentrationLow: 0,
      concentrationHigh: 30,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 31,
      concentrationHigh: 60,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 61,
      concentrationHigh: 90,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 91,
      concentrationHigh: 120,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 121,
      concentrationHigh: 250,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 250,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],

  no2: [
    {
      concentrationLow: 0,
      concentrationHigh: 40,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 41,
      concentrationHigh: 80,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 81,
      concentrationHigh: 180,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 181,
      concentrationHigh: 280,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 281,
      concentrationHigh: 400,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 400,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],

  so2: [
    {
      concentrationLow: 0,
      concentrationHigh: 40,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 41,
      concentrationHigh: 80,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 81,
      concentrationHigh: 380,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 381,
      concentrationHigh: 800,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 801,
      concentrationHigh: 1600,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 1600,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],

  o3: [
    {
      concentrationLow: 0,
      concentrationHigh: 50,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 51,
      concentrationHigh: 100,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 101,
      concentrationHigh: 168,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 169,
      concentrationHigh: 208,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 209,
      concentrationHigh: 748,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 748,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],

  // CPCB uses CO in mg/m³.
  co: [
    {
      concentrationLow: 0,
      concentrationHigh: 1.0,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 1.1,
      concentrationHigh: 2.0,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 2.1,
      concentrationHigh: 10,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 10,
      concentrationHigh: 17,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 17,
      concentrationHigh: 34,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 34,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],

  nh3: [
    {
      concentrationLow: 0,
      concentrationHigh: 200,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 201,
      concentrationHigh: 400,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 401,
      concentrationHigh: 800,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 801,
      concentrationHigh: 1200,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 1201,
      concentrationHigh: 1800,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 1800,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],

  pb: [
    {
      concentrationLow: 0,
      concentrationHigh: 0.5,
      aqiLow: 0,
      aqiHigh: 50,
    },
    {
      concentrationLow: 0.5,
      concentrationHigh: 1.0,
      aqiLow: 51,
      aqiHigh: 100,
    },
    {
      concentrationLow: 1.1,
      concentrationHigh: 2.0,
      aqiLow: 101,
      aqiHigh: 200,
    },
    {
      concentrationLow: 2.1,
      concentrationHigh: 3.0,
      aqiLow: 201,
      aqiHigh: 300,
    },
    {
      concentrationLow: 3.1,
      concentrationHigh: 3.5,
      aqiLow: 301,
      aqiHigh: 400,
    },
    {
      concentrationLow: 3.5,
      concentrationHigh: Infinity,
      aqiLow: 401,
      aqiHigh: 500,
    },
  ],
};

// ============================================================
// AQI CATEGORIES
// ============================================================

function getAqiCategory(aqi) {
  const value = Number(aqi);

  if (!Number.isFinite(value)) {
    return {
      label: "Unknown",
      color: null,
      min: null,
      max: null,
    };
  }

  if (value <= 50) {
    return {
      label: "Good",
      color: "green",
      min: 0,
      max: 50,
    };
  }

  if (value <= 100) {
    return {
      label: "Satisfactory",
      color: "light-green",
      min: 51,
      max: 100,
    };
  }

  if (value <= 200) {
    return {
      label: "Moderately Polluted",
      color: "yellow",
      min: 101,
      max: 200,
    };
  }

  if (value <= 300) {
    return {
      label: "Poor",
      color: "orange",
      min: 201,
      max: 300,
    };
  }

  if (value <= 400) {
    return {
      label: "Very Poor",
      color: "red",
      min: 301,
      max: 400,
    };
  }

  return {
    label: "Severe",
    color: "maroon",
    min: 401,
    max: 500,
  };
}

// ============================================================
// NUMBER HELPER
// ============================================================

function toFiniteNumber(
  value,
  fallback = null
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

// ============================================================
// CONCENTRATION → SUB-INDEX
// ============================================================

function calculateSubIndex(
  pollutant,
  concentration
) {
  const value =
    toFiniteNumber(
      concentration
    );

  if (
    value === null ||
    value < 0
  ) {
    return null;
  }

  const breakpoints =
    BREAKPOINTS[
      pollutant
    ];

  if (
    !breakpoints
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // Find applicable breakpoint.
  // ----------------------------------------------------------

  let breakpoint =
    breakpoints.find(
      (item) =>
        value >=
          item.concentrationLow &&
        value <=
          item.concentrationHigh
    );

  // ----------------------------------------------------------
  // Handle gaps caused by rounded CPCB breakpoint values.
  // ----------------------------------------------------------

  if (!breakpoint) {
    breakpoint =
      breakpoints.find(
        (item) =>
          value <
          item.concentrationHigh
      );
  }

  if (!breakpoint) {
    return MAX_AQI;
  }

  const {
    concentrationLow,
    concentrationHigh,
    aqiLow,
    aqiHigh,
  } = breakpoint;

  if (
    concentrationHigh ===
    Infinity
  ) {
    // For values above the highest
    // breakpoint, cap at 500.
    return MAX_AQI;
  }

  const concentrationRange =
    concentrationHigh -
    concentrationLow;

  if (
    concentrationRange <= 0
  ) {
    return aqiLow;
  }

  const aqiRange =
    aqiHigh - aqiLow;

  const subIndex =
    aqiLow +
    (
      (
        value -
        concentrationLow
      ) /
      concentrationRange
    ) *
      aqiRange;

  return Math.round(
    Math.min(
      Math.max(
        subIndex,
        0
      ),
      MAX_AQI
    )
  );
}

// ============================================================
// NORMALIZE POLLUTANTS
// ============================================================
//
// Expected input:
//
// {
//   pm25,
//   pm10,
//   no2,
//   so2,
//   o3,
//   co
// }
//
// Also accepts common aliases.
//
// Open-Meteo CO is normally µg/m³.
// CPCB breakpoint table uses mg/m³.
//
// Therefore CO is converted:
//
//   µg/m³ ÷ 1000 = mg/m³
//
// ============================================================

function normalizePollutants(
  pollutants = {}
) {
  const pm25 =
    toFiniteNumber(
      pollutants.pm25 ??
        pollutants.pm2_5 ??
        pollutants.pm2p5 ??
        pollutants.pm2_5_concentration
    );

  const pm10 =
    toFiniteNumber(
      pollutants.pm10
    );

  const no2 =
    toFiniteNumber(
      pollutants.no2 ??
        pollutants.nitrogenDioxide
    );

  const so2 =
    toFiniteNumber(
      pollutants.so2 ??
        pollutants.sulfurDioxide
    );

  const o3 =
    toFiniteNumber(
      pollutants.o3 ??
        pollutants.ozone
    );

  let co =
    toFiniteNumber(
      pollutants.co ??
        pollutants.carbonMonoxide
    );

  // Open-Meteo returns CO in µg/m³.
  //
  // If the caller explicitly says the
  // value is already mg/m³, do not convert.
  const coUnit =
    String(
      pollutants.coUnit ||
        "ug/m3"
    )
      .trim()
      .toLowerCase();

  if (
    co !== null &&
    (
      coUnit === "ug/m3" ||
      coUnit === "µg/m3" ||
      coUnit === "μg/m3"
    )
  ) {
    co =
      co / 1000;
  }

  const nh3 =
    toFiniteNumber(
      pollutants.nh3 ??
        pollutants.ammonia
    );

  const pb =
    toFiniteNumber(
      pollutants.pb ??
        pollutants.lead
    );

  return {
    pm25,
    pm10,
    no2,
    so2,
    o3,
    co,
    nh3,
    pb,
  };
}

// ============================================================
// CALCULATE POLLUTANT SUB-INDICES
// ============================================================

function calculatePollutantSubIndices(
  pollutants
) {
  const normalized =
    normalizePollutants(
      pollutants
    );

  const subIndices = {};

  for (
    const [
      pollutant,
      concentration,
    ] of Object.entries(
      normalized
    )
  ) {
    if (
      concentration === null
    ) {
      continue;
    }

    const subIndex =
      calculateSubIndex(
        pollutant,
        concentration
      );

    if (
      subIndex !== null
    ) {
      subIndices[
        pollutant
      ] = {
        concentration,
        subIndex,
      };
    }
  }

  return subIndices;
}

// ============================================================
// DOMINANT POLLUTANT
// ============================================================
//
// The pollutant with the highest
// sub-index determines the AQI.
//
// ============================================================

function getDominantPollutant(
  subIndices
) {
  const entries =
    Object.entries(
      subIndices || {}
    );

  if (
    entries.length === 0
  ) {
    return null;
  }

  entries.sort(
    (a, b) =>
      Number(
        b[1]?.subIndex
      ) -
      Number(
        a[1]?.subIndex
      )
  );

  return entries[0][0];
}

// ============================================================
// MAIN IND-AQI CALCULATION
// ============================================================

function calculateIndAqi(
  pollutants,
  options = {}
) {
  const normalized =
    normalizePollutants(
      pollutants
    );

  const subIndices =
  calculatePollutantSubIndices(
    pollutants
  );

  const entries =
    Object.entries(
      subIndices
    );

  // ----------------------------------------------------------
  // No valid pollutant
  // ----------------------------------------------------------

  if (
    entries.length === 0
  ) {
    return {
      aqi: null,

      standard:
        "IND-AQI",

      estimate:
        true,

      category:
        getAqiCategory(null),

      dominantPollutant:
        null,

      pollutants:
        normalized,

      subIndices: {},

      validPollutants: 0,

      confidence:
        "none",

      averagingPeriod:
        "current-observation",

      warning:
        "No valid pollutant concentration was available.",
    };
  }

  // ----------------------------------------------------------
  // Highest sub-index = overall AQI
  // ----------------------------------------------------------

  const dominantPollutant =
    getDominantPollutant(
      subIndices
    );

  const aqi =
    Math.min(
      MAX_AQI,
      Math.max(
        0,
        Number(
          subIndices[
            dominantPollutant
          ].subIndex
        )
      )
    );

  const category =
    getAqiCategory(
      aqi
    );

  // ----------------------------------------------------------
  // Confidence
  // ----------------------------------------------------------
  //
  // This is data availability confidence,
  // not medical confidence.
  //
  // PM2.5 / PM10 are especially important
  // for the current MVP.
  // ----------------------------------------------------------

  const hasParticulate =
    normalized.pm25 !== null ||
    normalized.pm10 !== null;

  let confidence =
    "low";

  if (
    entries.length >= 4 &&
    hasParticulate
  ) {
    confidence =
      "high";
  } else if (
    entries.length >= 2 &&
    hasParticulate
  ) {
    confidence =
      "medium";
  }

  // ----------------------------------------------------------
  // Optional caller metadata
  // ----------------------------------------------------------

  return {
    aqi: Math.round(aqi),

    standard:
      "IND-AQI",

    estimate:
      options.estimate !==
      false,

    category,

    dominantPollutant,

    pollutants:
      normalized,

    subIndices,

    validPollutants:
      entries.length,

    confidence,

    averagingPeriod:
      options.averagingPeriod ||
      "current-observation",

    warning:
      options.warning ||
      "IND-AQI estimate based on available current pollutant observations; formal CPCB AQI requires the prescribed averaging periods.",
  };
}

// ============================================================
// PROVIDER-READY INPUT
// ============================================================
//
// This helper makes integration with
// aqiProvider.js easier.
//
// Expected provider data:
//
// {
//   pm2_5: 80,
//   pm10: 120,
//   nitrogen_dioxide: 40,
//   sulphur_dioxide: 10,
//   ozone: 30,
//   carbon_monoxide: 900
// }
//
// ============================================================

function calculateIndAqiFromOpenMeteo(
  current = {}
) {
  return calculateIndAqi({
    pm25:
      current.pm2_5,

    pm10:
      current.pm10,

    no2:
      current.nitrogen_dioxide,

    so2:
      current.sulphur_dioxide ??
      current.sulfur_dioxide,

    o3:
      current.ozone,

    co:
      current.carbon_monoxide,

    coUnit:
      "ug/m3",
  });
}

// ============================================================
// TEST DATA
// ============================================================

function createTestPollutants() {
  return {
    pm25: 80,
    pm10: 140,
    no2: 45,
    so2: 20,
    o3: 60,
    co: 900,
    coUnit: "ug/m3",
  };
}

// ============================================================
// TEST
// ============================================================

function testIndAqi() {
  console.log(
    "\n============================================"
  );

  console.log(
    "       AIRROUTE IND-AQI TEST"
  );

  console.log(
    "============================================"
  );

  const pollutants =
    createTestPollutants();

  const result =
    calculateIndAqi(
      pollutants
    );

  console.log(
    "\nPollutants:"
  );

  console.dir(
    pollutants,
    {
      depth: null,
    }
  );

  console.log(
    "\nIND-AQI:"
  );

  console.dir(
    result,
    {
      depth: null,
    }
  );

  console.log(
    "\n============================================\n"
  );

  return result;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  BREAKPOINTS,

  MAX_AQI,

  getAqiCategory,

  calculateSubIndex,

  normalizePollutants,

  calculatePollutantSubIndices,

  getDominantPollutant,

  calculateIndAqi,

  calculateIndAqiFromOpenMeteo,

  createTestPollutants,

  testIndAqi,
};