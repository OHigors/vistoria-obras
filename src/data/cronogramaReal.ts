// ─── Cronograma a partir de dados REAIS (Supabase) ───────────────────────────────
// Lê os checklist_items de cada apartamento. Uma etapa só entra no cronograma se
// já tiver início e fim planejados (planned_start / planned_end) — ou seja, se foi
// "atribuída" ao cronograma daquele apartamento.
//   • duração = planned_end − planned_start (derivada, sem coluna nova)
//   • executado (progresso) vem do state da vistoria (ok=100% / partial=50% / pending=0%)
//   • responsáveis vêm de step_assignments → workers
//   • ordem/abreviação vêm de service_stages
// Tarefas de sessão (adicionadas na tela, ainda não persistidas) entram como overlay.

import type { Apartment, Tower } from '@/src/data/mockObras';
import type { ServiceStage } from '@/src/data/serviceStages';
import type { Worker } from '@/src/data/serviceWorkers';
import type { ScheduledChecklistItem } from '@/src/data/schedule';
import type { CronogramaResult, CronogramaStatus, CronogramaTask } from '@/src/data/mockCronograma';

const MS_DAY = 24 * 60 * 60 * 1000;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const addDays = (base: Date, days: number) => new Date(base.getTime() + days * MS_DAY);
const diffDays = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / MS_DAY);

// BR "DD/MM/YYYY" → Date (meia-noite local). Null se inválida.
const parseBr = (br?: string): Date | null => {
  if (!br || !/^\d{2}\/\d{2}\/\d{4}$/.test(br)) return null;
  const [d, m, y] = br.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const pavimentoOrder = (floor: string): number => {
  const m = floor.match(/\d+/);
  return m ? Number(m[0]) : 0;
};

const abbrev = (label: string): string => {
  const first = label.split(/[ /(]/)[0];
  return first.length > 7 ? `${first.slice(0, 6)}.` : first;
};

const progressFromState = (state: string): number =>
  state === 'ok' ? 1 : state === 'partial' ? 0.5 : 0;

// Etapas elegíveis ao cronograma (para o seletor do formulário).
export type CronogramaStage = { id: string; nome: string; ordem: number };

export function getCronogramaStages(serviceStages: ServiceStage[]): CronogramaStage[] {
  return serviceStages
    .filter((s) => s.ativo && s.apareceNoCronograma)
    .sort((a, b) => a.ordemExecucao - b.ordemExecucao)
    .map((s) => ({ id: s.id, nome: s.nome, ordem: s.ordemExecucao }));
}

type RawTask = Omit<
  CronogramaTask,
  'startOffset' | 'endOffset' | 'status' | 'atrasoDias' | 'actualStartOffset' | 'actualEndOffset'
>;

export function buildCronogramaFromData(
  apartments: Apartment[],
  serviceStages: ServiceStage[],
  workers: Worker[],
  assignmentsByApt: Record<string, Record<string, string[]>>,
  towers: Tower[] = [],
): CronogramaResult {
  const today = startOfToday();
  const stageByName = new Map(serviceStages.map((s) => [s.nome, s]));
  const workerName = (id: string) => workers.find((w) => w.id === id)?.nome ?? id;
  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '';

  const raws: RawTask[] = [];

  // 1) Tarefas do banco — itens com início e fim planejados.
  for (const apt of apartments) {
    const aptAssign = assignmentsByApt[apt.id] ?? {};
    for (const item of apt.checklist as ScheduledChecklistItem[]) {
      const stage = stageByName.get(item.label);
      if (stage && (!stage.ativo || !stage.apareceNoCronograma)) continue;
      if (item.state === 'notApplicable') continue;
      const start = parseBr(item.plannedStart);
      const end = parseBr(item.plannedEnd);
      if (!start || !end) continue; // sem datas → não foi atribuída ao cronograma ainda
      const duracaoDias = Math.max(1, diffDays(start, end));
      // Realizado: datas de execução. Em andamento (com início, sem fim) corre até hoje.
      const aStart = parseBr(item.actualStart);
      let aEnd = parseBr(item.actualEnd);
      if (aStart && !aEnd) aEnd = today;
      const actualDias = aStart && aEnd ? Math.max(1, diffDays(aStart, aEnd)) : undefined;
      raws.push({
        id: item.id,
        apartmentId: apt.id,
        apartmentNumber: apt.number,
        pavimento: apt.floor,
        pavimentoOrder: pavimentoOrder(apt.floor),
        tower: towerName(apt.towerId),
        etapaId: stage?.id ?? item.label,
        etapa: item.label,
        etapaAbrev: abbrev(item.label),
        ordem: stage?.ordemExecucao ?? 999,
        responsibles: (aptAssign[item.id] ?? []).map(workerName),
        funcao: stage?.categoria ?? '',
        start,
        end: addDays(start, duracaoDias),
        duracaoDias,
        actualStart: aStart ?? undefined,
        actualEnd: aStart ? aEnd ?? undefined : undefined,
        actualDias,
        executadoPct: progressFromState(item.state),
        note: item.comment,
      });
    }
  }

  if (raws.length === 0) {
    return { tasks: [], projectStart: today, projectEnd: today, totalDias: 1, hojeOffset: 0 };
  }

  const startTimes = raws.flatMap((r) => (r.actualStart ? [r.start.getTime(), r.actualStart.getTime()] : [r.start.getTime()]));
  const endTimes = raws.flatMap((r) => (r.actualEnd ? [r.end.getTime(), r.actualEnd.getTime()] : [r.end.getTime()]));
  const projectStart = new Date(Math.min(...startTimes));
  const projectEnd = new Date(Math.max(...endTimes));
  const totalDias = Math.max(1, diffDays(projectStart, projectEnd));
  const hojeOffset = Math.max(0, Math.min(totalDias, diffDays(projectStart, today)));

  const tasks: CronogramaTask[] = raws.map((r) => {
    const startOffset = diffDays(projectStart, r.start);
    const endOffset = startOffset + r.duracaoDias;
    const actualStartOffset = r.actualStart ? diffDays(projectStart, r.actualStart) : undefined;
    const actualEndOffset = r.actualEnd ? diffDays(projectStart, r.actualEnd) : undefined;
    let status: CronogramaStatus;
    let atrasoDias = 0;
    if (r.executadoPct >= 1) {
      status = 'Concluída';
    } else if (r.end.getTime() < today.getTime()) {
      status = 'Atrasada';
      atrasoDias = diffDays(r.end, today);
    } else if (r.executadoPct > 0 || r.start.getTime() <= today.getTime()) {
      status = 'Em andamento';
    } else {
      status = 'Planejada';
    }
    return { ...r, startOffset, endOffset, actualStartOffset, actualEndOffset, status, atrasoDias };
  });

  return { tasks, projectStart, projectEnd, totalDias, hojeOffset };
}
