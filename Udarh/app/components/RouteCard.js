import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import PropTypes from 'prop-types';

const EXPOSURE_COLORS = {
  Low: { bg: '#e6f4ea', text: '#1e8e3e', border: '#1e8e3e' },
  Moderate: { bg: '#fef7e0', text: '#e37400', border: '#e37400' },
  High: { bg: '#fce8e6', text: '#d93025', border: '#d93025' },
};

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export default function RouteCard({ route, onPress, isSelected, showRank, rankOverride }) {
  if (!route) return null;
  const colors = EXPOSURE_COLORS[route.exposureBand] || EXPOSURE_COLORS.Low;
  const rank = rankOverride || route.rank || 1;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        isSelected && styles.selected,
        route.isRecommended && styles.recommended,
        isSelected && { borderColor: '#1a73e8' },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {showRank && (
          <View style={[styles.rankBadge, rank === 1 ? styles.rank1 : styles.rankOther]}>
            <Text style={styles.rankText}>{rank}</Text>
          </View>
          )}
          <View>
            <Text style={styles.summary}>
              {route.summary || `Route ${rank}`}
            </Text>
            <Text style={styles.subText}>
              {formatDuration(route.durationSeconds)} · {formatDistance(route.distanceMeters)}
            </Text>
          </View>
        </View>

        <View style={[styles.exposureBadge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <Text style={[styles.exposureText, { color: colors.text }]}>
            {route.exposureBand || 'Low'}
          </Text>
        </View>
      </View>

      <View style={styles.details}>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Avg AQI</Text>
          <Text style={styles.detailValue}>{route.avgAqi || '—'}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Peak AQI</Text>
          <Text
            style={[
              styles.detailValue,
              route.peakAqi > 200 && { color: '#d93025', fontWeight: 'bold' },
            ]}
          >
            {route.peakAqi || '—'}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Dose score</Text>
          <Text style={styles.detailValue}>{route.exposureScorePerHour || Math.round(route.exposureScore / 1000)}</Text>
        </View>
      </View>

      {route.isRecommended && (
        <View style={styles.recommendedBar}>
          <Text style={styles.recommendedText}>★ Recommended — lowest exposure</Text>
        </View>
      )}

      {route.hasHotspotWarning && route.hotspots && route.hotspots.length > 0 && (
        <View style={styles.hotspotBar}>
          <Text style={styles.hotspotText}>
            ⚠ {route.hotspots.length} hotspot{route.hotspots.length > 1 ? 's' : ''} detected
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

RouteCard.propTypes = {
  route: PropTypes.object.isRequired,
  onPress: PropTypes.func,
  isSelected: PropTypes.bool,
  showRank: PropTypes.bool,
  rankOverride: PropTypes.number,
};

RouteCard.defaultProps = {
  onPress: () => {},
  isSelected: false,
  showRank: true,
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  selected: {
    backgroundColor: '#f0f7ff',
    borderWidth: 2,
  },
  recommended: {
    borderColor: '#1e8e3e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rank1: { backgroundColor: '#1e8e3e' },
  rankOther: { backgroundColor: '#5f6368' },
  rankText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  summary: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
  },
  subText: {
    fontSize: 13,
    color: '#5f6368',
    marginTop: 2,
  },
  exposureBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  exposureText: {
    fontSize: 12,
    fontWeight: '700',
  },
  details: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 10,
  },
  detailItem: {
    flex: 1,
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 11,
    color: '#5f6368',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#202124',
  },
  recommendedBar: {
    marginTop: 10,
    backgroundColor: '#e6f4ea',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  recommendedText: {
    color: '#1e8e3e',
    fontSize: 12,
    fontWeight: '600',
  },
  hotspotBar: {
    marginTop: 8,
    backgroundColor: '#fce8e6',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  hotspotText: {
    color: '#d93025',
    fontSize: 12,
    fontWeight: '600',
  },
});
