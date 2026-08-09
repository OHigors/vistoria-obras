import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/src/ui/Text';
import { ReadOnlyBanner } from '@/src/ui/ReadOnlyBanner';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useObras } from '@/src/data/ObrasContext';
import * as db from '@/src/data/db';
import type { Apartment, ChecklistState, Tower } from '@/src/data/mockObras';
import type { Worker } from '@/src/data/serviceWorkers';
import { isScheduledItem, isValidBrDate, maskDateBr, type ScheduledChecklistItem } from '@/src/data/schedule';
import { categoryOrderIndex } from '@/src/data/serviceStages';
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
import { buildCronogramaFromData, getCronogramaStages, type TowerScheduledInput } from '@/src/data/cronogramaReal';
import { getTowerLevel, TOWER_LEVELS } from '@/src/data/towerLevels';
import { useTutorialAnchor, useTutorialScreen } from '@/src/features/tutorial/TutorialContext';
import { Skeleton } from '@/src/ui/Skeleton';
import { useToast } from '@/src/ui/Toast';

// ── Color token (teal) ──────────────────────────────────────────────────────────
const C = { primary: '#0D9488', light: '#F0FDFA', medium: '#14B8A6' } as const;

// ── Escala do eixo ──────────────────────────────────────────────────────────────
// A grade é montada em COLUNAS, não em dias: no "dia" cada coluna é um dia; em
// "semana"/"mês" a coluna agrega o intervalo. Todo o resto (barras, marcadores,
// linha de hoje) trabalha em cima de `columns`, então a troca de escala não
// duplica lógica de desenho.
type Scale = 'dia' | 'semana' | 'mes';
const SCALE_W: Record<Scale, number> = { dia: 34, semana: 52, mes: 60 };
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

type GanttCol = {
  key: string;
  top: string;
  bottom: string;
  startOffset: number; // primeiro dia da coluna (inclusivo)
  endOffset: number;   // primeiro dia FORA da coluna (exclusivo)
  weekend: boolean;    // só existe na escala de dia
};

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
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

const nivelKey = (towerId: string, code: string) => `${towerId}|${code}`;

// Jogo de cores do "Realizado", célula a célula:
//   • âmbar  → tarefa em andamento (ainda não concluída e dentro do prazo)
//   • verde  → dia realizado dentro do previsto (no prazo)
//   • vermelho → dia que excedeu o fim previsto (atraso/dias a mais)
const REAL_GREEN = '#22C55E';
const REAL_AMBER = '#F59E0B';
const REAL_RED = '#EF4444';
// Mesma regra, mas por COLUNA: se o trecho realizado que cai nesta coluna passa
// do fim previsto, a coluna inteira acusa atraso (na escala de dia isso equivale
// exatamente ao comportamento célula a célula de antes).
const realColColor = (t: CronogramaTask, col: GanttCol) => {
  if (t.status === 'Em andamento') return REAL_AMBER;
  const coveredEnd = Math.min(col.endOffset, t.actualEndOffset ?? 0);
  return coveredEnd > t.endOffset ? REAL_RED : REAL_GREEN;
};

// Tom fechado de cada cor da barra: o marcador "i" se apoia nele para pertencer
// à célula em que está, em vez de flutuar como um elemento estranho por cima.
const MARKER_DEEP: Record<string, string> = {
  [REAL_GREEN]: '#15803D',
  [REAL_AMBER]: '#B45309',
  [REAL_RED]: '#B91C1C',
};

// soma dias a uma data BR (DD/MM/YYYY) → nova data BR
function addDaysToBr(br: string, days: number): string {
  const [d, m, y] = br.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

type MainView = 'pavimento' | 'etapa';

// Preferências de visualização. As vars de módulo evitam o "pisca" ao navegar
// dentro da sessão; o AsyncStorage (localStorage na web) mantém a escolha através
// de um refresh da página, que zera o módulo.
const PREFS_KEY = '@cronograma-prefs';
let lastTowerFilter = 'all';
let lastScale: Scale = 'dia';
let lastView: MainView = 'pavimento';

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
  const toast = useToast();
  const { apartments, towers, serviceStages, loading, refreshData, canWrite } = useObras();

  // Inicializa com a última escolha do usuário (persistida em módulo).
  const [view, setView] = useState<MainView>(lastView);
  const [scale, setScale] = useState<Scale>(lastScale);
  const [breakdown, setBreakdown] = useState<{ title: string; sub: string; tasks: CronogramaTask[] } | null>(null);
  const [towerFilter, setTowerFilter] = useState<string>(lastTowerFilter);
  // Hidrata do storage no mount (sobrevive ao refresh da página). Só aplica se
  // ainda for o padrão inicial, para não atropelar uma escolha já feita nesta sessão.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        try {
          const p = JSON.parse(raw) as { towerFilter?: string; scale?: Scale; view?: MainView };
          if (p.towerFilter) setTowerFilter(p.towerFilter);
          if (p.scale) setScale(p.scale);
          if (p.view) setView(p.view);
        } catch {
          // preferência corrompida → ignora
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Persiste a cada mudança (módulo p/ navegação + storage p/ refresh).
  useEffect(() => {
    lastTowerFilter = towerFilter;
    lastScale = scale;
    lastView = view;
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ towerFilter, scale, view })).catch(() => {});
  }, [towerFilter, scale, view]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // dados reais carregados sob demanda (não estão no contexto)
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [assignmentsByApt, setAssignmentsByApt] = useState<Record<string, Record<string, string[]>>>({});
  const [towerScheduled, setTowerScheduled] = useState<TowerScheduledInput[]>([]);
  // O Gantt depende de DUAS cargas assíncronas além do contexto. Sem rastreá-las,
  // a tela mostrava "Nenhuma tarefa com datas" como se fosse resposta enquanto os
  // checklists ainda estavam vindo — e só então as barras apareciam.
  const [checklistLoaded, setChecklistLoaded] = useState(false);
  const [towerLoaded, setTowerLoaded] = useState(false);

  // ── add-task form ──
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CronogramaTask | null>(null);
  const [deletingOne, setDeletingOne] = useState(false);
  const [fScope, setFScope] = useState<'apartamento' | 'nivel'>('apartamento');
  const [fApts, setFApts] = useState<string[]>([]);
  const [fNiveis, setFNiveis] = useState<string[]>([]); // chaves `${towerId}|${levelCode}`
  const [collapsedAptGroups, setCollapsedAptGroups] = useState<Record<string, boolean>>({});
  const [expandedFloors, setExpandedFloors] = useState<Record<string, boolean>>({}); // pavimentos abertos (padrão: fechado)
  const [fStage, setFStage] = useState('');
  const [fStart, setFStart] = useState('');
  const [fDays, setFDays] = useState('');
  const [fResp, setFResp] = useState<string[]>([]);
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

  // Alocações de colaboradores: 1 query da obra inteira, recarregada quando a aba
  // ganha foco (assim edições feitas na tela do apartamento aparecem ao voltar).
  // Antes: 1 request por apartamento (~110), redisparado a cada toque de status
  // porque o array `apartments` trocava de identidade mesmo com a aba em segundo plano.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      db.loadAllStepAssignments()
        .then((a) => alive && setAssignmentsByApt(a))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  // Etapas de nível de torre (com datas) para o "Por pavimento".
  const loadTowerScheduled = useCallback(async () => {
    const results = await Promise.all(
      towers.map((t) =>
        db.loadTowerChecklist(t.id).then((items) => ({ t, items })).catch(() => ({ t, items: [] as db.TowerChecklistItem[] })),
      ),
    );
    const input: TowerScheduledInput[] = [];
    for (const { t, items } of results) {
      for (const item of items) {
        input.push({
          item,
          towerId: t.id,
          levelCode: item.levelCode,
          levelLabel: getTowerLevel(item.levelCode)?.label ?? item.levelCode,
          levelOrder: TOWER_LEVELS.findIndex((l) => l.code === item.levelCode),
        });
      }
    }
    setTowerScheduled(input);
  }, [towers]);

  useEffect(() => {
    let alive = true;
    setTowerLoaded(false);
    loadTowerScheduled()
      .catch(() => {})
      .finally(() => { if (alive) setTowerLoaded(true); });
    return () => { alive = false; };
  }, [loadTowerScheduled]);

  // LAZY: itens de todos os apartamentos, carregados ao FOCAR a aba (o boot não os
  // traz mais). Cronograma não é a aba inicial, então isso só acontece ao abri-la.
  const [checklistByApt, setChecklistByApt] = useState<Map<string, ScheduledChecklistItem[]>>(new Map());
  // O Gantt é montado sobre este mapa. Recarregá-lo é o que faz a tela refletir
  // uma etapa recém-adicionada/removida — sem isso, salvar não muda nada na tela.
  const reloadChecklist = useCallback(async () => {
    const m = await db.loadAllChecklistItems();
    setChecklistByApt(m);
  }, []);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      reloadChecklist()
        .catch(() => {})
        .finally(() => { if (alive) setChecklistLoaded(true); });
      return () => { alive = false; };
    }, [reloadChecklist]),
  );
  const apartmentsFull = useMemo(
    () => apartments.map((a) => ({ ...a, checklist: checklistByApt.get(a.id) ?? [] })),
    [apartments, checklistByApt],
  );

  const result = useMemo(
    () => buildCronogramaFromData(apartmentsFull, serviceStages, workers, assignmentsByApt, towers, towerScheduled),
    [apartmentsFull, serviceStages, workers, assignmentsByApt, towers, towerScheduled],
  );

  // filtro de torre (aplica nas duas abas)
  const towerOptions = useMemo(
    () => [...new Set(result.tasks.map((t) => t.tower).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [result],
  );
  // O cronograma é dividido POR TORRE: mostra uma torre por vez, nunca todas
  // empilhadas. Se o filtro atual não é uma torre válida (estado inicial ou torre
  // que sumiu), cai na primeira — sempre há uma torre em foco.
  const effectiveTower = towerOptions.includes(towerFilter) ? towerFilter : (towerOptions[0] ?? null);
  const visibleTasks = useMemo(
    () => (effectiveTower ? result.tasks.filter((t) => t.tower === effectiveTower) : result.tasks),
    [result, effectiveTower],
  );

  // "Por etapa" ainda não trata níveis de torre — mostra só tarefas de apartamento.
  const aptOnlyTasks = useMemo(() => visibleTasks.filter((t) => t.apartmentId), [visibleTasks]);
  const groups = useMemo(() => {
    if (view === 'pavimento') return buildPavimentoGantt(visibleTasks);
    return selectedCategory ? buildCategoryGantt(aptOnlyTasks, selectedCategory) : [];
  }, [visibleTasks, aptOnlyTasks, view, selectedCategory]);
  const categoryGroups = useMemo(() => getCategoryGroups(aptOnlyTasks), [aptOnlyTasks]);
  const cronStages = useMemo(() => getCronogramaStages(serviceStages), [serviceStages]);

  // apartamentos agrupados por torre/pavimento para o seletor do formulário
  // Apartamentos organizados por Torre → Pavimento (hierarquia do seletor).
  const towerAptGroups = useMemo(() => {
    const byTower = new Map<string, { tower: Tower; floors: Map<string, Apartment[]> }>();
    for (const a of apartments) {
      const tower = towers.find((t) => t.id === a.towerId);
      if (!tower) continue;
      if (!byTower.has(tower.id)) byTower.set(tower.id, { tower, floors: new Map() });
      const g = byTower.get(tower.id)!;
      if (!g.floors.has(a.floor)) g.floors.set(a.floor, []);
      g.floors.get(a.floor)!.push(a);
    }
    const floorNum = (f: string) => Number(f.match(/\d+/)?.[0] ?? 0);
    const towerIdx = (id: string) => {
      const i = towers.findIndex((t) => t.id === id);
      return i < 0 ? 999 : i;
    };
    return [...byTower.values()]
      .sort((x, y) => towerIdx(x.tower.id) - towerIdx(y.tower.id))
      .map(({ tower, floors }) => ({
        tower,
        floors: [...floors.entries()]
          .map(([floor, apts]) => ({ floor, apts: apts.sort((p, q) => p.number.localeCompare(q.number, 'pt-BR', { numeric: true })) }))
          .sort((a, b) => floorNum(a.floor) - floorNum(b.floor)),
      }));
  }, [apartments, towers]);

  // Torres → níveis estruturais (mesmo catálogo do Corte), para o escopo "Níveis".
  const nivelGroups = useMemo(
    () => towers.map((t) => ({ tower: t, levels: TOWER_LEVELS })),
    [towers],
  );

  const stats = useMemo(() => {
    const total = visibleTasks.length;
    const concluidas = visibleTasks.filter((t) => t.status === 'Concluída').length;
    const andamento = visibleTasks.filter((t) => t.status === 'Em andamento').length;
    const atrasadas = visibleTasks.filter((t) => t.status === 'Atrasada').length;
    return { total, concluidas, andamento, atrasadas };
  }, [visibleTasks]);

  // ── Colunas do eixo, conforme a escala ────────────────────────────────────────
  // Folga de 5 dias depois de hoje: com o traço colado na borda direita não dá
  // para ver o que vem a seguir, e é justamente aí que está o trabalho por fazer.
  const TODAY_PAD_DAYS = 5;
  const totalDays = useMemo(
    () => Math.max(result.totalDias, result.hojeOffset + 1 + TODAY_PAD_DAYS),
    [result.totalDias, result.hojeOffset],
  );
  const colW = SCALE_W[scale];
  const columns = useMemo<GanttCol[]>(() => {
    const total = totalDays;
    const dayAt = (i: number) => new Date(result.projectStart.getTime() + i * MS_DAY);

    if (scale === 'dia') {
      return Array.from({ length: total }, (_, i) => {
        const d = dayAt(i);
        const dow = d.getDay();
        return {
          key: `d${i}`,
          top: WEEKDAYS[dow],
          bottom: String(d.getDate()),
          startOffset: i,
          endOffset: i + 1,
          weekend: dow === 0 || dow === 6,
        };
      });
    }

    const cols: GanttCol[] = [];
    let i = 0;
    while (i < total) {
      const d = dayAt(i);
      // semana fecha no sábado; mês fecha no último dia do mês. A primeira e a
      // última coluna podem ser parciais — o projeto raramente começa domingo.
      const span =
        scale === 'semana'
          ? Math.min(7 - d.getDay(), total - i)
          : Math.min(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1, total - i);
      const last = dayAt(i + span - 1);
      cols.push({
        key: `${scale}${i}`,
        top: scale === 'semana' ? MONTHS[d.getMonth()] : String(d.getFullYear()).slice(2),
        bottom: scale === 'semana' ? `${d.getDate()}–${last.getDate()}` : MONTHS[d.getMonth()],
        startOffset: i,
        endOffset: i + span,
        weekend: false,
      });
      i += span;
    }
    return cols;
  }, [result, scale, totalDays]);

  const gridW = columns.length * colW;

  // Dia → índice da coluna. Evita varrer as colunas para cada marcador.
  const colOfDay = useMemo(() => {
    const arr = new Int32Array(Math.max(totalDays, 1));
    columns.forEach((c, idx) => {
      for (let d = c.startOffset; d < c.endOffset; d++) arr[d] = idx;
    });
    return arr;
  }, [columns, totalDays]);

  const todayColIdx = useMemo(
    () => columns.findIndex((c) => result.hojeOffset >= c.startOffset && result.hojeOffset < c.endOffset),
    [columns, result.hojeOffset],
  );

  // Linha de hoje no FIM do dia corrente (não no começo): o traço marca o instante
  // "agora", que é a fronteira entre hoje e amanhã. Em semana/mês ela cai na
  // posição proporcional do dia dentro da coluna, em vez do fim do bloco inteiro —
  // senão apontaria vários dias no futuro.
  const todayX = useMemo(() => {
    if (todayColIdx < 0) return null;
    const c = columns[todayColIdx];
    const span = c.endOffset - c.startOffset;
    return todayColIdx * colW + ((result.hojeOffset - c.startOffset + 1) / span) * colW;
  }, [columns, todayColIdx, colW, result.hojeOffset]);

  // ── Marcadores de término por apartamento ("i" dentro da barra agregada) ──────
  // Cada linha do "Por pavimento" soma várias etapas de vários apartamentos. O
  // marcador fica onde CADA etapa terminou de fato (linha Realizado), agrupado por
  // coluna: se duas terminam no mesmo dia, é um só "i" e o pop-up lista as duas.
  const rowMarkers = useMemo(() => {
    const out = new Map<string, Map<number, CronogramaTask[]>>();
    if (view !== 'pavimento') return out;
    for (const g of groups) {
      for (const r of g.rows) {
        if (!r.breakdown?.length) continue;
        const real = new Map<number, CronogramaTask[]>();
        for (const t of r.breakdown) {
          if (t.actualEndOffset == null) continue;
          const lastDay = t.actualEndOffset - 1;
          if (lastDay < 0 || lastDay >= colOfDay.length) continue;
          const idx = colOfDay[lastDay];
          const list = real.get(idx);
          if (list) list.push(t);
          else real.set(idx, [t]);
        }
        if (real.size) out.set(r.id, real);
      }
    }
    return out;
  }, [groups, view, colOfDay]);

  const breakdownTotals = useMemo(() => {
    if (!breakdown) return null;
    const planned = breakdown.tasks.reduce((acc, t) => acc + t.duracaoDias, 0);
    const withActual = breakdown.tasks.filter((t) => t.actualDias != null);
    const actual = withActual.reduce((acc, t) => acc + (t.actualDias ?? 0), 0);
    return { planned, actual, hasActual: withActual.length > 0 };
  }, [breakdown]);

  // Para cada etapa, conta em quantos dos apartamentos selecionados ela já está
  // NO CRONOGRAMA (com data planejada). Contar a mera presença no checklist
  // estava errado: uma etapa removida do cronograma continua no checklist, então
  // o badge dizia "1 já agendada" mesmo depois de removida. Só conta o que tem
  // data — isScheduledItem — para o número refletir o cronograma de verdade.
  const stageAlreadyCount = useMemo(() => {
    const counts = new Map<string, number>();
    if (fApts.length === 0) return counts;
    const selectedSet = new Set(fApts);
    for (const apt of apartmentsFull) {
      if (!selectedSet.has(apt.id)) continue;
      for (const item of apt.checklist as ScheduledChecklistItem[]) {
        if (!isScheduledItem(item)) continue;
        counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
      }
    }
    return counts;
  }, [apartmentsFull, fApts]);

  // Etapas do cronograma agrupadas por categoria — no formulário de adicionar,
  // em vez de uma parede única de chips. Grupos ordenados pela ordem de execução
  // da categoria (mesma do checklist).
  const cronStagesByCat = useMemo(() => {
    const map = new Map<string, typeof cronStages>();
    for (const st of cronStages) {
      const cat = st.categoria || 'Outras';
      const list = map.get(cat);
      if (list) list.push(st);
      else map.set(cat, [st]);
    }
    return [...map.entries()].sort(
      (a, b) => categoryOrderIndex(a[0]) - categoryOrderIndex(b[0]) || a[0].localeCompare(b[0], 'pt-BR'),
    );
  }, [cronStages]);

  const hasTasks = result.tasks.length > 0;
  // O skeleton precisa cobrir a espera REAL: contexto + checklists + etapas de
  // nível. Só depois disso "nenhuma tarefa" é resposta, e não estado intermediário.
  const isLoading = (loading && apartments.length === 0) || !checklistLoaded || !towerLoaded;

  // Entrega REAL: a entrega prevista trabalha no tempo PLANEJADO (ignora a
  // realidade); a real trabalha no tempo REAL e se ajusta sozinha. A projeção de
  // cada etapa preserva a DURAÇÃO planejada a partir do início real — então um
  // atraso de 3 dias no início/execução empurra o fim dela em 3 dias, e a entrega
  // real (o maior fim entre as etapas) anda junto. Ao concluir, passa a valer o
  // fim real registrado; ao adiantar, a entrega pode voltar. Recomputa a cada
  // recarga de dados e a cada render, então acompanha o passar dos dias.
  const realTimeline = useMemo(() => {
    if (result.tasks.length === 0) return null;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const todayMs = midnight.getTime();
    let startMs = Infinity;
    let endMs = -Infinity;

    for (const t of result.tasks) {
      const startCandidate = (t.actualStart ?? t.start).getTime();
      let projectedEnd: number;
      if (t.actualEnd) {
        // Concluída → vale o que de fato aconteceu (pode ter sido antes ou depois).
        projectedEnd = t.actualEnd.getTime();
      } else {
        const plannedSpan = t.end.getTime() - t.start.getTime();
        // Início efetivo: quando a etapa realmente começa. Não iniciada e já
        // vencido o começo previsto? Só pode arrancar hoje — e isso escorrega
        // mais a cada dia até começar.
        const effStart = t.actualStart ? t.actualStart.getTime() : Math.max(t.start.getTime(), todayMs);
        // Mantém a duração planejada a partir do início real (a propagação do atraso),
        // e nunca projeta um fim no passado para algo ainda em aberto.
        projectedEnd = Math.max(effStart + plannedSpan, todayMs);
      }
      if (startCandidate < startMs) startMs = startCandidate;
      if (projectedEnd > endMs) endMs = projectedEnd;
    }

    const plannedEndMs = result.projectEnd.getTime();
    return {
      start: new Date(startMs),
      end: new Date(endMs),
      delayDays: Math.max(0, Math.round((endMs - plannedEndMs) / MS_DAY)),
      delayed: endMs > plannedEndMs,
    };
  }, [result]);

  // Tutorial: coach marks da primeira visita ao Gantt. Sem tarefas, os passos
  // sem âncora caem no card central — os conceitos valem do mesmo jeito.
  useTutorialScreen('gantt', !isLoading);
  const legendaAnchor = useTutorialAnchor('gantt.legenda');
  const filtrosAnchor = useTutorialAnchor('gantt.filtros');
  // Mesma âncora no botão normal e no do estado vazio — nunca montam juntos.
  const addAnchor = useTutorialAnchor('gantt.add');

  const openAdd = () => {
    if (!canWrite) return;
    setFScope('apartamento');
    setFApts([]);
    setFNiveis([]);
    // Torres fechadas de saída: o formulário abre compacto, e quem quer escolher
    // apartamentos expande só a torre que interessa. A seleção fica visível pelo
    // resumo e pela contagem em cada torre, então fechar não esconde escolhas.
    setCollapsedAptGroups(Object.fromEntries(towers.map((t) => [t.id, true])));
    setExpandedFloors({});
    setFStage('');
    setFStart('');
    setFDays('');
    setFResp([]);
    setFNote('');
    setFError(null);
    setAddOpen(true);
  };

  const toggleResp = (id: string) =>
    setFResp((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const toggleApt = (id: string) =>
    setFApts((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  const toggleGroup = (groupAptIds: string[]) =>
    setFApts((prev) => {
      const allSelected = groupAptIds.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !groupAptIds.includes(id));
      const merged = new Set(prev);
      for (const id of groupAptIds) merged.add(id);
      return [...merged];
    });

  const selectAllApts = () => setFApts(apartments.map((a) => a.id));
  const clearApts = () => setFApts([]);
  const toggleAptCollapse = (key: string) =>
    setCollapsedAptGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleFloor = (key: string) =>
    setExpandedFloors((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleNivel = (key: string) =>
    setFNiveis((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const toggleTowerNiveis = (keys: string[]) =>
    setFNiveis((prev) => {
      const allSelected = keys.every((k) => prev.includes(k));
      if (allSelected) return prev.filter((k) => !keys.includes(k));
      const merged = new Set(prev);
      for (const k of keys) merged.add(k);
      return [...merged];
    });

  const saveTask = async () => {
    if (!canWrite) return;
    if (!fStage) return setFError('Selecione a etapa.');
    if (!isValidBrDate(fStart)) return setFError('Informe uma data de início válida (dd/mm/aaaa).');
    const days = Number(fDays);
    if (!Number.isFinite(days) || days < 1) return setFError('Informe a duração em dias (mínimo 1).');

    const fullStage = serviceStages.find((sg) => sg.nome === fStage);
    if (!fullStage) return setFError('Etapa não encontrada no catálogo.');

    // Data-fim é inclusiva: N dias começando em 01/07 → termina em 01/07 + (N-1).
    const plannedEnd = addDaysToBr(fStart, Math.max(0, Math.round(days) - 1));
    const trimmedNote = fNote.trim();

    // ── Escopo: NÍVEIS de torre ──────────────────────────────────────────────
    if (fScope === 'nivel') {
      if (fNiveis.length === 0) return setFError('Selecione ao menos um nível.');
      setSaving(true);
      setFError(null);
      try {
        await Promise.all(
          fNiveis.map(async (key) => {
            const [towerId, levelCode] = key.split('|');
            // Idempotente: cria a etapa no nível se ainda não existir e devolve o item.
            const created = await db.addTowerChecklistItem({ towerId, levelCode, label: fStage, sortOrder: fullStage.ordemExecucao });
            await db.upsertTowerChecklistItem({
              ...created,
              towerId,
              levelCode,
              comment: trimmedNote || created.comment,
              plannedStart: fStart,
              plannedEnd,
            });
          }),
        );
        await loadTowerScheduled();
        setAddOpen(false);
        toast.saved(fNiveis.length > 1 ? `Tarefa agendada em ${fNiveis.length} níveis` : 'Tarefa adicionada ao cronograma');
      } catch {
        setFError('Não foi possível salvar. Verifique a conexão e tente novamente.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── Escopo: APARTAMENTOS ─────────────────────────────────────────────────
    if (fApts.length === 0) return setFError('Selecione ao menos um apartamento.');
    const chosenApts = apartmentsFull.filter((a) => fApts.includes(a.id));
    if (chosenApts.length === 0) return setFError('Apartamentos não encontrados.');

    // Bloqueia recriar: um apartamento onde a etapa JÁ está no cronograma (com
    // data) é ignorado — adicionar de novo sobrescreveria em silêncio. Para mudar
    // as datas, remova a etapa do cronograma e adicione outra vez.
    const isStageScheduled = (apt: (typeof chosenApts)[number]) => {
      const it = (apt.checklist as ScheduledChecklistItem[]).find((i) => i.label === fStage);
      return Boolean(it && isScheduledItem(it));
    };
    const selectedApts = chosenApts.filter((a) => !isStageScheduled(a));
    if (selectedApts.length === 0) {
      return setFError(
        chosenApts.length === 1
          ? 'Esta etapa já está no cronograma deste apartamento.'
          : 'Esta etapa já está no cronograma de todos os apartamentos selecionados.',
      );
    }

    setSaving(true);
    setFError(null);
    try {
      // 1) cache do id do item por apartamento. Quem já tem a etapa entra direto;
      // quem não tem é criado em lote e depois resolvido via loadChecklist.
      const itemIdByApt = new Map<string, string>();
      for (const apt of selectedApts) {
        const existing = (apt.checklist as ScheduledChecklistItem[]).find((it) => it.label === fStage);
        if (existing) itemIdByApt.set(apt.id, existing.id);
      }
      const missingApts = selectedApts.filter((a) => !itemIdByApt.has(a.id));
      if (missingApts.length) {
        await db.addStageToApartments(fullStage, missingApts.map((a) => a.id));
        const freshLists = await Promise.all(
          missingApts.map(async (a) => [a.id, await db.loadChecklist(a.id)] as const),
        );
        for (const [aptId, items] of freshLists) {
          const item = items.find((it) => it.label === fStage);
          if (item) itemIdByApt.set(aptId, item.id);
        }
      }

      // 2) upsert datas + atribuições em paralelo por apartamento. O status da
      // vistoria é preservado (o cronograma só cuida das datas).
      await Promise.all(
        selectedApts.map(async (apt) => {
          const itemId = itemIdByApt.get(apt.id);
          if (!itemId) throw new Error('item-not-resolved');
          const existing = (apt.checklist as ScheduledChecklistItem[]).find((it) => it.label === fStage);
          await db.upsertChecklistItem({
            id: itemId,
            apartmentId: apt.id,
            label: fStage,
            state: existing?.state ?? 'pending',
            comment: trimmedNote || existing?.comment,
            emergency: existing?.emergency,
            area: existing?.area ?? 'Interior',
            isExtra: existing?.isExtra ?? false,
            plannedStart: fStart,
            plannedEnd,
            actualStart: existing?.actualStart,
            actualEnd: existing?.actualEnd,
          });
          await db.setStepAssignments(apt.id, itemId, fResp);
        }),
      );

      // 3) refresh único do contexto + cache de assignments dos apartamentos tocados.
      await Promise.all([refreshData(), reloadChecklist()]);
      const freshAssignments = await Promise.all(
        selectedApts.map(async (apt) => [apt.id, await db.loadStepAssignments(apt.id)] as const),
      );
      setAssignmentsByApt((prev) => ({ ...prev, ...Object.fromEntries(freshAssignments) }));
      setAddOpen(false);
      toast.saved(selectedApts.length > 1 ? `Tarefa adicionada em ${selectedApts.length} apartamentos` : 'Tarefa adicionada ao cronograma');
    } catch {
      setFError('Não foi possível salvar. Verifique a conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // Remove UMA etapa do cronograma limpando só as datas dela — o item continua
  // no checklist com o mesmo status. Se o breakdown atual ficar vazio, fecha-o.
  const removeOneStep = async () => {
    if (!canWrite) return;
    const target = deleteTarget;
    if (!target) return;
    const apt = apartmentsFull.find((a) => a.id === target.apartmentId);
    const item = (apt?.checklist as ScheduledChecklistItem[] | undefined)?.find((i) => i.id === target.id);
    if (!apt || !item) {
      setDeleteTarget(null);
      return;
    }
    setDeletingOne(true);
    try {
      await db.upsertChecklistItem({
        ...item,
        apartmentId: apt.id,
        plannedStart: undefined,
        plannedEnd: undefined,
        actualStart: undefined,
        actualEnd: undefined,
      });
      await Promise.all([refreshData(), reloadChecklist()]);
      if (breakdown) {
        const remaining = breakdown.tasks.filter((t) => t.id !== target.id);
        if (remaining.length === 0) setBreakdown(null);
        else setBreakdown({ ...breakdown, tasks: remaining });
      }
      setDeleteTarget(null);
    } catch {
      // silencia — mesma política do clearCronograma
    } finally {
      setDeletingOne(false);
    }
  };

  // Modo teste: tira todas as etapas do cronograma limpando as datas (previsto +
  // realizado). As etapas e o status continuam no checklist.
  const clearCronograma = async () => {
    if (!canWrite) return;
    setClearing(true);
    try {
      for (const t of result.tasks) {
        const apt = apartmentsFull.find((a) => a.id === t.apartmentId);
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
      await Promise.all([refreshData(), reloadChecklist()]);
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
            {canWrite && (
              <Pressable onPress={openAdd} style={s.headerAdd} hitSlop={8}>
                <MaterialCommunityIcons name="plus" size={22} color={C.primary} />
              </Pressable>
            )}
          </View>

          {isLoading ? (
            <View style={s.timelineWrap}>
              {[0, 1].map((i) => (
                <View key={i} style={s.timeline}>
                  <View style={s.timelineItem}>
                    <Skeleton width={44} height={9} radius={4} />
                    <Skeleton width={78} height={15} radius={5} style={{ marginTop: 4 }} />
                  </View>
                  <View style={{ flex: 1 }} />
                  <View style={s.timelineItem}>
                    <Skeleton width={80} height={9} radius={4} />
                    <Skeleton width={78} height={15} radius={5} style={{ marginTop: 4 }} />
                  </View>
                </View>
              ))}
            </View>
          ) : hasTasks ? (
            <View style={s.timelineWrap}>
              {/* Planejado */}
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
              {/* Real — o que o cronograma aponta considerando atrasos */}
              {realTimeline && (
                <View style={[s.timeline, realTimeline.delayed && s.timelineReal]}>
                  <View style={s.timelineItem}>
                    <Text style={s.timelineLabel}>Início</Text>
                    <Text style={s.timelineValue}>{formatFull(realTimeline.start)}</Text>
                  </View>
                  <MaterialCommunityIcons name="arrow-right" size={16} color="rgba(255,255,255,0.6)" />
                  <View style={s.timelineItem}>
                    <Text style={s.timelineLabel}>Entrega real</Text>
                    <View style={s.timelineValueRow}>
                      <Text style={s.timelineValue}>{formatFull(realTimeline.end)}</Text>
                      {realTimeline.delayed && (
                        <View style={s.timelineDelay}>
                          <Text style={s.timelineDelayText}>+{realTimeline.delayDays}d</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              )}
            </View>
          ) : null}
        </View>

        {!canWrite && <ReadOnlyBanner />}

        {isLoading ? (
          /* Skeleton com a MESMA forma da tela pronta (KPIs, controles, eixo e
             linhas do Gantt), para nada saltar de lugar quando os dados chegam. */
          <>
            <View style={s.kpiRow}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={62} radius={12} style={{ flex: 1 }} />
              ))}
            </View>
            <Skeleton height={44} radius={12} style={{ marginHorizontal: 16, marginTop: 12 }} />
            <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12 }}>
              <Skeleton height={38} radius={10} style={{ flex: 1 }} />
              <Skeleton height={38} radius={10} style={{ flex: 1 }} />
            </View>
            <View style={s.skelGantt}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Skeleton height={AXIS_H - 10} width={LABEL_W - 10} radius={6} />
                <Skeleton height={AXIS_H - 10} radius={6} style={{ flex: 1 }} />
              </View>
              {[0, 1, 2].map((g) => (
                <View key={g} style={{ gap: 8, marginTop: 12 }}>
                  <Skeleton height={GROUP_H - 16} width="45%" radius={6} />
                  {[0, 1].map((r) => (
                    <View key={r} style={{ flexDirection: 'row', gap: 10 }}>
                      <Skeleton height={PAV_BLOCK_H - 6} width={LABEL_W - 10} radius={6} />
                      <Skeleton height={PAV_BLOCK_H - 6} radius={6} style={{ flex: 1 }} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </>
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
            {canWrite && (
              <Pressable {...addAnchor} onPress={openAdd} style={s.emptyBtn}>
                <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                <Text style={s.emptyBtnText}>Adicionar tarefa</Text>
              </Pressable>
            )}
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
            {canWrite && (
              <>
                <Pressable {...addAnchor} onPress={openAdd} style={s.addBtn}>
                  <MaterialCommunityIcons name="plus-circle-outline" size={18} color={C.primary} />
                  <Text style={s.addBtnText}>Adicionar tarefa ao cronograma</Text>
                </Pressable>

                <Pressable onPress={() => setClearOpen(true)} style={s.clearBtn}>
                  <MaterialCommunityIcons name="trash-can-outline" size={15} color="#B91C1C" />
                  <Text style={s.clearBtnText}>Limpar cronograma (teste)</Text>
                </Pressable>
              </>
            )}

            {/* CONTROLES DO GRÁFICO — Torre (em cima) e Escala (embaixo), agrupados
                acima das tabs. Cada um com o rótulo sobre as opções. */}
            <View style={s.controls} {...filtrosAnchor}>
              {towerOptions.length > 1 && (
                <View style={s.controlBlock}>
                  <Text style={s.controlCaption}>Torre</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.controlChips}>
                    {towerOptions.map((tw) => {
                      const active = effectiveTower === tw;
                      return (
                        <Pressable
                          key={tw}
                          onPress={() => setTowerFilter(tw)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`Ver o cronograma da ${tw}`}
                          style={[s.towerChip, active && s.towerChipActive]}>
                          <Text style={[s.towerChipText, active && s.towerChipTextActive]} numberOfLines={1}>{tw}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <View style={s.controlBlock}>
                <Text style={s.controlCaption}>Escala</Text>
                <View style={s.scaleGroup}>
                  {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']] as const).map(([v, label]) => {
                    const active = scale === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setScale(v)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Ver o cronograma por ${label.toLowerCase()}`}
                        style={[s.scaleBtn, active && s.scaleBtnActive]}>
                        <Text style={[s.scaleText, active && s.scaleTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* VIEW TOGGLE (tabs) */}
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
            <View style={s.legend} {...legendaAnchor}>
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
                      {columns.map((c, i) => {
                        const isToday = i === todayColIdx;
                        return (
                          <View
                            key={c.key}
                            style={[s.axisCell, { width: colW }, c.weekend && s.axisCellWeekend, isToday && s.axisCellToday]}>
                            <Text style={[s.axisDow, isToday && s.axisTextToday]}>{c.top}</Text>
                            <Text style={[s.axisText, isToday && s.axisTextToday]}>{c.bottom}</Text>
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
                          const markers = rowMarkers.get(r.id);
                          return (
                            <View key={r.id} style={[s.pavGrid, { height: PAV_BLOCK_H, width: gridW }]}>
                              {/* Previsto */}
                              <View style={[s.pavSubRow, { height: PAV_SUBROW_H }]}>
                                {columns.map((c) => {
                                  const inRange = t.startOffset < c.endOffset && t.endOffset > c.startOffset;
                                  return (
                                    <View
                                      key={c.key}
                                      style={[s.pavCell, { width: colW }, c.weekend && s.gridCellWeekend, inRange && s.prevCell]}
                                    />
                                  );
                                })}
                              </View>
                              {/* Realizado */}
                              <View style={[s.pavSubRow, { height: PAV_SUBROW_H, borderBottomWidth: 0 }]}>
                                {columns.map((c) => {
                                  const inRange =
                                    hasActual && t.actualStartOffset! < c.endOffset && t.actualEndOffset! > c.startOffset;
                                  return (
                                    <View
                                      key={c.key}
                                      style={[
                                        s.pavCell,
                                        { width: colW },
                                        c.weekend && s.gridCellWeekend,
                                        inRange && { backgroundColor: realColColor(t, c) },
                                      ]}
                                    />
                                  );
                                })}
                                {markers &&
                                  [...markers.entries()].map(([idx, tasks]) => {
                                    const cellColor = realColColor(t, columns[idx]);
                                    return (
                                      <Pressable
                                        key={idx}
                                        onPress={() =>
                                          setBreakdown({ title: r.label, sub: `${g.title} · término real`, tasks })
                                        }
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Ver ${tasks.length} ${tasks.length === 1 ? 'etapa concluída' : 'etapas concluídas'} nesta data`}
                                        style={[s.endMarkerHit, { left: idx * colW, width: colW }]}>
                                        <View
                                          style={[
                                            s.endMarker,
                                            { backgroundColor: MARKER_DEEP[cellColor] ?? cellColor },
                                          ]}>
                                          <MaterialCommunityIcons name="information-variant" size={9} color="#FFFFFF" />
                                        </View>
                                      </Pressable>
                                    );
                                  })}
                              </View>
                              {todayX != null && <View style={[s.todayLine, { left: todayX }]} />}
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
                ? `Cada linha é um grupo de serviços do pavimento, somando o tempo de todas as suas etapas: Previsto (azul) em cima, Realizado (verde/vermelho) embaixo. Toque no "i" para ver qual apartamento concluiu a etapa ali. Cada célula é ${scale === 'dia' ? 'um dia' : scale === 'semana' ? 'uma semana' : 'um mês'}; linha vermelha = hoje.`
                : `Etapas desta categoria, somadas por pavimento (Previsto azul / Realizado verde). Cada célula é ${scale === 'dia' ? 'um dia' : scale === 'semana' ? 'uma semana' : 'um mês'}; linha vermelha = hoje.`}
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
                  {breakdown.tasks.map((t) => {
                    // Apartamento abre a unidade; etapa de nível abre o pavimento
                    // da torre. Sem destino resolvido, o card fica informativo.
                    const href = t.apartmentId
                      ? `/visao-geral/apartamentos/${t.apartmentId}`
                      : t.towerId && t.levelCode
                        ? `/visao-geral/nivel/${t.towerId}/${t.levelCode}`
                        : null;
                    const CardRoot = href ? Pressable : View;
                    return (
                    <CardRoot
                      key={t.id}
                      {...(href
                        ? {
                            onPress: () => { setBreakdown(null); router.push(href as never); },
                            accessibilityRole: 'button' as const,
                            accessibilityLabel: `Abrir ${t.apartmentId ? `apartamento ${t.apartmentNumber}` : t.pavimento}`,
                            style: ({ pressed }: { pressed: boolean }) => [mod.taskCard, pressed && mod.taskCardPressed],
                          }
                        : { style: mod.taskCard })}>
                      <View style={[mod.taskStripe, { backgroundColor: STATUS_COLORS[t.status].bar }]} />
                      <View style={mod.taskInner}>
                        <View style={mod.taskTop}>
                          <Text style={mod.taskEtapa}>{t.tower ? `${t.tower} · ` : ''}{t.apartmentNumber ? `Apto ${t.apartmentNumber} · ` : ''}{t.etapa}</Text>
                          <View style={mod.taskActions}>
                            <StatusPill status={t.status} />
                            <Pressable
                              onPress={() => setDeleteTarget(t)}
                              style={mod.taskDeleteBtn}
                              hitSlop={6}
                              accessibilityLabel="Remover esta tarefa do cronograma">
                              <MaterialCommunityIcons name="trash-can-outline" size={16} color="#B91C1C" />
                            </Pressable>
                          </View>
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
                      {/* seta só onde há destino — separa o card que leva a algum
                          lugar do que é apenas informativo */}
                      {href && (
                        <View style={mod.taskChevron}>
                          <MaterialCommunityIcons name="chevron-right" size={18} color="#CBD5E1" />
                        </View>
                      )}
                    </CardRoot>
                    );
                  })}
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
                  <Text style={mod.headerSub}>
                    {fScope === 'apartamento' ? 'Atribua uma etapa a um ou mais apartamentos' : 'Agende uma etapa em um ou mais níveis das torres'}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setAddOpen(false)} style={mod.closeBtn} hitSlop={8}>
                <MaterialCommunityIcons name="close" size={18} color="#475569" />
              </Pressable>
            </View>

            <ScrollView style={form.scroll} contentContainerStyle={form.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* ── LOCAL ── */}
              <View style={form.sectionHead}>
                <MaterialCommunityIcons name="map-marker-outline" size={15} color={C.primary} />
                <Text style={form.sectionTitle}>Local</Text>
                {(fScope === 'apartamento' ? fApts.length : fNiveis.length) > 0 && (
                  <View style={form.selBadge}>
                    <Text style={form.selBadgeText}>
                      {fScope === 'apartamento'
                        ? `${fApts.length} apto(s)`
                        : `${fNiveis.length} nível(is)`}
                    </Text>
                  </View>
                )}
              </View>

              {/* Escopo: apartamentos ou níveis */}
              <View style={form.scopeToggle}>
                {([['apartamento', 'Apartamentos', 'door'], ['nivel', 'Níveis', 'layers-triple-outline']] as const).map(([v, label, icon]) => {
                  const active = fScope === v;
                  return (
                    <Pressable key={v} onPress={() => setFScope(v)} style={[form.scopeBtn, active && form.scopeBtnActive]}>
                      <MaterialCommunityIcons name={icon} size={15} color={active ? C.primary : '#94A3B8'} />
                      <Text style={[form.scopeText, active && form.scopeTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {fScope === 'apartamento' ? (
                <>
                  <View style={form.bulkRow}>
                    <Pressable onPress={selectAllApts} style={form.bulkBtn}>
                      <MaterialCommunityIcons name="checkbox-multiple-marked-outline" size={13} color={C.primary} />
                      <Text style={form.bulkText}>Selecionar todos</Text>
                    </Pressable>
                    <Pressable onPress={clearApts} disabled={fApts.length === 0} style={[form.bulkBtn, fApts.length === 0 && { opacity: 0.5 }]}>
                      <MaterialCommunityIcons name="close-circle-outline" size={13} color="#64748B" />
                      <Text style={[form.bulkText, { color: '#64748B' }]}>Limpar</Text>
                    </Pressable>
                  </View>
                  {towerAptGroups.map((tg) => {
                    const towerIds = tg.floors.flatMap((f) => f.apts.map((a) => a.id));
                    const selInTower = towerIds.filter((id) => fApts.includes(id)).length;
                    const towerAll = towerIds.length > 0 && selInTower === towerIds.length;
                    const collapsed = collapsedAptGroups[tg.tower.id] === true;
                    return (
                      <View key={tg.tower.id} style={form.towerBlock}>
                        <View style={form.aptGroupHead}>
                          <Pressable onPress={() => toggleGroup(towerIds)} style={form.aptGroupSelect} hitSlop={6}>
                            <MaterialCommunityIcons
                              name={towerAll ? 'checkbox-marked' : selInTower > 0 ? 'checkbox-intermediate' : 'checkbox-blank-outline'}
                              size={16}
                              color={selInTower > 0 ? C.primary : '#94A3B8'}
                            />
                            <MaterialCommunityIcons name="office-building-outline" size={14} color="#64748B" />
                            <Text style={form.towerName}>{tg.tower.name}</Text>
                          </Pressable>
                          {selInTower > 0 && <Text style={form.aptGroupCount}>{selInTower}/{towerIds.length}</Text>}
                          <Pressable onPress={() => toggleAptCollapse(tg.tower.id)} hitSlop={8} style={form.aptGroupChevron}>
                            <MaterialCommunityIcons name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color="#94A3B8" />
                          </Pressable>
                        </View>
                        {!collapsed && tg.floors.map((f) => {
                          const floorIds = f.apts.map((a) => a.id);
                          const selInFloor = floorIds.filter((id) => fApts.includes(id)).length;
                          const floorAll = selInFloor === floorIds.length;
                          const fKey = `${tg.tower.id}|${f.floor}`;
                          const floorOpen = expandedFloors[fKey] === true;
                          return (
                            <View key={f.floor} style={form.floorBlock}>
                              <View style={form.floorHead}>
                                <Pressable onPress={() => toggleGroup(floorIds)} style={form.floorSelect} hitSlop={6}>
                                  <MaterialCommunityIcons
                                    name={floorAll ? 'checkbox-marked' : selInFloor > 0 ? 'checkbox-intermediate' : 'checkbox-blank-outline'}
                                    size={14}
                                    color={selInFloor > 0 ? C.primary : '#CBD5E1'}
                                  />
                                  <Text style={form.floorLabel}>{f.floor}</Text>
                                  <Text style={form.floorMeta}>· {floorIds.length} apto(s)</Text>
                                  {selInFloor > 0 && <Text style={form.floorCount}>{selInFloor}/{floorIds.length}</Text>}
                                </Pressable>
                                <Pressable onPress={() => toggleFloor(fKey)} hitSlop={8} style={form.aptGroupChevron}>
                                  <MaterialCommunityIcons name={floorOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
                                </Pressable>
                              </View>
                              {floorOpen && (
                                <View style={form.chipsWrap}>
                                  {f.apts.map((a) => {
                                    const active = fApts.includes(a.id);
                                    return (
                                      <Pressable key={a.id} onPress={() => toggleApt(a.id)} style={[form.chip, active && form.chipActive]}>
                                        {active && <MaterialCommunityIcons name="check" size={13} color={C.primary} style={{ marginRight: 4 }} />}
                                        <Text style={[form.chipText, active && form.chipTextActive]}>Apto {a.number}</Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </>
              ) : nivelGroups.length === 0 ? (
                <Text style={form.empty}>Nenhuma torre cadastrada.</Text>
              ) : (
                nivelGroups.map(({ tower: t, levels }) => {
                  const keys = levels.map((l) => nivelKey(t.id, l.code));
                  const selectedInTower = keys.filter((k) => fNiveis.includes(k)).length;
                  const allSelected = selectedInTower === keys.length;
                  const collapsed = collapsedAptGroups[t.id] === true;
                  return (
                    <View key={t.id} style={form.towerBlock}>
                      <View style={form.aptGroupHead}>
                        <Pressable onPress={() => toggleTowerNiveis(keys)} style={form.aptGroupSelect} hitSlop={6}>
                          <MaterialCommunityIcons
                            name={allSelected ? 'checkbox-marked' : selectedInTower > 0 ? 'checkbox-intermediate' : 'checkbox-blank-outline'}
                            size={16}
                            color={selectedInTower > 0 ? C.primary : '#94A3B8'}
                          />
                          <MaterialCommunityIcons name="office-building-outline" size={14} color="#64748B" />
                          <Text style={form.towerName}>{t.name}</Text>
                        </Pressable>
                        {selectedInTower > 0 && <Text style={form.aptGroupCount}>{selectedInTower}/{keys.length}</Text>}
                        <Pressable onPress={() => toggleAptCollapse(t.id)} hitSlop={8} style={form.aptGroupChevron}>
                          <MaterialCommunityIcons name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color="#94A3B8" />
                        </Pressable>
                      </View>
                      {!collapsed && (
                        <View style={form.chipsWrap}>
                          {levels.map((l) => {
                            const key = nivelKey(t.id, l.code);
                            const active = fNiveis.includes(key);
                            return (
                              <Pressable key={key} onPress={() => toggleNivel(key)} style={[form.chip, active && form.chipActive]}>
                                {active && <MaterialCommunityIcons name="check" size={13} color={C.primary} style={{ marginRight: 4 }} />}
                                <Text style={[form.chipText, active && form.chipTextActive]}>{l.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })
              )}

              {/* ── ETAPA ── */}
              <View style={[form.sectionHead, form.sectionDivided]}>
                <MaterialCommunityIcons name="hammer-wrench" size={15} color={C.primary} />
                <Text style={form.sectionTitle}>Etapa</Text>
              </View>
              {cronStages.length === 0 ? (
                <Text style={form.empty}>Nenhuma etapa de cronograma cadastrada no catálogo.</Text>
              ) : (
                // Agrupadas por categoria: cada grupo com um subtítulo e seus chips,
                // em vez de uma parede única de etapas soltas.
                cronStagesByCat.map(([cat, stages]) => (
                  <View key={cat} style={form.stageGroup}>
                    <Text style={form.stageGroupLabel}>{cat}</Text>
                    <View style={form.chipsWrap}>
                      {stages.map((e) => {
                        const active = e.nome === fStage;
                        const already = stageAlreadyCount.get(e.nome) ?? 0;
                        return (
                          <Pressable key={e.id} onPress={() => setFStage(e.nome)} style={[form.chip, active && form.chipActive]}>
                            <Text style={[form.chipText, active && form.chipTextActive]} numberOfLines={1}>{e.nome}</Text>
                            {already > 0 && (
                              <View style={form.chipBadge}>
                                <Text style={form.chipBadgeText}>{already} já agendada(s)</Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}

              {/* ── PRAZO ── */}
              <View style={[form.sectionHead, form.sectionDivided]}>
                <MaterialCommunityIcons name="calendar-range" size={15} color={C.primary} />
                <Text style={form.sectionTitle}>Prazo</Text>
              </View>
              <View style={form.row}>
                <View style={{ flex: 1.4 }}>
                  <Text style={form.fieldLabel}>Início</Text>
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
                  <Text style={form.fieldLabel}>Duração (dias)</Text>
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

              {/* ── RESPONSÁVEIS (só apartamentos têm atribuição) ── */}
              {fScope === 'apartamento' && (
                <>
                  <View style={[form.sectionHead, form.sectionDivided]}>
                    <MaterialCommunityIcons name="account-hard-hat" size={15} color={C.primary} />
                    <Text style={form.sectionTitle}>Responsáveis</Text>
                    <Text style={form.sectionOptional}>opcional</Text>
                  </View>
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
                </>
              )}

              {/* ── OBSERVAÇÃO ── */}
              <View style={[form.sectionHead, form.sectionDivided]}>
                <MaterialCommunityIcons name="note-text-outline" size={15} color={C.primary} />
                <Text style={form.sectionTitle}>Observação</Text>
                <Text style={form.sectionOptional}>opcional</Text>
              </View>
              <TextInput
                value={fNote}
                onChangeText={setFNote}
                placeholder="Anotações sobre a tarefa…"
                placeholderTextColor="#94A3B8"
                multiline
                style={[form.input, form.inputMulti]}
              />

              {!!fError && (
                <View style={form.errorBox}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={15} color="#B91C1C" />
                  <Text style={form.error}>{fError}</Text>
                </View>
              )}
            </ScrollView>

            {/* Rodapé fixo: a ação principal fica sempre à mão, sem rolar o formulário */}
            <View style={[form.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Pressable onPress={() => setAddOpen(false)} disabled={saving} style={[form.actionBtn, form.cancelBtn]}>
                <Text style={form.cancelText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={saveTask} disabled={saving} style={[form.actionBtn, form.saveBtn, saving && { opacity: 0.7 }]}>
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" />
                )}
                <Text style={form.saveText}>
                  {saving
                    ? 'Salvando…'
                    : fScope === 'nivel'
                      ? (fNiveis.length > 1 ? `Salvar em ${fNiveis.length} níveis` : 'Salvar no nível')
                      : (fApts.length > 1 ? `Salvar em ${fApts.length} aptos` : 'Salvar tarefa')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── CONFIRM REMOVE ONE STEP ─────────────────────────────────────────── */}
      <Modal animationType="fade" transparent visible={!!deleteTarget} onRequestClose={() => setDeleteTarget(null)}>
        <Pressable style={mod.confirmBackdrop} onPress={() => setDeleteTarget(null)}>
          <Pressable style={mod.confirmSheet} onPress={(e) => e.stopPropagation()}>
            <View style={mod.confirmIcon}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#B91C1C" />
            </View>
            <Text style={mod.confirmTitle}>Remover tarefa?</Text>
            <Text style={mod.confirmText}>
              {deleteTarget
                ? `Vai limpar as datas de "${deleteTarget.etapa}" no apto ${deleteTarget.apartmentNumber}. A etapa continua no checklist — só sai do cronograma.`
                : ''}
            </Text>
            <View style={mod.confirmActions}>
              <Pressable onPress={() => setDeleteTarget(null)} disabled={deletingOne} style={[form.actionBtn, form.cancelBtn]}>
                <Text style={form.cancelText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={removeOneStep} disabled={deletingOne} style={[form.actionBtn, mod.confirmDanger, deletingOne && { opacity: 0.7 }]}>
                {deletingOne ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#FFFFFF" />
                )}
                <Text style={form.saveText}>{deletingOne ? 'Removendo…' : 'Remover'}</Text>
              </Pressable>
            </View>
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
  headerAdd: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },

  timelineWrap: { gap: 8 },
  timeline: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 12 },
  // bloco "real" quando há atraso — borda âmbar destaca que a entrega escorregou
  timelineReal: { borderWidth: 1, borderColor: 'rgba(251,191,36,0.7)' },
  timelineItem: { gap: 2 },
  timelineLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  timelineValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  timelineValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timelineDelay: { backgroundColor: '#F59E0B', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  timelineDelayText: { color: '#3F2D00', fontSize: 11, fontWeight: '900' },

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

  // Torre — controle primário (o cronograma mostra uma torre por vez)
  // controles agrupados (Torre em cima, Escala embaixo) acima das tabs
  controls: { marginHorizontal: 16, marginTop: 12, gap: 12 },
  controlBlock: { gap: 7 },
  controlCaption: { color: '#94A3B8', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  controlChips: { flexDirection: 'row', gap: 7, paddingRight: 16 },
  towerChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  towerChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  towerChipText: { color: '#64748B', fontSize: 12.5, fontWeight: '700' },
  towerChipTextActive: { color: '#FFFFFF', fontWeight: '800' },

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

  // marcador de término de uma etapa individual dentro da barra somada
  endMarkerHit: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  // fundo = tom fechado da própria célula (definido inline); o anel claro apenas
  // destaca o marcador do preenchimento da barra, sem virar um corpo estranho
  endMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // escala do eixo (dia · semana · mês)
  scaleGroup: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: '#F1F5F9', borderRadius: 999, padding: 3, gap: 2 },
  scaleBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, minHeight: 32, justifyContent: 'center' },
  scaleBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1' },
  scaleText: { color: '#64748B', fontSize: 12.5, fontWeight: '700' },
  scaleTextActive: { color: C.primary, fontWeight: '800' },

  // skeleton do gantt
  skelGantt: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
  },

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
  taskCardPressed: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
  taskStripe: { width: 4 },
  taskInner: { flex: 1, padding: 12, gap: 6 },
  taskChevron: { justifyContent: 'center', paddingRight: 8, paddingLeft: 2 },
  taskTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  taskEtapa: { color: '#0F172A', fontSize: 14, fontWeight: '800', flex: 1 },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskDeleteBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center' },
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
  // ScrollView flexível: cede espaço ao rodapé fixo quando o formulário é longo.
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8, gap: 8 },

  // cabeçalho de seção (Local · Etapa · Prazo · …) — dá âncoras ao olho e quebra
  // o formulário longo em blocos, em vez de um fluxo único e denso
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionDivided: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 16, marginTop: 12 },
  sectionTitle: { flex: 1, color: '#0F172A', fontSize: 14, fontWeight: '900' },
  sectionOptional: { color: '#94A3B8', fontSize: 11, fontWeight: '700' },
  selBadge: { backgroundColor: C.light, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  selBadgeText: { color: C.primary, fontSize: 11.5, fontWeight: '800' },
  fieldLabel: { color: '#64748B', fontSize: 12, fontWeight: '700', marginBottom: 4 },

  empty: { color: '#94A3B8', fontSize: 12, fontWeight: '600', fontStyle: 'italic', paddingVertical: 6 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { backgroundColor: C.light, borderColor: C.medium },
  chipText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: C.primary },
  scopeToggle: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, gap: 3, marginTop: 4 },
  scopeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8 },
  scopeBtnActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  scopeText: { color: '#94A3B8', fontSize: 13, fontWeight: '800' },
  scopeTextActive: { color: C.primary },

  aptGroup: { gap: 6, marginBottom: 6 },
  aptGroupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  aptGroupSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  aptGroupChevron: { padding: 2 },
  aptGroupLabel: { color: '#94A3B8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  aptGroupCount: { color: C.primary, fontSize: 10, fontWeight: '800' },

  // hierarquia Torre → Pavimento → Aptos
  towerBlock: { gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  towerName: { color: '#0F172A', fontSize: 13, fontWeight: '900' },
  floorBlock: { gap: 6, marginLeft: 10, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#F1F5F9' },
  floorHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  floorSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  floorLabel: { color: '#475569', fontSize: 11.5, fontWeight: '800' },
  floorMeta: { color: '#94A3B8', fontSize: 10.5, fontWeight: '600' },
  floorCount: { color: C.primary, fontSize: 10, fontWeight: '800', marginLeft: 'auto' },
  aptHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  aptCount: { color: C.primary, fontSize: 11, fontWeight: '800' },
  bulkRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  bulkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  bulkText: { color: C.primary, fontSize: 11, fontWeight: '800' },
  chipBadge: { marginLeft: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: '#FEF3C7' },
  chipBadgeText: { color: '#92400E', fontSize: 9, fontWeight: '800' },
  // etapas agrupadas por categoria no formulário de adicionar
  stageGroup: { gap: 7, marginTop: 4 },
  stageGroupLabel: { color: '#64748B', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },

  row: { flexDirection: 'row', gap: 12 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A', fontWeight: '600' },
  inputMulti: { minHeight: 60, textAlignVertical: 'top' },

  progressRow: { flexDirection: 'row', gap: 7 },
  progBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  progBtnActive: { backgroundColor: C.light, borderColor: C.medium },
  progText: { color: '#64748B', fontSize: 13, fontWeight: '800' },
  progTextActive: { color: C.primary },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, padding: 10, marginTop: 14 },
  error: { flex: 1, color: '#B91C1C', fontSize: 12, fontWeight: '700' },

  // rodapé fixo (fora do ScrollView): a ação principal nunca fica soterrada
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 13 },
  cancelBtn: { flex: 1, backgroundColor: '#F1F5F9' },
  cancelText: { color: '#475569', fontSize: 14, fontWeight: '800' },
  saveBtn: { flex: 1.6, backgroundColor: C.primary },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
