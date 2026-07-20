import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/src/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import * as db from '@/src/data/db';
import { useObras } from '@/src/data/ObrasContext';
import { summarizeSchedule, summarizeScheduleBoard } from '@/src/data/schedule';
import { ReadOnlyBanner } from '@/src/ui/ReadOnlyBanner';
import { Skeleton } from '@/src/ui/Skeleton';
import { useTutorialAnchor, useTutorialScreen } from '@/src/features/tutorial/TutorialContext';

// Teal é a cor do cronograma no restante do app; aqui ela sai da borda e vira o
// fundo do card principal — é o único elemento colorido da tela, e é o que põe
// "Cronograma da Obra" em evidência sem precisar competir com os indicadores.
const TEAL = '#0D9488';
const TEAL_DEEP = '#0F766E';

export default function CronogramaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { apartments, towers, loading, canWrite } = useObras();

  // LAZY: o contexto não traz mais o checklist — carrega ao focar a aba (os resumos
  // abaixo varrem os itens de todos os apartamentos).
  const [checklistByApt, setChecklistByApt] = useState<Awaited<ReturnType<typeof db.loadAllChecklistItems>>>(new Map());
  // Os indicadores dependem do checklist, não só do contexto. Sem este estado a
  // tela mostrava "0 atrasados" como se fosse resultado, e só depois pulava para
  // o número real — o skeleton precisa cobrir a espera que existe de fato.
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      db.loadAllChecklistItems()
        .then((m) => {
          if (!alive) return;
          setChecklistByApt(m);
          setLoadingSchedule(false);
        })
        .catch(() => alive && setLoadingSchedule(false));
      return () => { alive = false; };
    }, []),
  );
  const apartmentsFull = useMemo(
    () => apartments.map((a) => ({ ...a, checklist: checklistByApt.get(a.id) ?? [] })),
    [apartments, checklistByApt],
  );

  const board = useMemo(() => summarizeScheduleBoard(apartmentsFull), [apartmentsFull]);
  const scheduleSummary = useMemo(
    () => summarizeSchedule(apartmentsFull, (id) => towers.find((t) => t.id === id)?.name ?? id),
    [apartmentsFull, towers],
  );

  const busy = loading || loadingSchedule;
  const hasDelays = board.delayedApartments > 0;

  // Tutorial: coach marks da primeira visita à aba Cronograma.
  useTutorialScreen('cronograma', !busy);
  const heroAnchor = useTutorialAnchor('cron.hero');
  const kpisAnchor = useTutorialAnchor('cron.kpis');
  // A mesma âncora vale para o card da principal etapa e para o estado vazio —
  // só um dos dois está montado por vez.
  const topStepAnchor = useTutorialAnchor('cron.topstep');

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.container, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}>

      {!canWrite && <ReadOnlyBanner style={s.readOnly} />}

      {/* CRONOGRAMA DA OBRA — o destino principal da aba, em fundo teal */}
      <Pressable
        {...heroAnchor}
        onPress={() => router.push('/cronograma/obra' as any)}
        accessibilityRole="button"
        accessibilityLabel="Abrir o Cronograma da Obra"
        style={({ pressed }) => [s.hero, pressed && s.heroPressed]}>
        <View style={s.heroIcon}>
          <MaterialCommunityIcons name="chart-gantt" size={26} color="#FFFFFF" />
        </View>
        <View style={s.heroText}>
          <Text style={s.heroTitle}>Cronograma da Obra</Text>
          <Text style={s.heroSub}>Planejado × Executado por frente e pavimento</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color="rgba(255,255,255,0.85)" />
      </Pressable>

      {/* INDICADORES DO CRONOGRAMA */}
      {busy ? (
        <View style={s.kpiRow}>
          <Skeleton height={104} radius={14} style={{ flex: 1 }} />
          <Skeleton height={104} radius={14} style={{ flex: 1 }} />
        </View>
      ) : (
        <View style={s.kpiRow} {...kpisAnchor}>
          <View style={s.kpiCard}>
            <MaterialCommunityIcons
              name={hasDelays ? 'calendar-remove' : 'calendar-check'}
              size={26}
              color={hasDelays ? '#B45309' : '#047857'}
            />
            <Text style={[s.kpiValue, { color: hasDelays ? '#B45309' : '#047857' }]}>
              {board.delayedApartments}
            </Text>
            <Text style={s.kpiLabel}>Apt. atrasados</Text>
          </View>
          <View style={s.kpiCard}>
            <MaterialCommunityIcons name="calendar-clock" size={26} color="#334155" />
            <Text style={[s.kpiValue, { color: '#334155' }]}>{board.pendingSteps}</Text>
            <Text style={s.kpiLabel}>Etapas pendentes</Text>
          </View>
        </View>
      )}

      {/* PRINCIPAL ETAPA DO CRONOGRAMA */}
      {busy ? (
        <Skeleton height={116} radius={16} />
      ) : board.topStep ? (
        <View style={s.section} {...topStepAnchor}>
          <Text style={s.sectionTitle}>Principal etapa do Cronograma</Text>
          <View style={s.topStepRow}>
            <View style={s.topStepIcon}>
              <MaterialCommunityIcons name="calendar-star" size={24} color={TEAL_DEEP} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.topStepName}>{board.topStep.service}</Text>
              <Text style={s.topStepMeta}>
                Planejada em {board.topStep.apartments} apartamento(s)
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={[s.section, s.sectionCentered]} {...topStepAnchor}>
          <MaterialCommunityIcons name="calendar-blank-outline" size={40} color="#CBD5E1" />
          <Text style={s.emptyTitle}>Nenhuma etapa planejada</Text>
          <Text style={s.emptySub}>
            Abra o Cronograma da Obra e defina as datas das etapas para acompanhar prazos aqui.
          </Text>
        </View>
      )}

      {/* ATRASOS */}
      {busy ? (
        <Skeleton height={100} radius={16} />
      ) : hasDelays ? (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Atrasos no cronograma</Text>
          <View style={s.delayRow}>
            <MaterialCommunityIcons name="clock-alert-outline" size={24} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={s.delayText}>
                {board.delayedApartments} apartamento(s) com etapas fora do prazo
              </Text>
              {scheduleSummary.mostDelayedService && (
                <Text style={s.delayMeta}>
                  Maior atraso: {scheduleSummary.mostDelayedService.service} ({scheduleSummary.mostDelayedService.delayDays}d)
                </Text>
              )}
            </View>
          </View>
          {scheduleSummary.mostDelayedTower && (
            <View style={s.delayTowerRow}>
              <MaterialCommunityIcons name="office-building-outline" size={15} color="#B45309" />
              <Text style={s.delayTowerText}>
                Torre mais impactada: {scheduleSummary.mostDelayedTower.towerName} (até {scheduleSummary.mostDelayedTower.delayDays}d)
              </Text>
            </View>
          )}
        </View>
      ) : board.scheduledSteps > 0 ? (
        <View style={[s.section, s.sectionCentered]}>
          <MaterialCommunityIcons name="check-all" size={40} color="#047857" />
          <Text style={s.allClearTitle}>Cronograma em dia</Text>
          <Text style={s.emptySub}>Nenhuma etapa planejada passou do prazo.</Text>
        </View>
      ) : null}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { backgroundColor: '#F8FAFC' },
  container: { gap: 12, paddingBottom: 40, paddingHorizontal: 16 },

  // o container já aplica padding/gap; o banner não precisa das margens próprias
  readOnly: { marginHorizontal: 0, marginTop: 0 },

  // hero — Cronograma da Obra
  hero: {
    backgroundColor: TEAL,
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroPressed: { backgroundColor: TEAL_DEEP },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: { flex: 1, gap: 3 },
  heroTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, lineHeight: 17 },

  // kpi
  kpiRow: { flexDirection: 'row', gap: 12 },
  kpiCard: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  kpiValue: { fontSize: 32, fontWeight: '900' },
  kpiLabel: { color: '#475569', fontSize: 12, fontWeight: '600', textAlign: 'center' },

  // section containers
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  sectionCentered: { alignItems: 'center', paddingVertical: 26, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: '#0F172A' },

  // principal etapa
  topStepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F0FDFA', borderRadius: 10, padding: 12 },
  topStepIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#CCFBF1', alignItems: 'center', justifyContent: 'center' },
  topStepName: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  topStepMeta: { color: TEAL_DEEP, fontSize: 12, fontWeight: '600', marginTop: 2 },

  // estados vazios / tudo certo
  allClearTitle: { color: '#047857', fontSize: 16, fontWeight: '800' },
  emptyTitle: { color: '#334155', fontSize: 16, fontWeight: '800' },
  emptySub: { color: '#94A3B8', fontSize: 13, textAlign: 'center', lineHeight: 19 },

  // delays
  delayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12 },
  delayText: { color: '#0F172A', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  delayMeta: { color: '#B45309', fontSize: 12, fontWeight: '600', marginTop: 4 },
  delayTowerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delayTowerText: { color: '#B45309', fontSize: 13, fontWeight: '600' },
});
