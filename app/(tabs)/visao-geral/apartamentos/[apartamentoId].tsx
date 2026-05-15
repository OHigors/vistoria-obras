import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ApartmentStatus, ChecklistItem, ChecklistState } from '@/src/data/mockObras';
import type { InspectionPhoto } from '@/src/data/localInspectionPhotos';
import {
  getInspectionPhotosFromStorage,
  getInspectionPhotoStorageKey,
  saveInspectionPhotosToStorage,
} from '@/src/data/localInspectionPhotos';
import type { InspectionVisit, VisitChecklistCounts } from '@/src/data/localInspectionVisits';
import {
  getInspectionVisitsFromStorage,
  getInspectionVisitStorageKey,
  localResponsible,
  saveInspectionVisitsToStorage,
} from '@/src/data/localInspectionVisits';
import type { Measurement, MeasurementDraft } from '@/src/data/localMeasurements';
import {
  createEmptyMeasurementDraft,
  formatCurrency,
  getContractorId,
  getMeasurementDuplicateKey,
  getMeasurementTypeLabel,
  getMeasurementStorageKey,
  getMeasurementsFromStorage,
  isMeasurementPeriodValid,
  measurementBlocksDuplicate,
  measurementDuplicateMessage,
  normalizeMeasurementPeriod,
  measurementStatusOptions,
  measurementTypeOptions,
  saveMeasurementsToStorage,
  toNumber,
} from '@/src/data/localMeasurements';
import { getApartmentById, getTowerById, project } from '@/src/data/mockObras';
import type { ScheduleFields } from '@/src/data/schedule';
import { formatDateBr, getScheduleRows, isValidBrDate, maskDateBr, normalizeDateForDisplay } from '@/src/data/schedule';
import { getBlockedServiceGroups } from '@/src/data/serviceBlockers';
import { isServiceActiveForFeature } from '@/src/data/serviceStages';
import { checklistConfig, statusConfig } from '@/src/ui/status';

const checklistOptions: ChecklistState[] = ['ok', 'pending', 'partial', 'notApplicable'];
const criticalityOptions = ['Baixa', 'Média', 'Alta', 'Crítica'] as const;
const detailTabs = [
  'Resumo',
  'Checklist',
  'Pendências',
  'Fotos',
  'Serviços',
  'Cronograma',
  'Medições',
  'Histórico',
] as const;

type DetailTab = (typeof detailTabs)[number];
type IssueCriticality = (typeof criticalityOptions)[number];

const scheduleStatusStyles = {
  'No prazo': { background: '#DBEAFE', color: '#2563EB' },
  Atenção: { background: '#FEF3C7', color: '#B45309' },
  Atrasado: { background: '#FEE2E2', color: '#B91C1C' },
  Concluído: { background: '#D1FAE5', color: '#047857' },
};
type EditableChecklistItem = ChecklistItem & {
  comment: string;
  issueCriticality?: IssueCriticality;
  issueComment?: string;
} & ScheduleFields;

const isChecklistState = (state: unknown): state is ChecklistState =>
  checklistOptions.includes(state as ChecklistState);

const isIssueCriticality = (criticality: unknown): criticality is IssueCriticality =>
  criticalityOptions.includes(criticality as IssueCriticality);

const getInitialChecklist = (items?: ChecklistItem[]): EditableChecklistItem[] =>
  (items ?? []).filter((item) => isServiceActiveForFeature(item.label, 'checklist')).map((item) => ({
    ...item,
    comment: item.comment ?? '',
    issueCriticality: item.state === 'pending' || item.state === 'partial' ? 'Média' : undefined,
    issueComment: '',
  }));

const getStorageKey = (apartmentId?: string) => (apartmentId ? `vistoria-${apartmentId}` : undefined);

const formatPhotoDateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

const getChecklistCounts = (items: EditableChecklistItem[]): VisitChecklistCounts =>
  items.reduce<VisitChecklistCounts>(
    (counts, item) => ({
      ...counts,
      [item.state]: counts[item.state] + 1,
    }),
    {
      notApplicable: 0,
      ok: 0,
      partial: 0,
      pending: 0,
    },
  );

const sortVisitsDesc = (visits: InspectionVisit[]) =>
  [...visits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

const getVariationColor = (variation: number) => {
  if (variation > 0) {
    return '#047857';
  }

  if (variation < 0) {
    return '#B45309';
  }

  return '#64748B';
};

const getVariationLabel = (variation: number) => {
  if (variation > 0) {
    return `Evolução: +${variation} p.p.`;
  }

  if (variation < 0) {
    return `Regressão: ${variation} p.p.`;
  }

  return 'Sem variação: 0 p.p.';
};

const getLastVisitVariationText = (variation: number) => {
  if (variation > 0) {
    return `Evolução da última visita: +${variation} p.p. desde a visita anterior`;
  }

  if (variation < 0) {
    return `Regressão da última visita: ${variation} p.p. desde a visita anterior`;
  }

  return 'Sem variação desde a visita anterior';
};

const getChecklistFromStorage = (
  storageKey: string | undefined,
  fallbackItems: EditableChecklistItem[],
) => {
  if (!storageKey || typeof window === 'undefined') {
    return fallbackItems;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      return fallbackItems;
    }

    const storedItems = JSON.parse(storedValue) as Partial<EditableChecklistItem>[];
    const storedItemsById = new Map(storedItems.map((item) => [item.id, item]));

    return fallbackItems.map((item) => {
      const storedItem = storedItemsById.get(item.id);

      if (!storedItem) {
        return item;
      }

      return {
        ...item,
        state: isChecklistState(storedItem.state) ? storedItem.state : item.state,
        comment: typeof storedItem.comment === 'string' ? storedItem.comment : item.comment,
        issueCriticality: isIssueCriticality(storedItem.issueCriticality)
          ? storedItem.issueCriticality
          : item.issueCriticality,
        issueComment:
          typeof storedItem.issueComment === 'string'
            ? storedItem.issueComment
            : item.issueComment,
        plannedStart:
          typeof storedItem.plannedStart === 'string'
            ? normalizeDateForDisplay(storedItem.plannedStart)
            : undefined,
        plannedEnd:
          typeof storedItem.plannedEnd === 'string'
            ? normalizeDateForDisplay(storedItem.plannedEnd)
            : undefined,
        actualStart:
          typeof storedItem.actualStart === 'string'
            ? normalizeDateForDisplay(storedItem.actualStart)
            : undefined,
        actualEnd:
          typeof storedItem.actualEnd === 'string'
            ? normalizeDateForDisplay(storedItem.actualEnd)
            : undefined,
      };
    });
  } catch {
    return fallbackItems;
  }
};

const saveChecklistToStorage = (
  storageKey: string | undefined,
  checklist: EditableChecklistItem[],
) => {
  if (!storageKey || typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(checklist));
};

const calculateProgress = (items: EditableChecklistItem[]) => {
  if (items.length === 0) {
    return 0;
  }

  const score = items.reduce((total, item) => {
    if (item.state === 'ok' || item.state === 'notApplicable') {
      return total + 1;
    }

    if (item.state === 'partial') {
      return total + 0.5;
    }

    return total;
  }, 0);

  return Math.round((score / items.length) * 100);
};

const calculateApartmentStatus = (items: EditableChecklistItem[], progress: number): ApartmentStatus => {
  const pendingCount = items.filter((item) => item.state === 'pending').length;
  const partialCount = items.filter((item) => item.state === 'partial').length;
  const manyPending = pendingCount >= Math.max(3, Math.ceil(items.length * 0.35));

  if (progress < 50 || manyPending) {
    return 'critical';
  }

  if ((progress >= 50 && progress <= 74) || partialCount > 0) {
    return 'attention';
  }

  if (progress >= 90 && pendingCount === 0) {
    return 'excellent';
  }

  if (progress >= 75 && progress <= 89) {
    return 'good';
  }

  return 'attention';
};

export default function ApartmentDetailScreen() {
  const { apartamentoId } = useLocalSearchParams<{ apartamentoId: string }>();
  const apartment = getApartmentById(apartamentoId);
  const tower = apartment ? getTowerById(apartment.towerId) : undefined;
  const storageKey = getStorageKey(apartment?.id);
  const measurementStorageKey = getMeasurementStorageKey(apartment?.id);
  const photoStorageKey = getInspectionPhotoStorageKey(apartment?.id);
  const visitStorageKey = getInspectionVisitStorageKey(apartment?.id);

  const initialChecklist = useMemo(
    () => getInitialChecklist(apartment?.checklist),
    [apartment?.checklist],
  );
  const [checklist, setChecklist] = useState<EditableChecklistItem[]>(initialChecklist);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string>();
  const skipNextSaveKey = useRef<string | undefined>(undefined);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loadedMeasurementStorageKey, setLoadedMeasurementStorageKey] = useState<string>();
  const [measurementDrafts, setMeasurementDrafts] = useState<Record<string, MeasurementDraft>>({});
  const [measurementAlert, setMeasurementAlert] = useState('');
  const [scheduleAlert, setScheduleAlert] = useState('');
  const skipNextMeasurementSaveKey = useRef<string | undefined>(undefined);
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [loadedPhotoStorageKey, setLoadedPhotoStorageKey] = useState<string>();
  const [selectedPhoto, setSelectedPhoto] = useState<InspectionPhoto>();
  const [selectedMeasurementEvidence, setSelectedMeasurementEvidence] = useState<Measurement>();
  const [activeTab, setActiveTab] = useState<DetailTab>('Resumo');
  const [visits, setVisits] = useState<InspectionVisit[]>([]);
  const [loadedVisitStorageKey, setLoadedVisitStorageKey] = useState<string>();
  const [selectedVisit, setSelectedVisit] = useState<InspectionVisit>();

  useEffect(() => {
    setChecklist(getChecklistFromStorage(storageKey, initialChecklist));
    setLoadedStorageKey(storageKey);
  }, [initialChecklist, storageKey]);

  useEffect(() => {
    if (storageKey && loadedStorageKey === storageKey) {
      if (skipNextSaveKey.current === storageKey) {
        skipNextSaveKey.current = undefined;
        return;
      }

      saveChecklistToStorage(storageKey, checklist);
    }
  }, [checklist, loadedStorageKey, storageKey]);

  useEffect(() => {
    setMeasurements(getMeasurementsFromStorage(measurementStorageKey));
    setMeasurementDrafts({});
    setMeasurementAlert('');
    setLoadedMeasurementStorageKey(measurementStorageKey);
  }, [measurementStorageKey]);

  useEffect(() => {
    if (measurementStorageKey && loadedMeasurementStorageKey === measurementStorageKey) {
      if (skipNextMeasurementSaveKey.current === measurementStorageKey) {
        skipNextMeasurementSaveKey.current = undefined;
        return;
      }

      saveMeasurementsToStorage(measurementStorageKey, measurements);
    }
  }, [loadedMeasurementStorageKey, measurementStorageKey, measurements]);

  useEffect(() => {
    setPhotos(getInspectionPhotosFromStorage(photoStorageKey));
    setLoadedPhotoStorageKey(photoStorageKey);
  }, [photoStorageKey]);

  useEffect(() => {
    if (photoStorageKey && loadedPhotoStorageKey === photoStorageKey) {
      saveInspectionPhotosToStorage(photoStorageKey, photos);
    }
  }, [loadedPhotoStorageKey, photoStorageKey, photos]);

  useEffect(() => {
    setVisits(getInspectionVisitsFromStorage(visitStorageKey));
    setLoadedVisitStorageKey(visitStorageKey);
    setSelectedVisit(undefined);
  }, [visitStorageKey]);

  useEffect(() => {
    if (visitStorageKey && loadedVisitStorageKey === visitStorageKey) {
      saveInspectionVisitsToStorage(visitStorageKey, visits);
    }
  }, [loadedVisitStorageKey, visitStorageKey, visits]);

  if (!apartment || !tower) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Apartamento não encontrado</Text>
      </View>
    );
  }

  const progress = calculateProgress(checklist);
  const okCount = checklist.filter((item) => item.state === 'ok' || item.state === 'notApplicable').length;
  const currentStatusKey = calculateApartmentStatus(checklist, progress);
  const status = statusConfig[currentStatusKey];
  const measurableItems = checklist.filter(
    (item) => item.state === 'ok' && isServiceActiveForFeature(item.label, 'medicao'),
  );
  const blockedServiceGroups = getBlockedServiceGroups(checklist);
  const scheduleRows = getScheduleRows(checklist);
  const totalBlockedServices = blockedServiceGroups.reduce(
    (total, group) => total + group.blockedServices.length,
    0,
  );
  const totalMeasuredValue = measurements.reduce(
    (total, measurement) => total + measurement.totalValue,
    0,
  );
  const pendingItems = checklist.filter(
    (item) => item.state === 'pending' || item.state === 'partial',
  );
  const finalizedVisits = sortVisitsDesc(visits.filter((visit) => visit.finalized));
  const openVisit = visits.find((visit) => !visit.finalized);
  const latestVisit = openVisit ?? finalizedVisits[0];
  const firstVisit = sortVisitsDesc(visits).at(-1);
  const previousProgress =
    latestVisit?.progressBefore ?? finalizedVisits[1]?.progressAfter ?? progress;
  const currentVisitEvolution = latestVisit?.evolution ?? progress - previousProgress;
  const unitProgressVariation = progress - previousProgress;
  const photosByServiceId = photos.reduce<Record<string, InspectionPhoto[]>>((groups, photo) => {
    groups[photo.serviceId] = [...(groups[photo.serviceId] ?? []), photo];
    return groups;
  }, {});

  const registerVisitUpdate = ({
    addedPhotoId,
    changedItemId,
    nextChecklist,
    nextPhotos,
    progressBeforeFallback,
  }: {
    addedPhotoId?: string;
    changedItemId?: string;
    nextChecklist: EditableChecklistItem[];
    nextPhotos: InspectionPhoto[];
    progressBeforeFallback: number;
  }) => {
    if (!apartment) {
      return undefined;
    }

    const nextProgress = calculateProgress(nextChecklist);
    const nextStatus = calculateApartmentStatus(nextChecklist, nextProgress);
    const counts = getChecklistCounts(nextChecklist);
    const issueItemIds = nextChecklist
      .filter((item) => item.state === 'pending' || item.state === 'partial')
      .map((item) => item.id);
    const now = new Date().toISOString();

    setVisits((currentVisits) => {
      const currentOpenVisit = currentVisits.find((visit) => !visit.finalized);
      if (!currentOpenVisit) {
        return currentVisits;
      }

      const visitId = currentOpenVisit.id;
      const progressBefore = currentOpenVisit.progressBefore ?? progressBeforeFallback;
      const existingPhotoIds = currentOpenVisit?.addedPhotoIds ?? [];
      const addedPhotoIds = addedPhotoId
        ? [...new Set([...existingPhotoIds, addedPhotoId])]
        : existingPhotoIds.filter((photoId) => nextPhotos.some((photo) => photo.id === photoId));
      const changedItemIds = changedItemId
        ? [...new Set([...(currentOpenVisit?.changedItemIds ?? []), changedItemId])]
        : currentOpenVisit?.changedItemIds ?? [];
      const updatedVisit: InspectionVisit = {
        id: visitId,
        apartmentId: apartment.id,
        apartamentoId: apartment.id,
        date: currentOpenVisit.date ?? now,
        startedAt: currentOpenVisit.startedAt ?? currentOpenVisit.date ?? now,
        dataInicio: currentOpenVisit.dataInicio ?? currentOpenVisit.startedAt ?? currentOpenVisit.date ?? now,
        responsible: currentOpenVisit.responsible ?? localResponsible,
        responsavel: currentOpenVisit.responsavel ?? currentOpenVisit.responsible ?? localResponsible,
        progressBefore,
        percentualAntes: progressBefore,
        progressAfter: nextProgress,
        percentualDepois: nextProgress,
        evolution: nextProgress - progressBefore,
        evolucao: nextProgress - progressBefore,
        counts,
        photosAdded: addedPhotoIds.length,
        quantidadeFotos: addedPhotoIds.length,
        quantidadePendencias: issueItemIds.length,
        statusAfter: nextStatus,
        statusFinal: nextStatus,
        generalNote: currentOpenVisit.generalNote ?? '',
        observacaoGeral: currentOpenVisit.observacaoGeral ?? currentOpenVisit.generalNote ?? '',
        changedItemIds,
        addedPhotoIds,
        issueItemIds,
        finalized: false,
      };

      return currentVisits.map((visit) => (visit.id === visitId ? updatedVisit : visit));
    });
  };

  const updateItemStatus = (itemId: string, state: ChecklistState) => {
    setChecklist((currentItems) =>
      {
        const nextItems = currentItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              state,
              issueCriticality:
                state === 'pending' || state === 'partial'
                  ? item.issueCriticality ?? 'Média'
                  : undefined,
              issueComment:
                state === 'pending' || state === 'partial' ? item.issueComment ?? '' : '',
            }
          : item,
      );

        registerVisitUpdate({
          changedItemId: itemId,
          nextChecklist: nextItems,
          nextPhotos: photos,
          progressBeforeFallback: calculateProgress(currentItems),
        });

        return nextItems;
      },
    );
  };

  const updateItemComment = (itemId: string, comment: string) => {
    setChecklist((currentItems) =>
      {
        const nextItems = currentItems.map((item) =>
          item.id === itemId ? { ...item, comment } : item,
        );

        registerVisitUpdate({
          changedItemId: itemId,
          nextChecklist: nextItems,
          nextPhotos: photos,
          progressBeforeFallback: calculateProgress(currentItems),
        });

        return nextItems;
      },
    );
  };

  const updateItemIssue = (
    itemId: string,
    field: 'issueCriticality' | 'issueComment',
    value: string,
  ) => {
    setChecklist((currentItems) =>
      {
        const nextItems = currentItems.map((item) =>
        item.id === itemId && field === 'issueCriticality' && isIssueCriticality(value)
          ? { ...item, issueCriticality: value }
          : item.id === itemId && field === 'issueComment'
            ? { ...item, issueComment: value }
            : item,
      );

        registerVisitUpdate({
          changedItemId: itemId,
          nextChecklist: nextItems,
          nextPhotos: photos,
          progressBeforeFallback: calculateProgress(currentItems),
        });

        return nextItems;
      },
    );
  };

  const updateItemSchedule = (itemId: string, field: keyof ScheduleFields, value: string) => {
    const maskedValue = maskDateBr(value);

    if (maskedValue.length === 10 && !isValidBrDate(maskedValue)) {
      setScheduleAlert('Data inválida. Use DD/MM/AAAA.');
    } else if (maskedValue.length > 0 && maskedValue.length < 10) {
      setScheduleAlert('Use o formato DD/MM/AAAA. Exemplo: 08/05/2026');
    } else {
      setScheduleAlert('');
    }

    setChecklist((currentItems) =>
      currentItems.map((item) => (item.id === itemId ? { ...item, [field]: maskedValue } : item)),
    );
  };

  const clearApartmentData = () => {
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey);
      skipNextSaveKey.current = storageKey;
    }

    setChecklist(initialChecklist);
    setLoadedStorageKey(storageKey);
  };

  const addPhotoToItem = (item: EditableChecklistItem) => {
    if (typeof document === 'undefined' || !apartment || !tower) {
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = () => {
      const file = input.files?.[0];

      if (!file) {
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          return;
        }

        const uri = reader.result;
        const createdAt = new Date().toISOString();
        const photoId = `${apartment.id}-${item.id}-${Date.now()}`;
        const visitId = openVisit?.id;

        setPhotos((currentPhotos) => {
          const nextPhotos = [
            ...currentPhotos,
            {
            id: photoId,
            towerId: tower.id,
            apartmentId: apartment.id,
            itemId: item.id,
            serviceId: item.id,
            service: item.label,
            uri,
            fileName: file.name,
            createdAt,
            dataHora: createdAt,
            comment: '',
            comentarioFoto: '',
            visitId,
          },
          ];

          registerVisitUpdate({
            addedPhotoId: photoId,
            changedItemId: item.id,
            nextChecklist: checklist,
            nextPhotos,
            progressBeforeFallback: progress,
          });

          return nextPhotos;
        });
      };

      reader.readAsDataURL(file);
    };

    input.click();
  };

  const updatePhotoComment = (photoId: string, comment: string) => {
    setPhotos((currentPhotos) =>
      {
        const targetPhoto = currentPhotos.find((photo) => photo.id === photoId);
        const nextPhotos = currentPhotos.map((photo) =>
          photo.id === photoId ? { ...photo, comment, comentarioFoto: comment } : photo,
        );

        registerVisitUpdate({
          changedItemId: targetPhoto?.serviceId,
          nextChecklist: checklist,
          nextPhotos,
          progressBeforeFallback: progress,
        });

        return nextPhotos;
      },
    );
  };

  const removePhoto = (photoId: string) => {
    setPhotos((currentPhotos) => {
      const targetPhoto = currentPhotos.find((photo) => photo.id === photoId);
      const nextPhotos = currentPhotos.filter((photo) => photo.id !== photoId);

      registerVisitUpdate({
        changedItemId: targetPhoto?.serviceId,
        nextChecklist: checklist,
        nextPhotos,
        progressBeforeFallback: progress,
      });

      return nextPhotos;
    });
    setSelectedPhoto((currentPhoto) => (currentPhoto?.id === photoId ? undefined : currentPhoto));
  };

  const updateOpenVisitNote = (generalNote: string) => {
    registerVisitUpdate({
      nextChecklist: checklist,
      nextPhotos: photos,
      progressBeforeFallback: progress,
    });

    setVisits((currentVisits) =>
      currentVisits.map((visit) =>
        !visit.finalized ? { ...visit, generalNote, observacaoGeral: generalNote } : visit,
      ),
    );
  };

  const finishVisit = () => {
    if (!apartment) {
      return;
    }

    setVisits((currentVisits) => {
      const now = new Date().toISOString();
      const currentOpenVisit = currentVisits.find((visit) => !visit.finalized);

      if (!currentOpenVisit) {
        return currentVisits;
      }

      const progressBefore = currentOpenVisit.progressBefore ?? currentOpenVisit.percentualAntes ?? progress;
      const changedItemIds = currentOpenVisit.changedItemIds ?? [];
      const addedPhotoIds = (currentOpenVisit.addedPhotoIds ?? []).filter((photoId) =>
        photos.some((photo) => photo.id === photoId),
      );
      const issueItemIds = pendingItems.map((item) => item.id);
      const counts = getChecklistCounts(checklist);
      const statusAfter = calculateApartmentStatus(checklist, progress);

      return currentVisits.map((visit) =>
        visit.id === currentOpenVisit.id
          ? {
              ...visit,
              apartmentId: apartment.id,
              apartamentoId: apartment.id,
              date: now,
              startedAt: visit.startedAt ?? visit.date ?? now,
              dataInicio: visit.dataInicio ?? visit.startedAt ?? visit.date ?? now,
              finalized: true,
              finalizedAt: now,
              responsible: visit.responsible || localResponsible,
              responsavel: visit.responsavel || visit.responsible || localResponsible,
              progressBefore,
              percentualAntes: progressBefore,
              progressAfter: progress,
              percentualDepois: progress,
              evolution: progress - progressBefore,
              evolucao: progress - progressBefore,
              counts,
              photosAdded: addedPhotoIds.length,
              quantidadeFotos: addedPhotoIds.length,
              quantidadePendencias: issueItemIds.length,
              statusAfter,
              statusFinal: statusAfter,
              generalNote: visit.generalNote ?? '',
              observacaoGeral: visit.observacaoGeral ?? visit.generalNote ?? '',
              changedItemIds,
              addedPhotoIds,
              issueItemIds,
            }
          : visit,
      );
    });
  };

  const startNewVisit = () => {
    if (!apartment) {
      return;
    }

    setVisits((currentVisits) => {
      if (currentVisits.some((visit) => !visit.finalized)) {
        return currentVisits;
      }

      const now = new Date().toISOString();
      const counts = getChecklistCounts(checklist);
      const statusAfter = calculateApartmentStatus(checklist, progress);
      const issueItemIds = pendingItems.map((item) => item.id);

      return [
        ...currentVisits,
        {
          id: `${apartment.id}-visita-${Date.now()}`,
          apartmentId: apartment.id,
          apartamentoId: apartment.id,
          date: now,
          startedAt: now,
          dataInicio: now,
          responsible: localResponsible,
          responsavel: localResponsible,
          progressBefore: progress,
          percentualAntes: progress,
          progressAfter: progress,
          percentualDepois: progress,
          evolution: 0,
          evolucao: 0,
          counts,
          photosAdded: 0,
          quantidadeFotos: 0,
          quantidadePendencias: issueItemIds.length,
          statusAfter,
          statusFinal: statusAfter,
          generalNote: '',
          observacaoGeral: '',
          changedItemIds: [],
          addedPhotoIds: [],
          issueItemIds,
          finalized: false,
        },
      ];
    });
  };

  const getMeasurementDraft = (itemId: string) =>
    measurementDrafts[itemId] ?? createEmptyMeasurementDraft();

  const updateMeasurementDraft = (
    itemId: string,
    field: keyof MeasurementDraft,
    value: MeasurementDraft[keyof MeasurementDraft],
  ) => {
    setMeasurementDrafts((currentDrafts) => ({
      ...currentDrafts,
      [itemId]: {
        ...(currentDrafts[itemId] ?? createEmptyMeasurementDraft()),
        [field]: value,
      },
    }));
  };

  const showBlockedNormalMeasurementAlert = () => {
    setMeasurementAlert(measurementDuplicateMessage);
  };

  const addMeasurementEvidence = (itemId: string) => {
    if (typeof document === 'undefined') {
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = () => {
      const file = input.files?.[0];

      if (!file) {
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          return;
        }

        updateMeasurementDraft(itemId, 'evidenceUri', reader.result);
        updateMeasurementDraft(itemId, 'evidenceFileName', file.name);
      };

      reader.readAsDataURL(file);
    };

    input.click();
  };

  const createMeasurement = (item: EditableChecklistItem) => {
    if (!apartment) {
      return;
    }

    const draft = getMeasurementDraft(item.id);
    const contractor = draft.contractor.trim();

    if (!contractor) {
      setMeasurementAlert('Empreiteiro é obrigatório.');
      return;
    }

    const contractorId = getContractorId(contractor);
    const duplicateKey = getMeasurementDuplicateKey({
      apartmentId: apartment.id,
      contractor,
      contractorId,
      obraId: project.id,
      service: item.label,
      serviceId: item.id,
      towerId: tower.id,
    });
    const hasDuplicate = measurements.some((measurement) => {
      const measurementKey = getMeasurementDuplicateKey({
        apartmentId: measurement.apartmentId,
        contractor: measurement.contractor,
        contractorId: measurement.contractorId,
        obraId: measurement.obraId,
        service: measurement.service,
        serviceId: measurement.serviceId,
        towerId: measurement.towerId,
      });

      return measurementKey === duplicateKey && measurementBlocksDuplicate(measurement.status);
    });

    if (hasDuplicate) {
      showBlockedNormalMeasurementAlert();
      return;
    }

    const quantity = toNumber(draft.quantity);
    const unitPrice = toNumber(draft.unitPrice);
    const totalValue = quantity * unitPrice;
    const periodStart = normalizeMeasurementPeriod(draft.periodStart);
    const periodEnd = normalizeMeasurementPeriod(draft.periodEnd);

    if (
      !project.id ||
      !tower.id ||
      !apartment.id ||
      !item.id ||
      !contractorId
    ) {
      setMeasurementAlert('Não foi possível criar medição: chave obrigatória incompleta.');
      return;
    }

    if (quantity <= 0) {
      setMeasurementAlert('Quantidade deve ser maior que zero.');
      return;
    }

    if (unitPrice < 0) {
      setMeasurementAlert('Valor unitário deve ser maior ou igual a zero.');
      return;
    }

    if (!isMeasurementPeriodValid(periodStart, periodEnd)) {
      setMeasurementAlert('Período inválido: período fim não pode ser menor que período início.');
      return;
    }

    setMeasurements((currentMeasurements) => [
      ...currentMeasurements,
      {
        id: `${apartment.id}-${item.id}-${Date.now()}`,
        obraId: project.id,
        towerId: tower.id,
        apartmentId: apartment.id,
        serviceId: item.id,
        contractorId,
        service: item.label,
        contractor,
        quantity,
        unit: draft.unit.trim() || 'un',
        unitPrice,
        totalValue,
        periodStart,
        periodEnd,
        status: draft.status,
        comment: draft.comment.trim(),
        measurementType: draft.measurementType,
        evidenceUri: draft.evidenceUri || undefined,
        evidenceFileName: draft.evidenceFileName || undefined,
        responsible: localResponsible,
        launchedAt: new Date().toISOString(),
        approvedAt: draft.status === 'Aprovado para pagamento' ? new Date().toISOString() : undefined,
      },
    ]);
    setMeasurementAlert('');

    setMeasurementDrafts((currentDrafts) => ({
      ...currentDrafts,
      [item.id]: createEmptyMeasurementDraft(),
    }));
  };

  const clearApartmentMeasurements = () => {
    if (measurementStorageKey && typeof window !== 'undefined') {
      window.localStorage.removeItem(measurementStorageKey);
      skipNextMeasurementSaveKey.current = measurementStorageKey;
    }

    setMeasurements([]);
    setMeasurementDrafts({});
    setMeasurementAlert('');
    setLoadedMeasurementStorageKey(measurementStorageKey);
  };

  return (
    <>
    <ScrollView contentContainerStyle={styles.container}>
      <View style={[styles.summaryCard, { borderColor: status.border }]}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.kicker}>
              {tower.name} / {tower.block} / {tower.position}
            </Text>
            <Text style={styles.title}>Apartamento {apartment.number}</Text>
            <Text style={styles.floor}>{apartment.floor}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: status.color, width: `${progress}%` },
            ]}
          />
        </View>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaValue}>{progress}%</Text>
            <Text style={styles.metaLabel}>vistoriado</Text>
          </View>
          <View>
            <Text style={styles.metaValue}>
              {okCount}/{checklist.length}
            </Text>
            <Text style={styles.metaLabel}>itens concluídos</Text>
          </View>
          <View>
            <Text style={styles.metaValue}>{apartment.lastInspection}</Text>
            <Text style={styles.metaLabel}>última vistoria</Text>
          </View>
        </View>

        <Text style={styles.notes}>{apartment.notes}</Text>
      </View>

      <View style={styles.visitStrip}>
        <Text style={styles.detailText}>
          Última visita: {latestVisit ? formatPhotoDateTime(latestVisit.date) : 'sem visita registrada'}
        </Text>
        <Text style={styles.detailText}>Responsável: {latestVisit?.responsible ?? localResponsible}</Text>
        <Text style={[styles.detailText, { color: getVariationColor(currentVisitEvolution) }]}>
          {getLastVisitVariationText(currentVisitEvolution)}
        </Text>
        <Text style={styles.detailText}>
          Status após visita:{' '}
          {statusConfig[latestVisit?.statusAfter ?? currentStatusKey].label}
        </Text>
      </View>

      <View style={styles.tabRow}>
        {detailTabs.map((tab) => {
          const isSelected = activeTab === tab;

          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabButton, isSelected && styles.tabButtonSelected]}>
              <Text style={[styles.tabButtonText, isSelected && styles.tabButtonTextSelected]}>
                {tab}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === 'Resumo' ? (
      <>
        <View style={styles.sectionPanel}>
          <Text style={styles.sectionTitle}>Resumo do apartamento</Text>
          <View style={styles.measurementSummary}>
            <View>
              <Text style={styles.metaValue}>{pendingItems.length}</Text>
              <Text style={styles.metaLabel}>pendência(s)</Text>
            </View>
            <View>
              <Text style={styles.metaValue}>{totalBlockedServices}</Text>
              <Text style={styles.metaLabel}>serviço(s) travado(s)</Text>
            </View>
            <View>
              <Text style={styles.metaValue}>{photos.length}</Text>
              <Text style={styles.metaLabel}>foto(s)</Text>
            </View>
            <View>
              <Text style={styles.metaValue}>{measurements.length}</Text>
              <Text style={styles.metaLabel}>medição(ões)</Text>
            </View>
          </View>
        </View>
        <View style={styles.sectionPanel}>
          <View style={styles.measurementHeader}>
            <View>
              <Text style={styles.sectionTitle}>Evolução da unidade</Text>
              <Text style={styles.sectionHint}>
                Atual: {progress}% • Anterior: {previousProgress}%
              </Text>
            </View>
            <Text style={[styles.measurementTotal, { color: getVariationColor(unitProgressVariation) }]}>
              {getVariationLabel(unitProgressVariation)}
            </Text>
          </View>
          <View style={styles.metricGrid}>
            <Text style={styles.metric}>Visitas realizadas: {visits.length}</Text>
            <Text style={styles.metric}>
              Primeira visita: {firstVisit ? formatPhotoDateTime(firstVisit.date) : 'sem registro'}
            </Text>
            <Text style={styles.metric}>
              Última visita: {latestVisit ? formatPhotoDateTime(latestVisit.date) : 'sem registro'}
            </Text>
          </View>
        </View>
        <View style={styles.sectionPanel}>
          <View style={styles.measurementHeader}>
            <View>
              <Text style={styles.sectionTitle}>Histórico de visitas</Text>
              <Text style={styles.sectionHint}>
                {openVisit ? 'Visita em andamento' : 'Nenhuma visita aberta'}
              </Text>
            </View>
            <View style={styles.visitButtonRow}>
              {openVisit ? (
                <Pressable onPress={finishVisit} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Finalizar visita</Text>
                </Pressable>
              ) : (
                <Pressable onPress={startNewVisit} style={styles.clearButton}>
                  <Text style={styles.clearButtonText}>Nova visita</Text>
                </Pressable>
              )}
            </View>
          </View>
          {openVisit ? (
            <TextInput
            multiline
            onChangeText={updateOpenVisitNote}
            placeholder="Observação geral da visita"
            placeholderTextColor="#94A3B8"
            style={styles.commentInput}
            value={openVisit?.generalNote ?? ''}
            />
          ) : null}
        </View>
      </>
      ) : null}

      {activeTab === 'Serviços' ? (
        <View style={styles.sectionPanel}>
          <Text style={styles.sectionTitle}>Serviços do apartamento</Text>
          {checklist.map((item) => {
            const itemStatus = checklistConfig[item.state];
            const itemPhotos = photosByServiceId[item.id] ?? [];

            return (
              <View key={`service-${item.id}`} style={styles.serviceRow}>
                <View style={styles.savedMeasurementContent}>
                  <Text style={styles.measurementService}>{item.label}</Text>
                  <Text style={styles.savedMeasurementMeta}>
                    {itemPhotos.length} foto(s) • {item.comment || 'sem comentário'}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: itemStatus.background }]}>
                  <Text style={[styles.statusText, { color: itemStatus.color }]}>
                    {itemStatus.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {activeTab === 'Checklist' ? (
      <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Checklist de vistoria</Text>
          <Text style={styles.sectionHint}>Dados salvos localmente neste navegador</Text>
        </View>
        <Pressable onPress={clearApartmentData} style={styles.clearButton}>
          <Text style={styles.clearButtonText}>Limpar dados deste apartamento</Text>
        </Pressable>
      </View>

      {checklist.map((item) => {
        const itemStatus = checklistConfig[item.state];
        const itemPhotos = photosByServiceId[item.id] ?? [];

        return (
          <View key={item.id} style={styles.checkItem}>
            <View style={styles.checkHeader}>
              <View style={[styles.checkIcon, { backgroundColor: itemStatus.background }]}>
                <Text style={[styles.checkIconText, { color: itemStatus.color }]}>
                  {itemStatus.symbol}
                </Text>
              </View>
              <View style={styles.checkContent}>
                <Text style={styles.checkLabel}>{item.label}</Text>
                <Text style={[styles.checkState, { color: itemStatus.color }]}>
                  {itemStatus.label}
                </Text>
              </View>
            </View>

            <View style={styles.optionRow}>
              {checklistOptions.map((option) => {
                const optionStatus = checklistConfig[option];
                const isSelected = item.state === option;

                return (
                  <Pressable
                    key={option}
                    onPress={() => updateItemStatus(item.id, option)}
                    style={[
                      styles.optionButton,
                      isSelected && {
                        backgroundColor: optionStatus.background,
                        borderColor: optionStatus.color,
                      },
                    ]}
                    testID={`checklist-${item.id}-${option}`}>
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && { color: optionStatus.color },
                      ]}>
                      {optionStatus.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              multiline
              onChangeText={(comment) => updateItemComment(item.id, comment)}
              placeholder="Comentário"
              placeholderTextColor="#94A3B8"
              style={styles.commentInput}
              value={item.comment}
            />

            {item.state === 'pending' || item.state === 'partial' ? (
              <View style={styles.issueBox}>
                <Text style={styles.contractorTitle}>Pendência do serviço</Text>
                <Text style={styles.sectionHint}>
                  Informe criticidade, comentário e anexe foto para documentar a vistoria.
                </Text>
                <View style={styles.optionRow}>
                  {criticalityOptions.map((criticality) => {
                    const isSelected = item.issueCriticality === criticality;

                    return (
                      <Pressable
                        key={criticality}
                        onPress={() => updateItemIssue(item.id, 'issueCriticality', criticality)}
                        style={[styles.optionButton, isSelected && styles.issueCriticalitySelected]}>
                        <Text
                          style={[
                            styles.optionText,
                            isSelected && styles.issueCriticalitySelectedText,
                          ]}>
                          {criticality}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  multiline
                  onChangeText={(comment) => updateItemIssue(item.id, 'issueComment', comment)}
                  placeholder="Comentário da pendência"
                  placeholderTextColor="#94A3B8"
                  style={styles.commentInput}
                  value={item.issueComment ?? ''}
                />
              </View>
            ) : null}

            <View style={styles.photoActionsRow}>
              <Pressable
                onPress={() => addPhotoToItem(item)}
                style={styles.photoButton}
                testID={`add-photo-${item.id}`}>
                <Text style={styles.photoButtonText}>
                  {itemPhotos.length > 0 ? 'Adicionar mais fotos' : 'Adicionar foto'}
                </Text>
              </Pressable>
              <Text style={styles.photoCounter}>{itemPhotos.length} foto(s)</Text>
            </View>

            {itemPhotos.length > 0 ? (
              <View style={styles.photoThumbGrid}>
                {itemPhotos.map((photo) => (
                  <View key={photo.id} style={styles.photoThumbCard}>
                    <Pressable onPress={() => setSelectedPhoto(photo)}>
                      <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                    </Pressable>
                    <View style={styles.photoThumbContent}>
                      <Text style={styles.photoLinkedService}>Serviço: {photo.service}</Text>
                      <Text style={styles.photoMeta}>
                        Apartamento {apartment.number} / {tower.name}
                      </Text>
                      <Text style={styles.photoMeta}>
                        {formatPhotoDateTime(photo.dataHora ?? photo.createdAt)}
                      </Text>
                      <TextInput
                        onChangeText={(comment) => updatePhotoComment(photo.id, comment)}
                        placeholder="Comentário da foto"
                        placeholderTextColor="#94A3B8"
                        style={styles.photoCommentInput}
                        testID={`photo-comment-${photo.id}`}
                        value={photo.comment}
                      />
                      <Pressable
                        onPress={() => removePhoto(photo.id)}
                        style={styles.removePhotoButton}
                        testID={`remove-photo-${photo.id}`}>
                        <Text style={styles.removePhotoButtonText}>Remover foto</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      </>
      ) : null}

      {activeTab === 'Fotos' ? (
      <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Fotos da vistoria</Text>
          <Text style={styles.sectionHint}>
            Fotos locais vinculadas por torre, apartamento e serviço
          </Text>
        </View>
      </View>

      {photos.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyPanelText}>Nenhuma foto anexada neste apartamento.</Text>
        </View>
      ) : (
        <View style={styles.photoGallery}>
          {photos.map((photo) => (
            <View key={`gallery-${photo.id}`} style={styles.photoGalleryCard}>
              <Pressable onPress={() => setSelectedPhoto(photo)}>
                <Image source={{ uri: photo.uri }} style={styles.photoGalleryImage} />
              </Pressable>
              <View style={styles.photoGalleryContent}>
                <Text style={styles.measurementService}>Item do checklist: {photo.service}</Text>
                <Text style={styles.savedMeasurementMeta}>
                  {tower.name} / Apartamento {apartment.number}
                </Text>
                <Text style={styles.photoMeta}>
                  {formatPhotoDateTime(photo.dataHora ?? photo.createdAt)}
                </Text>
                <Text style={styles.photoMeta}>Item ID: {photo.itemId ?? photo.serviceId}</Text>
                {photo.comment ? (
                  <Text style={styles.savedMeasurementComment}>{photo.comment}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
      </>
      ) : null}

      {activeTab === 'Histórico' ? (
        <View style={styles.sectionPanel}>
          <Text style={styles.sectionTitle}>Histórico de visitas</Text>
          {sortVisitsDesc(visits).length === 0 ? (
            <Text style={styles.emptyPanelText}>Nenhuma visita registrada ainda.</Text>
          ) : (
            sortVisitsDesc(visits).map((visit) => (
              <View key={visit.id} style={styles.visitCard}>
                <View style={styles.measurementHeader}>
                  <View style={styles.savedMeasurementContent}>
                    <Text style={styles.measurementService}>{formatPhotoDateTime(visit.date)}</Text>
                    <Text style={styles.savedMeasurementMeta}>
                      {visit.responsible} • {visit.progressAfter}% vistoriado •{' '}
                      <Text style={{ color: getVariationColor(visit.evolution) }}>
                        {getVariationLabel(visit.evolution)}
                      </Text>
                    </Text>
                    <Text style={styles.savedMeasurementMeta}>
                      Antes: {visit.progressBefore}% • Depois: {visit.progressAfter}%
                    </Text>
                    <Text style={styles.savedMeasurementMeta}>
                      Pendências: {visit.counts.pending + visit.counts.partial} • Fotos:{' '}
                      {visit.photosAdded} • Status: {statusConfig[visit.statusAfter].label}
                    </Text>
                  </View>
                  <Pressable onPress={() => setSelectedVisit(visit)} style={styles.clearButton}>
                    <Text style={styles.clearButtonText}>Ver detalhes</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}

      {activeTab === 'Pendências' ? (
      <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Pendências</Text>
          <Text style={styles.sectionHint}>
            Itens pendentes ou parciais com criticidade, comentário e foto
          </Text>
        </View>
      </View>

      {pendingItems.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyPanelText}>Nenhuma pendência registrada neste apartamento.</Text>
        </View>
      ) : (
        pendingItems.map((item) => {
          const itemPhotos = photosByServiceId[item.id] ?? [];
          const itemStatus = checklistConfig[item.state];

          return (
            <View key={`issue-${item.id}`} style={styles.lockedCard}>
              <View style={styles.measurementHeader}>
                <View style={styles.savedMeasurementContent}>
                  <Text style={styles.measurementService}>{item.label}</Text>
                  <Text style={[styles.checkState, { color: itemStatus.color }]}>
                    {itemStatus.label}
                  </Text>
                  <Text style={styles.savedMeasurementMeta}>
                    Criticidade: {item.issueCriticality ?? 'Média'}
                  </Text>
                  <Text style={styles.savedMeasurementMeta}>
                    {item.issueComment || item.comment || 'Sem comentário da pendência.'}
                  </Text>
                </View>
                <Text style={styles.photoCounter}>{itemPhotos.length} foto(s)</Text>
              </View>
            </View>
          );
        })
      )}

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Serviços travados</Text>
          <Text style={styles.sectionHint}>
            Pendências que bloqueiam próximas etapas da obra
          </Text>
        </View>
      </View>

      {blockedServiceGroups.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyPanelText}>Nenhum serviço travado neste apartamento.</Text>
        </View>
      ) : (
        <View style={styles.lockedSummary}>
          <View>
            <Text style={styles.metaValue}>{blockedServiceGroups.length}</Text>
            <Text style={styles.metaLabel}>pendências com impacto</Text>
          </View>
          <View>
            <Text style={styles.metaValue}>{totalBlockedServices}</Text>
            <Text style={styles.metaLabel}>serviços travados</Text>
          </View>
        </View>
      )}

      {blockedServiceGroups.map((group) => (
        <View key={group.pendingService} style={styles.lockedCard}>
          <View style={styles.measurementHeader}>
            <View style={styles.savedMeasurementContent}>
              <Text style={styles.measurementService}>{group.pendingService}</Text>
              <Text style={styles.sectionHint}>Pendência que trava próxima etapa</Text>
              <Text style={styles.lockedStatusText}>Status atual: {group.currentStatus}</Text>
            </View>
            <View style={styles.impactBadge}>
              <Text style={styles.impactBadgeText}>{group.impact}</Text>
            </View>
          </View>
          <Text style={styles.lockedServicesText}>
            Trava: {group.blockedServices.join(', ')}
          </Text>
        </View>
      ))}
      </>
      ) : null}

      {activeTab === 'Cronograma' ? (
      <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Cronograma do apartamento</Text>
          <Text style={styles.sectionHint}>
            Planejado x realizado por serviço do checklist
          </Text>
        </View>
      </View>

      {scheduleAlert ? (
        <View style={styles.alertBox}>
          <Text style={styles.alertText}>{scheduleAlert}</Text>
        </View>
      ) : null}

      {scheduleRows.map((row) => {
        const checklistItem = checklist.find((item) => item.label === row.service);
        const scheduleStatusStyle = scheduleStatusStyles[row.scheduleStatus];
        const isPendingOrPartial =
          row.inspectionStatus === 'pending' || row.inspectionStatus === 'partial';
        const isNotApplicable = row.inspectionStatus === 'notApplicable';

        if (!checklistItem) {
          return null;
        }

        return (
          <View key={`schedule-${checklistItem.id}`} style={styles.scheduleCard}>
            <View style={styles.measurementHeader}>
              <View style={styles.savedMeasurementContent}>
                <Text style={styles.measurementService}>{row.service}</Text>
                <Text style={styles.sectionHint}>
                  Status da vistoria: {checklistConfig[row.inspectionStatus].label}
                </Text>
              </View>
              <View style={[styles.scheduleBadge, { backgroundColor: scheduleStatusStyle.background }]}>
                <Text style={[styles.scheduleBadgeText, { color: scheduleStatusStyle.color }]}>
                  {row.scheduleStatus}
                </Text>
              </View>
            </View>

            {isNotApplicable ? (
              <Text style={styles.detailText}>Cronograma: Não se aplica</Text>
            ) : (
              <>
                <View style={styles.formGrid}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Início planejado</Text>
                    <TextInput
                      onChangeText={(value) => updateItemSchedule(checklistItem.id, 'plannedStart', value)}
                      keyboardType="number-pad"
                      maxLength={10}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                      testID={`schedule-planned-start-${checklistItem.id}`}
                      value={checklistItem.plannedStart ?? ''}
                    />
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Término planejado</Text>
                    <TextInput
                      onChangeText={(value) => updateItemSchedule(checklistItem.id, 'plannedEnd', value)}
                      keyboardType="number-pad"
                      maxLength={10}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                      testID={`schedule-planned-end-${checklistItem.id}`}
                      value={checklistItem.plannedEnd ?? ''}
                    />
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Início real</Text>
                    <TextInput
                      onChangeText={(value) => updateItemSchedule(checklistItem.id, 'actualStart', value)}
                      keyboardType="number-pad"
                      maxLength={10}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                      testID={`schedule-actual-start-${checklistItem.id}`}
                      value={checklistItem.actualStart ?? ''}
                    />
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Término real</Text>
                    {isPendingOrPartial ? (
                      <View style={styles.disabledDateBox}>
                        <Text style={styles.disabledDateText}>Ainda não concluído</Text>
                      </View>
                    ) : (
                      <TextInput
                        onChangeText={(value) => updateItemSchedule(checklistItem.id, 'actualEnd', value)}
                        keyboardType="number-pad"
                        maxLength={10}
                        placeholder="DD/MM/AAAA"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                        testID={`schedule-actual-end-${checklistItem.id}`}
                        value={checklistItem.actualEnd ?? ''}
                      />
                    )}
                  </View>
                </View>

                <View style={styles.scheduleMetaRow}>
                  <Text style={styles.detailText}>
                    Planejado: {formatDateBr(row.plannedStart)} até {formatDateBr(row.plannedEnd)}
                  </Text>
                  <Text style={styles.detailText}>
                    {isPendingOrPartial
                      ? row.actualStart
                        ? `Real: iniciado em ${formatDateBr(row.actualStart)} — ainda não concluído`
                        : 'Real: ainda não iniciado'
                      : `Real: ${formatDateBr(row.actualStart)} até ${formatDateBr(row.actualEnd)}`}
                  </Text>
                  <Text style={styles.detailText}>Dias de atraso: {row.delayDays}</Text>
                </View>
              </>
            )}

            {row.blockedServices.length > 0 ? (
              <Text style={styles.lockedServicesText}>
                Serviços travados: {row.blockedServices.join(', ')}
              </Text>
            ) : null}
          </View>
        );
      })}
      </>
      ) : null}

      {activeTab === 'Medições' ? (
      <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Medição de serviços</Text>
          <Text style={styles.sectionHint}>Medições locais, sem integração financeira</Text>
        </View>
        <Pressable onPress={clearApartmentMeasurements} style={styles.clearButton}>
          <Text style={styles.clearButtonText}>Limpar medições deste apartamento</Text>
        </Pressable>
      </View>

      <View style={styles.measurementSummary}>
        <View>
          <Text style={styles.metaValue}>{measurements.length}</Text>
          <Text style={styles.metaLabel}>medições registradas</Text>
        </View>
        <View>
          <Text style={styles.metaValue}>{formatCurrency(totalMeasuredValue)}</Text>
          <Text style={styles.metaLabel}>valor total</Text>
        </View>
      </View>

      {measurementAlert ? (
        <View style={styles.alertBox}>
          <Text style={styles.alertText}>{measurementAlert}</Text>
        </View>
      ) : null}

      {measurableItems.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyPanelText}>
            Marque um item do checklist como OK para gerar uma medição.
          </Text>
        </View>
      ) : (
        measurableItems.map((item) => {
          const draft = getMeasurementDraft(item.id);
          const draftTotalValue = toNumber(draft.quantity) * toNumber(draft.unitPrice);
          const hasMeasurementForContractor =
            Boolean(draft.contractor.trim()) &&
            measurements.some((measurement) => {
              const measurementKey = getMeasurementDuplicateKey({
                apartmentId: measurement.apartmentId,
                contractor: measurement.contractor,
                contractorId: measurement.contractorId,
                obraId: measurement.obraId,
                service: measurement.service,
                serviceId: measurement.serviceId,
                towerId: measurement.towerId,
              });
              const draftKey = getMeasurementDuplicateKey({
                apartmentId: apartment.id,
                contractor: draft.contractor,
                obraId: project.id,
                service: item.label,
                serviceId: item.id,
                towerId: tower.id,
              });

              return measurementKey === draftKey && measurementBlocksDuplicate(measurement.status);
            });

          return (
            <View key={`measurement-${item.id}`} style={styles.measurementCard}>
              <View style={styles.measurementHeader}>
                <View>
                  <Text style={styles.measurementService}>{item.label}</Text>
                  <Text style={styles.sectionHint}>Disponível porque o serviço está OK</Text>
                </View>
                <Text style={styles.measurementTotal}>{formatCurrency(draftTotalValue)}</Text>
              </View>

              <View style={styles.formGrid}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Obra</Text>
                  <Text style={styles.disabledDateText}>{project.name}</Text>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Torre</Text>
                  <Text style={styles.disabledDateText}>{tower.name}</Text>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Apartamento</Text>
                  <Text style={styles.disabledDateText}>Apartamento {apartment.number}</Text>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Serviço</Text>
                  <Text style={styles.disabledDateText}>{item.label}</Text>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Empreiteiro</Text>
                  <TextInput
                    onChangeText={(value) => updateMeasurementDraft(item.id, 'contractor', value)}
                    placeholder="Nome do empreiteiro"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    testID={`measurement-contractor-${item.id}`}
                    value={draft.contractor}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Quantidade</Text>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={(value) => updateMeasurementDraft(item.id, 'quantity', value)}
                    placeholder="0"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    testID={`measurement-quantity-${item.id}`}
                    value={draft.quantity}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Unidade</Text>
                  <TextInput
                    onChangeText={(value) => updateMeasurementDraft(item.id, 'unit', value)}
                    placeholder="m², un, m"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    testID={`measurement-unit-${item.id}`}
                    value={draft.unit}
                  />
                </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Valor unitário</Text>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={(value) => updateMeasurementDraft(item.id, 'unitPrice', value)}
                    placeholder="0,00"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    testID={`measurement-unit-price-${item.id}`}
                    value={draft.unitPrice}
                  />
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Período início</Text>
                    <TextInput
                      onChangeText={(value) => updateMeasurementDraft(item.id, 'periodStart', value)}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                      testID={`measurement-period-start-${item.id}`}
                      value={draft.periodStart}
                    />
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Período fim</Text>
                    <TextInput
                      onChangeText={(value) => updateMeasurementDraft(item.id, 'periodEnd', value)}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                      testID={`measurement-period-end-${item.id}`}
                      value={draft.periodEnd}
                    />
                  </View>
                </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Tipo de medição</Text>
                {hasMeasurementForContractor ? (
                  <View style={styles.inlineAlertBox}>
                    <Text style={styles.inlineAlertText}>
                      {measurementDuplicateMessage}
                    </Text>
                    <Text style={styles.inlineAlertHint}>
                      Regra de bloqueio: obra + torre + apartamento + serviço + empreiteiro.
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.sectionHint}>
                    A duplicidade considera obra, torre, apartamento, serviço e empreiteiro.
                  </Text>
                )}
                <View style={styles.optionRow}>
                  {measurementTypeOptions.map((measurementType) => {
                    const isSelected = draft.measurementType === measurementType;
                    const isNormalBlocked = false;

                    return (
                      <Pressable
                        key={measurementType}
                        disabled={isNormalBlocked}
                        onPress={() => {
                          updateMeasurementDraft(item.id, 'measurementType', measurementType);
                          setMeasurementAlert('');
                        }}
                        style={[
                          styles.optionButton,
                          isSelected && styles.measurementTypeSelected,
                          isNormalBlocked && styles.disabledOptionButton,
                        ]}>
                        <Text
                          style={[
                            styles.optionText,
                            isSelected && styles.measurementTypeSelectedText,
                            isNormalBlocked && styles.disabledOptionText,
                          ]}>
                          {getMeasurementTypeLabel(measurementType)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Status</Text>
                <View style={styles.optionRow}>
                  {measurementStatusOptions.map((measurementStatus) => {
                    const isSelected = draft.status === measurementStatus;

                    return (
                      <Pressable
                        key={measurementStatus}
                        onPress={() =>
                          updateMeasurementDraft(item.id, 'status', measurementStatus)
                        }
                        style={[styles.optionButton, isSelected && styles.measurementStatusSelected]}>
                        <Text
                          style={[
                            styles.optionText,
                            isSelected && styles.measurementStatusSelectedText,
                          ]}>
                          {measurementStatus}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <TextInput
                multiline
                onChangeText={(value) => updateMeasurementDraft(item.id, 'comment', value)}
                placeholder="Observação da pré-medição"
                placeholderTextColor="#94A3B8"
                style={styles.commentInput}
                testID={`measurement-comment-${item.id}`}
                value={draft.comment}
              />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Foto/evidência</Text>
                {draft.evidenceUri ? (
                  <Pressable onPress={() => setSelectedMeasurementEvidence({
                    id: 'draft',
                    apartmentId: apartment.id,
                    obraId: project.id,
                    towerId: tower.id,
                    serviceId: item.id,
                    contractorId: getContractorId(draft.contractor || 'rascunho'),
                    service: item.label,
                    contractor: draft.contractor || 'Rascunho',
                    quantity: toNumber(draft.quantity),
                    unit: draft.unit || 'un',
                    unitPrice: toNumber(draft.unitPrice),
                    totalValue: draftTotalValue,
                    periodStart: draft.periodStart,
                    periodEnd: draft.periodEnd,
                    status: draft.status,
                    comment: draft.comment,
                    measurementType: draft.measurementType,
                    evidenceUri: draft.evidenceUri,
                    evidenceFileName: draft.evidenceFileName,
                  })}>
                    <Image source={{ uri: draft.evidenceUri }} style={styles.photoThumb} />
                  </Pressable>
                ) : null}
                <Pressable onPress={() => addMeasurementEvidence(item.id)} style={styles.clearButton}>
                  <Text style={styles.clearButtonText}>
                    {draft.evidenceUri ? 'Trocar evidência' : 'Adicionar evidência'}
                  </Text>
                </Pressable>
                {draft.evidenceFileName ? (
                  <Text style={styles.sectionHint}>{draft.evidenceFileName}</Text>
                ) : null}
              </View>

              <Pressable
                onPress={() => createMeasurement(item)}
                style={styles.primaryButton}
                testID={`create-measurement-${item.id}`}>
                <Text style={styles.primaryButtonText}>Criar medição</Text>
              </Pressable>
            </View>
          );
        })
      )}

      {measurements.map((measurement) => (
        <View key={measurement.id} style={styles.savedMeasurementCard}>
          <View style={styles.measurementHeader}>
            <View style={styles.savedMeasurementContent}>
              <Text style={styles.measurementService}>{measurement.service}</Text>
              <Text style={styles.savedMeasurementMeta}>
                {measurement.contractor} • {measurement.quantity} {measurement.unit} •{' '}
                {formatCurrency(measurement.unitPrice)} / {measurement.unit}
              </Text>
              <Text style={styles.savedMeasurementMeta}>
                Período: {measurement.periodStart} até {measurement.periodEnd}
              </Text>
              {measurement.evidenceUri ? (
                <Pressable onPress={() => setSelectedMeasurementEvidence(measurement)}>
                  <Text style={styles.savedMeasurementMeta}>Evidência: {measurement.evidenceFileName ?? 'ver foto'}</Text>
                </Pressable>
              ) : (
                <Text style={styles.savedMeasurementMeta}>Evidência: não anexada</Text>
              )}
            </View>
            <Text style={styles.measurementTotal}>{formatCurrency(measurement.totalValue)}</Text>
          </View>
            <View style={styles.savedMeasurementFooter}>
              <Text style={styles.savedMeasurementType}>
                {getMeasurementTypeLabel(measurement.measurementType)}
              </Text>
              <Text style={styles.savedMeasurementStatus}>{measurement.status}</Text>
              {measurement.comment ? (
              <Text style={styles.savedMeasurementComment}>{measurement.comment}</Text>
            ) : null}
          </View>
        </View>
      ))}
      </>
      ) : null}
    </ScrollView>
    <Modal
      animationType="fade"
      onRequestClose={() => setSelectedPhoto(undefined)}
      transparent
      visible={Boolean(selectedPhoto)}>
      <View style={styles.photoModalBackdrop}>
        <View style={styles.photoModalCard}>
          {selectedPhoto ? (
            <>
              <Image source={{ uri: selectedPhoto.uri }} style={styles.photoModalImage} />
              <View style={styles.photoModalContent}>
                <Text style={styles.measurementService}>{selectedPhoto.service}</Text>
                <Text style={styles.savedMeasurementMeta}>
                  {tower.name} / Apartamento {apartment.number}
                </Text>
                <Text style={styles.photoMeta}>
                  {formatPhotoDateTime(selectedPhoto.dataHora ?? selectedPhoto.createdAt)}
                </Text>
                {selectedPhoto.comment ? (
                  <Text style={styles.savedMeasurementComment}>{selectedPhoto.comment}</Text>
                ) : null}
              </View>
            </>
          ) : null}
          <Pressable onPress={() => setSelectedPhoto(undefined)} style={styles.closePhotoButton}>
            <Text style={styles.closePhotoButtonText}>Fechar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    <Modal
      animationType="fade"
      onRequestClose={() => setSelectedMeasurementEvidence(undefined)}
      transparent
      visible={Boolean(selectedMeasurementEvidence)}>
      <View style={styles.photoModalBackdrop}>
        <View style={styles.photoModalCard}>
          {selectedMeasurementEvidence?.evidenceUri ? (
            <>
              <Image source={{ uri: selectedMeasurementEvidence.evidenceUri }} style={styles.photoModalImage} />
              <View style={styles.photoModalContent}>
                <Text style={styles.measurementService}>{selectedMeasurementEvidence.service}</Text>
                <Text style={styles.savedMeasurementMeta}>
                  Empreiteiro: {selectedMeasurementEvidence.contractor}
                </Text>
                <Text style={styles.savedMeasurementMeta}>
                  Arquivo: {selectedMeasurementEvidence.evidenceFileName ?? 'evidência local'}
                </Text>
                {selectedMeasurementEvidence.comment ? (
                  <Text style={styles.savedMeasurementComment}>{selectedMeasurementEvidence.comment}</Text>
                ) : null}
              </View>
            </>
          ) : null}
          <Pressable onPress={() => setSelectedMeasurementEvidence(undefined)} style={styles.closePhotoButton}>
            <Text style={styles.closePhotoButtonText}>Fechar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    <Modal
      animationType="slide"
      onRequestClose={() => setSelectedVisit(undefined)}
      transparent
      visible={Boolean(selectedVisit)}>
      <View style={styles.photoModalBackdrop}>
        <View style={styles.visitModalCard}>
          {selectedVisit ? (
            <ScrollView contentContainerStyle={styles.visitModalContent}>
              <Text style={styles.sectionTitle}>Detalhe da visita</Text>
              <View style={styles.metricGrid}>
                <Text style={styles.metric}>Data: {formatPhotoDateTime(selectedVisit.date)}</Text>
                <Text style={styles.metric}>Responsável: {selectedVisit.responsible}</Text>
                <Text style={styles.metric}>Antes: {selectedVisit.progressBefore}%</Text>
                <Text style={styles.metric}>Depois: {selectedVisit.progressAfter}%</Text>
                <Text style={[styles.metric, { color: getVariationColor(selectedVisit.evolution) }]}>
                  {getVariationLabel(selectedVisit.evolution)}
                </Text>
                <Text style={styles.metric}>
                  Status: {statusConfig[selectedVisit.statusAfter].label}
                </Text>
              </View>
              <Text style={styles.contractorTitle}>Itens alterados</Text>
              {selectedVisit.changedItemIds.length === 0 ? (
                <Text style={styles.emptyPanelText}>Nenhum item alterado nesta visita.</Text>
              ) : (
                selectedVisit.changedItemIds.map((itemId) => {
                  const item = checklist.find((checkItem) => checkItem.id === itemId);
                  return (
                    <Text key={`changed-${itemId}`} style={styles.detailText}>
                      {item?.label ?? itemId}
                    </Text>
                  );
                })
              )}
              <Text style={styles.contractorTitle}>Fotos adicionadas</Text>
              {photos.filter((photo) => selectedVisit.addedPhotoIds.includes(photo.id)).length === 0 ? (
                <Text style={styles.emptyPanelText}>Nenhuma foto adicionada nesta visita.</Text>
              ) : (
                <View style={styles.photoThumbGrid}>
                  {photos
                    .filter((photo) => selectedVisit.addedPhotoIds.includes(photo.id))
                    .map((photo) => (
                      <View key={`visit-photo-${photo.id}`} style={styles.photoThumbCard}>
                        <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                        <Text style={styles.photoLinkedService}>{photo.service}</Text>
                      </View>
                    ))}
                </View>
              )}
              <Text style={styles.contractorTitle}>Pendências geradas</Text>
              {selectedVisit.issueItemIds.length === 0 ? (
                <Text style={styles.emptyPanelText}>Nenhuma pendência registrada.</Text>
              ) : (
                selectedVisit.issueItemIds.map((itemId) => {
                  const item = checklist.find((checkItem) => checkItem.id === itemId);
                  return (
                    <Text key={`issue-detail-${itemId}`} style={styles.detailText}>
                      {item?.label ?? itemId}
                    </Text>
                  );
                })
              )}
              {selectedVisit.generalNote ? (
                <Text style={styles.savedMeasurementComment}>{selectedVisit.generalNote}</Text>
              ) : null}
            </ScrollView>
          ) : null}
          <Pressable onPress={() => setSelectedVisit(undefined)} style={styles.closePhotoButton}>
            <Text style={styles.closePhotoButtonText}>Fechar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
    gap: 16,
  },
  summaryHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  kicker: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 6,
  },
  floor: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '900',
  },
  progressTrack: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  metaRow: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 14,
  },
  metaValue: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
  },
  metaLabel: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  notes: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 21,
  },
  sectionHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 6,
  },
  visitStrip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#BFDBFE',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabButtonSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  tabButtonText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  tabButtonTextSelected: {
    color: '#2563EB',
  },
  sectionPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metric: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 999,
    borderWidth: 1,
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  visitButtonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  visitCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '900',
  },
  sectionHint: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 3,
  },
  contractorTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
  },
  clearButton: {
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  clearButtonText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
  },
  checkItem: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  checkHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  checkIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  checkIconText: {
    fontSize: 14,
    fontWeight: '900',
  },
  checkContent: {
    flex: 1,
    gap: 3,
  },
  checkLabel: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  checkState: {
    fontSize: 12,
    fontWeight: '900',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    borderColor: '#CBD5E1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  optionText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
  },
  disabledOptionButton: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    opacity: 0.55,
  },
  disabledOptionText: {
    color: '#94A3B8',
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
  issueBox: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FBBF24',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  issueCriticalitySelected: {
    backgroundColor: '#FEF3C7',
    borderColor: '#B45309',
  },
  issueCriticalitySelectedText: {
    color: '#92400E',
  },
  serviceRow: {
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  photoActionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoButton: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  photoButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  photoCounter: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
  },
  photoThumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoThumbCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 8,
    width: 190,
  },
  photoThumb: {
    backgroundColor: '#E2E8F0',
    borderRadius: 6,
    height: 112,
    width: '100%',
  },
  photoThumbContent: {
    gap: 6,
  },
  photoMeta: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
  },
  photoLinkedService: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  photoCommentInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 12,
    minHeight: 38,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  removePhotoButton: {
    alignItems: 'center',
    borderColor: '#FCA5A5',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  removePhotoButtonText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '900',
  },
  photoGallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  photoGalleryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    width: 240,
  },
  photoGalleryImage: {
    backgroundColor: '#E2E8F0',
    height: 150,
    width: '100%',
  },
  photoGalleryContent: {
    gap: 5,
    padding: 10,
  },
  photoModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  photoModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    maxWidth: 860,
    overflow: 'hidden',
    width: '100%',
  },
  visitModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    maxHeight: '88%',
    maxWidth: 760,
    overflow: 'hidden',
    width: '100%',
  },
  visitModalContent: {
    gap: 12,
    padding: 14,
  },
  photoModalImage: {
    backgroundColor: '#E2E8F0',
    height: 520,
    width: '100%',
  },
  photoModalContent: {
    gap: 6,
    padding: 14,
  },
  closePhotoButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    margin: 14,
    marginTop: 0,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  closePhotoButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  measurementSummary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  lockedSummary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FBBF24',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  emptyPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  emptyPanelText: {
    color: '#64748B',
    fontSize: 14,
  },
  alertBox: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  alertText: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '800',
  },
  inlineAlertBox: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FBBF24',
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  inlineAlertText: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '900',
  },
  inlineAlertHint: {
    color: '#92400E',
    fontSize: 12,
    lineHeight: 17,
  },
  measurementCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#BFDBFE',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  lockedCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FBBF24',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  scheduleCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  scheduleBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scheduleBadgeText: {
    fontSize: 12,
    fontWeight: '900',
  },
  scheduleMetaRow: {
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
  disabledDateBox: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 10,
  },
  disabledDateText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '800',
  },
  impactBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  impactBadgeText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '900',
  },
  lockedServicesText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
  },
  lockedStatusText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 3,
  },
  measurementHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  measurementService: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  measurementTotal: {
    color: '#047857',
    fontSize: 15,
    fontWeight: '900',
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  fieldGroup: {
    flexGrow: 1,
    gap: 6,
    minWidth: 160,
  },
  fieldLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
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
  measurementStatusSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  measurementStatusSelectedText: {
    color: '#2563EB',
  },
  measurementTypeSelected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#047857',
  },
  measurementTypeSelectedText: {
    color: '#047857',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  savedMeasurementCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D1FAE5',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  savedMeasurementContent: {
    flex: 1,
    gap: 4,
  },
  savedMeasurementMeta: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  savedMeasurementFooter: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 10,
  },
  savedMeasurementStatus: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  savedMeasurementType: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '900',
  },
  savedMeasurementComment: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
  },
});
