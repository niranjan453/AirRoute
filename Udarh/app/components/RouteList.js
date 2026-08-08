import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";

import RouteCard from "./RouteCard";

export default function RouteList({
  routes = [],
  selectedRoute,
  onSelectRoute,
  onViewDetails,
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.count}>
          {routes.length} route{routes.length !== 1 ? "s" : ""} found
        </Text>

        {selectedRoute?.isRecommended && (
          <View style={styles.recommendedBadge}>
            <Text style={styles.recommendedText}>
              ★ Recommended
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {routes.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            isSelected={selectedRoute?.id === route.id}
            onPress={() => onSelectRoute(route.id)}
          />
        ))}

        <TouchableOpacity
          style={styles.detailsButton}
          onPress={onViewDetails}
          disabled={!selectedRoute}
        >
          <Text style={styles.detailsText}>
            View Active Navigation →
          </Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,

    backgroundColor: "#fff",

    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,

    marginTop: -15,

    paddingHorizontal: 16,
    paddingTop: 15,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",

    marginBottom: 12,
  },

  count: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },

  recommendedBadge: {
    backgroundColor: "#E8F5E9",

    paddingHorizontal: 12,
    paddingVertical: 6,

    borderRadius: 20,
  },

  recommendedText: {
    color: "#1e8e3e",

    fontWeight: "700",

    fontSize: 12,
  },

  scrollContent: {
    paddingBottom: 20,
  },

  detailsButton: {
    backgroundColor: "#1A73E8",

    paddingVertical: 15,

    borderRadius: 10,

    alignItems: "center",

    marginTop: 8,
  },

  detailsText: {
    color: "#fff",

    fontWeight: "700",

    fontSize: 15,
  },
});