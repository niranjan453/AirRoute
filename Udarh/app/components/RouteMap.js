// components/RouteMap.js

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  StyleSheet,
  View,
} from "react-native";

import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  CircleLayer,
  PointAnnotation,
  UserLocation,
} from "@maplibre/maplibre-react-native";

// ============================================================
// CONSTANTS
// ============================================================

const AQI_COLORS = {
  low: "#1e8e3e",
  moderate: "#f9ab00",
  high: "#d93025",
  critical: "#8f3f97",
  unknown: "#9e9e9e",
};

// ============================================================
// MAP STYLE
// ============================================================

const OSM_STYLE = {
  version: 8,

  sources: {
    osm: {
      type: "raster",

      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],

      tileSize: 256,

      attribution:
        "© OpenStreetMap contributors",
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

// ============================================================
// HELPERS
// ============================================================

function getRouteId(route) {
  return (
    route?.routeId ||
    route?.id ||
    null
  );
}

function getAqiColor(
  aqi,
  category
) {
  const value = Number(aqi);

  const normalizedCategory =
    String(
      category || ""
    ).toLowerCase();

  if (
    normalizedCategory.includes(
      "critical"
    ) ||
    value >= 300
  ) {
    return AQI_COLORS.critical;
  }

  if (
    normalizedCategory.includes(
      "high"
    ) ||
    value >= 150
  ) {
    return AQI_COLORS.high;
  }

  if (
    normalizedCategory.includes(
      "moderate"
    ) ||
    value >= 100
  ) {
    return AQI_COLORS.moderate;
  }

  if (value >= 0) {
    return AQI_COLORS.low;
  }

  return AQI_COLORS.unknown;
}

function normalizeCoordinates(
  coordinates
) {
  if (
    !Array.isArray(
      coordinates
    )
  ) {
    return [];
  }

  return coordinates
    .filter(
      (coordinate) =>
        Array.isArray(
          coordinate
        ) &&
        coordinate.length >=
          2 &&
        Number.isFinite(
          Number(
            coordinate[0]
          )
        ) &&
        Number.isFinite(
          Number(
            coordinate[1]
          )
        )
    )
    .map(
      (coordinate) => [
        Number(
          coordinate[0]
        ),
        Number(
          coordinate[1]
        ),
      ]
    );
}

function getRouteCoordinates(
  route
) {
  return normalizeCoordinates(
    route?.geometry
      ?.coordinates
  );
}

function getAqiSegments(
  route
) {
  const segments =
    route?.airQuality
      ?.segments;

  if (
    !Array.isArray(
      segments
    )
  ) {
    return [];
  }

  return segments.filter(
    (segment) =>
      Number.isFinite(
        Number(
          segment?.aqi
        )
      )
  );
}

function getHotspotCoordinate(
  hotspot
) {
  const start =
    hotspot?.startLocation;

  const end =
    hotspot?.endLocation;

  if (
    Number.isFinite(
      Number(start?.lat)
    ) &&
    Number.isFinite(
      Number(start?.lng)
    )
  ) {
    return [
      Number(start.lng),
      Number(start.lat),
    ];
  }

  if (
    Number.isFinite(
      Number(end?.lat)
    ) &&
    Number.isFinite(
      Number(end?.lng)
    )
  ) {
    return [
      Number(end.lng),
      Number(end.lat),
    ];
  }

  return null;
}

// ============================================================
// COMPONENT
// ============================================================

export default function RouteMap({
  routes = [],
  selectedRouteId,
  focusSelectedRoute = false,
}) {
  const cameraRef =
    useRef(null);

  // Used for blinking the actual AQI
  // sampling locations.
  const [
    pulse,
    setPulse,
  ] = useState(true);

  // ==========================================================
  // AQI POINT BLINK
  // ==========================================================

  useEffect(() => {
    const interval =
      setInterval(() => {
        setPulse(
          (previous) =>
            !previous
        );
      }, 650);

    return () =>
      clearInterval(
        interval
      );
  }, []);

  // ==========================================================
  // NORMALIZED ROUTES
  // ==========================================================

  const normalizedRoutes =
    useMemo(() => {
      return routes
        .map((route) => {
          const routeId =
            getRouteId(route);

          const coordinates =
            getRouteCoordinates(
              route
            );

          if (
            !routeId ||
            coordinates.length <
              2
          ) {
            return null;
          }

          return {
            routeId,

            coordinates,

            selected:
              routeId ===
              selectedRouteId,

            recommended:
              route?.recommended ===
              true,
          };
        })
        .filter(Boolean);
    }, [
      routes,
      selectedRouteId,
    ]);

  // ==========================================================
  // SELECTED ROUTE
  // ==========================================================

  const selectedRoute =
    useMemo(() => {
      return (
        routes.find(
          (route) =>
            getRouteId(route) ===
            selectedRouteId
        ) ||
        routes.find(
          (route) =>
            route?.recommended ===
            true
        ) ||
        routes[0] ||
        null
      );
    }, [
      routes,
      selectedRouteId,
    ]);

  const selectedCoordinates =
    useMemo(() => {
      return getRouteCoordinates(
        selectedRoute
      );
    }, [selectedRoute]);

  // ==========================================================
  // BASE ROUTE GEOJSON
  // ==========================================================

  const routeGeoJSON =
    useMemo(() => {
      return {
        type:
          "FeatureCollection",

        features:
          normalizedRoutes.map(
            (route) => {
              const isSelected =
                route.selected;

              let color;
              let width;
              let opacity;

              // ------------------------------------------------
              // ROUTE DETAIL MODE
              // ------------------------------------------------

              if (
                focusSelectedRoute
              ) {
                if (
                  isSelected
                ) {
                  color =
                    "#1769aa";

                  width = 8;

                  opacity = 1;
                } else {
                  color =
                    "#aeb4ba";

                  width = 3;

                  opacity = 0.20;
                }
              }

              // ------------------------------------------------
              // NORMAL ROUTE RESULTS MODE
              // ------------------------------------------------

              else {
                color =
                  route.selected
                    ? "#1769aa"
                    : route.recommended
                    ? "#34a853"
                    : "#aeb4ba";

                width =
                  route.selected
                    ? 8
                    : route.recommended
                    ? 6
                    : 3;

                opacity =
                  route.selected
                    ? 1
                    : route.recommended
                    ? 0.9
                    : 0.4;
              }

              return {
                type: "Feature",

                id: String(
                  route.routeId
                ),

                properties: {
                  routeId:
                    String(
                      route.routeId
                    ),

                  color,

                  width,

                  opacity,
                },

                geometry: {
                  type:
                    "LineString",

                  coordinates:
                    route.coordinates,
                },
              };
            }
          ),
      };
    }, [
      normalizedRoutes,
      focusSelectedRoute,
    ]);

  // ==========================================================
  // AQI SEGMENT GEOJSON
  // ==========================================================
  //
  // Backend structure:
  //
  // route.airQuality.segments[]
  //
  // We keep the same AQI source/data
  // structure as the working version.
  //
  // ONLY visual opacity/width changes
  // for RouteDetail focus mode.
  //
  // ==========================================================

  const aqiSegmentGeoJSON =
    useMemo(() => {
      const features = [];

      normalizedRoutes.forEach(
        (normalizedRoute) => {
          const originalRoute =
            routes.find(
              (route) =>
                getRouteId(
                  route
                ) ===
                normalizedRoute.routeId
            );

          if (!originalRoute) {
            return;
          }

          const segments =
            getAqiSegments(
              originalRoute
            );

          if (
            segments.length ===
            0
          ) {
            return;
          }

          const coordinates =
            normalizedRoute.coordinates;

          if (
            coordinates.length <
            2
          ) {
            return;
          }

          const routeDistance =
            Number(
              originalRoute
                ?.distance
                ?.meters
            ) || 0;

          for (
            let index = 0;
            index <
              coordinates.length -
                1;
            index++
          ) {
            const progress =
              index /
              Math.max(
                coordinates.length -
                  1,
                1
              );

            const estimatedDistance =
              routeDistance *
              progress;

            let closestSegment =
              segments[0];

            let closestDifference =
              Infinity;

            segments.forEach(
              (segment) => {
                const segmentDistance =
                  Number(
                    segment?.distanceMeters
                  ) || 0;

                const difference =
                  Math.abs(
                    segmentDistance -
                      estimatedDistance
                  );

                if (
                  difference <
                  closestDifference
                ) {
                  closestDifference =
                    difference;

                  closestSegment =
                    segment;
                }
              }
            );

            const isSelected =
              normalizedRoute.selected;

            const isRecommended =
              normalizedRoute.recommended;

            let width;
            let opacity;

            // ------------------------------------------------
            // ROUTE DETAIL MODE
            // ------------------------------------------------

            if (
              focusSelectedRoute
            ) {
              if (
                isSelected
              ) {
                width = 8;

                opacity = 0.95;
              } else {
                width = 3;

                opacity = 0.10;
              }
            }

            // ------------------------------------------------
            // NORMAL MODE
            // ------------------------------------------------

            else {
              width =
                isSelected
                  ? 8
                  : isRecommended
                  ? 5
                  : 3;

              opacity =
                isSelected
                  ? 0.95
                  : isRecommended
                  ? 0.7
                  : 0.25;
            }

            features.push({
              type: "Feature",

              id: `${normalizedRoute.routeId}-aqi-${index}`,

              properties: {
                color:
                  getAqiColor(
                    closestSegment?.aqi,
                    closestSegment?.category
                  ),

                width,

                opacity,
              },

              geometry: {
                type:
                  "LineString",

                coordinates: [
                  coordinates[
                    index
                  ],
                  coordinates[
                    index + 1
                  ],
                ],
              },
            });
          }
        }
      );

      return {
        type:
          "FeatureCollection",

        features,
      };
    }, [
      normalizedRoutes,
      routes,
      focusSelectedRoute,
    ]);

  // ==========================================================
  // ACTUAL AQI FETCH LOCATIONS
  // ==========================================================
  //
  // IMPORTANT:
  // Same backend AQI structure.
  //
  // route.airQuality.segments[].lat
  // route.airQuality.segments[].lng
  //
  // We DO NOT modify AQI values.
  //
  // ==========================================================

  const aqiPointGeoJSON =
    useMemo(() => {
      const features = [];

      routes.forEach(
        (route) => {
          const routeId =
            getRouteId(route);

          if (!routeId) {
            return;
          }

          const isSelected =
            routeId ===
            selectedRouteId;

          const segments =
            getAqiSegments(
              route
            );

          segments.forEach(
            (
              segment,
              index
            ) => {
              const lat =
                Number(
                  segment?.lat
                );

              const lng =
                Number(
                  segment?.lng
                );

              if (
                !Number.isFinite(
                  lat
                ) ||
                !Number.isFinite(
                  lng
                )
              ) {
                return;
              }

              features.push({
                type: "Feature",

                id: `${routeId}-aqi-point-${index}`,

                properties: {
                  aqi:
                    Number(
                      segment.aqi
                    ),

                  color:
                    getAqiColor(
                      segment.aqi,
                      segment.category
                    ),

                  selected:
                    isSelected
                      ? 1
                      : 0,

                  // Visual-only opacity.
                  opacity:
                    focusSelectedRoute
                      ? isSelected
                        ? 0.95
                        : 0.12
                      : 1,
                },

                geometry: {
                  type:
                    "Point",

                  coordinates: [
                    lng,
                    lat,
                  ],
                },
              });
            }
          );
        }
      );

      return {
        type:
          "FeatureCollection",

        features,
      };
    }, [
      routes,
      selectedRouteId,
      focusSelectedRoute,
    ]);

  // ==========================================================
  // HOTSPOT GEOJSON
  // ==========================================================

  const hotspotGeoJSON =
    useMemo(() => {
      const features = [];

      routes.forEach(
        (route) => {
          const routeId =
            getRouteId(route);

          if (!routeId) {
            return;
          }

          const isSelected =
            routeId ===
            selectedRouteId;

          const hotspotItems =
            Array.isArray(
              route?.hotspots
                ?.items
            )
              ? route.hotspots.items
              : [];

          hotspotItems.forEach(
            (
              hotspot,
              index
            ) => {
              const coordinate =
                getHotspotCoordinate(
                  hotspot
                );

              if (
                !coordinate
              ) {
                return;
              }

              features.push({
                type:
                  "Feature",

                id: `${routeId}-hotspot-${index}`,

                properties: {
                  color:
                    hotspot?.critical
                      ? "#b31412"
                      : "#d93025",

                  selected:
                    isSelected
                      ? 1
                      : 0,

                  opacity:
                    focusSelectedRoute
                      ? isSelected
                        ? 0.9
                        : 0.12
                      : 0.9,

                  peakAqi:
                    Number(
                      hotspot?.peakAqi
                    ) || 0,
                },

                geometry: {
                  type:
                    "Point",

                  coordinates:
                    coordinate,
                },
              });
            }
          );
        }
      );

      return {
        type:
          "FeatureCollection",

        features,
      };
    }, [
      routes,
      selectedRouteId,
      focusSelectedRoute,
    ]);

  // ==========================================================
  // CAMERA
  // ==========================================================

  useEffect(() => {
    if (
      !cameraRef.current ||
      selectedCoordinates.length <
        2
    ) {
      return;
    }

    let minLongitude =
      selectedCoordinates[0][0];

    let maxLongitude =
      selectedCoordinates[0][0];

    let minLatitude =
      selectedCoordinates[0][1];

    let maxLatitude =
      selectedCoordinates[0][1];

    selectedCoordinates.forEach(
      (coordinate) => {
        const longitude =
          coordinate[0];

        const latitude =
          coordinate[1];

        minLongitude =
          Math.min(
            minLongitude,
            longitude
          );

        maxLongitude =
          Math.max(
            maxLongitude,
            longitude
          );

        minLatitude =
          Math.min(
            minLatitude,
            latitude
          );

        maxLatitude =
          Math.max(
            maxLatitude,
            latitude
          );
      }
    );

    const timer =
      setTimeout(() => {
        cameraRef.current?.fitBounds(
          [
            maxLongitude,
            maxLatitude,
          ],
          [
            minLongitude,
            minLatitude,
          ],
          70,
          900
        );
      }, 250);

    return () =>
      clearTimeout(timer);
  }, [
    selectedCoordinates,
  ]);

  // ==========================================================
  // FALLBACK COORDINATES
  // ==========================================================

  const initialPoint =
    selectedCoordinates[0] ||
    [77.209, 28.6139];

  const destinationPoint =
    selectedCoordinates[
      selectedCoordinates.length -
        1
    ] ||
    initialPoint;

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <View
      style={
        styles.container
      }
    >
      <MapView
        style={styles.map}
        mapStyle={OSM_STYLE}
        logoEnabled
        attributionEnabled
        compassEnabled
        zoomEnabled
        scrollEnabled
        rotateEnabled
        pitchEnabled
      >
        {/* ==================================================
            CAMERA
            ================================================== */}

        <Camera
          ref={cameraRef}
          zoomLevel={12}
          centerCoordinate={
            initialPoint
          }
        />

        {/* ==================================================
            USER LOCATION
            ================================================== */}

        <UserLocation
          visible
          animated
          androidRenderMode="normal"
          showsUserHeadingIndicator
        />

        {/* ==================================================
            ROUTES
            ================================================== */}

        {routeGeoJSON
          .features
          .length > 0 && (
          <ShapeSource
            id="airroute-routes"
            shape={
              routeGeoJSON
            }
          >
            <LineLayer
              id="airroute-base-routes"
              style={{
                lineColor: [
                  "get",
                  "color",
                ],

                lineWidth: [
                  "get",
                  "width",
                ],

                lineOpacity: [
                  "get",
                  "opacity",
                ],

                lineCap:
                  "round",

                lineJoin:
                  "round",
              }}
            />
          </ShapeSource>
        )}

        {/* ==================================================
            AQI COLORED ROUTE SEGMENTS
            ================================================== */}

        {aqiSegmentGeoJSON
          .features
          .length > 0 && (
          <ShapeSource
            id="airroute-aqi-segments"
            shape={
              aqiSegmentGeoJSON
            }
          >
            <LineLayer
              id="airroute-aqi-lines"
              style={{
                lineColor: [
                  "get",
                  "color",
                ],

                lineWidth: [
                  "get",
                  "width",
                ],

                lineOpacity: [
                  "get",
                  "opacity",
                ],

                lineCap:
                  "round",

                lineJoin:
                  "round",
              }}
            />
          </ShapeSource>
        )}

        {/* ==================================================
            ACTUAL AQI FETCH LOCATIONS
            ================================================== */}

        {aqiPointGeoJSON
          .features
          .length > 0 && (
          <ShapeSource
            id="airroute-aqi-points"
            shape={
              aqiPointGeoJSON
            }
          >
            <CircleLayer
              id="airroute-aqi-fetch-points"
              style={{
                circleColor: [
                  "get",
                  "color",
                ],

                circleRadius:
                  pulse ? 6 : 3,

                circleOpacity: [
                  "get",
                  "opacity",
                ],

                circleStrokeColor:
                  "#ffffff",

                circleStrokeWidth:
                  pulse ? 2 : 1,
              }}
            />
          </ShapeSource>
        )}

        {/* ==================================================
            POLLUTION / TRAFFIC HOTSPOTS
            ================================================== */}

        {hotspotGeoJSON
          .features
          .length > 0 && (
          <ShapeSource
            id="airroute-hotspots"
            shape={
              hotspotGeoJSON
            }
          >
            <CircleLayer
              id="airroute-hotspot-layer"
              style={{
                circleColor: [
                  "get",
                  "color",
                ],

                circleRadius:
                  8,

                circleOpacity: [
                  "get",
                  "opacity",
                ],

                circleStrokeColor:
                  "#ffffff",

                circleStrokeWidth:
                  2,
              }}
            />
          </ShapeSource>
        )}

        {/* ==================================================
            ORIGIN
            ================================================== */}

        <PointAnnotation
          id="airroute-origin"
          coordinate={
            initialPoint
          }
        />

        {/* ==================================================
            DESTINATION
            ================================================== */}

        <PointAnnotation
          id="airroute-destination"
          coordinate={
            destinationPoint
          }
        />
      </MapView>
    </View>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
    },

    map: {
      flex: 1,
    },
  });