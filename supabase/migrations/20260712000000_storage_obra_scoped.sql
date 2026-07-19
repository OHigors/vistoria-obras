-- Storage lockdown: escopo por obra no bucket privado `inspection-photos`.
--
-- ANTES: as políticas checavam apenas `bucket_id = 'inspection-photos'`, então
-- QUALQUER usuário autenticado podia listar/baixar/sobrescrever/apagar as fotos
-- de QUALQUER obra. As tabelas já eram obra-scoped, mas o Storage estava aberto.
--
-- ESTRATÉGIA HÍBRIDA (sem precisar mover fisicamente os objetos já existentes):
--  * INSERT/UPDATE: a 1ª pasta do caminho precisa ser uma obra do usuário. Uploads
--    novos usam o prefixo `obra_id/...`, então caem naturalmente na obra correta e
--    ninguém consegue gravar na pasta de outra obra.
--  * SELECT/DELETE: além do check de pasta, também liberam quando existe uma linha
--    em `inspection_photos` (fonte de verdade, casada por `storage_path`) cuja obra
--    pertence ao usuário. Assim os objetos LEGADOS (caminho `apartmentId/...`, sem o
--    prefixo de obra) continuam acessíveis — porém já escopados por obra — sem
--    exigir migração física via Storage API.

-- Índice que sustenta o join `storage_path = objects.name` das políticas de
-- SELECT/DELETE (e acelera loads por storage_path).
create index if not exists idx_inspection_photos_storage_path
  on public.inspection_photos (storage_path);

-- Remove as políticas permissivas antigas.
drop policy if exists "auth read inspection photos"   on storage.objects;
drop policy if exists "auth insert inspection photos" on storage.objects;
drop policy if exists "auth update inspection photos" on storage.objects;
drop policy if exists "auth delete inspection photos" on storage.objects;

create policy "obra members read inspection photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'inspection-photos'
  and (
    (storage.foldername(name))[1] in (
      select uo.obra_id::text
      from public.user_obras uo
      where uo.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.inspection_photos ip
      join public.user_obras uo on uo.obra_id = ip.obra_id
      where ip.storage_path = storage.objects.name
        and uo.user_id = (select auth.uid())
    )
  )
);

create policy "obra members insert inspection photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'inspection-photos'
  and (storage.foldername(name))[1] in (
    select uo.obra_id::text
    from public.user_obras uo
    where uo.user_id = (select auth.uid())
  )
);

create policy "obra members update inspection photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'inspection-photos'
  and (
    (storage.foldername(name))[1] in (
      select uo.obra_id::text
      from public.user_obras uo
      where uo.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.inspection_photos ip
      join public.user_obras uo on uo.obra_id = ip.obra_id
      where ip.storage_path = storage.objects.name
        and uo.user_id = (select auth.uid())
    )
  )
)
with check (
  bucket_id = 'inspection-photos'
  and (storage.foldername(name))[1] in (
    select uo.obra_id::text
    from public.user_obras uo
    where uo.user_id = (select auth.uid())
  )
);

create policy "obra members delete inspection photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'inspection-photos'
  and (
    (storage.foldername(name))[1] in (
      select uo.obra_id::text
      from public.user_obras uo
      where uo.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.inspection_photos ip
      join public.user_obras uo on uo.obra_id = ip.obra_id
      where ip.storage_path = storage.objects.name
        and uo.user_id = (select auth.uid())
    )
  )
);
