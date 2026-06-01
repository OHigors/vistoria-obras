export type Worker = {
  id: string;
  nome: string;
  funcao: string;
};

export function createEmptyWorker(): Worker {
  return { id: '', nome: '', funcao: '' };
}
