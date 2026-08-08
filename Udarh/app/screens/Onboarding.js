import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useUserProfile } from '../context/UserProfileContext';

export default function Onboarding({ navigation }) {
  const { profile, loading, saveProfile, profileTypes } = useUserProfile();
  const [selectedType, setSelectedType] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && profile) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    }
  }, [loading, profile, navigation]);

  const handleContinue = async () => {
    if (!selectedType) {
      Alert.alert('Select a profile', 'Please select a profile type to continue.');
      return;
    }
    setSaving(true);
    try {
      await saveProfile(selectedType);
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1a73e8" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <Text style={styles.logoText}>🌬️ AirRoute</Text>
          <Text style={styles.tagline}>Breathe Cleaner, Travel Smarter.</Text>
          <Text style={styles.description}>
            Get air-quality-aware routing. We score every available route by
            pollution exposure and recommend the cleanest option for your profile.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who will be traveling?</Text>
          <Text style={styles.sectionSubtitle}>
            We'll set air-quality sensitivity thresholds accordingly.
          </Text>

          {profileTypes.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.profileCard,
                selectedType === p.key && styles.profileCardSelected,
              ]}
              onPress={() => setSelectedType(p.key)}
              activeOpacity={0.8}
            >
              <View style={styles.profileIconWrap}>
                <Text style={styles.profileIcon}>{p.icon}</Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileLabel}>{p.label}</Text>
                <Text style={styles.profileDesc}>{p.description}</Text>
              </View>
              <View
                style={[
                  styles.radioCircle,
                  selectedType === p.key && styles.radioCircleSelected,
                ]}
              >
                {selectedType === p.key && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.bottomSection}>
          <TouchableOpacity
            style={[
              styles.continueButton,
              !selectedType && styles.continueButtonDisabled,
              saving && { opacity: 0.7 },
            ]}
            onPress={handleContinue}
            disabled={!selectedType || saving}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.continueText}>Continue →</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.privacyText}>
            Your profile stays on this device (AsyncStorage only — no backend storage for MVP).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    padding: 22,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  loadingText: {
    marginTop: 12,
    color: '#5f6368',
    fontSize: 14,
  },
  heroSection: {
    paddingTop: 30,
    paddingBottom: 20,
  },
  logoText: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1a73e8',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 20,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: '#5f6368',
    lineHeight: 22,
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#5f6368',
    marginBottom: 16,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  profileCardSelected: {
    backgroundColor: '#e8f0fe',
    borderColor: '#1a73e8',
  },
  profileIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  profileIcon: {
    fontSize: 26,
  },
  profileInfo: {
    flex: 1,
  },
  profileLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 2,
  },
  profileDesc: {
    fontSize: 12,
    color: '#5f6368',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#5f6368',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#1a73e8',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1a73e8',
  },
  bottomSection: {
    marginTop: 30,
  },
  continueButton: {
    backgroundColor: '#1a73e8',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: '#b4c7e8',
  },
  continueText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  privacyText: {
    marginTop: 14,
    fontSize: 11,
    color: '#9aa0a6',
    textAlign: 'center',
    lineHeight: 16,
  },
});
