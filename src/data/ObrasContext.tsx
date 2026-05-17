import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { Apartment, ApartmentStatus, Tower } from '@/src/data/mockObras';
import type { ServiceStage } from '@/src/data/serviceStages';
import * as db from '@/src/data/db';

type Project = { id: string; name: string; summary: string };

type ObrasContextValue = {
  project: Project;
  towers: Tower[];
  apartments: Apartment[];
  serviceStages: ServiceStage[];
  loading: boolean;
  // helpers
  getTowerById: (id: string) => Tower | undefined;
  getApartmentById: (id: string) => Apartment | undefined;
  getApartmentsByTower: (towerId: string) => Apartment[];
  // mutations
  refreshData: () => Promise<void>;
  refreshApartment: (apartmentId: string) => Promise<void>;
  updateApartmentLocal: (apartmentId: string, progress: number, status: ApartmentStatus) => void;
};

const defaultProject: Project = { id: '', name: '', summary: '' };

const ObrasContext = createContext<ObrasContextValue>({
  project: defaultProject,
  towers: [],
  apartments: [],
  serviceStages: [],
  loading: true,
  getTowerById: () => undefined,
  getApartmentById: () => undefined,
  getApartmentsByTower: () => [],
  refreshData: async () => {},
  refreshApartment: async () => {},
  updateApartmentLocal: () => {},
});

export function ObrasProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = useState<Project>(defaultProject);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [serviceStages, setServiceStages] = useState<ServiceStage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [proj, towerData, apartmentData, stageData] = await Promise.all([
        db.fetchProject(),
        db.fetchTowers(),
        db.fetchApartments(),
        db.loadServiceStages(),
      ]);
      setProject(proj);
      setTowers(towerData);
      setApartments(apartmentData);
      setServiceStages(stageData);
    } finally {
      setLoading(false);
    }
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
    (apartmentId: string, progress: number, status: ApartmentStatus) => {
      setApartments((prev) =>
        prev.map((a) => (a.id === apartmentId ? { ...a, progress, status } : a)),
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
        loading,
        getTowerById,
        getApartmentById,
        getApartmentsByTower,
        refreshData: loadAll,
        refreshApartment,
        updateApartmentLocal,
      }}>
      {children}
    </ObrasContext.Provider>
  );
}

export const useObras = () => useContext(ObrasContext);
