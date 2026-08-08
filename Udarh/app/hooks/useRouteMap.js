import { useMemo, useState } from "react";
import { decodePolyline } from "../utils/polyline";

const ROUTE_COLORS = {
  Low: "#1e8e3e",
  Moderate: "#f9ab00",
  High: "#d93025",
};

export default function useRouteMap(routes = []) {
  const [selectedRouteId, setSelectedRouteId] = useState(
    routes.length ? routes[0].id : null
  );

  const selectedRoute = useMemo(() => {
    return (
      routes.find((route) => route.id === selectedRouteId) ||
      routes[0] ||
      null
    );
  }, [routes, selectedRouteId]);

  const routePolylines = useMemo(() => {
    return routes.map((route) => ({
      id: route.id,
      coordinates: decodePolyline(route.polyline),
      color:
        route.id === selectedRouteId
          ? ROUTE_COLORS[route.exposureBand] || "#1A73E8"
          : "#BDBDBD",
      width: route.id === selectedRouteId ? 6 : 4,
      isRecommended: route.isRecommended,
    }));
  }, [routes, selectedRouteId]);

  const initialCoords = useMemo(() => {
    if (routePolylines.length && routePolylines[0].coordinates.length) {
      return routePolylines[0].coordinates[0];
    }

    return {
      latitude: 28.6139,
      longitude: 77.209,
    };
  }, [routePolylines]);

  const destinationCoords = useMemo(() => {
    if (!selectedRoute) return initialCoords;

    const coords = decodePolyline(selectedRoute.polyline);

    if (!coords.length) return initialCoords;

    return coords[coords.length - 1];
  }, [selectedRoute, initialCoords]);

  return {
    selectedRoute,
    selectedRouteId,
    setSelectedRouteId,
    routePolylines,
    initialCoords,
    destinationCoords,
  };
}