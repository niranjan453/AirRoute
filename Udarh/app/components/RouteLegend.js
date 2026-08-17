// components/RouteLegend.js

import React from "react";

import {
  View,
  Text,
  StyleSheet,
} from "react-native";

// ============================================================
// COMPONENT
// ============================================================

export default function RouteLegend() {
  return (
    <View
      style={
        styles.container
      }
    >
      {/* ======================================================
          SELECTED ROUTE
          ====================================================== */}

      <LegendItem
        color="#1769AA"
        label="Selected"
      />

      {/* ======================================================
          RECOMMENDED ROUTE
          ====================================================== */}

      <LegendItem
        color="#34A853"
        label="Recommended"
      />

      {/* ======================================================
          OTHER ROUTES
          ====================================================== */}

      <LegendItem
        color="#AEB4BA"
        label="Other"
      />

      {/* ======================================================
          HOTSPOT
          ====================================================== */}

      <LegendItem
        color="#D93025"
        label="Hotspot"
        type="dot"
      />
    </View>
  );
}

// ============================================================
// LEGEND ITEM
// ============================================================

function LegendItem({
  color,
  label,
  type = "line",
}) {
  return (
    <View
      style={
        styles.item
      }
    >
      <View
        style={[
          type === "dot"
            ? styles.dot
            : styles.line,
          {
            backgroundColor:
              color,
          },
        ]}
      />

      <Text
        style={
          styles.text
        }
      >
        {label}
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
      position:
        "absolute",

      top: 15,

      left: 12,

      right: 12,

      flexDirection:
        "row",

      justifyContent:
        "space-around",

      alignItems:
        "center",

      backgroundColor:
        "rgba(255,255,255,0.96)",

      borderRadius: 12,

      paddingVertical:
        10,

      paddingHorizontal:
        8,

      elevation: 5,

      shadowColor:
        "#000",

      shadowOpacity:
        0.1,

      shadowRadius:
        4,

      shadowOffset: {
        width: 0,
        height: 2,
      },
    },

    item: {
      flexDirection:
        "row",

      alignItems:
        "center",

      marginHorizontal:
        3,
    },

    line: {
      width: 18,

      height: 4,

      borderRadius: 2,

      marginRight: 5,
    },

    dot: {
      width: 9,

      height: 9,

      borderRadius: 5,

      marginRight: 5,
    },

    text: {
      fontSize: 10,

      fontWeight:
        "700",

      color:
        "#444444",
    },
  });