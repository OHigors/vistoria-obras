import { useFocusEffect } from '@react-navigation/native';
import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Apartment, ApartmentStatus, ChecklistItem } from '@/src/data/mockObras';
import { getApartmentsByTower, getTowerById } from '@/src/data/mockObras';
import { summarizeApartmentSchedule } from '@/src/data/schedule';
import { getBlockedServiceGroups, getChecklistForApartment } from '@/src/data/serviceBlockers';
import { statusConfig } from '@/src/ui/status';

const viewModes = ['Lista detalhada', 'Mapa compacto'] as const;
const filterOptions = [
  'Todos',
  'Excelente',
  'Bom',
  'Atenção',
  'Crítico',
  'Com pendência',
  'Com atraso',
  'Travado',
] as const;

type ViewMode = (typeof viewModes)[number];
type FilterOption = (typeof filterOptions)[number];

type ApartmentSummary = {
  apartment: Apartment;
  blockedCount: number;
  checklist: ChecklistItem[];
  maxDelayDays: number;
  mostDelayedService?: string;
  pendingCount: number;
  progress: number;
  statusKey: ApartmentStatus;
};

const calculateProgress = (items: ChecklistItem[]) => {
  const score = items.reduce((total, item) => {
    if (item.state === 'ok' || item.state === 'notApplicable') {
      return total + 1;
    }

    if (item.state === 'partial') {
      return total + 0.5;
    }

    return total;
  }, 0);

  return items.length ? Math.round((score / items.length) * 100) : 0;
};

const calculateStatus = (items: ChecklistItem[], progress: number): ApartmentStatus => {
  const pendingCount = items.filter((item) => item.state === 'pending').length;
  const partialCount = items.filter((item) => item.state === 'partial').length;
  const manyPending = pendingCount >= Math.max(3, Math.ceil(items.length * 0.35));

  if (progress < 50 || manyPending) {
    return 'critical';
  }

  if ((progress >= 50 && progress <= 74) || partialCount > 0) {
    return 'attention';
  }

  if (progress >= 90 && pendingCount === 0) {
    return 'excellent';
  }

  return 'good';
};

const normalizeApartmentSearch = (value: string) =>
  value.toLocaleLowerCase('pt-BR').replace(/apartamento|ap|\s/g, '');

const getFloorOrder = (floor: string) => {
  const match = floor.match(/\d+/);
  return match ? Number(match[0]) : 0;
};

export default function TowerApartmentsScreen() {
  const { torreId } = useLocalSearchParams<{ torreId: string }>();
  const tower = getTowerById(torreId);
  const towerApartments = getApartmentsByTower(torreId);
  const [, setRefreshKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('Lista detalhada');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterOption>('Todos');

  useFocusEffect(
    useCallback(() => {
      setRefreshKey((currentKey) => currentKey + 1);
    }, []),
  );

  const apartmentSummaries: ApartmentSummary[] = towerApartments.map((apartment) => {
    const checklist = getChecklistForApartment(apartment);
    const pendingCount = checklist.filter(
      (item) => item.state === 'pending' || item.state === 'partial',
    ).length;
    const blockedCount = getBlockedServiceGroups(checklist).reduce(
      (total, group) => total + group.blockedServices.length,
      0,
    );
    const scheduleSummary = summarizeApartmentSchedule(apartment);
    const progress = calculateProgress(checklist);

    return {
      apartment,
      blockedCount,
      checklist,
      maxDelayDays: scheduleSummary.maxDelayDays,
      mostDelayedService: scheduleSummary.mostDelayedService,
      pendingCount,
      progress,
      statusKey: calculateStatus(checklist, progress),
    };
  });

  const filteredSummaries = apartmentSummaries.filter((summary) => {
    const normalizedSearch = normalizeApartmentSearch(search);
    const matchesSearch =
      !normalizedSearch || summary.apartment.number.includes(normalizedSearch);
    const statusLabel = statusConfig[summary.statusKey].label;
    const matchesFilter =
      filter === 'Todos' ||
      statusLabel === filter ||
      (filter === 'Com pendência' && summary.pendingCount > 0) ||
      (filter === 'Com atraso' && summary.maxDelayDays > 0) ||
      (filter === 'Travado' && summary.blockedCount > 0);

    return matchesSearch && matchesFilter;
  });

  const summariesByFloor = filteredSummaries.reduce<Record<string, ApartmentSummary[]>>(
    (groups, summary) => {
      groups[summary.apartment.floor] = [...(groups[summary.apartment.floor] ?? []), summary];
      return groups;
    },
    {},
  );
  const orderedFloors = Object.keys(summariesByFloor).sort(
    (a, b) => getFloorOrder(b) - getFloorOrder(a),
  );

  if (!tower) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Torre não encontrada</Text>
        <Link href="/" asChild>
          <Pressable style={styles.homeButton}>
            <Text style={styles.homeButtonText}>Voltar para início</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{tower.name}</Text>
        <Text style={styles.subtitle}>
          {tower.block} / {tower.position}
        </Text>
      </View>

      <View style={styles.controlsPanel}>
        <TextInput
          onChangeText={setSearch}
          placeholder="Pesquisar apartamento"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
          value={search}
        />

        <View style={styles.optionRow}>
          {viewModes.map((mode) => {
            const isSelected = viewMode === mode;

            return (
              <Pressable
                key={mode}
                onPress={() => setViewMode(mode)}
                style={[styles.optionButton, isSelected && styles.optionButtonSelected]}>
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {mode}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.optionRow}>
          {filterOptions.map((option) => {
            const isSelected = filter === option;

            return (
              <Pressable
                key={option}
                onPress={() => setFilter(option)}
                style={[styles.filterButton, isSelected && styles.optionButtonSelected]}>
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {filteredSummaries.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyPanelText}>
            Nenhum apartamento encontrado com os filtros aplicados.
          </Text>
        </View>
      ) : viewMode === 'Lista detalhada' ? (
        <View style={styles.grid}>
          {filteredSummaries.map((summary) => {
            const status = statusConfig[summary.statusKey];
            const { apartment } = summary;

            return (
              <Link
                key={apartment.id}
                href={{
                  pathname: '/apartamentos/[apartamentoId]',
                  params: { apartamentoId: apartment.id },
                }}
                asChild>
                <Pressable style={StyleSheet.flatten([styles.card, { borderColor: status.border }])}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.apartmentNumber}>Apartamento {apartment.number}</Text>
                      <Text style={styles.floor}>{apartment.floor}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: status.background }]}>
                      <Text style={[styles.badgeText, { color: status.color }]}>
                        {status.label}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { backgroundColor: status.color, width: `${summary.progress}%` },
                      ]}
                    />
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.progressText}>{summary.progress}% vistoriado</Text>
                    <Text style={styles.openText}>Abrir</Text>
                  </View>

                  <View style={styles.cardMetrics}>
                    <Text style={styles.metricText}>{summary.pendingCount} pendência(s)</Text>
                    <Text style={styles.metricText}>
                      {summary.blockedCount} serviço(s) travado(s)
                    </Text>
                    <Text style={styles.metricText}>
                      {summary.maxDelayDays} dia(s) de atraso
                    </Text>
                    <Text style={styles.metricText}>
                      Mais atrasado: {summary.mostDelayedService ?? 'nenhum'}
                    </Text>
                    <Text style={styles.metricText}>Status geral: {status.label}</Text>
                  </View>
                </Pressable>
              </Link>
            );
          })}
        </View>
      ) : (
        <View style={styles.mapPanel}>
          <View style={styles.legendRow}>
            <Text style={styles.legendItem}>Verde = Excelente</Text>
            <Text style={styles.legendItem}>Azul = Bom</Text>
            <Text style={styles.legendItem}>Amarelo = Atenção</Text>
            <Text style={styles.legendItem}>Vermelho = Crítico</Text>
            <Text style={styles.legendItem}>Cinza = Sem dados</Text>
          </View>

          {orderedFloors.map((floor) => (
            <View key={floor} style={styles.floorGroup}>
              <Text style={styles.floorTitle}>{floor}</Text>
              <View style={styles.compactGrid}>
                {summariesByFloor[floor].map((summary) => {
                  const status = statusConfig[summary.statusKey];

                  return (
                    <Link
                      key={`compact-${summary.apartment.id}`}
                      href={{
                        pathname: '/apartamentos/[apartamentoId]',
                        params: { apartamentoId: summary.apartment.id },
                      }}
                      asChild>
                      <Pressable
                        style={StyleSheet.flatten([
                          styles.compactUnit,
                          { backgroundColor: status.background, borderColor: status.color },
                        ])}>
                        <Text style={[styles.compactUnitNumber, { color: status.color }]}>
                          {summary.apartment.number}
                        </Text>
                        <Text style={[styles.compactUnitProgress, { color: status.color }]}>
                          {summary.progress}%
                        </Text>
                      </Pressable>
                    </Link>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  controlsPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  searchInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    borderColor: '#CBD5E1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterButton: {
    borderColor: '#CBD5E1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  optionButtonSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  optionText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  optionTextSelected: {
    color: '#2563EB',
  },
  grid: {
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  apartmentNumber: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
  },
  floor: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '900',
  },
  progressTrack: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  openText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  cardMetrics: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 10,
  },
  metricText: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 999,
    borderWidth: 1,
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  mapPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: 14,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
  },
  floorGroup: {
    gap: 8,
  },
  floorTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
  },
  compactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactUnit: {
    alignItems: 'center',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 64,
    padding: 6,
  },
  compactUnitNumber: {
    fontSize: 13,
    fontWeight: '900',
  },
  compactUnitProgress: {
    fontSize: 10,
    fontWeight: '900',
    marginTop: 2,
  },
  emptyPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  emptyPanelText: {
    color: '#64748B',
    fontSize: 14,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
  },
  homeButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  homeButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
