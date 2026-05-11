import { getApartmentById, project } from '@/src/data/mockObras';

export const measurementStatusOptions = [
  'Executado',
  'Conferido',
  'Aprovado para pagamento',
  'Pago externamente',
  'Reprovado',
  'Retido',
  'Cancelado',
] as const;

export const measurementTypeOptions = ['normal', 'complement', 'rework'] as const;

export type MeasurementStatus = (typeof measurementStatusOptions)[number];
export type MeasurementType = (typeof measurementTypeOptions)[number];

export type Measurement = {
  id: string;
  obraId?: string;
  towerId?: string;
  apartmentId: string;
  serviceId?: string;
  contractorId?: string;
  service: string;
  contractor: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalValue: number;
  periodStart: string;
  periodEnd: string;
  status: MeasurementStatus;
  comment: string;
  measurementType: MeasurementType;
  evidenceUri?: string;
  evidenceFileName?: string;
  responsible?: string;
  launchedAt?: string;
  approvedAt?: string;
};

export type MeasurementDraft = {
  contractor: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  periodStart: string;
  periodEnd: string;
  status: MeasurementStatus;
  comment: string;
  measurementType: MeasurementType;
  evidenceUri: string;
  evidenceFileName: string;
};

export const getContractorId = (contractor: string) =>
  contractor
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const getMeasurementDuplicateKey = ({
  apartmentId,
  contractor,
  contractorId,
  obraId,
  service,
  serviceId,
  towerId,
}: {
  apartmentId: string;
  contractor: string;
  contractorId?: string;
  obraId?: string;
  service: string;
  serviceId?: string;
  towerId?: string;
}) =>
  [
    obraId ?? 'obra-local',
    towerId ?? 'torre-local',
    apartmentId,
    serviceId ?? service,
    contractorId ?? getContractorId(contractor),
  ].join('|');

export const isMeasurementStatus = (status: unknown): status is MeasurementStatus =>
  measurementStatusOptions.includes(status as MeasurementStatus);

export const isMeasurementType = (type: unknown): type is MeasurementType =>
  measurementTypeOptions.includes(type as MeasurementType);

export const getMeasurementTypeLabel = (type: MeasurementType) => {
  if (type === 'complement') {
    return 'Complemento';
  }

  if (type === 'rework') {
    return 'Retrabalho';
  }

  return 'Medição normal';
};

export const createEmptyMeasurementDraft = (): MeasurementDraft => ({
  contractor: '',
  quantity: '',
  unit: '',
  unitPrice: '',
  periodStart: '',
  periodEnd: '',
  status: 'Executado',
  comment: '',
  measurementType: 'normal',
  evidenceUri: '',
  evidenceFileName: '',
});

export const getMeasurementStorageKey = (apartmentId?: string) =>
  apartmentId ? `medicoes-${apartmentId}` : undefined;

const todayBr = () => new Intl.DateTimeFormat('pt-BR').format(new Date());

export const normalizeMeasurementPeriod = (value?: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : todayBr();

export const parseBrDateForMeasurement = (value: string) => {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    return undefined;
  }

  const [day, month, year] = value.split('/').map(Number);
  const date = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return date;
};

export const isMeasurementPeriodValid = (periodStart: string, periodEnd: string) => {
  const start = parseBrDateForMeasurement(periodStart);
  const end = parseBrDateForMeasurement(periodEnd);

  return Boolean(start && end && end.getTime() >= start.getTime());
};

export const measurementBlocksDuplicate = (status: MeasurementStatus) =>
  ['Executado', 'Conferido', 'Aprovado para pagamento', 'Pago externamente', 'Retido'].includes(status);

export const measurementDuplicateMessage =
  'Este serviço já possui medição registrada para este apartamento e empreiteiro. Verifique a medição existente antes de lançar novamente.';

export const getAllowedMeasurementTransitions = (status: MeasurementStatus): MeasurementStatus[] => {
  if (status === 'Executado') {
    return ['Conferido', 'Reprovado', 'Retido'];
  }

  if (status === 'Conferido') {
    return ['Aprovado para pagamento', 'Reprovado', 'Retido'];
  }

  if (status === 'Aprovado para pagamento') {
    return ['Pago externamente'];
  }

  if (status === 'Retido') {
    return ['Conferido', 'Reprovado'];
  }

  return [];
};

export const getMeasurementsFromStorage = (storageKey: string | undefined): Measurement[] => {
  if (!storageKey || typeof window === 'undefined') {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      return [];
    }

    const storedMeasurements = JSON.parse(storedValue) as Partial<Measurement>[];

    const normalizedMeasurements = storedMeasurements.flatMap((measurement) => {
      const {
        apartmentId,
        comment,
        contractor,
        contractorId,
        id,
        measurementType,
        obraId,
        quantity,
        service,
        serviceId,
        status,
        towerId,
        totalValue,
        unit,
        unitPrice,
        periodStart,
        periodEnd,
        evidenceUri,
        evidenceFileName,
        responsible,
        launchedAt,
        approvedAt,
      } = measurement;

      if (
        typeof id !== 'string' ||
        typeof apartmentId !== 'string' ||
        typeof service !== 'string' ||
        typeof contractor !== 'string' ||
        typeof quantity !== 'number' ||
        typeof unit !== 'string' ||
        typeof unitPrice !== 'number' ||
        typeof totalValue !== 'number' ||
        !isMeasurementStatus(status) ||
        typeof comment !== 'string'
      ) {
        return [];
      }

      const apartment = getApartmentById(apartmentId);
      const normalizedPeriodStart = normalizeMeasurementPeriod(periodStart);
      const normalizedPeriodEnd = normalizeMeasurementPeriod(periodEnd);

      return [
        {
          id,
          obraId: typeof obraId === 'string' ? obraId : project.id,
          towerId: typeof towerId === 'string' ? towerId : apartment?.towerId,
          apartmentId,
          serviceId: typeof serviceId === 'string' ? serviceId : service,
          contractorId:
            typeof contractorId === 'string' ? contractorId : getContractorId(contractor),
          service,
          contractor,
          quantity,
          unit,
          unitPrice,
          totalValue,
          periodStart: normalizedPeriodStart,
          periodEnd: normalizedPeriodEnd,
          status,
          comment,
          measurementType: isMeasurementType(measurementType) ? measurementType : 'normal',
          evidenceUri: typeof evidenceUri === 'string' ? evidenceUri : undefined,
          evidenceFileName: typeof evidenceFileName === 'string' ? evidenceFileName : undefined,
          responsible: typeof responsible === 'string' ? responsible : 'Usuário local',
          launchedAt:
            typeof launchedAt === 'string'
              ? launchedAt
              : typeof id === 'string' && id.includes('-')
                ? new Date().toISOString()
                : undefined,
          approvedAt: typeof approvedAt === 'string' ? approvedAt : undefined,
        },
      ];
    });

    window.localStorage.setItem(storageKey, JSON.stringify(normalizedMeasurements));

    return normalizedMeasurements;
  } catch {
    return [];
  }
};

export const saveMeasurementsToStorage = (
  storageKey: string | undefined,
  measurements: Measurement[],
) => {
  if (!storageKey || typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(measurements));
};

export const loadAllMeasurements = (apartmentIds: string[]) =>
  apartmentIds.flatMap((apartmentId) =>
    getMeasurementsFromStorage(getMeasurementStorageKey(apartmentId)),
  );

export const toNumber = (value: string) => {
  const normalizedValue = value.replace(',', '.');
  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    currency: 'BRL',
    style: 'currency',
  }).format(value);
