-- =============================================================================
-- vistoria-obras — seed data (mirrors src/data/mockObras.ts + serviceStages.ts)
-- =============================================================================
-- Run AFTER supabase/migrations/20260515000000_initial_schema.sql
-- =============================================================================

-- ─── obra ─────────────────────────────────────────────────────────────────────
INSERT INTO obras (id, name, summary) VALUES
  ('residencial-cagliari',
   'Residencial Cagliari',
   'MVP para vistoria e acompanhamento visual de apartamentos.');

-- ─── towers ───────────────────────────────────────────────────────────────────
INSERT INTO towers (id, obra_id, name, block, position, description) VALUES
  ('torre-1', 'residencial-cagliari', 'Torre 1', 'Bloco B', 'Frente mar',
   'Unidades com prioridade para acabamento externo e sacadas.'),
  ('torre-2', 'residencial-cagliari', 'Torre 2', 'Bloco A', 'Frente rua',
   'Unidades em fase de vistoria fina e liberação por ambiente.');

-- ─── apartments ───────────────────────────────────────────────────────────────
-- last_inspection converted from DD/MM/YYYY → ISO date
INSERT INTO apartments (id, obra_id, tower_id, number, floor, status, progress, notes, last_inspection) VALUES
  ('ap-11', 'residencial-cagliari', 'torre-1', '11', '1º pavimento', 'excellent', 94,
   'Unidade praticamente pronta para conferência final.', '2026-05-07'),
  ('ap-12', 'residencial-cagliari', 'torre-1', '12', '1º pavimento', 'good', 78,
   'Pendências simples em gesso e limpeza.', '2026-05-07'),
  ('ap-15', 'residencial-cagliari', 'torre-1', '15', '1º pavimento', 'attention', 61,
   'Revisar impermeabilização e fechamento da churrasqueira.', '2026-05-06'),
  ('ap-24', 'residencial-cagliari', 'torre-2', '24', '2º pavimento', 'good', 82,
   'Boa evolução, faltam conferências de forro e hidráulica.', '2026-05-07'),
  ('ap-33', 'residencial-cagliari', 'torre-2', '33', '3º pavimento', 'critical', 38,
   'Concentrar equipe nas pendências críticas antes da próxima rodada.', '2026-05-05'),
  ('ap-82', 'residencial-cagliari', 'torre-2', '82', '8º pavimento', 'attention', 55,
   'Acompanhar contrapiso da laje técnica e reparo de pedra.', '2026-05-06');

-- ─── checklist_items ──────────────────────────────────────────────────────────
-- States computed from createChecklist(seed): value = (index + seed) % 6
--   0 → partial | 1 → notApplicable | 2,3 → pending | 4,5 → ok
-- Labels in sort_order 0-17 match checklistLabels array order.

-- ap-11 (seed=11): ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok
INSERT INTO checklist_items (id, obra_id, apartment_id, label, state, sort_order) VALUES
  ('11-0',  'residencial-cagliari', 'ap-11', 'Requadração monocapa da viga da sacada',    'ok',             0),
  ('11-1',  'residencial-cagliari', 'ap-11', 'Fechamento da churrasqueira em gesso',       'partial',        1),
  ('11-2',  'residencial-cagliari', 'ap-11', 'Impermeabilização do banheiro',              'notApplicable',  2),
  ('11-3',  'residencial-cagliari', 'ap-11', 'Impermeabilização da área de serviço',       'pending',        3),
  ('11-4',  'residencial-cagliari', 'ap-11', 'Impermeabilização da cozinha',               'pending',        4),
  ('11-5',  'residencial-cagliari', 'ap-11', 'Contrapiso da laje técnica',                 'ok',             5),
  ('11-6',  'residencial-cagliari', 'ap-11', 'Remoção de excesso de gesso',                'ok',             6),
  ('11-7',  'residencial-cagliari', 'ap-11', 'Contramarco da cobertura',                   'partial',        7),
  ('11-8',  'residencial-cagliari', 'ap-11', 'Instalação do guarda-corpo da sacada',       'notApplicable',  8),
  ('11-9',  'residencial-cagliari', 'ap-11', 'Forro de gesso cozinha/banheiro/corredor',   'pending',        9),
  ('11-10', 'residencial-cagliari', 'ap-11', 'Gesso externo',                              'pending',        10),
  ('11-11', 'residencial-cagliari', 'ap-11', 'Gesso banheiro',                             'ok',             11),
  ('11-12', 'residencial-cagliari', 'ap-11', 'Hidráulica',                                 'ok',             12),
  ('11-13', 'residencial-cagliari', 'ap-11', 'Ar-condicionado',                            'partial',        13),
  ('11-14', 'residencial-cagliari', 'ap-11', 'Limpeza',                                    'notApplicable',  14),
  ('11-15', 'residencial-cagliari', 'ap-11', 'Shaft churrasqueira/cozinha/banheiro',       'pending',        15),
  ('11-16', 'residencial-cagliari', 'ap-11', 'Forro sacada',                               'pending',        16),
  ('11-17', 'residencial-cagliari', 'ap-11', 'Reparo de pedra',                            'ok',             17);

-- ap-12 (seed=12): partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok
INSERT INTO checklist_items (id, obra_id, apartment_id, label, state, sort_order) VALUES
  ('12-0',  'residencial-cagliari', 'ap-12', 'Requadração monocapa da viga da sacada',    'partial',        0),
  ('12-1',  'residencial-cagliari', 'ap-12', 'Fechamento da churrasqueira em gesso',       'notApplicable',  1),
  ('12-2',  'residencial-cagliari', 'ap-12', 'Impermeabilização do banheiro',              'pending',        2),
  ('12-3',  'residencial-cagliari', 'ap-12', 'Impermeabilização da área de serviço',       'pending',        3),
  ('12-4',  'residencial-cagliari', 'ap-12', 'Impermeabilização da cozinha',               'ok',             4),
  ('12-5',  'residencial-cagliari', 'ap-12', 'Contrapiso da laje técnica',                 'ok',             5),
  ('12-6',  'residencial-cagliari', 'ap-12', 'Remoção de excesso de gesso',                'partial',        6),
  ('12-7',  'residencial-cagliari', 'ap-12', 'Contramarco da cobertura',                   'notApplicable',  7),
  ('12-8',  'residencial-cagliari', 'ap-12', 'Instalação do guarda-corpo da sacada',       'pending',        8),
  ('12-9',  'residencial-cagliari', 'ap-12', 'Forro de gesso cozinha/banheiro/corredor',   'pending',        9),
  ('12-10', 'residencial-cagliari', 'ap-12', 'Gesso externo',                              'ok',             10),
  ('12-11', 'residencial-cagliari', 'ap-12', 'Gesso banheiro',                             'ok',             11),
  ('12-12', 'residencial-cagliari', 'ap-12', 'Hidráulica',                                 'partial',        12),
  ('12-13', 'residencial-cagliari', 'ap-12', 'Ar-condicionado',                            'notApplicable',  13),
  ('12-14', 'residencial-cagliari', 'ap-12', 'Limpeza',                                    'pending',        14),
  ('12-15', 'residencial-cagliari', 'ap-12', 'Shaft churrasqueira/cozinha/banheiro',       'pending',        15),
  ('12-16', 'residencial-cagliari', 'ap-12', 'Forro sacada',                               'ok',             16),
  ('12-17', 'residencial-cagliari', 'ap-12', 'Reparo de pedra',                            'ok',             17);

-- ap-15 (seed=15): pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending
INSERT INTO checklist_items (id, obra_id, apartment_id, label, state, sort_order) VALUES
  ('15-0',  'residencial-cagliari', 'ap-15', 'Requadração monocapa da viga da sacada',    'pending',        0),
  ('15-1',  'residencial-cagliari', 'ap-15', 'Fechamento da churrasqueira em gesso',       'ok',             1),
  ('15-2',  'residencial-cagliari', 'ap-15', 'Impermeabilização do banheiro',              'ok',             2),
  ('15-3',  'residencial-cagliari', 'ap-15', 'Impermeabilização da área de serviço',       'partial',        3),
  ('15-4',  'residencial-cagliari', 'ap-15', 'Impermeabilização da cozinha',               'notApplicable',  4),
  ('15-5',  'residencial-cagliari', 'ap-15', 'Contrapiso da laje técnica',                 'pending',        5),
  ('15-6',  'residencial-cagliari', 'ap-15', 'Remoção de excesso de gesso',                'pending',        6),
  ('15-7',  'residencial-cagliari', 'ap-15', 'Contramarco da cobertura',                   'ok',             7),
  ('15-8',  'residencial-cagliari', 'ap-15', 'Instalação do guarda-corpo da sacada',       'ok',             8),
  ('15-9',  'residencial-cagliari', 'ap-15', 'Forro de gesso cozinha/banheiro/corredor',   'partial',        9),
  ('15-10', 'residencial-cagliari', 'ap-15', 'Gesso externo',                              'notApplicable',  10),
  ('15-11', 'residencial-cagliari', 'ap-15', 'Gesso banheiro',                             'pending',        11),
  ('15-12', 'residencial-cagliari', 'ap-15', 'Hidráulica',                                 'pending',        12),
  ('15-13', 'residencial-cagliari', 'ap-15', 'Ar-condicionado',                            'ok',             13),
  ('15-14', 'residencial-cagliari', 'ap-15', 'Limpeza',                                    'ok',             14),
  ('15-15', 'residencial-cagliari', 'ap-15', 'Shaft churrasqueira/cozinha/banheiro',       'partial',        15),
  ('15-16', 'residencial-cagliari', 'ap-15', 'Forro sacada',                               'notApplicable',  16),
  ('15-17', 'residencial-cagliari', 'ap-15', 'Reparo de pedra',                            'pending',        17);

-- ap-24 (seed=24): partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok
INSERT INTO checklist_items (id, obra_id, apartment_id, label, state, sort_order) VALUES
  ('24-0',  'residencial-cagliari', 'ap-24', 'Requadração monocapa da viga da sacada',    'partial',        0),
  ('24-1',  'residencial-cagliari', 'ap-24', 'Fechamento da churrasqueira em gesso',       'notApplicable',  1),
  ('24-2',  'residencial-cagliari', 'ap-24', 'Impermeabilização do banheiro',              'pending',        2),
  ('24-3',  'residencial-cagliari', 'ap-24', 'Impermeabilização da área de serviço',       'pending',        3),
  ('24-4',  'residencial-cagliari', 'ap-24', 'Impermeabilização da cozinha',               'ok',             4),
  ('24-5',  'residencial-cagliari', 'ap-24', 'Contrapiso da laje técnica',                 'ok',             5),
  ('24-6',  'residencial-cagliari', 'ap-24', 'Remoção de excesso de gesso',                'partial',        6),
  ('24-7',  'residencial-cagliari', 'ap-24', 'Contramarco da cobertura',                   'notApplicable',  7),
  ('24-8',  'residencial-cagliari', 'ap-24', 'Instalação do guarda-corpo da sacada',       'pending',        8),
  ('24-9',  'residencial-cagliari', 'ap-24', 'Forro de gesso cozinha/banheiro/corredor',   'pending',        9),
  ('24-10', 'residencial-cagliari', 'ap-24', 'Gesso externo',                              'ok',             10),
  ('24-11', 'residencial-cagliari', 'ap-24', 'Gesso banheiro',                             'ok',             11),
  ('24-12', 'residencial-cagliari', 'ap-24', 'Hidráulica',                                 'partial',        12),
  ('24-13', 'residencial-cagliari', 'ap-24', 'Ar-condicionado',                            'notApplicable',  13),
  ('24-14', 'residencial-cagliari', 'ap-24', 'Limpeza',                                    'pending',        14),
  ('24-15', 'residencial-cagliari', 'ap-24', 'Shaft churrasqueira/cozinha/banheiro',       'pending',        15),
  ('24-16', 'residencial-cagliari', 'ap-24', 'Forro sacada',                               'ok',             16),
  ('24-17', 'residencial-cagliari', 'ap-24', 'Reparo de pedra',                            'ok',             17);

-- ap-33 (seed=33): pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending
INSERT INTO checklist_items (id, obra_id, apartment_id, label, state, sort_order) VALUES
  ('33-0',  'residencial-cagliari', 'ap-33', 'Requadração monocapa da viga da sacada',    'pending',        0),
  ('33-1',  'residencial-cagliari', 'ap-33', 'Fechamento da churrasqueira em gesso',       'ok',             1),
  ('33-2',  'residencial-cagliari', 'ap-33', 'Impermeabilização do banheiro',              'ok',             2),
  ('33-3',  'residencial-cagliari', 'ap-33', 'Impermeabilização da área de serviço',       'partial',        3),
  ('33-4',  'residencial-cagliari', 'ap-33', 'Impermeabilização da cozinha',               'notApplicable',  4),
  ('33-5',  'residencial-cagliari', 'ap-33', 'Contrapiso da laje técnica',                 'pending',        5),
  ('33-6',  'residencial-cagliari', 'ap-33', 'Remoção de excesso de gesso',                'pending',        6),
  ('33-7',  'residencial-cagliari', 'ap-33', 'Contramarco da cobertura',                   'ok',             7),
  ('33-8',  'residencial-cagliari', 'ap-33', 'Instalação do guarda-corpo da sacada',       'ok',             8),
  ('33-9',  'residencial-cagliari', 'ap-33', 'Forro de gesso cozinha/banheiro/corredor',   'partial',        9),
  ('33-10', 'residencial-cagliari', 'ap-33', 'Gesso externo',                              'notApplicable',  10),
  ('33-11', 'residencial-cagliari', 'ap-33', 'Gesso banheiro',                             'pending',        11),
  ('33-12', 'residencial-cagliari', 'ap-33', 'Hidráulica',                                 'pending',        12),
  ('33-13', 'residencial-cagliari', 'ap-33', 'Ar-condicionado',                            'ok',             13),
  ('33-14', 'residencial-cagliari', 'ap-33', 'Limpeza',                                    'ok',             14),
  ('33-15', 'residencial-cagliari', 'ap-33', 'Shaft churrasqueira/cozinha/banheiro',       'partial',        15),
  ('33-16', 'residencial-cagliari', 'ap-33', 'Forro sacada',                               'notApplicable',  16),
  ('33-17', 'residencial-cagliari', 'ap-33', 'Reparo de pedra',                            'pending',        17);

-- ap-82 (seed=82): ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending,ok,ok,partial,notApplicable,pending,pending
INSERT INTO checklist_items (id, obra_id, apartment_id, label, state, sort_order) VALUES
  ('82-0',  'residencial-cagliari', 'ap-82', 'Requadração monocapa da viga da sacada',    'ok',             0),
  ('82-1',  'residencial-cagliari', 'ap-82', 'Fechamento da churrasqueira em gesso',       'ok',             1),
  ('82-2',  'residencial-cagliari', 'ap-82', 'Impermeabilização do banheiro',              'partial',        2),
  ('82-3',  'residencial-cagliari', 'ap-82', 'Impermeabilização da área de serviço',       'notApplicable',  3),
  ('82-4',  'residencial-cagliari', 'ap-82', 'Impermeabilização da cozinha',               'pending',        4),
  ('82-5',  'residencial-cagliari', 'ap-82', 'Contrapiso da laje técnica',                 'pending',        5),
  ('82-6',  'residencial-cagliari', 'ap-82', 'Remoção de excesso de gesso',                'ok',             6),
  ('82-7',  'residencial-cagliari', 'ap-82', 'Contramarco da cobertura',                   'ok',             7),
  ('82-8',  'residencial-cagliari', 'ap-82', 'Instalação do guarda-corpo da sacada',       'partial',        8),
  ('82-9',  'residencial-cagliari', 'ap-82', 'Forro de gesso cozinha/banheiro/corredor',   'notApplicable',  9),
  ('82-10', 'residencial-cagliari', 'ap-82', 'Gesso externo',                              'pending',        10),
  ('82-11', 'residencial-cagliari', 'ap-82', 'Gesso banheiro',                             'pending',        11),
  ('82-12', 'residencial-cagliari', 'ap-82', 'Hidráulica',                                 'ok',             12),
  ('82-13', 'residencial-cagliari', 'ap-82', 'Ar-condicionado',                            'ok',             13),
  ('82-14', 'residencial-cagliari', 'ap-82', 'Limpeza',                                    'partial',        14),
  ('82-15', 'residencial-cagliari', 'ap-82', 'Shaft churrasqueira/cozinha/banheiro',       'notApplicable',  15),
  ('82-16', 'residencial-cagliari', 'ap-82', 'Forro sacada',                               'pending',        16),
  ('82-17', 'residencial-cagliari', 'ap-82', 'Reparo de pedra',                            'pending',        17);

-- ─── service_stages ───────────────────────────────────────────────────────────
-- Mirrors defaultServiceStages from src/data/serviceStages.ts.
-- 18 checklist labels + 11 extra example stages (Hidráulica excluded as duplicate).
-- categoria logic: Impermeabilização → 'Impermeabilização'
--                  Gesso/Forro/Shaft → 'Gesso e fechamentos'
--                  Hidráulica/Ar-condicionado → 'Instalações'
--                  Limpeza/Vistoria → 'Entrega'
--                  else → 'Execução'
-- unidade_medicao: 'un' if Limpeza or Vistoria, else 'm²'
-- etapa_critica: Impermeabilização OR Hidráulica OR Vistoria
-- trava_liberacao: Limpeza OR Vistoria OR Shaft
-- servicos_dependentes: from defaultServiceDependencies (extra stages get '{}')

INSERT INTO service_stages (
  id, obra_id, nome, categoria, unidade_medicao, ordem_execucao,
  etapa_critica, trava_liberacao,
  servicos_dependentes
) VALUES
-- 1 — checklist stages
  ('requadracao-monocapa-da-viga-da-sacada',    'residencial-cagliari',
   'Requadração monocapa da viga da sacada',    'Execução',            'm²', 1,
   false, false,
   ARRAY['pintura externa', 'acabamento da sacada']),

  ('fechamento-da-churrasqueira-em-gesso',      'residencial-cagliari',
   'Fechamento da churrasqueira em gesso',      'Execução',            'm²', 2,
   false, false,
   ARRAY['pintura', 'limpeza fina']),

  ('impermeabilizacao-do-banheiro',             'residencial-cagliari',
   'Impermeabilização do banheiro',             'Impermeabilização',   'm²', 3,
   true,  false,
   ARRAY['contrapiso', 'revestimento', 'louças']),

  ('impermeabilizacao-da-area-de-servico',      'residencial-cagliari',
   'Impermeabilização da área de serviço',      'Impermeabilização',   'm²', 4,
   true,  false,
   ARRAY['contrapiso', 'revestimento']),

  ('impermeabilizacao-da-cozinha',              'residencial-cagliari',
   'Impermeabilização da cozinha',              'Impermeabilização',   'm²', 5,
   true,  false,
   ARRAY['contrapiso', 'revestimento']),

  ('contrapiso-da-laje-tecnica',                'residencial-cagliari',
   'Contrapiso da laje técnica',                'Execução',            'm²', 6,
   false, false,
   ARRAY['acabamento da laje técnica']),

  ('remocao-de-excesso-de-gesso',               'residencial-cagliari',
   'Remoção de excesso de gesso',               'Execução',            'm²', 7,
   false, false,
   ARRAY['pintura', 'limpeza fina']),

  ('contramarco-da-cobertura',                  'residencial-cagliari',
   'Contramarco da cobertura',                  'Execução',            'm²', 8,
   false, false,
   ARRAY['esquadria', 'acabamento']),

  ('instalacao-do-guarda-corpo-da-sacada',      'residencial-cagliari',
   'Instalação do guarda-corpo da sacada',      'Execução',            'm²', 9,
   false, false,
   ARRAY['liberação da sacada']),

  ('forro-de-gesso-cozinha-banheiro-corredor',  'residencial-cagliari',
   'Forro de gesso cozinha/banheiro/corredor',  'Gesso e fechamentos', 'm²', 10,
   false, false,
   ARRAY['pintura', 'iluminação', 'limpeza fina']),

  ('gesso-externo',                             'residencial-cagliari',
   'Gesso externo',                             'Gesso e fechamentos', 'm²', 11,
   false, false,
   ARRAY['pintura externa']),

  ('gesso-banheiro',                            'residencial-cagliari',
   'Gesso banheiro',                            'Gesso e fechamentos', 'm²', 12,
   false, false,
   ARRAY['pintura', 'acabamento do banheiro']),

  ('hidraulica',                                'residencial-cagliari',
   'Hidráulica',                                'Instalações',         'm²', 13,
   true,  false,
   ARRAY['fechamento de shaft', 'testes finais']),

  ('ar-condicionado',                           'residencial-cagliari',
   'Ar-condicionado',                           'Instalações',         'm²', 14,
   false, false,
   ARRAY['fechamento de forro', 'acabamento']),

  ('limpeza',                                   'residencial-cagliari',
   'Limpeza',                                   'Entrega',             'un', 15,
   false, true,
   ARRAY['entrega final']),

  ('shaft-churrasqueira-cozinha-banheiro',      'residencial-cagliari',
   'Shaft churrasqueira/cozinha/banheiro',      'Gesso e fechamentos', 'm²', 16,
   false, true,
   ARRAY['acabamento', 'pintura', 'entrega final']),

  ('forro-sacada',                              'residencial-cagliari',
   'Forro sacada',                              'Gesso e fechamentos', 'm²', 17,
   false, false,
   ARRAY['pintura da sacada', 'limpeza']),

  ('reparo-de-pedra',                           'residencial-cagliari',
   'Reparo de pedra',                           'Execução',            'm²', 18,
   false, false,
   ARRAY['limpeza fina', 'entrega final']),

-- 2 — extra example stages (not in checklist, no dependencies)
  ('impermeabilizacao',                         'residencial-cagliari',
   'Impermeabilização',                         'Impermeabilização',   'm²', 19,
   true,  false,
   '{}'),

  ('contrapiso',                                'residencial-cagliari',
   'Contrapiso',                                'Execução',            'm²', 20,
   false, false,
   '{}'),

  ('eletrica',                                  'residencial-cagliari',
   'Elétrica',                                  'Execução',            'm²', 21,
   false, false,
   '{}'),

  ('fechamento-de-shaft',                       'residencial-cagliari',
   'Fechamento de shaft',                       'Gesso e fechamentos', 'm²', 22,
   false, true,
   '{}'),

  ('gesso',                                     'residencial-cagliari',
   'Gesso',                                     'Gesso e fechamentos', 'm²', 23,
   false, false,
   '{}'),

  ('pintura',                                   'residencial-cagliari',
   'Pintura',                                   'Execução',            'm²', 24,
   false, false,
   '{}'),

  ('revestimento',                              'residencial-cagliari',
   'Revestimento',                              'Execução',            'm²', 25,
   false, false,
   '{}'),

  ('loucas-e-metais',                           'residencial-cagliari',
   'Louças e metais',                           'Execução',            'un', 26,
   false, false,
   '{}'),

  ('esquadria',                                 'residencial-cagliari',
   'Esquadria',                                 'Execução',            'un', 27,
   false, false,
   '{}'),

  ('limpeza-fina',                              'residencial-cagliari',
   'Limpeza fina',                              'Entrega',             'un', 28,
   false, true,
   '{}'),

  ('vistoria-final',                            'residencial-cagliari',
   'Vistoria final',                            'Entrega',             'un', 29,
   true,  true,
   '{}');
