import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { Apartment, ApartmentStatus, ChecklistItem, Tower } from '@/src/data/mockObras';
import type { Measurement } from '@/src/data/localMeasurements';
import type { ServiceStage } from '@/src/data/serviceStages';
import type { ServiceCategory } from '@/src/data/serviceCategories';
import type { ServiceUnit } from '@/src/data/serviceUnits';
import * as db from '@/src/data/db';

type Project = { id: string; name: string; summary: string };

type ObrasContextValue = {
  project: Project;
  towers: Tower[];
  apartments: Apartment[];
  serviceStages: ServiceStage[];
  serviceCategories: ServiceCategory[];
  serviceUnits: ServiceUnit[];
  measurements: Measurement[];
  loading: boolean;
  // helpers
  getTowerById: (id: string) => Tower | undefined;
  getApartmentById: (id: string) => Apartment | undefined;
  getApartmentsByTower: (towerId: string) => Apartment[];
  // mutations
  refreshData: () => Promise<void>;
  refreshApartment: (apartmentId: string) => Promise<void>;
  refreshMeasurements: () => Promise<void>;
  refreshServiceStages: () => Promise<void>;
  refreshServiceCategories: () => Promise<void>;
  refreshServiceUnits: () => Promise<void>;
  updateApartmentLocal: (apartmentId: string, progress: number, status: ApartmentStatus, checklist?: ChecklistItem[]) => void;
};

const defaultProject: Project = { id: '', name: '', summary: '' };

const ObrasContext = createContext<ObrasContextValue>({
  project: defaultProject,
  towers: [],
  apartments: [],
  serviceStages: [],
  serviceCategories: [],
  serviceUnits: [],
  measurements: [],
  loading: true,
  getTowerById: () => undefined,
  getApartmentById: () => undefined,
  getApartmentsByTower: () => [],
  refreshData: async () => {},
  refreshApartment: async () => {},
  refreshMeasurements: async () => {},
  refreshServiceStages: async () => {},
  refreshServiceCategories: async () => {},
  refreshServiceUnits: async () => {},
  updateApartmentLocal: () => { },
});

export function ObrasProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = useState<Project>(defaultProject);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [serviceStages, setServiceStages] = useState<ServiceStage[]>([]);
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>([]);
  const [serviceUnits, setServiceUnits] = useState<ServiceUnit[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [proj, towerData, apartmentData, stageData, categoryData, unitData, measurementData] = await Promise.all([
        db.fetchProject(),
        db.fetchTowers(),
        db.fetchApartments(),
        db.loadServiceStages(),
        db.loadServiceCategories(),
        db.loadServiceUnits(),
        db.loadAllMeasurements(),
      ]);
      setProject(proj);
      setTowers(towerData);
      setApartments(apartmentData);
      setServiceStages(stageData);
      setServiceCategories(categoryData);
      setServiceUnits(unitData);
      setMeasurements(measurementData);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMeasurements = useCallback(async () => {
    const data = await db.loadAllMeasurements();
    setMeasurements(data);
  }, []);

  const refreshServiceStages = useCallback(async () => {
    const data = await db.loadServiceStages();
    setServiceStages(data);
  }, []);

  const refreshServiceCategories = useCallback(async () => {
    const data = await db.loadServiceCategories();
    setServiceCategories(data);
  }, []);

  const refreshServiceUnits = useCallback(async () => {
    const data = await db.loadServiceUnits();
    setServiceUnits(data);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshApartment = useCallback(async (apartmentId: string) => {
    const fresh = await db.fetchApartments();
    const updated = fresh.find((a) => a.id === apartmentId);
    if (updated) {
      setApartments((prev) => prev.map((a) => (a.id === apartmentId ? updated : a)));
    }
  }, []);

  const updateApartmentLocal = useCallback(
    (apartmentId: string, progress: number, status: ApartmentStatus, checklist?: ChecklistItem[]) => {
      setApartments((prev) =>
        prev.map((a) =>
          a.id === apartmentId
            ? { ...a, progress, status, ...(checklist ? { checklist } : {}) }
            : a,
        ),
      );
    },
    [],
  );

  const getTowerById = useCallback(
    (id: string) => towers.find((t) => t.id === id),
    [towers],
  );

  const getApartmentById = useCallback(
    (id: string) => apartments.find((a) => a.id === id),
    [apartments],
  );

  const getApartmentsByTower = useCallback(
    (towerId: string) => apartments.filter((a) => a.towerId === towerId),
    [apartments],
  );

  return (
    <ObrasContext.Provider
      value={{
        project,
        towers,
        apartments,
        serviceStages,
        serviceCategories,
        serviceUnits,
        measurements,
        loading,
        getTowerById,
        getApartmentById,
        getApartmentsByTower,
        refreshData: loadAll,
        refreshApartment,
        refreshMeasurements,
        refreshServiceStages,
        refreshServiceCategories,
        refreshServiceUnits,
        updateApartmentLocal,
      }}>
      {children}
    </ObrasContext.Provider>
  );
}

export const useObras = () => useContext(ObrasContext);
