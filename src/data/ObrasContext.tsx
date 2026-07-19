import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Apartment, ApartmentStatus, ChecklistItem, Tower } from '@/src/data/mockObras';
import type { Measurement } from '@/src/data/localMeasurements';
import { clearChecklistCache, setCachedChecklist } from '@/src/data/checklistCache';
import { setServiceStagesCache, type ServiceStage } from '@/src/data/serviceStages';
import type { ServiceCategory } from '@/src/data/serviceCategories';
import type { ServiceUnit } from '@/src/data/serviceUnits';
import * as db from '@/src/data/db';
import { OBRA_ID, setActiveObra } from '@/src/lib/supabase';

const ACTIVE_OBRA_KEY = 'vistoria.activeObraId';

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
  // multi-obra
  myObras: db.UserObra[];
  activeObraId: string;
  profile: db.Profile | null;
  // papel do usuário na obra ativa + atalhos de permissão (espelho das RLS do banco).
  role: string | null;
  canWrite: boolean;       // pode editar dados (admin/owner/editor)
  canManageObra: boolean;  // pode editar/apagar a própria obra (admin/owner)
  switchObra: (id: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
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
  myObras: [],
  activeObraId: OBRA_ID,
  profile: null,
  role: null,
  canWrite: true,
  canManageObra: false,
  switchObra: async () => {},
  refreshProfile: async () => {},
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
  const [myObras, setMyObras] = useState<db.UserObra[]>([]);
  const [activeObraId, setActiveObraId] = useState<string>(OBRA_ID);
  const [profile, setProfile] = useState<db.Profile | null>(null);

  const loadAll = useCallback(async () => {
    try {
      // Recarga completa (boot, troca de obra, pull-to-refresh): o cache de
      // checklists guarda dados da obra anterior — não podem pintar nem por um frame.
      clearChecklistCache();
      // LAZY: o boot NÃO baixa mais os ~17k checklist_items. Os apartamentos vêm
      // só com progresso/status (colunas denormalizadas) e `checklist: []`. Quem
      // precisa dos itens carrega sob demanda: a tela do apartamento (o seu),
      // o Corte (os da torre), o Cronograma (todos, ao focar a aba) e o Início
      // (agregados via RPC obra_dashboard).
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
      // Espelha o catálogo real nos helpers síncronos (status/dependências/filtros).
      setServiceStagesCache(stageData);
      setServiceStages(stageData);
      setServiceCategories(categoryData);
      setServiceUnits(unitData);
      setMeasurements(measurementData);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const p = await db.loadProfile().catch(() => null);
    setProfile(p);
  }, []);

  // Descobre as obras do usuário, resolve a obra ativa (última escolhida e
  // persistida, senão a primeira) e só então carrega os dados dessa obra.
  const bootstrap = useCallback(async () => {
    setLoading(true);
    const [obrasList, prof] = await Promise.all([
      db.loadMyObras().catch(() => [] as db.UserObra[]),
      db.loadProfile().catch(() => null),
    ]);
    setMyObras(obrasList);
    setProfile(prof);

    let active = await AsyncStorage.getItem(ACTIVE_OBRA_KEY).catch(() => null);
    if (!active || !obrasList.some((o) => o.id === active)) {
      active = obrasList[0]?.id ?? OBRA_ID;
    }
    setActiveObra(active);
    setActiveObraId(active);
    await loadAll();
  }, [loadAll]);

  const switchObra = useCallback(
    async (id: string) => {
      if (id === activeObraId) return;
      await AsyncStorage.setItem(ACTIVE_OBRA_KEY, id).catch(() => {});
      setActiveObra(id);
      setActiveObraId(id);
      setLoading(true);
      await loadAll();
    },
    [activeObraId, loadAll],
  );

  const refreshMeasurements = useCallback(async () => {
    const data = await db.loadAllMeasurements();
    setMeasurements(data);
  }, []);

  const refreshServiceStages = useCallback(async () => {
    const data = await db.loadServiceStages();
    setServiceStagesCache(data);
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
    bootstrap();
  }, [bootstrap]);

  const refreshApartment = useCallback(async (apartmentId: string) => {
    // Busca só este apartamento (antes: baixava a obra inteira via fetchApartments).
    const updated = await db.fetchApartment(apartmentId);
    if (updated) {
      setApartments((prev) => prev.map((a) => (a.id === apartmentId ? updated : a)));
    }
  }, []);

  const updateApartmentLocal = useCallback(
    (apartmentId: string, progress: number, status: ApartmentStatus, checklist?: ChecklistItem[]) => {
      // Espelha a edição no cache de checklists: voltando ao Corte/torre, os KPIs
      // pintam já com a mudança (a atualização de fundo confirma logo depois).
      if (checklist) setCachedChecklist(apartmentId, checklist);
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

  // Papel do usuário na obra ativa → atalhos de permissão que espelham as RLS.
  // Enquanto o papel não resolve (null), liberamos a UI (o banco é a barreira real).
  const role = myObras.find((o) => o.id === activeObraId)?.role ?? null;
  const canWrite = role === null || role === 'admin' || role === 'owner' || role === 'editor';
  const canManageObra = role === 'admin' || role === 'owner';

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
        myObras,
        activeObraId,
        profile,
        role,
        canWrite,
        canManageObra,
        switchObra,
        refreshProfile,
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
