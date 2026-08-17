// components/RouteList.js

import React from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";

import RouteCard from "./RouteCard";

// ============================================================
// COMPONENT
// ============================================================

export default function RouteList({
  routes = [],
  selectedRoute,
  onSelectRoute,
  onViewDetails,
  onOpenAdvisory,
}) {
  // ==========================================================
  // RECOMMENDED ROUTE
  // ==========================================================

  const recommendedRoute =
    routes.find(
      (route) =>
        route?.recommended ===
        true
    );

  // ==========================================================
  // ROUTE ID HELPER
  // ==========================================================

  const getRouteId = (route) => {
    return (
      route?.routeId ||
      route?.id ||
      null
    );
  };

  // ==========================================================
  // SELECTED ROUTE ID
  // ==========================================================

  const selectedRouteId =
    getRouteId(
      selectedRoute
    );

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <View
      style={
        styles.container
      }
    >
      {/* ====================================================
          HEADER
          ==================================================== */}

      <View
        style={
          styles.header
        }
      >
        <View
          style={
            styles.headerContent
          }
        >
          <Text
            style={
              styles.title
            }
          >
            Available Routes
          </Text>

          <Text
            style={
              styles.count
            }
          >
            {routes.length} route
            {routes.length !== 1
              ? "s"
              : ""}{" "}
            found
          </Text>
        </View>

        {recommendedRoute && (
          <View
            style={
              styles.recommendedBadge
            }
          >
            <Text
              style={
                styles.recommendedText
              }
            >
              ★ Best Route
            </Text>
          </View>
        )}
      </View>

      {/* ====================================================
          ROUTE LIST
          ==================================================== */}

      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
        showsVerticalScrollIndicator={
          false
        }
      >
        {routes.map(
          (
            route,
            index
          ) => {
            const routeId =
              getRouteId(
                route
              );

            const isSelected =
              selectedRouteId ===
              routeId;

            return (
              <RouteCard
                key={
                  routeId ||
                  `route-${index}`
                }
                route={route}
                isSelected={
                  isSelected
                }
                onPress={() => {
                  if (
                    routeId &&
                    typeof onSelectRoute ===
                      "function"
                  ) {
                    onSelectRoute(
                      routeId
                    );
                  }
                }}
                showRank
                rankOverride={
                  route?.rank ||
                  index + 1
                }
              />
            );
          }
        )}

        {/* ==================================================
            SELECTED ROUTE SUMMARY
            ================================================== */}

        {selectedRoute && (
          <View
            style={
              styles.selectedSummary
            }
          >
            <View
              style={
                styles.selectedIndicator
              }
            />

            <View
              style={
                styles.selectedSummaryContent
              }
            >
              <Text
                style={
                  styles.selectedSummaryTitle
                }
              >
                Selected Route
              </Text>

              <Text
                style={
                  styles.selectedSummaryText
                }
              >
                Route{" "}
                {selectedRoute?.rank ||
                  "—"}{" "}
                is currently shown
                prominently on the
                map.
              </Text>
            </View>
          </View>
        )}

        {/* ==================================================
            VIEW DETAILS
            ================================================== */}

        <TouchableOpacity
          style={[
            styles.detailsButton,
            !selectedRoute &&
              styles.disabledButton,
          ]}
          onPress={
            onViewDetails
          }
          disabled={
            !selectedRoute
          }
          activeOpacity={0.8}
        >
          <Text
            style={
              styles.detailsText
            }
          >
            View Selected Route →
          </Text>
        </TouchableOpacity>

        {/* ==================================================
            HEALTH ADVISORY
            ================================================== */}

        <TouchableOpacity
          style={[
            styles.advisoryButton,
            !selectedRoute &&
              styles.disabledAdvisoryButton,
          ]}
          onPress={
            onOpenAdvisory
          }
          disabled={
            !selectedRoute
          }
          activeOpacity={0.8}
        >
          <Text
            style={
              styles.advisoryText
            }
          >
            🌿 View Health Advisory
          </Text>
        </TouchableOpacity>

        {/* ==================================================
            BOTTOM SPACING
            ================================================== */}

        <View
          style={{
            height: 30,
          }}
        />
      </ScrollView>
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

      backgroundColor:
        "#ffffff",

      borderTopLeftRadius:
        20,

      borderTopRightRadius:
        20,

      marginTop: -15,

      paddingHorizontal: 16,

      paddingTop: 15,
    },

    // ========================================================
    // HEADER
    // ========================================================

    header: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",

      marginBottom: 12,
    },

    headerContent: {
      flex: 1,
    },

    title: {
      fontSize: 17,

      fontWeight:
        "700",

      color:
        "#202124",
    },

    count: {
      fontSize: 13,

      fontWeight:
        "500",

      color:
        "#666666",

      marginTop: 2,
    },

    // ========================================================
    // RECOMMENDED BADGE
    // ========================================================

    recommendedBadge: {
      backgroundColor:
        "#E8F5E9",

      paddingHorizontal:
        12,

      paddingVertical:
        7,

      borderRadius:
        20,

      marginLeft: 10,
    },

    recommendedText: {
      color:
        "#176B2C",

      fontWeight:
        "700",

      fontSize: 12,
    },

    // ========================================================
    // SCROLL
    // ========================================================

    scrollContent: {
      paddingBottom: 20,
    },

    // ========================================================
    // SELECTED ROUTE SUMMARY
    // ========================================================

    selectedSummary: {
      flexDirection:
        "row",

      alignItems:
        "center",

      backgroundColor:
        "#F0F7FF",

      borderWidth: 1,

      borderColor:
        "#C9DFF7",

      borderRadius: 12,

      paddingHorizontal:
        12,

      paddingVertical:
        10,

      marginTop: 4,

      marginBottom: 4,
    },

    selectedIndicator: {
      width: 8,

      height: 8,

      borderRadius: 4,

      backgroundColor:
        "#1769AA",

      marginRight: 9,
    },

    selectedSummaryContent: {
      flex: 1,
    },

    selectedSummaryTitle: {
      fontSize: 12,

      fontWeight:
        "800",

      color:
        "#1769AA",
    },

    selectedSummaryText: {
      marginTop: 2,

      fontSize: 11,

      lineHeight: 15,

      color:
        "#5F6368",
    },

    // ========================================================
    // DETAILS BUTTON
    // ========================================================

    detailsButton: {
      backgroundColor:
        "#1A73E8",

      paddingVertical:
        15,

      borderRadius:
        10,

      alignItems:
        "center",

      marginTop: 10,
    },

    detailsText: {
      color:
        "#FFFFFF",

      fontWeight:
        "700",

      fontSize: 15,
    },

    // ========================================================
    // ADVISORY BUTTON
    // ========================================================

    advisoryButton: {
      backgroundColor:
        "#E6F4EA",

      borderWidth: 1,

      borderColor:
        "#B7DFC0",

      paddingVertical:
        13,

      borderRadius:
        10,

      alignItems:
        "center",

      marginTop: 9,
    },

    advisoryText: {
      color:
        "#176B2C",

      fontWeight:
        "700",

      fontSize: 14,
    },

    // ========================================================
    // DISABLED
    // ========================================================

    disabledButton: {
      opacity: 0.45,
    },

    disabledAdvisoryButton: {
      opacity: 0.45,
    },
  });