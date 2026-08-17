// screens/RouteDetail.js

import React, {
  useMemo,
} from "react";

import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
} from "react-native";

import RouteMap from "../components/RouteMap";

// ============================================================
// HELPERS
// ============================================================

function isValidNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return false;
  }

  return Number.isFinite(
    Number(value)
  );
}

function formatDistance(meters) {
  if (!isValidNumber(meters)) {
    return "—";
  }

  const value = Number(meters);

  if (value >= 1000) {
    return `${(
      value / 1000
    ).toFixed(2)} km`;
  }

  return `${Math.round(value)} m`;
}

function formatDuration(seconds) {
  if (!isValidNumber(seconds)) {
    return "—";
  }

  const value = Number(seconds);

  const minutes = Math.round(
    value / 60
  );

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(
    minutes / 60
  );

  const remaining =
    minutes % 60;

  if (remaining === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remaining}m`;
}

// ============================================================
// AQI
// ============================================================

function getAqiColor(aqi) {
  if (!isValidNumber(aqi)) {
    return "#9AA0A6";
  }

  const value = Number(aqi);

  if (value >= 300) {
    return "#7E0023";
  }

  if (value >= 200) {
    return "#8F3F97";
  }

  if (value >= 150) {
    return "#D93025";
  }

  if (value >= 100) {
    return "#E37400";
  }

  if (value > 50) {
    return "#F9AB00";
  }

  return "#1E8E3E";
}

function getAqiLabel(aqi) {
  if (!isValidNumber(aqi)) {
    return "Unknown";
  }

  const value = Number(aqi);

  if (value <= 50) {
    return "Good";
  }

  if (value <= 100) {
    return "Moderate";
  }

  if (value <= 150) {
    return "Unhealthy for sensitive groups";
  }

  if (value <= 200) {
    return "Unhealthy";
  }

  if (value <= 300) {
    return "Very unhealthy";
  }

  return "Hazardous";
}

function getAqiCategoryLabel(
  category,
  aqi
) {
  if (
    category &&
    typeof category ===
      "object"
  ) {
    return (
      category.label ||
      getAqiLabel(aqi)
    );
  }

  if (
    typeof category === "string" &&
    category.trim()
  ) {
    return category;
  }

  return getAqiLabel(aqi);
}

// ============================================================
// NUMBER FORMATTERS
// ============================================================

function formatNumber(
  value,
  decimals = 0
) {
  if (!isValidNumber(value)) {
    return "—";
  }

  return Number(value).toFixed(
    decimals
  );
}

function formatPercent(value) {
  if (!isValidNumber(value)) {
    return "—";
  }

  return `${Number(value).toFixed(
    1
  )}%`;
}

// ============================================================
// EXPOSURE
// ============================================================

function getExposureColor(
  band
) {
  const normalized = String(
    band || ""
  ).toLowerCase();

  if (
    normalized.includes(
      "critical"
    )
  ) {
    return "#B31412";
  }

  if (
    normalized.includes("high")
  ) {
    return "#D93025";
  }

  if (
    normalized.includes(
      "moderate"
    )
  ) {
    return "#E37400";
  }

  return "#1E8E3E";
}

function getExposureBackground(
  band
) {
  const normalized = String(
    band || ""
  ).toLowerCase();

  if (
    normalized.includes(
      "critical"
    ) ||
    normalized.includes("high")
  ) {
    return "#FCE8E6";
  }

  if (
    normalized.includes(
      "moderate"
    )
  ) {
    return "#FEF7E0";
  }

  return "#E6F4EA";
}

// ============================================================
// COMPONENT
// ============================================================

export default function RouteDetail({
  route,
}) {
  // ==========================================================
  // NAVIGATION DATA
  // ==========================================================

  const routeData =
    route?.params?.route ||
    route ||
    {};

  const allRoutes =
    Array.isArray(
      route?.params?.allRoutes
    )
      ? route.params.allRoutes
      : [routeData];

  const routeResponse =
    route?.params?.routeResponse ||
    null;

  // ==========================================================
  // SELECTED ROUTE ID
  // ==========================================================

  const selectedRouteId =
    routeData?.routeId ||
    routeData?.id ||
    null;

  // ==========================================================
  // BASIC ROUTE DATA
  // ==========================================================

  const distance =
    routeData?.distance?.meters ??
    routeData?.distanceMeters;

  const duration =
    routeData?.duration?.seconds ??
    routeData?.durationSeconds;

  // ==========================================================
  // AIR QUALITY
  // ==========================================================

  const averageAqi =
    routeData?.airQuality
      ?.averageAqi ??
    routeData?.aqiSummary
      ?.averageAqi ??
    routeData?.avgAqi ??
    routeData?.averageAqi ??
    routeData?.aqi;

  const peakAqi =
    routeData?.airQuality
      ?.peakAqi ??
    routeData?.aqiSummary
      ?.peakAqi ??
    routeData?.peakAqi;

  const coverage =
    routeData?.airQuality
      ?.coverage ??
    routeData?.aqiSummary
      ?.coverage ??
    routeData?.coverage;

  // ==========================================================
  // EXPOSURE
  // ==========================================================

  const exposureScore =
    routeData?.exposure?.score ??
    routeData?.exposureScore ??
    routeData?.exposureIndex;

  const exposurePerHour =
    routeData?.exposure?.perHour ??
    routeData?.exposureScorePerHour;

  const rawExposureBand =
    routeData?.exposure?.band ??
    routeData?.exposureBand ??
    "Unknown";

  const exposureBand =
    typeof rawExposureBand ===
    "object"
      ? rawExposureBand?.label ||
        "Unknown"
      : rawExposureBand;

  // ==========================================================
  // RECOMMENDATION
  // ==========================================================

  const recommended =
    routeData?.recommended === true;

  // ==========================================================
  // DETOUR
  // ==========================================================

  const detourPercent =
    Number(
      routeData?.detour?.percent ??
        routeData?.detourPercent
    );

  const detourAcceptable =
    routeData?.detour
      ?.acceptable !== false;

  // ==========================================================
  // HOTSPOTS
  // ==========================================================

  const hotspots = useMemo(() => {
    if (
      Array.isArray(
        routeData?.hotspots?.items
      )
    ) {
      return routeData.hotspots.items;
    }

    if (
      Array.isArray(
        routeData?.hotspots
      )
    ) {
      return routeData.hotspots;
    }

    return [];
  }, [routeData]);

  const hotspotCount =
    Number(
      routeData?.hotspots?.count ??
        hotspots.length
    ) || 0;

  const hotspotPeak =
    isValidNumber(
      routeData?.hotspots?.peakAqi
    )
      ? Number(
          routeData.hotspots.peakAqi
        )
      : null;

  const hotspotDuration =
    isValidNumber(
      routeData?.hotspots
        ?.durationMinutes
    )
      ? Number(
          routeData.hotspots
            .durationMinutes
        )
      : null;

  const hotspotShare =
    isValidNumber(
      routeData?.hotspots
        ?.exposureSharePercent
    )
      ? Number(
          routeData.hotspots
            .exposureSharePercent
        )
      : null;

  const criticalHotspot =
    routeData?.hotspots
      ?.critical === true ||
    routeData?.detour
      ?.criticalHotspot === true ||
    hotspots.some(
      (item) =>
        item?.critical === true
    );

  // ==========================================================
  // ADVISORY
  // ==========================================================

  const advisory =
    routeData?.advisory ||
    routeResponse?.advisory ||
    null;

  // ==========================================================
  // AQI SEGMENTS
  // ==========================================================

  const aqiSegments =
    useMemo(() => {
      if (
        Array.isArray(
          routeData?.airQuality
            ?.segments
        )
      ) {
        return routeData.airQuality
          .segments;
      }

      if (
        Array.isArray(
          routeData?.aqiSegments
        )
      ) {
        return routeData.aqiSegments;
      }

      return [];
    }, [routeData]);

  // ==========================================================
  // AQI LABELS
  // ==========================================================

  const averageAqiLabel =
    getAqiLabel(averageAqi);

  const peakAqiLabel =
    getAqiLabel(peakAqi);

  // ==========================================================
  // EXPOSURE COLORS
  // ==========================================================

  const exposureColor =
    getExposureColor(
      exposureBand
    );

  const exposureBackground =
    getExposureBackground(
      exposureBand
    );

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <SafeAreaView
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
      >
        {/* ==================================================
            SELECTED ROUTE MAP
            ================================================== */}

        <View
          style={
            styles.mapSection
          }
        >
          <View
            style={
              styles.mapHeader
            }
          >
            <View>
              <Text
                style={
                  styles.mapTitle
                }
              >
                Selected Route
              </Text>

              <Text
                style={
                  styles.mapSubtitle
                }
              >
                Selected route shown
                prominently
              </Text>
            </View>

            {recommended && (
              <View
                style={
                  styles.mapRecommendedBadge
                }
              >
                <Text
                  style={
                    styles.mapRecommendedBadgeText
                  }
                >
                  ★ RECOMMENDED
                </Text>
              </View>
            )}
          </View>

          <View
            style={
              styles.mapContainer
            }
          >
            <RouteMap
              routes={allRoutes}
              selectedRouteId={
                selectedRouteId
              }
              origin={
                routeResponse?.origin
              }
              destination={
                routeResponse?.destination
              }
              focusSelectedRoute={
                true
              }
            />

            <View
              style={
                styles.selectedMapOverlay
              }
            >
              <View
                style={
                  styles.selectedMapDot
                }
              />

              <Text
                style={
                  styles.selectedMapText
                }
              >
                Selected route
              </Text>
            </View>
          </View>
        </View>

        {/* ==================================================
            RECOMMENDED BANNER
            ================================================== */}

        {recommended && (
          <View
            style={styles.bestBanner}
          >
            <View
              style={
                styles.bestBannerIcon
              }
            >
              <Text
                style={
                  styles.bestBannerIconText
                }
              >
                ★
              </Text>
            </View>

            <View
              style={
                styles.bestBannerContent
              }
            >
              <Text
                style={
                  styles.bestBannerTitle
                }
              >
                Recommended Route
              </Text>

              <Text
                style={
                  styles.bestBannerText
                }
              >
                Lowest estimated
                exposure within the
                acceptable travel-time
                detour.
              </Text>
            </View>
          </View>
        )}

        {/* ==================================================
            HEADER
            ================================================== */}

        <View
          style={styles.header}
        >
          <View
            style={
              styles.headerTitleRow
            }
          >
            <Text
              style={
                styles.routeTitle
              }
            >
              {recommended
                ? "Best Route"
                : "Route Details"}
            </Text>

            {recommended && (
              <View
                style={
                  styles.headerBadge
                }
              >
                <Text
                  style={
                    styles.headerBadgeText
                  }
                >
                  RECOMMENDED
                </Text>
              </View>
            )}
          </View>

          <Text
            style={styles.routeId}
          >
            {routeData?.routeId ||
              routeData?.id ||
              "Route"}
          </Text>

          {routeData?.summary && (
            <Text
              style={
                styles.routeSummary
              }
            >
              {routeData.summary}
            </Text>
          )}
        </View>

        {/* ==================================================
            BASIC SUMMARY
            ================================================== */}

        <View
          style={
            styles.summaryGrid
          }
        >
          <SummaryCard
            icon="📍"
            label="Distance"
            value={formatDistance(
              distance
            )}
          />

          <SummaryCard
            icon="⏱"
            label="Travel Time"
            value={formatDuration(
              duration
            )}
          />
        </View>

        {/* ==================================================
            AIR QUALITY
            ================================================== */}

        <View
          style={styles.section}
        >
          <Text
            style={
              styles.sectionTitle
            }
          >
            Air Quality
          </Text>

          <View
            style={
              styles.aqiOverview
            }
          >
            <View
              style={styles.aqiMain}
            >
              <Text
                style={styles.label}
              >
                Average AQI
              </Text>

              <Text
                style={[
                  styles.aqiMainValue,
                  {
                    color:
                      getAqiColor(
                        averageAqi
                      ),
                  },
                ]}
              >
                {isValidNumber(
                  averageAqi
                )
                  ? Math.round(
                      Number(
                        averageAqi
                      )
                    )
                  : "—"}
              </Text>

              <Text
                style={[
                  styles.aqiCategory,
                  {
                    color:
                      getAqiColor(
                        averageAqi
                      ),
                  },
                ]}
              >
                {averageAqiLabel}
              </Text>
            </View>

            <View
              style={styles.aqiMain}
            >
              <Text
                style={styles.label}
              >
                Peak AQI
              </Text>

              <Text
                style={[
                  styles.aqiMainValue,
                  {
                    color:
                      getAqiColor(
                        peakAqi
                      ),
                  },
                ]}
              >
                {isValidNumber(
                  peakAqi
                )
                  ? Math.round(
                      Number(
                        peakAqi
                      )
                    )
                  : "—"}
              </Text>

              <Text
                style={[
                  styles.aqiCategory,
                  {
                    color:
                      getAqiColor(
                        peakAqi
                      ),
                  },
                ]}
              >
                {peakAqiLabel}
              </Text>
            </View>
          </View>

          <View
            style={
              styles.coverageCard
            }
          >
            <View>
              <Text
                style={
                  styles.coverageLabel
                }
              >
                AQI Coverage
              </Text>

              <Text
                style={
                  styles.coverageValue
                }
              >
                {formatPercent(
                  coverage
                )}
              </Text>
            </View>

            <View
              style={
                styles.coverageInfo
              }
            >
              <Text
                style={
                  styles.coverageInfoText
                }
              >
                Coverage indicates how
                much of the route had
                usable AQI data.
              </Text>
            </View>
          </View>
        </View>

        {/* ==================================================
            EXPOSURE
            ================================================== */}

        <View
          style={styles.section}
        >
          <Text
            style={
              styles.sectionTitle
            }
          >
            Pollution Exposure
          </Text>

          <View
            style={[
              styles.exposureCard,
              {
                backgroundColor:
                  exposureBackground,
              },
            ]}
          >
            <View
              style={
                styles.exposureHeader
              }
            >
              <View>
                <Text
                  style={
                    styles.exposureLabel
                  }
                >
                  Exposure Band
                </Text>

                <Text
                  style={[
                    styles.exposureBand,
                    {
                      color:
                        exposureColor,
                    },
                  ]}
                >
                  {String(
                    exposureBand
                  ).toUpperCase()}
                </Text>
              </View>

              <Text
                style={
                  styles.exposureIcon
                }
              >
                🌿
              </Text>
            </View>

            <View
              style={
                styles.exposureMetrics
              }
            >
              <View
                style={
                  styles.exposureMetric
                }
              >
                <Text
                  style={
                    styles.metricLabel
                  }
                >
                  Exposure Score
                </Text>

                <Text
                  style={
                    styles.metricValue
                  }
                >
                  {isValidNumber(
                    exposureScore
                  )
                    ? Math.round(
                        Number(
                          exposureScore
                        )
                      ).toLocaleString()
                    : "—"}
                </Text>
              </View>

              {isValidNumber(
                exposurePerHour
              ) && (
                <View
                  style={
                    styles.exposureMetric
                  }
                >
                  <Text
                    style={
                      styles.metricLabel
                    }
                  >
                    Per Hour
                  </Text>

                  <Text
                    style={
                      styles.metricValue
                    }
                  >
                    {Math.round(
                      Number(
                        exposurePerHour
                      )
                    ).toLocaleString()}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ==================================================
            DETOUR
            ================================================== */}

        <View
          style={styles.section}
        >
          <Text
            style={
              styles.sectionTitle
            }
          >
            Travel-Time Trade-off
          </Text>

          <View
            style={[
              styles.detourCard,
              detourAcceptable
                ? styles.detourGood
                : styles.detourWarning,
            ]}
          >
            <Text
              style={
                styles.detourIcon
              }
            >
              {detourAcceptable
                ? "✓"
                : "⚠"}
            </Text>

            <View
              style={
                styles.detourContent
              }
            >
              <Text
                style={[
                  styles.detourTitle,
                  {
                    color:
                      detourAcceptable
                        ? "#176B2C"
                        : "#B06000",
                  },
                ]}
              >
                {detourAcceptable
                  ? "Within preferred detour"
                  : "Outside preferred detour"}
              </Text>

              <Text
                style={
                  styles.detourText
                }
              >
                {Number.isFinite(
                  detourPercent
                )
                  ? `${
                      detourPercent >= 0
                        ? "+"
                        : ""
                    }${detourPercent.toFixed(
                      1
                    )}% travel-time detour`
                  : "Detour information unavailable"}
              </Text>
            </View>
          </View>
        </View>

        {/* ==================================================
            HOTSPOTS
            ================================================== */}

        <View
          style={styles.section}
        >
          <Text
            style={
              styles.sectionTitle
            }
          >
            Pollution Hotspots
          </Text>

          <View
            style={[
              styles.hotspotSummary,
              criticalHotspot &&
                styles.criticalHotspotSummary,
            ]}
          >
            <View
              style={
                styles.hotspotIcon
              }
            >
              <Text
                style={
                  styles.hotspotIconText
                }
              >
                {hotspotCount > 0
                  ? "⚠"
                  : "✓"}
              </Text>
            </View>

            <View
              style={
                styles.hotspotSummaryContent
              }
            >
              <Text
                style={
                  styles.hotspotTitle
                }
              >
                {hotspotCount === 0
                  ? "No hotspots detected"
                  : criticalHotspot
                  ? "Critical hotspot detected"
                  : `${hotspotCount} hotspot${
                      hotspotCount >
                      1
                        ? "s"
                        : ""
                    } detected`}
              </Text>

              {hotspotCount > 0 && (
                <Text
                  style={
                    styles.hotspotMeta
                  }
                >
                  Peak AQI{" "}
                  {isValidNumber(
                    hotspotPeak
                  )
                    ? hotspotPeak
                    : "—"}
                  {" · "}
                  {isValidNumber(
                    hotspotDuration
                  )
                    ? hotspotDuration.toFixed(
                        1
                      )
                    : "—"}
                  {" min · "}
                  {isValidNumber(
                    hotspotShare
                  )
                    ? hotspotShare.toFixed(
                        1
                      )
                    : "—"}
                  % exposure share
                </Text>
              )}
            </View>
          </View>

          {hotspots.map(
            (
              hotspot,
              index
            ) => (
              <View
                key={
                  hotspot?.id ||
                  `${routeData?.routeId}-hotspot-${index}`
                }
                style={
                  styles.hotspotItem
                }
              >
                <View
                  style={
                    styles.hotspotItemHeader
                  }
                >
                  <Text
                    style={
                      styles.hotspotItemTitle
                    }
                  >
                    Hotspot {index + 1}
                  </Text>

                  {hotspot?.critical && (
                    <View
                      style={
                        styles.criticalBadge
                      }
                    >
                      <Text
                        style={
                          styles.criticalBadgeText
                        }
                      >
                        CRITICAL
                      </Text>
                    </View>
                  )}
                </View>

                <View
                  style={
                    styles.hotspotStats
                  }
                >
                  <View
                    style={
                      styles.hotspotStat
                    }
                  >
                    <Text
                      style={
                        styles.hotspotStatLabel
                      }
                    >
                      Peak AQI
                    </Text>

                    <Text
                      style={[
                        styles.hotspotStatValue,
                        {
                          color:
                            getAqiColor(
                              hotspot?.peakAqi ??
                                hotspot?.maxAqi
                            ),
                        },
                      ]}
                    >
                      {isValidNumber(
                        hotspot?.peakAqi ??
                          hotspot?.maxAqi
                      )
                        ? Number(
                            hotspot?.peakAqi ??
                              hotspot?.maxAqi
                          )
                        : "—"}
                    </Text>
                  </View>

                  {hotspot?.durationMinutes !==
                    undefined && (
                    <View
                      style={
                        styles.hotspotStat
                      }
                    >
                      <Text
                        style={
                          styles.hotspotStatLabel
                        }
                      >
                        Duration
                      </Text>

                      <Text
                        style={
                          styles.hotspotStatValue
                        }
                      >
                        {formatNumber(
                          hotspot.durationMinutes,
                          1
                        )}{" "}
                        min
                      </Text>
                    </View>
                  )}

                  {hotspot?.startDistanceMeters !==
                    undefined && (
                    <View
                      style={
                        styles.hotspotStat
                      }
                    >
                      <Text
                        style={
                          styles.hotspotStatLabel
                        }
                      >
                        Start
                      </Text>

                      <Text
                        style={
                          styles.hotspotStatValue
                        }
                      >
                        {formatDistance(
                          hotspot.startDistanceMeters
                        )}
                      </Text>
                    </View>
                  )}
                </View>

                {hotspot?.critical && (
                  <Text
                    style={
                      styles.criticalText
                    }
                  >
                    ⚠ Critical pollution
                    zone
                  </Text>
                )}
              </View>
            )
          )}
        </View>

        {/* ==================================================
            ENVIRONMENTAL ADVISORY
            ================================================== */}

        <View
          style={styles.section}
        >
          <Text
            style={
              styles.sectionTitle
            }
          >
            Environmental Advisory
          </Text>

          <View
            style={
              styles.advisoryCard
            }
          >
            <Text
              style={
                styles.advisoryLevel
              }
            >
              {advisory?.title ||
                "Environmental conditions"}
            </Text>

            <Text
              style={
                styles.advisoryMessage
              }
            >
              {advisory?.message ||
                "Environmental air-quality information is available for this route."}
            </Text>
          </View>
        </View>

        {/* ==================================================
            AQI ALONG ROUTE
            ================================================== */}

        <View
          style={styles.section}
        >
          <View
            style={
              styles.sectionTitleRow
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >
              AQI Along Route
            </Text>

            {aqiSegments.length >
              20 && (
              <Text
                style={
                  styles.segmentCount
                }
              >
                First 20 points
              </Text>
            )}
          </View>

          {aqiSegments.length === 0 ? (
            <Text
              style={
                styles.emptyText
              }
            >
              AQI segment information
              is unavailable.
            </Text>
          ) : (
            aqiSegments
              .slice(0, 20)
              .map(
                (
                  segment,
                  index
                ) => (
                  <View
                    key={`${routeData?.routeId}-aqi-${index}`}
                    style={
                      styles.aqiSegment
                    }
                  >
                    <View
                      style={[
                        styles.aqiDot,
                        {
                          backgroundColor:
                            getAqiColor(
                              segment?.aqi
                            ),
                        },
                      ]}
                    />

                    <View
                      style={
                        styles.segmentContent
                      }
                    >
                      <View
                        style={
                          styles.segmentTopRow
                        }
                      >
                        <Text
                          style={
                            styles.segmentDistance
                          }
                        >
                          {isValidNumber(
                            segment?.distanceMeters
                          )
                            ? Math.round(
                                Number(
                                  segment.distanceMeters
                                )
                              ).toLocaleString()
                            : "—"}
                          {isValidNumber(
                            segment?.distanceMeters
                          )
                            ? "m"
                            : ""}
                        </Text>

                        <Text
                          style={[
                            styles.segmentAqiValue,
                            {
                              color:
                                getAqiColor(
                                  segment?.aqi
                                ),
                            },
                          ]}
                        >
                          {isValidNumber(
                            segment?.aqi
                          )
                            ? Math.round(
                                Number(
                                  segment.aqi
                                )
                              )
                            : "—"}
                        </Text>
                      </View>

                      <Text
                        style={
                          styles.segmentAqi
                        }
                      >
                        {getAqiCategoryLabel(
                          segment?.category,
                          segment?.aqi
                        )}
                      </Text>

                      {(segment?.source ||
                        segment?.confidence !=
                          null) && (
                        <Text
                          style={
                            styles.segmentMeta
                          }
                        >
                          {segment?.source
                            ? `Source: ${segment.source}`
                            : ""}
                          {segment?.source &&
                          segment?.confidence !=
                            null
                            ? " · "
                            : ""}
                          {segment?.confidence !=
                          null
                            ? `Confidence: ${segment.confidence}`
                            : ""}
                        </Text>
                      )}
                    </View>
                  </View>
                )
              )
          )}
        </View>

        {/* ==================================================
            FINAL EXPLANATION
            ================================================== */}

        {recommended && (
          <View
            style={
              styles.explanationCard
            }
          >
            <Text
              style={
                styles.explanationTitle
              }
            >
              Why this route?
            </Text>

            <Text
              style={
                styles.explanationText
              }
            >
              AirRoute recommends this
              route because it has the
              lowest estimated pollution
              exposure among routes that
              satisfy the acceptable
              travel-time detour
              constraint.
            </Text>
          </View>
        )}

        <View
          style={{
            height: 20,
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================
// SUMMARY CARD
// ============================================================

function SummaryCard({
  icon,
  label,
  value,
}) {
  return (
    <View
      style={
        styles.summaryCard
      }
    >
      <Text
        style={
          styles.summaryIcon
        }
      >
        {icon}
      </Text>

      <Text
        style={
          styles.label
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.value
        }
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
    container: {
      flex: 1,
      backgroundColor:
        "#F7F8FA",
    },

    content: {
      padding: 16,
      paddingBottom: 35,
    },

    // ========================================================
    // MAP
    // ========================================================

    mapSection: {
      backgroundColor:
        "#FFFFFF",

      borderRadius: 14,

      overflow: "hidden",

      borderWidth: 1,

      borderColor:
        "#E5E7EB",

      marginBottom: 14,

      elevation: 2,

      shadowColor:
        "#000",

      shadowOpacity:
        0.05,

      shadowRadius:
        5,

      shadowOffset: {
        width: 0,
        height: 2,
      },
    },

    mapHeader: {
      flexDirection:
        "row",

      alignItems:
        "center",

      justifyContent:
        "space-between",

      paddingHorizontal: 14,

      paddingVertical: 12,

      borderBottomWidth: 1,

      borderBottomColor:
        "#EEF0F2",
    },

    mapTitle: {
      fontSize: 17,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    mapSubtitle: {
      marginTop: 2,

      fontSize: 10,

      color:
        "#7A8087",
    },

    mapRecommendedBadge: {
      backgroundColor:
        "#E6F4EA",

      paddingHorizontal: 8,

      paddingVertical: 5,

      borderRadius: 9,
    },

    mapRecommendedBadgeText: {
      color:
        "#176B2C",

      fontSize: 8,

      fontWeight:
        "900",
    },

    mapContainer: {
      height: 310,

      position:
        "relative",
    },

    selectedMapOverlay: {
      position:
        "absolute",

      left: 12,

      bottom: 12,

      flexDirection:
        "row",

      alignItems:
        "center",

      backgroundColor:
        "rgba(255,255,255,0.95)",

      paddingHorizontal: 10,

      paddingVertical: 7,

      borderRadius: 10,

      elevation: 3,

      shadowColor:
        "#000",

      shadowOpacity:
        0.12,

      shadowRadius:
        4,

      shadowOffset: {
        width: 0,

        height: 2,
      },
    },

    selectedMapDot: {
      width: 9,

      height: 9,

      borderRadius: 5,

      backgroundColor:
        "#1769AA",

      marginRight: 6,
    },

    selectedMapText: {
      fontSize: 10,

      fontWeight:
        "800",

      color:
        "#1769AA",
    },

    // ========================================================
    // BANNER
    // ========================================================

    bestBanner: {
      flexDirection:
        "row",

      backgroundColor:
        "#E6F4EA",

      borderRadius: 14,

      padding: 14,

      marginBottom: 14,

      borderWidth: 1,

      borderColor:
        "#B7DFC0",
    },

    bestBannerIcon: {
      width: 34,

      height: 34,

      borderRadius: 17,

      backgroundColor:
        "#FFFFFF",

      alignItems:
        "center",

      justifyContent:
        "center",

      marginRight: 10,
    },

    bestBannerIconText: {
      color:
        "#1E8E3E",

      fontSize: 18,

      fontWeight:
        "800",
    },

    bestBannerContent: {
      flex: 1,
    },

    bestBannerTitle: {
      color:
        "#1E8E3E",

      fontSize: 16,

      fontWeight:
        "800",
    },

    bestBannerText: {
      marginTop: 5,

      color:
        "#276738",

      fontSize: 13,

      lineHeight: 19,
    },

    // ========================================================
    // HEADER
    // ========================================================

    header: {
      marginBottom: 14,
    },

    headerTitleRow: {
      flexDirection:
        "row",

      alignItems:
        "center",

      flexWrap:
        "wrap",
    },

    routeTitle: {
      fontSize: 23,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    headerBadge: {
      marginLeft: 8,

      backgroundColor:
        "#E6F4EA",

      paddingHorizontal:
        8,

      paddingVertical:
        4,

      borderRadius: 10,
    },

    headerBadgeText: {
      color:
        "#176B2C",

      fontSize: 8,

      fontWeight:
        "800",
    },

    routeId: {
      marginTop: 4,

      fontSize: 10,

      color:
        "#9AA0A6",
    },

    routeSummary: {
      marginTop: 5,

      fontSize: 13,

      lineHeight: 19,

      color:
        "#5F6368",
    },

    // ========================================================
    // SUMMARY
    // ========================================================

    summaryGrid: {
      flexDirection:
        "row",

      gap: 10,
    },

    summaryCard: {
      flex: 1,

      backgroundColor:
        "#FFFFFF",

      borderRadius: 12,

      padding: 15,

      borderWidth: 1,

      borderColor:
        "#E5E7EB",
    },

    summaryIcon: {
      fontSize: 17,

      marginBottom: 5,
    },

    label: {
      fontSize: 11,

      color:
        "#6B7280",

      marginBottom: 4,
    },

    value: {
      fontSize: 18,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    // ========================================================
    // SECTION
    // ========================================================

    section: {
      marginTop: 16,

      backgroundColor:
        "#FFFFFF",

      borderRadius: 14,

      padding: 15,

      borderWidth: 1,

      borderColor:
        "#E5E7EB",
    },

    sectionTitleRow: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",

      marginBottom: 12,
    },

    sectionTitle: {
      fontSize: 17,

      fontWeight:
        "800",

      color:
        "#202124",

      marginBottom: 12,
    },

    segmentCount: {
      fontSize: 10,

      color:
        "#9AA0A6",

      marginBottom: 12,
    },

    // ========================================================
    // AQI
    // ========================================================

    aqiOverview: {
      flexDirection:
        "row",

      justifyContent:
        "space-around",
    },

    aqiMain: {
      alignItems:
        "center",

      flex: 1,
    },

    aqiMainValue: {
      fontSize: 30,

      fontWeight:
        "800",

      marginTop: 2,
    },

    aqiCategory: {
      marginTop: 3,

      fontSize: 11,

      fontWeight:
        "700",

      textAlign:
        "center",
    },

    coverageCard: {
      flexDirection:
        "row",

      alignItems:
        "center",

      marginTop: 16,

      paddingTop: 13,

      borderTopWidth: 1,

      borderTopColor:
        "#EEF0F2",
    },

    coverageLabel: {
      fontSize: 10,

      color:
        "#6B7280",

      textTransform:
        "uppercase",

      fontWeight:
        "700",
    },

    coverageValue: {
      marginTop: 3,

      fontSize: 16,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    coverageInfo: {
      flex: 1,

      marginLeft: 18,
    },

    coverageInfoText: {
      fontSize: 11,

      lineHeight: 16,

      color:
        "#6B7280",
    },

    // ========================================================
    // EXPOSURE
    // ========================================================

    exposureCard: {
      borderRadius: 12,

      padding: 14,
    },

    exposureHeader: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",
    },

    exposureLabel: {
      fontSize: 10,

      color:
        "#6B7280",

      textTransform:
        "uppercase",

      fontWeight:
        "700",
    },

    exposureBand: {
      marginTop: 4,

      fontSize: 17,

      fontWeight:
        "900",
    },

    exposureIcon: {
      fontSize: 27,
    },

    exposureMetrics: {
      flexDirection:
        "row",

      marginTop: 14,

      paddingTop: 12,

      borderTopWidth: 1,

      borderTopColor:
        "rgba(0,0,0,0.08)",
    },

    exposureMetric: {
      flex: 1,
    },

    metricLabel: {
      fontSize: 10,

      color:
        "#6B7280",

      textTransform:
        "uppercase",

      fontWeight:
        "700",
    },

    metricValue: {
      marginTop: 3,

      fontSize: 16,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    // ========================================================
    // DETOUR
    // ========================================================

    detourCard: {
      flexDirection:
        "row",

      alignItems:
        "center",

      borderRadius: 11,

      padding: 13,

      borderWidth: 1,
    },

    detourGood: {
      backgroundColor:
        "#E6F4EA",

      borderColor:
        "#B7DFC0",
    },

    detourWarning: {
      backgroundColor:
        "#FFF4E5",

      borderColor:
        "#F2D19B",
    },

    detourIcon: {
      fontSize: 20,

      marginRight: 10,
    },

    detourContent: {
      flex: 1,
    },

    detourTitle: {
      fontSize: 13,

      fontWeight:
        "800",
    },

    detourText: {
      marginTop: 3,

      fontSize: 12,

      color:
        "#5F6368",
    },

    // ========================================================
    // HOTSPOTS
    // ========================================================

    hotspotSummary: {
      flexDirection:
        "row",

      alignItems:
        "center",

      backgroundColor:
        "#F8FAFC",

      borderRadius: 11,

      padding: 12,

      borderWidth: 1,

      borderColor:
        "#E5E7EB",
    },

    criticalHotspotSummary: {
      backgroundColor:
        "#FCE8E6",

      borderColor:
        "#F3B7B2",
    },

    hotspotIcon: {
      width: 34,

      height: 34,

      borderRadius: 17,

      backgroundColor:
        "#FFFFFF",

      alignItems:
        "center",

      justifyContent:
        "center",

      marginRight: 10,
    },

    hotspotIconText: {
      fontSize: 17,
    },

    hotspotSummaryContent: {
      flex: 1,
    },

    hotspotTitle: {
      fontSize: 13,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    hotspotMeta: {
      marginTop: 4,

      fontSize: 11,

      color:
        "#5F6368",
    },

    hotspotItem: {
      marginTop: 10,

      padding: 12,

      backgroundColor:
        "#FAFAFA",

      borderRadius: 9,

      borderWidth: 1,

      borderColor:
        "#EEEEEE",
    },

    hotspotItemHeader: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",
    },

    hotspotItemTitle: {
      fontSize: 13,

      fontWeight:
        "700",

      color:
        "#202124",
    },

    criticalBadge: {
      backgroundColor:
        "#FCE8E6",

      paddingHorizontal:
        7,

      paddingVertical:
        3,

      borderRadius: 8,
    },

    criticalBadgeText: {
      color:
        "#B31412",

      fontSize: 8,

      fontWeight:
        "900",
    },

    hotspotStats: {
      flexDirection:
        "row",

      marginTop: 10,

      paddingTop: 9,

      borderTopWidth: 1,

      borderTopColor:
        "#EEEEEE",
    },

    hotspotStat: {
      flex: 1,
    },

    hotspotStatLabel: {
      fontSize: 9,

      color:
        "#7A8087",

      textTransform:
        "uppercase",

      fontWeight:
        "600",
    },

    hotspotStatValue: {
      marginTop: 3,

      fontSize: 12,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    criticalText: {
      marginTop: 8,

      color:
        "#D93025",

      fontSize: 12,

      fontWeight:
        "700",
    },

    // ========================================================
    // ADVISORY
    // ========================================================

    advisoryCard: {
      backgroundColor:
        "#F8FAFC",

      borderRadius: 10,

      padding: 14,

      borderLeftWidth: 4,

      borderLeftColor:
        "#1A73E8",
    },

    advisoryLevel: {
      fontSize: 15,

      fontWeight:
        "800",

      color:
        "#202124",
    },

    advisoryMessage: {
      marginTop: 6,

      fontSize: 13,

      lineHeight: 19,

      color:
        "#5F6368",
    },

    // ========================================================
    // AQI SEGMENTS
    // ========================================================

    aqiSegment: {
      flexDirection:
        "row",

      alignItems:
        "center",

      paddingVertical: 9,

      borderBottomWidth: 1,

      borderBottomColor:
        "#F0F0F0",
    },

    aqiDot: {
      width: 12,

      height: 12,

      borderRadius: 6,

      marginRight: 10,
    },

    segmentContent: {
      flex: 1,
    },

    segmentTopRow: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",
    },

    segmentDistance: {
      fontSize: 12,

      color:
        "#5F6368",
    },

    segmentAqiValue: {
      fontSize: 14,

      fontWeight:
        "900",
    },

    segmentAqi: {
      marginTop: 2,

      fontSize: 12,

      fontWeight:
        "700",

      color:
        "#202124",
    },

    segmentMeta: {
      marginTop: 3,

      fontSize: 9,

      color:
        "#9AA0A6",
    },

    emptyText: {
      color:
        "#6B7280",

      fontSize: 13,

      lineHeight: 19,
    },

    // ========================================================
    // EXPLANATION
    // ========================================================

    explanationCard: {
      marginTop: 16,

      backgroundColor:
        "#E8F0FE",

      borderRadius: 13,

      padding: 15,

      borderWidth: 1,

      borderColor:
        "#C9D9F2",
    },

    explanationTitle: {
      fontSize: 14,

      fontWeight:
        "800",

      color:
        "#174EA6",
    },

    explanationText: {
      marginTop: 6,

      fontSize: 12,

      lineHeight: 19,

      color:
        "#405777",
    },
  });