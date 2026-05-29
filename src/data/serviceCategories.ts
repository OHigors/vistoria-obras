export type ServiceCategory = {
  id: string;
  nome: string;
};

export function createEmptyCategory(): ServiceCategory {
  return { id: '', nome: '' };
}
