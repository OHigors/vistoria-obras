# Plano de implementação — Tutorial de novos usuários (onboarding)

> **Para o modelo executor:** este documento é a especificação completa de um tutorial
> in-app para novos usuários do aplicativo `vistoria-obras`. Siga as fases na ordem da
> seção 9. Tudo que está em `código` refere-se a arquivos/símbolos reais do repositório —
> verifique cada âncora no código antes de usá-la (o app evolui; os pontos marcados com
> ⚠️ VERIFICAR exigem confirmação). Não commite nada sem o usuário pedir. Não rode o app
> (não há emulador neste ambiente); a verificação é `npx tsc --noEmit` (sem saída = ok)
> e `npx expo lint` (só são aceitáveis os warnings/erros pré-existentes).

---

## 1. Contexto do produto e do código

### 1.1 O que é o app

App móvel (React Native + Expo Router + Supabase) de **vistoria e acompanhamento de
obras** de edifícios residenciais. A hierarquia de dados é:

```
Obra → Torres → Níveis (pavimentos, térreo, áreas comuns) → Apartamentos → Checklist de etapas
```

O **checklist de etapas** de cada apartamento (ex.: "Contrapiso", "Gesso", "Pintura") é a
fonte de todos os números do app: progresso, atrasos, medições financeiras e relatórios.
Uma etapa "entra no cronograma" quando recebe data planejada (`isScheduledItem` em
`src/data/schedule.ts`).

### 1.2 Público-alvo do tutorial

Engenheiros, mestres de obra e gestores. Perfil não técnico em software: o tutorial deve
usar linguagem de canteiro, frases curtas e nunca pressupor familiaridade com apps de
gestão.

### 1.3 Mapa de navegação real (rotas do Expo Router)

| Tela | Rota | O que tem |
|---|---|---|
| Login | `app/login.tsx` | E-mail/senha via Supabase |
| **Início** (tab 1) | `app/(tabs)/index.tsx` | Header slate com avatar (→ Perfil), sino de alertas, engrenagem (→ Serviços e Etapas); hero "Progresso geral da obra"; card "Focos de atenção"; módulo com abas **Indicadores** (KPIs 2×2: Concluídas, Atrasadas, Emergências, Observações + faixa "Medido") e **Distribuição** (Status das unidades, Avanço das unidades, Progresso por torre); tocar num KPI abre modal de detalhe |
| **Visão Geral** (tab 2) | `app/(tabs)/visao-geral/index.tsx` | Cards de **Torres** (→ Corte), cards-ferramenta **Serviços e Etapas** e **Medições**, **Medições recentes**, **Relatórios** (Relatório Geral, Gerar Relatório) |
| Corte da torre | `app/(tabs)/visao-geral/corte/[torreId].tsx` | Desenho em corte: faixas por nível coloridas pelo avanço; nível vazio mostra "+" (criar etapas — só com permissão de escrita, senão cadeado); prumadas de escada/elevador; toque num nível → tela do nível |
| Lista de aptos da torre | `app/(tabs)/visao-geral/[torreId].tsx` | Apartamentos da torre com progresso/status |
| Nível | `app/(tabs)/visao-geral/nivel/[torreId]/[levelCode].tsx` | Etapas do pavimento/área, botão "Adicionar etapa" (gated por `canWrite`), `ReadOnlyBanner` para viewer |
| Apartamento | `app/(tabs)/visao-geral/apartamentos/[apartamentoId].tsx` (~2700 linhas) | 8 abas: `Resumo, Checklist, Em aberto, Fotos, Serviços, Cronograma, Medições, Histórico`; KPIs Em aberto/Travados/Fotos/Medições; estados de etapa (pendente/parcial/ok/não se aplica); datas planejadas/reais; medições com empreiteiro, quantidade, valor e evidência |
| **Cronograma** (tab 3) | `app/(tabs)/cronograma/index.tsx` | Hero teal "Cronograma da Obra" (→ Gantt), KPIs "Apt. atrasados" e "Etapas pendentes", "Principal etapa do Cronograma", seção de atrasos |
| Gantt da obra | `app/(tabs)/cronograma/obra.tsx` | Planejado × Executado por frente/pavimento, chips de torre, categorias, legenda (Previsto / Em andamento / No prazo / Excedido), "Adicionar tarefa ao cronograma" |
| Perfil | `app/(tabs)/perfil.tsx` (tab oculta, `href: null` — acessível pelo avatar do Início) | Dados do usuário, "Minhas obras" (troca de obra ativa, badge do papel), "Sair da conta" |

### 1.4 Papéis e permissões

`src/data/ObrasContext.tsx` expõe `role` (`viewer`/`editor`/`admin`/`owner` via
`user_obras`) e `canWrite`. O viewer vê `ReadOnlyBanner` e não vê botões de criação.
**O tutorial deve respeitar isso** (seção 7).

### 1.5 Convenções de código a seguir

- TypeScript estrito; componentes funcionais; `StyleSheet.create` no fim do arquivo.
- `Text` importado de `@/src/ui/Text` (nunca o do react-native).
- Ícones: `MaterialCommunityIcons` de `@expo/vector-icons`.
- Paleta: slate (`#0F172A`, `#334155`, `#64748B`, `#94A3B8`, bordas `#E2E8F0`, fundo
  `#F8FAFC`), azul de ação `#2563EB`, teal do cronograma `#0D9488`.
- Animações: `react-native-reanimated` (já é dependência — ver `src/ui/Skeleton.tsx`).
- Persistência local: `@react-native-async-storage/async-storage` (já usado em
  `src/data/AuthContext.tsx`, `src/data/ObrasContext.tsx`, `src/lib/supabase.ts`).
- Safe areas: `useSafeAreaInsets`.
- Acessibilidade: `accessibilityRole` e `accessibilityLabel` em todo Pressable (padrão já
  existente no repo).
- **Não adicionar nenhuma dependência nova** (nada de `react-native-copilot` etc. — o
  overlay é feito à mão, seção 6).
- Comentários em pt-BR, no estilo do repo: explicam o *porquê*, não o *o quê*.

---

## 2. Objetivo e critérios de sucesso

**Objetivo:** um usuário que nunca viu o app entende, em menos de 3 minutos, (a) como a
obra está organizada no app, (b) onde olhar cada informação e (c) como registrar uma
vistoria — sem precisar de treinamento humano.

**Critérios de sucesso (verificáveis em código/QA):**
1. O tutorial nunca bloqueia o uso: todo passo tem "Pular" e o app permanece navegável.
2. Cada tela mostra seus balões **uma única vez** (persistido); reinstalar/limpar dados
   reinicia.
3. Viewer nunca vê um passo que ensina a criar/editar.
4. Nenhum balão aparece sobre skeleton/estado de carregamento.
5. "Rever tutorial" no Perfil reinicia tudo.
6. `tsc` e `lint` limpos (exceto avisos pré-existentes documentados na seção 9.7).

---

## 3. Melhores práticas adotadas (e por quê)

1. **Onboarding progressivo, não frontal.** Um único tour gigante no primeiro uso tem
   retenção péssima; o usuário decora nada e pula tudo. Em vez disso: um carrossel de
   boas-vindas curto (orientação conceitual, 4 telas) + **coach marks contextuais** que
   aparecem na *primeira visita a cada tela* — ensina no momento em que a informação é
   útil.
2. **Uma ideia por balão.** Máximo de ~2 linhas (~120 caracteres) por balão; título de
   até 4 palavras; verbo no imperativo ("Toque", "Acompanhe", "Marque").
3. **Sempre pulável, nunca modal-obrigatório.** "Pular" visível em todos os passos;
   fechar o app no meio não pode travar nada na reabertura.
4. **Máximo 5 passos por tela.** Acima disso o usuário entra em modo "next-next-next".
5. **Mostrar onde, não só o quê.** Coach mark com *spotlight* (destaque visual do
   elemento real) em vez de screenshots ou desenhos.
6. **Respeitar o estado real.** Balão só ancora depois que `loading === false`; se o
   elemento não existir (obra sem torres, viewer sem botão), o passo é omitido ou vira
   card central sem spotlight.
7. **Reexecutável.** Botão "Rever tutorial" no Perfil — usuários voltam a procurar ajuda
   semanas depois.
8. **Versionado.** Chaves de persistência com versão (`v1`); mudou o tutorial de forma
   relevante, sobe a versão e todos veem o novo.
9. **Acessível.** Anúncio do texto do passo para leitores de tela, alvos de toque ≥ 44pt,
   contraste AA sobre o scrim, animações desligadas com "reduzir movimento".

---

## 4. Arquitetura da solução

### 4.1 Formato híbrido, 3 camadas

```
Camada 1 — Carrossel de boas-vindas (1× após o primeiro login)
   └─ 4 slides conceituais + CTA "Começar tour" / "Pular tudo"
Camada 2 — Coach marks contextuais (1× por tela, na primeira visita)
   └─ overlay com scrim escuro + spotlight no elemento + balão de texto
Camada 3 — Reentrada (permanente)
   └─ botão "Rever tutorial" no Perfil (limpa persistência e reinicia)
```

### 4.2 Novos arquivos (todos em `src/features/tutorial/`)

| Arquivo | Responsabilidade |
|---|---|
| `TutorialContext.tsx` | Provider + hooks. Estado: módulo ativo, passo atual, mapa de âncoras medidas. API: `useTutorial()`, `useTutorialScreen(module, { ready })`, `useTutorialAnchor(stepId)` |
| `CoachMarkOverlay.tsx` | O overlay visual (scrim + spotlight + balão + botões). Renderizado uma vez, dentro do layout das tabs |
| `WelcomeCarousel.tsx` | Modal de boas-vindas (carrossel paginado, dots, CTA) |
| `steps.ts` | **Definição declarativa** de todos os módulos e passos (ids, título, texto, condição `requiresWrite`, ordem) — todo o copy da seção 5 mora aqui |
| `storage.ts` | Leitura/gravação AsyncStorage: `getTutorialState`, `markModuleDone`, `resetTutorial`, `skipAll` |

Arquivos alterados: `app/(tabs)/_layout.tsx` (monta o Provider + Overlay + Carousel),
as 8 telas da seção 5 (registram âncoras) e `app/(tabs)/perfil.tsx` (botão "Rever
tutorial").

### 4.3 Persistência

- Chaves: `@tutorial:v1:welcome`, `@tutorial:v1:inicio`, `@tutorial:v1:visao-geral`,
  `@tutorial:v1:corte`, `@tutorial:v1:nivel`, `@tutorial:v1:apartamento`,
  `@tutorial:v1:cronograma`, `@tutorial:v1:gantt`, `@tutorial:v1:perfil`.
- Valor: `'done'` (concluído ou pulado). Não persistir passo intermediário: módulos são
  curtos; interrompeu, recomeça o módulo daquela tela — comportamento previsível.
- "Pular tudo" grava todas as chaves de uma vez.
- Escopo por aparelho (AsyncStorage). Sincronizar por usuário via coluna no Supabase é
  **v2** (seção 11) — não fazer agora.

### 4.4 Gatilhos

1. **Boas-vindas:** ao montar as tabs com sessão autenticada, se `welcome` não está
   `done` → abre `WelcomeCarousel` (Modal). "Começar tour" fecha e deixa os coach marks
   da tela Início dispararem; "Pular tudo" chama `skipAll()`.
2. **Coach marks:** cada tela chama `useTutorialScreen('<module>', { ready })` onde
   `ready` é o "carregou de verdade" da tela (ex.: `!loading` no Início; `!busy` no
   Cronograma). O hook: se módulo não está `done` **e** `ready` **e** nenhum outro módulo
   está ativo → espera ~400 ms (layout assentar) e ativa o passo 1.
3. Só **um** módulo ativo por vez; navegar para outra tela no meio de um módulo cancela
   o módulo **sem** marcá-lo como `done` (volta a oferecer na próxima visita).

### 4.5 Âncoras e spotlight (sem dependência nova)

- `useTutorialAnchor(stepId)` devolve um `ref` + `onLayout`; no momento em que o passo
  ativa, o provider chama `measureInWindow` no ref e guarda `{x, y, width, height}`.
- O overlay **não recorta um buraco de verdade**: desenha 4 retângulos escuros
  (`rgba(15,23,42,0.72)`) ao redor do alvo + uma borda arredondada de destaque
  (`borderColor: '#FFFFFF'`, `borderWidth: 2`, `borderRadius: 14`, padding 6) sobre o
  alvo. É simples, sem MaskedView, e funciona em iOS/Android/web.
- Balão posicionado abaixo do alvo se houver espaço (alvo no terço superior), senão
  acima; nunca sobre o alvo; sempre dentro das safe areas.
- **Fallback obrigatório:** se o alvo não foi medido em até 1 s, ou está fora da
  viewport (elemento abaixo da dobra em telas com scroll), o passo renderiza como **card
  central** com o mesmo texto, sem spotlight. Não implementar auto-scroll no v1 — é a
  maior fonte de bugs de bibliotecas de tour.
- O toque no scrim não "vaza" para a tela (overlay captura tudo); avançar é só pelos
  botões do balão.

### 4.6 Anatomia do balão (copy fixa dos controles)

```
[ Título — até 4 palavras ]
[ Texto — até 2 linhas ]
[ ● ○ ○ ○  "2 de 4" ]      [ Pular tour ]   [ Entendi → ]  (último passo: "Concluir ✓")
```

- "Entendi" avança; no último passo "Concluir" marca o módulo `done`.
- "Pular tour" marca **o módulo atual** como `done` (não o tutorial inteiro — pular tudo
  só existe no carrossel de boas-vindas).

---

## 5. Roteiro completo (conteúdo didático — copy final em pt-BR)

> Regras de copy: tom direto e cordial, vocabulário de obra, zero jargão de software
> ("toque" e não "clique"; "balão" e não "tooltip"). Os textos abaixo são finais — o
> executor não deve reescrevê-los, apenas ajustar se uma âncora não existir.

### 5.0 Carrossel de boas-vindas — módulo `welcome` (4 slides)

| # | Ícone | Título | Texto |
|---|---|---|---|
| 1 | `office-building` | Bem-vindo! | Acompanhe o avanço da sua obra, do canteiro ao relatório, direto do celular. |
| 2 | `file-tree` | Como a obra se organiza | Obra → Torres → Pavimentos → Apartamentos. Cada apartamento tem um checklist de etapas — é ele que alimenta todos os números do app. |
| 3 | `view-dashboard-outline` | Três abas, três perguntas | **Início:** como está a obra hoje? **Visão Geral:** onde está cada coisa? **Cronograma:** estamos no prazo? |
| 4 | `account-check-outline` | Seu acesso | (com escrita) "Você pode registrar vistorias, etapas e medições. Vamos fazer um tour rápido?" / (viewer) "Seu acesso é de visualização: você vê tudo, sem editar. Vamos fazer um tour rápido?" |

Botões do slide 4: **"Começar tour"** (primário) e **"Pular tudo"** (texto discreto).
Slides 1–3 têm "Pular tudo" pequeno no topo e dots de paginação.

### 5.1 Módulo `inicio` — tab Início (5 passos)

`ready`: `!loading` do `useObras()`.

| # | Âncora (elemento real) | Título | Texto |
|---|---|---|---|
| 1 | Hero "Progresso geral da obra" | O pulso da obra | Este número é a média de conclusão de todas as unidades. A barra e a cor acompanham o avanço. |
| 2 | Card "Focos de atenção" | O que exige ação | Aqui aparecem a etapa mais atrasada, o serviço mais pendente e a torre mais impactada — direto ao ponto. |
| 3 | Segmented "Indicadores / Distribuição" | Dois jeitos de ver | **Indicadores** resume em cartões; **Distribuição** mostra os mesmos dados por faixa de avanço e por torre. |
| 4 | Um card de KPI (ex.: "Atrasadas") | Toque para detalhar | Todo indicador abre uma lista mostrando exatamente onde cada item está: torre, apartamento e data. |
| 5 | Sino de alertas (header) | Alertas num só lugar | O sino reúne etapas vencidas e gargalos. O número vermelho é a quantidade de etapas atrasadas. |

### 5.2 Módulo `visao-geral` — tab Visão Geral (4 passos)

`ready`: `!loading`.

| # | Âncora | Título | Texto |
|---|---|---|---|
| 1 | Primeiro card de torre | Suas torres | Cada card mostra o avanço médio e os alertas da torre. Toque para abrir o corte da torre. |
| 2 | Card "Serviços e Etapas" | O catálogo da obra | Configure aqui quais serviços e etapas existem no checklist, no cronograma e nas medições. |
| 3 | Card "Medições" | O lado financeiro | Registros de medição por serviço: empreiteiro, quantidade e valor. As recentes aparecem logo abaixo. |
| 4 | Seção "Relatórios" | Da obra para o papel | Gere relatórios em CSV ou PDF com filtros, ou abra a tabela completa no Relatório Geral. |

*Se a obra não tem torres (obra recém-criada), o passo 1 vira card central com o texto:
"Quando as torres da obra forem cadastradas, elas aparecem aqui como cards — toque em
uma para ver o corte."*

### 5.3 Módulo `corte` — Corte da torre (4 passos)

`ready`: itens carregados (skeleton do corte encerrado).

| # | Âncora | Título | Texto |
|---|---|---|---|
| 1 | Área do desenho do corte | A torre em corte | Cada faixa é um pavimento ou área da torre. A cor mostra o avanço: quanto mais verde, mais concluído. |
| 2 | Uma faixa de nível **com** etapas | Entre no pavimento | Toque em um pavimento para ver as etapas dele e os apartamentos do andar. |
| 3 | Uma faixa **vazia** (ghost, "+") — **só se `canWrite`** | Pavimento sem etapas | O "+" indica um nível ainda sem etapas. Toque para criar as primeiras etapas dele. |
| 4 | Prumadas (escada/elevador) ⚠️ VERIFICAR âncora em `renderSegmentStrip` | Áreas de prumada | Escadas e elevadores têm etapas próprias, acompanhadas por trecho. |

*Para viewer, o passo 3 é omitido (faixas vazias aparecem com cadeado — comportamento já
implementado).*

### 5.4 Módulo `nivel` — tela do nível (3 passos)

`ready`: `!loading` da tela.

| # | Âncora | Título | Texto |
|---|---|---|---|
| 1 | Lista de etapas do nível | Etapas do pavimento | Estas são as etapas deste nível. O estado de cada uma alimenta o corte e os indicadores. |
| 2 | Botão "Adicionar etapa" — **só se `canWrite`** | Crie etapas aqui | Adicione etapas do catálogo a este pavimento. Elas nascem pendentes, prontas para a vistoria. |
| 3 | Acesso a um apartamento do andar ⚠️ VERIFICAR se esta tela lista apartamentos; se não listar, omitir o passo | Abra um apartamento | Toque em um apartamento para vistoriar o checklist dele em detalhe. |

### 5.5 Módulo `apartamento` — tela do apartamento (5 passos)

`ready`: checklist carregado. É a tela mais densa do app (8 abas) — o tutorial cobre só
o essencial e **não** troca de aba sozinho.

| # | Âncora | Título | Texto |
|---|---|---|---|
| 1 | Linha de KPIs (Em aberto / Travados / Fotos / Medições) | Raio-x da unidade | Em aberto, etapas travadas por dependência, fotos e medições — o resumo do apartamento num relance. |
| 2 | Barra de abas (`Resumo … Histórico`) | Oito visões | Deslize as abas: checklist, pendências, fotos, cronograma, medições e o histórico de tudo que foi feito. |
| 3 | Primeiro item do checklist (aba Checklist) | Marque a vistoria | Cada etapa tem estado: pendente, parcial, concluída ou não se aplica. É isso que move o progresso da obra. *(viewer: "Cada etapa tem estado: pendente, parcial, concluída ou não se aplica. Você acompanha; a edição fica com a equipe.")* |
| 4 | Aba/área "Fotos" | Prova visual | Registre fotos por etapa. Elas entram no histórico e podem ir para o relatório. |
| 5 | Aba "Cronograma" | Datas da unidade | Defina início e término planejados por etapa. Com datas, a etapa entra no Cronograma da Obra e nos alertas de atraso. |

*Passos 3–5 ancoram em elementos que podem estar em outra aba/abaixo da dobra → usarão
com frequência o fallback de card central (seção 4.5). Isso é aceitável e esperado.*

### 5.6 Módulo `cronograma` — tab Cronograma (3 passos)

`ready`: `!busy` (contexto + `loadingSchedule`).

| # | Âncora | Título | Texto |
|---|---|---|---|
| 1 | Hero teal "Cronograma da Obra" | Planejado × Executado | Toque para abrir o cronograma completo: cada frente e pavimento com barras de previsto e realizado. |
| 2 | Par de KPIs (Apt. atrasados / Etapas pendentes) | Prazo em números | Apartamentos com etapas vencidas e etapas planejadas ainda não concluídas. Zero aqui é obra em dia. |
| 3 | Card "Principal etapa do Cronograma" | A etapa do momento | A etapa planejada em mais apartamentos — normalmente a frente de trabalho principal da obra agora. |

### 5.7 Módulo `gantt` — Cronograma da Obra (3 passos)

`ready`: `result` calculado (fora do estado "Carregando dados da obra…").

| # | Âncora | Título | Texto |
|---|---|---|---|
| 1 | Legenda (Previsto / Em andamento / No prazo / Excedido) | Leia as cores | Cinza é o previsto; as barras coloridas são o realizado — verde no prazo, vermelho excedido. |
| 2 | Chips de torre / categorias | Filtre a visão | Escolha a torre e a frente de serviço para enxergar só o que interessa agora. |
| 3 | Botão "Adicionar tarefa ao cronograma" — **só se `canWrite`** | Planeje uma tarefa | Crie tarefas com datas por pavimento ou apartamento. Elas passam a contar nos alertas de prazo. |

### 5.8 Módulo `perfil` — Perfil (2 passos)

| # | Âncora | Título | Texto |
|---|---|---|---|
| 1 | Seção "Minhas obras" | Troque de obra | Todas as obras do seu usuário ficam aqui. Toque em uma para torná-la ativa — o app inteiro passa a mostrá-la. |
| 2 | Badge de papel (viewer/editor/…) | Seu papel | O selo mostra o que você pode fazer em cada obra: visualizar, editar ou administrar. |

---

## 6. Especificação técnica dos componentes

### 6.1 `steps.ts` — definição declarativa

```ts
export type TutorialStep = {
  id: string;               // 'inicio.hero', 'corte.ghost', …
  title: string;
  text: string;
  textViewer?: string;      // variação para viewer (passo 5.5#3)
  requiresWrite?: boolean;  // true ⇒ omitido quando !canWrite
};
export type TutorialModule = {
  id: 'welcome' | 'inicio' | 'visao-geral' | 'corte' | 'nivel'
    | 'apartamento' | 'cronograma' | 'gantt' | 'perfil';
  steps: TutorialStep[];
};
export const TUTORIAL_VERSION = 1; // muda ⇒ novas chaves ⇒ todos reveem
```

Todo o copy da seção 5 vive aqui, nunca inline nas telas.

### 6.2 `TutorialContext.tsx`

- Estado: `{ activeModule, stepIndex, anchors: Map<stepId, Rect>, hydrated }`.
- `useTutorialScreen(moduleId, { ready })`: registra a tela; efeito dispara o módulo
  segundo a seção 4.4. Deve usar `useFocusEffect` — telas ficam montadas em background
  no Expo Router e o módulo só pode ativar na tela **focada**. Cleanup do focus effect
  cancela o módulo ativo se for o desta tela (sem marcar `done`).
- `useTutorialAnchor(stepId)`: devolve `{ ref, onLayout }`; medição via
  `measureInWindow` quando o passo ativa (e re-medição no `onLayout`).
- Filtra passos por `requiresWrite`/`canWrite` (lê `useObras()`) **antes** de contar
  "N de M" — o usuário nunca vê numeração pulando.
- `advance()`, `skipModule()`, `completeModule()` (grava `done`), `resetAll()`.

### 6.3 `CoachMarkOverlay.tsx`

- Renderizado no `_layout.tsx` das tabs (irmão do `<Tabs>`), `pointerEvents` ativo só
  quando há módulo ativo; `position: absolute` cobrindo tudo.
- Scrim + spotlight + balão conforme seção 4.5/4.6. Animação: fade-in do scrim (200 ms)
  e um pulso sutil na borda do spotlight via reanimated; **checar
  `AccessibilityInfo.isReduceMotionEnabled()`** e, se verdadeiro, não pulsar.
- Acessibilidade: `accessibilityViewIsModal`, `AccessibilityInfo.announceForAccessibility`
  com "título. texto" a cada passo; botões com `accessibilityRole="button"`; alvo de
  toque mínimo 44 pt; back do Android = "Pular tour".

### 6.4 `WelcomeCarousel.tsx`

- `Modal` transparente com card central (mesmo padrão visual dos modais do Início:
  backdrop `rgba(0,0,0,0.5)`, card branco `borderRadius: 24`).
- Paginação por `ScrollView` horizontal com `pagingEnabled` + dots.
- Ícone grande (56) em círculo com fundo suave, título `fontSize: 20 / '900'`, texto
  `fontSize: 14 / lineHeight: 21 / '#475569'`.

### 6.5 `storage.ts`

- Envolve AsyncStorage com try/catch silencioso (padrão do repo): falha de storage nunca
  pode quebrar o app — na dúvida, trata como "não visto".
- `multiGet`/`multiSet` para hidratar tudo de uma vez no boot do provider.

---

## 7. Regras por papel

| Situação | Comportamento |
|---|---|
| `canWrite === true` | Tutorial completo |
| viewer (`role === 'viewer'`) | Slide 4 do welcome usa o texto de visualização; passos com `requiresWrite` são omitidos; passo 5.5#3 usa `textViewer` |
| `role === null` (ainda resolvendo) | O welcome pode abrir (não depende de papel até o slide 4 — segurar o slide 4 até `role` resolver ou usar o texto de escrita, já que `canWrite` default é true). Coach marks com `requiresWrite` só disparam com papel resolvido: incluir `role !== null` no `ready` dos módulos que têm passos de escrita |
| Obra sem torres/dados | Passos com âncora inexistente caem no fallback de card central com copy adaptada (5.2#1) ou são omitidos |

---

## 8. Casos de borda (tratar todos)

1. **Fechar o app no meio de um módulo** → módulo não marcado `done`; reabre na próxima
   visita à tela. Welcome idem.
2. **Trocar de obra no Perfil** → tutorial não reseta (o aprendizado é do app, não da
   obra). O módulo ativo é cancelado pela navegação, como sempre.
3. **Logout/login de outro usuário no mesmo aparelho** → v1 aceita que o estado é por
   aparelho (documentar no código). Não fazer chave por usuário agora.
4. **Elemento âncora some entre a medição e o render** (ex.: lista atualizou) → overlay
   re-mede no próximo frame; se falhar, fallback de card central.
5. **Rotação/resize (web)** → re-medir âncora do passo atual em `onLayout`.
6. **Duas telas disparando ao mesmo tempo** (tabs pré-montadas) → impossível por
   construção: `useFocusEffect` + trava de "um módulo ativo".
7. **Skeleton demorando** → `ready` falso segura o módulo; sem timeout artificial.
8. **Back do Android durante coach mark** → fecha como "Pular tour" (do módulo).
9. **Usuário navega pelo elemento destacado?** Não — o scrim bloqueia; a ação real é
   sugerida no texto e fica disponível ao concluir. (Tour "faça você mesmo" é v2.)

---

## 9. Plano de implementação em fases

> Ao fim de **cada** fase: `npx tsc --noEmit` (sem saída) e `npx expo lint` (sem novos
> avisos além dos pré-existentes da seção 9.7). Não commitar sem pedido do usuário.

**Fase 1 — Infraestrutura.** Criar `src/features/tutorial/` com `storage.ts`,
`steps.ts` (módulos e copy completos da seção 5), `TutorialContext.tsx`,
`CoachMarkOverlay.tsx` (sem consumidores ainda). Montar Provider + Overlay em
`app/(tabs)/_layout.tsx` (dentro de `ObrasProvider`, que fornece `canWrite`).

**Fase 2 — Boas-vindas.** `WelcomeCarousel.tsx` + gatilho no `_layout.tsx` (seção 4.4),
persistência e "Pular tudo".

**Fase 3 — Início e Visão Geral.** Âncoras nos elementos das seções 5.1 e 5.2 (envolver
os alvos com o ref/onLayout de `useTutorialAnchor`; mudanças mínimas de JSX, zero
mudança de comportamento). `ready` amarrado aos `loading` reais.

**Fase 4 — Corte, Nível e Apartamento.** Seções 5.3–5.5. Atenção: o arquivo do
apartamento tem ~2700 linhas — localizar âncoras por busca (`detailTabs`, linha de KPIs
~1210, `activeTab === 'Checklist'` ~1355) e tocar o mínimo. Verificar os ⚠️ das seções
5.3/5.4 e ajustar o roteiro (omitir passo sem âncora, nunca inventar âncora).

**Fase 5 — Cronograma e Gantt.** Seções 5.6–5.7. No Gantt, `ready` = fora do estado
"Carregando dados da obra…"; passo 3 respeita `requiresWrite`.

**Fase 6 — Perfil e reentrada.** Seção 5.8 + botão "Rever tutorial" no Perfil (acima de
"Sair da conta", estilo discreto de linha com ícone `replay`): chama `resetAll()`, mostra
o carrossel de novo na volta ao Início.

**Fase 7 — QA final.** Rodar o checklist da seção 10; revisar copy renderizada (quebras
de linha, truncamentos com `numberOfLines`); conferir a seção 8 caso a caso no código.

### 9.7 Avisos pré-existentes de lint (não introduzidos por este trabalho)

`react/no-unescaped-entities` em `catalogos.tsx` (484, 583) e `servicos-etapas.tsx`
(94); vars não usadas em `schedule.ts`/`serviceBlockers.ts` (`getStorageKey`) e imports
não usados em `corte/[torreId].tsx:16`. Qualquer aviso **novo** deve ser corrigido.

---

## 10. Checklist de QA manual (para o usuário executar no aparelho)

- [ ] Primeiro login → carrossel aparece; "Pular tudo" nunca mais mostra nada.
- [ ] "Começar tour" → coach marks do Início, na ordem, com "N de M" correto.
- [ ] Cada tela mostra o tour uma única vez; matar o app no meio → tour da tela volta.
- [ ] Viewer: sem passos de criação; textos de visualização nos pontos previstos.
- [ ] Nenhum balão sobre skeleton; nenhum balão fora da tela; fallback central funciona
      (testar no apartamento, passos 3–5).
- [ ] Scrim bloqueia toques por baixo; back do Android fecha como "Pular".
- [ ] TalkBack/VoiceOver anuncia título+texto a cada passo.
- [ ] "Rever tutorial" no Perfil reinicia tudo (carrossel + todas as telas).
- [ ] Trocar de obra não reseta e não dispara tour repetido.

---

## 11. Fora de escopo (v2 — não implementar agora)

- Sincronizar estado do tutorial por usuário no Supabase (coluna em `profiles`).
- Métricas/analytics de conclusão e abandono por passo.
- Tour "mão na massa" (usuário executa a ação real dentro do tour).
- Auto-scroll até âncoras abaixo da dobra.
- Checklist de primeiros passos para obra vazia ("Cadastre torres → catálogo → datas").
- Vídeos/GIFs e central de ajuda com busca.
