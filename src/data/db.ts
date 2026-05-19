import { supabase, OBRA_ID } from '@/src/lib/supabase';
import type { Apartment, ApartmentStatus, ChecklistItem, ChecklistState, Tower } from '@/src/data/mockObras';
import type { Measurement, MeasurementStatus, MeasurementType } from '@/src/data/localMeasurements';
import type { InspectionVisit, VisitChecklistCounts } from '@/src/data/localInspectionVisits';
import type { InspectionPhoto } from '@/src/data/localInspectionPhotos';
import type { ServiceStage } from '@/src/data/serviceStages';
import type { ScheduleFields } from '@/src/data/schedule';

// ─── Date helpers ─────────────────────────────────────────────────────────────
// DB stores dates as ISO (YYYY-MM-DD); the app uses DD/MM/YYYY (pt-BR).

function toBrDate(isoDate: string | null | undefined): string | undefined {
  if (!isoDate) return undefined;
  const [year, month, day] = isoDate.split('T')[0].split('-');
  return `${day}/${month}/${year}`;
}

function toIsoDate(brDate: string | null | undefined): string | null {
  if (!brDate || !/^\d{2}\/\d{2}\/\d{4}$/.test(brDate)) return null;
  const [day, month, year] = brDate.split('/');
  return `${year}-${month}-${day}`;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapTower(row: Record<string, unknown>): Tower {
  return {
    id: row.id as string,
    obraId: row.obra_id as string,
    name: row.name as string,
    block: row.block as string,
    position: row.position as string,
    description: row.description as string,
  };
}

type DbChecklistRow = {
  id: string;
  label: string;
  state: ChecklistState;
  comment: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  sort_order: number;
};

function mapChecklistItem(row: DbChecklistRow): ChecklistItem & ScheduleFields {
  return {
    id: row.id,
    label: row.label,
    state: row.state,
    comment: row.comment || undefined,
    plannedStart: toBrDate(row.planned_start),
    plannedEnd: toBrDate(row.planned_end),
    actualStart: toBrDate(row.actual_start),
    actualEnd: toBrDate(row.actual_end),
  };
}

function mapApartment(row: Record<string, unknown>): Apartment {
  const items = ((row.checklist_items as DbChecklistRow[]) ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapChecklistItem);

  return {
    id: row.id as string,
    obraId: row.obra_id as string,
    number: row.number as string,
    floor: row.floor as string,
    towerId: row.tower_id as string,
    status: row.status as ApartmentStatus,
    progress: row.progress as number,
    notes: row.notes as string,
    lastInspection: toBrDate(row.last_inspection as string) ?? '',
    checklist: items,
  };
}

function mapMeasurement(row: Record<string, unknown>): Measurement {
  return {
    id: row.id as string,
    obraId: row.obra_id as string,
    towerId: row.tower_id as string | undefined,
    apartmentId: row.apartment_id as string,
    serviceId: row.service_id as string | undefined,
    contractorId: row.contractor_id as string | undefined,
    service: row.service as string,
    contractor: row.contractor as string,
    quantity: Number(row.quantity),
    unit: row.unit as string,
    unitPrice: Number(row.unit_price),
    totalValue: Number(row.total_value),
    periodStart: toBrDate(row.period_start as string) ?? '',
    periodEnd: toBrDate(row.period_end as string) ?? '',
    status: row.status as MeasurementStatus,
    comment: row.comment as string,
    measurementType: row.measurement_type as MeasurementType,
    evidenceUri: (row.evidence_storage_path as string) || undefined,
    evidenceFileName: (row.evidence_file_name as string) || undefined,
    responsible: (row.responsible as string) || undefined,
    launchedAt: (row.launched_at as string) || undefined,
    approvedAt: (row.approved_at as string) || undefined,
  };
}

function mapVisit(row: Record<string, unknown>): InspectionVisit {
  const issueIds = (row.issue_item_ids as string[]) ?? [];
  const photoIds = (row.added_photo_ids as string[]) ?? [];
  return {
    id: row.id as string,
    apartmentId: row.apartment_id as string,
    apartamentoId: row.apartment_id as string,
    date: row.date as string,
    startedAt: (row.started_at as string) || (row.date as string),
    dataInicio: (row.started_at as string) || (row.date as string),
    responsible: row.responsible as string,
    responsavel: row.responsible as string,
    progressBefore: row.progress_before as number,
    percentualAntes: row.progress_before as number,
    progressAfter: row.progress_after as number,
    percentualDepois: row.progress_after as number,
    evolution: row.evolution as number,
    evolucao: row.evolution as number,
    counts: (row.counts as VisitChecklistCounts) ?? { ok: 0, pending: 0, partial: 0, notApplicable: 0 },
    photosAdded: row.photos_added as number,
    quantidadeFotos: row.photos_added as number,
    quantidadePendencias: issueIds.length,
    statusAfter: row.status_after as ApartmentStatus,
    statusFinal: row.status_after as ApartmentStatus,
    generalNote: row.general_note as string,
    observacaoGeral: row.general_note as string,
    changedItemIds: (row.changed_item_ids as string[]) ?? [],
    addedPhotoIds: photoIds,
    issueItemIds: issueIds,
    finalized: row.finalized as boolean,
    finalizedAt: (row.finalized_at as string) || undefined,
  };
}

function mapPhoto(row: Record<string, unknown>): InspectionPhoto {
  return {
    id: row.id as string,
    towerId: row.tower_id as string,
    apartmentId: row.apartment_id as string,
    itemId: (row.item_id as string) || (row.service_id as string),
    serviceId: row.service_id as string,
    service: row.service as string,
    uri: row.storage_path as string,
    fileName: row.file_name as string,
    createdAt: row.created_at as string,
    dataHora: row.created_at as string,
    comment: (row.comment as string) || '',
    comentarioFoto: (row.comment as string) || '',
    visitId: (row.visit_id as string) || undefined,
  };
}

function mapServiceStage(row: Record<string, unknown>): ServiceStage {
  return {
    id: row.id as string,
    nome: row.nome as string,
    categoria: row.categoria as string,
    unidadeMedicao: row.unidade_medicao as string,
    ordemExecucao: row.ordem_execucao as number,
    apareceNoChecklist: row.aparece_no_checklist as boolean,
    apareceNoCronograma: row.aparece_no_cronograma as boolean,
    apareceNaMedicao: row.aparece_na_medicao as boolean,
    etapaCritica: row.etapa_critica as boolean,
    travaLiberacao: row.trava_liberacao as boolean,
    ativo: row.ativo as boolean,
    servicosDependentes: (row.servicos_dependentes as string[]) ?? [],
    observacao: row.observacao as string,
  };
}

// ─── Obra / towers / apartments ───────────────────────────────────────────────

export async function fetchProject() {
  const { data, error } = await supabase
    .from('obras')
    .select('id, name, summary')
    .eq('id', OBRA_ID)
    .single();
  if (error) throw error;
  return data as { id: string; name: string; summary: string };
}

export async function fetchTowers(): Promise<Tower[]> {
  const { data, error } = await supabase
    .from('towers')
    .select('*')
    .eq('obra_id', OBRA_ID)
    .order('name');
  if (error) throw error;
  return (data ?? []).map(mapTower);
}

export async function fetchApartments(): Promise<Apartment[]> {
  const { data, error } = await supabase
    .from('apartments')
    .select('*, checklist_items(*)')
    .eq('obra_id', OBRA_ID)
    .order('number');
  if (error) throw error;
  return (data ?? []).map(mapApartment);
}

export async function updateApartmentStats(
  apartmentId: string,
  progress: number,
  status: ApartmentStatus,
): Promise<void> {
  await supabase
    .from('apartments')
    .update({ progress, status, last_inspection: new Date().toISOString().split('T')[0] })
    .eq('id', apartmentId);
}

// ─── Checklist ────────────────────────────────────────────────────────────────

export async function loadChecklist(apartmentId: string): Promise<(ChecklistItem & ScheduleFields)[]> {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map(mapChecklistItem);
}

export async function upsertChecklistItem(
  item: ChecklistItem & ScheduleFields & { apartmentId: string },
): Promise<void> {
  await supabase.from('checklist_items').upsert({
    id: item.id,
    obra_id: OBRA_ID,
    apartment_id: item.apartmentId,
    label: item.label,
    state: item.state,
    comment: item.comment ?? '',
    planned_start: toIsoDate(item.plannedStart),
    planned_end: toIsoDate(item.plannedEnd),
    actual_start: toIsoDate(item.actualStart),
    actual_end: toIsoDate(item.actualEnd),
  });
}

// ─── Measurements ─────────────────────────────────────────────────────────────

export async function loadMeasurements(apartmentId: string): Promise<Measurement[]> {
  const { data, error } = await supabase
    .from('measurements')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('obra_id', OBRA_ID)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapMeasurement);
}

export async function loadAllMeasurements(): Promise<Measurement[]> {
  const { data, error } = await supabase
    .from('measurements')
    .select('*')
    .eq('obra_id', OBRA_ID)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapMeasurement);
}

export async function saveMeasurement(m: Measurement): Promise<void> {
  const apartment = m.apartmentId;
  await supabase.from('measurements').upsert({
    id: m.id,
    obra_id: m.obraId ?? OBRA_ID,
    tower_id: m.towerId ?? null,
    apartment_id: apartment,
    service_id: m.serviceId ?? null,
    contractor_id: m.contractorId ?? null,
    service: m.service,
    contractor: m.contractor,
    quantity: m.quantity,
    unit: m.unit,
    unit_price: m.unitPrice,
    total_value: m.totalValue,
    period_start: toIsoDate(m.periodStart),
    period_end: toIsoDate(m.periodEnd),
    status: m.status,
    comment: m.comment,
    measurement_type: m.measurementType,
    evidence_storage_path: m.evidenceUri ?? null,
    evidence_file_name: m.evidenceFileName ?? null,
    responsible: m.responsible ?? null,
    launched_at: m.launchedAt ?? null,
    approved_at: m.approvedAt ?? null,
  });
}

export async function deleteMeasurement(id: string): Promise<void> {
  await supabase.from('measurements').delete().eq('id', id);
}

// ─── Inspection visits ────────────────────────────────────────────────────────

export async function loadVisits(apartmentId: string): Promise<InspectionVisit[]> {
  const { data, error } = await supabase
    .from('inspection_visits')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('obra_id', OBRA_ID)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapVisit);
}

export async function saveVisit(visit: InspectionVisit): Promise<void> {
  await supabase.from('inspection_visits').upsert({
    id: visit.id,
    obra_id: OBRA_ID,
    apartment_id: visit.apartmentId,
    date: visit.date,
    started_at: visit.startedAt ?? visit.date,
    responsible: visit.responsible,
    progress_before: visit.progressBefore,
    progress_after: visit.progressAfter,
    evolution: visit.evolution,
    counts: visit.counts,
    photos_added: visit.photosAdded,
    status_after: visit.statusAfter,
    general_note: visit.generalNote,
    changed_item_ids: visit.changedItemIds,
    added_photo_ids: visit.addedPhotoIds,
    issue_item_ids: visit.issueItemIds,
    finalized: visit.finalized,
    finalized_at: visit.finalizedAt ?? null,
  });
}

// ─── Inspection photos ────────────────────────────────────────────────────────

export async function loadPhotos(apartmentId: string): Promise<InspectionPhoto[]> {
  const { data, error } = await supabase
    .from('inspection_photos')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('obra_id', OBRA_ID)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapPhoto);
}

export async function savePhoto(photo: InspectionPhoto): Promise<void> {
  await supabase.from('inspection_photos').upsert({
    id: photo.id,
    obra_id: OBRA_ID,
    tower_id: photo.towerId,
    apartment_id: photo.apartmentId,
    item_id: photo.itemId,
    service_id: photo.serviceId,
    service: photo.service,
    storage_path: photo.uri,
    file_name: photo.fileName,
    comment: photo.comment,
    visit_id: photo.visitId ?? null,
  });
}

export async function deletePhoto(id: string): Promise<void> {
  await supabase.from('inspection_photos').delete().eq('id', id);
}

// ─── Service stages ───────────────────────────────────────────────────────────

export async function loadServiceStages(): Promise<ServiceStage[]> {
  const { data, error } = await supabase
    .from('service_stages')
    .select('*')
    .eq('obra_id', OBRA_ID)
    .order('ordem_execucao');
  if (error) throw error;
  return (data ?? []).map(mapServiceStage);
}

export async function saveServiceStages(stages: ServiceStage[]): Promise<void> {
  const rows = stages.map((stage, index) => ({
    id: stage.id,
    obra_id: OBRA_ID,
    nome: stage.nome,
    categoria: stage.categoria,
    unidade_medicao: stage.unidadeMedicao,
    ordem_execucao: index + 1,
    aparece_no_checklist: stage.apareceNoChecklist,
    aparece_no_cronograma: stage.apareceNoCronograma,
    aparece_na_medicao: stage.apareceNaMedicao,
    etapa_critica: stage.etapaCritica,
    trava_liberacao: stage.travaLiberacao,
    ativo: stage.ativo,
    servicos_dependentes: stage.servicosDependentes,
    observacao: stage.observacao,
  }));
  await supabase.from('service_stages').upsert(rows);
}
