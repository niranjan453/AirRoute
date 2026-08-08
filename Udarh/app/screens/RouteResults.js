import React, { useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  View,
} from "react-native";

import RouteMap from "../components/RouteMap";
import RouteLegend from "../components/RouteLegend";
import RouteList from "../components/RouteList";
import AdvisoryModal from "../components/AdvisoryModal";

import useRouteMap from "../hooks/useRouteMap";

export default function RouteResults({ route, navigation }) {
  const routeResponse = route.params?.routeResponse;

  const routes = routeResponse?.routes || [];

  const [advisoryVisible, setAdvisoryVisible] = useState(false);

  const {
    selectedRoute,
    selectedRouteId,
    setSelectedRouteId,
  } = useRouteMap(routes);

  if (!routes.length) {
    return (
      <SafeAreaView style={styles.emptyContainer} />
    );
  }

  return (
    <SafeAreaView style={styles.container}>

      <View style={styles.mapContainer}>

        <RouteMap
          routes={routes}
          selectedRouteId={selectedRouteId}
        />

        <RouteLegend />

      </View>

      <RouteList
        routes={routes}
        selectedRoute={selectedRoute}
        onSelectRoute={setSelectedRouteId}
        onViewDetails={() =>
          navigation.navigate("RouteDetail", {
            route: selectedRoute,
            allRoutes: routes,
          })
        }
      />

      <AdvisoryModal
        visible={advisoryVisible}
        onClose={() => setAdvisoryVisible(false)}
        route={selectedRoute}
      />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  mapContainer: {
    height: "45%",
  },

  emptyContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
});