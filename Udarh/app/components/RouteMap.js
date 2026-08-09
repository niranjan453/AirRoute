import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  PointAnnotation,
  UserLocation,
} from "@maplibre/maplibre-react-native";

import { decodePolyline } from "../utils/polyline";

const ROUTE_COLORS = {
  Low: "#1e8e3e",
  Moderate: "#f9ab00",
  High: "#d93025",
};

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

export default function RouteMap({
  routes = [],
  selectedRouteId,
}) {
  const cameraRef = useRef(null);

  /*
   * ------------------------------------------------------------
   * SELECTED ROUTE
   * ------------------------------------------------------------
   */

  const selectedRoute =
    routes.find((route) => route.id === selectedRouteId) ||
    routes[0] ||
    null;

  /*
   * ------------------------------------------------------------
   * DECODE ROUTES
   * ------------------------------------------------------------
   */

  const routeData = useMemo(() => {
    return routes
      .map((route) => {
        const coordinates = decodePolyline(route.polyline);

        console.log("========== ROUTE MAP ==========");
        console.log("Route:", route.id);
        console.log("Decoded Points:", coordinates.length);

        if (coordinates.length > 0) {
          console.log("Start:", coordinates[0]);
          console.log(
            "End:",
            coordinates[coordinates.length - 1]
          );
        }

        console.log("===============================");

        if (coordinates.length < 2) {
          return null;
        }

        /*
         * MapLibre GeoJSON uses:
         *
         * [longitude, latitude]
         *
         * while our decoder returns:
         *
         * { latitude, longitude }
         */

        const lineCoordinates = coordinates.map(
          ({ latitude, longitude }) => [
            longitude,
            latitude,
          ]
        );

        return {
          id: route.id,
          exposureBand: route.exposureBand,
          coordinates,
          lineCoordinates,
          color:
            route.id === selectedRouteId
              ? ROUTE_COLORS[route.exposureBand] || "#1A73E8"
              : "#BDBDBD",
          width:
            route.id === selectedRouteId
              ? 6
              : 4,
        };
      })
      .filter(Boolean);
  }, [routes, selectedRouteId]);

  /*
   * ------------------------------------------------------------
   * SELECTED ROUTE COORDINATES
   * ------------------------------------------------------------
   */

  const selectedCoordinates = useMemo(() => {
    const route = routeData.find(
      (item) => item.id === selectedRouteId
    );

    if (route) {
      return route.coordinates;
    }

    return routeData[0]?.coordinates || [];
  }, [routeData, selectedRouteId]);

  /*
   * ------------------------------------------------------------
   * CAMERA
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (!cameraRef.current) return;

    if (selectedCoordinates.length < 2) {
      return;
    }

    const coordinates = selectedCoordinates.map(
      ({ latitude, longitude }) => [
        longitude,
        latitude,
      ]
    );

    let minLongitude = coordinates[0][0];
    let maxLongitude = coordinates[0][0];
    let minLatitude = coordinates[0][1];
    let maxLatitude = coordinates[0][1];

    coordinates.forEach(([longitude, latitude]) => {
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
    });

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
        80,
        1000
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedCoordinates]);

  /*
   * ------------------------------------------------------------
   * ORIGIN / DESTINATION
   * ------------------------------------------------------------
   */

  const initialPoint =
    selectedCoordinates[0] || {
      latitude: 28.6139,
      longitude: 77.209,
    };

  const destinationPoint =
    selectedCoordinates[
      selectedCoordinates.length - 1
    ] || initialPoint;

  /*
   * ------------------------------------------------------------
   * ROUTE GEOJSON
   * ------------------------------------------------------------
   */

  const routeFeatures = useMemo(() => {
    return routeData.map((route) => ({
      type: "Feature",
      id: route.id,
      properties: {
        routeId: route.id,
        color: route.color,
        width: route.width,
      },
      geometry: {
        type: "LineString",
        coordinates: route.lineCoordinates,
      },
    }));
  }, [routeData]);

  const routeGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection",
      features: routeFeatures,
    }),
    [routeFeatures]
  );

  /*
   * ------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------
   */

  return (
    <View style={styles.container}>
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
            initialPoint.longitude,
            initialPoint.latitude,
          ]}
        />

        {/*
         * ------------------------------------------------------
         * USER LOCATION
         * ------------------------------------------------------
         */}

        <UserLocation
          visible={true}
          animated={true}
          androidRenderMode="normal"
          showsUserHeadingIndicator={true}
        />

        {/*
         * ------------------------------------------------------
         * ROUTES
         * ------------------------------------------------------
         */}

        {routeFeatures.length > 0 && (
          <ShapeSource
            id="airroute-routes"
            shape={routeGeoJSON}
          >
            <LineLayer
              id="airroute-route-lines"
              style={{
                lineColor: [
                  "get",
                  "color",
                ],

                lineWidth: [
                  "get",
                  "width",
                ],

                lineCap: "round",
                lineJoin: "round",

                lineOpacity: 0.95,
              }}
            />
          </ShapeSource>
        )}

        {/*
         * ------------------------------------------------------
         * ORIGIN
         * ------------------------------------------------------
         */}

        <PointAnnotation
          id="airroute-origin"
          coordinate={[
            initialPoint.longitude,
            initialPoint.latitude,
          ]}
        />

        {/*
         * ------------------------------------------------------
         * DESTINATION
         * ------------------------------------------------------
         */}

        <PointAnnotation
          id="airroute-destination"
          coordinate={[
            destinationPoint.longitude,
            destinationPoint.latitude,
          ]}
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  map: {
    flex: 1,
  },
});