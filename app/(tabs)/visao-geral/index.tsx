import { Link } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { Measurement } from '@/src/data/localMeasurements';
import { formatCurrency } from '@/src/data/localMeasurements';
import { useObras } from '@/src/data/ObrasContext';
import * as db from '@/src/data/db';
import { statusConfig } from '@/src/ui/status';
import { getChecklistForApartment } from '@/src/data/serviceBlockers';

export default function VisaoGeralScreen() {
  const { apartments, towers, refreshData } = useObras();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  useFocusEffect(
    useCallback(() => {
      refreshData();
      db.loadAllMeasurements().then(setMeasurements);
    }, [refreshData]),
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

  const completedAverage = Math.round(
    apartments.reduce((total, a) => total + a.progress, 0) / apartments.length,
  );

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

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
                <MaterialCommunityIcons name={icon} size={22} color={config.color} />
                <Text style={[styles.healthCount, { color: config.color }]}>{statusCounts[key]}</Text>
                <Text style={styles.healthLabel}>{config.label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Progress overview */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.sectionTitle}>Progresso geral</Text>
          <Text style={styles.progressPercent}>{completedAverage}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${completedAverage}%` }]} />
        </View>
        <Text style={styles.progressSub}>
          {Math.round(apartments.length * (completedAverage / 100))} de {apartments.length} apartamentos concluídos
        </Text>
      </View>

      {/* Towers */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Torres</Text>
        {towers.map((tower) => {
          const towerApartments = apartments.filter((a) => a.towerId === tower.id);
          const avg = Math.round(
            towerApartments.reduce((total, a) => total + a.progress, 0) / towerApartments.length,
          );
          const criticalCount = towerApartments.filter((a) => a.status === 'critical').length;

          return (
            <Link
              key={tower.id}
              href={{ pathname: '/visao-geral/[torreId]', params: { torreId: tower.id } }}
              asChild>
              <Pressable style={styles.towerCard}>
                <View style={styles.towerHeader}>
                  <View style={styles.towerLeft}>
                    <MaterialCommunityIcons name="office-building" size={22} color="#2563EB" />
                    <View>
                      <Text style={styles.towerName}>{tower.name}</Text>
                      <Text style={styles.towerMeta}>
                        {tower.block} · {tower.position}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.towerRight}>
                    <Text style={styles.towerCount}>{towerApartments.length}</Text>
                    <Text style={styles.towerCountLabel}>un.</Text>
                  </View>
                </View>
                {tower.description ? (
                  <Text style={styles.towerDescription} numberOfLines={2}>
                    {tower.description}
                  </Text>
                ) : null}
                <View style={styles.towerProgressTrack}>
                  <View style={[styles.towerProgressFill, { width: `${avg}%` }]} />
                </View>
                <View style={styles.towerFooter}>
                  <Text style={styles.towerProgressText}>{avg}% de avanço médio</Text>
                  {criticalCount > 0 && (
                    <View style={styles.criticalBadge}>
                      <Text style={styles.criticalBadgeText}>{criticalCount} crítico(s)</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </Link>
          );
        })}
      </View>

      {/* Recent measurements */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Atividade recente</Text>
          <Link href="/cronograma/medicoes" asChild>
            <Pressable>
              <Text style={styles.sectionLink}>Ver tudo →</Text>
            </Pressable>
          </Link>
        </View>
        <View style={styles.activityCard}>
          {measurements.slice(0, 4).length > 0 ? (
            measurements.slice(0, 4).map((m, index) => (
              <View key={m.id} style={[styles.activityItem, index > 0 && styles.activityItemBorder]}>
                <View style={styles.activityIcon}>
                  <MaterialCommunityIcons name="file-check" size={16} color="#3B82F6" />
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityTitle} numberOfLines={1}>{m.service}</Text>
                  <Text style={styles.activityMeta}>
                    {m.contractor} · {formatCurrency(m.totalValue)}
                  </Text>
                </View>
                <Text style={styles.activityStatus}>{m.status}</Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Nenhuma medição registrada</Text>
            </View>
          )}
        </View>
      </View>
      {/* Reports */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Relatórios</Text>
        <Link href="/visao-geral/relatorios/relatorio-geral" asChild>
          <Pressable style={styles.reportCard}>
            <MaterialCommunityIcons name="table-large" size={22} color="#2563EB" />
            <View style={styles.reportContent}>
              <Text style={styles.reportTitle}>Relatório Geral</Text>
              <Text style={styles.reportDesc}>Tabela completa de apartamentos, pendências, serviços travados, cronograma, medições e visitas.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
          </Pressable>
        </Link>
        <Link href="/visao-geral/relatorios/gerar-relatorio" asChild>
          <Pressable style={styles.reportCard}>
            <MaterialCommunityIcons name="file-export-outline" size={22} color="#059669" />
            <View style={styles.reportContent}>
              <Text style={styles.reportTitle}>Gerar Relatório</Text>
              <Text style={styles.reportDesc}>Escolha tipo, filtros e seções. Exporte em CSV, PDF ou texto para WhatsApp/e-mail.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 32,
    gap: 16,
    paddingTop: 12,
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLink: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
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
  towerCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  towerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  towerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  towerName: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
  },
  towerMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  towerRight: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  towerCount: {
    color: '#2563EB',
    fontSize: 18,
    fontWeight: '900',
  },
  towerCountLabel: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },
  towerDescription: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  towerProgressTrack: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    overflow: 'hidden',
  },
  towerProgressFill: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 999,
  },
  towerFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  towerProgressText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  criticalBadge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  criticalBadgeText: {
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '800',
  },
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  activityItemBorder: {
    borderTopColor: '#F1F5F9',
    borderTopWidth: 1,
  },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityContent: {
    flex: 1,
    gap: 2,
  },
  activityTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  activityMeta: {
    color: '#64748B',
    fontSize: 12,
  },
  activityStatus: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 80,
    textAlign: 'right',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportContent: {
    flex: 1,
    gap: 3,
  },
  reportTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  reportDesc: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
  },
});
