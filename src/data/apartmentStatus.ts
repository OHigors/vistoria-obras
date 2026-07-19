import type { ApartmentStatus, ChecklistState } from '@/src/data/mockObras';
import { isCriticalStageForStatus } from '@/src/data/serviceStages';

// Item mínimo necessário para o cálculo de saúde. Os tipos reais (checklist de
// apartamento e de nível) já carregam todos estes campos.
type StatusItem = { state: ChecklistState; label: string; plannedEnd?: string; emergency?: string };

// "DD/MM/AAAA" → epoch (meia-noite local). null se inválida.
const parseBrMs = (br?: string): number | null => {
  if (!br || !/^\d{2}\/\d{2}\/\d{4}$/.test(br)) return null;
  const [d, m, y] = br.split('/').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
};

// Saúde do apartamento pela ADERÊNCIA AO CRONOGRAMA (não pelo % bruto — que fazia
// toda obra em fase inicial virar "crítico"):
//   critical  = tem etapa atrasada, OU emergência, OU etapa crítica/trava pendente
//   excellent = praticamente concluído (>=90% e nada pendente)
//   attention = tem etapa vencendo em até 3 dias
//   good      = em dia (nada vencido nem urgente)
// A MESMA regra é replicada no trigger recompute_apartment_progress (banco).
export function computeApartmentStatus(items: StatusItem[], progress: number): ApartmentStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = today.getTime();
  const soon = t + 3 * 24 * 60 * 60 * 1000;

  let late = false;
  let emergency = false;
  let dueSoon = false;
  let criticalStage = false;
  let pending = 0;

  for (const it of items) {
    if (it.emergency && it.emergency.trim()) emergency = true;
    if (it.state === 'pending') pending += 1;
    if (it.state === 'pending' || it.state === 'partial') {
      if (isCriticalStageForStatus(it.label)) criticalStage = true;
      const pe = parseBrMs(it.plannedEnd);
      if (pe !== null) {
        if (pe < t) late = true;
        else if (pe <= soon) dueSoon = true;
      }
    }
  }

  if (late || emergency || criticalStage) return 'critical';
  if (progress >= 90 && pending === 0) return 'excellent';
  if (dueSoon) return 'attention';
  return 'good';
}
