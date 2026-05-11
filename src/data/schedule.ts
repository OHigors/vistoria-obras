import type { Apartment, ChecklistItem, ChecklistState } from '@/src/data/mockObras';
import { getServiceDependencyMap, isServiceActiveForFeature } from '@/src/data/serviceStages';

export type ScheduleStatus = 'No prazo' | 'Atenção' | 'Atrasado' | 'Concluído';

export type ScheduleFields = {
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
};

export type ScheduledChecklistItem = ChecklistItem & ScheduleFields;

export type ScheduleRow = {
  service: string;
  inspectionStatus: ChecklistState;
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  scheduleStatus: ScheduleStatus;
  delayDays: number;
  blockedServices: string[];
};

export type ApartmentScheduleSummary = {
  apartmentId: string;
  maxDelayDays: number;
  mostDelayedService?: string;
  hasDelay: boolean;
};

export type ScheduleSummary = {
  delayedApartments: number;
  mostDelayedService?: {
    service: string;
    delayDays: number;
  };
  mostDelayedTower?: {
    towerId: string;
    towerName: string;
    delayDays: number;
  };
};

const oneDayInMs = 24 * 60 * 60 * 1000;

const getStorageKey = (apartmentId: string) => `vistoria-${apartmentId}`;

const today = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, 8);

export const maskDateBr = (value: string) => {
  const digits = digitsOnly(value);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

export const isValidBrDate = (value?: string) => {
  if (!value) {
    return false;
  }

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    return false;
  }

  const [day, month, year] = value.split('/').map(Number);

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return false;
  }

  const date = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
};

const isValidIsoDate = (value?: string): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
};

export const normalizeDateForDisplay = (value?: string) => {
  if (!value) {
    return '';
  }

  if (isValidBrDate(value)) {
    return value;
  }

  if (/^\d{8}$/.test(value)) {
    return maskDateBr(value);
  }

  if (isValidIsoDate(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }

  return maskDateBr(value);
};

const parseDate = (value?: string) => {
  const normalizedValue = normalizeDateForDisplay(value);

  if (!isValidBrDate(normalizedValue)) {
    return undefined;
  }

  const [day, month, year] = normalizedValue.split('/');

  return new Date(`${year}-${month}-${day}T00:00:00`);
};

export const formatDateBr = (value?: string) => {
  const normalizedValue = normalizeDateForDisplay(value);

  if (!isValidBrDate(normalizedValue)) {
    return '-';
  }

  return normalizedValue;
};

const getDelayDays = (item: ScheduledChecklistItem) => {
  const plannedEndDate = parseDate(item.plannedEnd);

  if (!plannedEndDate) {
    return 0;
  }

  const comparisonDate = item.state === 'ok' ? parseDate(item.actualEnd) : today();

  if (!comparisonDate) {
    return 0;
  }

  const diff = Math.floor((comparisonDate.getTime() - plannedEndDate.getTime()) / oneDayInMs);

  return Math.max(0, diff);
};

export const getScheduleStatus = (item: ScheduledChecklistItem): ScheduleStatus => {
  const plannedEndDate = parseDate(item.plannedEnd);
  const delayDays = getDelayDays(item);

  if (item.state === 'ok') {
    return 'Concluído';
  }

  if (item.state === 'notApplicable') {
    return 'No prazo';
  }

  if ((item.state === 'pending' || item.state === 'partial') && plannedEndDate && delayDays > 0) {
    return 'Atrasado';
  }

  if (plannedEndDate) {
    const daysUntilEnd = Math.ceil((plannedEndDate.getTime() - today().getTime()) / oneDayInMs);

    if (daysUntilEnd >= 0 && daysUntilEnd <= 3) {
      return 'Atenção';
    }
  }

  return 'No prazo';
};

export const getScheduledChecklistForApartment = (apartment: Apartment): ScheduledChecklistItem[] => {
  if (typeof window === 'undefined') {
    return apartment.checklist.filter((item) => isServiceActiveForFeature(item.label, 'cronograma'));
  }

  try {
    const storedValue = window.localStorage.getItem(getStorageKey(apartment.id));

    if (!storedValue) {
      return apartment.checklist.filter((item) => isServiceActiveForFeature(item.label, 'cronograma'));
    }

    const storedItems = JSON.parse(storedValue) as Partial<ScheduledChecklistItem>[];
    const storedItemsById = new Map(storedItems.map((item) => [item.id, item]));

    return apartment.checklist.filter((item) => isServiceActiveForFeature(item.label, 'cronograma')).map((item) => {
      const storedItem = storedItemsById.get(item.id);

      return {
        ...item,
        state:
          storedItem?.state === 'ok' ||
          storedItem?.state === 'pending' ||
          storedItem?.state === 'partial' ||
          storedItem?.state === 'notApplicable'
            ? storedItem.state
            : item.state,
        comment: typeof storedItem?.comment === 'string' ? storedItem.comment : item.comment,
        plannedStart:
          typeof storedItem?.plannedStart === 'string'
            ? normalizeDateForDisplay(storedItem.plannedStart)
            : undefined,
        plannedEnd:
          typeof storedItem?.plannedEnd === 'string'
            ? normalizeDateForDisplay(storedItem.plannedEnd)
            : undefined,
        actualStart:
          typeof storedItem?.actualStart === 'string'
            ? normalizeDateForDisplay(storedItem.actualStart)
            : undefined,
        actualEnd:
          typeof storedItem?.actualEnd === 'string'
            ? normalizeDateForDisplay(storedItem.actualEnd)
            : undefined,
      };
    });
  } catch {
    return apartment.checklist.filter((item) => isServiceActiveForFeature(item.label, 'cronograma'));
  }
};

export const getScheduleRows = (checklist: ScheduledChecklistItem[]): ScheduleRow[] =>
  checklist.map((item) => ({
    service: item.label,
    inspectionStatus: item.state,
    plannedStart: item.plannedStart,
    plannedEnd: item.plannedEnd,
    actualStart: item.actualStart,
    actualEnd: item.actualEnd,
    scheduleStatus: getScheduleStatus(item),
    delayDays: getDelayDays(item),
    blockedServices:
      item.state === 'pending' || item.state === 'partial'
        ? getServiceDependencyMap()[item.label] ?? []
        : [],
  }));

export const summarizeApartmentSchedule = (apartment: Apartment): ApartmentScheduleSummary => {
  const rows = getScheduleRows(getScheduledChecklistForApartment(apartment));
  const delayedRows = rows.filter((row) => row.scheduleStatus === 'Atrasado');
  const mostDelayedRow = delayedRows.sort((first, second) => second.delayDays - first.delayDays)[0];

  return {
    apartmentId: apartment.id,
    maxDelayDays: mostDelayedRow?.delayDays ?? 0,
    mostDelayedService: mostDelayedRow?.service,
    hasDelay: delayedRows.length > 0,
  };
};

export const summarizeSchedule = (
  apartments: Apartment[],
  getTowerName: (towerId: string) => string,
): ScheduleSummary => {
  const apartmentSummaries = apartments.map(summarizeApartmentSchedule);
  const delayedApartments = apartmentSummaries.filter((summary) => summary.hasDelay);
  const mostDelayedApartment = [...delayedApartments].sort(
    (first, second) => second.maxDelayDays - first.maxDelayDays,
  )[0];
  const towerDelays = new Map<string, number>();

  apartments.forEach((apartment) => {
    const summary = apartmentSummaries.find((item) => item.apartmentId === apartment.id);
    towerDelays.set(apartment.towerId, Math.max(towerDelays.get(apartment.towerId) ?? 0, summary?.maxDelayDays ?? 0));
  });

  const mostDelayedTowerEntry = [...towerDelays.entries()].sort(
    (first, second) => second[1] - first[1],
  )[0];

  return {
    delayedApartments: delayedApartments.length,
    mostDelayedService: mostDelayedApartment?.mostDelayedService
      ? {
          service: mostDelayedApartment.mostDelayedService,
          delayDays: mostDelayedApartment.maxDelayDays,
        }
      : undefined,
    mostDelayedTower: mostDelayedTowerEntry
      ? {
          towerId: mostDelayedTowerEntry[0],
          towerName: getTowerName(mostDelayedTowerEntry[0]),
          delayDays: mostDelayedTowerEntry[1],
        }
      : undefined,
  };
};
