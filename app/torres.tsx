import { Link } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Apartment, Tower } from '@/src/data/mockObras';
import { getConfiguredApartments, getConfiguredTowers } from '@/src/data/mockObras';

export default function TowersScreen() {
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);

  useFocusEffect(
    useCallback(() => {
      setApartments(getConfiguredApartments());
      setTowers(getConfiguredTowers());
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View>
        <Text style={styles.title}>Selecione a torre</Text>
        <Text style={styles.subtitle}>Escolha o setor da obra para visualizar apartamentos.</Text>
      </View>

      {towers.map((tower) => {
        const towerApartments = apartments.filter((apartment) => apartment.towerId === tower.id);
        const average = Math.round(
          towerApartments.reduce((total, apartment) => total + apartment.progress, 0) /
            towerApartments.length,
        );

        return (
          <Link
            key={tower.id}
            href={{ pathname: '/torres/[torreId]', params: { torreId: tower.id } }}
            asChild>
            <Pressable style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.towerName}>{tower.name}</Text>
                  <Text style={styles.towerMeta}>
                    {tower.block} / {tower.position}
                  </Text>
                </View>
                <View style={styles.counter}>
                  <Text style={styles.counterValue}>{towerApartments.length}</Text>
                  <Text style={styles.counterLabel}>un.</Text>
                </View>
              </View>
              <Text style={styles.description}>{tower.description}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${average}%` }]} />
              </View>
              <Text style={styles.progressText}>{average}% de avanço médio</Text>
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  towerName: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
  },
  towerMeta: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  counter: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    minWidth: 58,
    padding: 10,
  },
  counterValue: {
    color: '#1D4ED8',
    fontSize: 22,
    fontWeight: '900',
  },
  counterLabel: {
    color: '#64748B',
    fontSize: 12,
  },
  description: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 21,
  },
  progressTrack: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    height: 9,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#2563EB',
    height: '100%',
  },
  progressText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },
});
