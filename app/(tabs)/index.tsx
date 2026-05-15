import { Link } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { apartments, project, towers } from '@/src/data/mockObras';
import type { Measurement } from '@/src/data/localMeasurements';
import { formatCurrency, loadAllMeasurements } from '@/src/data/localMeasurements';
import type { BottleneckSummary } from '@/src/data/serviceBlockers';
import { summarizeBottlenecks } from '@/src/data/serviceBlockers';
import type { ScheduleSummary } from '@/src/data/schedule';
import { summarizeSchedule } from '@/src/data/schedule';
import { statusConfig } from '@/src/ui/status';

export default function DashboardScreen() {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [bottleneckSummary, setBottleneckSummary] = useState<BottleneckSummary>({
    mostBlockedServices: [],
  });
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary>({
    delayedApartments: 0,
  });

  useFocusEffect(
    useCallback(() => {
      setMeasurements(loadAllMeasurements(apartments.map((apartment) => apartment.id)));
      setBottleneckSummary(summarizeBottlenecks(apartments));
      setScheduleSummary(
        summarizeSchedule(
          apartments,
          (towerId) => towers.find((tower) => tower.id === towerId)?.name ?? towerId,
        ),
      );
    }, []),
  );

  const completedAverage = Math.round(
    apartments.reduce((total, apartment) => total + apartment.progress, 0) / apartments.length,
  );

  const measurementTotal = useMemo(
    () => measurements.reduce((total, m) => total + m.totalValue, 0),
    [measurements],
  );

  const statusCounts = useMemo(
    () => ({
      excellent: apartments.filter((a) => a.status === 'excellent').length,
      good: apartments.filter((a) => a.status === 'good').length,
      attention: apartments.filter((a) => a.status === 'attention').length,
      critical: apartments.filter((a) => a.status === 'critical').length,
    }),
    [],
  );

  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {/* Left: user icon stacked above text */}
          <View style={styles.headerLeft}>
            <Pressable style={styles.userButton}>
              <MaterialCommunityIcons name="account-circle-outline" size={36} color="#64748B" />
            </Pressable>
            <Text style={styles.headerSub}>Bem-vindo,</Text>
            <Text style={styles.headerTitle}>{project.name}</Text>
          </View>

          {/* Right: settings gear aligned to top */}
          <Link href="/cronograma/servicos-etapas" asChild>
            <Pressable style={styles.settingsButton}>
              <MaterialCommunityIcons name="cog-outline" size={22} color="#64748B" />
            </Pressable>
          </Link>
        </View>
      </View>

      {/* KPI Grid */}
      <View style={styles.kpiGrid}>
        <View style={[styles.kpiCard, { backgroundColor: '#EFF6FF' }]}>
          <MaterialCommunityIcons name="chart-line" size={26} color="#3B82F6" />
          <Text style={[styles.kpiValue, { color: '#1D4ED8' }]}>{completedAverage}%</Text>
          <Text style={styles.kpiLabel}>Progresso</Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: '#F0FDF4' }]}>
          <MaterialCommunityIcons name="city-variant-outline" size={26} color="#10B981" />
          <Text style={[styles.kpiValue, { color: '#059669' }]}>{apartments.length}</Text>
          <Text style={styles.kpiLabel}>Apartamentos</Text>
          <Text style={styles.progressSub}>
            {towers.length} torre(s)
          </Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: '#FEF3C7' }]}>
          <MaterialCommunityIcons name="file-document-multiple" size={26} color="#F59E0B" />
          <Text style={[styles.kpiValue, { color: '#D97706' }]}>{measurements.length}</Text>
          <Text style={styles.kpiLabel}>Medições</Text>
          {measurementTotal > 0 && (
            <Text style={styles.kpiSub}>{formatCurrency(measurementTotal)}</Text>
          )}
        </View>
        <View style={[styles.kpiCard, { backgroundColor: bottleneckSummary.mostBlockedServices.length > 0 ? '#FEE2E2' : '#F0FDF4' }]}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={26}
            color={bottleneckSummary.mostBlockedServices.length > 0 ? '#EF4444' : '#10B981'}
          />
          <Text style={[styles.kpiValue, { color: bottleneckSummary.mostBlockedServices.length > 0 ? '#DC2626' : '#059669' }]}>
            {bottleneckSummary.mostBlockedServices.length}
          </Text>
          <Text style={styles.kpiLabel}>Gargalos</Text>
        </View>
      </View>

      {/* Progress bar */}
      {/* <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.sectionTitle}>Progresso do projeto</Text>
          <Text style={styles.progressPercent}>{completedAverage}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${completedAverage}%` }]} />
        </View>
        <Text style={styles.progressSub}>
          {towers.length} torre(s) · {apartments.length} apartamento(s)
        </Text>
      </View> */}

      {/* Status health grid */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Saúde da obra</Text>
        <View style={styles.healthGrid}>
          {(
            [
              { key: 'excellent', icon: 'check-circle' },
              { key: 'good', icon: 'thumb-up' },
              { key: 'attention', icon: 'alert' },
              { key: 'critical', icon: 'close-circle' },
            ] as const
          ).map(({ key, icon }) => {
            const config = statusConfig[key];
            return (
              <View
                key={key}
                style={[styles.healthCard, { borderColor: config.color, backgroundColor: config.background }]}>
                <MaterialCommunityIcons name={icon} size={20} color={config.color} />
                <Text style={[styles.healthCount, { color: config.color }]}>{statusCounts[key]}</Text>
                <Text style={styles.healthLabel}>{config.label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Schedule & blockers summary */}
      {(scheduleSummary.delayedApartments > 0 || bottleneckSummary.mostPendingService) && (
        <View style={styles.alertSection}>
          {scheduleSummary.delayedApartments > 0 && (
            <View style={styles.alertRow}>
              <MaterialCommunityIcons name="clock-alert-outline" size={18} color="#B45309" />
              <Text style={styles.alertText}>
                {scheduleSummary.delayedApartments} apt. com atraso no cronograma
              </Text>
            </View>
          )}
          {bottleneckSummary.mostPendingService && (
            <View style={styles.alertRow}>
              <MaterialCommunityIcons name="alert-circle" size={18} color="#B91C1C" />
              <Text style={styles.alertText}>
                Gargalo: {bottleneckSummary.mostPendingService.service} ({bottleneckSummary.mostPendingService.affectedApartments} apt.)
              </Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    backgroundColor: '#F8FAFC',
  },
  container: {
    paddingBottom: 32,
    gap: 16,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    flex: 1,
  },
  userButton: {
    padding: 0,
    marginBottom: 4,
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '900',
  },
  settingsButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    minWidth: 140,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  kpiValue: {
    fontSize: 28,
    fontWeight: '900',
  },
  kpiLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  kpiSub: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '600',
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    gap: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPercent: {
    color: '#2563EB',
    fontSize: 20,
    fontWeight: '900',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 999,
  },
  progressSub: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 16,
    gap: 10,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  healthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  healthCard: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 4,
  },
  healthCount: {
    fontSize: 22,
    fontWeight: '900',
  },
  healthLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  alertSection: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 16,
    padding: 14,
    gap: 10,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertText: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});