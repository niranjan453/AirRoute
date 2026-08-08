import React, { useMemo } from 'react';
import { Circle } from 'react-native-maps';
import PropTypes from 'prop-types';

function aqiToColor(aqi, opacity = 0.35) {
  if (aqi <= 50) return `rgba(0, 228, 0, ${opacity})`;
  if (aqi <= 100) return `rgba(255, 255, 0, ${opacity})`;
  if (aqi <= 150) return `rgba(255, 126, 0, ${opacity})`;
  if (aqi <= 200) return `rgba(255, 0, 0, ${opacity})`;
  if (aqi <= 300) return `rgba(143, 63, 151, ${opacity})`;
  return `rgba(126, 0, 35, ${opacity})`;
}

export default function AqiHeatmapLayer({ gridData, visible, cellSizeMeters }) {
  const rendered = useMemo(() => {
    if (!visible || !gridData || !Array.isArray(gridData) || gridData.length === 0) {
      return null;
    }
    const radius = (cellSizeMeters || 500) / 2;
    return gridData.map((cell, idx) => (
      <Circle
        key={`aqi-cell-${idx}`}
        center={{ latitude: cell.lat, longitude: cell.lng }}
        radius={radius}
        fillColor={aqiToColor(cell.aqi)}
        strokeWidth={0}
        zIndex={1}
      />
    ));
  }, [gridData, visible, cellSizeMeters]);

  return rendered;
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
