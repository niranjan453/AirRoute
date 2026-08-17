// ============================================================
// CPCB INDIAN AQI CALCULATOR
// ============================================================
//
// Input:
// {
//   pm25: { value: 30, unit: "µg/m³" },
//   pm10: { value: 79, unit: "µg/m³" },
//   ...
// }
//
// Output:
// {
//   aqi,
//   dominantPollutant,
//   subIndices,
//   pollutantsUsed
// }
//
// NOTE:
// This module calculates pollutant sub-indices from the
// concentration supplied to it. The caller is responsible
// for supplying the appropriate averaging-period concentration.
// ============================================================


// ============================================================
// BREAKPOINTS
// ============================================================

const BREAKPOINTS = {
  pm25: [
    { cLow: 0, cHigh: 30, iLow: 0, iHigh: 50 },
    { cLow: 31, cHigh: 60, iLow: 51, iHigh: 100 },
    { cLow: 61, cHigh: 90, iLow: 101, iHigh: 200 },
    { cLow: 91, cHigh: 120, iLow: 201, iHigh: 300 },
    { cLow: 121, cHigh: 250, iLow: 301, iHigh: 400 },
    { cLow: 251, cHigh: 500, iLow: 401, iHigh: 500 },
  ],

  pm10: [
    { cLow: 0, cHigh: 50, iLow: 0, iHigh: 50 },
    { cLow: 51, cHigh: 100, iLow: 51, iHigh: 100 },
    { cLow: 101, cHigh: 250, iLow: 101, iHigh: 200 },
    { cLow: 251, cHigh: 350, iLow: 201, iHigh: 300 },
    { cLow: 351, cHigh: 430, iLow: 301, iHigh: 400 },
    { cLow: 431, cHigh: 500, iLow: 401, iHigh: 500 },
  ],

  no2: [
    { cLow: 0, cHigh: 40, iLow: 0, iHigh: 50 },
    { cLow: 41, cHigh: 80, iLow: 51, iHigh: 100 },
    { cLow: 81, cHigh: 180, iLow: 101, iHigh: 200 },
    { cLow: 181, cHigh: 280, iLow: 201, iHigh: 300 },
    { cLow: 281, cHigh: 400, iLow: 301, iHigh: 400 },
    { cLow: 401, cHigh: 800, iLow: 401, iHigh: 500 },
  ],

  so2: [
    { cLow: 0, cHigh: 40, iLow: 0, iHigh: 50 },
    { cLow: 41, cHigh: 80, iLow: 51, iHigh: 100 },
    { cLow: 81, cHigh: 380, iLow: 101, iHigh: 200 },
    { cLow: 381, cHigh: 800, iLow: 201, iHigh: 300 },
    { cLow: 801, cHigh: 1600, iLow: 301, iHigh: 400 },
    { cLow: 1601, cHigh: 2620, iLow: 401, iHigh: 500 },
  ],

  o3: [
    { cLow: 0, cHigh: 50, iLow: 0, iHigh: 50 },
    { cLow: 51, cHigh: 100, iLow: 51, iHigh: 100 },
    { cLow: 101, cHigh: 168, iLow: 101, iHigh: 200 },
    { cLow: 169, cHigh: 208, iLow: 201, iHigh: 300 },
    { cLow: 209, cHigh: 748, iLow: 301, iHigh: 400 },
    { cLow: 749, cHigh: 1000, iLow: 401, iHigh: 500 },
  ],

  co: [
    { cLow: 0, cHigh: 1, iLow: 0, iHigh: 50 },
    { cLow: 1.1, cHigh: 2, iLow: 51, iHigh: 100 },
    { cLow: 2.1, cHigh: 10, iLow: 101, iHigh: 200 },
    { cLow: 10.1, cHigh: 17, iLow: 201, iHigh: 300 },
    { cLow: 17.1, cHigh: 34, iLow: 301, iHigh: 400 },
    { cLow: 34.1, cHigh: 50, iLow: 401, iHigh: 500 },
  ],

  nh3: [
    { cLow: 0, cHigh: 200, iLow: 0, iHigh: 50 },
    { cLow: 201, cHigh: 400, iLow: 51, iHigh: 100 },
    { cLow: 401, cHigh: 800, iLow: 101, iHigh: 200 },
    { cLow: 801, cHigh: 1200, iLow: 201, iHigh: 300 },
    { cLow: 1201, cHigh: 1800, iLow: 301, iHigh: 400 },
    { cLow: 1801, cHigh: 2400, iLow: 401, iHigh: 500 },
  ],
};


// ============================================================
// AQI CATEGORIES
// ============================================================

const AQI_CATEGORIES = [
  {
    min: 0,
    max: 50,
    label: "Good",
    color: "green",
  },
  {
    min: 51,
    max: 100,
    label: "Satisfactory",
    color: "light-green",
  },
  {
    min: 101,
    max: 200,
    label: "Moderate",
    color: "yellow",
  },
  {
    min: 201,
    max: 300,
    label: "Poor",
    color: "orange",
  },
  {
    min: 301,
    max: 400,
    label: "Very Poor",
    color: "red",
  },
  {
    min: 401,
    max: 500,
    label: "Severe",
    color: "maroon",
  },
];


// ============================================================
// GET AQI CATEGORY
// ============================================================

function getAqiCategory(aqi) {
  const value = Number(aqi);

  if (!Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);

  return (
    AQI_CATEGORIES.find(
      (category) =>
        rounded >= category.min &&
        rounded <= category.max
    ) ||
    AQI_CATEGORIES[AQI_CATEGORIES.length - 1]
  );
}


// ============================================================
// FIND BREAKPOINT
// ============================================================

function findBreakpoint(
  pollutant,
  concentration
) {
  const ranges =
    BREAKPOINTS[pollutant];

  if (!ranges) {
    return null;
  }

  const value =
    Number(concentration);

  if (!Number.isFinite(value)) {
    return null;
  }

  if (value < 0) {
    return null;
  }

  return (
    ranges.find(
      (range) =>
        value >= range.cLow &&
        value <= range.cHigh
    ) ||
    null
  );
}


// ============================================================
// CALCULATE SUB-INDEX
// ============================================================

function calculateSubIndex(
  pollutant,
  concentration
) {
  const value =
    Number(concentration);

  if (!Number.isFinite(value)) {
    return null;
  }

  const breakpoint =
    findBreakpoint(
      pollutant,
      value
    );

  if (!breakpoint) {
    return null;
  }

  const index =
    ((breakpoint.iHigh -
      breakpoint.iLow) /
      (breakpoint.cHigh -
        breakpoint.cLow)) *
      (value -
        breakpoint.cLow) +
    breakpoint.iLow;

  return {
    pollutant,

    concentration: value,

    aqi: Math.round(index),

    breakpoint: {
      concentrationLow:
        breakpoint.cLow,

      concentrationHigh:
        breakpoint.cHigh,

      aqiLow:
        breakpoint.iLow,

      aqiHigh:
        breakpoint.iHigh,
    },
  };
}


// ============================================================
// EXTRACT VALUE
// ============================================================

function extractValue(
  measurement
) {
  if (
    measurement === null ||
    measurement === undefined
  ) {
    return null;
  }

  if (
    typeof measurement ===
    "number"
  ) {
    return measurement;
  }

  if (
    typeof measurement ===
    "object"
  ) {
    return Number(
      measurement.value
    );
  }

  return null;
}


// ============================================================
// CALCULATE STATION AQI
// ============================================================

function calculateStationAqi(
  pollutants
) {
  if (
    !pollutants ||
    typeof pollutants !==
      "object"
  ) {
    return {
      aqi: null,
      category: null,
      dominantPollutant: null,
      subIndices: {},
      pollutantsUsed: [],
    };
  }

  const subIndices = {};

  for (
    const pollutant of Object.keys(
      BREAKPOINTS
    )
  ) {
    const measurement =
      pollutants[pollutant];

    if (
      measurement ===
        null ||
      measurement ===
        undefined
    ) {
      continue;
    }

    const value =
      extractValue(
        measurement
      );

    const result =
      calculateSubIndex(
        pollutant,
        value
      );

    if (!result) {
      continue;
    }

    subIndices[pollutant] =
      result;
  }

  const validResults =
    Object.values(
      subIndices
    );

  if (
    validResults.length ===
    0
  ) {
    return {
      aqi: null,
      category: null,
      dominantPollutant: null,
      subIndices,
      pollutantsUsed: [],
    };
  }

  /*
   * Overall AQI is the maximum
   * pollutant sub-index.
   */
  const dominant =
    validResults.reduce(
      (highest, current) =>
        current.aqi >
        highest.aqi
          ? current
          : highest
    );

  const aqi =
    Math.min(
      Math.max(
        dominant.aqi,
        0
      ),
      500
    );

  return {
    aqi,

    category:
      getAqiCategory(aqi),

    dominantPollutant:
      dominant.pollutant,

    subIndices,

    pollutantsUsed:
      validResults.map(
        (item) =>
          item.pollutant
      ),
  };
}


// ============================================================
// TEST
// ============================================================

function testCpcbAqi() {
  const sample = {
    pm25: {
      value: 30,
      unit: "µg/m³",
    },

    pm10: {
      value: 79,
      unit: "µg/m³",
    },

    no2: {
      value: 22,
      unit: "µg/m³",
    },

    so2: {
      value: 10,
      unit: "µg/m³",
    },

    o3: {
      value: 23,
      unit: "µg/m³",
    },

    co: {
      value: 0.8,
      unit: "mg/m³",
    },
  };

  const result =
    calculateStationAqi(
      sample
    );

  console.log(
    "\n================================="
  );

  console.log(
    "       CPCB AQI TEST"
  );

  console.log(
    "================================="
  );

  console.dir(
    result,
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
  BREAKPOINTS,

  AQI_CATEGORIES,

  getAqiCategory,

  findBreakpoint,

  calculateSubIndex,

  calculateStationAqi,

  testCpcbAqi,
};