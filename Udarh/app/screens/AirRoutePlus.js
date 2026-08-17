// screens/AirRoutePlus.js

import React from "react";

import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";

export default function AirRoutePlus({
  navigation,
}) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* ==================================================
            AIRROUTE LOGO
            ================================================== */}

        <View style={styles.logoCard}>
          <Image
            source={require("../assets/airroute-logo.jpeg")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* ==================================================
            HERO
            ================================================== */}

        <View style={styles.heroCard}>
          <View style={styles.plusBadge}>
            <Text style={styles.plusBadgeText}>
              AIRROUTE PLUS
            </Text>
          </View>

          <Text style={styles.heroTitle}>
            🌿 Plan a healthier journey
          </Text>

          <Text style={styles.heroDescription}>
            Get a detailed journey plan with walking,
            bus and metro guidance designed around
            cleaner travel.
          </Text>
        </View>

        {/* ==================================================
            HEALTHIER JOURNEY
            ================================================== */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Healthier Journey
          </Text>

          <Text style={styles.cardSubtitle}>
            Example journey preview
          </Text>

          {/* WALK TO METRO */}

          <View style={styles.journeyRow}>
            <View
              style={[
                styles.iconCircle,
                styles.walkIcon,
              ]}
            >
              <Text style={styles.icon}>
                🚶
              </Text>
            </View>

            <View style={styles.journeyContent}>
              <Text style={styles.journeyTitle}>
                Walk to Metro Station
              </Text>

              <Text style={styles.journeyDetail}>
                650 m • 8 min
              </Text>

              <Text style={styles.journeyDescription}>
                Walk from your starting point to the
                nearest metro station.
              </Text>
            </View>
          </View>

          <View style={styles.connector} />

          {/* METRO */}

          <View style={styles.journeyRow}>
            <View
              style={[
                styles.iconCircle,
                styles.metroIcon,
              ]}
            >
              <Text style={styles.icon}>
                🚇
              </Text>
            </View>

            <View style={styles.journeyContent}>
              <Text style={styles.journeyTitle}>
                Yellow Line Metro
              </Text>

              <Text style={styles.journeyDetail}>
                New Delhi → Rajiv Chowk
              </Text>

              <Text style={styles.journeyDescription}>
                4 stops • approximately 9 min
              </Text>
            </View>
          </View>

          <View style={styles.connector} />

          {/* BUS */}

          <View style={styles.journeyRow}>
            <View
              style={[
                styles.iconCircle,
                styles.busIcon,
              ]}
            >
              <Text style={styles.icon}>
                🚌
              </Text>
            </View>

            <View style={styles.journeyContent}>
              <Text style={styles.journeyTitle}>
                Bus Alternative
              </Text>

              <Text style={styles.journeyDetail}>
                Route 540 • 5 stops
              </Text>

              <Text style={styles.journeyDescription}>
                Alternative public transport option
                for the same journey.
              </Text>
            </View>
          </View>

          <View style={styles.connector} />

          {/* FINAL WALK */}

          <View style={styles.journeyRow}>
            <View
              style={[
                styles.iconCircle,
                styles.walkIcon,
              ]}
            >
              <Text style={styles.icon}>
                🚶
              </Text>
            </View>

            <View style={styles.journeyContent}>
              <Text style={styles.journeyTitle}>
                Walk to Destination
              </Text>

              <Text style={styles.journeyDetail}>
                450 m • 6 min
              </Text>

              <Text style={styles.journeyDescription}>
                Complete the final part of your
                journey on foot.
              </Text>
            </View>
          </View>
        </View>

        {/* ==================================================
            JOURNEY SUMMARY
            ================================================== */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Journey Summary
          </Text>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                23 min
              </Text>

              <Text style={styles.summaryLabel}>
                Total time
              </Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                1.1 km
              </Text>

              <Text style={styles.summaryLabel}>
                Walking
              </Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                2
              </Text>

              <Text style={styles.summaryLabel}>
                Transit options
              </Text>
            </View>
          </View>
        </View>

        {/* ==================================================
            HEALTH BENEFIT
            ================================================== */}

        <View style={styles.healthCard}>
          <View style={styles.healthHeader}>
            <Text style={styles.healthIcon}>
              🌿
            </Text>

            <View style={styles.healthHeaderContent}>
              <Text style={styles.healthTitle}>
                Healthier Travel
              </Text>

              <Text style={styles.healthSubtitle}>
                Example benefit preview
              </Text>
            </View>
          </View>

          <View style={styles.exposureBox}>
            <Text style={styles.exposureValue}>
              32%
            </Text>

            <Text style={styles.exposureText}>
              lower estimated pollution exposure
            </Text>
          </View>

          <Text style={styles.healthDescription}>
            AirRoute Plus can help present journey
            options that balance walking and public
            transport while considering estimated
            pollution exposure.
          </Text>
        </View>

        {/* ==================================================
            BENEFITS
            ================================================== */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            AirRoute Plus Benefits
          </Text>

          {/* BENEFIT 1 */}

          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>
                ✓
              </Text>
            </View>

            <View style={styles.benefitContent}>
              <Text style={styles.benefitTitle}>
                Detailed Walking Guidance
              </Text>

              <Text style={styles.benefitDescription}>
                See how much you need to walk and
                how long each walking segment takes.
              </Text>
            </View>
          </View>

          {/* BENEFIT 2 */}

          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>
                ✓
              </Text>
            </View>

            <View style={styles.benefitContent}>
              <Text style={styles.benefitTitle}>
                Bus & Metro Guidance
              </Text>

              <Text style={styles.benefitDescription}>
                Understand which public transport
                option to use, where to board and
                where to get off.
              </Text>
            </View>
          </View>

          {/* BENEFIT 3 */}

          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>
                ✓
              </Text>
            </View>

            <View style={styles.benefitContent}>
              <Text style={styles.benefitTitle}>
                Cleaner Journey Comparison
              </Text>

              <Text style={styles.benefitDescription}>
                Compare journey time, walking distance
                and estimated pollution exposure.
              </Text>
            </View>
          </View>

          {/* BENEFIT 4 */}

          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>
                ✓
              </Text>
            </View>

            <View style={styles.benefitContent}>
              <Text style={styles.benefitTitle}>
                Health-focused Journey
              </Text>

              <Text style={styles.benefitDescription}>
                Get a journey summary focused on
                cleaner travel instead of travel
                time alone.
              </Text>
            </View>
          </View>
        </View>

        {/* ==================================================
            MVP NOTICE
            ================================================== */}

        <View style={styles.noticeCard}>
          <Text style={styles.noticeIcon}>
            ℹ️
          </Text>

          <Text style={styles.noticeText}>
            This is an AirRoute MVP preview.
            Walking, bus and metro details shown
            here are example data and are not live
            transit information.
          </Text>
        </View>

        {/* ==================================================
            BACK BUTTON
            ================================================== */}

        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.8}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>
            Continue with AirRoute
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },

  content: {
    padding: 18,
    paddingBottom: 40,
  },

  // ==========================================================
  // LOGO
  // ==========================================================

  logoCard: {
    backgroundColor: "#f8fafc",

    borderRadius: 18,

    alignItems: "center",
    justifyContent: "center",

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

  // ==========================================================
  // HERO
  // ==========================================================

  heroCard: {
    backgroundColor: "#1a73e8",

    borderRadius: 16,

    padding: 20,

    marginBottom: 16,
  },

  plusBadge: {
    alignSelf: "flex-start",

    backgroundColor:
      "rgba(255,255,255,0.18)",

    paddingHorizontal: 10,

    paddingVertical: 5,

    borderRadius: 20,

    marginBottom: 12,
  },

  plusBadgeText: {
    color: "#ffffff",

    fontSize: 10,

    fontWeight: "800",

    letterSpacing: 1,
  },

  heroTitle: {
    color: "#ffffff",

    fontSize: 24,

    fontWeight: "800",

    lineHeight: 31,

    marginBottom: 8,
  },

  heroDescription: {
    color: "rgba(255,255,255,0.92)",

    fontSize: 14,

    lineHeight: 21,
  },

  // ==========================================================
  // GENERAL CARD
  // ==========================================================

  card: {
    backgroundColor: "#28e892",

    borderRadius: 16,

    padding: 18,

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

  cardTitle: {
    fontSize: 18,

    fontWeight: "800",

    color: "#202124",
  },

  cardSubtitle: {
    marginTop: 4,

    marginBottom: 18,

    fontSize: 12,

    color: "#80868b",
  },

  // ==========================================================
  // JOURNEY
  // ==========================================================

  journeyRow: {
    flexDirection: "row",

    alignItems: "flex-start",
  },

  iconCircle: {
    width: 44,

    height: 44,

    borderRadius: 22,

    alignItems: "center",

    justifyContent: "center",

    marginRight: 12,
  },

  walkIcon: {
    backgroundColor: "#e6f4ea",
  },

  metroIcon: {
    backgroundColor: "#e8f0fe",
  },

  busIcon: {
    backgroundColor: "#fef7e0",
  },

  icon: {
    fontSize: 21,
  },

  journeyContent: {
    flex: 1,

    paddingTop: 1,
  },

  journeyTitle: {
    fontSize: 14,

    fontWeight: "800",

    color: "#202124",
  },

  journeyDetail: {
    marginTop: 3,

    fontSize: 13,

    fontWeight: "700",

    color: "#1a73e8",
  },

  journeyDescription: {
    marginTop: 3,

    fontSize: 11,

    lineHeight: 16,

    color: "#5f6368",
  },

  connector: {
    width: 2,

    height: 22,

    backgroundColor: "#dadce0",

    marginLeft: 21,

    marginVertical: 3,
  },

  // ==========================================================
  // SUMMARY
  // ==========================================================

  summaryGrid: {
    flexDirection: "row",

    justifyContent: "space-between",

    marginTop: 18,
  },

  summaryItem: {
    flex: 1,

    alignItems: "center",
  },

  summaryValue: {
    fontSize: 17,

    fontWeight: "800",

    color: "#1a73e8",
  },

  summaryLabel: {
    marginTop: 4,

    fontSize: 10,

    color: "#80868b",

    textAlign: "center",
  },

  // ==========================================================
  // HEALTH
  // ==========================================================

  healthCard: {
    backgroundColor: "#e6f4ea",

    borderRadius: 16,

    padding: 18,

    marginBottom: 16,

    borderWidth: 1,

    borderColor: "#b7dfc0",
  },

  healthHeader: {
    flexDirection: "row",

    alignItems: "center",

    marginBottom: 14,
  },

  healthIcon: {
    fontSize: 28,

    marginRight: 10,
  },

  healthHeaderContent: {
    flex: 1,
  },

  healthTitle: {
    fontSize: 17,

    fontWeight: "800",

    color: "#176b2c",
  },

  healthSubtitle: {
    marginTop: 2,

    fontSize: 11,

    color: "#52745b",
  },

  exposureBox: {
    backgroundColor: "#ffffff",

    borderRadius: 12,

    padding: 14,

    flexDirection: "row",

    alignItems: "center",

    marginBottom: 12,
  },

  exposureValue: {
    fontSize: 28,

    fontWeight: "900",

    color: "#1e8e3e",

    marginRight: 10,
  },

  exposureText: {
    flex: 1,

    fontSize: 12,

    fontWeight: "700",

    color: "#176b2c",

    lineHeight: 17,
  },

  healthDescription: {
    fontSize: 12,

    color: "#52745b",

    lineHeight: 18,
  },

  // ==========================================================
  // BENEFITS
  // ==========================================================

  benefitRow: {
    flexDirection: "row",

    alignItems: "flex-start",

    marginTop: 18,
  },

  checkCircle: {
    width: 26,

    height: 26,

    borderRadius: 13,

    backgroundColor: "#e6f4ea",

    alignItems: "center",

    justifyContent: "center",

    marginRight: 10,
  },

  checkText: {
    color: "#1e8e3e",

    fontSize: 15,

    fontWeight: "900",
  },

  benefitContent: {
    flex: 1,
  },

  benefitTitle: {
    fontSize: 13,

    fontWeight: "800",

    color: "#202124",
  },

  benefitDescription: {
    marginTop: 3,

    fontSize: 11,

    lineHeight: 17,

    color: "#5f6368",
  },

  // ==========================================================
  // NOTICE
  // ==========================================================

  noticeCard: {
    flexDirection: "row",

    alignItems: "flex-start",

    backgroundColor: "#fff8e1",

    borderRadius: 12,

    padding: 13,

    marginBottom: 16,

    borderWidth: 1,

    borderColor: "#f6df9b",
  },

  noticeIcon: {
    fontSize: 16,

    marginRight: 8,
  },

  noticeText: {
    flex: 1,

    fontSize: 11,

    lineHeight: 17,

    color: "#6b5b20",
  },

  // ==========================================================
  // BACK BUTTON
  // ==========================================================

  backButton: {
    backgroundColor: "#1a73e8",

    borderRadius: 12,

    paddingVertical: 15,

    alignItems: "center",
  },

  backButtonText: {
    color: "#ffffff",

    fontSize: 15,

    fontWeight: "800",
  },
});