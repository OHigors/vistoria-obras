import { Link } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { apartments, project, towers } from '@/src/data/mockObras';
import type { Measurement } from '@/src/data/localMeasurements';
import { formatCurrency, loadAllMeasurements } from '@/src/data/localMeasurements';
import type { ScheduleSummary } from '@/src/data/schedule';
import { summarizeSchedule } from '@/src/data/schedule';
import type { BottleneckSummary } from '@/src/data/serviceBlockers';
import { summarizeBottlenecks } from '@/src/data/serviceBlockers';
import { statusConfig } from '@/src/ui/status';

type TabName = 'overview' | 'financial' | 'schedule' | 'blockers';

interface StatCardProps {
  iconName: string;
  iconColor: string;
  label: string;
  value: string;
  trend?: string;
  trendColor?: string;
  backgroundColor?: string;
}

const StatCard = ({
  iconName,
  iconColor,
  label,
  value,
  trend,
  trendColor = '#10B981',
  backgroundColor = '#EFF6FF',
}: StatCardProps) => (
  <View style={[styles.statCard, { backgroundColor }]}>
    <View style={styles.statLeft}>
      <MaterialCommunityIcons name={iconName as any} size={28} color={iconColor} />
      <Text style={styles.statLabel}>{label}</Text>
    </View>
    <View style={styles.statRight}>
      <Text style={styles.statValue}>{value}</Text>
      {trend && <Text style={[styles.statTrend, { color: trendColor }]}>{trend}</Text>}
    </View>
  </View>
);

export default function DashboardScreen() {
  const [activeTab, setActiveTab] = useState<TabName>('overview');
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

  const excellentCount = apartments.filter((apartment) => apartment.status === 'excellent').length;
  const goodCount = apartments.filter((apartment) => apartment.status === 'good').length;
  const attentionCount = apartments.filter((apartment) => apartment.status === 'attention').length;
  const criticalCount = apartments.filter((apartment) => apartment.status === 'critical').length;

  const measurementSummary = useMemo(() => {
    const totalMeasured = measurements.reduce(
      (total, measurement) => total + measurement.totalValue,
      0,
    );
    const approvedTotal = measurements
      .filter((measurement) => measurement.status === 'Aprovado para pagamento')
      .reduce((total, measurement) => total + measurement.totalValue, 0);
    const retainedOrRejectedTotal = measurements
      .filter(
        (measurement) =>
          measurement.status === 'Retido' || measurement.status === 'Reprovado',
      )
      .reduce((total, measurement) => total + measurement.totalValue, 0);
    const contractorCounts = measurements.reduce<Record<string, number>>((counts, measurement) => {
      counts[measurement.contractor] = (counts[measurement.contractor] ?? 0) + 1;
      return counts;
    }, {});

    return {
      approvedTotal,
      approvalRate: totalMeasured > 0 ? Math.round((approvedTotal / totalMeasured) * 100) : 0,
      contractorCounts,
      retainedOrRejectedTotal,
      totalMeasured,
    };
  }, [measurements]);

  const tabs: Array<{ id: TabName; label: string; icon: string }> = [
    { id: 'overview', label: 'Visão Geral', icon: 'view-dashboard-outline' },
    { id: 'financial', label: 'Financeiro', icon: 'currency-usd' },
    { id: 'schedule', label: 'Cronograma', icon: 'calendar-month-outline' },
    { id: 'blockers', label: 'Gargalos', icon: 'alert-circle-outline' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable style={styles.headerIcon}>
            <MaterialCommunityIcons
              name="account-circle"
              size={64}
              color="#000000"
            />
          </Pressable>

          <Link href="/servicos-etapas" asChild>
            <Pressable style={styles.settingsButton}>
              <MaterialCommunityIcons
                name="cog-outline"
                size={24}
                color="#6B7280"
              />
            </Pressable>
          </Link>
        </View>

        <View style={styles.headerText}>
          <Text style={styles.headerSubtitle}>Bem-vindo,</Text>
          <Text style={styles.headerTitle}>{project.name}</Text>
        </View>
      </View>



      {/* Main Stats Grid - 2x2 */}
      <View style={styles.statsGrid}>
        <StatCard
          iconName="chart-line"
          iconColor="#3B82F6"
          label="Progresso"
          value={`${completedAverage}%`}
          trend={`${completedAverage}% concluído`}
          backgroundColor="#EFF6FF"
        />
        <StatCard
          iconName="city-variant-outline"
          iconColor="#10B981"
          label="Apartamentos"
          value={apartments.length.toString()}
          trend={`${towers.length} torres`}
          backgroundColor="#F0FDF4"
        />
        <StatCard
          iconName="file-document-multiple"
          iconColor="#F59E0B"
          label="Medições"
          value={measurements.length.toString()}
          trend={`${formatCurrency(measurementSummary.totalMeasured)}`}
          backgroundColor="#FEF3C7"
        />
        <StatCard
          iconName="alert-circle-outline"
          iconColor="#EF4444"
          label="Gargalos"
          value={bottleneckSummary.mostBlockedServices.length.toString()}
          trend={`${bottleneckSummary.mostBlockedServices.length} serviços`}
          backgroundColor="#FEE2E2"
        />
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabNav}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            style={[styles.tabButton, activeTab === tab.id && styles.tabButtonActive]}>
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={18}
              color={activeTab === tab.id ? '#3B82F6' : '#9CA3AF'}
            />
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <View style={styles.tabContent}>
          {/* Unit Health Status */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Saúde da obra</Text>
            <View style={styles.healthGrid}>
              {[
                { status: 'excellent', count: excellentCount, label: 'Excelente', icon: 'check-circle' },
                { status: 'good', count: goodCount, label: 'Bom', icon: 'thumb-up' },
                { status: 'attention', count: attentionCount, label: 'Atenção', icon: 'alert' },
                { status: 'critical', count: criticalCount, label: 'Crítico', icon: 'close-circle' },
              ].map(({ status, count, label, icon }) => {
                const config = statusConfig[status as keyof typeof statusConfig];
                return (
                  <Pressable
                    key={status}
                    style={[
                      styles.healthCard,
                      { borderColor: config.color, backgroundColor: config.background },
                    ]}>
                    <MaterialCommunityIcons name={icon as any} size={24} color={config.color} />
                    <Text style={[styles.healthCount, { color: config.color }]}>{count}</Text>
                    <Text style={styles.healthLabel}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Progress Overview */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Progresso do projeto</Text>
            <View style={styles.progressCard}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>Média geral</Text>
                <Text style={styles.progressPercent}>{completedAverage}%</Text>
              </View>
              <View style={styles.progressBarContainer}>
                <View
                  style={[
                    styles.progressBar,
                    { width: `${completedAverage}%` },
                  ]}
                />
              </View>
              <View style={styles.progressFooter}>
                <Text style={styles.progressFooterText}>
                  {Math.round(apartments.length * (completedAverage / 100))} de {apartments.length} apartamentos
                </Text>
              </View>
            </View>
          </View>

          {/* Recent Activity */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Atividade recente</Text>
              <Link href="/medicoes" asChild>
                <Pressable>
                  <Text style={styles.sectionLink}>Ver tudo →</Text>
                </Pressable>
              </Link>
            </View>
            {measurements.slice(0, 3).length > 0 ? (
              measurements.slice(0, 3).map((measurement, index) => (
                <View key={measurement.id} style={[styles.activityItem, index > 0 && styles.activityItemBorder]}>
                  <View style={[styles.activityIcon, { backgroundColor: '#DBEAFE' }]}>
                    <MaterialCommunityIcons name="file-check" size={18} color="#3B82F6" />
                  </View>
                  <View style={styles.activityContent}>
                    <Text style={styles.activityTitle}>{measurement.service}</Text>
                    <Text style={styles.activityMeta}>
                      {measurement.contractor} • {formatCurrency(measurement.totalValue)}
                    </Text>
                  </View>
                  <View style={[styles.activityStatus, { backgroundColor: '#DBEAFE' }]}>
                    <MaterialCommunityIcons
                      name={measurement.status === 'Aprovado para pagamento' ? 'check' : 'clock'}
                      size={16}
                      color="#3B82F6"
                    />
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Nenhuma medição registrada</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {activeTab === 'financial' && (
        <View style={styles.tabContent}>
          {/* Financial Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Resumo financeiro</Text>

            <View style={styles.financialCard}>
              <View style={styles.finRow}>
                <Text style={styles.finLabel}>Valor total medido</Text>
                <Text style={styles.finValue}>
                  {formatCurrency(measurementSummary.totalMeasured)}
                </Text>
              </View>
              <View style={styles.finDivider} />

              <View style={styles.finRow}>
                <View>
                  <Text style={styles.finLabel}>Aprovado para pagamento</Text>
                  <Text style={styles.finRate}>{measurementSummary.approvalRate}% aprovação</Text>
                </View>
                <Text style={[styles.finValue, { color: '#10B981' }]}>
                  {formatCurrency(measurementSummary.approvedTotal)}
                </Text>
              </View>
              <View style={styles.finDivider} />

              <View style={styles.finRow}>
                <Text style={styles.finLabel}>Retido/Reprovado</Text>
                <Text style={[styles.finValue, { color: '#EF4444' }]}>
                  {formatCurrency(measurementSummary.retainedOrRejectedTotal)}
                </Text>
              </View>
            </View>
          </View>

          {/* Contractors */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Empreiteiros</Text>
            {Object.entries(measurementSummary.contractorCounts).length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Nenhuma medição registrada</Text>
              </View>
            ) : (
              Object.entries(measurementSummary.contractorCounts).map(([contractor, count], index) => (
                <View
                  key={contractor}
                  style={[styles.contractorRow, index > 0 && styles.contractorRowBorder]}>
                  <View style={styles.contractorInfo}>
                    <Text style={styles.contractorName}>{contractor}</Text>
                    <Text style={styles.contractorCount}>{count} serviço(s)</Text>
                  </View>
                  <View style={styles.contractorBadge}>
                    <Text style={styles.contractorBadgeText}>{count}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <Link href="/medicoes" asChild>
            <Pressable style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Ver todas as medições</Text>
            </Pressable>
          </Link>
        </View>
      )}

      {activeTab === 'schedule' && (
        <View style={styles.tabContent}>
          {/* Schedule Status */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Status do cronograma</Text>

            <View style={styles.scheduleGrid}>
              <View style={[styles.scheduleCard, { borderLeftColor: '#3B82F6' }]}>
                <MaterialCommunityIcons name="calendar" size={24} color="#3B82F6" />
                <Text style={styles.scheduleLabel}>Apartamentos</Text>
                <Text style={styles.scheduleValue}>{scheduleSummary.delayedApartments}</Text>
                <Text style={styles.scheduleSubtext}>atrasados</Text>
              </View>

              {scheduleSummary.mostDelayedService && (
                <View style={[styles.scheduleCard, { borderLeftColor: '#F59E0B' }]}>
                  <MaterialCommunityIcons name="lightning-bolt" size={24} color="#F59E0B" />
                  <Text style={styles.scheduleLabel}>Serviço</Text>
                  <Text style={styles.scheduleValue}>{scheduleSummary.mostDelayedService.delayDays}d</Text>
                  <Text style={styles.scheduleSubtext} numberOfLines={1}>
                    {scheduleSummary.mostDelayedService.service}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Delay Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Principais atrasos</Text>
            {scheduleSummary.delayedApartments === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>✓ Cronograma dentro dos prazos</Text>
              </View>
            ) : (
              <View style={styles.alertCard}>
                <Text style={styles.alertTitle}>⚠ Atenção necessária</Text>
                <Text style={styles.alertDescription}>
                  {scheduleSummary.delayedApartments} apartamento(s) com atrasos detectados.
                  Revise os detalhes na seção de medições.
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {activeTab === 'blockers' && (
        <View style={styles.tabContent}>
          {/* Main Bottleneck */}
          {bottleneckSummary.mostPendingService && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Principal gargalo</Text>
              <View style={styles.bottleneckCard}>
                <MaterialCommunityIcons name="alert-circle" size={32} color="#DC2626" />
                <Text style={styles.bottleneckService}>
                  {bottleneckSummary.mostPendingService.service}
                </Text>
                <Text style={styles.bottleneckMeta}>
                  Afeta {bottleneckSummary.mostPendingService.affectedApartments} apartamento(s)
                </Text>
              </View>
            </View>
          )}

          {/* Blocked Services */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Serviços mais travados</Text>
            {bottleneckSummary.mostBlockedServices.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>✓ Nenhum serviço travado</Text>
              </View>
            ) : (
              bottleneckSummary.mostBlockedServices.map((blockedService, index) => (
                <View
                  key={blockedService.service}
                  style={[styles.blockedItem, index > 0 && styles.blockedItemBorder]}>
                  <View style={styles.blockedItemLeft}>
                    <Text style={styles.blockedServiceName}>{blockedService.service}</Text>
                    <Text style={styles.blockedServiceMeta}>
                      {blockedService.occurrences} ocorrência(s) em{' '}
                      {blockedService.affectedApartments} apt.
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.impactBadge,
                      {
                        backgroundColor:
                          blockedService.occurrences > 5 ? '#FEE2E2' : '#FEF3C7',
                      },
                    ]}>
                    <Text
                      style={{
                        color: blockedService.occurrences > 5 ? '#DC2626' : '#D97706',
                        fontWeight: '700',
                        fontSize: 11,
                      }}>
                      {blockedService.occurrences > 5 ? 'ALTO' : 'MÉDIO'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      )}

      {/* Footer Navigation */}
      <View style={styles.footerNav}>
        <Link href="/torres" asChild>
          <Pressable style={styles.footerLink}>
            <MaterialCommunityIcons name="office-building" size={24} color="#6B7280" />
            <Text style={styles.footerLinkText}>Torres</Text>
          </Pressable>
        </Link>
        <Link href="/diagnostico" asChild>
          <Pressable style={styles.footerLink}>
            <MaterialCommunityIcons name="stethoscope" size={24} color="#6B7280" />
            <Text style={styles.footerLinkText}>Diagnóstico</Text>
          </Pressable>
        </Link>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: '#e9e9e9',
    borderBottomColor: '#F3F4F6',
    borderBottomWidth: 1,
  },

  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  headerIcon: {
    marginBottom: 8,
  },

  headerText: {
    marginTop: 4,
  },

  settingsButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: '#F9FAFB',
  },

  headerSubtitle: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },

  headerTitle: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '800',
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 12,
    
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: 160,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',          
    justifyContent: 'space-between',

    alignItems: 'flex-start',
    gap: 12,
  },
  statLeft: {
  flex: 1,
  gap: 6,
},

statRight: {
  alignItems: 'flex-end',
  justifyContent: 'space-between',
},
  statLabel: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  statValue: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
  },
  statTrend: {
    fontSize: 11,
    fontWeight: '600',
  },
  tabNav: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    alignItems: 'center',      // ← adiciona
    gap: 4,                    // ← espaço entre ícone e texto
  },
  tabButtonActive: {
    backgroundColor: '#DBEAFE',
    borderColor: '#3B82F6',
  },
  tabLabel: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  tabLabelActive: {
    color: '#3B82F6',
  },
  tabContent: {
    paddingHorizontal: 12,
    gap: 16,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLink: {
    color: '#3B82F6',
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
    minWidth: 100,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    gap: 4,
  },
  healthCount: {
    fontSize: 24,
    fontWeight: '800',
  },
  healthLabel: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  progressPercent: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 999,
  },
  progressFooter: {
    alignItems: 'center',
  },
  progressFooterText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  activityItemBorder: {
    borderTopColor: '#F3F4F6',
    borderTopWidth: 1,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityContent: {
    flex: 1,
    gap: 2,
  },
  activityTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  activityMeta: {
    color: '#6B7280',
    fontSize: 12,
  },
  activityStatus: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityStatusText: {
    color: '#3B82F6',
    fontWeight: '700',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontStyle: 'italic',
  },
  financialCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 0,
  },
  finRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  finDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  finLabel: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  finValue: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  finRate: {
    color: '#3B82F6',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  contractorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
    borderColor: '#E5E7EB',
    borderWidth: 1,
  },
  contractorRowBorder: {
    borderTopColor: '#F3F4F6',
    borderTopWidth: 1,
  },
  contractorInfo: {
    flex: 1,
    gap: 2,
  },
  contractorName: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  contractorCount: {
    color: '#6B7280',
    fontSize: 12,
  },
  contractorBadge: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  contractorBadgeText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  scheduleGrid: {
    gap: 10,
  },
  scheduleCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderLeftWidth: 4,
    borderRightWidth: 1,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 4,
  },
  scheduleLabel: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  scheduleValue: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
  },
  scheduleSubtext: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  alertCard: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FBBF24',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  alertTitle: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '800',
  },
  alertDescription: {
    color: '#B45309',
    fontSize: 12,
    lineHeight: 18,
  },
  bottleneckCard: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 6,
    alignItems: 'center',
  },
  bottleneckService: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  bottleneckMeta: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
  },
  blockedItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
    borderColor: '#E5E7EB',
    borderWidth: 1,
  },
  blockedItemBorder: {
    borderTopColor: '#F3F4F6',
    borderTopWidth: 1,
  },
  blockedItemLeft: {
    flex: 1,
    gap: 2,
  },
  blockedServiceName: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  blockedServiceMeta: {
    color: '#6B7280',
    fontSize: 12,
  },
  impactBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  footerNav: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopColor: '#F3F4F6',
    borderTopWidth: 1,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 12,
    gap: 12,
    justifyContent: 'space-around',
  },
  footerLink: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
  },
  footerLinkText: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
  },
});
