import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useObras } from '@/src/data/ObrasContext';
import * as db from '@/src/data/db';
import type { Apartment, ChecklistState } from '@/src/data/mockObras';
import type { Worker } from '@/src/data/serviceWorkers';
import { isValidBrDate, maskDateBr, type ScheduledChecklistItem } from '@/src/data/schedule';
import {
  buildCategoryGantt,
  buildPavimentoGantt,
  formatFull,
  formatShort,
  getCategoryGroups,
  STATUS_COLORS,
  type CronogramaStatus,
  type CronogramaTask,
} from '@/src/data/mockCronograma';
import { buildCronogramaFromData, getCronogramaStages } from '@/src/data/cronogramaReal';

// ── Color token (teal) ──────────────────────────────────────────────────────────
const C = { primary: '#0D9488', light: '#F0FDFA', medium: '#14B8A6' } as const;

// ── Gantt geometry ──────────────────────────────────────────────────────────────
const DAY_W = 34;
const AXIS_H = 32;
const GROUP_H = 40;
const ROW_H = 58;
const LABEL_W = 150;
// faixas planejado/realizado dentro da linha
const PLAN_TOP = 9;
const ACT_TOP = 30;
const BAR_H = 15;
// vista "Por pavimento" (estilo planilha: nome · Previsto/Realizado · células de dias)
const PAV_SUBROW_H = 18;
const PAV_BLOCK_H = PAV_SUBROW_H * 2;
const NAME_W = 94;
const PR_W = LABEL_W - NAME_W;

const MS_DAY = 24 * 60 * 60 * 1000;
const PROGRESS_STEPS = [0, 25, 50, 75, 100] as const;
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

// Jogo de cores do "Realizado", célula a célula:
//   • âmbar  → tarefa em andamento (ainda não concluída e dentro do prazo)
//   • verde  → dia realizado dentro do previsto (no prazo)
//   • vermelho → dia que excedeu o fim previsto (atraso/dias a mais)
const REAL_GREEN = '#22C55E';
const REAL_AMBER = '#F59E0B';
const REAL_RED = '#EF4444';
const realCellColor = (t: CronogramaTask, dayIndex: number) =>
  t.status === 'Em andamento' ? REAL_AMBER : dayIndex < t.endOffset ? REAL_GREEN : REAL_RED;

// soma dias a uma data BR (DD/MM/YYYY) → nova data BR
function addDaysToBr(br: string, days: number): string {
  const [d, m, y] = br.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

type MainView = 'pavimento' | 'etapa';

const StatusPill = ({ status }: { status: CronogramaStatus }) => {
  const c = STATUS_COLORS[status];
  return (
    <View style={[s.pill, { backgroundColor: c.bg }]}>
      <Text style={[s.pillText, { color: c.fg }]}>{status}</Text>
    </View>
  );
};

export default function CronogramaObraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { apartments, towers, serviceStages, loading, refreshApartment, refreshData } = useObras();

  const [view, setView] = useState<MainView>('pavimento');
  const [breakdown, setBreakdown] = useState<{ title: string; sub: string; tasks: CronogramaTask[] } | null>(null);
  const [towerFilter, setTowerFilter] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // dados reais carregados sob demanda (não estão no contexto)
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [assignmentsByApt, setAssignmentsByApt] = useState<Record<string, Record<string, string[]>>>({});

  // ── add-task form ──
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [fApt, setFApt] = useState('');
  const [fStage, setFStage] = useState('');
  const [fStart, setFStart] = useState('');
  const [fDays, setFDays] = useState('');
  const [fResp, setFResp] = useState<string[]>([]);
  const [fProgress, setFProgress] = useState(0);
  const [fNote, setFNote] = useState('');
  const [fError, setFError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    db.loadWorkers()
      .then((w) => alive && setWorkers(w))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all(apartments.map(async (a) => [a.id, await db.loadStepAssignments(a.id)] as const))
      .then((entries) => alive && setAssignmentsByApt(Object.fromEntries(entries)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [apartments]);

  const result = useMemo(
    () => buildCronogramaFromData(apartments, serviceStages, workers, assignmentsByApt, towers),
    [apartments, serviceStages, workers, assignmentsByApt, towers],
  );

  // filtro de torre (aplica nas duas abas)
  const towerOptions = useMemo(
    () => [...new Set(result.tasks.map((t) => t.tower).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [result],
  );
  const effectiveTower = towerFilter !== 'all' && !towerOptions.includes(towerFilter) ? 'all' : towerFilter;
  const visibleTasks = useMemo(
    () => (effectiveTower === 'all' ? result.tasks : result.tasks.filter((t) => t.tower === effectiveTower)),
    [result, effectiveTower],
  );

  const groups = useMemo(() => {
    if (view === 'pavimento') return buildPavimentoGantt(visibleTasks);
    return selectedCategory ? buildCategoryGantt(visibleTasks, selectedCategory) : [];
  }, [visibleTasks, view, selectedCategory]);
  const categoryGroups = useMemo(() => getCategoryGroups(visibleTasks), [visibleTasks]);
  const cronStages = useMemo(() => getCronogramaStages(serviceStages), [serviceStages]);

  // apartamentos agrupados por torre/pavimento para o seletor do formulário
  const aptGroups = useMemo(() => {
    const multiTower = towers.length > 1;
    const map = new Map<string, { label: string; order: number; apts: Apartment[] }>();
    apartments.forEach((a) => {
      const tower = towers.find((t) => t.id === a.towerId);
      const towerIdx = Math.max(0, towers.findIndex((t) => t.id === a.towerId));
      const floorNum = Number(a.floor.match(/\d+/)?.[0] ?? 0);
      const key = multiTower ? `${a.towerId}|${a.floor}` : a.floor;
      const label = multiTower && tower ? `${tower.name} · ${a.floor}` : a.floor;
      if (!map.has(key)) map.set(key, { label, order: towerIdx * 1000 + floorNum, apts: [] });
      map.get(key)!.apts.push(a);
    });
    return [...map.values()]
      .sort((x, y) => x.order - y.order)
      .map((g) => ({
        ...g,
        apts: g.apts.sort((p, q) => p.number.localeCompare(q.number, 'pt-BR', { numeric: true })),
      }));
  }, [apartments, towers]);

  const stats = useMemo(() => {
    const total = visibleTasks.length;
    const concluidas = visibleTasks.filter((t) => t.status === 'Concluída').length;
    const andamento = visibleTasks.filter((t) => t.status === 'Em andamento').length;
    const atrasadas = visibleTasks.filter((t) => t.status === 'Atrasada').length;
    return { total, concluidas, andamento, atrasadas };
  }, [visibleTasks]);

  const gridW = result.totalDias * DAY_W;
  const days = useMemo(
    () => Array.from({ length: result.totalDias }, (_, i) => new Date(result.projectStart.getTime() + i * MS_DAY)),
    [result],
  );

  const breakdownTotals = useMemo(() => {
    if (!breakdown) return null;
    const planned = breakdown.tasks.reduce((acc, t) => acc + t.duracaoDias, 0);
    const withActual = breakdown.tasks.filter((t) => t.actualDias != null);
    const actual = withActual.reduce((acc, t) => acc + (t.actualDias ?? 0), 0);
    return { planned, actual, hasActual: withActual.length > 0 };
  }, [breakdown]);

  // etapas ainda não agendadas para o apartamento selecionado
  const scheduledForApt = useMemo(() => {
    const set = new Set<string>();
    for (const t of result.tasks) if (t.apartmentId === fApt) set.add(t.etapa);
    return set;
  }, [result, fApt]);
  const availableStages = cronStages.filter((st) => !scheduledForApt.has(st.nome));

  const hasTasks = result.tasks.length > 0;
  const isLoading = loading && apartments.length === 0;

  const openAdd = () => {
    setFApt(apartments[0]?.id ?? '');
    setFStage('');
    setFStart('');
    setFDays('');
    setFResp([]);
    setFProgress(0);
    setFNote('');
    setFError(null);
    setAddOpen(true);
  };

  const toggleResp = (id: string) =>
    setFResp((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const saveTask = async () => {
    if (!fApt) return setFError('Selecione o apartamento.');
    if (!fStage) return setFError('Selecione a etapa.');
    if (!isValidBrDate(fStart)) return setFError('Informe uma data de início válida (dd/mm/aaaa).');
    const days = Number(fDays);
    if (!Number.isFinite(days) || days < 1) return setFError('Informe a duração em dias (mínimo 1).');

    const apt = apartments.find((a) => a.id === fApt);
    if (!apt) return setFError('Apartamento não encontrado.');

    setSaving(true);
    setFError(null);
    try {
      const existing = (apt.checklist as ScheduledChecklistItem[]).find((it) => it.label === fStage);
      let itemId = existing?.id;

      // etapa ainda não existe como item do apartamento → cria a partir do catálogo
      if (!itemId) {
        const fullStage = serviceStages.find((sg) => sg.nome === fStage);
        if (!fullStage) throw new Error('stage-not-found');
        await db.addStageToApartments(fullStage, [fApt]);
        const items = await db.loadChecklist(fApt);
        itemId = items.find((it) => it.label === fStage)?.id;
        if (!itemId) throw new Error('item-not-created');
      }

      const state: ChecklistState = fProgress >= 100 ? 'ok' : fProgress > 0 ? 'partial' : 'pending';
      await db.upsertChecklistItem({
        id: itemId,
        apartmentId: fApt,
        label: fStage,
        state,
        comment: fNote.trim() || existing?.comment,
        emergency: existing?.emergency,
        area: existing?.area ?? 'Interior',
        isExtra: existing?.isExtra ?? false,
        plannedStart: fStart,
        plannedEnd: addDaysToBr(fStart, Math.round(days)),
        actualStart: existing?.actualStart,
        actualEnd: existing?.actualEnd,
      });
      await db.setStepAssignments(fApt, itemId, fResp);

      // recarrega o apartamento + suas atribuições para refletir no Gantt
      await refreshApartment(fApt);
      const fresh = await db.loadStepAssignments(fApt);
      setAssignmentsByApt((prev) => ({ ...prev, [fApt]: fresh }));
      setAddOpen(false);
    } catch {
      setFError('Não foi possível salvar. Verifique a conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // Modo teste: tira todas as etapas do cronograma limpando as datas (previsto +
  // realizado). As etapas e o status continuam no checklist.
  const clearCronograma = async () => {
    setClearing(true);
    try {
      for (const t of result.tasks) {
        const apt = apartments.find((a) => a.id === t.apartmentId);
        const item = (apt?.checklist as ScheduledChecklistItem[] | undefined)?.find((i) => i.id === t.id);
        if (!apt || !item) continue;
        await db.upsertChecklistItem({
          ...item,
          apartmentId: apt.id,
          plannedStart: undefined,
          plannedEnd: undefined,
          actualStart: undefined,
          actualEnd: undefined,
        });
      }
      await refreshData();
      setClearOpen(false);
    } catch {
      // modo teste — ignora falhas
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {/* HEADER */}
        <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.push('/(tabs)/cronograma' as any)} style={s.headerBack}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="rgba(255,255,255,0.9)" />
            <Text style={s.headerBackText}>Cronograma</Text>
          </Pressable>
          <View style={s.headerTop}>
            <MaterialCommunityIcons name="chart-gantt" size={28} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Cronograma da Obra</Text>
              <Text style={s.headerSub}>Planejado × Executado</Text>
            </View>
            <Pressable onPress={() => refreshData()} style={s.headerRefresh} hitSlop={8}>
              <MaterialCommunityIcons name="refresh" size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={openAdd} style={s.headerAdd} hitSlop={8}>
              <MaterialCommunityIcons name="plus" size={22} color={C.primary} />
            </Pressable>
          </View>

          {hasTasks && (
            <View style={s.timeline}>
              <View style={s.timelineItem}>
                <Text style={s.timelineLabel}>Início</Text>
                <Text style={s.timelineValue}>{formatFull(result.projectStart)}</Text>
              </View>
              <MaterialCommunityIcons name="arrow-right" size={16} color="rgba(255,255,255,0.6)" />
              <View style={s.timelineItem}>
                <Text style={s.timelineLabel}>Entrega prevista</Text>
                <Text style={s.timelineValue}>{formatFull(result.projectEnd)}</Text>
              </View>
            </View>
          )}
        </View>

        {isLoading ? (
          <View style={s.empty}>
            <ActivityIndicator color={C.primary} />
            <Text style={s.emptyText}>Carregando dados da obra…</Text>
          </View>
        ) : !hasTasks ? (
          /* ── EMPTY STATE ──────────────────────────────────────────────────── */
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <MaterialCommunityIcons name="calendar-blank-outline" size={30} color={C.primary} />
            </View>
            <Text style={s.emptyTitle}>Nenhuma tarefa com datas</Text>
            <Text style={s.emptyText}>
              As barras aparecem para as etapas que já têm início e fim planejados no banco. Adicione uma tarefa para
              atribuir datas e responsáveis a uma etapa.
            </Text>
            <Pressable onPress={openAdd} style={s.emptyBtn}>
              <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
              <Text style={s.emptyBtnText}>Adicionar tarefa</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* KPI ROW */}
            <View style={s.kpiRow}>
              {[
                { icon: 'format-list-checks', value: stats.total, label: 'Tarefas', color: '#0F766E', bg: '#F0FDFA' },
                { icon: 'check-circle-outline', value: stats.concluidas, label: 'Concluídas', color: '#047857', bg: '#D1FAE5' },
                { icon: 'progress-clock', value: stats.andamento, label: 'Em andamento', color: '#1D4ED8', bg: '#DBEAFE' },
                { icon: 'clock-alert-outline', value: stats.atrasadas, label: 'Atrasadas', color: stats.atrasadas > 0 ? '#B91C1C' : '#047857', bg: stats.atrasadas > 0 ? '#FEE2E2' : '#D1FAE5' },
              ].map((k) => (
                <View key={k.label} style={[s.kpiCard, { backgroundColor: k.bg }]}>
                  <MaterialCommunityIcons name={k.icon as any} size={17} color={k.color} />
                  <Text style={[s.kpiValue, { color: k.color }]}>{k.value}</Text>
                  <Text style={[s.kpiLabel, { color: k.color }]}>{k.label}</Text>
                </View>
              ))}
            </View>

            {/* ADD BUTTON */}
            <Pressable onPress={openAdd} style={s.addBtn}>
              <MaterialCommunityIcons name="plus-circle-outline" size={18} color={C.primary} />
              <Text style={s.addBtnText}>Adicionar tarefa ao cronograma</Text>
            </Pressable>

            <Pressable onPress={() => setClearOpen(true)} style={s.clearBtn}>
              <MaterialCommunityIcons name="trash-can-outline" size={15} color="#B91C1C" />
              <Text style={s.clearBtnText}>Limpar cronograma (teste)</Text>
            </Pressable>

            {/* TOWER FILTER (aplica nas duas abas) */}
            {towerOptions.length > 1 && (
              <View style={s.towerFilter}>
                {['all', ...towerOptions].map((tw) => {
                  const active = effectiveTower === tw;
                  return (
                    <Pressable key={tw} onPress={() => setTowerFilter(tw)} style={[s.towerChip, active && s.towerChipActive]}>
                      <Text style={[s.towerChipText, active && s.towerChipTextActive]} numberOfLines={1}>
                        {tw === 'all' ? 'Todas as torres' : tw}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* VIEW TOGGLE */}
            <View style={s.toggle}>
              {([['pavimento', 'Por pavimento', 'stairs'], ['etapa', 'Por etapa', 'layers-triple-outline']] as const).map(
                ([v, label, icon]) => {
                  const active = view === v;
                  return (
                    <Pressable key={v} onPress={() => { setView(v); setSelectedCategory(null); }} style={[s.toggleBtn, active && s.toggleBtnActive]}>
                      <MaterialCommunityIcons name={icon} size={15} color={active ? C.primary : '#94A3B8'} />
                      <Text style={[s.toggleText, active && s.toggleTextActive]}>{label}</Text>
                    </Pressable>
                  );
                },
              )}
            </View>

            {view === 'etapa' && !selectedCategory ? (
              <View style={s.catList}>
                {categoryGroups.map((cg) => (
                  <Pressable key={cg.categoria} onPress={() => setSelectedCategory(cg.categoria)} style={s.catCard}>
                    <View style={s.catIcon}>
                      <MaterialCommunityIcons name="folder-multiple-outline" size={20} color={C.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.catName} numberOfLines={2}>{cg.categoria}</Text>
                      <Text style={s.catSub}>
                        {cg.etapaCount} {cg.etapaCount === 1 ? 'etapa' : 'etapas'} · {cg.taskCount} {cg.taskCount === 1 ? 'tarefa' : 'tarefas'}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
                  </Pressable>
                ))}
              </View>
            ) : (
              <>
                {view === 'etapa' && selectedCategory && (
                  <Pressable onPress={() => setSelectedCategory(null)} style={s.catBack}>
                    <MaterialCommunityIcons name="chevron-left" size={20} color={C.primary} />
                    <Text style={s.catBackText} numberOfLines={1}>{selectedCategory}</Text>
                  </Pressable>
                )}

            {/* LEGEND */}
            <View style={s.legend}>
              <View style={s.legendItem}>
                <View style={[s.legendSwatch, { backgroundColor: '#3B82F6', borderColor: '#1D4ED8' }]} />
                <Text style={s.legendText}>Previsto</Text>
              </View>
              <View style={s.legendItem}>
                <View style={[s.legendSwatch, { backgroundColor: REAL_AMBER, borderColor: '#B45309' }]} />
                <Text style={s.legendText}>Em andamento</Text>
              </View>
              <View style={s.legendItem}>
                <View style={[s.legendSwatch, { backgroundColor: REAL_GREEN, borderColor: '#16A34A' }]} />
                <Text style={s.legendText}>No prazo</Text>
              </View>
              <View style={s.legendItem}>
                <View style={[s.legendSwatch, { backgroundColor: REAL_RED, borderColor: '#B91C1C' }]} />
                <Text style={s.legendText}>Excedido</Text>
              </View>
            </View>

            {/* GANTT */}
            <View style={s.ganttCard}>
              <View style={{ flexDirection: 'row' }}>
                {/* LEFT — fixed label column (nome completo da etapa) */}
                <View style={{ width: LABEL_W }}>
                  <View style={[s.axisSpacer, { height: AXIS_H }]} />
                  {groups.map((g) => (
                    <View key={g.id}>
                      <View style={[s.groupLabel, { height: GROUP_H }]}>
                        <Text style={s.groupLabelTitle} numberOfLines={2}>{g.title}</Text>
                        <Text style={s.groupLabelSub} numberOfLines={1}>{g.sub}</Text>
                      </View>
                      {g.rows.map((r) => (
                        <Pressable
                          key={r.id}
                          onPress={() => r.breakdown?.length && setBreakdown({ title: r.label, sub: g.title, tasks: r.breakdown })}
                          style={({ pressed }) => [s.pavBlock, { height: PAV_BLOCK_H }, pressed && s.rowLabelPressed]}>
                          <View style={[s.pavNameCell, { width: NAME_W }]}>
                            <Text style={s.pavName} numberOfLines={2}>{r.label}</Text>
                          </View>
                          <View style={[s.prCol, { width: PR_W }]}>
                            <View style={[s.prCell, { height: PAV_SUBROW_H }]}><Text style={s.prText}>Previsto</Text></View>
                            <View style={[s.prCell, { height: PAV_SUBROW_H, borderBottomWidth: 0 }]}><Text style={s.prText}>Realizado</Text></View>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>

                {/* RIGHT — scrollable day grid */}
                <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: gridW }}>
                  <View style={{ width: gridW }}>
                    {/* axis */}
                    <View style={[s.axis, { height: AXIS_H }]}>
                      {days.map((d, i) => {
                        const weekend = d.getDay() === 0 || d.getDay() === 6;
                        const isToday = i === result.hojeOffset;
                        return (
                          <View key={i} style={[s.axisCell, weekend && s.axisCellWeekend, isToday && s.axisCellToday]}>
                            <Text style={[s.axisDow, isToday && s.axisTextToday]}>{WEEKDAYS[d.getDay()]}</Text>
                            <Text style={[s.axisText, isToday && s.axisTextToday]}>{d.getDate()}</Text>
                          </View>
                        );
                      })}
                    </View>

                    {groups.map((g) => (
                      <View key={g.id}>
                        <View style={[s.groupBand, { height: GROUP_H, width: gridW }]} />
                        {g.rows.map((r) => {
                          const t = r.tasks[0];
                          const hasActual = t.actualStartOffset != null && t.actualEndOffset != null;
                          return (
                            <View key={r.id} style={[s.pavGrid, { height: PAV_BLOCK_H, width: gridW }]}>
                              {/* Previsto */}
                              <View style={[s.pavSubRow, { height: PAV_SUBROW_H }]}>
                                {days.map((d, i) => {
                                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                                  const inRange = i >= t.startOffset && i < t.endOffset;
                                  return <View key={i} style={[s.pavCell, weekend && s.gridCellWeekend, inRange && s.prevCell]} />;
                                })}
                              </View>
                              {/* Realizado */}
                              <View style={[s.pavSubRow, { height: PAV_SUBROW_H, borderBottomWidth: 0 }]}>
                                {days.map((d, i) => {
                                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                                  const inRange = hasActual && i >= t.actualStartOffset! && i < t.actualEndOffset!;
                                  return <View key={i} style={[s.pavCell, weekend && s.gridCellWeekend, inRange && { backgroundColor: realCellColor(t, i) }]} />;
                                })}
                              </View>
                              <View style={[s.todayLine, { left: result.hojeOffset * DAY_W }]} />
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </View>

            <Text style={s.hint}>
              {view === 'pavimento'
                ? 'Cada linha é um grupo de serviços do pavimento, somando o tempo de todas as suas etapas: Previsto (azul) em cima, Realizado (verde/vermelho) embaixo. Cada célula é um dia; linha vermelha = hoje.'
                : 'Etapas desta categoria, somadas por pavimento (Previsto azul / Realizado verde). Cada célula é um dia; linha vermelha = hoje.'}
            </Text>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* ── BREAKDOWN MODAL (detalhamento da linha agregada) ─────────────────── */}
      <Modal animationType="slide" transparent visible={!!breakdown} onRequestClose={() => setBreakdown(null)}>
        <Pressable style={mod.backdrop} onPress={() => setBreakdown(null)}>
          <Pressable style={mod.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={mod.handle} />
            {breakdown && (
              <>
                <View style={mod.header}>
                  <View style={mod.headerLeft}>
                    <View style={mod.headerIcon}>
                      <MaterialCommunityIcons name="format-list-bulleted" size={18} color={C.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={mod.headerTitle} numberOfLines={2}>{breakdown.title}</Text>
                      <Text style={mod.headerSub}>
                        {breakdown.sub} · {breakdown.tasks.length} {breakdown.tasks.length === 1 ? 'tarefa' : 'tarefas'}
                      </Text>
                    </View>
                  </View>
                  <Pressable onPress={() => setBreakdown(null)} style={mod.closeBtn} hitSlop={8}>
                    <MaterialCommunityIcons name="close" size={18} color="#475569" />
                  </Pressable>
                </View>

                {breakdownTotals && (
                  <View style={mod.totals}>
                    <View style={mod.totalChip}>
                      <View style={[mod.totalDot, { backgroundColor: '#3B82F6' }]} />
                      <Text style={mod.totalLabel}>Previsto</Text>
                      <Text style={mod.totalValue}>{breakdownTotals.planned} {breakdownTotals.planned === 1 ? 'dia' : 'dias'}</Text>
                    </View>
                    {breakdownTotals.hasActual && (
                      <View style={mod.totalChip}>
                        <View style={[mod.totalDot, { backgroundColor: REAL_GREEN }]} />
                        <Text style={mod.totalLabel}>Realizado</Text>
                        <Text style={mod.totalValue}>{breakdownTotals.actual} {breakdownTotals.actual === 1 ? 'dia' : 'dias'}</Text>
                      </View>
                    )}
                  </View>
                )}

                <ScrollView style={mod.list} contentContainerStyle={mod.listContent} showsVerticalScrollIndicator={false}>
                  {breakdown.tasks.map((t) => (
                    <View key={t.id} style={mod.taskCard}>
                      <View style={[mod.taskStripe, { backgroundColor: STATUS_COLORS[t.status].bar }]} />
                      <View style={mod.taskInner}>
                        <View style={mod.taskTop}>
                          <Text style={mod.taskEtapa}>{t.tower ? `${t.tower} · ` : ''}Apto {t.apartmentNumber} · {t.etapa}</Text>
                          <StatusPill status={t.status} />
                        </View>
                        <View style={mod.taskMetaRow}>
                          <MaterialCommunityIcons name="account-hard-hat" size={13} color="#94A3B8" />
                          <Text style={mod.taskMeta}>{t.responsibles.length ? t.responsibles.join(', ') : 'Sem responsável'}</Text>
                        </View>
                        <View style={mod.taskMetaRow}>
                          <MaterialCommunityIcons name="calendar-range" size={13} color="#94A3B8" />
                          <Text style={mod.taskMeta}>Previsto: {formatShort(t.start)} → {formatShort(t.end)} · {t.duracaoDias} {t.duracaoDias === 1 ? 'dia' : 'dias'}</Text>
                        </View>
                        {t.actualStart && t.actualEnd && t.actualDias != null && (
                          <View style={mod.taskMetaRow}>
                            <MaterialCommunityIcons name="calendar-check" size={13} color="#94A3B8" />
                            <Text style={mod.taskMeta}>Levou {t.actualDias} {t.actualDias === 1 ? 'dia' : 'dias'} ({formatShort(t.actualStart)} → {formatShort(t.actualEnd)})</Text>
                            {t.actualEndOffset != null && t.actualEndOffset > t.endOffset && (
                              <Text style={mod.taskLate}>+{t.actualEndOffset - t.endOffset}d</Text>
                            )}
                          </View>
                        )}
                        <View style={mod.taskMetaRow}>
                          <MaterialCommunityIcons name="progress-check" size={13} color="#94A3B8" />
                          <Text style={mod.taskMeta}>{Math.round(t.executadoPct * 100)}% executado</Text>
                          {t.atrasoDias > 0 && <Text style={mod.taskLate}>· {t.atrasoDias}d de atraso</Text>}
                        </View>
                        {!!t.note && <Text style={mod.taskNote}>{t.note}</Text>}
                      </View>
                    </View>
                  ))}
                  <View style={{ height: 32 }} />
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── ADD TASK MODAL ──────────────────────────────────────────────────── */}
      <Modal animationType="slide" transparent visible={addOpen} onRequestClose={() => setAddOpen(false)}>
        <Pressable style={mod.backdrop} onPress={() => setAddOpen(false)}>
          <Pressable style={[mod.sheet, { maxHeight: '92%' }]} onPress={(e) => e.stopPropagation()}>
            <View style={mod.handle} />
            <View style={mod.header}>
              <View style={mod.headerLeft}>
                <View style={mod.headerIcon}>
                  <MaterialCommunityIcons name="calendar-plus" size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={mod.headerTitle}>Adicionar tarefa</Text>
                  <Text style={mod.headerSub}>Atribua uma etapa a um apartamento</Text>
                </View>
              </View>
              <Pressable onPress={() => setAddOpen(false)} style={mod.closeBtn} hitSlop={8}>
                <MaterialCommunityIcons name="close" size={18} color="#475569" />
              </Pressable>
            </View>

            <ScrollView style={mod.list} contentContainerStyle={form.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={form.notice}>
                <MaterialCommunityIcons name="content-save-outline" size={14} color={C.primary} />
                <Text style={form.noticeText}>A tarefa é salva no banco e atribuída ao apartamento (datas e responsáveis).</Text>
              </View>

              {/* Apartamento — agrupado por torre/pavimento */}
              <Text style={form.label}>Apartamento</Text>
              {aptGroups.map((grp) => (
                <View key={grp.label} style={form.aptGroup}>
                  <Text style={form.aptGroupLabel}>{grp.label}</Text>
                  <View style={form.chipsWrap}>
                    {grp.apts.map((a) => {
                      const active = a.id === fApt;
                      return (
                        <Pressable
                          key={a.id}
                          onPress={() => { setFApt(a.id); setFStage(''); }}
                          style={[form.chip, active && form.chipActive]}>
                          <Text style={[form.chipText, active && form.chipTextActive]}>Apto {a.number}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}

              {/* Etapa */}
              <Text style={form.label}>Etapa / serviço</Text>
              {availableStages.length === 0 ? (
                <Text style={form.empty}>Todas as etapas do cronograma já foram agendadas para este apartamento.</Text>
              ) : (
                <View style={form.chipsWrap}>
                  {availableStages.map((e) => {
                    const active = e.nome === fStage;
                    return (
                      <Pressable key={e.id} onPress={() => setFStage(e.nome)} style={[form.chip, active && form.chipActive]}>
                        <Text style={[form.chipText, active && form.chipTextActive]} numberOfLines={1}>{e.nome}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Início + duração */}
              <View style={form.row}>
                <View style={{ flex: 1.4 }}>
                  <Text style={form.label}>Início</Text>
                  <TextInput
                    value={fStart}
                    onChangeText={(v) => setFStart(maskDateBr(v))}
                    placeholder="dd/mm/aaaa"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                    style={form.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={form.label}>Duração (dias)</Text>
                  <TextInput
                    value={fDays}
                    onChangeText={(v) => setFDays(v.replace(/\D/g, '').slice(0, 3))}
                    placeholder="ex: 3"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                    style={form.input}
                  />
                </View>
              </View>

              {/* Responsáveis */}
              <Text style={form.label}>Responsáveis</Text>
              {workers.length === 0 ? (
                <Text style={form.empty}>Nenhum colaborador cadastrado.</Text>
              ) : (
                <View style={form.chipsWrap}>
                  {workers.map((w) => {
                    const active = fResp.includes(w.id);
                    return (
                      <Pressable key={w.id} onPress={() => toggleResp(w.id)} style={[form.chip, active && form.chipActive]}>
                        {active && <MaterialCommunityIcons name="check" size={13} color={C.primary} style={{ marginRight: 4 }} />}
                        <Text style={[form.chipText, active && form.chipTextActive]}>{w.nome}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Progresso */}
              <Text style={form.label}>Progresso</Text>
              <View style={form.progressRow}>
                {PROGRESS_STEPS.map((p) => {
                  const active = p === fProgress;
                  return (
                    <Pressable key={p} onPress={() => setFProgress(p)} style={[form.progBtn, active && form.progBtnActive]}>
                      <Text style={[form.progText, active && form.progTextActive]}>{p}%</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Observação */}
              <Text style={form.label}>Observação (opcional)</Text>
              <TextInput
                value={fNote}
                onChangeText={setFNote}
                placeholder="Anotações sobre a tarefa…"
                placeholderTextColor="#94A3B8"
                multiline
                style={[form.input, form.inputMulti]}
              />

              {!!fError && <Text style={form.error}>{fError}</Text>}

              <View style={form.actions}>
                <Pressable onPress={() => setAddOpen(false)} disabled={saving} style={[form.actionBtn, form.cancelBtn]}>
                  <Text style={form.cancelText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={saveTask} disabled={saving} style={[form.actionBtn, form.saveBtn, saving && { opacity: 0.7 }]}>
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" />
                  )}
                  <Text style={form.saveText}>{saving ? 'Salvando…' : 'Salvar tarefa'}</Text>
                </Pressable>
              </View>
              <View style={{ height: 12 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── CONFIRM CLEAR (modo teste) ───────────────────────────────────────── */}
      <Modal animationType="fade" transparent visible={clearOpen} onRequestClose={() => setClearOpen(false)}>
        <Pressable style={mod.confirmBackdrop} onPress={() => setClearOpen(false)}>
          <Pressable style={mod.confirmSheet} onPress={(e) => e.stopPropagation()}>
            <View style={mod.confirmIcon}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#B91C1C" />
            </View>
            <Text style={mod.confirmTitle}>Limpar cronograma?</Text>
            <Text style={mod.confirmText}>
              Remove as datas (previsto e realizado) das {result.tasks.length} etapas do cronograma. As etapas e o status
              continuam no checklist — só saem do cronograma. (Modo teste.)
            </Text>
            <View style={mod.confirmActions}>
              <Pressable onPress={() => setClearOpen(false)} disabled={clearing} style={[form.actionBtn, form.cancelBtn]}>
                <Text style={form.cancelText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={clearCronograma} disabled={clearing} style={[form.actionBtn, mod.confirmDanger, clearing && { opacity: 0.7 }]}>
                {clearing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#FFFFFF" />
                )}
                <Text style={form.saveText}>{clearing ? 'Limpando…' : 'Limpar'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  container: { gap: 12, paddingBottom: 36 },

  header: { backgroundColor: C.primary, paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  headerBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -4, gap: 2 },
  headerBackText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600' },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '900' },
  headerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2, fontWeight: '600' },
  headerRefresh: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  headerAdd: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },

  timeline: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 12 },
  timelineItem: { gap: 2 },
  timelineLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  timelineValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  empty: { marginHorizontal: 16, marginTop: 8, backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 16, padding: 24, alignItems: 'center', gap: 10 },
  emptyIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  emptyText: { color: '#64748B', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11, marginTop: 4 },
  emptyBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  kpiRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  kpiCard: { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 3 },
  kpiValue: { fontSize: 18, fontWeight: '900' },
  kpiLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.medium, backgroundColor: C.light },
  addBtnText: { color: C.primary, fontSize: 14, fontWeight: '800' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 16, marginTop: -4, paddingVertical: 6 },
  clearBtnText: { color: '#B91C1C', fontSize: 13, fontWeight: '700' },

  toggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, gap: 3, marginHorizontal: 16 },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  toggleText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  toggleTextActive: { color: C.primary },

  towerFilter: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginHorizontal: 16 },
  towerChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  towerChipActive: { backgroundColor: C.light, borderColor: C.medium },
  towerChipText: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  towerChipTextActive: { color: C.primary },

  // "Por etapa" — lista de categorias + voltar
  catList: { gap: 8, marginHorizontal: 16 },
  catCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, padding: 14 },
  catIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  catName: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  catSub: { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 2 },
  catBack: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 16 },
  catBackText: { color: C.primary, fontSize: 15, fontWeight: '800', flex: 1 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 16, height: 10, borderRadius: 3, borderWidth: 1 },
  legendText: { color: '#64748B', fontSize: 11, fontWeight: '700' },

  // gantt
  ganttCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, marginHorizontal: 16, overflow: 'hidden' },

  axisSpacer: { borderBottomWidth: 1, borderBottomColor: '#E2E8F0', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  axis: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  axisCell: { width: DAY_W, alignItems: 'center', justifyContent: 'center', gap: 1, borderRightWidth: 1, borderRightColor: '#CBD5E1' },
  axisCellWeekend: { backgroundColor: '#FAFAFA' },
  axisCellToday: { backgroundColor: '#FEF2F2' },
  axisDow: { color: '#94A3B8', fontSize: 8, fontWeight: '800', textTransform: 'uppercase' },
  axisText: { color: '#94A3B8', fontSize: 11, fontWeight: '700' },
  axisTextToday: { color: '#EF4444', fontWeight: '900' },

  groupLabel: { justifyContent: 'center', paddingHorizontal: 10, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  groupLabelTitle: { color: '#0F172A', fontSize: 12, fontWeight: '900', lineHeight: 15 },
  groupLabelSub: { color: '#94A3B8', fontSize: 10, fontWeight: '600' },
  groupBand: { backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },

  rowLabel: { justifyContent: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  rowLabelPressed: { backgroundColor: '#F0FDFA' },
  rowLabelText: { color: '#0F172A', fontSize: 12.5, fontWeight: '800', lineHeight: 16 },
  rowLabelSub: { color: '#94A3B8', fontSize: 10, fontWeight: '600' },

  gridRow: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9', position: 'relative' },
  gridlines: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  gridCell: { width: DAY_W, borderRightWidth: 1, borderRightColor: '#CBD5E1' },
  gridCellWeekend: { backgroundColor: '#FAFAFA' },

  // faixas planejado / realizado
  planBar: { position: 'absolute', top: PLAN_TOP, height: BAR_H, borderRadius: 4, borderWidth: 1.5, backgroundColor: '#EEF2FF', borderColor: '#818CF8', justifyContent: 'center', paddingHorizontal: 6, overflow: 'hidden' },
  planText: { fontSize: 9, fontWeight: '800', color: '#4F46E5' },
  actBar: { position: 'absolute', top: ACT_TOP, height: BAR_H, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(15,23,42,0.22)', justifyContent: 'center', paddingHorizontal: 6, overflow: 'hidden' },
  actText: { fontSize: 9, fontWeight: '900', color: '#FFFFFF' },
  overrunBar: { position: 'absolute', top: ACT_TOP, height: BAR_H, borderRadius: 4, backgroundColor: '#F43F5E', borderWidth: 1, borderColor: '#9F1239', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, overflow: 'hidden' },
  overrunText: { fontSize: 9, fontWeight: '900', color: '#FFFFFF' },
  actEmpty: { position: 'absolute', top: ACT_TOP, height: BAR_H, borderRadius: 4, borderWidth: 1, borderColor: '#CBD5E1', borderStyle: 'dashed', justifyContent: 'center', paddingHorizontal: 6 },
  actEmptyText: { fontSize: 9, fontWeight: '700', color: '#94A3B8' },

  // por pavimento (planilha: nome · Previsto/Realizado · células de dias)
  pavBlock: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#CBD5E1' },
  pavNameCell: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, borderRightWidth: 1, borderRightColor: '#CBD5E1' },
  pavName: { color: '#0F172A', fontSize: 11, fontWeight: '800', lineHeight: 14, textAlign: 'center' },
  prCol: { borderRightWidth: 1, borderRightColor: '#CBD5E1' },
  prCell: { justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#CBD5E1' },
  prText: { color: '#475569', fontSize: 9, fontWeight: '800' },
  pavGrid: { position: 'relative', borderBottomWidth: 1, borderBottomColor: '#CBD5E1' },
  pavSubRow: { flexDirection: 'row', position: 'relative', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  pavCell: { width: DAY_W, borderRightWidth: 1, borderRightColor: '#CBD5E1' },
  prevCell: { backgroundColor: '#3B82F6' },
  realCell: { backgroundColor: '#4ADE80' },
  cellNum: { position: 'absolute', top: 3, textAlign: 'center', fontSize: 10, lineHeight: 12, fontWeight: '900', color: '#0F172A' },

  todayLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#EF4444' },

  hint: { color: '#94A3B8', fontSize: 11, lineHeight: 16, paddingHorizontal: 18 },
  hintStrong: { color: '#475569', fontWeight: '800' },

  // pill
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 10, fontWeight: '900' },
});

const mod = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '80%' },
  handle: { width: 36, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 2 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, gap: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  headerSub: { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },

  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: 16, paddingTop: 6, gap: 8 },

  totals: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingBottom: 10 },
  totalChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  totalDot: { width: 9, height: 9, borderRadius: 5 },
  totalLabel: { color: '#94A3B8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  totalValue: { color: '#0F172A', fontSize: 13, fontWeight: '900' },

  taskCard: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  taskStripe: { width: 4 },
  taskInner: { flex: 1, padding: 12, gap: 6 },
  taskTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  taskEtapa: { color: '#0F172A', fontSize: 14, fontWeight: '800', flex: 1 },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskMeta: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  taskLate: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },
  taskNote: { color: '#475569', fontSize: 12, fontStyle: 'italic', marginTop: 2 },

  // confirm clear dialog
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', paddingHorizontal: 28 },
  confirmSheet: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, gap: 10, alignItems: 'center' },
  confirmIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  confirmText: { color: '#64748B', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 6 },
  confirmDanger: { flex: 1.6, backgroundColor: '#DC2626' },
});

const form = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8, gap: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.light, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  noticeText: { flex: 1, color: C.primary, fontSize: 11, fontWeight: '700', lineHeight: 15 },
  label: { color: '#334155', fontSize: 12, fontWeight: '800', marginTop: 8, marginBottom: 2 },
  empty: { color: '#94A3B8', fontSize: 12, fontWeight: '600', fontStyle: 'italic', paddingVertical: 6 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { backgroundColor: C.light, borderColor: C.medium },
  chipText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: C.primary },
  aptGroup: { gap: 6, marginBottom: 6 },
  aptGroupLabel: { color: '#94A3B8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  row: { flexDirection: 'row', gap: 12 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A', fontWeight: '600' },
  inputMulti: { minHeight: 60, textAlignVertical: 'top' },

  progressRow: { flexDirection: 'row', gap: 7 },
  progBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  progBtnActive: { backgroundColor: C.light, borderColor: C.medium },
  progText: { color: '#64748B', fontSize: 13, fontWeight: '800' },
  progTextActive: { color: C.primary },

  error: { color: '#B91C1C', fontSize: 12, fontWeight: '700', marginTop: 8 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 13 },
  cancelBtn: { flex: 1, backgroundColor: '#F1F5F9' },
  cancelText: { color: '#475569', fontSize: 14, fontWeight: '800' },
  saveBtn: { flex: 1.6, backgroundColor: C.primary },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
