-- Fase 2b: isolamento por obra (multi-tenant real). Substitui `authenticated_all`
-- (qualquer usuário logado vê tudo) por `obra_scoped`: o usuário só acessa linhas
-- cujas obras estão em user_obras dele. Toda tabela de dados tem obra_id.
--
-- Antes de escopar, corrige o drift: obra_id era text em service_categories/
-- service_units/workers — passa a uuid (como nas demais). Assim a comparação é
-- uuid direto, sem cast. Subquery `(select auth.uid())` = avaliada uma vez/query.
--
-- ROLLBACK: recriar `authenticated_all ... USING (auth.uid() IS NOT NULL)`.

-- 1) remove policies (libera a coluna obra_id para o ALTER TYPE)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'obras','towers','apartments','checklist_items','checklist_status_events',
    'inspection_photos','inspection_visits','measurements','service_stages',
    'service_categories','service_units','workers','step_assignments'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS authenticated_all ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS obra_scoped ON public.%I', t);
  END LOOP;
END $$;

-- 2) drift: obra_id text → uuid
ALTER TABLE public.service_categories ALTER COLUMN obra_id TYPE uuid USING obra_id::uuid;
ALTER TABLE public.service_units       ALTER COLUMN obra_id TYPE uuid USING obra_id::uuid;
ALTER TABLE public.workers             ALTER COLUMN obra_id TYPE uuid USING obra_id::uuid;

-- 3) policies escopadas por obra (comparação uuid limpa)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'towers','apartments','checklist_items','checklist_status_events',
    'inspection_photos','inspection_visits','measurements','service_stages',
    'service_categories','service_units','workers','step_assignments'
  ] LOOP
    EXECUTE format($f$
      CREATE POLICY obra_scoped ON public.%I FOR ALL TO authenticated
      USING (obra_id IN (SELECT uo.obra_id FROM public.user_obras uo WHERE uo.user_id = (SELECT auth.uid())))
      WITH CHECK (obra_id IN (SELECT uo.obra_id FROM public.user_obras uo WHERE uo.user_id = (SELECT auth.uid())))
    $f$, t);
  END LOOP;
END $$;

CREATE POLICY obra_scoped ON public.obras FOR ALL TO authenticated
  USING (id IN (SELECT uo.obra_id FROM public.user_obras uo WHERE uo.user_id = (SELECT auth.uid())))
  WITH CHECK (id IN (SELECT uo.obra_id FROM public.user_obras uo WHERE uo.user_id = (SELECT auth.uid())));

NOTIFY pgrst, 'reload schema';
