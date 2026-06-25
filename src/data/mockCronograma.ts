// ─── Mock Cronograma de Obra (Go Builder–style) ──────────────────────────────────
// O cronograma agora é montado a partir de TAREFAS atribuídas a cada apartamento.
// Uma etapa só aparece no cronograma se foi atribuída ao apartamento (assignment).
//
// Cada tarefa carrega: data de início, duração (nº de dias), responsáveis e progresso.
// end = início + duração. Status é derivado das datas + progresso vs. hoje.
// Nenhuma tabela real é criada — tudo mock/in-memory.

export type CronogramaStatus = 'Planejada' | 'Em andamento' | 'Atrasada' | 'Concluída';

export type CronogramaTask = {
  id: string;
  apartmentId: string;
  apartmentNumber: string;
  pavimento: string;
  pavimentoOrder: number;
  tower?: string;
  etapaId: string;
  etapa: string;
  etapaAbrev: string;
  ordem: number;
  responsibles: string[];
  funcao: string;
  startOffset: number; // dias desde o início do cronograma
  duracaoDias: number;
  endOffset: number; // = startOffset + duracaoDias
  start: Date;
  end: Date;
  status: CronogramaStatus;
  executadoPct: number; // 0..1
  atrasoDias: number;
  // Realizado (tempo real): vem das datas de execução (actual_start / actual_end).
  actualStart?: Date;
  actualEnd?: Date;
  actualStartOffset?: number;
  actualEndOffset?: number;
  actualDias?: number;
  note?: string;
};

export type GanttRow = { id: string; apartmentId: string; label: string; sub: string; tasks: CronogramaTask[] };
export type GanttGroup = { id: string; title: string; sub: string; ordem: number; rows: GanttRow[] };

export type CronogramaResult = {
  tasks: CronogramaTask[];
  projectStart: Date;
  projectEnd: Date;
  totalDias: number;
  hojeOffset: number;
};

// ─── Catálogos (para os seletores do formulário) ─────────────────────────────────

export type EtapaCatalog = { id: string; nome: string; abrev: string; ordem: number; funcao: string };

// 18 etapas = os mesmos serviços do checklist real, em ordem construtiva.
export const ETAPAS: EtapaCatalog[] = [
  { id: 'imp-ban', nome: 'Impermeabilização do banheiro', abrev: 'Imp.Ban', ordem: 1, funcao: 'Impermeabilização' },
  { id: 'imp-as', nome: 'Impermeabilização da área de serviço', abrev: 'Imp.Áre', ordem: 2, funcao: 'Impermeabilização' },
  { id: 'imp-coz', nome: 'Impermeabilização da cozinha', abrev: 'Imp.Coz', ordem: 3, funcao: 'Impermeabilização' },
  { id: 'cpiso', nome: 'Contrapiso da laje técnica', abrev: 'C.Piso', ordem: 4, funcao: 'Contrapiso' },
  { id: 'hid', nome: 'Hidráulica', abrev: 'Hidr', ordem: 5, funcao: 'Hidráulica' },
  { id: 'ac', nome: 'Ar-condicionado', abrev: 'AC', ordem: 6, funcao: 'Climatização' },
  { id: 'shaft', nome: 'Shaft churrasqueira/cozinha/banheiro', abrev: 'Shaft', ordem: 7, funcao: 'Prumadas / Shaft' },
  { id: 'requad', nome: 'Requadração monocapa da viga da sacada', abrev: 'Requad', ordem: 8, funcao: 'Fachada' },
  { id: 'cmarco', nome: 'Contramarco da cobertura', abrev: 'C.Marco', ordem: 9, funcao: 'Serralheria' },
  { id: 'ges-ext', nome: 'Gesso externo', abrev: 'Ges.Ext', ordem: 10, funcao: 'Gesso' },
  { id: 'ges-ban', nome: 'Gesso banheiro', abrev: 'Ges.Ban', ordem: 11, funcao: 'Gesso' },
  { id: 'forro-g', nome: 'Forro de gesso cozinha/banheiro/corredor', abrev: 'Forro', ordem: 12, funcao: 'Forro' },
  { id: 'forro-sac', nome: 'Forro sacada', abrev: 'F.Sac', ordem: 13, funcao: 'Forro' },
  { id: 'fech-chur', nome: 'Fechamento da churrasqueira em gesso', abrev: 'F.Chur', ordem: 14, funcao: 'Gesso' },
  { id: 'rem-ges', nome: 'Remoção de excesso de gesso', abrev: 'Lim.Ges', ordem: 15, funcao: 'Gesso' },
  { id: 'gcorpo', nome: 'Instalação do guarda-corpo da sacada', abrev: 'G.Corpo', ordem: 16, funcao: 'Serralheria' },
  { id: 'pedra', nome: 'Reparo de pedra', abrev: 'Pedra', ordem: 17, funcao: 'Marmoraria' },
  { id: 'limp', nome: 'Limpeza', abrev: 'Limp', ordem: 18, funcao: 'Limpeza / Entrega' },
];

export type WorkerCatalog = { id: string; nome: string; funcao: string };

export const WORKERS: WorkerCatalog[] = [
  { id: 'w1', nome: 'Sandro Lima', funcao: 'Impermeabilização' },
  { id: 'w2', nome: 'Carlos Éder', funcao: 'Hidráulica' },
  { id: 'w3', nome: 'Rui Barbosa', funcao: 'Elétrica / Climatização' },
  { id: 'w4', nome: 'Diego Matos', funcao: 'Contrapiso / Pisos' },
  { id: 'w5', nome: 'Pedro Antunes', funcao: 'Gesso' },
  { id: 'w6', nome: 'Anderson Reis', funcao: 'Fachada' },
  { id: 'w7', nome: 'Felipe Nunes', funcao: 'Serralheria' },
  { id: 'w8', nome: 'Marta Coelho', funcao: 'Marmoraria' },
  { id: 'w9', nome: 'Joana Vidal', funcao: 'Limpeza / Entrega' },
  { id: 'w10', nome: 'Marcos Vieira', funcao: 'Prumadas / Shaft' },
];

export type AptCatalog = { id: string; numero: string; pavimento: string; pavimentoOrder: number };

export const APARTAMENTOS: AptCatalog[] = [
  { id: 'ap-11', numero: '11', pavimento: '1º Pavimento', pavimentoOrder: 1 },
  { id: 'ap-12', numero: '12', pavimento: '1º Pavimento', pavimentoOrder: 1 },
  { id: 'ap-24', numero: '24', pavimento: '2º Pavimento', pavimentoOrder: 2 },
];

// ─── Tarefas atribuídas (assignments) ────────────────────────────────────────────

export type CronogramaAssignment = {
  id: string;
  apartmentId: string;
  etapaId: string;
  startDate: string; // ISO 'aaaa-mm-dd'
  durationDays: number;
  responsibleIds: string[];
  progress: number; // 0..1
  note?: string;
};

// Semente: nem todo apartamento tem todas as etapas — só aparece o que foi atribuído.
export const MOCK_ASSIGNMENTS: CronogramaAssignment[] = [
  { id: 'a1', apartmentId: 'ap-11', etapaId: 'imp-ban', startDate: '2026-06-02', durationDays: 2, responsibleIds: ['w1'], progress: 1 },
  { id: 'a2', apartmentId: 'ap-11', etapaId: 'hid', startDate: '2026-06-05', durationDays: 3, responsibleIds: ['w2'], progress: 1 },
  { id: 'a3', apartmentId: 'ap-11', etapaId: 'ac', startDate: '2026-06-10', durationDays: 2, responsibleIds: ['w3'], progress: 1 },
  { id: 'a4', apartmentId: 'ap-11', etapaId: 'ges-ext', startDate: '2026-06-18', durationDays: 2, responsibleIds: ['w5'], progress: 0.5, note: 'Aguardando liberação do forro.' },
  { id: 'a5', apartmentId: 'ap-11', etapaId: 'gcorpo', startDate: '2026-06-23', durationDays: 2, responsibleIds: ['w7'], progress: 0 },
  { id: 'a6', apartmentId: 'ap-24', etapaId: 'imp-ban', startDate: '2026-06-08', durationDays: 2, responsibleIds: ['w1'], progress: 1 },
  { id: 'a7', apartmentId: 'ap-24', etapaId: 'hid', startDate: '2026-06-12', durationDays: 3, responsibleIds: ['w2'], progress: 1 },
  { id: 'a8', apartmentId: 'ap-24', etapaId: 'cpiso', startDate: '2026-06-17', durationDays: 2, responsibleIds: ['w4'], progress: 0.4, note: 'Cura do contrapiso em andamento.' },
  { id: 'a9', apartmentId: 'ap-24', etapaId: 'ac', startDate: '2026-06-22', durationDays: 2, responsibleIds: ['w3'], progress: 0 },
  { id: 'a10', apartmentId: 'ap-12', etapaId: 'imp-ban', startDate: '2026-06-05', durationDays: 2, responsibleIds: ['w1'], progress: 1 },
  { id: 'a11', apartmentId: 'ap-12', etapaId: 'hid', startDate: '2026-06-10', durationDays: 3, responsibleIds: ['w2', 'w10'], progress: 0.3, note: 'Atrasou pela prumada do shaft.' },
  { id: 'a12', apartmentId: 'ap-12', etapaId: 'requad', startDate: '2026-06-24', durationDays: 2, responsibleIds: ['w6'], progress: 0 },
];

// ─── Date helpers ────────────────────────────────────────────────────────────────

const MS_DAY = 24 * 60 * 60 * 1000;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (base: Date, days: number) => new Date(base.getTime() + days * MS_DAY);
const diffDays = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / MS_DAY);

const parseISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const brToISO = (br: string) => {
  const [d, m, y] = br.split('/');
  return `${y}-${m}-${d}`;
};

export const isoToBr = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export const formatShort = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

export const formatFull = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

// ─── Engine ────────────────────────────────────────────────────────────────────

export function buildCronograma(assignments: CronogramaAssignment[]): CronogramaResult {
  const today = startOfToday();

  if (assignments.length === 0) {
    return { tasks: [], projectStart: today, projectEnd: today, totalDias: 1, hojeOffset: 0 };
  }

  const resolved = assignments.map((a) => {
    const etapa = ETAPAS.find((e) => e.id === a.etapaId);
    const apt = APARTAMENTOS.find((p) => p.id === a.apartmentId);
    const start = parseISO(a.startDate);
    const end = addDays(start, a.durationDays);
    const responsibles = a.responsibleIds.map((id) => WORKERS.find((w) => w.id === id)?.nome ?? id);
    return { a, etapa, apt, start, end, responsibles };
  });

  const projectStart = new Date(Math.min(...resolved.map((r) => r.start.getTime())));
  const projectEnd = new Date(Math.max(...resolved.map((r) => r.end.getTime())));
  const totalDias = Math.max(1, diffDays(projectStart, projectEnd));
  const hojeOffset = Math.max(0, Math.min(totalDias, diffDays(projectStart, today)));

  const tasks: CronogramaTask[] = resolved.map(({ a, etapa, apt, start, end, responsibles }) => {
    const startOffset = diffDays(projectStart, start);
    const endOffset = startOffset + a.durationDays;

    let status: CronogramaStatus;
    let atrasoDias = 0;
    if (a.progress >= 1) {
      status = 'Concluída';
    } else if (end.getTime() < today.getTime()) {
      status = 'Atrasada';
      atrasoDias = diffDays(end, today);
    } else if (a.progress > 0 || start.getTime() <= today.getTime()) {
      status = 'Em andamento';
    } else {
      status = 'Planejada';
    }

    return {
      id: a.id,
      apartmentId: apt?.id ?? a.apartmentId,
      apartmentNumber: apt?.numero ?? '??',
      pavimento: apt?.pavimento ?? '—',
      pavimentoOrder: apt?.pavimentoOrder ?? 0,
      etapaId: etapa?.id ?? a.etapaId,
      etapa: etapa?.nome ?? a.etapaId,
      etapaAbrev: etapa?.abrev ?? '—',
      ordem: etapa?.ordem ?? 0,
      responsibles,
      funcao: etapa?.funcao ?? '',
      startOffset,
      duracaoDias: a.durationDays,
      endOffset,
      start,
      end,
      status,
      executadoPct: a.progress,
      atrasoDias,
      note: a.note,
    };
  });

  return { tasks, projectStart, projectEnd, totalDias, hojeOffset };
}

// ─── Agrupamentos para o Gantt ───────────────────────────────────────────────────

// Uma tarefa por linha (uma linha = um apartamento × etapa). O nome completo da
// etapa fica no rótulo da esquerda (que pode quebrar em 2 linhas), evitando
// abreviações ilegíveis dentro da barra.
export function buildGantt(tasks: CronogramaTask[], mode: 'pavimento' | 'etapa'): GanttGroup[] {
  const respLabel = (t: CronogramaTask) =>
    t.responsibles[0]
      ? `${t.responsibles[0]}${t.responsibles.length > 1 ? ` +${t.responsibles.length - 1}` : ''}`
      : 'Sem responsável';

  if (mode === 'pavimento') {
    const byKey = new Map<string, CronogramaTask[]>();
    for (const t of tasks) {
      const key = `${t.tower ?? ''}||${t.pavimento}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(t);
    }
    return [...byKey.entries()]
      .map(([key, list]) => {
        const f = list[0];
        const rows: GanttRow[] = [...list]
          .sort(
            (a, b) =>
              a.apartmentNumber.localeCompare(b.apartmentNumber, 'pt-BR', { numeric: true }) || a.ordem - b.ordem,
          )
          .map((t) => ({
            id: t.id,
            apartmentId: t.apartmentId,
            label: `Apto ${t.apartmentNumber} · ${t.etapa}`,
            sub: respLabel(t),
            tasks: [t],
          }));
        const count = `${rows.length} ${rows.length === 1 ? 'etapa' : 'etapas'}`;
        return { id: key, title: f.pavimento, sub: count, ordem: f.pavimentoOrder, rows };
      })
      // por torre, depois pavimento do menor para o maior
      .sort((a, b) => {
        const tA = a.rows[0]?.tasks[0]?.tower ?? '';
        const tB = b.rows[0]?.tasks[0]?.tower ?? '';
        return tA.localeCompare(tB, 'pt-BR') || a.ordem - b.ordem;
      });
  }

  // mode === 'etapa' → agrupa por etapa
  const byEtapa = new Map<string, CronogramaTask[]>();
  for (const t of tasks) {
    if (!byEtapa.has(t.etapaId)) byEtapa.set(t.etapaId, []);
    byEtapa.get(t.etapaId)!.push(t);
  }
  return [...byEtapa.values()]
    .map((list) => {
      const f = list[0];
      const rows: GanttRow[] = [...list]
        .sort(
          (a, b) =>
            b.pavimentoOrder - a.pavimentoOrder ||
            a.apartmentNumber.localeCompare(b.apartmentNumber, 'pt-BR', { numeric: true }),
        )
        .map((t) => ({
          id: t.id,
          apartmentId: t.apartmentId,
          label: `Apto ${t.apartmentNumber}`,
          sub: `${t.pavimento} · ${respLabel(t)}`,
          tasks: [t],
        }));
      return { id: f.etapaId, title: f.etapa, sub: `${rows.length} ${rows.length === 1 ? 'tarefa' : 'tarefas'}`, ordem: f.ordem, rows };
    })
    .sort((a, b) => a.ordem - b.ordem);
}

// "Por etapa" — uma linha por etapa, somando os dias de todos os apartamentos
// em que ela aparece (mesma planilha de células do "Por pavimento").
export function buildEtapaSums(tasks: CronogramaTask[]): GanttGroup[] {
  const byEtapa = new Map<string, CronogramaTask[]>();
  for (const t of tasks) {
    if (!byEtapa.has(t.etapaId)) byEtapa.set(t.etapaId, []);
    byEtapa.get(t.etapaId)!.push(t);
  }
  const rows: GanttRow[] = [...byEtapa.values()]
    .map((list) => {
      const f = list[0];
      const count = list.length;
      const sumPlanned = list.reduce((acc, t) => acc + t.duracaoDias, 0);
      const withActual = list.filter((t) => t.actualStartOffset != null && t.actualEndOffset != null);
      const sumActual = withActual.reduce((acc, t) => acc + (t.actualDias ?? 0), 0);
      const aggStart = Math.min(...list.map((t) => t.startOffset));
      const aggActualStart = withActual.length ? Math.min(...withActual.map((t) => t.actualStartOffset!)) : undefined;
      const status: CronogramaStatus = list.some((t) => t.status === 'Atrasada')
        ? 'Atrasada'
        : list.every((t) => t.status === 'Concluída')
          ? 'Concluída'
          : withActual.length
            ? 'Em andamento'
            : 'Planejada';
      const agg: CronogramaTask = {
        ...f,
        id: `sum-${f.etapaId}`,
        apartmentId: '',
        apartmentNumber: '',
        responsibles: [],
        startOffset: aggStart,
        duracaoDias: sumPlanned,
        endOffset: aggStart + sumPlanned,
        actualStartOffset: aggActualStart,
        actualEndOffset: aggActualStart != null ? aggActualStart + sumActual : undefined,
        actualDias: withActual.length ? sumActual : undefined,
        status,
        atrasoDias: 0,
      };
      return {
        id: agg.id,
        apartmentId: '',
        label: `${f.etapa} · ${count} ${count === 1 ? 'apto' : 'aptos'}`,
        sub: '',
        tasks: [agg],
      };
    })
    .sort((a, b) => a.tasks[0].ordem - b.tasks[0].ordem);
  return [{ id: 'etapas', title: 'Resumo por etapa', sub: `${rows.length} ${rows.length === 1 ? 'etapa' : 'etapas'}`, ordem: 0, rows }];
}

export const STATUS_COLORS: Record<CronogramaStatus, { bg: string; fg: string; bar: string }> = {
  Planejada: { bg: '#F1F5F9', fg: '#475569', bar: '#94A3B8' },
  'Em andamento': { bg: '#DBEAFE', fg: '#1D4ED8', bar: '#3B82F6' },
  Atrasada: { bg: '#FEE2E2', fg: '#B91C1C', bar: '#EF4444' },
  Concluída: { bg: '#D1FAE5', fg: '#047857', bar: '#10B981' },
};
