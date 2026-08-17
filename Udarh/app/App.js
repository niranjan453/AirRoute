// App.js

import React from "react";

import {
  NavigationContainer,
} from "@react-navigation/native";

import {
  createNativeStackNavigator,
} from "@react-navigation/native-stack";

import {
  StatusBar,
} from "expo-status-bar";

import {
  SafeAreaProvider,
} from "react-native-safe-area-context";

import {
  UserProfileProvider,
} from "./context/UserProfileContext";

// ============================================================
// SCREENS
// ============================================================

import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";
import RouteResults from "./screens/RouteResults";
import RouteDetail from "./screens/RouteDetail";
import AirRoutePlus from "./screens/AirRoutePlus";

// ============================================================
// NAVIGATOR
// ============================================================

const Stack =
  createNativeStackNavigator();

// ============================================================
// APP
// ============================================================

export default function App() {
  return (
    <SafeAreaProvider>
      <UserProfileProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Onboarding"
            screenOptions={{
              headerStyle: {
                backgroundColor:
                  "#1a73e8",
              },

              headerTintColor:
                "#ffffff",

              headerTitleStyle: {
                fontWeight:
                  "bold",
              },
            }}
          >
            {/* ==================================================
                ONBOARDING
                ================================================== */}

            <Stack.Screen
              name="Onboarding"
              component={
                Onboarding
              }
              options={{
                headerShown:
                  false,
              }}
            />

            {/* ==================================================
                HOME
                ================================================== */}

            <Stack.Screen
              name="Home"
              component={Home}
              options={{
                title:
                  "AirRoute - Breathe Cleaner",
              }}
            />

            {/* ==================================================
                ROUTE RESULTS
                ================================================== */}

            <Stack.Screen
              name="RouteResults"
              component={
                RouteResults
              }
              options={{
                title:
                  "Available Routes",
              }}
            />

            {/* ==================================================
                ROUTE DETAIL
                ================================================== */}

            <Stack.Screen
              name="RouteDetail"
              component={
                RouteDetail
              }
              options={{
                title:
                  "Route Details",
              }}
            />

            {/* ==================================================
                AIRROUTE PLUS
                ================================================== */}

            <Stack.Screen
              name="AirRoutePlus"
              component={
                AirRoutePlus
              }
              options={{
                title:
                  "AirRoute Plus",
              }}
            />
          </Stack.Navigator>

          <StatusBar
            style="light"
          />
        </NavigationContainer>
      </UserProfileProvider>
    </SafeAreaProvider>
  );
}