import type { ApartmentStatus, ChecklistState } from './mockObras';

export type VisitChecklistCounts = Record<ChecklistState, number>;

export type InspectionVisit = {
  id: string;
  apartmentId: string;
  apartamentoId?: string;
  date: string;
  startedAt?: string;
  dataInicio?: string;
  responsible: string;
  responsavel?: string;
  progressBefore: number;
  percentualAntes?: number;
  progressAfter: number;
  percentualDepois?: number;
  evolution: number;
  evolucao?: number;
  counts: VisitChecklistCounts;
  photosAdded: number;
  quantidadeFotos?: number;
  quantidadePendencias?: number;
  statusAfter: ApartmentStatus;
  statusFinal?: ApartmentStatus;
  generalNote: string;
  observacaoGeral?: string;
  changedItemIds: string[];
  addedPhotoIds: string[];
  issueItemIds: string[];
  finalized: boolean;
  finalizedAt?: string;
};

export const localResponsible = 'Usuário local';

export const getInspectionVisitStorageKey = (apartmentId?: string) =>
  apartmentId ? `visitas-vistoria-${apartmentId}` : undefined;

const emptyCounts: VisitChecklistCounts = {
  notApplicable: 0,
  ok: 0,
  partial: 0,
  pending: 0,
};

const normalizeCounts = (counts: Partial<VisitChecklistCounts> | undefined) => ({
  ...emptyCounts,
  ...counts,
});

export const getInspectionVisitsFromStorage = (
  storageKey: string | undefined,
): InspectionVisit[] => {
  if (!storageKey || typeof window === 'undefined') {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      return [];
    }

    const storedVisits = JSON.parse(storedValue) as Partial<InspectionVisit>[];

    return storedVisits.flatMap((visit) => {
      const apartmentId = visit.apartmentId ?? visit.apartamentoId;
      const date = visit.date ?? visit.startedAt ?? visit.dataInicio ?? visit.finalizedAt;
      const responsible = visit.responsible ?? visit.responsavel ?? localResponsible;
      const progressBefore = visit.progressBefore ?? visit.percentualAntes;
      const progressAfter = visit.progressAfter ?? visit.percentualDepois ?? progressBefore;
      const evolution =
        visit.evolution ??
        visit.evolucao ??
        (typeof progressAfter === 'number' && typeof progressBefore === 'number'
          ? progressAfter - progressBefore
          : undefined);
      const statusAfter = visit.statusAfter ?? visit.statusFinal;
      const addedPhotoIds = Array.isArray(visit.addedPhotoIds) ? visit.addedPhotoIds : [];
      const issueItemIds = Array.isArray(visit.issueItemIds) ? visit.issueItemIds : [];
      const photosAdded =
        typeof visit.photosAdded === 'number'
          ? visit.photosAdded
          : typeof visit.quantidadeFotos === 'number'
            ? visit.quantidadeFotos
            : addedPhotoIds.length;
      const quantidadePendencias =
        typeof visit.quantidadePendencias === 'number'
          ? visit.quantidadePendencias
          : issueItemIds.length;

      if (
        typeof visit.id !== 'string' ||
        typeof apartmentId !== 'string' ||
        typeof date !== 'string' ||
        typeof responsible !== 'string' ||
        typeof progressBefore !== 'number' ||
        typeof progressAfter !== 'number' ||
        typeof evolution !== 'number' ||
        typeof statusAfter !== 'string'
      ) {
        return [];
      }

      return [
        {
          id: visit.id,
          apartmentId,
          apartamentoId: apartmentId,
          date,
          startedAt: visit.startedAt ?? visit.dataInicio ?? date,
          dataInicio: visit.dataInicio ?? visit.startedAt ?? date,
          responsible,
          responsavel: responsible,
          progressBefore,
          percentualAntes: progressBefore,
          progressAfter,
          percentualDepois: progressAfter,
          evolution,
          evolucao: evolution,
          counts: normalizeCounts(visit.counts),
          photosAdded,
          quantidadeFotos: photosAdded,
          quantidadePendencias,
          statusAfter,
          statusFinal: statusAfter,
          generalNote:
            typeof visit.generalNote === 'string'
              ? visit.generalNote
              : typeof visit.observacaoGeral === 'string'
                ? visit.observacaoGeral
                : '',
          observacaoGeral:
            typeof visit.observacaoGeral === 'string'
              ? visit.observacaoGeral
              : typeof visit.generalNote === 'string'
                ? visit.generalNote
                : '',
          changedItemIds: Array.isArray(visit.changedItemIds) ? visit.changedItemIds : [],
          addedPhotoIds,
          issueItemIds,
          finalized: Boolean(visit.finalized),
          finalizedAt: typeof visit.finalizedAt === 'string' ? visit.finalizedAt : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
};

export const saveInspectionVisitsToStorage = (
  storageKey: string | undefined,
  visits: InspectionVisit[],
) => {
  if (!storageKey || typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(visits));
};
