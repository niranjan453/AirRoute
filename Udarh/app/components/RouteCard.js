// components/RouteCard.js

import React from "react";

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";

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
// AQI VALUE
// ============================================================
//
// Backend may provide:
//
// route.aqiSummary.averageAqi
// route.airQuality.averageAqi
// route.avgAqi
//
// We support all of them so frontend doesn't break if the
// backend response wrapper changes.
// ============================================================

function getAqi(route) {
  const value =
    route?.aqiSummary
      ?.averageAqi ??
    route?.airQuality
      ?.averageAqi ??
    route?.averageAqi ??
    route?.avgAqi ??
    route?.aqi;

  return Number.isFinite(
    Number(value)
  )
    ? Number(value)
    : null;
}

// ============================================================
// PEAK AQI
// ============================================================

function getPeakAqi(route) {
  const value =
    route?.aqiSummary
      ?.peakAqi ??
    route?.airQuality
      ?.peakAqi ??
    route?.peakAqi;

  return Number.isFinite(
    Number(value)
  )
    ? Number(value)
    : null;
}

// ============================================================
// AQI CATEGORY
// ============================================================
//
// Backend category can be:
//
// "Unhealthy"
//
// OR:
//
// {
//   min: 151,
//   max: 200,
//   label: "Unhealthy",
//   color: "red"
// }
//
// Never return the object directly to <Text>.
// ============================================================

function getAqiCategory(
  route
) {
  const category =
    route?.aqiSummary
      ?.category ??
    route?.airQuality
      ?.category ??
    route?.category;

  // Backend category object
  if (
    category &&
    typeof category ===
      "object"
  ) {
    if (
      typeof category.label ===
      "string" &&
      category.label.trim()
    ) {
      return category.label;
    }
  }

  // Backend category string
  if (
    typeof category ===
      "string" &&
    category.trim()
  ) {
    return category;
  }

  // Fallback based on AQI
  const aqi =
    getAqi(route);

  if (aqi === null) {
    return "Unknown";
  }

  if (aqi <= 50) {
    return "Good";
  }

  if (aqi <= 100) {
    return "Moderate";
  }

  if (aqi <= 150) {
    return "Unhealthy for sensitive groups";
  }

  if (aqi <= 200) {
    return "Unhealthy";
  }

  if (aqi <= 300) {
    return "Very unhealthy";
  }

  return "Hazardous";
}

// ============================================================
// AQI COLOR
// ============================================================

function getAqiColor(
  route
) {
  const aqi =
    getAqi(route);

  if (aqi === null) {
    return "#9AA0A6";
  }

  if (aqi <= 50) {
    return "#1E8E3E";
  }

  if (aqi <= 100) {
    return "#F9AB00";
  }

  if (aqi <= 150) {
    return "#E37400";
  }

  if (aqi <= 200) {
    return "#D93025";
  }

  if (aqi <= 300) {
    return "#8F3F97";
  }

  return "#7E0023";
}

// ============================================================
// DISTANCE
// ============================================================

function formatDistance(
  route
) {
  const meters =
    Number(
      route?.distance
        ?.meters
    );

  if (
    !Number.isFinite(
      meters
    )
  ) {
    return "—";
  }

  if (meters >= 1000) {
    return `${(
      meters / 1000
    ).toFixed(1)} km`;
  }

  return `${Math.round(
    meters
  )} m`;
}

// ============================================================
// DURATION
// ============================================================

function formatDuration(
  route
) {
  const seconds =
    Number(
      route?.duration
        ?.seconds
    );

  if (
    !Number.isFinite(
      seconds
    )
  ) {
    return "—";
  }

  const minutes =
    Math.round(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  const remaining =
    minutes % 60;

  if (
    remaining === 0
  ) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remaining} min`;
}

// ============================================================
// DETOUR
// ============================================================

function formatDetour(
  route
) {
  const percent =
    Number(
      route?.detour
        ?.percent
    );

  if (
    !Number.isFinite(
      percent
    )
  ) {
    return null;
  }

  if (
    Math.abs(percent) <
    0.05
  ) {
    return "No detour";
  }

  return `${percent >= 0 ? "+" : ""}${percent.toFixed(
    1
  )}% detour`;
}

// ============================================================
// EXPOSURE
// ============================================================
//
// Support both old and current backend shapes.
// ============================================================

function formatExposure(
  route
) {
  const value =
    route?.exposure
      ?.index ??
    route?.exposure
      ?.score ??
    route?.exposureScore ??
    route?.exposureIndex;

  if (
    !Number.isFinite(
      Number(value)
    )
  ) {
    return null;
  }

  return Number(
    value
  ).toFixed(1);
}

// ============================================================
// SAMPLE COUNT
// ============================================================

function getSampleCount(
  route
) {
  const value =
    route?.aqiSummary
      ?.sampleCount ??
    route?.airQuality
      ?.sampleCount ??
    route?.aqiSummary
      ?.validSamples ??
    route?.airQuality
      ?.validSamples ??
    route?.sampleCount;

  if (
    !Number.isFinite(
      Number(value)
    )
  ) {
    return null;
  }

  return Number(value);
}

// ============================================================
// COMPONENT
// ============================================================

export default function RouteCard({
  route,
  isSelected = false,
  onPress,
  showRank = true,
  rankOverride,
}) {
  const routeId =
    getRouteId(route);

  const rank =
    route?.rank ??
    rankOverride;

  const recommended =
    route?.recommended ===
    true;

  // ==========================================================
  // AQI
  // ==========================================================

  const aqi =
    getAqi(route);

  const peakAqi =
    getPeakAqi(route);

  const aqiCategory =
    getAqiCategory(
      route
    );

  const aqiColor =
    getAqiColor(
      route
    );

  // ==========================================================
  // OTHER DATA
  // ==========================================================

  const distance =
    formatDistance(
      route
    );

  const duration =
    formatDuration(
      route
    );

  const detour =
    formatDetour(
      route
    );

  const exposure =
    formatExposure(
      route
    );

  const sampleCount =
    getSampleCount(
      route
    );

  // ==========================================================
  // PRESS
  // ==========================================================

  const handlePress =
    () => {
      if (
        typeof onPress ===
        "function"
      ) {
        onPress(
          routeId
        );
      }
    };

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={
        handlePress
      }
      style={[
        styles.card,

        isSelected &&
          styles.selectedCard,

        recommended &&
          !isSelected &&
          styles.recommendedCard,
      ]}
    >
      {/* ====================================================
          TOP ROW
          ==================================================== */}

      <View
        style={
          styles.topRow
        }
      >
        <View
          style={
            styles.routeIdentity
          }
        >
          {showRank && (
            <View
              style={[
                styles.rankCircle,

                isSelected &&
                  styles.selectedRankCircle,

                recommended &&
                  !isSelected &&
                  styles.recommendedRankCircle,
              ]}
            >
              <Text
                style={[
                  styles.rankText,

                  isSelected &&
                    styles.selectedRankText,

                  recommended &&
                    !isSelected &&
                    styles.recommendedRankText,
                ]}
              >
                {rank ??
                  "—"}
              </Text>
            </View>
          )}

          <View
            style={
              styles.routeTitleContainer
            }
          >
            <Text
              style={
                styles.routeTitle
              }
            >
              Route{" "}
              {rank ??
                ""}
            </Text>

            <Text
              style={
                styles.routeSubtitle
              }
              numberOfLines={
                1
              }
            >
              {routeId
                ? `Route ID: ${routeId}`
                : "Alternative route"}
            </Text>
          </View>
        </View>

        {/* ==================================================
            BADGES
            ================================================== */}

        <View
          style={
            styles.badges
          }
        >
          {recommended && (
            <View
              style={
                styles.recommendedBadge
              }
            >
              <Text
                style={
                  styles.recommendedBadgeText
                }
              >
                ★ Recommended
              </Text>
            </View>
          )}

          {isSelected && (
            <View
              style={
                styles.selectedBadge
              }
            >
              <Text
                style={
                  styles.selectedBadgeText
                }
              >
                Selected
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ====================================================
          PRIMARY METRICS
          ==================================================== */}

      <View
        style={
          styles.primaryMetrics
        }
      >
        <Metric
          label="Time"
          value={
            duration
          }
          icon="⏱"
        />

        <Metric
          label="Distance"
          value={
            distance
          }
          icon="📍"
        />

        <Metric
          label="AQI"
          value={
            aqi !== null
              ? String(
                  Math.round(
                    aqi
                  )
                )
              : "—"
          }
          icon="🌿"
          valueColor={
            aqiColor
          }
        />
      </View>

      {/* ====================================================
          AQI INFORMATION
          ==================================================== */}

      <View
        style={
          styles.aqiSection
        }
      >
        <View
          style={
            styles.aqiHeader
          }
        >
          <View
            style={
              styles.aqiTitleRow
            }
          >
            <View
              style={[
                styles.aqiDot,
                {
                  backgroundColor:
                    aqiColor,
                },
              ]}
            />

            <Text
              style={
                styles.aqiCategory
              }
            >
              {aqiCategory}
            </Text>
          </View>

          {peakAqi !==
            null && (
            <Text
              style={
                styles.peakAqi
              }
            >
              Peak{" "}
              {Math.round(
                peakAqi
              )}
            </Text>
          )}
        </View>

        {/* ==================================================
            AQI BAR
            ================================================== */}

        <View
          style={
            styles.aqiBarBackground
          }
        >
          <View
            style={[
              styles.aqiBarFill,
              {
                backgroundColor:
                  aqiColor,

                width: `${
                  Math.min(
                    Math.max(
                      ((aqi ??
                        0) /
                        300) *
                        100,
                      aqi !==
                        null
                        ? 4
                        : 0
                    ),
                    100
                  )
                }%`,
              },
            ]}
          />
        </View>
      </View>

      {/* ====================================================
          SECONDARY METRICS
          ==================================================== */}

      <View
        style={
          styles.secondaryRow
        }
      >
        {detour && (
          <View
            style={
              styles.secondaryItem
            }
          >
            <Text
              style={
                styles.secondaryLabel
              }
            >
              Detour
            </Text>

            <Text
              style={[
                styles.secondaryValue,

                route?.detour
                  ?.withinLimit &&
                  styles.goodValue,
              ]}
            >
              {detour}
            </Text>
          </View>
        )}

        {exposure !==
          null && (
          <View
            style={
              styles.secondaryItem
            }
          >
            <Text
              style={
                styles.secondaryLabel
              }
            >
              Exposure
            </Text>

            <Text
              style={
                styles.secondaryValue
              }
            >
              {exposure}
            </Text>
          </View>
        )}

        {sampleCount !==
          null && (
          <View
            style={
              styles.secondaryItem
            }
          >
            <Text
              style={
                styles.secondaryLabel
              }
            >
              AQI points
            </Text>

            <Text
              style={
                styles.secondaryValue
              }
            >
              {sampleCount}
            </Text>
          </View>
        )}
      </View>

      {/* ====================================================
          SELECTION FOOTER
          ==================================================== */}

      {isSelected && (
        <View
          style={
            styles.selectedFooter
          }
        >
          <View
            style={
              styles.selectedFooterDot
            }
          />

          <Text
            style={
              styles.selectedFooterText
            }
          >
            Showing this route
            prominently on the map
          </Text>

          <Text
            style={
              styles.arrow
            }
          >
            ✓
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ============================================================
// METRIC COMPONENT
// ============================================================

function Metric({
  label,
  value,
  icon,
  valueColor,
}) {
  return (
    <View
      style={
        styles.metric
      }
    >
      <Text
        style={
          styles.metricIcon
        }
      >
        {icon}
      </Text>

      <Text
        style={
          styles.metricLabel
        }
      >
        {label}
      </Text>

      <Text
        style={[
          styles.metricValue,

          valueColor && {
            color:
              valueColor,
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles =
  StyleSheet.create({
    // ========================================================
    // CARD
    // ========================================================

    card: {
      backgroundColor:
        "#ffffff",

      borderWidth: 1,

      borderColor:
        "#E1E5EA",

      borderRadius: 14,

      padding: 14,

      marginBottom: 11,

      shadowColor:
        "#000",

      shadowOpacity:
        0.04,

      shadowRadius:
        4,

      shadowOffset: {
        width: 0,
        height: 2,
      },

      elevation: 2,
    },

    selectedCard: {
      backgroundColor:
        "#F0F7FF",

      borderWidth: 2,

      borderColor:
        "#1769AA",

      shadowOpacity:
        0.1,

      shadowRadius:
        7,

      elevation: 4,
    },

    recommendedCard: {
      backgroundColor:
        "#F8FFF9",

      borderColor:
        "#8BC995",
    },

    // ========================================================
    // TOP
    // ========================================================

    topRow: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "flex-start",
    },

    routeIdentity: {
      flexDirection:
        "row",

      alignItems:
        "center",

      flex: 1,
    },

    rankCircle: {
      width: 34,

      height: 34,

      borderRadius: 17,

      backgroundColor:
        "#F1F3F4",

      alignItems:
        "center",

      justifyContent:
        "center",

      marginRight: 10,
    },

    selectedRankCircle: {
      backgroundColor:
        "#1769AA",
    },

    recommendedRankCircle: {
      backgroundColor:
        "#E6F4EA",
    },

    rankText: {
      fontSize: 13,

      fontWeight:
        "800",

      color:
        "#5F6368",
    },

    selectedRankText: {
      color:
        "#FFFFFF",
    },

    recommendedRankText: {
      color:
        "#176B2C",
    },

    routeTitleContainer: {
      flex: 1,
    },

    routeTitle: {
      fontSize: 15,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    routeSubtitle: {
      marginTop: 2,

      fontSize: 10,

      color:
        "#7A8087",
    },

    // ========================================================
    // BADGES
    // ========================================================

    badges: {
      alignItems:
        "flex-end",

      marginLeft: 8,

      maxWidth: "48%",
    },

    recommendedBadge: {
      backgroundColor:
        "#E6F4EA",

      paddingHorizontal:
        8,

      paddingVertical:
        5,

      borderRadius:
        12,

      marginBottom: 4,
    },

    recommendedBadgeText: {
      color:
        "#176B2C",

      fontSize: 9,

      fontWeight:
        "800",
    },

    selectedBadge: {
      backgroundColor:
        "#D9ECFF",

      paddingHorizontal:
        8,

      paddingVertical:
        5,

      borderRadius:
        12,
    },

    selectedBadgeText: {
      color:
        "#1769AA",

      fontSize: 9,

      fontWeight:
        "800",
    },

    // ========================================================
    // PRIMARY METRICS
    // ========================================================

    primaryMetrics: {
      flexDirection:
        "row",

      marginTop: 14,

      paddingTop: 12,

      borderTopWidth: 1,

      borderTopColor:
        "#EEF0F2",
    },

    metric: {
      flex: 1,

      alignItems:
        "center",
    },

    metricIcon: {
      fontSize: 14,

      marginBottom: 3,
    },

    metricLabel: {
      fontSize: 9,

      color:
        "#7A8087",

      fontWeight:
        "600",

      textTransform:
        "uppercase",

      letterSpacing:
        0.3,
    },

    metricValue: {
      marginTop: 3,

      fontSize: 13,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    // ========================================================
    // AQI
    // ========================================================

    aqiSection: {
      marginTop: 13,

      backgroundColor:
        "#F8F9FA",

      borderRadius: 10,

      padding: 10,
    },

    aqiHeader: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",
    },

    aqiTitleRow: {
      flexDirection:
        "row",

      alignItems:
        "center",
    },

    aqiDot: {
      width: 8,

      height: 8,

      borderRadius: 4,

      marginRight: 6,
    },

    aqiCategory: {
      fontSize: 11,

      fontWeight:
        "700",

      color:
        "#444",
    },

    peakAqi: {
      fontSize: 10,

      color:
        "#6B7280",

      fontWeight:
        "600",
    },

    aqiBarBackground: {
      height: 5,

      backgroundColor:
        "#E2E5E8",

      borderRadius: 3,

      overflow:
        "hidden",

      marginTop: 8,
    },

    aqiBarFill: {
      height: "100%",

      borderRadius: 3,
    },

    // ========================================================
    // SECONDARY
    // ========================================================

    secondaryRow: {
      flexDirection:
        "row",

      marginTop: 11,

      paddingTop: 10,

      borderTopWidth: 1,

      borderTopColor:
        "#EEF0F2",
    },

    secondaryItem: {
      flex: 1,
    },

    secondaryLabel: {
      fontSize: 9,

      color:
        "#7A8087",

      textTransform:
        "uppercase",

      fontWeight:
        "600",
    },

    secondaryValue: {
      marginTop: 3,

      fontSize: 11,

      fontWeight:
        "700",

      color:
        "#444444",
    },

    goodValue: {
      color:
        "#1E8E3E",
    },

    // ========================================================
    // SELECTED FOOTER
    // ========================================================

    selectedFooter: {
      flexDirection:
        "row",

      alignItems:
        "center",

      marginTop: 12,

      paddingTop: 10,

      borderTopWidth: 1,

      borderTopColor:
        "#C9DFF7",
    },

    selectedFooterDot: {
      width: 7,

      height: 7,

      borderRadius: 4,

      backgroundColor:
        "#1769AA",

      marginRight: 6,
    },

    selectedFooterText: {
      flex: 1,

      fontSize: 10,

      color:
        "#1769AA",

      fontWeight:
        "600",
    },

    arrow: {
      fontSize: 14,

      fontWeight:
        "800",

      color:
        "#1769AA",

      marginLeft: 5,
    },
  });