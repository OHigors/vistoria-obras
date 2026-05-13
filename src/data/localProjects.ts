import {
  importedApartmentsStorageKey,
  importedTowersStorageKey,
  project as defaultProject,
} from './mockObras';

export type LocalProject = {
  id: string;
  nome: string;
  endereco?: string;
  construtora?: string;
  responsavel?: string;
  dataInicio?: string;
  observacao?: string;
  createdAt: string;
  active: boolean;
};

export const localProjectsStorageKey = 'obras-cadastradas';
export const activeProjectStorageKey = 'obra-ativa-id';

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const slugify = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const createProjectId = (name: string) => `${slugify(name) || 'obra'}-${Date.now()}`;

const maskDateBr = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const normalizeProjectDate = (value?: string) => {
  if (!value) return '';
  const trimmedValue = value.trim();

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmedValue)) return trimmedValue;

  if (/^\d{8}$/.test(trimmedValue)) return maskDateBr(trimmedValue);

  const isoMatch = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

  return maskDateBr(trimmedValue);
};

const normalizeProjects = (projects: LocalProject[]) => {
  if (projects.length === 0) {
    return [];
  }

  const baseProjects = projects;
  const storedActiveId = canUseStorage() ? window.localStorage.getItem(activeProjectStorageKey) : undefined;
  const activeId =
    storedActiveId && baseProjects.some((project) => project.id === storedActiveId)
      ? storedActiveId
      : baseProjects.find((project) => project.active)?.id ?? baseProjects[0].id;

  return baseProjects.map((project) => ({
    ...project,
    active: project.id === activeId,
    dataInicio: normalizeProjectDate(project.dataInicio),
  }));
};

export const getDefaultLocalProject = (): LocalProject => ({
  id: defaultProject.id,
  nome: defaultProject.name,
  endereco: defaultProject.address,
  observacao: defaultProject.summary,
  createdAt: new Date().toISOString(),
  active: true,
});

export const getLocalProjects = (): LocalProject[] => {
  if (!canUseStorage()) return [getDefaultLocalProject()];

  try {
    const storedValue = window.localStorage.getItem(localProjectsStorageKey);
    if (storedValue === null) {
      const defaultLocalProject = getDefaultLocalProject();
      window.localStorage.setItem(localProjectsStorageKey, JSON.stringify([defaultLocalProject]));
      window.localStorage.setItem(activeProjectStorageKey, defaultLocalProject.id);
      return [defaultLocalProject];
    }

    const projects = storedValue ? (JSON.parse(storedValue) as LocalProject[]) : [];
    if (projects.length === 0) {
      window.localStorage.removeItem(activeProjectStorageKey);
      return [];
    }

    const normalizedProjects = normalizeProjects(projects);
    window.localStorage.setItem(localProjectsStorageKey, JSON.stringify(normalizedProjects));
    window.localStorage.setItem(
      activeProjectStorageKey,
      normalizedProjects.find((project) => project.active)?.id ?? normalizedProjects[0].id,
    );
    return normalizedProjects;
  } catch {
    return [getDefaultLocalProject()];
  }
};

export const saveLocalProjects = (projects: LocalProject[]) => {
  if (!canUseStorage()) return;
  const normalizedProjects = normalizeProjects(projects);
  window.localStorage.setItem(localProjectsStorageKey, JSON.stringify(normalizedProjects));
  const activeProjectId = normalizedProjects.find((project) => project.active)?.id ?? normalizedProjects[0]?.id;
  if (activeProjectId) {
    window.localStorage.setItem(activeProjectStorageKey, activeProjectId);
  } else {
    window.localStorage.removeItem(activeProjectStorageKey);
  }
};

export const getActiveProjectId = () => {
  if (!canUseStorage()) return defaultProject.id;
  const projects = getLocalProjects();
  return window.localStorage.getItem(activeProjectStorageKey) ?? projects[0]?.id ?? '';
};

export const setActiveProjectId = (projectId: string) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(activeProjectStorageKey, projectId);
  saveLocalProjects(getLocalProjects().map((project) => ({ ...project, active: project.id === projectId })));
};

export const getActiveProject = () =>
  getLocalProjects().find((project) => project.id === getActiveProjectId()) ?? {
    ...getDefaultLocalProject(),
    id: '',
    nome: 'Nenhuma obra ativa',
    active: false,
  };

const readStorageArray = <T>(key: string): T[] => {
  if (!canUseStorage()) return [];

  try {
    const storedValue = window.localStorage.getItem(key);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [];
  }
};

const getProjectApartmentIds = (projectId: string) => {
  const importedApartments = readStorageArray<{ id: string; obraId?: string }>(
    importedApartmentsStorageKey,
  );
  const importedIds = importedApartments
    .filter((apartment) => apartment.obraId === projectId)
    .map((apartment) => apartment.id);

  if (projectId === defaultProject.id) {
    return [...new Set([...importedIds, 'ap-11', 'ap-12', 'ap-15', 'ap-24', 'ap-33', 'ap-82'])];
  }

  return [...new Set(importedIds)];
};

export const resetProjectOperationalData = (projectId: string) => {
  if (!canUseStorage()) return;

  const apartmentIds = getProjectApartmentIds(projectId);
  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;

    const isApartmentOperationalKey = apartmentIds.some(
      (apartmentId) =>
        key === `vistoria-${apartmentId}` ||
        key === `fotos-vistoria-${apartmentId}` ||
        key === `visitas-vistoria-${apartmentId}` ||
        key === `medicoes-${apartmentId}` ||
        key === `cronograma-${apartmentId}`,
    );
    const isProjectReportKey = key.startsWith(`relatorio-gerado-${projectId}`);

    if (isApartmentOperationalKey || isProjectReportKey) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
};

export const deleteProjectLocalData = (projectId: string) => {
  if (!canUseStorage()) return;

  resetProjectOperationalData(projectId);
  const importedTowers = readStorageArray<{ obraId?: string }>(importedTowersStorageKey);
  const importedApartments = readStorageArray<{ obraId?: string }>(importedApartmentsStorageKey);

  window.localStorage.setItem(
    importedTowersStorageKey,
    JSON.stringify(importedTowers.filter((tower) => tower.obraId !== projectId)),
  );
  window.localStorage.setItem(
    importedApartmentsStorageKey,
    JSON.stringify(importedApartments.filter((apartment) => apartment.obraId !== projectId)),
  );
  window.localStorage.removeItem(`config-etapas-servicos-obra-${projectId}`);

  const remainingProjects = getLocalProjects().filter((project) => project.id !== projectId);
  const nextProjects = remainingProjects.length
    ? remainingProjects.map((project, index) => ({ ...project, active: index === 0 }))
    : [];
  saveLocalProjects(nextProjects);

  if (getActiveProjectId() === projectId) {
    const nextActiveProject = nextProjects[0];
    if (nextActiveProject) {
      setActiveProjectId(nextActiveProject.id);
    } else {
      window.localStorage.removeItem(activeProjectStorageKey);
    }
  }
};
