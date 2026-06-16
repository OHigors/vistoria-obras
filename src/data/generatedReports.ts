import { getInspectionPhotosFromStorage, getInspectionPhotoStorageKey } from '@/src/data/localInspectionPhotos';
import { getInspectionVisitsFromStorage, getInspectionVisitStorageKey, localResponsible } from '@/src/data/localInspectionVisits';
import { formatCurrency, loadAllMeasurements, parseBrDateForMeasurement } from '@/src/data/localMeasurements';
import { apartments, getTowerById, project } from '@/src/data/mockObras';
import { getScheduleRows, getScheduledChecklistForApartment } from '@/src/data/schedule';
import { getBlockedServiceGroups } from '@/src/data/serviceBlockers';
import { isCriticalStageForStatus } from '@/src/data/serviceStages';
import { statusConfig } from '@/src/ui/status';

export type ReportKind = 'daily' | 'tower' | 'apartment' | 'service' | 'contractor';

export type ReportContentOptions = {
  includeBlocked: boolean;
  includeChecklist: boolean;
  includeHistory: boolean;
  includeMeasurements: boolean;
  includePhotos: boolean;
  includeSchedule: boolean;
  includeSummary: boolean;
  includeIssues: boolean;
};

export type ReportFilters = {
  apartment: string;
  contractor: string;
  date: string;
  periodEnd: string;
  periodStart: string;
  service: string;
  tower: string;
};

export type GeneratedReport = {
  csvHeader: string[];
  csvRows: (string | number)[][];
  html: string;
  isValid: boolean;
  text: string;
  validationMessage: string;
};

export const reportCsvHeader = [
  'tipo_registro',
  'obra',
  'torre',
  'apartamento',
  'serviço',
  'status',
  'criticidade',
  'pendência',
  'bloqueado_por',
  'dias_atraso',
  'empreiteiro',
  'quantidade',
  'unidade',
  'valor_unitario',
  'valor_total',
  'data',
] as const;

export const validateReportFilters = (kind: ReportKind, filters: ReportFilters) => {
  if (kind === 'tower' && (!filters.tower || filters.tower === 'Todos')) {
    return 'Selecione uma torre para gerar relatório por torre.';
  }

  if (kind === 'apartment' && !filters.apartment.trim()) {
    return 'Informe um apartamento para gerar relatório por apartamento.';
  }

  if (kind === 'service' && !filters.service.trim()) {
    return 'Informe um serviço para gerar relatório por serviço.';
  }

  if (kind === 'contractor' && !filters.contractor.trim()) {
    return 'Informe um empreiteiro para gerar relatório por empreiteiro.';
  }

  return '';
};

const emptyValue = 'não informado';
const emptyBlockValue = 'não bloqueado';

type ServiceLikeRecord = {
  etapaNome?: string;
  nome?: string;
  service?: string;
  serviceName?: string;
  servicoNome?: string;
};

export const getNomeServicoOuEtapa = (record: ServiceLikeRecord) =>
  record.etapaNome?.trim() ||
  record.servicoNome?.trim() ||
  record.serviceName?.trim() ||
  record.service?.trim() ||
  record.nome?.trim() ||
  emptyValue;

const calculateProgress = (items: ReturnType<typeof getScheduledChecklistForApartment>) => {
  const score = items.reduce((total, item) => {
    if (item.state === 'ok' || item.state === 'notApplicable') {
      return total + 1;
    }

    if (item.state === 'partial') {
      return total + 0.5;
    }

    return total;
  }, 0);

  return items.length ? Math.round((score / items.length) * 100) : 0;
};

const calculateStatus = (items: ReturnType<typeof getScheduledChecklistForApartment>, progress: number) => {
  const pendingCount = items.filter((item) => item.state === 'pending').length;
  const partialCount = items.filter((item) => item.state === 'partial').length;
  const hasCriticalStage = items.some(
    (item) =>
      (item.state === 'pending' || item.state === 'partial') &&
      isCriticalStageForStatus(item.label),
  );

  if (progress < 50 || hasCriticalStage || pendingCount >= Math.max(3, Math.ceil(items.length * 0.35))) {
    return 'critical';
  }

  if ((progress >= 50 && progress <= 74) || partialCount > 0) {
    return 'attention';
  }

  if (progress >= 90 && pendingCount === 0) {
    return 'excellent';
  }

  return 'good';
};

const matchesText = (value: string, filter: string) =>
  !filter.trim() || value.toLocaleLowerCase('pt-BR').includes(filter.trim().toLocaleLowerCase('pt-BR'));

const normalizeApartmentFilter = (value: string) =>
  value.toLocaleLowerCase('pt-BR').replace(/apartamento|ap|\s/g, '').trim();

const isInPeriod = (value: string, periodStart: string, periodEnd: string) => {
  if (!periodStart.trim() && !periodEnd.trim()) {
    return true;
  }

  const date = parseBrDateForMeasurement(value);
  const start = periodStart.trim() ? parseBrDateForMeasurement(periodStart.trim()) : undefined;
  const end = periodEnd.trim() ? parseBrDateForMeasurement(periodEnd.trim()) : undefined;

  if (!date) {
    return true;
  }

  return (!start || date.getTime() >= start.getTime()) && (!end || date.getTime() <= end.getTime());
};

const getReportTitle = (kind: ReportKind) => {
  if (kind === 'tower') return 'Relatório por torre';
  if (kind === 'apartment') return 'Relatório por apartamento';
  if (kind === 'service') return 'Relatório por serviço';
  if (kind === 'contractor') return 'Relatório por empreiteiro';
  return 'Relatório do dia da obra';
};

const getToday = () => new Intl.DateTimeFormat('pt-BR').format(new Date());

export const formatReportDateTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(value))
    : emptyValue;

const escapeHtml = (value: string | number) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const renderRows = (rows: (string | number)[][], emptyMessage: string, columnCount: number) =>
  rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columnCount}" class="empty">${emptyMessage}</td></tr>`;

const renderTable = (headers: string[], rows: (string | number)[][], emptyMessage: string) => `
  <table>
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
    <tbody>${renderRows(rows, emptyMessage, headers.length)}</tbody>
  </table>
`;

const getVisitVariationLabel = (variation: number) => {
  if (variation > 0) {
    return `EvoluÃ§Ã£o: +${variation} p.p.`;
  }

  if (variation < 0) {
    return `RegressÃ£o: ${variation} p.p.`;
  }

  return 'Sem variaÃ§Ã£o: 0 p.p.';
};

const escapeCsvValue = (value: string | number) => {
  let text = String(value);

  // Neutralize spreadsheet formula injection: user-entered text starting with
  // =, +, -, @ or tab would execute as a formula when opened in Excel.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (text.includes('"') || text.includes(';') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
};

const createCsvText = (rows: (string | number)[][]) =>
  '\uFEFF' + [[...reportCsvHeader], ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(';'))
    .join('\n');

export const createGeneratedReport = (
  kind: ReportKind,
  filters: ReportFilters,
  options: ReportContentOptions,
): GeneratedReport => {
  const validationMessage = validateReportFilters(kind, filters);
  const isValid = !validationMessage;
  const measurements = loadAllMeasurements(apartments.map((apartment) => apartment.id));
  const apartmentFilter = normalizeApartmentFilter(filters.apartment);
  const selectedApartments = isValid ? apartments.filter((apartment) => {
    const tower = getTowerById(apartment.towerId);
    const apartmentChecklist = getScheduledChecklistForApartment(apartment);
    const apartmentMatches = kind === 'apartment'
      ? normalizeApartmentFilter(apartment.number) === apartmentFilter
      : matchesText(apartment.number, filters.apartment);
    const serviceMatches = kind !== 'service' || (
      apartmentChecklist.some((item) => matchesText(item.label, filters.service)) ||
      measurements.some((measurement) =>
        measurement.apartmentId === apartment.id &&
        matchesText(getNomeServicoOuEtapa(measurement), filters.service),
      )
    );

    return (
      (!filters.tower || filters.tower === 'Todos' || apartment.towerId === filters.tower) &&
      apartmentMatches &&
      serviceMatches &&
      matchesText(tower ? `${tower.name} ${tower.block} ${tower.position}` : apartment.towerId, filters.tower === 'Todos' ? '' : '') &&
      (kind !== 'contractor' || measurements.some((measurement) => measurement.apartmentId === apartment.id && matchesText(measurement.contractor, filters.contractor)))
    );
  }) : [];

  const textLines = [
    'RELATÓRIO DE OBRA',
    `Obra: ${project.name}`,
    `Data: ${filters.date || getToday()}`,
    `Tipo: ${getReportTitle(kind)}`,
    `Responsável: ${localResponsible}`,
    '',
  ];
  if (validationMessage) {
    textLines.push(`Aviso: ${validationMessage}`);
  }
  const csvRows: (string | number)[][] = [];
  const htmlSections: string[] = [];

  selectedApartments.forEach((apartment) => {
    const tower = getTowerById(apartment.towerId);
    const towerLabel = tower ? `${tower.name} / ${tower.block} / ${tower.position}` : apartment.towerId;
    const checklist = getScheduledChecklistForApartment(apartment).filter((item) => matchesText(item.label, filters.service));
    const progress = calculateProgress(checklist);
    const status = statusConfig[calculateStatus(checklist, progress)];
    const pendingItems = checklist.filter((item) => item.state === 'pending' || item.state === 'partial');
    const blockedGroups = getBlockedServiceGroups(checklist);
    const blockingPendingCount = blockedGroups.length;
    const impactedServicesCount = blockedGroups.reduce(
      (total, group) => total + group.blockedServices.length,
      0,
    );
    const scheduleRows = getScheduleRows(checklist);
    const delayedRows = scheduleRows.filter((row) => row.delayDays > 0);
    const apartmentMeasurements = measurements.filter((measurement) =>
      measurement.apartmentId === apartment.id &&
      matchesText(getNomeServicoOuEtapa(measurement), filters.service) &&
      matchesText(measurement.contractor, filters.contractor) &&
      isInPeriod(measurement.periodStart, filters.periodStart, filters.periodEnd),
    );
    const photos = getInspectionPhotosFromStorage(getInspectionPhotoStorageKey(apartment.id));
    const visits = getInspectionVisitsFromStorage(getInspectionVisitStorageKey(apartment.id));
    const latestVisit = [...visits].sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())[0];

    if (options.includeSummary) {
      textLines.push(`Apartamento ${apartment.number} - ${towerLabel}`);
      textLines.push(`Status: ${status.label}`);
      textLines.push(`Avanço: ${progress}%`);
      textLines.push(`Pendências: ${pendingItems.length}`);
      textLines.push(`Pendências travantes: ${blockingPendingCount}`);
      textLines.push(`Serviços impactados: ${impactedServicesCount}`);
      textLines.push(`Atrasos: ${delayedRows.length}`);
      textLines.push(`Medições: ${formatCurrency(apartmentMeasurements.reduce((total, measurement) => total + measurement.totalValue, 0))}`);
      textLines.push('');
      csvRows.push(['resumo', project.name, towerLabel, apartment.number, emptyValue, status.label, emptyValue, emptyValue, emptyBlockValue, Math.max(0, ...scheduleRows.map((row) => row.delayDays)), emptyValue, emptyValue, emptyValue, emptyValue, apartmentMeasurements.reduce((total, measurement) => total + measurement.totalValue, 0), filters.date || getToday()]);
    }

    if (options.includeChecklist) {
      checklist.forEach((item) => {
        csvRows.push(['checklist', project.name, towerLabel, apartment.number, item.label, item.state, emptyValue, item.comment ?? emptyValue, emptyBlockValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, filters.date || getToday()]);
      });
    }

    if (options.includeIssues) {
      pendingItems.forEach((item) => {
        csvRows.push(['pendencia', project.name, towerLabel, apartment.number, item.label, item.state === 'pending' ? 'Pendente' : 'Parcial', 'Média', item.comment ?? 'Pendência de vistoria', (getBlockedServiceGroups([item])[0]?.blockedServices ?? []).join(', ') || emptyBlockValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, filters.date || getToday()]);
      });
    }

    if (options.includeBlocked) {
      blockedGroups.forEach((group) => {
        csvRows.push(['servico_travado', project.name, towerLabel, apartment.number, group.pendingService, group.currentStatus, emptyValue, emptyValue, group.pendingService, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, filters.date || getToday()]);
      });
    }

    if (options.includeSchedule) {
      scheduleRows.forEach((row) => {
        csvRows.push(['cronograma', project.name, towerLabel, apartment.number, row.service, row.scheduleStatus, emptyValue, emptyValue, row.blockedServices.join(', ') || emptyBlockValue, row.delayDays, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, row.plannedEnd || filters.date || getToday()]);
      });
    }

    if (options.includeMeasurements) {
      apartmentMeasurements.forEach((measurement) => {
        csvRows.push(['medicao', project.name, towerLabel, apartment.number, getNomeServicoOuEtapa(measurement), measurement.status, emptyValue, emptyValue, emptyBlockValue, emptyValue, measurement.contractor || emptyValue, measurement.quantity, measurement.unit || measurement.unidadeMedicao || emptyValue, measurement.unitPrice, measurement.totalValue, measurement.periodStart || measurement.periodoInicio || filters.date || getToday()]);
      });
    }

    if (options.includeHistory && latestVisit) {
      csvRows.push(['visita', project.name, towerLabel, apartment.number, emptyValue, statusConfig[latestVisit.statusAfter].label, emptyValue, getVisitVariationLabel(latestVisit.evolution), emptyBlockValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, formatReportDateTime(latestVisit.date)]);
    }

    if (options.includePhotos) {
      photos.slice(0, 6).forEach((photo) => {
        csvRows.push(['foto', project.name, towerLabel, apartment.number, photo.service, 'Anexada', emptyValue, photo.comment || emptyValue, emptyBlockValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, emptyValue, formatReportDateTime(photo.dataHora ?? photo.createdAt)]);
      });
    }

    const issueRows = pendingItems.map((item) => {
      const issue = item as typeof item & { issueComment?: string; issueCriticality?: string };
      return [
        item.label,
        issue.issueComment || item.comment || 'Pendência de vistoria',
        item.state === 'pending' ? 'Pendente' : 'Parcial',
        issue.issueCriticality || 'Média',
        (getBlockedServiceGroups([item])[0]?.blockedServices ?? []).join(', ') || emptyBlockValue,
        item.comment || emptyValue,
      ];
    });
    const blockedRows = blockedGroups.map((group) => [
      group.pendingService,
      group.blockedServices.join(', '),
      group.currentStatus,
      group.impact === 'Crítico' || group.impact === 'Alto' ? 'Alto impacto' : 'Em risco',
      group.blockedServices.some((service) => service.includes('entrega') || service.includes('liberação'))
        ? 'Impacta liberação'
        : 'Não impacta liberação final',
    ]);
    const scheduleTableRows = scheduleRows.map((row) => [
      row.service,
      row.scheduleStatus,
      row.delayDays,
      getBlockedServiceGroups(checklist).find((group) => group.blockedServices.includes(row.service))?.pendingService ?? emptyBlockValue,
      row.blockedServices.length ? `Trava: ${row.blockedServices.join(', ')}` : emptyValue,
    ]);
    const measurementTableRows = apartmentMeasurements.map((measurement) => [
      getNomeServicoOuEtapa(measurement),
      measurement.contractor || emptyValue,
      `${measurement.periodStart || measurement.periodoInicio || emptyValue} até ${measurement.periodEnd || measurement.periodoFim || emptyValue}`,
      measurement.quantity,
      measurement.unit || measurement.unidadeMedicao || emptyValue,
      formatCurrency(measurement.totalValue),
      measurement.status,
    ]);
    const pdfPhotoLimit = kind === 'daily' ? 3 : 6;
    const visiblePdfPhotos = photos.slice(0, pdfPhotoLimit);
    const hiddenPdfPhotoCount = Math.max(0, photos.length - visiblePdfPhotos.length);
    const photoCards = photos.length
      ? `${visiblePdfPhotos.map((photo) => `
          <figure class="photo-card">
            <img src="${escapeHtml(photo.uri)}" alt="${escapeHtml(photo.service)}" />
            <figcaption>
              <strong>${escapeHtml(photo.service)}</strong><br />
              ${escapeHtml(formatReportDateTime(photo.dataHora ?? photo.createdAt))}<br />
              ${escapeHtml(photo.comment || 'sem comentário')}
            </figcaption>
          </figure>
        `).join('')}${
          hiddenPdfPhotoCount > 0
            ? `<p class="photo-extra">+ ${hiddenPdfPhotoCount} foto(s) adicionais disponíveis no app</p>`
            : ''
        }`
      : '<p class="empty">Nenhuma foto adicionada neste relatório.</p>';
    const visitVariation = latestVisit ? getVisitVariationLabel(latestVisit.evolution) : emptyValue;

    htmlSections.push(`
      <section class="unit-section">
        <h2>${escapeHtml(towerLabel)} - Apartamento ${escapeHtml(apartment.number)}</h2>
        <div class="unit-meta">
          <span><strong>Torre:</strong> ${escapeHtml(towerLabel)}</span>
          <span><strong>Apartamento:</strong> ${escapeHtml(apartment.number)}</span>
          <span><strong>Pavimento:</strong> ${escapeHtml(apartment.floor)}</span>
          <span><strong>Status do apartamento:</strong> ${escapeHtml(status.label)}</span>
          <span><strong>Avanço percentual:</strong> ${progress}%</span>
          <span><strong>Pendências:</strong> ${pendingItems.length}</span>
          <span><strong>Pendências travantes:</strong> ${blockingPendingCount}</span>
          <span><strong>Serviços impactados:</strong> ${impactedServicesCount}</span>
          <span><strong>Fotos:</strong> ${photos.length}</span>
          <span><strong>Medições:</strong> ${apartmentMeasurements.length}</span>
        </div>

        <div class="summary-grid">
          <div class="summary-card"><strong>Status da unidade</strong><span>${escapeHtml(status.label)}</span></div>
          <div class="summary-card"><strong>Avanço</strong><span>${progress}%</span></div>
          <div class="summary-card"><strong>Pendências</strong><span>${pendingItems.length}</span></div>
          <div class="summary-card"><strong>Pendências travantes</strong><span>${blockingPendingCount}</span></div>
          <div class="summary-card"><strong>Serviços impactados</strong><span>${impactedServicesCount}</span></div>
          <div class="summary-card"><strong>Atrasos</strong><span>${delayedRows.length}</span></div>
          <div class="summary-card"><strong>Medições</strong><span>${formatCurrency(apartmentMeasurements.reduce((total, measurement) => total + measurement.totalValue, 0))}</span></div>
        </div>

        <h3>Pendências do dia</h3>
        ${renderTable(['Serviço', 'Descrição', 'Status', 'Criticidade', 'Trava serviço', 'Observação'], issueRows, 'Nenhuma pendência registrada.')}

        <h3>Serviços travados</h3>
        ${renderTable(['Serviço origem', 'Serviços impactados', 'Tipo de bloqueio', 'Impacto no cronograma', 'Impacto na liberação'], blockedRows, 'Nenhum serviço travado.')}

        <h3>Cronograma</h3>
        ${renderTable(['Serviço', 'Status', 'Dias de atraso', 'Bloqueado por', 'Observação'], scheduleTableRows, 'Nenhum item de cronograma registrado.')}

        <h3>Medições</h3>
        ${renderTable(['Serviço', 'Empreiteiro', 'Período', 'Quantidade', 'Unidade', 'Valor total', 'Status'], measurementTableRows, 'Nenhuma medição registrada.')}

        <h3>Fotos adicionadas</h3>
        <div class="photo-grid">${options.includePhotos ? photoCards : '<p class="empty">Fotos não incluídas neste relatório.</p>'}</div>

        <h3>Histórico da visita</h3>
        ${latestVisit
          ? renderTable(
              ['Data da visita', 'Responsável', 'Percentual antes', 'Percentual depois', 'Evolução ou regressão', 'Status após visita', 'Observação geral'],
              [[formatReportDateTime(latestVisit.date), latestVisit.responsible, `${latestVisit.progressBefore}%`, `${latestVisit.progressAfter}%`, visitVariation, statusConfig[latestVisit.statusAfter].label, latestVisit.generalNote || emptyValue]],
              'Nenhuma visita registrada.',
            )
          : '<p class="empty">Nenhuma visita registrada.</p>'}
      </section>
    `);
  });

  const csvText = createCsvText(csvRows);
  const generatedAtText = formatReportDateTime(new Date().toISOString());
  if (isValid && selectedApartments.length === 0) {
    textLines.push('Nenhum dado encontrado para os filtros selecionados.');
    htmlSections.push('<section class="unit-section"><p class="empty">Nenhum dado encontrado para os filtros selecionados.</p></section>');
  }
  const html = `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>${getReportTitle(kind)}</title>
        <style>
          * { box-sizing: border-box; }
          body { background: #eef2f7; color: #0f172a; font-family: Arial, sans-serif; margin: 0; padding: 24px; }
          .report-shell { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; margin: 0 auto; max-width: 1100px; padding: 28px; }
          .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-bottom: 18px; }
          button { background: #2563eb; border: 0; border-radius: 8px; color: #ffffff; cursor: pointer; font-size: 13px; font-weight: 700; padding: 10px 14px; }
          button.secondary { background: #ffffff; border: 1px solid #cbd5e1; color: #2563eb; }
          .report-header { border-bottom: 2px solid #0f172a; margin-bottom: 20px; padding-bottom: 16px; }
          h1 { font-size: 26px; margin: 0 0 8px; }
          h2 { border-bottom: 1px solid #e2e8f0; font-size: 20px; margin: 28px 0 12px; padding-bottom: 8px; }
          h3 { color: #1e293b; font-size: 15px; margin: 22px 0 8px; }
          .header-grid, .unit-meta { display: grid; gap: 8px 14px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
          .header-grid span, .unit-meta span { color: #334155; font-size: 13px; }
          .summary-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin: 14px 0 18px; }
          .summary-card { background: #f8fafc; border: 1px solid #dbe3ee; border-radius: 8px; padding: 12px; page-break-inside: avoid; }
          .summary-card strong { color: #475569; display: block; font-size: 11px; margin-bottom: 6px; text-transform: uppercase; }
          .summary-card span { color: #0f172a; font-size: 18px; font-weight: 800; }
          .unit-section { margin-top: 20px; }
          table { border-collapse: collapse; margin-top: 8px; page-break-inside: auto; table-layout: fixed; width: 100%; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          th, td { border: 1px solid #cbd5e1; font-size: 10px; line-height: 1.3; overflow-wrap: anywhere; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f1f5f9; color: #0f172a; font-size: 10px; text-transform: uppercase; }
          .empty { color: #64748b; font-style: italic; }
          .photo-grid { align-items: start; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); }
          .photo-card { border: 1px solid #cbd5e1; border-radius: 8px; margin: 0; overflow: hidden; page-break-inside: avoid; }
          .photo-card img { display: block; height: 78px; max-height: 78px; object-fit: cover; width: 100%; }
          .photo-card figcaption { color: #334155; font-size: 10px; line-height: 1.3; padding: 6px; }
          .photo-extra { align-self: center; color: #475569; font-size: 12px; font-weight: 700; margin: 0; }
          @media print {
            @page { margin: 14mm; size: A4; }
            body { background: #ffffff; padding: 0; }
            .report-shell { border: 0; border-radius: 0; max-width: none; padding: 0; }
            .actions { display: none; }
            .summary-card, .photo-card { break-inside: avoid; page-break-inside: avoid; }
            h2 { break-after: avoid; page-break-after: avoid; }
            th, td { font-size: 9px; }
          }
        </style>
      </head>
      <body>
        <main class="report-shell">
          <div class="actions">
            <button onclick="window.print()">Imprimir / Salvar PDF</button>
            <button class="secondary" onclick="window.close()">Voltar</button>
            <button class="secondary" onclick="downloadCsv()">Exportar CSV do relatório</button>
          </div>
          <header class="report-header">
            <h1>${escapeHtml(getReportTitle(kind))}</h1>
            <div class="header-grid">
              <span><strong>Obra:</strong> ${escapeHtml(project.name)}</span>
              <span><strong>Data:</strong> ${escapeHtml(filters.date || getToday())}</span>
              <span><strong>Gerado em:</strong> ${escapeHtml(generatedAtText)}</span>
              <span><strong>Responsável:</strong> ${escapeHtml(localResponsible)}</span>
              <span><strong>Tipo:</strong> ${escapeHtml(getReportTitle(kind))}</span>
            </div>
          </header>
          ${htmlSections.join('')}
        </main>
        <script>
          const csvContent = ${JSON.stringify(csvText)};
          function downloadCsv() {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'relatorio-do-dia-residencial-cagliari.csv';
            link.click();
            URL.revokeObjectURL(url);
          }
        </script>
      </body>
    </html>
  `;

  return {
    csvHeader: [...reportCsvHeader],
    csvRows,
    html,
    isValid,
    text: textLines.join('\n').trim(),
    validationMessage,
  };
};

export const canGenerateReportText = () =>
  createGeneratedReport('daily', {
    apartment: '',
    contractor: '',
    date: getToday(),
    periodEnd: '',
    periodStart: '',
    service: '',
    tower: 'Todos',
  }, {
    includeBlocked: true,
    includeChecklist: true,
    includeHistory: true,
    includeIssues: true,
    includeMeasurements: true,
    includePhotos: false,
    includeSchedule: true,
    includeSummary: true,
  }).text.length > 0;
