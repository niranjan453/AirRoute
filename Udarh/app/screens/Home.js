import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import * as Location from 'expo-location';
import { useUserProfile } from '../context/UserProfileContext';
import api from '../services/api';

export default function Home({ navigation }) {
  const { profile, clearProfile } = useUserProfile();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [searching, setSearching] = useState(false);
  const [currentCoords, setCurrentCoords] = useState(null);

  useEffect(() => {
    if (useCurrentLocation) {
      fetchCurrentLocation();
    }
  }, [useCurrentLocation]);

  const fetchCurrentLocation = async () => {
    setLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setUseCurrentLocation(false);
        Alert.alert('Location permission denied', 'Please enter your origin address manually.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch (err) {
      console.error('Location error:', err);
      setUseCurrentLocation(false);
    } finally {
      setLoadingLocation(false);
    }
  };

  const handleSearch = async () => {
    if (!destination.trim()) {
      Alert.alert('Missing destination', 'Please enter a destination.');
      return;
    }
    if (!useCurrentLocation && !origin.trim()) {
      Alert.alert('Missing origin', 'Please enter your origin address.');
      return;
    }

    setSearching(true);
    try {
      const originVal = useCurrentLocation
        ? currentCoords
          ? `${currentCoords.lat},${currentCoords.lng}`
          : origin
        : origin;

      if (!originVal) {
        throw new Error('Origin not available. Try again.');
      }

      const resp = await api.getRoutes({
        origin: originVal,
        destination: destination.trim(),
        profile: profile?.type || 'normal',
      });

      console.log("========== ROUTE RESPONSE ==========");
      console.log(JSON.stringify(resp, null, 2));

      navigation.navigate('RouteResults', {
        routeResponse: resp,
        origin: originVal,
        destination: destination.trim(),
      });
    } catch (err) {
      Alert.alert('Search failed', err.message || 'Could not find routes.');
    } finally {
      setSearching(false);
    }
  };

  const changeProfile = () => {
    Alert.alert('Change profile?', 'This will clear your stored profile and return to onboarding.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, change',
        style: 'destructive',
        onPress: async () => {
          await clearProfile();
          navigation.reset({
            index: 0,
            routes: [{ name: 'Onboarding' }],
          });
        },
      },
    ]);
  };

  const currentLabel = profile?.type
    ? profile.label
    : 'Standard';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.profileBanner}>
            <View style={styles.profileInfo}>
              <Text style={styles.profileBadgeLabel}>Profile</Text>
              <Text style={styles.profileBadgeValue}>{currentLabel}</Text>
            </View>
            <TouchableOpacity onPress={changeProfile}>
              <Text style={styles.changeProfileText}>Change</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>🌿 Find the cleanest route</Text>
            <Text style={styles.heroSub}>
              AirRoute scores routes by pollution exposure, not just ETA. We'll surface the
              healthiest option for your profile.
            </Text>
          </View>

          <View style={styles.formCard}>
            <View style={styles.row}>
              <View style={styles.inputLabelRow}>
                <Text style={styles.inputLabel}>From</Text>
                <View style={styles.locationToggle}>
                  <Text style={styles.locationToggleLabel}>Use my location</Text>
                  <Switch
                    value={useCurrentLocation}
                    onValueChange={setUseCurrentLocation}
                    trackColor={{ true: '#1a73e8', false: '#dadce0' }}
                    thumbColor="#ffffff"
                  />
                </View>
              </View>
              {useCurrentLocation ? (
                <View style={[styles.input, styles.inputLocked]}>
                  <Text style={styles.inputIcon}>📍</Text>
                  <Text style={styles.lockedText} numberOfLines={1}>
                    {loadingLocation
                      ? 'Getting current location...'
                      : currentCoords
                        ? `Current location (${currentCoords.lat.toFixed(4)}, ${currentCoords.lng.toFixed(4)})`
                        : 'Tap to allow location access'}
                  </Text>
                  {loadingLocation && <ActivityIndicator size="small" color="#1a73e8" />}
                </View>
              ) : (
                <View style={styles.input}>
                  <Text style={styles.inputIcon}>📍</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter origin address or landmark"
                    value={origin}
                    onChangeText={setOrigin}
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                </View>
              )}
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <Text style={styles.inputLabel}>To</Text>
              <View style={styles.input}>
                <Text style={styles.inputIcon}>🎯</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Where are you going?"
                  value={destination}
                  onChangeText={setDestination}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.searchButton,
              (searching || loadingLocation) && { opacity: 0.7 },
            ]}
            onPress={handleSearch}
            disabled={searching || loadingLocation}
          >
            {searching ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator color="#ffffff" />
                <Text style={styles.searchText}>Finding clean routes...</Text>
              </View>
            ) : (
              <Text style={styles.searchText}>🔍 Find route</Text>
            )}
          </TouchableOpacity>

          <View style={styles.hintCard}>
            <Text style={styles.hintTitle}>💡 How it works</Text>
            <Text style={styles.hintText}>
              • We request alternative routes from OSRM{'\n'}
              • Each route is sampled every ~400m and AQI is looked up against a cached city grid{'\n'}
              • Routes are scored by dose-weighted AQI exposure, not just ETA{'\n'}
              • The lowest-exposure route is marked Recommended
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 40,
  },
  profileBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileBadgeLabel: {
    fontSize: 12,
    color: '#5f6368',
    marginRight: 8,
  },
  profileBadgeValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a73e8',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  changeProfileText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a73e8',
  },
  heroCard: {
    backgroundColor: '#1a73e8',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    lineHeight: 19,
  },
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  row: {
    marginBottom: 8,
  },
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5f6368',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  locationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationToggleLabel: {
    fontSize: 12,
    color: '#1a73e8',
    fontWeight: '600',
    marginRight: 6,
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8f9fa',
  },
  inputLocked: {
    backgroundColor: '#e8f0fe',
    borderColor: '#c2d5f2',
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: '#202124',
    padding: 0,
  },
  lockedText: {
    flex: 1,
    fontSize: 14,
    color: '#1a73e8',
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 14,
  },
  searchButton: {
    backgroundColor: '#1e8e3e',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  hintCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
  },
  hintTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 8,
  },
  hintText: {
    fontSize: 13,
    color: '#5f6368',
    lineHeight: 20,
  },
});
