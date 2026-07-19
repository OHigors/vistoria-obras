-- Converte a política de escrita FOR ALL (que cobria SELECT junto e gerava o aviso
-- "multiple_permissive_policies") em políticas explícitas de INSERT/UPDATE/DELETE.
-- Resultado: cada ação tem exatamente UMA política. SELECT fica só com obra_read.

do $$
declare
  t text;
  data_tables text[] := array[
    'apartments','checklist_items','checklist_status_events','inspection_photos',
    'inspection_visits','measurements','service_categories','service_stages',
    'service_units','step_assignments','towers','workers'
  ];
  pred text;
begin
  foreach t in array data_tables loop
    pred := format(
      'obra_id in (select uo.obra_id from public.user_obras uo where uo.user_id = (select auth.uid()) and uo.role in (%L,%L,%L))',
      'admin','owner','editor');

    execute format('drop policy if exists obra_write  on public.%I', t);
    execute format('drop policy if exists obra_insert on public.%I', t);
    execute format('drop policy if exists obra_update on public.%I', t);
    execute format('drop policy if exists obra_delete on public.%I', t);

    execute format('create policy obra_insert on public.%I for insert to authenticated with check (%s)', t, pred);
    execute format('create policy obra_update on public.%I for update to authenticated using (%s) with check (%s)', t, pred, pred);
    execute format('create policy obra_delete on public.%I for delete to authenticated using (%s)', t, pred);
  end loop;
end $$;

-- obras (escopo por id; escrita só admin/owner)
drop policy if exists obra_write  on public.obras;
drop policy if exists obra_insert on public.obras;
drop policy if exists obra_update on public.obras;
drop policy if exists obra_delete on public.obras;

create policy obra_insert on public.obras for insert to authenticated
  with check (id in (select uo.obra_id from public.user_obras uo where uo.user_id = (select auth.uid()) and uo.role in ('admin','owner')));
create policy obra_update on public.obras for update to authenticated
  using (id in (select uo.obra_id from public.user_obras uo where uo.user_id = (select auth.uid()) and uo.role in ('admin','owner')))
  with check (id in (select uo.obra_id from public.user_obras uo where uo.user_id = (select auth.uid()) and uo.role in ('admin','owner')));
create policy obra_delete on public.obras for delete to authenticated
  using (id in (select uo.obra_id from public.user_obras uo where uo.user_id = (select auth.uid()) and uo.role in ('admin','owner')));
