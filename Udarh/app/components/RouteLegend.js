import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function RouteLegend() {
  return (
    <View style={styles.container}>
      <LegendItem color="#1e8e3e" label="Low" />
      <LegendItem color="#f9ab00" label="Moderate" />
      <LegendItem color="#d93025" label="High" />
    </View>
  );
}

function LegendItem({ color, label }) {
  return (
    <View style={styles.item}>
      <View
        style={[
          styles.dot,
          {
            backgroundColor: color,
          },
        ]}
      />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 15,
    left: 15,
    right: 15,

    flexDirection: "row",
    justifyContent: "space-around",

    backgroundColor: "#fff",

    borderRadius: 12,

    paddingVertical: 10,

    elevation: 5,

    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },

  item: {
    flexDirection: "row",
    alignItems: "center",
  },

  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },

  text: {
    fontSize: 12,
    fontWeight: "600",
    color: "#444",
  },
});