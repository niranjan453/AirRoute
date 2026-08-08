import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import MapView, { Polyline, Marker, Circle } from 'react-native-maps';
import AdvisoryModal from '../components/AdvisoryModal';
import AqiHeatmapLayer from '../components/AqiHeatmapLayer';
import api from '../services/api';
import { useUserProfile } from '../context/UserProfileContext';
import { decodePolyline } from '../utils/polyline';

function aqiToColor(aqi, opacity = 0.6) {
  if (aqi <= 50) return `rgba(0, 228, 0, ${opacity})`;
  if (aqi <= 100) return `rgba(255, 255, 0, ${opacity})`;
  if (aqi <= 150) return `rgba(255, 126, 0, ${opacity})`;
  if (aqi <= 200) return `rgba(255, 0, 0, ${opacity})`;
  if (aqi <= 300) return `rgba(143, 63, 151, ${opacity})`;
  return `rgba(126, 0, 35, ${opacity})`;
}

function aqiLabel(aqi) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

export default function RouteDetail({ route, navigation }) {
  const { profile } = useUserProfile();
  const params = route.params || {};
  const routeData = params.route;
  const allRoutes = params.allRoutes || [];

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [advisoryVisible, setAdvisoryVisible] = useState(false);
  const [gridData, setGridData] = useState([]);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const mapRef = useRef(null);

  const routeCoords = useMemo(() => decodePolyline(routeData?.polyline || ''), [routeData]);

  useEffect(() => {
    if (routeCoords.length > 0 && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(routeCoords, {
          edgePadding: { top: 40, right: 20, bottom: 40, left: 20 },
          animated: true,
        });
      }, 400);
    }
  }, []);

  useEffect(() => {
    if (showHeatmap && gridData.length === 0) {
      loadGrid();
    }
  }, [showHeatmap]);

  const loadGrid = async () => {
    setLoadingGrid(true);
    try {
      const resp = await api.getAqiGrid();
      setGridData(resp.grid || []);
    } catch (err) {
      console.error('Grid load error:', err);
    } finally {
      setLoadingGrid(false);
    }
  };

  if (!routeData) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No route selected</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const profileType = profile?.type || 'normal';
  const hotspotThreshold = profileType === 'normal' ? 200
    : profileType === 'pregnant' ? 175 : 150;

  const aqiPoints = routeData.sampledAqiPoints || [];
  const hotspots = routeData.hotspots || [];
  const totalDistanceKm = (routeData.distanceMeters || 0) / 1000;
  const durationMin = Math.round((routeData.durationSeconds || 0) / 60);

  const timelineSegments = aqiPoints.map((pt, i) => {
    const progressKm = pt.distanceAlongRoute / 1000;
    const progressPercent = totalDistanceKm > 0 ? (progressKm / totalDistanceKm) * 100 : 0;
    const etaMin = Math.round((progressPercent / 100) * durationMin);
    const isHotspot = pt.aqi > hotspotThreshold;
    return { ...pt, i, progressPercent, etaMin, isHotspot };
  });

  const startCoord = routeCoords[0] || { latitude: 28.6, longitude: 77.2 };
  const endCoord = routeCoords[routeCoords.length - 1] || startCoord;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: startCoord.latitude,
            longitude: startCoord.longitude,
            latitudeDelta: 0.03,
            longitudeDelta: 0.03,
          }}
          showsUserLocation
          showsMyLocationButton
        >
          {showHeatmap && gridData.length > 0 && (
            <AqiHeatmapLayer gridData={gridData} visible={showHeatmap} cellSizeMeters={500} />
          )}

          <Polyline
            coordinates={routeCoords}
            strokeColor="#1a73e8"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
            zIndex={5}
          />

          {aqiPoints.filter(p => p.aqi > 150).slice(0, 20).map((pt, i) => (
            <Circle
              key={`hotspot-marker-${i}`}
              center={{ latitude: pt.lat, longitude: pt.lng }}
              radius={80}
              fillColor={aqiToColor(pt.aqi, 0.5)}
              strokeColor={pt.aqi > hotspotThreshold ? '#d93025' : 'transparent'}
              strokeWidth={pt.aqi > hotspotThreshold ? 2 : 0}
              zIndex={6}
            />
          ))}

          <Marker coordinate={startCoord} title="Start" pinColor="#1e8e3e" />
          <Marker coordinate={endCoord} title="End" pinColor="#d93025" />
        </MapView>

        <View style={styles.toolbar}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>AQI heatmap</Text>
            <Switch
              value={showHeatmap}
              onValueChange={setShowHeatmap}
              trackColor={{ true: '#1e8e3e', false: '#dadce0' }}
              thumbColor="#ffffff"
            />
            {loadingGrid && <ActivityIndicator size="small" color="#1e8e3e" style={{ marginLeft: 6 }} />}
          </View>

          <TouchableOpacity
            style={styles.advisoryFab}
            onPress={() => setAdvisoryVisible(true)}
          >
            <Text style={styles.advisoryFabText}>📋</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.routeSummary}>
            {routeData.summary || 'Selected route'} · {durationMin} min · {totalDistanceKm.toFixed(1)} km
          </Text>
          {routeData.isRecommended && (
            <View style={styles.recBadge}>
              <Text style={styles.recText}>★ Recommended</Text>
            </View>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Exposure</Text>
              <Text style={[
                styles.statValue,
                { color: routeData.exposureBand === 'Low' ? '#1e8e3e' : routeData.exposureBand === 'Moderate' ? '#f9ab00' : '#d93025' }
              ]}>
                {routeData.exposureBand || '—'}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Avg AQI</Text>
              <Text style={styles.statValue}>{routeData.avgAqi || '—'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Peak AQI</Text>
              <Text style={[
                styles.statValue,
                routeData.peakAqi > 200 && { color: '#d93025', fontWeight: 'bold' },
              ]}>
                {routeData.peakAqi || '—'}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Dose</Text>
              <Text style={styles.statValue}>{routeData.exposureScorePerHour || '—'}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🗺️ AQI along route</Text>
            <Text style={styles.sectionSub}>
              Sample points every ~400m · Profile threshold AQI {hotspotThreshold}
            </Text>
            <View style={styles.timelineContainer}>
              <View style={styles.timelineTrack}>
                <View style={styles.timelineBar}>
                  {timelineSegments.map((seg) => (
                    <View
                      key={seg.i}
                      style={{
                        position: 'absolute',
                        left: `${seg.progressPercent}%`,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        backgroundColor: aqiToColor(seg.aqi, 1),
                      }}
                    />
                  ))}
                </View>
              </View>

              {timelineSegments.filter(s => s.isHotspot).slice(0, 5).map((hs) => (
                <View key={`hs-${hs.i}`} style={styles.hotspotNote}>
                  <Text style={styles.hotspotNoteText}>
                    ⚠ High AQI {hs.aqi} ({aqiLabel(hs.aqi)}) at ~{Math.round(hs.distanceAlongRoute / 1000)}km · ETA {hs.etaMin} min
                  </Text>
                </View>
              ))}

              {hotspots.length > 0 && (
                <View style={styles.summaryList}>
                  <Text style={styles.summaryListTitle}>Hotspot segments:</Text>
                  {hotspots.map((h, i) => (
                    <View key={i} style={styles.summaryListItem}>
                      <Text style={styles.summaryListItemText}>
                        • Peak AQI {h.peakAqi} around {Math.round(h.startDistance / 1000)}-{Math.round((h.endDistance || h.startDistance) / 1000)}km into the route
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {hotspots.length === 0 && !routeData.hasHotspotWarning && (
                <Text style={styles.noHotspotText}>
                  ✅ No hotspot segments detected for this profile.
                </Text>
              )}
            </View>
          </View>

          <TouchableOpacity
            style={styles.showFullAdvisoryButton}
            onPress={() => setAdvisoryVisible(true)}
          >
            <Text style={styles.showFullAdvisoryText}>Show full health advisory</Text>
          </TouchableOpacity>

          <View style={{ height: 30 }} />
        </ScrollView>
      </View>

      <AdvisoryModal
        visible={advisoryVisible}
        onClose={() => setAdvisoryVisible(false)}
        route={routeData}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  mapContainer: {
    height: '45%',
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  toolbar: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#202124',
    marginRight: 8,
  },
  advisoryFab: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1a73e8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  advisoryFabText: {
    fontSize: 20,
  },
  panel: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    marginTop: -14,
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  routeSummary: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
  },
  recBadge: {
    backgroundColor: '#e6f4ea',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  recText: {
    color: '#1e8e3e',
    fontSize: 11,
    fontWeight: '700',
  },
  panelContent: {
    padding: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 10,
  },
  statLabel: {
    fontSize: 10,
    color: '#5f6368',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12,
    color: '#5f6368',
    marginBottom: 12,
  },
  timelineContainer: {},
  timelineTrack: {
    height: 28,
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 12,
  },
  timelineBar: {
    position: 'relative',
    flex: 1,
    width: '100%',
  },
  hotspotNote: {
    backgroundColor: '#fce8e6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 6,
  },
  hotspotNoteText: {
    fontSize: 12,
    color: '#d93025',
    fontWeight: '600',
  },
  noHotspotText: {
    marginTop: 6,
    color: '#1e8e3e',
    fontSize: 13,
    fontWeight: '600',
  },
  summaryList: {
    marginTop: 10,
  },
  summaryListTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 4,
  },
  summaryListItem: {
    marginBottom: 2,
  },
  summaryListItemText: {
    fontSize: 12,
    color: '#5f6368',
    lineHeight: 18,
  },
  showFullAdvisoryButton: {
    backgroundColor: '#1a73e8',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  showFullAdvisoryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    color: '#202124',
    fontWeight: '600',
    marginBottom: 12,
  },
  backLink: {
    color: '#1a73e8',
    fontSize: 14,
    fontWeight: '600',
  },
});
