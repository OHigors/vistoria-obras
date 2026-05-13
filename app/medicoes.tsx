import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Measurement, MeasurementStatus, MeasurementType } from '@/src/data/localMeasurements';
import {
  formatCurrency,
  getAllowedMeasurementTransitions,
  getMeasurementStorageKey,
  getMeasurementTypeLabel,
  isMeasurementPeriodValid,
  loadAllMeasurements,
  measurementStatusOptions,
  measurementTypeOptions,
  parseBrDateForMeasurement,
  saveMeasurementsToStorage,
  toNumber,
} from '@/src/data/localMeasurements';
import {
  getApartmentById,
  getConfiguredApartments,
  getConfiguredTowers,
  getTowerById,
  project,
} from '@/src/data/mockObras';

type EnrichedMeasurement = Measurement & {
  apartmentNumber: string;
  towerId: string;
  towerLabel: string;
};

type EditDraft = {
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

const allFilter = 'Todos';

const getEnrichedMeasurements = (): EnrichedMeasurement[] =>
  loadAllMeasurements(getConfiguredApartments().map((apartment) => apartment.id)).map((measurement) => {
    const apartment = getApartmentById(measurement.apartmentId);
    const tower = apartment ? getTowerById(apartment.towerId) : undefined;

    return {
      ...measurement,
      apartmentNumber: apartment?.number ?? measurement.apartmentId.replace('ap-', ''),
      towerId: tower?.id ?? '',
      towerLabel: tower ? `${tower.name} / ${tower.block} / ${tower.position}` : 'Torre não encontrada',
    };
  });

const csvSeparator = ';';
const csvBom = '\uFEFF';

const escapeCsvValue = (value: string | number) => {
  const text = String(value);

  if (text.includes('"') || text.includes(csvSeparator) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
};

const downloadCsv = (measurements: EnrichedMeasurement[]) => {
  if (typeof document === 'undefined') {
    return;
  }

  const header = [
    'Obra',
    'Torre',
    'Apartamento',
    'Serviço',
    'Empreiteiro',
    'Quantidade',
    'Unidade',
    'Valor unitário',
    'Valor total',
    'Período início',
    'Período fim',
    'Status',
    'Responsável',
    'Data de lançamento',
    'Data de aprovação',
    'Comentário',
  ];
  const rows = measurements.map((measurement) => [
    project.name,
    measurement.towerLabel,
    `Apartamento ${measurement.apartmentNumber}`,
    measurement.service,
    measurement.contractor,
    measurement.quantity,
    measurement.unit,
    measurement.unitPrice,
    measurement.totalValue,
    measurement.periodStart,
    measurement.periodEnd,
    measurement.status,
    measurement.responsible ?? 'Usuário local',
    measurement.launchedAt ?? '',
    measurement.approvedAt ?? '',
    measurement.comment,
  ]);
  const csv = csvBom + [header, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(csvSeparator))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'medicoes-residencial-cagliari.csv';
  link.click();
  URL.revokeObjectURL(url);
};

const createEditDraft = (measurement: Measurement): EditDraft => ({
  contractor: measurement.contractor,
  quantity: String(measurement.quantity),
  unit: measurement.unit,
  unitPrice: String(measurement.unitPrice),
  periodStart: measurement.periodStart,
  periodEnd: measurement.periodEnd,
  status: measurement.status,
  comment: measurement.comment,
  measurementType: measurement.measurementType,
  evidenceUri: measurement.evidenceUri ?? '',
  evidenceFileName: measurement.evidenceFileName ?? '',
});

const persistMeasurementsForApartment = (
  apartmentId: string,
  allMeasurements: EnrichedMeasurement[],
) => {
  const measurementsForApartment = allMeasurements
    .filter((measurement) => measurement.apartmentId === apartmentId)
    .map(
      ({
        apartmentNumber: _apartmentNumber,
        towerId: _towerId,
        towerLabel: _towerLabel,
        ...measurement
      }) => measurement,
    );

  saveMeasurementsToStorage(
    getMeasurementStorageKey(apartmentId),
    measurementsForApartment,
  );
};

export default function MeasurementsScreen() {
  const towers = getConfiguredTowers();
  const [measurements, setMeasurements] = useState<EnrichedMeasurement[]>([]);
  const [towerFilter, setTowerFilter] = useState(allFilter);
  const [apartmentFilter, setApartmentFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [contractorFilter, setContractorFilter] = useState('');
  const [periodStartFilter, setPeriodStartFilter] = useState('');
  const [periodEndFilter, setPeriodEndFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<MeasurementStatus | typeof allFilter>(allFilter);
  const [editingMeasurementId, setEditingMeasurementId] = useState<string>();
  const [editDraft, setEditDraft] = useState<EditDraft>();
  const [selectedEvidence, setSelectedEvidence] = useState<EnrichedMeasurement>();

  useFocusEffect(
    useCallback(() => {
      setMeasurements(getEnrichedMeasurements());
    }, []),
  );

  const filteredMeasurements = useMemo(
    () =>
      measurements.filter((measurement) => {
        const matchesTower = towerFilter === allFilter || measurement.towerId === towerFilter;
        const matchesApartment =
          !apartmentFilter.trim() || measurement.apartmentNumber.includes(apartmentFilter.trim());
        const matchesContractor =
          !contractorFilter.trim() ||
          measurement.contractor
            .toLocaleLowerCase('pt-BR')
            .includes(contractorFilter.trim().toLocaleLowerCase('pt-BR'));
        const matchesService =
          !serviceFilter.trim() ||
          measurement.service
            .toLocaleLowerCase('pt-BR')
            .includes(serviceFilter.trim().toLocaleLowerCase('pt-BR'));
        const matchesStatus = statusFilter === allFilter || measurement.status === statusFilter;
        const measurementStart = parseBrDateForMeasurement(measurement.periodStart);
        const measurementEnd = parseBrDateForMeasurement(measurement.periodEnd);
        const filterStart = periodStartFilter.trim()
          ? parseBrDateForMeasurement(periodStartFilter.trim())
          : undefined;
        const filterEnd = periodEndFilter.trim()
          ? parseBrDateForMeasurement(periodEndFilter.trim())
          : undefined;
        const matchesPeriodStart =
          !filterStart || !measurementStart || measurementStart.getTime() >= filterStart.getTime();
        const matchesPeriodEnd =
          !filterEnd || !measurementEnd || measurementEnd.getTime() <= filterEnd.getTime();

        return (
          matchesTower &&
          matchesApartment &&
          matchesContractor &&
          matchesService &&
          matchesStatus &&
          matchesPeriodStart &&
          matchesPeriodEnd
        );
      }),
    [apartmentFilter, contractorFilter, measurements, periodEndFilter, periodStartFilter, serviceFilter, statusFilter, towerFilter],
  );

  const filteredTotal = filteredMeasurements.reduce(
    (total, measurement) => total + measurement.totalValue,
    0,
  );
  const approvedTotal = filteredMeasurements
    .filter((measurement) => measurement.status === 'Aprovado para pagamento')
    .reduce((total, measurement) => total + measurement.totalValue, 0);
  const retainedOrRejectedTotal = filteredMeasurements
    .filter(
      (measurement) =>
        measurement.status === 'Retido' || measurement.status === 'Reprovado',
    )
    .reduce((total, measurement) => total + measurement.totalValue, 0);
  const totalByStatus = (status: MeasurementStatus) =>
    filteredMeasurements
      .filter((measurement) => measurement.status === status)
      .reduce((total, measurement) => total + measurement.totalValue, 0);

  const startEditingMeasurement = (measurement: EnrichedMeasurement) => {
    setEditingMeasurementId(measurement.id);
    setEditDraft(createEditDraft(measurement));
  };

  const cancelEditingMeasurement = () => {
    setEditingMeasurementId(undefined);
    setEditDraft(undefined);
  };

  const updateEditDraft = (field: keyof EditDraft, value: EditDraft[keyof EditDraft]) => {
    setEditDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            [field]: value,
          }
        : currentDraft,
    );
  };

  const saveEditedMeasurement = (measurement: EnrichedMeasurement) => {
    if (!editDraft) {
      return;
    }

    const quantity = toNumber(editDraft.quantity);
    const unitPrice = toNumber(editDraft.unitPrice);

    if (quantity <= 0 || unitPrice < 0) {
      return;
    }

    if (!isMeasurementPeriodValid(editDraft.periodStart, editDraft.periodEnd)) {
      return;
    }

    const updatedMeasurements = measurements.map((currentMeasurement) =>
      currentMeasurement.id === measurement.id
        ? {
            ...currentMeasurement,
            contractor: editDraft.contractor.trim() || currentMeasurement.contractor,
            quantity,
            unit: editDraft.unit.trim() || currentMeasurement.unit,
            unitPrice,
            totalValue: quantity * unitPrice,
            periodStart: editDraft.periodStart,
            periodEnd: editDraft.periodEnd,
            status: editDraft.status,
            comment: editDraft.comment.trim(),
            measurementType: editDraft.measurementType,
            evidenceUri: editDraft.evidenceUri || currentMeasurement.evidenceUri,
            evidenceFileName: editDraft.evidenceFileName || currentMeasurement.evidenceFileName,
            approvedAt:
              editDraft.status === 'Aprovado para pagamento' && currentMeasurement.status !== 'Aprovado para pagamento'
                ? new Date().toISOString()
                : currentMeasurement.approvedAt,
          }
        : currentMeasurement,
    );

    setMeasurements(updatedMeasurements);
    persistMeasurementsForApartment(measurement.apartmentId, updatedMeasurements);
    cancelEditingMeasurement();
  };

  const updateMeasurementStatus = (measurement: EnrichedMeasurement, status: MeasurementStatus) => {
    const updatedMeasurements = measurements.map((currentMeasurement) =>
      currentMeasurement.id === measurement.id
        ? {
            ...currentMeasurement,
            status,
            approvedAt:
              status === 'Aprovado para pagamento' && currentMeasurement.status !== 'Aprovado para pagamento'
                ? new Date().toISOString()
                : currentMeasurement.approvedAt,
          }
        : currentMeasurement,
    );

    setMeasurements(updatedMeasurements);
    persistMeasurementsForApartment(measurement.apartmentId, updatedMeasurements);
  };

  const deleteMeasurement = (measurement: EnrichedMeasurement) => {
    const updatedMeasurements = measurements.filter(
      (currentMeasurement) => currentMeasurement.id !== measurement.id,
    );

    setMeasurements(updatedMeasurements);
    persistMeasurementsForApartment(measurement.apartmentId, updatedMeasurements);
    cancelEditingMeasurement();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Medições</Text>
          <Text style={styles.subtitle}>Lista local das medições registradas no navegador.</Text>
        </View>
        <Pressable
          onPress={() => downloadCsv(filteredMeasurements)}
          style={styles.exportButton}
          testID="export-measurements-csv">
          <Text style={styles.exportButtonText}>Exportar CSV</Text>
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{filteredMeasurements.length}</Text>
          <Text style={styles.summaryLabel}>medições filtradas</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{formatCurrency(filteredTotal)}</Text>
          <Text style={styles.summaryLabel}>valor filtrado</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{formatCurrency(approvedTotal)}</Text>
          <Text style={styles.summaryLabel}>aprovado para pagamento</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{formatCurrency(retainedOrRejectedTotal)}</Text>
          <Text style={styles.summaryLabel}>retido/reprovado</Text>
        </View>
        {measurementStatusOptions.map((status) => (
          <View key={`total-${status}`} style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{formatCurrency(totalByStatus(status))}</Text>
            <Text style={styles.summaryLabel}>{status.toLocaleLowerCase('pt-BR')}</Text>
          </View>
        ))}
      </View>

      <View style={styles.filtersPanel}>
        <Text style={styles.sectionTitle}>Filtros</Text>

        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>Torre</Text>
          <View style={styles.optionRow}>
            <Pressable
              onPress={() => setTowerFilter(allFilter)}
              style={[styles.filterChip, towerFilter === allFilter && styles.filterChipSelected]}>
              <Text
                style={[
                  styles.filterChipText,
                  towerFilter === allFilter && styles.filterChipTextSelected,
                ]}>
                Todas
              </Text>
            </Pressable>
            {towers.map((tower) => (
              <Pressable
                key={tower.id}
                onPress={() => setTowerFilter(tower.id)}
                style={[styles.filterChip, towerFilter === tower.id && styles.filterChipSelected]}>
                <Text
                  style={[
                    styles.filterChipText,
                    towerFilter === tower.id && styles.filterChipTextSelected,
                  ]}>
                  {tower.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.inputGrid}>
          <View style={styles.fieldGroup}>
            <Text style={styles.filterLabel}>Apartamento</Text>
            <TextInput
              onChangeText={setApartmentFilter}
              placeholder="Ex.: 11"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              testID="filter-apartment"
              value={apartmentFilter}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.filterLabel}>Empreiteiro</Text>
            <TextInput
              onChangeText={setContractorFilter}
              placeholder="Nome do empreiteiro"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              testID="filter-contractor"
              value={contractorFilter}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.filterLabel}>Serviço</Text>
            <TextInput
              onChangeText={setServiceFilter}
              placeholder="Nome do serviço"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              testID="filter-service"
              value={serviceFilter}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.filterLabel}>Período início</Text>
            <TextInput
              onChangeText={setPeriodStartFilter}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              testID="filter-period-start"
              value={periodStartFilter}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.filterLabel}>Período fim</Text>
            <TextInput
              onChangeText={setPeriodEndFilter}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              testID="filter-period-end"
              value={periodEndFilter}
            />
          </View>
        </View>

        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>Status</Text>
          <View style={styles.optionRow}>
            <Pressable
              onPress={() => setStatusFilter(allFilter)}
              style={[styles.filterChip, statusFilter === allFilter && styles.filterChipSelected]}>
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === allFilter && styles.filterChipTextSelected,
                ]}>
                Todos
              </Text>
            </Pressable>
            {measurementStatusOptions.map((status) => (
              <Pressable
                key={status}
                onPress={() => setStatusFilter(status)}
                style={[styles.filterChip, statusFilter === status && styles.filterChipSelected]}>
                <Text
                  style={[
                    styles.filterChipText,
                    statusFilter === status && styles.filterChipTextSelected,
                  ]}>
                  {status}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {filteredMeasurements.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyText}>Nenhuma medição encontrada para os filtros atuais.</Text>
        </View>
      ) : (
        filteredMeasurements.map((measurement) => {
          const isEditing = editingMeasurementId === measurement.id && editDraft;
          const draftTotal = editDraft
            ? toNumber(editDraft.quantity) * toNumber(editDraft.unitPrice)
            : measurement.totalValue;

          return (
            <View key={measurement.id} style={styles.measurementCard}>
              <View style={styles.measurementHeader}>
                <View style={styles.measurementTitleGroup}>
                  <Text style={styles.measurementTitle}>{measurement.service}</Text>
                  <Text style={styles.measurementMeta}>
                    Apartamento {measurement.apartmentNumber} • {measurement.towerLabel}
                  </Text>
                </View>
                <Text style={styles.measurementTotal}>
                  {formatCurrency(isEditing ? draftTotal : measurement.totalValue)}
                </Text>
              </View>

              {isEditing ? (
                <View style={styles.editPanel}>
                  <View style={styles.inputGrid}>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.filterLabel}>Empreiteiro</Text>
                      <TextInput
                        onChangeText={(value) => updateEditDraft('contractor', value)}
                        placeholder="Nome do empreiteiro"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                        testID={`edit-contractor-${measurement.id}`}
                        value={editDraft.contractor}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.filterLabel}>Quantidade</Text>
                      <TextInput
                        keyboardType="decimal-pad"
                        onChangeText={(value) => updateEditDraft('quantity', value)}
                        placeholder="0"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                        testID={`edit-quantity-${measurement.id}`}
                        value={editDraft.quantity}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.filterLabel}>Unidade</Text>
                      <TextInput
                        onChangeText={(value) => updateEditDraft('unit', value)}
                        placeholder="m², un, m"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                        testID={`edit-unit-${measurement.id}`}
                        value={editDraft.unit}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.filterLabel}>Valor unitário</Text>
                      <TextInput
                        keyboardType="decimal-pad"
                        onChangeText={(value) => updateEditDraft('unitPrice', value)}
                        placeholder="0,00"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                        testID={`edit-unit-price-${measurement.id}`}
                        value={editDraft.unitPrice}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.filterLabel}>Período início</Text>
                      <TextInput
                        onChangeText={(value) => updateEditDraft('periodStart', value)}
                        placeholder="DD/MM/AAAA"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                        testID={`edit-period-start-${measurement.id}`}
                        value={editDraft.periodStart}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.filterLabel}>Período fim</Text>
                      <TextInput
                        onChangeText={(value) => updateEditDraft('periodEnd', value)}
                        placeholder="DD/MM/AAAA"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                        testID={`edit-period-end-${measurement.id}`}
                        value={editDraft.periodEnd}
                      />
                    </View>
                  </View>

                  <View style={styles.filterBlock}>
                    <Text style={styles.filterLabel}>Tipo de medição</Text>
                    <View style={styles.optionRow}>
                      {measurementTypeOptions.map((measurementType) => (
                        <Pressable
                          key={measurementType}
                          onPress={() => updateEditDraft('measurementType', measurementType)}
                          style={[
                            styles.filterChip,
                            editDraft.measurementType === measurementType &&
                              styles.filterChipSelected,
                          ]}>
                          <Text
                            style={[
                              styles.filterChipText,
                              editDraft.measurementType === measurementType &&
                                styles.filterChipTextSelected,
                            ]}>
                            {getMeasurementTypeLabel(measurementType)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.filterBlock}>
                    <Text style={styles.filterLabel}>Status</Text>
                    <View style={styles.optionRow}>
                      {measurementStatusOptions.map((status) => (
                        <Pressable
                          key={status}
                          onPress={() => updateEditDraft('status', status)}
                          style={[
                            styles.filterChip,
                            editDraft.status === status && styles.filterChipSelected,
                          ]}>
                          <Text
                            style={[
                              styles.filterChipText,
                              editDraft.status === status && styles.filterChipTextSelected,
                            ]}>
                            {status}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.filterLabel}>Comentário</Text>
                    <TextInput
                      multiline
                      onChangeText={(value) => updateEditDraft('comment', value)}
                      placeholder="Comentário"
                      placeholderTextColor="#94A3B8"
                      style={styles.commentInput}
                      testID={`edit-comment-${measurement.id}`}
                      value={editDraft.comment}
                    />
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => saveEditedMeasurement(measurement)}
                      style={styles.saveButton}
                      testID={`save-measurement-${measurement.id}`}>
                      <Text style={styles.saveButtonText}>Salvar edição</Text>
                    </Pressable>
                    <Pressable onPress={cancelEditingMeasurement} style={styles.neutralButton}>
                      <Text style={styles.neutralButtonText}>Cancelar</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.detailGrid}>
                    <Text style={styles.detailText}>Empreiteiro: {measurement.contractor}</Text>
                    <Text style={styles.detailText}>Obra: {project.name}</Text>
                    <Text style={styles.detailText}>Torre: {measurement.towerLabel}</Text>
                    <Text style={styles.detailText}>Apartamento: {measurement.apartmentNumber}</Text>
                    <Text style={styles.detailText}>Serviço: {measurement.service}</Text>
                    <Text style={styles.detailText}>
                      Quantidade: {measurement.quantity} {measurement.unit}
                    </Text>
                    <Text style={styles.detailText}>
                      Valor unitário: {formatCurrency(measurement.unitPrice)}
                    </Text>
                    <Text style={styles.detailText}>
                      Tipo: {getMeasurementTypeLabel(measurement.measurementType)}
                    </Text>
                    <Text style={styles.detailText}>Status: {measurement.status}</Text>
                    <Text style={styles.detailText}>
                      Período: {measurement.periodStart} até {measurement.periodEnd}
                    </Text>
                    <Text style={styles.detailText}>
                      Responsável: {measurement.responsible ?? 'Usuário local'}
                    </Text>
                    <Text style={styles.detailText}>
                      Lançamento: {measurement.launchedAt ? new Date(measurement.launchedAt).toLocaleString('pt-BR') : 'sem data'}
                    </Text>
                    <Text style={styles.detailText}>
                      Aprovação: {measurement.approvedAt ? new Date(measurement.approvedAt).toLocaleString('pt-BR') : 'não aprovada'}
                    </Text>
                  </View>

                  {measurement.comment ? (
                    <Text style={styles.commentText}>{measurement.comment}</Text>
                  ) : null}

                  {measurement.evidenceUri ? (
                    <Pressable onPress={() => setSelectedEvidence(measurement)} style={styles.evidenceRow}>
                      <Image source={{ uri: measurement.evidenceUri }} style={styles.evidenceThumb} />
                      <Text style={styles.detailText}>Ver evidência: {measurement.evidenceFileName ?? 'foto local'}</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.detailText}>Evidência: não anexada</Text>
                  )}

                  <View style={styles.actionRow}>
                    {getAllowedMeasurementTransitions(measurement.status).map((nextStatus) => (
                      <Pressable
                        key={`${measurement.id}-${nextStatus}`}
                        onPress={() => updateMeasurementStatus(measurement, nextStatus)}
                        style={styles.saveButton}>
                        <Text style={styles.saveButtonText}>
                          {nextStatus === 'Conferido'
                            ? 'Marcar como conferido'
                            : nextStatus === 'Aprovado para pagamento'
                              ? 'Aprovar para pagamento'
                              : nextStatus === 'Pago externamente'
                                ? 'Marcar como pago externamente'
                                : nextStatus === 'Reprovado'
                                  ? 'Reprovar'
                                  : 'Reter'}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => downloadCsv([measurement])} style={styles.neutralButton}>
                      <Text style={styles.neutralButtonText}>Exportar medição</Text>
                    </Pressable>
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => startEditingMeasurement(measurement)}
                      style={styles.neutralButton}
                      testID={`edit-measurement-${measurement.id}`}>
                      <Text style={styles.neutralButtonText}>Editar medição</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => deleteMeasurement(measurement)}
                      style={styles.deleteButton}
                      testID={`delete-measurement-${measurement.id}`}>
                      <Text style={styles.deleteButtonText}>Excluir medição</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          );
        })
      )}
      <Modal
        animationType="fade"
        onRequestClose={() => setSelectedEvidence(undefined)}
        transparent
        visible={Boolean(selectedEvidence)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {selectedEvidence?.evidenceUri ? (
              <>
                <Image source={{ uri: selectedEvidence.evidenceUri }} style={styles.evidenceImage} />
                <Text style={styles.measurementTitle}>{selectedEvidence.service}</Text>
                <Text style={styles.detailText}>{selectedEvidence.evidenceFileName ?? 'Evidência local'}</Text>
              </>
            ) : null}
            <Pressable onPress={() => setSelectedEvidence(undefined)} style={styles.neutralButton}>
              <Text style={styles.neutralButtonText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
  },
  header: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 18,
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  exportButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 190,
    padding: 14,
  },
  summaryValue: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  filtersPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  filterBlock: {
    gap: 8,
  },
  filterLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    borderColor: '#CBD5E1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  filterChipSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  filterChipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
  },
  filterChipTextSelected: {
    color: '#2563EB',
  },
  inputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  fieldGroup: {
    flexGrow: 1,
    gap: 6,
    minWidth: 180,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  emptyPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
  },
  measurementCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  measurementHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  measurementTitleGroup: {
    flex: 1,
    gap: 4,
  },
  measurementTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  measurementMeta: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  measurementTotal: {
    color: '#047857',
    fontSize: 15,
    fontWeight: '900',
  },
  detailGrid: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 10,
  },
  detailText: {
    color: '#475569',
    fontSize: 13,
    minWidth: 180,
  },
  commentText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  editPanel: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    gap: 12,
    paddingTop: 12,
  },
  commentInput: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 14,
    minHeight: 72,
    padding: 10,
    textAlignVertical: 'top',
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  neutralButton: {
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  neutralButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  saveButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  deleteButton: {
    borderColor: '#FCA5A5',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  deleteButtonText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '900',
  },
  evidenceRow: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: 10,
  },
  evidenceThumb: {
    borderRadius: 8,
    height: 72,
    width: 72,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    gap: 12,
    maxWidth: 680,
    padding: 14,
    width: '100%',
  },
  evidenceImage: {
    borderRadius: 8,
    height: 420,
    maxHeight: 420,
    resizeMode: 'contain',
    width: '100%',
  },
});
