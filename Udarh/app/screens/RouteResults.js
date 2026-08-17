// screens/RouteResults.js

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from "react-native";

import RouteMap from "../components/RouteMap";
import RouteLegend from "../components/RouteLegend";
import RouteList from "../components/RouteList";
import AdvisoryModal from "../components/AdvisoryModal";

import useRouteMap from "../hooks/useRouteMap";

export default function RouteResults({
  route,
  navigation,
}) {
  // ============================================================
  // RESPONSE DATA
  // ============================================================

  const routeResponse =
    route?.params?.routeResponse;

  const routes = Array.isArray(
    routeResponse?.routes
  )
    ? routeResponse.routes
    : [];

  // ============================================================
  // ADVISORY STATE
  // ============================================================

  const [
    advisoryVisible,
    setAdvisoryVisible,
  ] = useState(false);

  // ============================================================
  // ROUTE MAP STATE
  // ============================================================

  const {
    selectedRoute,
    selectedRouteId,
    setSelectedRouteId,
  } = useRouteMap(routes);

  // ============================================================
  // RECOMMENDED ROUTE
  // ============================================================

  const recommendedRoute =
    useMemo(
      () =>
        routes.find(
          (item) =>
            item?.recommended === true
        ) || null,
      [routes]
    );

  // ============================================================
  // SCREEN TITLE
  // ============================================================

  useEffect(() => {
    if (!routeResponse) {
      return;
    }

    navigation.setOptions({
      title: `${routes.length} Route${
        routes.length === 1
          ? ""
          : "s"
      }`,
    });
  }, [
    navigation,
    routeResponse,
    routes.length,
  ]);

  // ============================================================
  // VIEW DETAILS
  // ============================================================

  const handleViewDetails =
    () => {
      if (!selectedRoute) {
        return;
      }

      navigation.navigate(
        "RouteDetail",
        {
          route:
            selectedRoute,

          allRoutes:
            routes,

          routeResponse:
            routeResponse,
        }
      );
    };

  // ============================================================
  // BACK TO SEARCH
  // ============================================================

  const handleBackToSearch =
    () => {
      navigation.popToTop();
    };

  // ============================================================
  // EMPTY STATE
  // ============================================================

  if (!routes.length) {
    return (
      <SafeAreaView
        style={
          styles.emptyContainer
        }
      >
        <Text
          style={
            styles.emptyTitle
          }
        >
          No routes available
        </Text>

        <Text
          style={
            styles.emptyText
          }
        >
          We could not find a
          usable route for this
          request.
        </Text>

        <TouchableOpacity
          style={
            styles.backButton
          }
          onPress={
            handleBackToSearch
          }
        >
          <Text
            style={
              styles.backButtonText
            }
          >
            Try Again
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ============================================================
  // MAIN SCREEN
  // ============================================================

  return (
    <SafeAreaView
      style={styles.container}
    >
      {/* ======================================================
          MAP
          ====================================================== */}

      <View
        style={
          styles.mapContainer
        }
      >
        <RouteMap
          routes={routes}
          selectedRouteId={
            selectedRouteId
          }
          origin={
            routeResponse?.origin
          }
          destination={
            routeResponse?.destination
          }
        />

        <RouteLegend />

        {/* ==================================================
            RECOMMENDED ROUTE OVERLAY
            ================================================== */}

        {recommendedRoute && (
          <View
            style={
              styles.recommendedOverlay
            }
          >
            <View
              style={
                styles.recommendedDot
              }
            />

            <View
              style={
                styles.recommendedContent
              }
            >
              <Text
                style={
                  styles.recommendedOverlayText
                }
              >
                Recommended route
              </Text>

              <Text
                style={
                  styles.recommendedOverlaySubtext
                }
              >
                Lowest estimated
                exposure within
                the acceptable
                detour
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ======================================================
          ROUTE LIST
          ====================================================== */}

      <RouteList
        routes={routes}
        selectedRoute={
          selectedRoute
        }
        onSelectRoute={
          setSelectedRouteId
        }
        onViewDetails={
          handleViewDetails
        }
        onOpenAdvisory={() =>
          setAdvisoryVisible(
            true
          )
        }
      />

      {/* ======================================================
          HEALTH ADVISORY MODAL
          ====================================================== */}

      <AdvisoryModal
        visible={
          advisoryVisible
        }
        onClose={() =>
          setAdvisoryVisible(
            false
          )
        }
        route={
          selectedRoute
        }
        overallAdvisory={
          routeResponse?.advisory
        }
      />
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        "#ffffff",
    },

    mapContainer: {
      height: "45%",
      position: "relative",
    },

    recommendedOverlay: {
      position: "absolute",

      left: 12,
      right: 12,
      bottom: 12,

      flexDirection:
        "row",

      alignItems:
        "center",

      backgroundColor:
        "rgba(255,255,255,0.96)",

      paddingHorizontal:
        13,

      paddingVertical:
        10,

      borderRadius: 13,

      elevation: 5,

      shadowColor:
        "#000",

      shadowOpacity:
        0.14,

      shadowRadius:
        6,

      shadowOffset: {
        width: 0,
        height: 2,
      },
    },

    recommendedDot: {
      width: 12,
      height: 12,

      borderRadius: 6,

      backgroundColor:
        "#34a853",

      marginRight: 9,
    },

    recommendedContent: {
      flex: 1,
    },

    recommendedOverlayText: {
      color: "#176b2c",

      fontSize: 13,

      fontWeight:
        "800",
    },

    recommendedOverlaySubtext: {
      marginTop: 2,

      color: "#5f6368",

      fontSize: 10,

      lineHeight: 14,
    },

    emptyContainer: {
      flex: 1,

      backgroundColor:
        "#ffffff",

      alignItems:
        "center",

      justifyContent:
        "center",

      padding: 24,
    },

    emptyTitle: {
      fontSize: 20,

      fontWeight:
        "700",

      color:
        "#202124",

      textAlign:
        "center",
    },

    emptyText: {
      marginTop: 8,

      textAlign:
        "center",

      color:
        "#5f6368",

      fontSize: 14,

      lineHeight: 21,
    },

    backButton: {
      marginTop: 20,

      backgroundColor:
        "#1A73E8",

      paddingHorizontal:
        24,

      paddingVertical:
        12,

      borderRadius: 10,
    },

    backButtonText: {
      color:
        "#ffffff",

      fontWeight:
        "700",

      fontSize: 14,
    },
  });