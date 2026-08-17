// screens/Home.js

import React, {
  useEffect,
  useState,
} from "react";

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";

import * as Location from "expo-location";

import {
  useUserProfile,
} from "../context/UserProfileContext";

import api from "../services/api";

export default function Home({
  navigation,
}) {
  // ==========================================================
  // PROFILE
  // ==========================================================

  const {
    profile,
    clearProfile,
  } = useUserProfile();

  // ==========================================================
  // FORM STATE
  // ==========================================================

  const [
    origin,
    setOrigin,
  ] = useState("");

  const [
    destination,
    setDestination,
  ] = useState("");

  const [
    useCurrentLocation,
    setUseCurrentLocation,
  ] = useState(true);

  // ==========================================================
  // LOCATION STATE
  // ==========================================================

  const [
    loadingLocation,
    setLoadingLocation,
  ] = useState(false);

  const [
    currentCoords,
    setCurrentCoords,
  ] = useState(null);

  // ==========================================================
  // SEARCH STATE
  // ==========================================================

  const [
    searching,
    setSearching,
  ] = useState(false);

  // ==========================================================
  // CURRENT LOCATION
  // ==========================================================

  useEffect(() => {
    if (useCurrentLocation) {
      fetchCurrentLocation();
    }
  }, [useCurrentLocation]);

  const fetchCurrentLocation =
    async () => {
      setLoadingLocation(true);

      try {
        const {
          status,
        } =
          await Location.requestForegroundPermissionsAsync();

        if (status !== "granted") {
          setCurrentCoords(null);

          setUseCurrentLocation(false);

          Alert.alert(
            "Location permission denied",
            "Please enter your origin address manually."
          );

          return;
        }

        const location =
          await Location.getCurrentPositionAsync(
            {
              accuracy:
                Location.Accuracy.High,
            }
          );

        const latitude =
          Number(
            location?.coords?.latitude
          );

        const longitude =
          Number(
            location?.coords?.longitude
          );

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {
          throw new Error(
            "Unable to determine your current location."
          );
        }

        setCurrentCoords({
          lat: latitude,
          lng: longitude,
        });
      } catch (error) {
        console.error(
          "[Home] Location error:",
          error
        );

        setCurrentCoords(null);

        setUseCurrentLocation(false);

        Alert.alert(
          "Location unavailable",
          "We could not get your current location. Please enter your origin manually."
        );
      } finally {
        setLoadingLocation(false);
      }
    };

  // ==========================================================
  // ROUTE SEARCH
  // ==========================================================

  const handleSearch =
    async () => {
      const trimmedDestination =
        destination.trim();

      if (!trimmedDestination) {
        Alert.alert(
          "Missing destination",
          "Please enter a destination."
        );

        return;
      }

      if (
        !useCurrentLocation &&
        !origin.trim()
      ) {
        Alert.alert(
          "Missing origin",
          "Please enter your origin address."
        );

        return;
      }

      if (
        useCurrentLocation &&
        !currentCoords
      ) {
        Alert.alert(
          "Location unavailable",
          "Your current location is not available yet. Please wait or enter your origin manually."
        );

        return;
      }

      setSearching(true);

      try {
        const originVal =
          useCurrentLocation
            ? currentCoords
              ? `${currentCoords.lat},${currentCoords.lng}`
              : null
            : origin.trim();

        if (!originVal) {
          throw new Error(
            "Origin not available. Please try again."
          );
        }

        const profileType =
          profile?.type ||
          "normal";

        console.log(
          "========================================"
        );

        console.log(
          "[Home] Starting route search"
        );

        console.log(
          "[Home] Origin:",
          originVal
        );

        console.log(
          "[Home] Destination:",
          trimmedDestination
        );

        console.log(
          "[Home] Profile:",
          profileType
        );

        console.log(
          "========================================"
        );

        const response =
          await api.getRoutes({
            origin: originVal,
            destination:
              trimmedDestination,
            profile:
              profileType,
          });

        if (
          !response ||
          response.success === false
        ) {
          throw new Error(
            response?.message ||
              "The route service returned an invalid response."
          );
        }

        const responseRoutes =
          Array.isArray(
            response?.routes
          )
            ? response.routes
            : [];

        if (
          responseRoutes.length === 0
        ) {
          throw new Error(
            "No usable routes were found for this trip."
          );
        }

        console.log(
          "========== ROUTE RESPONSE =========="
        );

        console.log(
          JSON.stringify(
            response,
            null,
            2
          )
        );

        console.log(
          "===================================="
        );

        navigation.navigate(
          "RouteResults",
          {
            routeResponse:
              response,

            origin:
              originVal,

            destination:
              trimmedDestination,
          }
        );
      } catch (error) {
        console.error(
          "[Home] Route search failed:",
          error
        );

        Alert.alert(
          "Search failed",
          error?.message ||
            "Could not find routes. Please try again."
        );
      } finally {
        setSearching(false);
      }
    };

  // ==========================================================
  // CHANGE PROFILE
  // ==========================================================

  const changeProfile =
    () => {
      Alert.alert(
        "Change profile?",
        "This will clear your stored profile and return to onboarding.",
        [
          {
            text: "Cancel",
            style: "cancel",
          },

          {
            text: "Yes, change",
            style: "destructive",

            onPress:
              async () => {
                try {
                  await clearProfile();

                  navigation.reset({
                    index: 0,

                    routes: [
                      {
                        name:
                          "Onboarding",
                      },
                    ],
                  });
                } catch (error) {
                  console.error(
                    "[Home] Profile reset failed:",
                    error
                  );

                  Alert.alert(
                    "Unable to change profile",
                    "Please try again."
                  );
                }
              },
          },
        ]
      );
    };

  // ==========================================================
  // PROFILE LABEL
  // ==========================================================

  const currentLabel =
    profile?.label ||
    "Standard";

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <SafeAreaView
      style={styles.container}
    >
      <KeyboardAvoidingView
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }
        style={{
          flex: 1,
        }}
      >
        <ScrollView
          contentContainerStyle={
            styles.scrollContent
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={
            false
          }
        >
          {/* ==================================================
              AIRROUTE LOGO
              ================================================== */}

          <View
            style={
              styles.logoCard
            }
          >
            <Image
              source={require(
                "../assets/airroute-logo.jpeg"
              )}
              style={
                styles.logo
              }
              resizeMode="contain"
            />
          </View>

          {/* ==================================================
              PROFILE
              ================================================== */}

          <View
            style={
              styles.profileBanner
            }
          >
            <View
              style={
                styles.profileInfo
              }
            >
              <Text
                style={
                  styles.profileBadgeLabel
                }
              >
                Profile
              </Text>

              <Text
                style={
                  styles.profileBadgeValue
                }
              >
                {currentLabel}
              </Text>
            </View>

            <TouchableOpacity
              onPress={
                changeProfile
              }
              disabled={
                searching
              }
              activeOpacity={0.7}
            >
              <Text
                style={
                  styles.changeProfileText
                }
              >
                Change
              </Text>
            </TouchableOpacity>
          </View>

          {/* ==================================================
              HERO
              ================================================== */}

          <View
            style={
              styles.heroCard
            }
          >
            <Text
              style={
                styles.heroTitle
              }
            >
              🌿 Find the cleanest
              route
            </Text>

            <Text
              style={
                styles.heroSub
              }
            >
              AirRoute scores routes
              by pollution exposure,
              not just ETA. We'll
              surface the healthiest
              option for your profile.
            </Text>
          </View>

          {/* ==================================================
              AIRROUTE PLUS
              ================================================== */}

          <TouchableOpacity
            style={
              styles.plusCard
            }
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate(
                "AirRoutePlus"
              )
            }
            disabled={searching}
          >
            <View
              style={
                styles.plusIconContainer
              }
            >
              <Text
                style={
                  styles.plusIcon
                }
              >
                🌿
              </Text>
            </View>

            <View
              style={
                styles.plusContent
              }
            >
              <View
                style={
                  styles.plusTitleRow
                }
              >
                <Text
                  style={
                    styles.plusTitle
                  }
                >
                  AirRoute Plus
                </Text>

                <View
                  style={
                    styles.plusBadge
                  }
                >
                  <Text
                    style={
                      styles.plusBadgeText
                    }
                  >
                    PREVIEW
                  </Text>
                </View>
              </View>

              <Text
                style={
                  styles.plusDescription
                }
              >
                Get detailed walking,
                bus & metro journey
                guidance with health
                benefits.
              </Text>

              <Text
                style={
                  styles.plusLink
                }
              >
                Explore healthier
                journey →
              </Text>
            </View>
          </TouchableOpacity>

          {/* ==================================================
              SEARCH FORM
              ================================================== */}

          <View
            style={
              styles.formCard
            }
          >
            {/* FROM */}

            <View
              style={
                styles.row
              }
            >
              <View
                style={
                  styles.inputLabelRow
                }
              >
                <Text
                  style={
                    styles.inputLabel
                  }
                >
                  From
                </Text>

                <View
                  style={
                    styles.locationToggle
                  }
                >
                  <Text
                    style={
                      styles.locationToggleLabel
                    }
                  >
                    Use my location
                  </Text>

                  <Switch
                    value={
                      useCurrentLocation
                    }
                    onValueChange={
                      setUseCurrentLocation
                    }
                    disabled={
                      searching
                    }
                    trackColor={{
                      true:
                        "#1a73e8",
                      false:
                        "#dadce0",
                    }}
                    thumbColor="#ffffff"
                  />
                </View>
              </View>

              {useCurrentLocation ? (
                <View
                  style={[
                    styles.input,
                    styles.inputLocked,
                  ]}
                >
                  <Text
                    style={
                      styles.inputIcon
                    }
                  >
                    📍
                  </Text>

                  <Text
                    style={
                      styles.lockedText
                    }
                    numberOfLines={1}
                  >
                    {loadingLocation
                      ? "Getting current location..."
                      : currentCoords
                      ? `Current location (${currentCoords.lat.toFixed(
                          4
                        )}, ${currentCoords.lng.toFixed(
                          4
                        )})`
                      : "Waiting for location..."}
                  </Text>

                  {loadingLocation && (
                    <ActivityIndicator
                      size="small"
                      color="#1a73e8"
                    />
                  )}
                </View>
              ) : (
                <View
                  style={
                    styles.input
                  }
                >
                  <Text
                    style={
                      styles.inputIcon
                    }
                  >
                    📍
                  </Text>

                  <TextInput
                    style={
                      styles.textInput
                    }
                    placeholder="Enter origin address or landmark"
                    placeholderTextColor="#9aa0a6"
                    value={origin}
                    onChangeText={
                      setOrigin
                    }
                    editable={
                      !searching
                    }
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>
              )}
            </View>

            {/* DIVIDER */}

            <View
              style={
                styles.divider
              }
            />

            {/* TO */}

            <View
              style={
                styles.row
              }
            >
              <Text
                style={
                  styles.inputLabel
                }
              >
                To
              </Text>

              <View
                style={
                  styles.input
                }
              >
                <Text
                  style={
                    styles.inputIcon
                  }
                >
                  🎯
                </Text>

                <TextInput
                  style={
                    styles.textInput
                  }
                  placeholder="Where are you going?"
                  placeholderTextColor="#9aa0a6"
                  value={
                    destination
                  }
                  onChangeText={
                    setDestination
                  }
                  editable={
                    !searching
                  }
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={
                    handleSearch
                  }
                />
              </View>
            </View>
          </View>

          {/* ==================================================
              SEARCH BUTTON
              ================================================== */}

          <TouchableOpacity
            style={[
              styles.searchButton,
              (searching ||
                loadingLocation) &&
                styles.searchButtonDisabled,
            ]}
            onPress={
              handleSearch
            }
            disabled={
              searching ||
              loadingLocation
            }
            activeOpacity={0.8}
          >
            {searching ? (
              <View
                style={
                  styles.buttonRow
                }
              >
                <ActivityIndicator
                  color="#ffffff"
                />

                <Text
                  style={
                    styles.searchText
                  }
                >
                  Finding clean
                  routes...
                </Text>
              </View>
            ) : (
              <Text
                style={
                  styles.searchText
                }
              >
                🔍 Find route
              </Text>
            )}
          </TouchableOpacity>

          {/* ==================================================
              HOW IT WORKS
              ================================================== */}

          <View
            style={
              styles.hintCard
            }
          >
            <Text
              style={
                styles.hintTitle
              }
            >
              💡 How it works
            </Text>

            <Text
              style={
                styles.hintText
              }
            >
              • We request alternative
              routes from the routing
              provider{"\n"}
              • Each route is sampled
              for AQI along its path
              {"\n"}
              • Routes are scored by
              pollution exposure, not
              just ETA{"\n"}
              • The lowest-exposure
              route within the acceptable
              detour is recommended
            </Text>
          </View>

          {/* ==================================================
              INFO
              ================================================== */}

          <View
            style={
              styles.infoCard
            }
          >
            <Text
              style={
                styles.infoIcon
              }
            >
              🌱
            </Text>

            <View
              style={
                styles.infoContent
              }
            >
              <Text
                style={
                  styles.infoTitle
                }
              >
                Breathe cleaner
              </Text>

              <Text
                style={
                  styles.infoText
                }
              >
                AirRoute helps compare
                travel time with estimated
                pollution exposure so you
                can make a more informed
                route choice.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
        "#f0f4f8",
    },

    scrollContent: {
      padding: 18,

      paddingBottom: 40,
    },

    // ========================================================
    // LOGO
    // ========================================================

    logoCard: {
      backgroundColor:
        "#fdfffe",

      borderRadius: 18,

      alignItems: "center",

      justifyContent:
        "center",

      paddingVertical: 6,

      marginBottom: 16,

      elevation: 2,

      shadowColor: "#000",

      shadowOpacity: 0.05,

      shadowRadius: 5,

      shadowOffset: {
        width: 0,
        height: 2,
      },
    },

    logo: {
      width: 150,

      height: 120,
    },

    // ========================================================
    // PROFILE
    // ========================================================

    profileBanner: {
      flexDirection: "row",

      justifyContent:
        "space-between",

      alignItems: "center",

      backgroundColor:
        "#ffffff",

      padding: 12,

      borderRadius: 10,

      marginBottom: 16,

      elevation: 1,
    },

    profileInfo: {
      flexDirection: "row",

      alignItems: "center",

      flex: 1,
    },

    profileBadgeLabel: {
      fontSize: 12,

      color: "#5f6368",

      marginRight: 8,
    },

    profileBadgeValue: {
      fontSize: 13,

      fontWeight: "700",

      color: "#1a73e8",

      backgroundColor:
        "#e8f0fe",

      paddingHorizontal: 10,

      paddingVertical: 4,

      borderRadius: 12,
    },

    changeProfileText: {
      fontSize: 13,

      fontWeight: "600",

      color: "#1a73e8",
    },

    // ========================================================
    // HERO
    // ========================================================

    heroCard: {
      backgroundColor:
        "#1a73e8",

      borderRadius: 14,

      padding: 18,

      marginBottom: 16,
    },

    heroTitle: {
      color: "#ffffff",

      fontSize: 18,

      fontWeight: "700",

      marginBottom: 6,
    },

    heroSub: {
      color:
        "rgba(255,255,255,0.9)",

      fontSize: 13,

      lineHeight: 19,
    },

    // ========================================================
    // AIRROUTE PLUS
    // ========================================================

    plusCard: {
      flexDirection: "row",

      backgroundColor:
        "#ffffff",

      borderRadius: 14,

      padding: 14,

      marginBottom: 16,

      borderWidth: 1,

      borderColor:
        "#b7dfc0",

      elevation: 2,

      shadowColor: "#000",

      shadowOpacity: 0.05,

      shadowRadius: 5,

      shadowOffset: {
        width: 0,
        height: 2,
      },
    },

    plusIconContainer: {
      width: 48,

      height: 48,

      borderRadius: 24,

      backgroundColor:
        "#e6f4ea",

      alignItems: "center",

      justifyContent:
        "center",

      marginRight: 12,
    },

    plusIcon: {
      fontSize: 24,
    },

    plusContent: {
      flex: 1,
    },

    plusTitleRow: {
      flexDirection: "row",

      alignItems: "center",

      marginBottom: 4,
    },

    plusTitle: {
      fontSize: 15,

      fontWeight: "800",

      color: "#176b2c",
    },

    plusBadge: {
      marginLeft: 8,

      backgroundColor:
        "#e8f0fe",

      paddingHorizontal: 7,

      paddingVertical: 3,

      borderRadius: 8,
    },

    plusBadgeText: {
      fontSize: 8,

      fontWeight: "800",

      color: "#1a73e8",

      letterSpacing: 0.5,
    },

    plusDescription: {
      fontSize: 11,

      lineHeight: 17,

      color: "#5f6368",

      marginBottom: 5,
    },

    plusLink: {
      fontSize: 11,

      fontWeight: "800",

      color: "#1a73e8",
    },

    // ========================================================
    // FORM
    // ========================================================

    formCard: {
      backgroundColor:
        "#ffffff",

      borderRadius: 14,

      padding: 16,

      marginBottom: 16,

      elevation: 3,
    },

    row: {
      marginBottom: 8,
    },

    inputLabelRow: {
      flexDirection: "row",

      justifyContent:
        "space-between",

      alignItems: "center",

      marginBottom: 6,
    },

    inputLabel: {
      fontSize: 12,

      fontWeight: "600",

      color: "#5f6368",

      textTransform:
        "uppercase",

      letterSpacing: 0.5,

      marginBottom: 6,
    },

    locationToggle: {
      flexDirection: "row",

      alignItems: "center",
    },

    locationToggleLabel: {
      fontSize: 12,

      color: "#1a73e8",

      fontWeight: "600",

      marginRight: 6,
    },

    input: {
      flexDirection: "row",

      alignItems: "center",

      borderWidth: 1,

      borderColor:
        "#dadce0",

      borderRadius: 10,

      paddingHorizontal: 12,

      paddingVertical: 10,

      backgroundColor:
        "#f8f9fa",

      minHeight: 48,
    },

    inputLocked: {
      backgroundColor:
        "#e8f0fe",

      borderColor:
        "#c2d5f2",
    },

    inputIcon: {
      fontSize: 18,

      marginRight: 10,
    },

    textInput: {
      flex: 1,

      fontSize: 15,

      color: "#202124",

      padding: 0,
    },

    lockedText: {
      flex: 1,

      fontSize: 14,

      color: "#1a73e8",

      fontWeight: "500",

      marginRight: 8,
    },

    divider: {
      height: 1,

      backgroundColor:
        "#f0f0f0",

      marginVertical: 14,
    },

    // ========================================================
    // SEARCH BUTTON
    // ========================================================

    searchButton: {
      backgroundColor:
        "#1e8e3e",

      paddingVertical: 16,

      borderRadius: 10,

      alignItems: "center",

      marginBottom: 16,

      elevation: 2,
    },

    searchButtonDisabled: {
      opacity: 0.7,
    },

    buttonRow: {
      flexDirection: "row",

      alignItems: "center",
    },

    searchText: {
      color: "#ffffff",

      fontSize: 16,

      fontWeight: "700",

      marginLeft: 8,
    },

    // ========================================================
    // HOW IT WORKS
    // ========================================================

    hintCard: {
      backgroundColor:
        "#ffffff",

      borderRadius: 14,

      padding: 16,

      marginBottom: 14,
    },

    hintTitle: {
      fontSize: 15,

      fontWeight: "700",

      color: "#202124",

      marginBottom: 8,
    },

    hintText: {
      fontSize: 13,

      color: "#5f6368",

      lineHeight: 20,
    },

    // ========================================================
    // INFO
    // ========================================================

    infoCard: {
      flexDirection: "row",

      backgroundColor:
        "#e6f4ea",

      borderRadius: 14,

      padding: 14,

      borderWidth: 1,

      borderColor:
        "#b7dfc0",
    },

    infoIcon: {
      fontSize: 22,

      marginRight: 10,
    },

    infoContent: {
      flex: 1,
    },

    infoTitle: {
      fontSize: 13,

      fontWeight: "800",

      color: "#176b2c",

      marginBottom: 3,
    },

    infoText: {
      fontSize: 11,

      lineHeight: 17,

      color: "#52745b",
    },
  });