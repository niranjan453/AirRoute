import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
} from "react-native";

import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  CircleLayer,
  UserLocation,
  PointAnnotation,
} from "@maplibre/maplibre-react-native";

import AdvisoryModal from "../components/AdvisoryModal";
import AqiHeatmapLayer from "../components/AqiHeatmapLayer";
import api from "../services/api";
import { useUserProfile } from "../context/UserProfileContext";
import { decodePolyline } from "../utils/polyline";

/*
 * ------------------------------------------------------------
 * OPENSTREETMAP STYLE
 * ------------------------------------------------------------
 */

const OSM_STYLE = {
  version: 8,

  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },

  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

/*
 * ------------------------------------------------------------
 * AQI HELPERS
 * ------------------------------------------------------------
 */

function aqiToColor(aqi, opacity = 0.6) {
  if (aqi <= 50) {
    return `rgba(0, 228, 0, ${opacity})`;
  }

  if (aqi <= 100) {
    return `rgba(255, 255, 0, ${opacity})`;
  }

  if (aqi <= 150) {
    return `rgba(255, 126, 0, ${opacity})`;
  }

  if (aqi <= 200) {
    return `rgba(255, 0, 0, ${opacity})`;
  }

  if (aqi <= 300) {
    return `rgba(143, 63, 151, ${opacity})`;
  }

  return `rgba(126, 0, 35, ${opacity})`;
}

function aqiLabel(aqi) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Sensitive";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";

  return "Hazardous";
}

/*
 * ------------------------------------------------------------
 * AQI MAP COLOR EXPRESSION
 * ------------------------------------------------------------
 */

function getAqiColorExpression() {
  return [
    "step",
    ["get", "aqi"],

    "rgba(0, 228, 0, 0.50)",

    50,
    "rgba(255, 255, 0, 0.50)",

    100,
    "rgba(255, 126, 0, 0.50)",

    150,
    "rgba(255, 0, 0, 0.50)",

    200,
    "rgba(143, 63, 151, 0.50)",

    300,
    "rgba(126, 0, 35, 0.50)",
  ];
}

/*
 * ------------------------------------------------------------
 * ROUTE DETAIL
 * ------------------------------------------------------------
 */

export default function RouteDetail({ route, navigation }) {
  const { profile } = useUserProfile();

  const params = route.params || {};

  const routeData = params.route;

  const allRoutes = params.allRoutes || [];

  const [showHeatmap, setShowHeatmap] = useState(false);

  const [advisoryVisible, setAdvisoryVisible] =
    useState(false);

  const [gridData, setGridData] = useState([]);

  const [loadingGrid, setLoadingGrid] =
    useState(false);

  const cameraRef = useRef(null);

  /*
   * ----------------------------------------------------------
   * ROUTE COORDINATES
   * ----------------------------------------------------------
   */

  const routeCoords = useMemo(() => {
    return decodePolyline(
      routeData?.polyline || ""
    );
  }, [routeData]);

  /*
   * ----------------------------------------------------------
   * ROUTE GEOJSON
   * ----------------------------------------------------------
   */

  const routeGeoJSON = useMemo(() => {
    if (routeCoords.length < 2) {
      return null;
    }

    const coordinates = routeCoords.map(
      ({ latitude, longitude }) => [
        longitude,
        latitude,
      ]
    );

    return {
      type: "Feature",
      properties: {
        routeId: routeData?.id || "selected-route",
      },
      geometry: {
        type: "LineString",
        coordinates,
      },
    };
  }, [routeCoords, routeData]);

  /*
   * ----------------------------------------------------------
   * FIT CAMERA TO ROUTE
   * ----------------------------------------------------------
   */

  useEffect(() => {
    if (!routeCoords.length) {
      return;
    }

    if (!cameraRef.current) {
      return;
    }

    if (routeCoords.length < 2) {
      return;
    }

    const coordinates = routeCoords.map(
      ({ latitude, longitude }) => [
        longitude,
        latitude,
      ]
    );

    let minLongitude = coordinates[0][0];
    let maxLongitude = coordinates[0][0];

    let minLatitude = coordinates[0][1];
    let maxLatitude = coordinates[0][1];

    coordinates.forEach(
      ([longitude, latitude]) => {
        minLongitude = Math.min(
          minLongitude,
          longitude
        );

        maxLongitude = Math.max(
          maxLongitude,
          longitude
        );

        minLatitude = Math.min(
          minLatitude,
          latitude
        );

        maxLatitude = Math.max(
          maxLatitude,
          latitude
        );
      }
    );

    const southwest = [
      minLongitude,
      minLatitude,
    ];

    const northeast = [
      maxLongitude,
      maxLatitude,
    ];

    const timer = setTimeout(() => {
      cameraRef.current?.fitBounds(
        northeast,
        southwest,
        40,
        800
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [routeCoords]);

  /*
   * ----------------------------------------------------------
   * LOAD AQI GRID
   * ----------------------------------------------------------
   */

  useEffect(() => {
    if (
      showHeatmap &&
      gridData.length === 0
    ) {
      loadGrid();
    }
  }, [showHeatmap]);

  const loadGrid = async () => {
    setLoadingGrid(true);

    try {
      const resp = await api.getAqiGrid();

      setGridData(resp.grid || []);
    } catch (err) {
      console.error(
        "Grid load error:",
        err
      );
    } finally {
      setLoadingGrid(false);
    }
  };

  /*
   * ----------------------------------------------------------
   * EMPTY STATE
   * ----------------------------------------------------------
   */

  if (!routeData) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>
          No route selected
        </Text>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backLink}>
            ← Go back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  /*
   * ----------------------------------------------------------
   * PROFILE / HOTSPOT THRESHOLD
   * ----------------------------------------------------------
   */

  const profileType =
    profile?.type || "normal";

  const hotspotThreshold =
    profileType === "normal"
      ? 200
      : profileType === "pregnant"
        ? 175
        : 150;

  /*
   * ----------------------------------------------------------
   * ROUTE DATA
   * ----------------------------------------------------------
   */

  const aqiPoints =
    routeData.sampledAqiPoints || [];

  const hotspots =
    routeData.hotspots || [];

  const totalDistanceKm =
    (routeData.distanceMeters || 0) / 1000;

  const durationMin = Math.round(
    (routeData.durationSeconds || 0) / 60
  );

  /*
   * ----------------------------------------------------------
   * AQI TIMELINE
   * ----------------------------------------------------------
   */

  const timelineSegments =
    aqiPoints.map((pt, i) => {
      const progressKm =
        pt.distanceAlongRoute / 1000;

      const progressPercent =
        totalDistanceKm > 0
          ? (progressKm / totalDistanceKm) * 100
          : 0;

      const etaMin = Math.round(
        (progressPercent / 100) *
          durationMin
      );

      const isHotspot =
        pt.aqi > hotspotThreshold;

      return {
        ...pt,
        i,
        progressPercent,
        etaMin,
        isHotspot,
      };
    });

  /*
   * ----------------------------------------------------------
   * START / END
   * ----------------------------------------------------------
   */

  const startCoord =
    routeCoords[0] || {
      latitude: 28.6,
      longitude: 77.2,
    };

  const endCoord =
    routeCoords[
      routeCoords.length - 1
    ] || startCoord;

  /*
   * ----------------------------------------------------------
   * HOTSPOT GEOJSON
   * ----------------------------------------------------------
   */

  const hotspotGeoJSON = useMemo(() => {
    const points = aqiPoints
      .filter(
        (point) =>
          typeof point?.lat === "number" &&
          typeof point?.lng === "number" &&
          typeof point?.aqi === "number" &&
          point.aqi > 150
      )
      .slice(0, 20);

    return {
      type: "FeatureCollection",

      features: points.map(
        (point, index) => ({
          type: "Feature",

          id: `route-hotspot-${index}`,

          properties: {
            aqi: point.aqi,

            isHotspot:
              point.aqi >
              hotspotThreshold,
          },

          geometry: {
            type: "Point",

            coordinates: [
              point.lng,
              point.lat,
            ],
          },
        })
      ),
    };
  }, [
    aqiPoints,
    hotspotThreshold,
  ]);

  /*
   * ----------------------------------------------------------
   * RENDER
   * ----------------------------------------------------------
   */

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mapContainer}>
        <MapView
          style={styles.map}
          mapStyle={OSM_STYLE}
          logoEnabled={true}
          attributionEnabled={true}
          compassEnabled={true}
          zoomEnabled={true}
          scrollEnabled={true}
          rotateEnabled={true}
          pitchEnabled={true}
        >
          <Camera
            ref={cameraRef}
            zoomLevel={12}
            centerCoordinate={[
              startCoord.longitude,
              startCoord.latitude,
            ]}
          />

          {/*
           * ------------------------------------------------
           * USER LOCATION
           * ------------------------------------------------
           */}

          <UserLocation
            visible={true}
            animated={true}
            androidRenderMode="normal"
            showsUserHeadingIndicator={true}
          />

          {/*
           * ------------------------------------------------
           * AQI HEATMAP
           * ------------------------------------------------
           */}

          {showHeatmap &&
            gridData.length > 0 && (
              <AqiHeatmapLayer
                gridData={gridData}
                visible={showHeatmap}
                cellSizeMeters={500}
              />
            )}

          {/*
           * ------------------------------------------------
           * SELECTED ROUTE
           * ------------------------------------------------
           */}

          {routeGeoJSON && (
            <ShapeSource
              id="route-detail-source"
              shape={routeGeoJSON}
            >
              <LineLayer
                id="route-detail-line"
                style={{
                  lineColor: "#1a73e8",

                  lineWidth: 5,

                  lineCap: "round",

                  lineJoin: "round",

                  lineOpacity: 0.95,
                }}
              />
            </ShapeSource>
          )}

          {/*
           * ------------------------------------------------
           * ROUTE AQI HOTSPOTS
           * ------------------------------------------------
           */}

          {hotspotGeoJSON.features
            .length > 0 && (
            <ShapeSource
              id="route-hotspots-source"
              shape={hotspotGeoJSON}
            >
              <CircleLayer
                id="route-hotspots-layer"
                style={{
                  circleColor:
                    getAqiColorExpression(),

                  circleRadius: [
                    "interpolate",
                    ["linear"],
                    ["get", "aqi"],

                    150,
                    10,

                    200,
                    13,

                    300,
                    17,

                    500,
                    21,
                  ],

                  circleOpacity: 0.5,

                  circleStrokeColor: [
                    "case",

                    ["get", "isHotspot"],

                    "#d93025",

                    "rgba(0,0,0,0)",
                  ],

                  circleStrokeWidth: [
                    "case",

                    ["get", "isHotspot"],

                    2,

                    0,
                  ],
                }}
              />
            </ShapeSource>
          )}

          {/*
           * ------------------------------------------------
           * START MARKER
           * ------------------------------------------------
           */}

          <PointAnnotation
            id="route-detail-start"
            coordinate={[
              startCoord.longitude,
              startCoord.latitude,
            ]}
          >
            <View
              style={[
                styles.mapMarker,
                styles.startMarker,
              ]}
            >
              <View
                style={styles.markerDot}
              />
            </View>
          </PointAnnotation>

          {/*
           * ------------------------------------------------
           * END MARKER
           * ------------------------------------------------
           */}

          <PointAnnotation
            id="route-detail-end"
            coordinate={[
              endCoord.longitude,
              endCoord.latitude,
            ]}
          >
            <View
              style={[
                styles.mapMarker,
                styles.endMarker,
              ]}
            >
              <View
                style={styles.markerDot}
              />
            </View>
          </PointAnnotation>
        </MapView>

        {/*
         * ----------------------------------------------------
         * MAP TOOLBAR
         * ----------------------------------------------------
         */}

        <View style={styles.toolbar}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              AQI heatmap
            </Text>

            <Switch
              value={showHeatmap}
              onValueChange={
                setShowHeatmap
              }
              trackColor={{
                true: "#1e8e3e",
                false: "#dadce0",
              }}
              thumbColor="#ffffff"
            />

            {loadingGrid && (
              <ActivityIndicator
                size="small"
                color="#1e8e3e"
                style={{
                  marginLeft: 6,
                }}
              />
            )}
          </View>

          <TouchableOpacity
            style={styles.advisoryFab}
            onPress={() =>
              setAdvisoryVisible(true)
            }
          >
            <Text
              style={
                styles.advisoryFabText
              }
            >
              📋
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/*
       * ------------------------------------------------------
       * DETAILS PANEL
       * ------------------------------------------------------
       */}

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text
            style={styles.routeSummary}
          >
            {routeData.summary ||
              "Selected route"}{" "}
            · {durationMin} min ·{" "}
            {totalDistanceKm.toFixed(1)} km
          </Text>

          {routeData.isRecommended && (
            <View style={styles.recBadge}>
              <Text style={styles.recText}>
                ★ Recommended
              </Text>
            </View>
          )}
        </View>

        <ScrollView
          contentContainerStyle={
            styles.panelContent
          }
          showsVerticalScrollIndicator={
            false
          }
        >
          {/*
           * ------------------------------------------------
           * STATS
           * ------------------------------------------------
           */}

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text
                style={styles.statLabel}
              >
                Exposure
              </Text>

              <Text
                style={[
                  styles.statValue,

                  {
                    color:
                      routeData.exposureBand ===
                      "Low"
                        ? "#1e8e3e"
                        : routeData.exposureBand ===
                            "Moderate"
                          ? "#f9ab00"
                          : "#d93025",
                  },
                ]}
              >
                {routeData.exposureBand ||
                  "—"}
              </Text>
            </View>

            <View style={styles.statBox}>
              <Text
                style={styles.statLabel}
              >
                Avg AQI
              </Text>

              <Text
                style={styles.statValue}
              >
                {routeData.avgAqi ||
                  "—"}
              </Text>
            </View>

            <View style={styles.statBox}>
              <Text
                style={styles.statLabel}
              >
                Peak AQI
              </Text>

              <Text
                style={[
                  styles.statValue,

                  routeData.peakAqi >
                    200 && {
                    color: "#d93025",
                    fontWeight: "bold",
                  },
                ]}
              >
                {routeData.peakAqi ||
                  "—"}
              </Text>
            </View>

            <View style={styles.statBox}>
              <Text
                style={styles.statLabel}
              >
                Dose
              </Text>

              <Text
                style={styles.statValue}
              >
                {routeData.exposureScorePerHour ||
                  "—"}
              </Text>
            </View>
          </View>

          {/*
           * ------------------------------------------------
           * AQI TIMELINE
           * ------------------------------------------------
           */}

          <View style={styles.section}>
            <Text
              style={styles.sectionTitle}
            >
              🗺️ AQI along route
            </Text>

            <Text
              style={styles.sectionSub}
            >
              Sample points every ~400m ·
              Profile threshold AQI{" "}
              {hotspotThreshold}
            </Text>

            <View
              style={
                styles.timelineContainer
              }
            >
              <View
                style={
                  styles.timelineTrack
                }
              >
                <View
                  style={
                    styles.timelineBar
                  }
                >
                  {timelineSegments.map(
                    (seg) => (
                      <View
                        key={seg.i}
                        style={{
                          position:
                            "absolute",

                          left: `${Math.min(
                            100,
                            Math.max(
                              0,
                              seg.progressPercent
                            )
                          )}%`,

                          top: 0,

                          bottom: 0,

                          width: 3,

                          backgroundColor:
                            aqiToColor(
                              seg.aqi,
                              1
                            ),
                        }}
                      />
                    )
                  )}
                </View>
              </View>

              {timelineSegments
                .filter(
                  (segment) =>
                    segment.isHotspot
                )
                .slice(0, 5)
                .map((hs) => (
                  <View
                    key={`hs-${hs.i}`}
                    style={
                      styles.hotspotNote
                    }
                  >
                    <Text
                      style={
                        styles.hotspotNoteText
                      }
                    >
                      ⚠ High AQI{" "}
                      {hs.aqi} (
                      {aqiLabel(hs.aqi)})
                      at ~
                      {Math.round(
                        hs.distanceAlongRoute /
                          1000
                      )}
                      km · ETA{" "}
                      {hs.etaMin} min
                    </Text>
                  </View>
                ))}

              {hotspots.length > 0 && (
                <View
                  style={
                    styles.summaryList
                  }
                >
                  <Text
                    style={
                      styles.summaryListTitle
                    }
                  >
                    Hotspot segments:
                  </Text>

                  {hotspots.map(
                    (h, i) => (
                      <View
                        key={i}
                        style={
                          styles.summaryListItem
                        }
                      >
                        <Text
                          style={
                            styles.summaryListItemText
                          }
                        >
                          • Peak AQI{" "}
                          {h.peakAqi} around{" "}
                          {Math.round(
                            h.startDistance /
                              1000
                          )}
                          -
                          {Math.round(
                            (h.endDistance ||
                              h.startDistance) /
                              1000
                          )}
                          km into the
                          route
                        </Text>
                      </View>
                    )
                  )}
                </View>
              )}

              {hotspots.length === 0 &&
                !routeData.hasHotspotWarning && (
                  <Text
                    style={
                      styles.noHotspotText
                    }
                  >
                    ✅ No hotspot segments
                    detected for this
                    profile.
                  </Text>
                )}
            </View>
          </View>

          {/*
           * ------------------------------------------------
           * ADVISORY BUTTON
           * ------------------------------------------------
           */}

          <TouchableOpacity
            style={
              styles.showFullAdvisoryButton
            }
            onPress={() =>
              setAdvisoryVisible(true)
            }
          >
            <Text
              style={
                styles.showFullAdvisoryText
              }
            >
              Show full health advisory
            </Text>
          </TouchableOpacity>

          <View style={{ height: 30 }} />
        </ScrollView>
      </View>

      {/*
       * ------------------------------------------------------
       * ADVISORY MODAL
       * ------------------------------------------------------
       */}

      <AdvisoryModal
        visible={advisoryVisible}
        onClose={() =>
          setAdvisoryVisible(false)
        }
        route={routeData}
      />
    </SafeAreaView>
  );
}

/*
 * ============================================================
 * STYLES
 * ============================================================
 */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },

  mapContainer: {
    height: "45%",
    position: "relative",
  },

  map: {
    ...StyleSheet.absoluteFillObject,
  },

  /*
   * ----------------------------------------------------------
   * MAP MARKERS
   * ----------------------------------------------------------
   */

  mapMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#ffffff",
  },

  startMarker: {
    backgroundColor: "#1e8e3e",
  },

  endMarker: {
    backgroundColor: "#d93025",
  },

  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ffffff",
  },

  /*
   * ----------------------------------------------------------
   * TOOLBAR
   * ----------------------------------------------------------
   */

  toolbar: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor:
      "rgba(255,255,255,0.95)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 1,
    },
  },

  toggleLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#202124",
    marginRight: 8,
  },

  advisoryFab: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#1a73e8",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  advisoryFabText: {
    fontSize: 20,
  },

  /*
   * ----------------------------------------------------------
   * PANEL
   * ----------------------------------------------------------
   */

  panel: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    marginTop: -14,
    overflow: "hidden",
  },

  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },

  routeSummary: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: "#202124",
    marginRight: 8,
  },

  recBadge: {
    backgroundColor: "#e6f4ea",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },

  recText: {
    color: "#1e8e3e",
    fontSize: 11,
    fontWeight: "700",
  },

  panelContent: {
    padding: 16,
  },

  /*
   * ----------------------------------------------------------
   * STATS
   * ----------------------------------------------------------
   */

  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },

  statBox: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#f8f9fa",
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 10,
  },

  statLabel: {
    fontSize: 10,
    color: "#5f6368",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#202124",
  },

  /*
   * ----------------------------------------------------------
   * AQI SECTION
   * ----------------------------------------------------------
   */

  section: {
    marginBottom: 18,
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#202124",
    marginBottom: 4,
  },

  sectionSub: {
    fontSize: 12,
    color: "#5f6368",
    marginBottom: 12,
  },

  timelineContainer: {},

  timelineTrack: {
    height: 28,
    backgroundColor: "#f8f9fa",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 12,
  },

  timelineBar: {
    position: "relative",
    flex: 1,
    width: "100%",
  },

  hotspotNote: {
    backgroundColor: "#fce8e6",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 6,
  },

  hotspotNoteText: {
    fontSize: 12,
    color: "#d93025",
    fontWeight: "600",
  },

  noHotspotText: {
    marginTop: 6,
    color: "#1e8e3e",
    fontSize: 13,
    fontWeight: "600",
  },

  summaryList: {
    marginTop: 10,
  },

  summaryListTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#202124",
    marginBottom: 4,
  },

  summaryListItem: {
    marginBottom: 2,
  },

  summaryListItemText: {
    fontSize: 12,
    color: "#5f6368",
    lineHeight: 18,
  },

  /*
   * ----------------------------------------------------------
   * ADVISORY BUTTON
   * ----------------------------------------------------------
   */

  showFullAdvisoryButton: {
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },

  showFullAdvisoryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },

  /*
   * ----------------------------------------------------------
   * EMPTY STATE
   * ----------------------------------------------------------
   */

  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },

  emptyTitle: {
    fontSize: 18,
    color: "#202124",
    fontWeight: "600",
    marginBottom: 12,
  },

  backLink: {
    color: "#1a73e8",
    fontSize: 14,
    fontWeight: "600",
  },
});