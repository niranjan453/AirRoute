// components/AdvisoryModal.js

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";

import PropTypes from "prop-types";

import api from "../services/api";

import {
  useUserProfile,
} from "../context/UserProfileContext";

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

function getAdvisoryText(
  advisory
) {
  if (!advisory) {
    return null;
  }

  if (
    typeof advisory ===
    "string"
  ) {
    return advisory;
  }

  return (
    advisory.message ||
    advisory.text ||
    advisory.advisory ||
    advisory.description ||
    null
  );
}

function getAdvisoryTitle(
  advisory
) {
  if (
    !advisory ||
    typeof advisory ===
      "string"
  ) {
    return "Health Advisory";
  }

  return (
    advisory.title ||
    advisory.level ||
    advisory.severity ||
    "Health Advisory"
  );
}

// ============================================================
// COMPONENT
// ============================================================

export default function AdvisoryModal({
  visible,
  onClose,
  route,
  overallAdvisory,
}) {
  const {
    profile,
  } = useUserProfile();

  // ==========================================================
  // STATE
  // ==========================================================

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    advisory,
    setAdvisory,
  ] = useState(null);

  const [
    error,
    setError,
  ] = useState(null);

  // ==========================================================
  // ROUTE ID
  // ==========================================================

  const routeId =
    getRouteId(route);

  // ==========================================================
  // EXISTING ADVISORY
  // ==========================================================
  //
  // The backend route response already contains:
  //
  // route.advisory
  //
  // and the overall response may contain:
  //
  // routeResponse.advisory
  //
  // Prefer existing data so we don't make an
  // unnecessary second request.
  //
  // ==========================================================

  const embeddedAdvisory =
    route?.advisory ||
    overallAdvisory ||
    null;

  const embeddedText =
    useMemo(
      () =>
        getAdvisoryText(
          embeddedAdvisory
        ),
      [embeddedAdvisory]
    );

  // ==========================================================
  // LOAD ADVISORY
  // ==========================================================

  const loadAdvisory =
    async () => {
      if (!routeId) {
        setAdvisory(null);

        setError(
          "Advisory information is unavailable for this route."
        );

        return;
      }

      setLoading(true);
      setError(null);

      try {
        const profileType =
          profile?.type ||
          "normal";

        const response =
          await api.getAdvisory({
            routeId,
            profile:
              profileType,
            route,
          });

        setAdvisory(
          response?.advisory ||
            response
        );
      } catch (err) {
        setError(
          err?.message ||
            "Failed to load advisory."
        );
      } finally {
        setLoading(false);
      }
    };

  // ==========================================================
  // MODAL OPEN / ROUTE CHANGE
  // ==========================================================

  useEffect(() => {
    if (!visible) {
      return;
    }

    setError(null);

    // --------------------------------------------------------
    // Prefer advisory already returned by backend
    // --------------------------------------------------------

    if (embeddedAdvisory) {
      setAdvisory(
        embeddedAdvisory
      );

      setLoading(false);

      return;
    }

    // --------------------------------------------------------
    // Fallback API request
    // --------------------------------------------------------

    setAdvisory(null);

    loadAdvisory();
  }, [
    visible,
    routeId,
    embeddedText,
  ]);

  // ==========================================================
  // FINAL ADVISORY TEXT
  // ==========================================================

  const advisoryText =
    getAdvisoryText(
      advisory
    );

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={
        onClose
      }
    >
      <View
        style={
          styles.overlay
        }
      >
        <View
          style={
            styles.container
          }
        >
          {/* ==================================================
              HEADER
              ================================================== */}

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
                  styles.eyebrow
                }
              >
                AIRROUTE
              </Text>

              <Text
                style={
                  styles.title
                }
              >
                {getAdvisoryTitle(
                  advisory
                )}
              </Text>
            </View>

            <TouchableOpacity
              onPress={
                onClose
              }
              style={
                styles.closeButton
              }
              activeOpacity={0.7}
            >
              <Text
                style={
                  styles.closeText
                }
              >
                ✕
              </Text>
            </TouchableOpacity>
          </View>

          {/* ==================================================
              BODY
              ================================================== */}

          <ScrollView
            style={
              styles.body
            }
            contentContainerStyle={
              styles.bodyContent
            }
            showsVerticalScrollIndicator={
              false
            }
          >
            {/* ================================================
                LOADING
                ================================================ */}

            {loading && (
              <View
                style={
                  styles.center
                }
              >
                <ActivityIndicator
                  size="large"
                  color="#1a73e8"
                />

                <Text
                  style={
                    styles.loadingText
                  }
                >
                  Preparing route
                  advisory...
                </Text>
              </View>
            )}

            {/* ================================================
                ERROR
                ================================================ */}

            {error &&
              !loading && (
                <View
                  style={
                    styles.center
                  }
                >
                  <Text
                    style={
                      styles.errorIcon
                    }
                  >
                    ⚠
                  </Text>

                  <Text
                    style={
                      styles.errorText
                    }
                  >
                    {error}
                  </Text>

                  <TouchableOpacity
                    style={
                      styles.retryButton
                    }
                    onPress={
                      loadAdvisory
                    }
                    activeOpacity={
                      0.8
                    }
                  >
                    <Text
                      style={
                        styles.retryText
                      }
                    >
                      Retry
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

            {/* ================================================
                ADVISORY CONTENT
                ================================================ */}

            {advisoryText &&
              !loading &&
              !error && (
                <View>
                  {/* ==========================================
                      MAIN ADVISORY CARD
                      ========================================== */}

                  <View
                    style={
                      styles.summaryCard
                    }
                  >
                    <View
                      style={
                        styles.summaryHeader
                      }
                    >
                      <View
                        style={
                          styles.healthIcon
                        }
                      >
                        <Text
                          style={
                            styles.healthIconText
                          }
                        >
                          🌿
                        </Text>
                      </View>

                      <View
                        style={
                          styles.summaryHeaderContent
                        }
                      >
                        <Text
                          style={
                            styles.summaryTitle
                          }
                        >
                          Route Health
                          Advisory
                        </Text>

                        <Text
                          style={
                            styles.summarySubtitle
                          }
                        >
                          Based on the
                          selected route's
                          environmental
                          conditions
                        </Text>
                      </View>
                    </View>

                    <View
                      style={
                        styles.divider
                      }
                    />

                    <Text
                      style={
                        styles.summaryText
                      }
                    >
                      {advisoryText}
                    </Text>
                  </View>

                  {/* ==========================================
                      SELECTED ROUTE INFORMATION
                      ========================================== */}

                  {route && (
                    <View
                      style={
                        styles.routeCard
                      }
                    >
                      <Text
                        style={
                          styles.routeCardTitle
                        }
                      >
                        Selected Route
                      </Text>

                      <Text
                        style={
                          styles.routeCardSubtitle
                        }
                      >
                        {route?.recommended
                          ? "★ Recommended route"
                          : "Alternative route"}
                      </Text>

                      {/* ====================================
                          AQI METRICS
                          ==================================== */}

                      {route
                        ?.airQuality
                        ?.averageAqi !=
                        null && (
                        <MetricRow
                          label="Average AQI"
                          value={
                            route
                              .airQuality
                              .averageAqi
                          }
                        />
                      )}

                      {route
                        ?.airQuality
                        ?.peakAqi !=
                        null && (
                        <MetricRow
                          label="Peak AQI"
                          value={
                            route
                              .airQuality
                              .peakAqi
                          }
                        />
                      )}

                      {/* ====================================
                          DETOUR
                          ==================================== */}

                      {route
                        ?.detour
                        ?.percent !=
                        null && (
                        <MetricRow
                          label="Travel-time detour"
                          value={`${Number(
                            route
                              .detour
                              .percent
                          ).toFixed(
                            1
                          )}%`}
                        />
                      )}

                      {/* ====================================
                          EXPOSURE
                          ==================================== */}

                      {route
                        ?.exposure
                        ?.index !=
                        null && (
                        <MetricRow
                          label="Exposure index"
                          value={
                            route
                              .exposure
                              .index
                          }
                        />
                      )}
                    </View>
                  )}

                  {/* ==========================================
                      SAFETY NOTE
                      ========================================== */}

                  <View
                    style={
                      styles.noteCard
                    }
                  >
                    <Text
                      style={
                        styles.noteTitle
                      }
                    >
                      Important
                    </Text>

                    <Text
                      style={
                        styles.noteText
                      }
                    >
                      AirRoute provides
                      route-based
                      environmental
                      guidance. It does
                      not replace medical
                      advice or individual
                      health recommendations.
                    </Text>
                  </View>
                </View>
              )}

            {/* ================================================
                NO DATA
                ================================================ */}

            {!loading &&
              !error &&
              !advisoryText && (
                <View
                  style={
                    styles.center
                  }
                >
                  <Text
                    style={
                      styles.emptyIcon
                    }
                  >
                    🌿
                  </Text>

                  <Text
                    style={
                      styles.emptyTitle
                    }
                  >
                    Advisory unavailable
                  </Text>

                  <Text
                    style={
                      styles.emptyText
                    }
                  >
                    There is no advisory
                    information
                    available for this
                    route.
                  </Text>
                </View>
              )}
          </ScrollView>

          {/* ==================================================
              FOOTER
              ================================================== */}

          <View
            style={
              styles.footer
            }
          >
            <TouchableOpacity
              style={
                styles.confirmButton
              }
              onPress={
                onClose
              }
              activeOpacity={0.8}
            >
              <Text
                style={
                  styles.confirmText
                }
              >
                Got it
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================
// METRIC ROW
// ============================================================

function MetricRow({
  label,
  value,
}) {
  return (
    <View
      style={
        styles.metricRow
      }
    >
      <Text
        style={
          styles.metricLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.metricValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

// ============================================================
// PROP TYPES
// ============================================================

AdvisoryModal.propTypes = {
  visible:
    PropTypes.bool.isRequired,

  onClose:
    PropTypes.func.isRequired,

  route:
    PropTypes.object,

  overallAdvisory:
    PropTypes.any,
};

// ============================================================
// DEFAULT PROPS
// ============================================================

AdvisoryModal.defaultProps = {
  route: null,

  overallAdvisory:
    null,
};

// ============================================================
// STYLES
// ============================================================

const styles =
  StyleSheet.create({
    // ========================================================
    // MODAL
    // ========================================================

    overlay: {
      flex: 1,

      backgroundColor:
        "rgba(0,0,0,0.5)",

      justifyContent:
        "flex-end",
    },

    container: {
      backgroundColor:
        "#ffffff",

      borderTopLeftRadius:
        22,

      borderTopRightRadius:
        22,

      maxHeight: "84%",

      minHeight: 300,
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

      paddingHorizontal:
        18,

      paddingVertical:
        16,

      borderBottomWidth:
        1,

      borderBottomColor:
        "#f0f0f0",
    },

    headerContent: {
      flex: 1,
    },

    eyebrow: {
      fontSize: 9,

      fontWeight:
        "800",

      letterSpacing:
        1.2,

      color:
        "#1e8e3e",
    },

    title: {
      marginTop: 3,

      fontSize: 20,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    closeButton: {
      padding: 6,

      width: 36,

      alignItems:
        "center",

      justifyContent:
        "center",
    },

    closeText: {
      fontSize: 18,

      color:
        "#5f6368",

      fontWeight:
        "600",
    },

    // ========================================================
    // BODY
    // ========================================================

    body: {
      paddingHorizontal:
        18,
    },

    bodyContent: {
      paddingTop: 18,

      paddingBottom: 24,
    },

    // ========================================================
    // SUMMARY
    // ========================================================

    summaryCard: {
      backgroundColor:
        "#E6F4EA",

      borderRadius:
        14,

      padding: 15,

      borderWidth: 1,

      borderColor:
        "#B7DFC0",
    },

    summaryHeader: {
      flexDirection:
        "row",

      alignItems:
        "center",
    },

    healthIcon: {
      width: 40,

      height: 40,

      borderRadius: 20,

      backgroundColor:
        "#ffffff",

      alignItems:
        "center",

      justifyContent:
        "center",

      marginRight: 11,
    },

    healthIconText: {
      fontSize: 20,
    },

    summaryHeaderContent: {
      flex: 1,
    },

    summaryTitle: {
      fontSize: 14,

      fontWeight:
        "800",

      color:
        "#176B2C",
    },

    summarySubtitle: {
      marginTop: 2,

      fontSize: 11,

      lineHeight: 15,

      color:
        "#52745B",
    },

    divider: {
      height: 1,

      backgroundColor:
        "#C7E6CD",

      marginVertical: 12,
    },

    summaryText: {
      fontSize: 14,

      lineHeight: 22,

      color:
        "#274E35",
    },

    // ========================================================
    // ROUTE CARD
    // ========================================================

    routeCard: {
      marginTop: 14,

      backgroundColor:
        "#F8FAFC",

      borderRadius:
        14,

      padding: 15,

      borderWidth: 1,

      borderColor:
        "#E5E7EB",
    },

    routeCardTitle: {
      fontSize: 14,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    routeCardSubtitle: {
      marginTop: 4,

      fontSize: 12,

      color:
        "#5F6368",
    },

    // ========================================================
    // METRICS
    // ========================================================

    metricRow: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",

      paddingTop: 11,

      marginTop: 10,

      borderTopWidth:
        1,

      borderTopColor:
        "#E5E7EB",
    },

    metricLabel: {
      fontSize: 13,

      color:
        "#5F6368",
    },

    metricValue: {
      fontSize: 13,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    // ========================================================
    // NOTE
    // ========================================================

    noteCard: {
      marginTop: 14,

      backgroundColor:
        "#FFF8E1",

      borderRadius:
        12,

      padding: 13,

      borderWidth: 1,

      borderColor:
        "#F4DFA0",
    },

    noteTitle: {
      fontSize: 12,

      fontWeight:
        "800",

      color:
        "#8A6D1D",

      marginBottom: 4,
    },

    noteText: {
      fontSize: 11,

      lineHeight: 17,

      color:
        "#6F5B22",
    },

    // ========================================================
    // LOADING
    // ========================================================

    center: {
      alignItems:
        "center",

      justifyContent:
        "center",

      paddingVertical: 40,

      paddingHorizontal: 20,
    },

    loadingText: {
      marginTop: 12,

      color:
        "#5F6368",

      fontSize: 14,

      textAlign:
        "center",
    },

    // ========================================================
    // ERROR
    // ========================================================

    errorIcon: {
      fontSize: 28,

      marginBottom: 8,
    },

    errorText: {
      color:
        "#D93025",

      fontSize: 14,

      lineHeight: 20,

      textAlign:
        "center",

      marginBottom: 14,
    },

    retryButton: {
      backgroundColor:
        "#1A73E8",

      paddingHorizontal:
        18,

      paddingVertical:
        9,

      borderRadius: 7,
    },

    retryText: {
      color:
        "#FFFFFF",

      fontSize: 14,

      fontWeight:
        "600",
    },

    // ========================================================
    // EMPTY
    // ========================================================

    emptyIcon: {
      fontSize: 34,

      marginBottom: 10,
    },

    emptyTitle: {
      fontSize: 16,

      fontWeight:
        "800",

      color:
        "#202124",

      marginBottom: 6,
    },

    emptyText: {
      fontSize: 13,

      lineHeight: 19,

      color:
        "#5F6368",

      textAlign:
        "center",
    },

    // ========================================================
    // FOOTER
    // ========================================================

    footer: {
      padding: 18,

      borderTopWidth: 1,

      borderTopColor:
        "#f0f0f0",
    },

    confirmButton: {
      backgroundColor:
        "#1A73E8",

      paddingVertical:
        14,

      borderRadius: 9,

      alignItems:
        "center",
    },

    confirmText: {
      color:
        "#FFFFFF",

      fontSize: 16,

      fontWeight:
        "700",
    },
  });