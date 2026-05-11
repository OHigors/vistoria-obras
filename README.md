# Vistoria Obras

MVP web/mobile-first para vistoria, checklist, cronograma, medição local e relatórios de uma obra residencial. O protótipo usa dados mockados do Residencial Cagliari e persistência local no navegador via `localStorage`.

## Objetivo

Permitir testar em campo um fluxo inicial de acompanhamento de apartamentos:

- dashboard da obra;
- seleção de torres e apartamentos;
- checklist de vistoria por etapa;
- fotos locais por item;
- histórico de visitas;
- serviços travados por dependência;
- cronograma planejado x realizado;
- pré-medição técnica;
- relatórios em texto, PDF imprimível e CSV.

## Como rodar localmente

Instale as dependências:

```bash
npm install
```

Rode no navegador:

```bash
npm run web
```

O Expo normalmente abre em:

```text
http://localhost:8081
```

## Build de produção web

Gere a versão estática:

```bash
npm run build:web
```

O resultado fica na pasta:

```text
dist
```

## Preview local do build

Depois do build:

```bash
npm run preview
```

Esse comando serve a pasta `dist` com fallback para rotas internas do app.

## Publicar na Vercel

1. Suba o projeto para um repositório GitHub.
2. Entre em https://vercel.com e clique em `Add New Project`.
3. Importe o repositório.
4. Confira as configurações:
   - Framework Preset: `Other` ou detectado automaticamente.
   - Build Command: `npm run build:web`
   - Output Directory: `dist`
5. Publique o projeto.
6. Acesse a URL gerada pela Vercel no celular usando 4G/5G.

O arquivo `vercel.json` já configura o build e um fallback para que rotas como `/torres/torre-1` e `/apartamentos/ap-11` funcionem mesmo ao atualizar a página diretamente.

## Rotas importantes para teste

- `/`
- `/torres/torre-1`
- `/apartamentos/ap-11`
- `/gerar-relatorio`
- `/servicos-etapas`
- `/diagnostico`

## Persistência local

O app salva dados no `localStorage` do navegador. Isso significa:

- os dados ficam no aparelho/navegador usado;
- limpar dados do navegador apaga o protótipo local;
- dados do celular e do computador não sincronizam entre si;
- publicar na Vercel não cria banco de dados.

## Limitações atuais

- Sem Firebase ou backend.
- Sem autenticação/login.
- Fotos ficam salvas localmente como dados do navegador.
- Sem sincronização multiusuário.
- Sem controle real de permissões.
- PDF é gerado pelo fluxo de impressão do navegador.
- CSV é a exportação principal; Excel/XLSX está preparado para versão futura.

## Próximos passos

- Definir modelo de dados definitivo para Firebase.
- Criar autenticação e perfis de acesso.
- Migrar fotos para storage real.
- Sincronizar vistorias, medições e relatórios entre dispositivos.
- Criar ambiente de homologação e produção.
- Melhorar exportação Excel/XLSX.
