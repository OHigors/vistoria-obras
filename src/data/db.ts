import { supabase, OBRA_ID } from '@/src/lib/supabase';
import type { Apartment, ApartmentStatus, ChecklistItem, ChecklistState, Tower } from '@/src/data/mockObras';
import type { Measurement, MeasurementStatus, MeasurementType } from '@/src/data/localMeasurements';
import type { InspectionVisit, VisitChecklistCounts } from '@/src/data/localInspectionVisits';
import type { InspectionPhoto } from '@/src/data/localInspectionPhotos';
import type { ServiceStage } from '@/src/data/serviceStages';
import type { ServiceCategory } from '@/src/data/serviceCategories';
import type { ServiceUnit } from '@/src/data/serviceUnits';
import type { Worker } from '@/src/data/serviceWorkers';
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
  emergency: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  sort_order: number;
  area: string | null;
  is_extra: boolean | null;
};

function mapChecklistItem(row: DbChecklistRow): ChecklistItem & ScheduleFields {
  return {
    id: row.id,
    label: row.label,
    state: row.state,
    comment: row.comment || undefined,
    emergency: row.emergency || undefined,
    plannedStart: toBrDate(row.planned_start),
    plannedEnd: toBrDate(row.planned_end),
    actualStart: toBrDate(row.actual_start),
    actualEnd: toBrDate(row.actual_end),
    area: row.area ?? 'Interior',
    isExtra: row.is_extra ?? false,
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

const INSPECTION_PHOTOS_BUCKET = 'inspection-photos';

// storage_path may hold either a real Storage object path (e.g. "obraX/apt/123.jpg")
// or a legacy inline URI (data:image/...;base64,... | file:// | http://). Only the
// first form should be resolved through Storage.
function isLegacyPhotoUri(value: string): boolean {
  return /^(data:|https?:|file:|blob:)/i.test(value);
}

// The bucket is private: URLs must be signed. 8h covers a full field day;
// fresh URLs are created on every load.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 8;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export async function getInspectionPhotoUrl(storagePath: string): Promise<string> {
  if (!storagePath) return '';
  if (isLegacyPhotoUri(storagePath)) return storagePath;
  const { data, error } = await supabase.storage
    .from(INSPECTION_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadInspectionPhoto(
  localUri: string,
  destinationPath: string,
  contentType = 'image/jpeg',
): Promise<string> {
  // Works for data:, file:, http(s):, blob: — fetch handles them all in RN/web.
  const response = await fetch(localUri);
  const blob = await response.blob();
  if (!contentType.startsWith('image/')) {
    throw new Error(`Tipo de arquivo não permitido: ${contentType}`);
  }
  if (blob.size > MAX_PHOTO_BYTES) {
    throw new Error('Foto excede o tamanho máximo de 10 MB.');
  }
  const { error } = await supabase.storage
    .from(INSPECTION_PHOTOS_BUCKET)
    .upload(destinationPath, blob, { contentType, upsert: true });
  if (error) throw error;
  return destinationPath;
}

export async function deleteInspectionPhotoObject(storagePath: string): Promise<void> {
  if (!storagePath || isLegacyPhotoUri(storagePath)) return;
  await supabase.storage.from(INSPECTION_PHOTOS_BUCKET).remove([storagePath]);
}

function mapPhoto(row: Record<string, unknown>, signedUrls: Map<string, string>): InspectionPhoto {
  const storagePath = (row.storage_path as string) ?? '';
  return {
    id: row.id as string,
    towerId: row.tower_id as string,
    apartmentId: row.apartment_id as string,
    itemId: (row.item_id as string) || (row.service_id as string),
    serviceId: row.service_id as string,
    service: row.service as string,
    uri: isLegacyPhotoUri(storagePath) ? storagePath : (signedUrls.get(storagePath) ?? ''),
    storagePath: isLegacyPhotoUri(storagePath) ? '' : storagePath,
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
    subEtapas: (row.sub_etapas as string[]) ?? [],
    // Catalog stages no longer carry an area (assigned per-apartment instead).
    area: (row.area as string) ?? '',
    observacao: (row.observacao as string) ?? '',
    dataInicio: (row.data_inicio as string | null) ?? '',
    dataFim: (row.data_fim as string | null) ?? '',
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
    .is('checklist_items.deleted_at', null)
    .order('number');
  if (error) throw error;
  return (data ?? []).map(mapApartment);
}

export async function updateApartmentStats(
  apartmentId: string,
  progress: number,
  status: ApartmentStatus,
): Promise<void> {
  const { error } = await supabase
    .from('apartments')
    .update({ progress, status, last_inspection: new Date().toISOString().split('T')[0] })
    .eq('id', apartmentId);
  if (error) throw error;
}

// ─── Checklist ────────────────────────────────────────────────────────────────

export async function loadChecklist(apartmentId: string): Promise<(ChecklistItem & ScheduleFields)[]> {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('apartment_id', apartmentId)
    .is('deleted_at', null)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map(mapChecklistItem);
}

export async function upsertChecklistItem(
  item: ChecklistItem & ScheduleFields & { apartmentId: string },
): Promise<void> {
  const { error } = await supabase.from('checklist_items').upsert({
    id: item.id,
    obra_id: OBRA_ID,
    apartment_id: item.apartmentId,
    label: item.label,
    state: item.state,
    comment: item.comment ?? '',
    emergency: item.emergency ?? '',
    planned_start: toIsoDate(item.plannedStart),
    planned_end: toIsoDate(item.plannedEnd),
    actual_start: toIsoDate(item.actualStart),
    actual_end: toIsoDate(item.actualEnd),
    area: item.area ?? 'Interior',
    is_extra: item.isExtra ?? false,
  });
  if (error) throw error;
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('checklist_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) throw error;
}

// ─── Measurements ─────────────────────────────────────────────────────────────

export async function loadMeasurements(apartmentId: string): Promise<Measurement[]> {
  const { data, error } = await supabase
    .from('measurements')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('obra_id', OBRA_ID)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapMeasurement);
}

export async function loadAllMeasurements(): Promise<Measurement[]> {
  const { data, error } = await supabase
    .from('measurements')
    .select('*')
    .eq('obra_id', OBRA_ID)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapMeasurement);
}

export async function saveMeasurement(m: Measurement): Promise<void> {
  const apartment = m.apartmentId;
  const { error } = await supabase.from('measurements').upsert({
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
  if (error) throw error;
}

export async function deleteMeasurement(id: string): Promise<void> {
  const { error } = await supabase
    .from('measurements')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
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
  const { error } = await supabase.from('inspection_visits').upsert({
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
  if (error) throw error;
}

// ─── Inspection photos ────────────────────────────────────────────────────────

export async function loadPhotos(apartmentId: string): Promise<InspectionPhoto[]> {
  const { data, error } = await supabase
    .from('inspection_photos')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('obra_id', OBRA_ID)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  // Batch-sign the storage paths (legacy inline URIs are used as-is).
  const storagePaths = rows
    .map((row) => (row.storage_path as string) ?? '')
    .filter((path) => path && !isLegacyPhotoUri(path));
  const signedUrls = new Map<string, string>();
  if (storagePaths.length) {
    const { data: signed, error: signError } = await supabase.storage
      .from(INSPECTION_PHOTOS_BUCKET)
      .createSignedUrls(storagePaths, SIGNED_URL_TTL_SECONDS);
    if (signError) throw signError;
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedUrls.set(entry.path, entry.signedUrl);
    }
  }

  return rows.map((row) => mapPhoto(row, signedUrls));
}

export async function savePhoto(photo: InspectionPhoto): Promise<void> {
  const { error } = await supabase.from('inspection_photos').upsert({
    id: photo.id,
    obra_id: OBRA_ID,
    tower_id: photo.towerId,
    apartment_id: photo.apartmentId,
    item_id: photo.itemId,
    service_id: photo.serviceId,
    service: photo.service,
    storage_path: photo.storagePath,
    file_name: photo.fileName,
    comment: photo.comment,
    visit_id: photo.visitId ?? null,
  });
  if (error) throw error;
}

// Soft delete: the Storage object is kept so the photo can be restored from
// the soft-deleted row. A future purge job can remove orphaned objects.
export async function deletePhoto(id: string, _storagePath?: string): Promise<void> {
  const { error } = await supabase
    .from('inspection_photos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
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
    sub_etapas: stage.subEtapas ?? [],
    area: stage.area ?? '',
    observacao: stage.observacao,
    data_inicio: stage.dataInicio || null,
    data_fim: stage.dataFim || null,
  }));
  const { error } = await supabase.from('service_stages').upsert(rows);
  if (error) throw error;
}

export async function deleteServiceStage(id: string): Promise<void> {
  await supabase.from('service_stages').delete().eq('id', id);
}

export async function propagateStageToApartments(stage: ServiceStage): Promise<void> {
  const { data: apts, error: aptsError } = await supabase
    .from('apartments')
    .select('id')
    .eq('obra_id', OBRA_ID);
  if (aptsError) throw aptsError;
  if (!apts?.length) return;

  const { data: existing, error: existingError } = await supabase
    .from('checklist_items')
    .select('apartment_id')
    .eq('obra_id', OBRA_ID)
    .eq('label', stage.nome)
    .is('deleted_at', null);
  if (existingError) throw existingError;

  const existingAptIds = new Set((existing ?? []).map((r) => r.apartment_id as string));
  const newRows = apts
    .filter((apt) => !existingAptIds.has(apt.id as string))
    .map((apt) => ({
      id: crypto.randomUUID(),
      obra_id: OBRA_ID,
      apartment_id: apt.id as string,
      label: stage.nome,
      state: 'pending',
      comment: '',
      sort_order: stage.ordemExecucao,
      // Catalog area may be empty now; default propagated items to Interior so
      // they remain visible under an area tab (users can move them later).
      area: stage.area || 'Interior',
      is_extra: false,
    }));

  if (!newRows.length) return;

  const BATCH = 200;
  for (let i = 0; i < newRows.length; i += BATCH) {
    const { error } = await supabase.from('checklist_items').insert(newRows.slice(i, i + BATCH));
    if (error) throw error;
  }
}

export async function addStageToApartments(stage: ServiceStage, apartmentIds: string[]): Promise<void> {
  if (!apartmentIds.length) return;
  const { data: existing, error: existingError } = await supabase
    .from('checklist_items')
    .select('apartment_id')
    .eq('obra_id', OBRA_ID)
    .eq('label', stage.nome)
    .is('deleted_at', null)
    .in('apartment_id', apartmentIds);
  if (existingError) throw existingError;
  const existingIds = new Set((existing ?? []).map((r) => r.apartment_id as string));
  const missing = apartmentIds.filter((id) => !existingIds.has(id));
  if (!missing.length) return;
  const rows = missing.map((aptId) => ({
    id: crypto.randomUUID(),
    obra_id: OBRA_ID,
    apartment_id: aptId,
    label: stage.nome,
    state: 'pending',
    comment: '',
    sort_order: stage.ordemExecucao,
    area: stage.area || 'Interior',
    is_extra: false,
  }));
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from('checklist_items').insert(rows.slice(i, i + BATCH));
    if (error) throw error;
  }
}

export async function removeStageFromApartments(stageName: string, apartmentIds: string[]): Promise<void> {
  if (!apartmentIds.length) return;
  const BATCH = 100;
  for (let i = 0; i < apartmentIds.length; i += BATCH) {
    const { error } = await supabase
      .from('checklist_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('obra_id', OBRA_ID)
      .eq('label', stageName)
      .is('deleted_at', null)
      .in('apartment_id', apartmentIds.slice(i, i + BATCH));
    if (error) throw error;
  }
}

// ─── Service categories ───────────────────────────────────────────────────────

function mapServiceCategory(row: Record<string, unknown>): ServiceCategory {
  return { id: row.id as string, nome: row.nome as string };
}

export async function loadServiceCategories(): Promise<ServiceCategory[]> {
  const { data, error } = await supabase
    .from('service_categories')
    .select('id, nome')
    .eq('obra_id', OBRA_ID)
    .order('nome');
  if (error) throw error;
  return (data ?? []).map(mapServiceCategory);
}

export async function saveServiceCategory(category: ServiceCategory): Promise<void> {
  const id = category.id || crypto.randomUUID();
  const { error } = await supabase.from('service_categories').upsert({
    id,
    obra_id: OBRA_ID,
    nome: category.nome,
  });
  if (error) throw error;
}

export async function renameServiceCategory(id: string, oldNome: string, newNome: string): Promise<void> {
  const { error } = await supabase
    .from('service_categories')
    .update({ nome: newNome })
    .eq('id', id);
  if (error) throw error;
  // Cascade to stages using the old name so existing groupings stay consistent.
  if (oldNome && oldNome !== newNome) {
    await supabase
      .from('service_stages')
      .update({ categoria: newNome })
      .eq('obra_id', OBRA_ID)
      .eq('categoria', oldNome);
  }
}

export async function countStagesUsingCategory(nome: string): Promise<number> {
  const { count, error } = await supabase
    .from('service_stages')
    .select('id', { count: 'exact', head: true })
    .eq('obra_id', OBRA_ID)
    .eq('categoria', nome);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteServiceCategory(id: string): Promise<void> {
  const { error } = await supabase.from('service_categories').delete().eq('id', id);
  if (error) throw error;
}

// ─── Service units ────────────────────────────────────────────────────────────

function mapServiceUnit(row: Record<string, unknown>): ServiceUnit {
  return { id: row.id as string, nome: row.nome as string };
}

export async function loadServiceUnits(): Promise<ServiceUnit[]> {
  const { data, error } = await supabase
    .from('service_units')
    .select('id, nome')
    .eq('obra_id', OBRA_ID)
    .order('nome');
  if (error) throw error;
  return (data ?? []).map(mapServiceUnit);
}

export async function saveServiceUnit(unit: ServiceUnit): Promise<void> {
  const id = unit.id || crypto.randomUUID();
  const { error } = await supabase.from('service_units').upsert({
    id,
    obra_id: OBRA_ID,
    nome: unit.nome,
  });
  if (error) throw error;
}

export async function renameServiceUnit(id: string, oldNome: string, newNome: string): Promise<void> {
  const { error } = await supabase
    .from('service_units')
    .update({ nome: newNome })
    .eq('id', id);
  if (error) throw error;
  if (oldNome && oldNome !== newNome) {
    await supabase
      .from('service_stages')
      .update({ unidade_medicao: newNome })
      .eq('obra_id', OBRA_ID)
      .eq('unidade_medicao', oldNome);
  }
}

export async function countStagesUsingUnit(nome: string): Promise<number> {
  const { count, error } = await supabase
    .from('service_stages')
    .select('id', { count: 'exact', head: true })
    .eq('obra_id', OBRA_ID)
    .eq('unidade_medicao', nome);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteServiceUnit(id: string): Promise<void> {
  const { error } = await supabase.from('service_units').delete().eq('id', id);
  if (error) throw error;
}

// ─── Workers ──────────────────────────────────────────────────────────────────

function mapWorker(row: Record<string, unknown>): Worker {
  return { id: row.id as string, nome: row.nome as string, funcao: row.funcao as string };
}

export async function loadWorkers(): Promise<Worker[]> {
  const { data, error } = await supabase
    .from('workers')
    .select('id, nome, funcao')
    .eq('obra_id', OBRA_ID)
    .order('nome');
  if (error) throw error;
  return (data ?? []).map(mapWorker);
}

export async function saveWorker(worker: Worker): Promise<void> {
  const id = worker.id || crypto.randomUUID();
  const { error } = await supabase.from('workers').upsert({
    id,
    obra_id: OBRA_ID,
    nome: worker.nome,
    funcao: worker.funcao,
  });
  if (error) throw error;
}

export async function deleteWorker(id: string): Promise<void> {
  const { error } = await supabase.from('workers').delete().eq('id', id);
  if (error) throw error;
}

// ─── Step assignments ─────────────────────────────────────────────────────────

export async function loadStepAssignments(apartmentId: string): Promise<Record<string, string[]>> {
  const { data, error } = await supabase
    .from('step_assignments')
    .select('item_id, worker_id')
    .eq('obra_id', OBRA_ID)
    .eq('apartment_id', apartmentId);
  if (error) throw error;
  const result: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const itemId = row.item_id as string;
    const workerId = row.worker_id as string;
    if (!result[itemId]) result[itemId] = [];
    result[itemId].push(workerId);
  }
  return result;
}

export async function setStepAssignments(
  apartmentId: string,
  itemId: string,
  workerIds: string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('step_assignments')
    .delete()
    .eq('obra_id', OBRA_ID)
    .eq('apartment_id', apartmentId)
    .eq('item_id', itemId);
  if (deleteError) throw deleteError;
  if (workerIds.length === 0) return;
  const rows = workerIds.map((workerId) => ({
    id: crypto.randomUUID(),
    obra_id: OBRA_ID,
    apartment_id: apartmentId,
    item_id: itemId,
    worker_id: workerId,
  }));
  const { error } = await supabase.from('step_assignments').insert(rows);
  if (error) throw error;
}
