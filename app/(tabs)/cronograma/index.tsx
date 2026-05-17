import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useObras } from '@/src/data/ObrasContext';
import type { BottleneckSummary } from '@/src/data/serviceBlockers';
import { summarizeBottlenecks } from '@/src/data/serviceBlockers';
import type { ScheduleSummary } from '@/src/data/schedule';
import { summarizeSchedule } from '@/src/data/schedule';

export default function CronogramaScreen() {
  const { apartments, towers, refreshData } = useObras();
  const [bottleneckSummary, setBottleneckSummary] = useState<BottleneckSummary>({
    mostBlockedServices: [],
  });
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary>({
    delayedApartments: 0,
  });

  useFocusEffect(
    useCallback(() => {
      refreshData();
      setBottleneckSummary(summarizeBottlenecks(apartments));
      setScheduleSummary(
        summarizeSchedule(
          apartments,
          (towerId) => towers.find((t) => t.id === towerId)?.name ?? towerId,
        ),
      );
    }, [apartments, towers, refreshData]),
  );

  const hasIssues =
    bottleneckSummary.mostBlockedServices.length > 0 || scheduleSummary.delayedApartments > 0;

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

      {/* KPIs */}
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, {
          backgroundColor: bottleneckSummary.mostBlockedServices.length > 0 ? '#FEE2E2' : '#D1FAE5',
        }]}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={26}
            color={bottleneckSummary.mostBlockedServices.length > 0 ? '#B91C1C' : '#047857'}
          />
          <Text style={[styles.kpiValue, {
            color: bottleneckSummary.mostBlockedServices.length > 0 ? '#B91C1C' : '#047857',
          }]}>
            {bottleneckSummary.mostBlockedServices.length}
          </Text>
          <Text style={styles.kpiLabel}>serviços travados</Text>
        </View>
        <View style={[styles.kpiCard, {
          backgroundColor: scheduleSummary.delayedApartments > 0 ? '#FEF3C7' : '#D1FAE5',
        }]}>
          <MaterialCommunityIcons
            name={scheduleSummary.delayedApartments > 0 ? 'calendar-remove' : 'calendar-check'}
            size={26}
            color={scheduleSummary.delayedApartments > 0 ? '#B45309' : '#047857'}
          />
          <Text style={[styles.kpiValue, {
            color: scheduleSummary.delayedApartments > 0 ? '#B45309' : '#047857',
          }]}>
            {scheduleSummary.delayedApartments}
          </Text>
          <Text style={styles.kpiLabel}>apt. atrasados</Text>
        </View>
      </View>

      {/* All clear */}
      {!hasIssues && (
        <View style={[styles.card, styles.centeredCard]}>
          <MaterialCommunityIcons name="check-all" size={48} color="#047857" />
          <Text style={[styles.sectionTitle, { color: '#047857', textAlign: 'center' }]}>
            Obra sem gargalos
          </Text>
          <Text style={styles.emptyText}>
            Nenhum serviço travado nem atrasos detectados nos apartamentos.
          </Text>
        </View>
      )}

      {/* Main bottleneck */}
      {bottleneckSummary.mostPendingService && (
        <View style={[styles.card, styles.cardAccentRed]}>
          <Text style={styles.sectionTitle}>Principal pendência</Text>
          <View style={styles.mainBlocker}>
            <MaterialCommunityIcons name="alert-circle" size={32} color="#B91C1C" />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockerName}>{bottleneckSummary.mostPendingService.service}</Text>
              <Text style={styles.blockerMeta}>
                Afeta {bottleneckSummary.mostPendingService.affectedApartments} apartamento(s)
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Blocked services chart */}
      {bottleneckSummary.mostBlockedServices.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Serviços mais impactados</Text>
          <View style={styles.chartArea}>
            {bottleneckSummary.mostBlockedServices.map((s) => (
              <View key={s.service} style={styles.blockerRow}>
                <View style={styles.blockerRowHeader}>
                  <Text style={styles.blockerRowName} numberOfLines={1}>{s.service}</Text>
                  <View style={[styles.impactBadge, {
                    backgroundColor: s.occurrences > 5 ? '#FEE2E2' : '#FEF3C7',
                  }]}>
                    <Text style={[styles.impactText, {
                      color: s.occurrences > 5 ? '#B91C1C' : '#B45309',
                    }]}>
                      {s.occurrences > 5 ? 'ALTO' : 'MÉDIO'}
                    </Text>
                  </View>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, {
                    width: `${(s.affectedApartments / apartments.length) * 100}%`,
                    backgroundColor: s.occurrences > 5 ? '#B91C1C' : '#B45309',
                  }]} />
                </View>
                <Text style={styles.barMeta}>
                  {s.occurrences} ocorrência(s) · {s.affectedApartments} apt. afetados
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Schedule delays */}
      {scheduleSummary.delayedApartments > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Atrasos no cronograma</Text>
          <View style={styles.delayHighlight}>
            <MaterialCommunityIcons name="clock-alert-outline" size={28} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.delayText}>
                {scheduleSummary.delayedApartments} apartamento(s) com atrasos detectados.
              </Text>
              {scheduleSummary.mostDelayedService && (
                <Text style={styles.delayMeta}>
                  Maior atraso: {scheduleSummary.mostDelayedService.service}{' '}
                  ({scheduleSummary.mostDelayedService.delayDays}d)
                </Text>
              )}
            </View>
          </View>
          {scheduleSummary.mostDelayedTower && (
            <View style={styles.towerRow}>
              <MaterialCommunityIcons name="office-building-outline" size={18} color="#B45309" />
              <Text style={styles.towerText}>
                Torre mais impactada: {scheduleSummary.mostDelayedTower.towerName} (até{' '}
                {scheduleSummary.mostDelayedTower.delayDays}d)
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Action links */}
      <View style={styles.linksSection}>
        <Link href="/cronograma/diagnostico" asChild>
          <Pressable style={styles.linkButton}>
            <MaterialCommunityIcons name="stethoscope" size={20} color="#2563EB" />
            <Text style={styles.linkButtonText}>Diagnóstico completo do MVP</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2563EB" />
          </Pressable>
        </Link>
        <Link href="/cronograma/servicos-etapas" asChild>
          <Pressable style={styles.linkButton}>
            <MaterialCommunityIcons name="cog-outline" size={20} color="#2563EB" />
            <Text style={styles.linkButtonText}>Serviços e Etapas</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2563EB" />
          </Pressable>
        </Link>
        <Link href="/cronograma/medicoes" asChild>
          <Pressable style={styles.linkButton}>
            <MaterialCommunityIcons name="ruler" size={20} color="#2563EB" />
            <Text style={styles.linkButtonText}>Medições</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2563EB" />
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
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
    fontWeight: '600',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  cardAccentRed: {
    borderLeftWidth: 4,
    borderLeftColor: '#B91C1C',
  },
  centeredCard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  mainBlocker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 14,
  },
  blockerName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  blockerMeta: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  chartArea: {
    gap: 12,
  },
  blockerRow: {
    gap: 6,
  },
  blockerRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  blockerRowName: {
    color: '#0F172A',
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  impactBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  impactText: {
    fontSize: 10,
    fontWeight: '900',
  },
  barTrack: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  barMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  delayHighlight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 14,
  },
  delayText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  delayMeta: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  towerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  towerText: {
    color: '#B45309',
    fontSize: 13,
    fontWeight: '600',
  },
  linksSection: {
    gap: 8,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderColor: '#DBEAFE',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  linkButtonText: {
    flex: 1,
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '700',
  },
});
