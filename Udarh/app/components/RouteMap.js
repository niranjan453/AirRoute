import React, { useEffect, useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { decodePolyline } from "../utils/polyline";

const ROUTE_COLORS = {
  Low: "#1e8e3e",
  Moderate: "#f9ab00",
  High: "#d93025",
};

export default function RouteMap({
  routes = [],
  selectedRouteId,
}) {
  const mapRef = useRef(null);

  const selectedRoute =
    routes.find((r) => r.id === selectedRouteId) ||
    routes[0] ||
    null;

  const polylines = useMemo(() => {
    return routes.map((route) => {
      const coordinates = decodePolyline(route.polyline);

      console.log("========== ROUTE MAP ==========");
      console.log("Route:", route.id);
      console.log("Decoded Points:", coordinates.length);

      if (coordinates.length) {
        console.log("Start:", coordinates[0]);
        console.log("End:", coordinates[coordinates.length - 1]);
      }

      console.log("===============================");

      return {
        id: route.id,
        coordinates,
        color:
          route.id === selectedRouteId
            ? ROUTE_COLORS[route.exposureBand] || "#1A73E8"
            : "#BDBDBD",
        width: route.id === selectedRouteId ? 6 : 4,
      };
    });
  }, [routes, selectedRouteId]);

  const selectedCoordinates = useMemo(() => {
    if (!selectedRoute) return [];
    return decodePolyline(selectedRoute.polyline);
  }, [selectedRoute]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!selectedCoordinates.length) return;

    setTimeout(() => {
      mapRef.current.fitToCoordinates(selectedCoordinates, {
        edgePadding: {
          top: 80,
          right: 60,
          bottom: 80,
          left: 60,
        },
        animated: true,
      });
    }, 600);
  }, [selectedCoordinates]);

  const initialPoint =
    selectedCoordinates[0] || {
      latitude: 28.6139,
      longitude: 77.2090,
    };

  const destinationPoint =
    selectedCoordinates[selectedCoordinates.length - 1] ||
    initialPoint;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: initialPoint.latitude,
          longitude: initialPoint.longitude,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
        showsUserLocation
        showsMyLocationButton
      >
        {polylines.map((route) => (
          <Polyline
            key={route.id}
            coordinates={route.coordinates}
            strokeColor={route.color}
            strokeWidth={route.width}
            lineCap="round"
            lineJoin="round"
          />
        ))}

        <Marker
          coordinate={initialPoint}
          title="Origin"
          pinColor="green"
        />

        <Marker
          coordinate={destinationPoint}
          title="Destination"
          pinColor="red"
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