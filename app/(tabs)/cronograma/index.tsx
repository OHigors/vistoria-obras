import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/src/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import * as db from '@/src/data/db';
import { useObras } from '@/src/data/ObrasContext';
import { summarizeSchedule, summarizeScheduleBoard, type ScheduleStatus } from '@/src/data/schedule';
import { ReadOnlyBanner } from '@/src/ui/ReadOnlyBanner';
import { Skeleton } from '@/src/ui/Skeleton';
import { useTutorialAnchor, useTutorialScreen } from '@/src/features/tutorial/TutorialContext';

// Teal é a cor do cronograma no restante do app; aqui ela sai da borda e vira o
// fundo do card principal — é o único elemento colorido da tela, e é o que põe
// "Cronograma da Obra" em evidência sem precisar competir com os indicadores.
const TEAL = '#0D9488';
const TEAL_DEEP = '#0F766E';

// Cor de cada estado de prazo, para o pill nas listas de detalhe.
const SCHED_STYLE: Record<ScheduleStatus, { bg: string; fg: string }> = {
  Atrasado: { bg: '#FEE2E2', fg: '#B91C1C' },
  Atenção: { bg: '#FEF3C7', fg: '#B45309' },
  'No prazo': { bg: '#DBEAFE', fg: '#2563EB' },
  Concluído: { bg: '#D1FAE5', fg: '#047857' },
};

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

  // Detalhe dos indicadores: qual lista está aberta (atrasados ou pendentes).
  const [detail, setDetail] = useState<'delayed' | 'pending' | null>(null);
  const detailItems = detail === 'delayed' ? board.delayed : detail === 'pending' ? board.pending : [];
  const towerName = useCallback(
    (id: string) => towers.find((t) => t.id === id)?.name ?? '',
    [towers],
  );
  // Fecha o modal ANTES de navegar — se ficasse aberto, cobriria a tela aberta.
  const openApartment = useCallback((apartmentId: string) => {
    setDetail(null);
    router.push(`/visao-geral/apartamentos/${apartmentId}` as any);
  }, [router]);

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
          {(() => {
            const delayColor = hasDelays ? '#B45309' : '#047857';
            const CardRoot = hasDelays ? Pressable : View;
            return (
              <CardRoot
                {...(hasDelays
                  ? {
                      onPress: () => setDetail('delayed'),
                      accessibilityRole: 'button' as const,
                      accessibilityLabel: `Ver os ${board.delayedApartments} apartamentos atrasados`,
                      style: ({ pressed }: { pressed: boolean }) => [s.kpiCard, pressed && s.kpiCardPressed],
                    }
                  : { style: s.kpiCard })}>
                <MaterialCommunityIcons name={hasDelays ? 'calendar-remove' : 'calendar-check'} size={26} color={delayColor} />
                <Text style={[s.kpiValue, { color: delayColor }]}>{board.delayedApartments}</Text>
                <Text style={s.kpiLabel}>Apt. atrasados</Text>
                {hasDelays && (
                  <View style={s.kpiHint}>
                    <Text style={[s.kpiHintText, { color: delayColor }]}>ver onde</Text>
                    <MaterialCommunityIcons name="chevron-right" size={13} color={delayColor} />
                  </View>
                )}
              </CardRoot>
            );
          })()}
          {(() => {
            const hasPending = board.pendingSteps > 0;
            const CardRoot = hasPending ? Pressable : View;
            return (
              <CardRoot
                {...(hasPending
                  ? {
                      onPress: () => setDetail('pending'),
                      accessibilityRole: 'button' as const,
                      accessibilityLabel: `Ver as ${board.pendingSteps} etapas pendentes`,
                      style: ({ pressed }: { pressed: boolean }) => [s.kpiCard, pressed && s.kpiCardPressed],
                    }
                  : { style: s.kpiCard })}>
                <MaterialCommunityIcons name="calendar-clock" size={26} color="#334155" />
                <Text style={[s.kpiValue, { color: '#334155' }]}>{board.pendingSteps}</Text>
                <Text style={s.kpiLabel}>Etapas pendentes</Text>
                {hasPending && (
                  <View style={s.kpiHint}>
                    <Text style={[s.kpiHintText, { color: '#334155' }]}>ver onde</Text>
                    <MaterialCommunityIcons name="chevron-right" size={13} color="#334155" />
                  </View>
                )}
              </CardRoot>
            );
          })()}
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

      {/* DETALHE DOS INDICADORES — onde estão os atrasados / pendentes */}
      <Modal animationType="slide" transparent visible={detail !== null} onRequestClose={() => setDetail(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setDetail(null)}>
          <Pressable style={[s.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]} onPress={() => {}}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <View style={[s.modalHeaderIcon, { backgroundColor: detail === 'delayed' ? '#FEF3C7' : '#F1F5F9' }]}>
                <MaterialCommunityIcons
                  name={detail === 'delayed' ? 'calendar-remove' : 'calendar-clock'}
                  size={18}
                  color={detail === 'delayed' ? '#B45309' : '#334155'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>
                  {detail === 'delayed' ? 'Apartamentos atrasados' : 'Etapas pendentes'}
                </Text>
                <Text style={s.modalSub}>
                  {detailItems.length} {detail === 'delayed'
                    ? (detailItems.length === 1 ? 'apartamento' : 'apartamentos')
                    : (detailItems.length === 1 ? 'etapa' : 'etapas')}
                </Text>
              </View>
              <Pressable onPress={() => setDetail(null)} style={s.modalClose} hitSlop={8}>
                <MaterialCommunityIcons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={s.modalList} contentContainerStyle={s.modalListContent} showsVerticalScrollIndicator={false}>
              {detailItems.map((item, i) => {
                const st = SCHED_STYLE[item.status];
                const tName = towerName(item.towerId);
                return (
                  <Pressable
                    key={`${item.apartmentId}-${item.label}-${i}`}
                    onPress={() => openApartment(item.apartmentId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir apartamento ${item.number}, etapa ${item.label}`}
                    style={({ pressed }) => [s.detailRow, pressed && s.detailRowPressed]}>
                    <View style={[s.detailDot, { backgroundColor: st.fg }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.detailPrimary} numberOfLines={1}>
                        {tName ? `${tName} · ` : ''}Apto {item.number}
                      </Text>
                      <Text style={s.detailSecondary} numberOfLines={1}>{item.floor} · {item.label}</Text>
                    </View>
                    {item.delayDays > 0 ? (
                      <View style={s.detailDelay}>
                        <Text style={s.detailDelayText}>+{item.delayDays}d</Text>
                      </View>
                    ) : (
                      <View style={[s.detailPill, { backgroundColor: st.bg }]}>
                        <Text style={[s.detailPillText, { color: st.fg }]}>{item.status}</Text>
                      </View>
                    )}
                    <MaterialCommunityIcons name="chevron-right" size={18} color="#CBD5E1" />
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

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
  kpiCardPressed: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
  kpiHint: { flexDirection: 'row', alignItems: 'center', gap: 1, marginTop: 2 },
  kpiHintText: { fontSize: 11, fontWeight: '800' },

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

  // modal de detalhe (onde estão os atrasados / pendentes)
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8, gap: 12, maxHeight: '80%' },
  modalHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 999, alignSelf: 'center', marginVertical: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalHeaderIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  modalSub: { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginTop: 1 },
  modalClose: { padding: 4 },
  modalList: { marginTop: 2 },
  modalListContent: { gap: 8, paddingBottom: 4 },

  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#EEF2F7', paddingVertical: 11, paddingHorizontal: 12, minHeight: 48 },
  detailRowPressed: { backgroundColor: '#EEF2F7', borderColor: '#CBD5E1' },
  detailDot: { width: 8, height: 8, borderRadius: 4 },
  detailPrimary: { color: '#0F172A', fontSize: 13.5, fontWeight: '800' },
  detailSecondary: { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 1 },
  detailDelay: { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  detailDelayText: { color: '#B91C1C', fontSize: 12, fontWeight: '900' },
  detailPill: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  detailPillText: { fontSize: 11, fontWeight: '800' },
});
