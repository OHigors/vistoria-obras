import type { Apartment, ChecklistItem } from '@/src/data/mockObras';
import { defaultServiceDependencies, getServiceDependencyMap } from '@/src/data/serviceStages';

export type BlockImpact = 'Baixo' | 'Médio' | 'Alto' | 'Crítico';

export type BlockedServiceGroup = {
  pendingService: string;
  blockedServices: string[];
  impact: BlockImpact;
  currentStatus: 'Não iniciado' | 'Em andamento';
};

export type BottleneckSummary = {
  mostPendingService?: {
    service: string;
    affectedApartments: number;
  };
  mostBlockedServices: {
    service: string;
    occurrences: number;
    affectedApartments: number;
  }[];
};

export const serviceDependencies: Record<string, string[]> = defaultServiceDependencies;

const getStorageKey = (apartmentId: string) => `vistoria-${apartmentId}`;

const isBlockingChecklistItem = (item: ChecklistItem) =>
  item.state === 'pending' || item.state === 'partial';

const getCurrentStatusLabel = (state: ChecklistItem['state']): BlockedServiceGroup['currentStatus'] =>
  state === 'pending' ? 'Não iniciado' : 'Em andamento';

const classifyImpact = (blockedServices: string[]): BlockImpact => {
  const blocksFinalRelease = blockedServices.some(
    (service) => service === 'entrega final' || service === 'liberação do apartamento',
  );

  if (blocksFinalRelease) {
    return 'Crítico';
  }

  if (blockedServices.length >= 3) {
    return 'Alto';
  }

  if (blockedServices.length === 2) {
    return 'Médio';
  }

  return 'Baixo';
};

// Checklist state is now the source of truth in Supabase.
// Apartments are loaded from DB with current state already applied.
export const getChecklistForApartment = (apartment: Apartment): ChecklistItem[] =>
  apartment.checklist;

export const getBlockedServiceGroups = (checklist: ChecklistItem[]): BlockedServiceGroup[] =>
  checklist
    .filter(isBlockingChecklistItem)
    .map((item) => {
      const blockedServices = getServiceDependencyMap()[item.label] ?? [];

      return {
        pendingService: item.label,
        blockedServices,
        impact: classifyImpact(blockedServices),
        currentStatus: getCurrentStatusLabel(item.state),
      };
    })
    .filter((group) => group.blockedServices.length > 0);

export const summarizeBottlenecks = (projectApartments: Apartment[]): BottleneckSummary => {
  const pendingApartmentsByService = new Map<string, Set<string>>();
  const blockedServiceCounts = new Map<string, number>();
  const blockedApartmentsByService = new Map<string, Set<string>>();

  projectApartments.forEach((apartment) => {
    const checklist = getChecklistForApartment(apartment);
    const groups = getBlockedServiceGroups(checklist);

    groups.forEach((group) => {
      const affectedApartments =
        pendingApartmentsByService.get(group.pendingService) ?? new Set<string>();

      affectedApartments.add(apartment.id);
      pendingApartmentsByService.set(group.pendingService, affectedApartments);

      group.blockedServices.forEach((blockedService) => {
        blockedServiceCounts.set(
          blockedService,
          (blockedServiceCounts.get(blockedService) ?? 0) + 1,
        );

        const affectedApartmentsForBlockedService =
          blockedApartmentsByService.get(blockedService) ?? new Set<string>();

        affectedApartmentsForBlockedService.add(apartment.id);
        blockedApartmentsByService.set(blockedService, affectedApartmentsForBlockedService);
      });
    });
  });

  const mostPendingService = [...pendingApartmentsByService.entries()]
    .map(([service, affectedApartments]) => ({
      service,
      affectedApartments: affectedApartments.size,
    }))
    .sort((first, second) => second.affectedApartments - first.affectedApartments)[0];

  const mostBlockedServices = [...blockedServiceCounts.entries()]
    .map(([service, occurrences]) => ({
      service,
      occurrences,
      affectedApartments: blockedApartmentsByService.get(service)?.size ?? 0,
    }))
    .sort(
      (first, second) =>
        second.affectedApartments - first.affectedApartments ||
        second.occurrences - first.occurrences,
    )
    .slice(0, 4);

  return {
    mostPendingService,
    mostBlockedServices,
  };
};
