import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@airroute_user_profile';

export const PROFILE_TYPES = [
  {
    key: 'normal',
    label: 'Normal',
    icon: '👤',
    description: 'Standard sensitivity thresholds',
  },
  {
    key: 'child',
    label: 'Child',
    icon: '🧒',
    description: 'Higher sensitivity (hotspot threshold: AQI > 150)',
  },
  {
    key: 'elderly',
    label: 'Elderly',
    icon: '👴',
    description: 'Higher sensitivity (hotspot threshold: AQI > 150)',
  },
  {
    key: 'asthma',
    label: 'Asthma / Respiratory',
    icon: '🫁',
    description: 'Highest sensitivity (hotspot threshold: AQI > 150)',
  },
  {
    key: 'pregnant',
    label: 'Pregnant',
    icon: '🤰',
    description: 'Elevated sensitivity (hotspot threshold: AQI > 175)',
  },
];

const UserProfileContext = createContext(null);

export function UserProfileProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setProfile(JSON.parse(stored));
      }
    } catch (err) {
      console.error('[UserProfileContext] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async (profileType) => {
    const profileInfo = PROFILE_TYPES.find((p) => p.key === profileType) || PROFILE_TYPES[0];
    const newProfile = {
      type: profileType,
      label: profileInfo.label,
      createdAt: new Date().toISOString(),
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
      setProfile(newProfile);
      return newProfile;
    } catch (err) {
      console.error('[UserProfileContext] Save error:', err);
      throw err;
    }
  };

  const clearProfile = async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      setProfile(null);
    } catch (err) {
      console.error('[UserProfileContext] Clear error:', err);
    }
  };

  return (
    <UserProfileContext.Provider
      value={{
        profile,
        loading,
        isOnboarded: !!profile,
        saveProfile,
        clearProfile,
        profileTypes: PROFILE_TYPES,
      }}
    >
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    throw new Error('useUserProfile must be used within UserProfileProvider');
  }
  return ctx;
}

export default UserProfileContext;
