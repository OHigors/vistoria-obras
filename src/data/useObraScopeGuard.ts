import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';

import { useObras } from '@/src/data/ObrasContext';

/**
 * Tira a tela do ar quando a entidade da URL não pertence à obra ativa.
 *
 * As rotas dinâmicas (`/visao-geral/corte/[torreId]`, `/visao-geral/apartamentos/[id]`…)
 * guardam o id na própria URL. Ao trocar de obra, o Expo Router mantém a pilha de
 * navegação de cada aba — então a URL continuava apontando para uma torre da obra
 * ANTERIOR, e a tela renderizava vazia ("nenhuma torre").
 *
 * Duas condições impedem que o redirecionamento atrapalhe:
 *
 * - `loading`: durante o boot a lista ainda está vazia e `found` seria falso para
 *   qualquer id, o que expulsaria da tela à toa.
 *
 * - `isFocused`: a troca de obra acontece no /perfil, com estas telas montadas
 *   mas EM SEGUNDO PLANO. Navegar a partir de uma tela sem foco tira o usuário
 *   do /perfil sem ele pedir e dispara "The action 'REPLACE' was not handled by
 *   any navigator" — o dispatch parte de um contexto de navegação inativo.
 *   Esperando o foco, a limpeza acontece quando (e se) a tela voltar à frente.
 */
export function useObraScopeGuard(found: boolean, fallback: string) {
  const { loading } = useObras();
  const isFocused = useIsFocused();
  const router = useRouter();

  useEffect(() => {
    if (loading || found || !isFocused) return;
    router.replace(fallback as never);
  }, [loading, found, isFocused, fallback, router]);
}
