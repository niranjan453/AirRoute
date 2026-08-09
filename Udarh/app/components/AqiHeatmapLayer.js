import React, { useMemo } from "react";
import {
  ShapeSource,
  CircleLayer,
} from "@maplibre/maplibre-react-native";
import PropTypes from "prop-types";

function aqiToColorExpression() {
  return [
    "step",
    ["get", "aqi"],

    // AQI <= 50
    "rgba(0, 228, 0, 0.35)",

    // AQI > 50
    50,
    "rgba(255, 255, 0, 0.35)",

    // AQI > 100
    100,
    "rgba(255, 126, 0, 0.35)",

    // AQI > 150
    150,
    "rgba(255, 0, 0, 0.35)",

    // AQI > 200
    200,
    "rgba(143, 63, 151, 0.35)",

    // AQI > 300
    300,
    "rgba(126, 0, 35, 0.35)",
  ];
}

export default function AqiHeatmapLayer({
  gridData,
  visible,
  cellSizeMeters,
}) {
  const geoJSON = useMemo(() => {
    if (
      !visible ||
      !Array.isArray(gridData) ||
      gridData.length === 0
    ) {
      return null;
    }

    return {
      type: "FeatureCollection",
      features: gridData
        .filter(
          (cell) =>
            typeof cell?.lat === "number" &&
            typeof cell?.lng === "number" &&
            typeof cell?.aqi === "number"
        )
        .map((cell, index) => ({
          type: "Feature",
          id: `aqi-cell-${index}`,

          properties: {
            aqi: cell.aqi,
          },

          geometry: {
            type: "Point",

            coordinates: [
              cell.lng,
              cell.lat,
            ],
          },
        })),
    };
  }, [gridData, visible]);

  const radius = useMemo(() => {
   /*
 * MapLibre CircleLayer uses a visual radius.
 * Keep the existing cellSizeMeters input for
 * compatibility with the existing AQI API.
 */
    const meters = cellSizeMeters || 500;

    return Math.max(
      8,
      Math.min(40, meters / 20)
    );
  }, [cellSizeMeters]);

  if (!geoJSON) {
    return null;
  }

  return (
    <ShapeSource
      id="airroute-aqi-source"
      shape={geoJSON}
    >
      <CircleLayer
        id="airroute-aqi-layer"
        style={{
          circleColor: aqiToColorExpression(),

          circleRadius: radius,

          circleOpacity: 0.7,

          circleStrokeWidth: 0,

          circlePitchAlignment: "map",
        }}
      />
    </ShapeSource>
  );
}

AqiHeatmapLayer.propTypes = {
  gridData: PropTypes.array,
  visible: PropTypes.bool,
  cellSizeMeters: PropTypes.number,
};

AqiHeatmapLayer.defaultProps = {
  gridData: [],
  visible: true,
  cellSizeMeters: 500,
};