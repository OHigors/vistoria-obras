// Definição declarativa do tutorial: módulos, passos e TODO o copy num só lugar.
// As telas apenas ancoram os passos (useTutorialAnchor); mudar o roteiro é mudar
// este arquivo. Subir TUTORIAL_VERSION invalida o progresso salvo de todo mundo —
// use quando o tutorial mudar de forma relevante.

export const TUTORIAL_VERSION = 1;

export type TutorialModuleId =
  | 'welcome'
  | 'inicio'
  | 'visao-geral'
  | 'corte'
  | 'nivel'
  | 'apartamento'
  | 'cronograma'
  | 'gantt'
  | 'perfil';

export type CoachModuleId = Exclude<TutorialModuleId, 'welcome'>;

export const ALL_MODULE_IDS: TutorialModuleId[] = [
  'welcome',
  'inicio',
  'visao-geral',
  'corte',
  'nivel',
  'apartamento',
  'cronograma',
  'gantt',
  'perfil',
];

/** Nome da tela no balão do tutorial — situa o usuário durante o tour. */
export const MODULE_LABELS: Record<CoachModuleId, string> = {
  inicio: 'Início',
  'visao-geral': 'Visão Geral',
  corte: 'Corte da torre',
  nivel: 'Nível da torre',
  apartamento: 'Apartamento',
  cronograma: 'Cronograma',
  gantt: 'Cronograma da Obra',
  perfil: 'Perfil',
};

export type TutorialStep = {
  id: string;
  title: string;
  text: string;
  /** Variação exibida para quem não tem permissão de escrita. */
  textViewer?: string;
  /** Texto usado quando o passo cai no card central por falta de âncora. */
  textFallback?: string;
  /** Passo omitido quando o usuário não pode escrever. */
  requiresWrite?: boolean;
};

export type WelcomeSlide = {
  icon: string;
  title: string;
  text: string;
  textViewer?: string;
};

export const WELCOME_SLIDES: WelcomeSlide[] = [
  {
    icon: 'office-building',
    title: 'Bem-vindo!',
    text: 'Acompanhe o avanço da sua obra, do canteiro ao relatório, direto do celular.',
  },
  {
    icon: 'file-tree',
    title: 'Como a obra se organiza',
    text: 'Obra → Torres → Pavimentos → Apartamentos. Cada apartamento tem um checklist de etapas — é ele que alimenta todos os números do app.',
  },
  {
    icon: 'view-dashboard-outline',
    title: 'Três abas, três perguntas',
    text: 'Início: como está a obra hoje?\nVisão Geral: onde está cada coisa?\nCronograma: estamos no prazo?',
  },
  {
    icon: 'account-check-outline',
    title: 'Seu acesso',
    text: 'Você pode registrar vistorias, etapas e medições. Vamos fazer um tour rápido?',
    textViewer: 'Seu acesso é de visualização: você vê tudo, sem editar. Vamos fazer um tour rápido?',
  },
];

export const COACH_MODULES: Record<CoachModuleId, TutorialStep[]> = {
  inicio: [
    {
      id: 'inicio.hero',
      title: 'O pulso da obra',
      text: 'Este número é a média de conclusão de todas as unidades. A barra e a cor acompanham o avanço.',
    },
    {
      id: 'inicio.focos',
      title: 'O que exige ação',
      text: 'Aqui aparecem a etapa mais atrasada, o serviço mais pendente e a torre mais impactada — direto ao ponto.',
    },
    {
      id: 'inicio.abas',
      title: 'Dois jeitos de ver',
      text: 'Indicadores resume em cartões; Distribuição mostra os mesmos dados por faixa de avanço e por torre.',
    },
    {
      id: 'inicio.kpis',
      title: 'Toque para detalhar',
      text: 'Todo indicador abre uma lista mostrando exatamente onde cada item está: torre, apartamento e data.',
    },
    {
      id: 'inicio.sino',
      title: 'Alertas num só lugar',
      text: 'O sino reúne etapas vencidas e gargalos. O número vermelho é a quantidade de etapas atrasadas.',
    },
  ],

  'visao-geral': [
    {
      id: 'vg.torres',
      title: 'Suas torres',
      text: 'Cada card mostra o avanço médio e os alertas da torre. Toque para abrir o corte da torre.',
      textFallback:
        'Quando as torres da obra forem cadastradas, elas aparecem aqui como cards — toque em uma para ver o corte.',
    },
    {
      id: 'vg.servicos',
      title: 'O catálogo da obra',
      text: 'Configure aqui quais serviços e etapas existem no checklist, no cronograma e nas medições.',
    },
    {
      id: 'vg.medicoes',
      title: 'O lado financeiro',
      text: 'Registros de medição por serviço: empreiteiro, quantidade e valor. As recentes aparecem logo abaixo.',
    },
    {
      id: 'vg.relatorios',
      title: 'Da obra para o papel',
      text: 'Gere relatórios em CSV ou PDF com filtros, ou abra a tabela completa no Relatório Geral.',
    },
  ],

  corte: [
    {
      id: 'corte.legenda',
      title: 'A torre em corte',
      text: 'Cada faixa é um pavimento ou área da torre. A cor mostra o avanço: quanto mais verde, mais concluído.',
    },
    {
      id: 'corte.pavimento',
      title: 'Entre no pavimento',
      text: 'Toque em um pavimento para abrir os apartamentos do andar e vistoriar cada unidade.',
    },
    {
      id: 'corte.ghost',
      title: 'Nível sem etapas',
      text: 'O "+" indica um nível ainda sem etapas. Toque para criar as primeiras etapas dele.',
      requiresWrite: true,
    },
    {
      id: 'corte.prumada',
      title: 'Áreas de prumada',
      text: 'Escadas e elevadores têm etapas próprias, acompanhadas por trecho em cada pavimento.',
    },
  ],

  nivel: [
    {
      id: 'nivel.etapas',
      title: 'Etapas do pavimento',
      text: 'Estas são as etapas deste nível. O estado de cada uma alimenta o corte e os indicadores.',
    },
    {
      id: 'nivel.add',
      title: 'Crie etapas aqui',
      text: 'Adicione etapas do catálogo a este pavimento. Elas nascem pendentes, prontas para a vistoria.',
      textFallback:
        'Na aba Checklist, o botão "Adicionar etapa" traz etapas do catálogo para este pavimento. Elas nascem pendentes, prontas para a vistoria.',
      requiresWrite: true,
    },
  ],

  apartamento: [
    {
      id: 'apto.kpis',
      title: 'Raio-x da unidade',
      text: 'Em aberto, etapas travadas por dependência, fotos e medições — o resumo do apartamento num relance.',
    },
    {
      id: 'apto.abas',
      title: 'Oito visões',
      text: 'Deslize as abas: checklist, pendências, fotos, cronograma, medições e o histórico de tudo que foi feito.',
    },
    {
      id: 'apto.checklist',
      title: 'Marque a vistoria',
      text: 'Cada etapa tem estado: pendente, parcial, concluída ou não se aplica. É isso que move o progresso da obra.',
      textViewer:
        'Cada etapa tem estado: pendente, parcial, concluída ou não se aplica. Você acompanha; a edição fica com a equipe.',
      textFallback:
        'Na aba Checklist, cada etapa tem estado: pendente, parcial, concluída ou não se aplica. É isso que move o progresso da obra.',
    },
    {
      id: 'apto.fotos',
      title: 'Prova visual',
      text: 'Registre fotos por etapa. Elas entram no histórico e podem ir para o relatório.',
    },
    {
      id: 'apto.cronograma',
      title: 'Datas da unidade',
      text: 'Defina início e término planejados por etapa. Com datas, a etapa entra no Cronograma da Obra e nos alertas de atraso.',
    },
  ],

  cronograma: [
    {
      id: 'cron.hero',
      title: 'Planejado × Executado',
      text: 'Toque para abrir o cronograma completo: cada frente e pavimento com barras de previsto e realizado.',
    },
    {
      id: 'cron.kpis',
      title: 'Prazo em números',
      text: 'Apartamentos com etapas vencidas e etapas planejadas ainda não concluídas. Zero aqui é obra em dia.',
    },
    {
      id: 'cron.topstep',
      title: 'A etapa do momento',
      text: 'A etapa planejada em mais apartamentos — normalmente a frente de trabalho principal da obra agora.',
    },
  ],

  gantt: [
    {
      id: 'gantt.legenda',
      title: 'Leia as cores',
      text: 'Azul é o previsto; as barras coloridas são o realizado — verde no prazo, vermelho excedido.',
    },
    {
      id: 'gantt.filtros',
      title: 'Filtre a visão',
      text: 'Escolha a torre e alterne entre pavimento e etapa para enxergar só o que interessa agora.',
    },
    {
      id: 'gantt.add',
      title: 'Planeje uma tarefa',
      text: 'Crie tarefas com datas por pavimento ou apartamento. Elas passam a contar nos alertas de prazo.',
      requiresWrite: true,
    },
  ],

  perfil: [
    {
      id: 'perfil.obras',
      title: 'Troque de obra',
      text: 'Todas as obras do seu usuário ficam aqui. Toque em uma para torná-la ativa — o app inteiro passa a mostrá-la.',
    },
    {
      id: 'perfil.papel',
      title: 'Seu papel',
      text: 'O selo mostra o que você pode fazer em cada obra: visualizar, editar ou administrar.',
    },
  ],
};
