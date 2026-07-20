import { supabase, OBRA_ID } from '@/src/lib/supabase';
import type { Apartment, ApartmentStatus, ChecklistItem, ChecklistState, Tower } from '@/src/data/mockObras';
import type { Measurement, MeasurementStatus, MeasurementType } from '@/src/data/localMeasurements';
import type { InspectionVisit, VisitChecklistCounts } from '@/src/data/localInspectionVisits';
import type { InspectionPhoto } from '@/src/data/localInspectionPhotos';
import { getServiceStagesFromStorage, type ServiceStage } from '@/src/data/serviceStages';
import {
  setCachedChecklist,
  setCachedTowerChecklist,
} from '@/src/data/checklistCache';
import type { ServiceCategory } from '@/src/data/serviceCategories';
import type { ServiceUnit } from '@/src/data/serviceUnits';
import type { Worker } from '@/src/data/serviceWorkers';
import type { ScheduleFields } from '@/src/data/schedule';

// A API do Supabase corta a resposta (padrão: 1000 linhas). Toda consulta que pode
// passar disso PRECISA paginar — senão volta truncada SEM erro nenhum. Sempre
// ordene por uma coluna única (ou use `id` como desempate) para a paginação ser
// estável entre as páginas.
const PAGE_SIZE = 1000;

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

// Rota validada: a Edge Function `upload-inspection-photo` confere a ASSINATURA
// do arquivo (o bucket só confere o Content-Type declarado). Fica atrás de uma
// flag porque a função precisa estar publicada antes — ligar isso sem o deploy
// derruba o envio de fotos. Sem a flag, o upload segue direto para o Storage,
// que continua protegido por RLS, limite de 10 MB e allowlist de MIME.
const UPLOAD_VIA_FUNCTION = process.env.EXPO_PUBLIC_PHOTO_UPLOAD_FN === '1';

export async function uploadInspectionPhoto(
  localUri: string,
  destinationPath: string,
  contentType = 'image/jpeg',
): Promise<string> {
  // Works for data:, file:, http(s):, blob: — fetch handles them all in RN/web.
  const response = await fetch(localUri);
  const blob = await response.blob();
  // Espelho local dos limites do servidor: falha cedo, com mensagem em português,
  // sem gastar a subida. Quem manda é o bucket (10 MB + MIME) e a RLS.
  if (!contentType.startsWith('image/')) {
    throw new Error(`Tipo de arquivo não permitido: ${contentType}`);
  }
  if (blob.size > MAX_PHOTO_BYTES) {
    throw new Error('Foto excede o tamanho máximo de 10 MB.');
  }

  if (UPLOAD_VIA_FUNCTION) {
    const { error } = await supabase.functions.invoke('upload-inspection-photo', {
      body: blob,
      headers: { 'x-photo-path': destinationPath },
    });
    if (error) throw error;
    return destinationPath;
  }

  // upsert: false — o caminho carrega um id único por foto, então colisão só
  // acontece por engano ou por má-fé. Sobrescrever calado uma evidência de obra
  // é perda de prova; melhor falhar e aparecer.
  const { error } = await supabase.storage
    .from(INSPECTION_PHOTOS_BUCKET)
    .upload(destinationPath, blob, { contentType, upsert: false });
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

// ─── Dashboard (Início) via RPC ───────────────────────────────────────────────
// O banco calcula as etapas "Atrasada" (mesma regra do Gantt) e devolve só as
// linhas relevantes — evita baixar ~17k itens no Início. `today` é a data LOCAL do
// aparelho (YYYY-MM-DD), para o "hoje" bater com o cliente independentemente do fuso.
export type DashboardLateStep = {
  id: string;
  apartmentId: string | null;
  aptNumber: string | null;
  towerName: string | null;
  levelCode: string | null;
  label: string;
  plannedEnd: string; // ISO YYYY-MM-DD
  delayDays: number;
};

// Emergência/observação: uma linha por item marcado (o Início agrupa e formata).
export type DashboardFlagRow = {
  scope: 'apt' | 'tower';
  itemId: string | null;
  aptId: string | null;
  towerId: string | null;
  towerName: string | null;
  aptNumber: string | null;
  levelCode: string | null;
  label: string;
  text: string;
};

export type ObraDashboard = {
  lateCount: number;
  lateUnits: number;
  late: DashboardLateStep[];
  emergencyUnits: number;
  emergency: DashboardFlagRow[];
  obsCount: number;
  obsUnits: number;
  observations: DashboardFlagRow[];
  totalSteps: number;
  pendingByService: { label: string; apartments: number }[];
};

type RawFlagRow = {
  scope: 'apt' | 'tower'; item_id?: string | null; apt_id: string | null;
  tower_id: string | null; tower_name: string | null; apt_number: string | null;
  level_code: string | null; label: string; text: string | null;
};

const mapFlagRow = (r: RawFlagRow): DashboardFlagRow => ({
  scope: r.scope,
  itemId: r.item_id ?? null,
  aptId: r.apt_id ?? null,
  towerId: r.tower_id ?? null,
  towerName: r.tower_name ?? null,
  aptNumber: r.apt_number ?? null,
  levelCode: r.level_code ?? null,
  label: r.label,
  text: r.text ?? '',
});

export async function loadObraDashboard(today: string): Promise<ObraDashboard> {
  const { data, error } = await supabase.rpc('obra_dashboard', { p_obra: OBRA_ID, p_today: today });
  if (error) throw error;
  const d = (data ?? {}) as {
    late_count?: number;
    late_units?: number;
    late?: Array<{
      id: string; apartment_id: string | null; apt_number: string | null;
      tower_name: string | null; level_code: string | null; label: string;
      planned_end: string; delay_days: number;
    }>;
    emergency_units?: number;
    emergency?: RawFlagRow[];
    obs_count?: number;
    obs_units?: number;
    observations?: RawFlagRow[];
    total_steps?: number;
    pending_by_service?: Array<{ label: string; apartments: number }>;
  };
  return {
    lateCount: d.late_count ?? 0,
    lateUnits: d.late_units ?? 0,
    late: (d.late ?? []).map((r) => ({
      id: r.id,
      apartmentId: r.apartment_id ?? null,
      aptNumber: r.apt_number ?? null,
      towerName: r.tower_name ?? null,
      levelCode: r.level_code ?? null,
      label: r.label,
      plannedEnd: r.planned_end,
      delayDays: r.delay_days ?? 0,
    })),
    emergencyUnits: d.emergency_units ?? 0,
    emergency: (d.emergency ?? []).map(mapFlagRow),
    obsCount: d.obs_count ?? 0,
    obsUnits: d.obs_units ?? 0,
    observations: (d.observations ?? []).map(mapFlagRow),
    totalSteps: d.total_steps ?? 0,
    pendingByService: (d.pending_by_service ?? []).map((p) => ({ label: p.label, apartments: p.apartments })),
  };
}

// Só as colunas que o `mapChecklistItem` realmente usa. O `select('*')` trazia a
// linha inteira (obra_id, tower_id, timestamps, deleted_at...) — bytes que
// atravessam a rede e são descartados no mapeamento.
const CHECKLIST_COLUMNS =
  'id,label,state,comment,emergency,planned_start,planned_end,actual_start,actual_end,sort_order,area,is_extra';

type PageResponse<T> = { data: T[] | null; count: number | null; error: unknown };

// Busca TODAS as páginas de uma consulta em paralelo.
//
// A paginação anterior era um laço sequencial: pedia a página 1, esperava,
// pedia a 2, esperava... Numa torre cheia (~36 aptos × ~160 etapas ≈ 5.7k
// linhas) isso são 6 idas ao servidor ENFILEIRADAS — a latência de cada uma
// somava, e era esse o ~1,5s de espera da tela de Corte.
//
// Com `expectedRows` (ex.: nº de aptos × tamanho do catálogo), TODAS as páginas
// previstas saem numa leva só — o caso comum vira UMA ida ao servidor. A primeira
// página ainda pede o total exato: se a estimativa ficou curta, uma segunda leva
// paralela busca o que faltou; se ficou longa, as páginas extras voltam vazias
// (custo desprezível). Sem estimativa, a primeira leva é só a página 0 e o resto
// sai em paralelo depois do total chegar (~2 idas).
// `Promise.all` preserva a ordem, então a ordenação por sort_order continua.
async function fetchAllPages<T>(
  page: (from: number, withCount: boolean) => PromiseLike<PageResponse<T>>,
  expectedRows?: number,
): Promise<T[]> {
  // Teto da leva inicial: uma estimativa absurda não pode virar rajada de requests.
  const MAX_FIRST_WAVE_PAGES = 20;
  const guessPages = expectedRows
    ? Math.min(Math.max(Math.ceil(expectedRows / PAGE_SIZE), 1), MAX_FIRST_WAVE_PAGES)
    : 1;

  const firstWave = await Promise.all(
    Array.from({ length: guessPages }, (_, i) => page(i * PAGE_SIZE, i === 0)),
  );
  const first = firstWave[0];
  if (first.error) throw first.error;
  const rows = [...(first.data ?? [])];
  // Coube tudo na primeira página: as demais (se pedidas) vieram vazias.
  if (rows.length < PAGE_SIZE) return rows;

  for (const res of firstWave.slice(1)) {
    if (res.error) throw res.error;
    rows.push(...(res.data ?? []));
  }

  // Sem o total não dá para paralelizar o restante. Continua sequencial de onde a
  // leva parou — truncar em silêncio é o pior desfecho aqui. (Páginas de range são
  // contíguas: só a última não-vazia pode vir incompleta, então "última página da
  // leva cheia" é o único caso em que pode haver mais.)
  if (first.count == null) {
    let lastLen = (firstWave[firstWave.length - 1].data ?? []).length;
    for (let from = guessPages * PAGE_SIZE; lastLen === PAGE_SIZE; from += PAGE_SIZE) {
      const res = await page(from, false);
      if (res.error) throw res.error;
      const more = res.data ?? [];
      rows.push(...more);
      lastLen = more.length;
    }
    return rows;
  }

  const totalPages = Math.ceil(first.count / PAGE_SIZE);
  if (totalPages > guessPages) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - guessPages }, (_, i) => page((guessPages + i) * PAGE_SIZE, false)),
    );
    for (const res of rest) {
      if (res.error) throw res.error;
      rows.push(...(res.data ?? []));
    }
  }
  return rows;
}

// Checklists de um conjunto de apartamentos (ex.: os de uma torre), numa query.
// Usado pelo Corte para o mapa de cobertura sem baixar a obra inteira.
export async function loadChecklistsForApartments(apartmentIds: string[]): Promise<Map<string, (ChecklistItem & ScheduleFields)[]>> {
  const byApartment = new Map<string, (ChecklistItem & ScheduleFields)[]>();
  if (apartmentIds.length === 0) return byApartment;

  // Estimativa para disparar todas as páginas numa leva só: cada apartamento tem
  // ~1 item por etapa do catálogo. Errar para cima custa páginas vazias; para
  // baixo, uma segunda leva — nunca truncamento (o count exato confere o total).
  const catalogSize = getServiceStagesFromStorage().length;
  const expectedRows = catalogSize > 0 ? apartmentIds.length * catalogSize : undefined;

  const rows = await fetchAllPages<DbChecklistRow & { apartment_id: string }>((from, withCount) =>
    supabase
      .from('checklist_items')
      .select(`${CHECKLIST_COLUMNS},apartment_id`, withCount ? { count: 'exact' } : undefined)
      .in('apartment_id', apartmentIds)
      .is('deleted_at', null)
      .order('sort_order')
      .order('id')
      .range(from, from + PAGE_SIZE - 1) as unknown as PromiseLike<PageResponse<DbChecklistRow & { apartment_id: string }>>,
  expectedRows);

  // Todo id pedido entra no mapa (mesmo vazio) — e no cache: "sem itens" também é
  // resposta, e o cache só serve um conjunto quando conhece TODOS os apartamentos.
  for (const id of apartmentIds) byApartment.set(id, []);
  for (const row of rows) byApartment.get(row.apartment_id)!.push(mapChecklistItem(row));
  for (const [id, items] of byApartment) setCachedChecklist(id, items);
  return byApartment;
}

// ─── Perfil + obras do usuário logado ────────────────────────────────────────────
export type UserObra = { id: string; name: string; summary: string; role: string };
export type Profile = { id: string; name: string; email: string };

export async function loadMyObras(): Promise<UserObra[]> {
  const { data, error } = await supabase
    .from('user_obras')
    .select('role, obra:obras(id, name, summary)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((row) => {
      const o = row.obra as unknown as { id: string; name: string; summary: string | null } | null;
      return o ? { id: o.id, name: o.name, summary: o.summary ?? '', role: row.role as string } : null;
    })
    .filter((o): o is UserObra => o !== null);
}

export async function loadProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('id, name, email').maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, name: (data.name as string) ?? '', email: (data.email as string) ?? '' } : null;
}

export async function updateProfileName(name: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return;
  const { error } = await supabase.from('profiles').update({ name }).eq('id', uid);
  if (error) throw error;
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

// Apartamentos SEM o checklist aninhado. Antes: um join aninhado
// (apartments + checklist_items) que trazia ~17k linhas numa query pesada; agora
// é uma query plana e leve (110 linhas). O checklist vem em separado via
// loadAllChecklistItems (bulk) ou loadChecklist (por apartamento).
export async function fetchApartments(): Promise<Apartment[]> {
  const { data, error } = await supabase
    .from('apartments')
    .select('*')
    .eq('obra_id', OBRA_ID)
    .order('number');
  if (error) throw error;
  return (data ?? []).map((row) => mapApartment({ ...row, checklist_items: [] }));
}

// Todos os itens de checklist de apartamento da obra numa única query plana,
// agrupados por apartamento. Roda em paralelo com fetchApartments no boot e é
// mesclado no contexto — substitui o join aninhado por dois SELECTs indexados.
export async function loadAllChecklistItems(): Promise<Map<string, (ChecklistItem & ScheduleFields)[]>> {
  const byApartment = new Map<string, (ChecklistItem & ScheduleFields)[]>();
  // PAGINADO E EM PARALELO: são ~17k itens e a API corta em 1000 linhas por
  // requisição — 17 páginas, que enfileiradas custariam vários segundos.
  // Ordena por (sort_order, id) — o id desempata e mantém a paginação estável.
  const rows = await fetchAllPages<DbChecklistRow & { apartment_id: string }>((from, withCount) =>
    supabase
      .from('checklist_items')
      .select(`${CHECKLIST_COLUMNS},apartment_id`, withCount ? { count: 'exact' } : undefined)
      .eq('obra_id', OBRA_ID)
      .not('apartment_id', 'is', null)
      .is('deleted_at', null)
      .order('sort_order')
      .order('id')
      .range(from, from + PAGE_SIZE - 1) as unknown as PromiseLike<PageResponse<DbChecklistRow & { apartment_id: string }>>,
  );

  for (const row of rows) {
    const item = mapChecklistItem(row);
    const list = byApartment.get(row.apartment_id);
    if (list) list.push(item);
    else byApartment.set(row.apartment_id, [item]);
  }
  return byApartment;
}

// Um apartamento só (com seu checklist). Usado para atualizar UM apartamento no
// contexto sem baixar a obra inteira. RLS garante o escopo por obra; o filtro por
// id (PK global) já é suficiente.
export async function fetchApartment(apartmentId: string): Promise<Apartment | null> {
  const { data, error } = await supabase
    .from('apartments')
    .select('*, checklist_items(*)')
    .eq('id', apartmentId)
    .is('checklist_items.deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const apartment = mapApartment(data);
  setCachedChecklist(apartment.id, apartment.checklist);
  return apartment;
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
    .select(CHECKLIST_COLUMNS)
    .eq('apartment_id', apartmentId)
    .is('deleted_at', null)
    .order('sort_order');
  if (error) throw error;
  const items = ((data ?? []) as DbChecklistRow[]).map(mapChecklistItem);
  setCachedChecklist(apartmentId, items);
  return items;
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

// ─── Checklist da torre (Corte da Torre) ──────────────────────────────────────
// Itens com escopo torre+nível (apartment_id NULL): etapas como Fundação,
// Limpeza do terreno e Reservatório, que não pertencem a um apartamento.
// level_code referencia o catálogo em src/data/towerLevels.ts.

export type TowerChecklistItem = ChecklistItem & ScheduleFields & { levelCode: string };

// A migração 20260703000000_tower_checklist ainda não foi aplicada quando o
// banco responde 42703 (coluna inexistente) para tower_id/level_code.
export function isMissingTowerColumns(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '42703');
}

export async function loadTowerChecklist(towerId: string): Promise<TowerChecklistItem[]> {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('tower_id', towerId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('label');
  if (error) throw error;
  const items = (data ?? []).map((row) => ({
    ...mapChecklistItem(row as DbChecklistRow),
    levelCode: (row as { level_code?: string | null }).level_code ?? '',
  }));
  setCachedTowerChecklist(towerId, items);
  return items;
}

// Adiciona uma etapa ao nível da torre. Idempotente: se já existe uma etapa
// ativa com o mesmo rótulo neste nível, reaproveita a linha em vez de duplicar
// (mesmo critério — label — usado por addStageToApartments). checklist_items.id
// é uuid no banco, então geramos com crypto.randomUUID como no resto do app.
export async function addTowerChecklistItem(params: {
  towerId: string;
  levelCode: string;
  label: string;
  sortOrder?: number;
}): Promise<TowerChecklistItem> {
  const { data: existing, error: exErr } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('tower_id', params.towerId)
    .eq('level_code', params.levelCode)
    .eq('label', params.label)
    .is('deleted_at', null)
    .limit(1);
  if (exErr) throw exErr;
  if (existing && existing.length) {
    return { ...mapChecklistItem(existing[0] as DbChecklistRow), levelCode: params.levelCode };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from('checklist_items').insert({
    id,
    obra_id: OBRA_ID,
    apartment_id: null,
    tower_id: params.towerId,
    level_code: params.levelCode,
    label: params.label,
    state: 'pending',
    comment: '',
    sort_order: params.sortOrder ?? 0,
    area: 'Torre',
    is_extra: false,
  });
  if (error) throw error;
  return { id, label: params.label, state: 'pending', area: 'Torre', levelCode: params.levelCode };
}

// Atualiza uma etapa de torre existente (mudança de estado, datas...). A linha
// já existe com seu uuid; upsert por id preserva sort_order (coluna omitida).
export async function upsertTowerChecklistItem(
  item: ChecklistItem & ScheduleFields & { towerId: string; levelCode: string },
): Promise<void> {
  const { error } = await supabase.from('checklist_items').upsert({
    id: item.id,
    obra_id: OBRA_ID,
    apartment_id: null,
    tower_id: item.towerId,
    level_code: item.levelCode,
    label: item.label,
    state: item.state,
    comment: item.comment ?? '',
    emergency: item.emergency ?? '',
    planned_start: toIsoDate(item.plannedStart),
    planned_end: toIsoDate(item.plannedEnd),
    actual_start: toIsoDate(item.actualStart),
    actual_end: toIsoDate(item.actualEnd),
    area: item.area ?? 'Torre',
    is_extra: item.isExtra ?? false,
  });
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
  // PAGINADO: uma obra real passa de 1000 medições. `id` desempata o created_at
  // (que pode repetir) e mantém a paginação estável.
  const out: Measurement[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('measurements')
      .select('*')
      .eq('obra_id', OBRA_ID)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) out.push(mapMeasurement(row));
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
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

// PAGINADO: todas as visitas de apartamento da obra, agrupadas por apartamento.
// Usado pelos relatórios (antes vinha do localStorage). Exclui as visitas de
// nível de torre, que moram na mesma tabela com apartment_id NULL.
export async function loadVisitsByApartment(): Promise<Map<string, InspectionVisit[]>> {
  const out = new Map<string, InspectionVisit[]>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('inspection_visits')
      .select('*')
      .eq('obra_id', OBRA_ID)
      .not('apartment_id', 'is', null)
      .order('date', { ascending: false })
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      const key = row.apartment_id as string;
      const list = out.get(key);
      if (list) list.push(mapVisit(row));
      else out.set(key, [mapVisit(row)]);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
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

// ─── Vistorias com escopo de nível de torre ─────────────────────────────────────
// Mesma tabela das visitas de apartamento, com escopo (tower_id, level_code) e
// apartment_id NULL (ver migração 20260705000000_tower_visits).
export async function loadTowerVisits(towerId: string, levelCode: string): Promise<InspectionVisit[]> {
  const { data, error } = await supabase
    .from('inspection_visits')
    .select('*')
    .eq('tower_id', towerId)
    .eq('level_code', levelCode)
    .is('apartment_id', null)
    .eq('obra_id', OBRA_ID)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapVisit);
}

export async function saveTowerVisit(visit: InspectionVisit, towerId: string, levelCode: string): Promise<void> {
  const { error } = await supabase.from('inspection_visits').upsert({
    id: visit.id,
    obra_id: OBRA_ID,
    apartment_id: null,
    tower_id: towerId,
    level_code: levelCode,
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

// Quantas URLs assinar por chamada ao Storage.
const SIGN_CHUNK = 100;

// PAGINADO: todas as fotos de apartamento da obra, agrupadas por apartamento.
// Assinar URL custa uma chamada ao Storage por lote, e o relatório nunca exibe
// mais que `signLimit` fotos por apartamento — então só as primeiras de cada um
// recebem URL. As demais entram sem `uri` (nunca são renderizadas), mas seguem
// na lista para que a contagem total do relatório continue correta.
export async function loadPhotosByApartment(signLimit = 6): Promise<Map<string, InspectionPhoto[]>> {
  const rowsByApartment = new Map<string, Record<string, unknown>[]>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('inspection_photos')
      .select('*')
      .eq('obra_id', OBRA_ID)
      .not('apartment_id', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      const key = row.apartment_id as string;
      const list = rowsByApartment.get(key);
      if (list) list.push(row);
      else rowsByApartment.set(key, [row]);
    }
    if (rows.length < PAGE_SIZE) break;
  }

  const toSign: string[] = [];
  for (const rows of rowsByApartment.values()) {
    for (const row of rows.slice(0, signLimit)) {
      const path = (row.storage_path as string) ?? '';
      if (path && !isLegacyPhotoUri(path)) toSign.push(path);
    }
  }

  const signedUrls = new Map<string, string>();
  for (let i = 0; i < toSign.length; i += SIGN_CHUNK) {
    const { data: signed, error } = await supabase.storage
      .from(INSPECTION_PHOTOS_BUCKET)
      .createSignedUrls(toSign.slice(i, i + SIGN_CHUNK), SIGNED_URL_TTL_SECONDS);
    if (error) throw error;
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedUrls.set(entry.path, entry.signedUrl);
    }
  }

  const out = new Map<string, InspectionPhoto[]>();
  for (const [key, rows] of rowsByApartment) {
    out.set(key, rows.map((row) => mapPhoto(row, signedUrls)));
  }
  return out;
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

// ─── Fotos com escopo de nível de torre ─────────────────────────────────────────
// Mesma tabela/bucket das fotos de apartamento, mas o escopo é (tower_id,
// level_code) com apartment_id NULL (ver migração 20260704000000_tower_photos).
export async function loadTowerPhotos(towerId: string, levelCode: string): Promise<InspectionPhoto[]> {
  const { data, error } = await supabase
    .from('inspection_photos')
    .select('*')
    .eq('tower_id', towerId)
    .eq('level_code', levelCode)
    .is('apartment_id', null)
    .eq('obra_id', OBRA_ID)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

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

// Todas as fotos com escopo de nível da torre (qualquer level_code).
export async function loadAllTowerPhotos(towerId: string): Promise<InspectionPhoto[]> {
  const { data, error } = await supabase
    .from('inspection_photos')
    .select('*')
    .eq('tower_id', towerId)
    .is('apartment_id', null)
    .not('level_code', 'is', null)
    .eq('obra_id', OBRA_ID)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

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

export async function saveTowerPhoto(photo: InspectionPhoto, levelCode: string): Promise<void> {
  const { error } = await supabase.from('inspection_photos').upsert({
    id: photo.id,
    obra_id: OBRA_ID,
    tower_id: photo.towerId,
    apartment_id: null,
    level_code: levelCode,
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

// ─── Checklist status events (histórico de progresso — Option C) ───────────────

export async function logStatusEvent(e: {
  apartmentId: string;
  itemId: string;
  fromState?: ChecklistState | null;
  toState: ChecklistState;
}): Promise<void> {
  const { error } = await supabase.from('checklist_status_events').insert({
    obra_id: OBRA_ID,
    apartment_id: e.apartmentId,
    item_id: e.itemId,
    from_state: e.fromState ?? null,
    to_state: e.toState,
  });
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

// Todas as alocações de colaboradores da obra numa única query, agrupadas por
// apartamento e etapa: Record<apartmentId, Record<itemId, workerId[]>>. Evita o
// fan-out de 1 request por apartamento no Cronograma.
export async function loadAllStepAssignments(): Promise<Record<string, Record<string, string[]>>> {
  // PAGINADO: alocações crescem com apartamentos × etapas × colaboradores.
  const result: Record<string, Record<string, string[]>> = {};
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('step_assignments')
      .select('apartment_id, item_id, worker_id')
      .eq('obra_id', OBRA_ID)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      const apartmentId = row.apartment_id as string;
      const itemId = row.item_id as string;
      const workerId = row.worker_id as string;
      if (!result[apartmentId]) result[apartmentId] = {};
      if (!result[apartmentId][itemId]) result[apartmentId][itemId] = [];
      result[apartmentId][itemId].push(workerId);
    }
    if (rows.length < PAGE_SIZE) break;
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
