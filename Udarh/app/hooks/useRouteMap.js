// hooks/useRouteMap.js

import {
  useEffect,
  useMemo,
  useState,
} from "react";

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

// ============================================================
// HOOK
// ============================================================

export default function useRouteMap(
  routes = []
) {
  // ==========================================================
  // RECOMMENDED ROUTE
  // ==========================================================

  const recommendedRoute =
    useMemo(() => {
      return (
        routes.find(
          (route) =>
            route?.recommended ===
            true
        ) ||
        routes[0] ||
        null
      );
    }, [routes]);

  // ==========================================================
  // ROUTE SIGNATURE
  // ==========================================================
  //
  // This helps identify when a completely new
  // route response has arrived.
  //
  // Important for repeated searches:
  //
  // Search 1:
  // Delhi → Jaipur
  //
  // Search 2:
  // Delhi → Agra
  //
  // Search 3:
  // Jaipur → Delhi
  //
  // The selected route should be recalculated
  // from the NEW response instead of retaining
  // stale route selection.
  //
  // ==========================================================

  const routeSignature =
    useMemo(() => {
      return routes
        .map((route) =>
          getRouteId(route)
        )
        .filter(Boolean)
        .join("|");
    }, [routes]);

  // ==========================================================
  // SELECTED ROUTE ID
  // ==========================================================

  const [
    selectedRouteId,
    setSelectedRouteId,
  ] = useState(
    getRouteId(
      recommendedRoute
    )
  );

  // ==========================================================
  // RESET SELECTION WHEN NEW SEARCH RESULTS ARRIVE
  // ==========================================================

  useEffect(() => {
    setSelectedRouteId(
      getRouteId(
        recommendedRoute
      )
    );
  }, [
    routeSignature,
  ]);

  // ==========================================================
  // SAFETY CHECK
  // ==========================================================
  //
  // If the currently selected route no longer exists,
  // automatically fall back to the recommended route.
  //
  // ==========================================================

  useEffect(() => {
    const selectedStillExists =
      routes.some(
        (route) =>
          getRouteId(route) ===
          selectedRouteId
      );

    if (
      !selectedStillExists
    ) {
      setSelectedRouteId(
        getRouteId(
          recommendedRoute
        )
      );
    }
  }, [
    routes,
    selectedRouteId,
    recommendedRoute,
  ]);

  // ==========================================================
  // SELECTED ROUTE OBJECT
  // ==========================================================

  const selectedRoute =
    useMemo(() => {
      return (
        routes.find(
          (route) =>
            getRouteId(route) ===
            selectedRouteId
        ) ||
        recommendedRoute ||
        null
      );
    }, [
      routes,
      selectedRouteId,
      recommendedRoute,
    ]);

  // ==========================================================
  // ROUTE POLYLINE DATA
  // ==========================================================
  //
  // The map uses this information to determine:
  //
  // Selected:
  //   strongest foreground
  //
  // Recommended:
  //   light green
  //
  // Other:
  //   subdued background
  //
  // ==========================================================

  const routePolylines =
    useMemo(() => {
      return routes.map(
        (route) => {
          const routeId =
            getRouteId(route);

          const isSelected =
            routeId ===
            selectedRouteId;

          const isRecommended =
            route?.recommended ===
            true;

          return {
            id: routeId,

            coordinates:
              route?.geometry
                ?.coordinates ||
              [],

            color:
              isSelected
                ? "#1769aa"
                : isRecommended
                ? "#34a853"
                : "#aeb4ba",

            width:
              isSelected
                ? 8
                : isRecommended
                ? 6
                : 3,

            opacity:
              isSelected
                ? 1
                : isRecommended
                ? 0.9
                : 0.4,

            isSelected,

            isRecommended,
          };
        }
      );
    }, [
      routes,
      selectedRouteId,
    ]);

  // ==========================================================
  // INITIAL COORDINATE
  // ==========================================================

  const initialCoords =
    useMemo(() => {
      const coordinates =
        selectedRoute
          ?.geometry
          ?.coordinates;

      if (
        Array.isArray(
          coordinates
        ) &&
        coordinates.length >
          0
      ) {
        return coordinates[0];
      }

      // Delhi fallback.
      return [
        77.209,
        28.6139,
      ];
    }, [
      selectedRoute,
    ]);

  // ==========================================================
  // DESTINATION COORDINATE
  // ==========================================================

  const destinationCoords =
    useMemo(() => {
      const coordinates =
        selectedRoute
          ?.geometry
          ?.coordinates;

      if (
        Array.isArray(
          coordinates
        ) &&
        coordinates.length >
          0
      ) {
        return coordinates[
          coordinates.length - 1
        ];
      }

      return initialCoords;
    }, [
      selectedRoute,
      initialCoords,
    ]);

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    selectedRoute,

    selectedRouteId,

    setSelectedRouteId,

    routePolylines,

    initialCoords,

    destinationCoords,
  };
}