import type { ApartmentStatus, ChecklistState } from '@/src/data/mockObras';

export const statusConfig: Record<
  ApartmentStatus,
  { label: string; color: string; background: string; border: string }
> = {
  excellent: {
    label: 'Excelente',
    color: '#047857',
    background: '#D1FAE5',
    border: '#6EE7B7',
  },
  good: {
    label: 'Bom',
    color: '#2563EB',
    background: '#DBEAFE',
    border: '#93C5FD',
  },
  attention: {
    label: 'Atenção',
    color: '#B45309',
    background: '#FEF3C7',
    border: '#FCD34D',
  },
  critical: {
    label: 'Crítico',
    color: '#B91C1C',
    background: '#FEE2E2',
    border: '#FCA5A5',
  },
};

// 5 bands of 20% each, red → orange → amber → blue → green.
// Used for progress visualisations (bars, stripes) where we want a smoother
// gradient than the 4-state apartment status palette.
const progressBands: { min: number; color: string; soft: string }[] = [
  { min: 0,  color: '#B91C1C', soft: '#FEE2E2' },
  { min: 20, color: '#EA580C', soft: '#FED7AA' },
  { min: 40, color: '#CA8A04', soft: '#FEF3C7' },
  { min: 60, color: '#2563EB', soft: '#DBEAFE' },
  { min: 80, color: '#047857', soft: '#D1FAE5' },
];

export const getProgressColor = (progress: number): string => {
  const p = Math.max(0, Math.min(100, progress));
  return [...progressBands].reverse().find((b) => p >= b.min)!.color;
};

export const getProgressBackground = (progress: number): string => {
  const p = Math.max(0, Math.min(100, progress));
  return [...progressBands].reverse().find((b) => p >= b.min)!.soft;
};

export const checklistConfig: Record<
  ChecklistState,
  { label: string; color: string; background: string; symbol: string }
> = {
  ok: {
    label: 'OK',
    color: '#047857',
    background: '#ECFDF5',
    symbol: 'OK',
  },
  pending: {
    label: 'Pendente',
    color: '#475569',
    background: '#F1F5F9',
    symbol: '-',
  },
  partial: {
    label: 'Parcial',
    color: '#B45309',
    background: '#FFFBEB',
    symbol: '~',
  },
  notApplicable: {
    label: 'Não se aplica',
    color: '#334155',
    background: '#E2E8F0',
    symbol: 'N/A',
  },
};
