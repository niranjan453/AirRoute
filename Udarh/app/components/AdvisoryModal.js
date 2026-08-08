import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import PropTypes from 'prop-types';

import api from '../services/api';
import { useUserProfile } from '../context/UserProfileContext';

export default function AdvisoryModal({ visible, onClose, route }) {
  const { profile } = useUserProfile();
  const [loading, setLoading] = useState(false);
  const [advisory, setAdvisory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible && route) {
      loadAdvisory();
    }
  }, [visible, route]);

  const loadAdvisory = async () => {
    setLoading(true);
    setError(null);
    try {
      const profileType = profile?.type || 'normal';
      const resp = await api.getAdvisory({
        routeId: route.id,
        profile: profileType,
        route,
      });
      setAdvisory(resp.advisory);
    } catch (err) {
      setError(err.message || 'Failed to load advisory');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Health Advisory</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body}>
            {loading && (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#1a73e8" />
                <Text style={styles.loadingText}>Generating personalized advisory...</Text>
              </View>
            )}

            {error && !loading && (
              <View style={styles.center}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={loadAdvisory}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
              </View>
            )}

            {advisory && !loading && (
              <View>
                {advisory.split('\n').map((line, idx) => {
                  if (line.trim() === '') {
                    return <View key={`sp-${idx}`} style={{ height: 8 }} />;
                  }
                  const isEmojiLine = /^[💡⚠📊]/.test(line.trim());
                  const isBullet = line.trim().startsWith('-') || line.trim().startsWith('   ');
                  return (
                    <Text
                      key={idx}
                      style={[
                        styles.line,
                        isEmojiLine && styles.emojiLine,
                        isBullet && styles.bulletLine,
                      ]}
                    >
                      {line}
                    </Text>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.confirmButton} onPress={onClose}>
              <Text style={styles.confirmText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

AdvisoryModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  route: PropTypes.object,
};

AdvisoryModal.defaultProps = {
  route: null,
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: 280,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#202124',
  },
  closeButton: {
    padding: 6,
    width: 36,
    alignItems: 'center',
  },
  closeText: {
    fontSize: 18,
    color: '#5f6368',
    fontWeight: '600',
  },
  body: {
    padding: 18,
    maxHeight: 420,
  },
  line: {
    fontSize: 15,
    color: '#202124',
    lineHeight: 22,
  },
  emojiLine: {
    fontWeight: '700',
    color: '#1a73e8',
    marginTop: 6,
  },
  bulletLine: {
    color: '#5f6368',
    fontSize: 13,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    color: '#5f6368',
    fontSize: 14,
  },
  errorText: {
    color: '#d93025',
    fontSize: 14,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#1a73e8',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    padding: 18,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  confirmButton: {
    backgroundColor: '#1a73e8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
