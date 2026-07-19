-- #5 — Políticas por papel: separa LEITURA (qualquer membro da obra) de ESCRITA
-- (apenas papéis com permissão). Antes: uma única política `obra_scoped` FOR ALL
-- deixava QUALQUER membro inserir/atualizar/apagar — inclusive apagar a obra.
--
-- Modelo:
--   * Tabelas de dados: escrita = role in ('admin','owner','editor').
--   * Tabela obras:      escrita = role in ('admin','owner').
--   * Leitura em tudo:   qualquer membro da obra.
-- (role é texto livre; 'admin' é o papel atual e continua com acesso total.)

do $$
declare
  t text;
  data_tables text[] := array[
    'apartments','checklist_items','checklist_status_events','inspection_photos',
    'inspection_visits','measurements','service_categories','service_stages',
    'service_units','step_assignments','towers','workers'
  ];
begin
  foreach t in array data_tables loop
    execute format('drop policy if exists obra_scoped on public.%I', t);
    execute format('drop policy if exists obra_read  on public.%I', t);
    execute format('drop policy if exists obra_write on public.%I', t);

    execute format($f$
      create policy obra_read on public.%I
      for select to authenticated
      using (
        obra_id in (
          select uo.obra_id from public.user_obras uo
          where uo.user_id = (select auth.uid())
        )
      )$f$, t);

    execute format($f$
      create policy obra_write on public.%I
      for all to authenticated
      using (
        obra_id in (
          select uo.obra_id from public.user_obras uo
          where uo.user_id = (select auth.uid())
            and uo.role in ('admin','owner','editor')
        )
      )
      with check (
        obra_id in (
          select uo.obra_id from public.user_obras uo
          where uo.user_id = (select auth.uid())
            and uo.role in ('admin','owner','editor')
        )
      )$f$, t);
  end loop;
end $$;

-- obras (escopo por `id`; escrita só admin/owner)
drop policy if exists obra_scoped on public.obras;
drop policy if exists obra_read  on public.obras;
drop policy if exists obra_write on public.obras;

create policy obra_read on public.obras
  for select to authenticated
  using (
    id in (select uo.obra_id from public.user_obras uo where uo.user_id = (select auth.uid()))
  );

create policy obra_write on public.obras
  for all to authenticated
  using (
    id in (
      select uo.obra_id from public.user_obras uo
      where uo.user_id = (select auth.uid()) and uo.role in ('admin','owner')
    )
  )
  with check (
    id in (
      select uo.obra_id from public.user_obras uo
      where uo.user_id = (select auth.uid()) and uo.role in ('admin','owner')
    )
  );

-- Higiene de performance (advisor auth_rls_initplan): envolve auth.uid() em SELECT.
alter policy profiles_self_select on public.profiles using (id = (select auth.uid()));
alter policy profiles_self_update on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy user_obras_self_select on public.user_obras using (user_id = (select auth.uid()));
