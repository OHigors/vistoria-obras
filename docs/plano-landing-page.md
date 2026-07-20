# Plano de implementação — Landing page do aplicativo

> **Para o modelo executor:** este documento é a especificação completa de uma landing
> page de marketing para o produto `vistoria-obras` (app de vistoria e acompanhamento de
> obras, com intenção de virar SaaS). Siga as fases da seção 9. O site é um projeto
> **separado do app**, na pasta `site/` do repositório — nada do app Expo deve ser
> alterado. Não commite sem o usuário pedir. Verificação: `npm run build` e
> `npm run lint` dentro de `site/` (o `tsc`/`expo lint` da raiz não cobrem essa pasta).
>
> **Regra de honestidade (inegociável):** a página não pode conter depoimentos, logos de
> clientes, números de resultado ("+30% de produtividade") ou qualquer prova social
> inventada. O produto ainda não tem clientes públicos. Tudo que a página afirma deve
> ser um recurso real do app (seção 1.2) ou estar marcado como decisão pendente do
> usuário (seção 12).

---

## 1. Contexto

### 1.1 O produto

App móvel (React Native/Expo + Supabase) para engenheiros, mestres de obra e gestores
acompanharem obras residenciais verticais. Hierarquia: Obra → Torres → Pavimentos →
Apartamentos → Checklist de etapas. O checklist alimenta progresso, atrasos, medições
financeiras e relatórios. Roda em iOS, Android e web.

### 1.2 Recursos reais do app (a única fonte de claims permitidos)

| Recurso | Descrição honesta |
|---|---|
| **Corte da torre** | A torre desenhada em corte: cada pavimento é uma faixa colorida pelo avanço. Assinatura visual do produto — nenhum concorrente de planilha tem isso |
| Checklist de vistoria | Etapas por apartamento com 4 estados (pendente, parcial, concluída, não se aplica) e fotos como evidência |
| Cronograma Gantt | Planejado × Executado por frente de serviço e pavimento, com filtros por torre e categoria |
| Indicadores | Dashboard com progresso geral, etapas atrasadas, emergências, observações e focos de atenção |
| Medições financeiras | Registros por serviço: empreiteiro, quantidade, valor unitário e evidência |
| Relatórios | Exportação em CSV e PDF com filtros; Relatório Geral em tabela completa |
| Multiobra e papéis | Vários empreendimentos por usuário; permissões por papel (visualização, edição, administração) garantidas no banco (Supabase RLS) |

⚠️ NÃO afirmar: funcionamento offline (o app exige conexão; há cache, mas não é
offline-first), integrações com ERPs, número de usuários/obras atendidas.

### 1.3 Público e objetivo comercial

Construtoras de pequeno e médio porte, engenheiros residentes e mestres de obra no
Brasil. O produto ainda não tem preço público nem autosserviço de cadastro — o objetivo
da página v1 é **gerar contato qualificado** (demonstração), não venda direta.

### 1.4 Identidade visual existente (reutilizar, não reinventar)

- Fundo claro `#F8FAFC`, superfícies brancas com borda `#E2E8F0`, raio 16.
- Texto: slate `#0F172A` (títulos, peso 900), `#475569`/`#64748B` (corpo).
- Cores funcionais: azul de ação `#2563EB`, teal do cronograma `#0D9488`, verde
  `#047857`, âmbar `#B45309`, vermelho `#DC2626`, header escuro `#334155`.
- Sem dark mode no app → a landing é light-only (sem variante escura no v1).

---

## 2. Objetivo e critérios de sucesso

**Objetivo:** um gestor de obra que chega à página entende em 10 segundos o que o
produto faz e para quem é, e tem um único caminho claro de ação (pedir demonstração).

**Critérios verificáveis:**
1. Proposta de valor + CTA visíveis acima da dobra em um celular de 375 px.
2. Um único CTA primário repetido; zero formulários quebrados (v1 não tem backend de
   formulário — seção 12).
3. Lighthouse (mobile): Performance ≥ 95, Accessibility ≥ 95, SEO ≥ 95.
4. Nenhuma prova social inventada; nenhum claim fora da tabela 1.2.
5. `npm run build` e `npm run lint` limpos em `site/`.
6. Página 100% em pt-BR, responsiva de 320 px a 1440 px+.

---

## 3. Melhores práticas adotadas (e por quê)

1. **Um CTA, uma promessa.** Página de conversão com múltiplos CTAs concorrentes dilui a
   ação. Primário: "Agendar demonstração". Secundário (discreto): "Ver como funciona"
   (âncora para a seção de features).
2. **Mostrar o produto, não adjetivos.** O diferencial é visual (o Corte) — a página
   recria as telas em mockups HTML/CSS dentro de molduras de celular, em vez de fotos de
   banco de imagem ou screenshots que o executor não tem como capturar (não roda o app).
   Mockup recriado ≠ screenshot falso: é uma representação fiel e simplificada das telas
   reais descritas na seção 6.3, substituível por capturas reais depois.
3. **Benefício antes de recurso.** Cada seção abre com a dor/resultado e só então nomeia
   a funcionalidade.
4. **Prova social zero > prova social falsa.** No lugar de depoimentos: seção "Feito
   para" com os perfis de usuário reais.
5. **Estático e leve.** Página inteiramente pré-renderada, sem JS além do mínimo
   (menu móvel e âncoras) — LCP é o que decide se o mestre de obra no 4G espera.
6. **SEO honesto.** Metadados completos, OG image, JSON-LD, semântica HTML correta
   (um `h1`, hierarquia de headings).
7. **LGPD desde o início.** Link de política de privacidade (placeholder), sem cookies
   de rastreio no v1.
8. **Mobile-first.** O público decide no celular; desktop é a adaptação, não o
   contrário.

---

## 4. Decisões de arquitetura

| Decisão | Escolha | Por quê |
|---|---|---|
| Onde vive | `site/` na raiz do repo, projeto independente com `package.json` próprio | Não contamina o app Expo; deploy separado |
| Stack | Next.js (App Router, TypeScript) + Tailwind CSS | Estático por padrão, padrão de mercado, espaço para crescer (blog, preços) sem retrabalho |
| Dependências extras | Somente `lucide-react` (ícones) | Nada de bibliotecas de UI/animação; animações são CSS puro |
| Renderização | 100% estática (nenhum server component dinâmico, nenhuma API route) | Performance e simplicidade; não há backend no v1 |
| Deploy | Projeto próprio na Vercel com root directory `site/` | **Sem variáveis de ambiente.** Proibido adicionar qualquer chave do Supabase — a landing não fala com o banco |
| Configuração central | `site/lib/config.ts` com `SITE_NAME`, `CONTACT_EMAIL`, `WHATSAPP_URL`, `DEMO_CTA_URL` | Todos os placeholders pendentes do usuário (seção 12) num único arquivo |
| Fontes | `next/font` com Inter (ou system stack) | Zero CLS, sem request externo em runtime |

Estrutura de arquivos:

```
site/
  app/
    layout.tsx            ← metadados, fonte, lang="pt-BR"
    page.tsx              ← única página (compõe as seções)
    politica-de-privacidade/page.tsx  ← placeholder honesto
    sitemap.ts  robots.ts  opengraph-image.(png|tsx)
  components/
    Header.tsx  Hero.tsx  Problema.tsx  ComoFunciona.tsx
    Recursos.tsx  CorteDestaque.tsx  Relatorios.tsx  Seguranca.tsx
    FeitoPara.tsx  Faq.tsx  CtaFinal.tsx  Footer.tsx
    mockups/PhoneFrame.tsx  MockInicio.tsx  MockCorte.tsx  MockGantt.tsx
  lib/config.ts
```

---

## 5. Estrutura da página, seção por seção (copy final em pt-BR)

> O copy abaixo é final — implementar como está, trocando apenas `{SITE_NAME}` e os
> valores de `config.ts`. Onde houver ⚠️, a afirmação depende de confirmação do usuário.

### 5.1 Header (fixo, com fundo translúcido ao rolar)

- Logo/nome (`{SITE_NAME}`) à esquerda; à direita: links-âncora "Como funciona",
  "Recursos", "Perguntas" + botão primário **"Agendar demonstração"**.
- Mobile: menu hambúrguer (único JS da página, com `aria-expanded`).

### 5.2 Hero

- **H1:** `Vistorias, cronograma e medições da sua obra em um só lugar`
- **Sub:** `Substitua prancheta e planilha: checklist por apartamento com fotos, corte
  visual da torre, cronograma planejado × executado e relatórios em PDF — direto do
  canteiro.`
- CTA primário: **"Agendar demonstração"** (link de `config.ts`); secundário: "Ver como
  funciona ↓".
- Linha de suporte (pequena, abaixo dos CTAs): `iOS · Android · Web`
- Visual: `MockInicio` (dashboard) em `PhoneFrame`, levemente rotacionado, com o
  `MockCorte` espreitando atrás em telas ≥ 1024 px.

### 5.3 Problema (fundo `#334155`, texto claro — eco do header do app)

- **H2:** `A planilha não acompanha o ritmo do canteiro`
- 3 colunas (ícone + frase):
  1. `Vistoria no papel, digitação no escritório — duas vezes o mesmo trabalho.`
  2. `Sem foto junto da etapa, a discussão vira palavra contra palavra.`
  3. `O atraso só aparece quando já custou caro.`

### 5.4 Como funciona (3 passos numerados)

- **H2:** `Do cadastro ao relatório em três passos`

| # | Título | Texto |
|---|---|---|
| 1 | Monte a obra | Cadastre torres e pavimentos e defina o catálogo de serviços e etapas — uma vez só, vale para a obra inteira. |
| 2 | Vistorie no canteiro | Marque o estado de cada etapa por apartamento e anexe fotos na hora, pelo celular. |
| 3 | Acompanhe e comprove | Veja avanço, atrasos e medições em tempo real e gere relatórios em PDF ou CSV para quem precisar. |

### 5.5 Destaque de assinatura — o Corte (seção própria, a mais visual da página)

- **H2:** `Veja a torre como você desenha: em corte`
- **Texto:** `Cada pavimento é uma faixa colorida pelo avanço real do checklist. Um
  olhar e você sabe onde a obra anda — e onde ela parou.`
- Visual: `MockCorte` grande (não em moldura de celular no desktop): faixas empilhadas
  do térreo à cobertura, gradiente de cor por progresso, prumadas de escada/elevador ao
  lado, percentuais à direita. No mobile, dentro do `PhoneFrame`.

### 5.6 Recursos (grade de 6 cards — ícone, título, 1 frase)

- **H2:** `Tudo que a gestão da obra pede`

| Ícone (lucide) | Título | Frase |
|---|---|---|
| `ClipboardCheck` | Checklist com fotos | Quatro estados por etapa e evidência fotográfica no próprio item. |
| `GanttChart` | Planejado × Executado | Gantt por frente e pavimento, com filtros por torre e categoria. |
| `Gauge` | Indicadores ao vivo | Progresso geral, etapas atrasadas, emergências e focos de atenção. |
| `Ruler` | Medições financeiras | Quantidade, valor e empreiteiro por serviço, com evidência anexada. |
| `FileSpreadsheet` | Relatórios PDF e CSV | Do resumo executivo à tabela completa, com os filtros que você escolher. |
| `Building2` | Multiobra | Todas as suas obras num só login, com troca em um toque. |

### 5.7 Cronograma em evidência (imagem + texto lado a lado, invertido do 5.5)

- **H2:** `O prazo, preto no branco`
- **Texto:** `Toda etapa com data planejada entra no cronograma. Atrasou, aparece: no
  Gantt, nos indicadores e no alerta — antes de virar problema com o cliente.`
- Visual: `MockGantt` (barras cinza de previsto sobre barras coloridas de realizado,
  legenda Previsto / Em andamento / No prazo / Excedido).

### 5.8 Segurança e controle

- **H2:** `Cada um vê o que deve ver`
- **Texto:** `Permissões por papel — visualização, edição e administração — aplicadas
  no banco de dados, não só na tela. Cada usuário acessa apenas as obras liberadas para
  ele.`
- 3 bullets: `Papéis por obra` · `Regras aplicadas no servidor (RLS)` · `Login
  individual, sem senha compartilhada`

### 5.9 Feito para (substituto honesto de prova social)

- **H2:** `Feito para quem toca a obra`
- 3 cards: **Engenheiro residente** (`Números confiáveis sem caçar planilha.`),
  **Mestre de obras** (`Vistoria pelo celular, sem papel e sem retrabalho.`),
  **Gestor/incorporador** (`Visão de todas as obras e relatório pronto para reunião.`)

### 5.10 FAQ (acordeão nativo `<details>/<summary>` — sem JS)

| Pergunta | Resposta |
|---|---|
| Funciona em iPhone e Android? | Sim — e também no navegador, no escritório. |
| Preciso de internet no canteiro? | Sim, o app é conectado para que todos vejam a mesma obra em tempo real. A navegação usa cache para ser rápida mesmo em conexões fracas. |
| Meus dados ficam seguros? | Os dados ficam em banco gerenciado com permissões aplicadas no servidor. Cada usuário só acessa as obras liberadas para ele. |
| Quantas obras posso acompanhar? | Quantas precisar — a troca de obra ativa é feita em um toque, no perfil. ⚠️ CONFIRMAR se haverá limite por plano |
| Como começo? | Agende uma demonstração pelo botão abaixo — configuramos a primeira obra com você. ⚠️ CONFIRMAR promessa de setup assistido |

### 5.11 CTA final (fundo teal `#0D9488`, texto branco)

- **H2:** `Leve a obra para o bolso da equipe`
- **Texto:** `Agende uma demonstração e veja a sua obra dentro do app.`
- Botão branco: **"Agendar demonstração"**.

### 5.12 Footer

- `{SITE_NAME}` + 1 linha de descrição; links: Como funciona, Recursos, Perguntas,
  Política de Privacidade; contato (`CONTACT_EMAIL`); `© {ano} {SITE_NAME}`.
- **Sem** ícones de redes sociais que não existem.

### 5.13 Política de privacidade (`/politica-de-privacidade`)

Página placeholder honesta: título, parágrafo `Política em elaboração. Para dúvidas
sobre dados pessoais, escreva para {CONTACT_EMAIL}.` — nunca gerar um texto jurídico
fictício completo.

---

## 6. Especificação visual

### 6.1 Layout e tipografia

- Container máx. 1120 px; seções com `py` generoso (96 px desktop / 64 px mobile).
- H1 40–56 px peso 800–900; H2 28–36 px; corpo 16–18 px `#475569`, `line-height` 1.6.
- Fundo alternando `#FFFFFF` e `#F8FAFC` entre seções; exceções: 5.3 (`#334155`) e
  5.11 (`#0D9488`).
- Botão primário: fundo `#2563EB`, texto branco, raio 12, `hover` `#1D4ED8`, foco com
  `ring` visível.

### 6.2 Animações (CSS puro, discretas)

- Fade-in + translateY(12px) das seções ao entrar na viewport via
  `animation-timeline: view()` **com fallback**: conteúdo 100% visível sem a feature e
  sob `prefers-reduced-motion: reduce` (sem JS de scroll-observer se possível; se o
  suporte for insuficiente, um único `IntersectionObserver` de 10 linhas).

### 6.3 Mockups recriados (componentes `mockups/`)

Representações simplificadas e fiéis das telas reais — sem texto ilegível, sem dados
absurdos, valores plausíveis:

- **`PhoneFrame`:** moldura escura arredondada (raio ~40), notch discreto, sombra longa.
- **`MockInicio`:** header slate com avatar + "Bem-vindo"; card branco "Progresso geral
  da obra" com `68%` e barra; grade 2×2 de KPIs (Concluídas 24 · Atrasadas 3 ·
  Emergências 0 · Observações 7); card "Focos de atenção" com 1 linha.
- **`MockCorte`:** 8–10 faixas horizontais empilhadas (Cobertura → Térreo), cores do
  verde `#047857` (baixo, concluído) ao cinza claro (alto, não iniciado), rótulo e % por
  faixa, coluna fina de prumada ao lado.
- **`MockGantt`:** 4–5 linhas de frentes ("Alvenaria", "Reboco", "Contrapiso",
  "Pintura"), barra cinza (previsto) com barra colorida sobreposta (realizado), eixo de
  dias no topo, legenda de 4 itens.

Tudo em HTML/CSS (divs + Tailwind). Nada de `<canvas>`, nada de imagens raster para os
mockups. Quando o usuário fornecer screenshots reais, eles substituem os mocks nos
mesmos slots (`/public/screenshots/`).

---

## 7. SEO e metadados

- `layout.tsx`: `lang="pt-BR"`; `title`: `{SITE_NAME} — Vistorias, cronograma e
  medições de obra`; `description` (~150 chars): `App para construtoras: checklist de
  vistoria com fotos, corte visual da torre, cronograma planejado × executado e
  relatórios em PDF. iOS, Android e web.`
- Open Graph + Twitter card com `opengraph-image` (1200×630: fundo slate, nome do
  produto, H1 e um mini-mock do corte).
- JSON-LD `SoftwareApplication` (`applicationCategory: BusinessApplication`,
  `operatingSystem: iOS, Android, Web`) — **sem** `aggregateRating` (não existe).
- `sitemap.ts` (2 URLs) e `robots.ts` (allow all). Canônica na raiz.
- Heading hierarchy estrita: um único `h1` (hero), `h2` por seção.

---

## 8. Acessibilidade e performance (orçamentos)

- WCAG AA: contraste ≥ 4.5:1 (checar texto sobre teal e sobre slate), foco visível em
  todo interativo, `alt`/`aria-hidden` corretos nos mockups (decorativos →
  `aria-hidden="true"` com um `<p>` visually-hidden descrevendo a tela), navegação
  completa por teclado, `prefers-reduced-motion` respeitado.
- Orçamento: JS de cliente ≤ 30 kB gzip além do runtime do framework (só o menu móvel);
  zero fontes externas em runtime; zero imagens raster no v1 (mockups são CSS); LCP =
  texto do hero.
- Sem cookies, sem analytics no v1 (Vercel Analytics é v2, seção 11).

---

## 9. Plano de implementação em fases

> Ao fim de cada fase: `npm run build` e `npm run lint` dentro de `site/`, ambos limpos.
> Não commitar sem pedido do usuário.

**Fase 1 — Bootstrap.** Criar o projeto Next.js + Tailwind em `site/` (TypeScript, App
Router, sem `src/`), remover boilerplate, criar `lib/config.ts` com os placeholders e
`layout.tsx` com fonte, cores base e metadados da seção 7. Adicionar `site/README.md`
de 5 linhas (como rodar, onde configurar placeholders).

**Fase 2 — Esqueleto.** Todos os componentes de seção renderizando com o copy final da
seção 5 em layout simples (sem mockups ainda). Header fixo + menu móvel + âncoras
funcionando.

**Fase 3 — Mockups.** `PhoneFrame`, `MockInicio`, `MockCorte`, `MockGantt` conforme
6.3, integrados ao Hero, 5.5 e 5.7.

**Fase 4 — Polimento visual.** Espaçamentos, seções alternadas, animações de entrada
com fallback, estados de hover/foco, revisão responsiva 320/375/768/1024/1440.

**Fase 5 — SEO/A11y/Perf.** OG image, JSON-LD, sitemap/robots, passada de
acessibilidade (8), Lighthouse local (`npx lighthouse` ou build + inspeção manual dos
orçamentos).

**Fase 6 — Entrega.** Rodar o checklist da seção 10 e listar para o usuário: as
pendências da seção 12, e o passo de deploy (novo projeto Vercel com root `site/` —
**não** mexer no projeto Vercel existente do app).

---

## 10. Checklist de QA

- [ ] 375 px: H1 + sub + CTA visíveis sem rolar; nada corta nem estoura horizontal.
- [ ] Todos os CTAs apontam para os valores de `config.ts` (nenhum `href="#"` perdido).
- [ ] Âncoras do header rolam para a seção certa, com offset do header fixo.
- [ ] FAQ abre/fecha por teclado (é `<details>` nativo).
- [ ] Nenhum claim fora da tabela 1.2; nenhum ⚠️ resolvido por invenção.
- [ ] `prefers-reduced-motion`: página estática, tudo visível.
- [ ] OG image aparece no preview (checar com um validador de OG localmente).
- [ ] Build estático: nenhuma página dinâmica no output do `next build`.
- [ ] Zero variáveis de ambiente; nenhuma referência a Supabase no bundle.

---

## 11. Fora de escopo (v2 — não implementar agora)

- Formulário de contato/lista de espera com backend (v1 usa link direto de e-mail ou
  WhatsApp do `config.ts`).
- Página de preços (não há precificação definida).
- Blog/conteúdo SEO, versão em inglês, dark mode.
- Analytics (Vercel Analytics/umami) e pixels de marketing.
- Screenshots reais do app (substituem os mockups quando o usuário capturar).
- Vídeo de demonstração.

---

## 12. Decisões pendentes do usuário (o executor usa placeholder e lista no final)

| Pendência | Placeholder no v1 |
|---|---|
| **Nome/marca do produto** | `SITE_NAME = 'Vistoria de Obras'` em `config.ts` |
| Domínio | Deploy em `*.vercel.app` até haver domínio |
| Canal do CTA "Agendar demonstração" | `mailto:` para `CONTACT_EMAIL` (trocável por link de WhatsApp/Calendly em `config.ts`) |
| E-mail de contato | `CONTACT_EMAIL = 'contato@example.com'` — **trocar antes de publicar** |
| Logo | Wordmark tipográfico com o `SITE_NAME` (sem ícone inventado) |
| Claims marcados com ⚠️ (limite de obras, setup assistido) | Manter a versão neutra escrita na seção 5.10 até confirmação |
