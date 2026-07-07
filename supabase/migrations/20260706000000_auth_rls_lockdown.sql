-- Fase 2 do login: fecha o acesso anônimo. Só usuários autenticados (Supabase
-- Auth) leem/escrevem os dados. Substitui as policies permissivas
-- (anon_all / service_*_all, que valiam para anon+authenticated) por UMA policy
-- por tabela restrita ao papel `authenticated`. Sem policy para anon → negado por
-- padrão. Habilita RLS em workers/step_assignments (estavam sem). O storage do
-- bucket privado inspection-photos passa a exigir autenticação, e a função de
-- auditoria SECURITY DEFINER deixa de ser chamável via RPC.
--
-- ROLLBACK (se o app parar de carregar para usuários logados): recriar as policies
-- permissivas, ex.:
--   CREATE POLICY anon_all ON public.<tabela> FOR ALL TO anon, authenticated
--     USING (true) WITH CHECK (true);

-- 1) Remove as policies permissivas antigas (papel anon).
DROP POLICY IF EXISTS anon_all ON public.obras;
DROP POLICY IF EXISTS anon_all ON public.towers;
DROP POLICY IF EXISTS anon_all ON public.apartments;
DROP POLICY IF EXISTS anon_all ON public.checklist_items;
DROP POLICY IF EXISTS anon_all ON public.checklist_status_events;
DROP POLICY IF EXISTS anon_all ON public.inspection_photos;
DROP POLICY IF EXISTS anon_all ON public.inspection_visits;
DROP POLICY IF EXISTS anon_all ON public.measurements;
DROP POLICY IF EXISTS anon_all ON public.service_stages;
DROP POLICY IF EXISTS service_categories_all ON public.service_categories;
DROP POLICY IF EXISTS service_units_all ON public.service_units;

-- 2) RLS habilitado + policy única (autenticado) em todas as tabelas de dados.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'obras','towers','apartments','checklist_items','checklist_status_events',
    'inspection_photos','inspection_visits','measurements','service_stages',
    'service_categories','service_units','workers','step_assignments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY authenticated_all ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
      t
    );
  END LOOP;
END $$;

-- 3) Storage (bucket privado inspection-photos) → só autenticados.
DROP POLICY IF EXISTS "anon read inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "anon insert inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "anon update inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "anon delete inspection photos" ON storage.objects;

CREATE POLICY "auth read inspection photos" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'inspection-photos');
CREATE POLICY "auth insert inspection photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inspection-photos');
CREATE POLICY "auth update inspection photos" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'inspection-photos') WITH CHECK (bucket_id = 'inspection-photos');
CREATE POLICY "auth delete inspection photos" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'inspection-photos');

-- 4) Não expor a função de auditoria (SECURITY DEFINER) via RPC.
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn() FROM PUBLIC, anon, authenticated;

-- 5) search_path fixo no trigger set_updated_at (corpo é só NEW.updated_at = now()).
ALTER FUNCTION public.set_updated_at() SET search_path = '';
