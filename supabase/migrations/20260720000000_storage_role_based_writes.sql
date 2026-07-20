-- Storage: escrita de fotos passa a exigir PAPEL de escrita (admin/owner/editor).
--
-- ANTES: as políticas de INSERT/UPDATE/DELETE em storage.objects (migração
-- 20260712000000) exigiam apenas PERTENCER à obra — qualquer papel servia. Só que
-- a tabela public.inspection_photos exige admin/owner/editor desde a migração
-- 20260714110000. O descompasso deixava um viewer gravar o OBJETO no bucket e
-- falhar ao gravar a LINHA: objeto órfão, consumindo quota, invisível no app.
--
-- AGORA: as três políticas de escrita usam o mesmo predicado de papel das tabelas.
-- SELECT continua liberado para qualquer membro da obra — viewer precisa VER as
-- fotos, só não pode criar, sobrescrever nem apagar.
--
-- O ramo "legado" (objetos sem o prefixo obra_id/, casados por inspection_photos)
-- também passa a exigir papel de escrita: apagar evidência antiga é escrita.

drop policy if exists "obra members insert inspection photos" on storage.objects;
drop policy if exists "obra members update inspection photos" on storage.objects;
drop policy if exists "obra members delete inspection photos" on storage.objects;

create policy "obra writers insert inspection photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'inspection-photos'
  and (storage.foldername(name))[1] in (
    select uo.obra_id::text
    from public.user_obras uo
    where uo.user_id = (select auth.uid())
      and uo.role in ('admin', 'owner', 'editor')
  )
);

create policy "obra writers update inspection photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'inspection-photos'
  and (
    (storage.foldername(name))[1] in (
      select uo.obra_id::text
      from public.user_obras uo
      where uo.user_id = (select auth.uid())
        and uo.role in ('admin', 'owner', 'editor')
    )
    or exists (
      select 1
      from public.inspection_photos ip
      join public.user_obras uo on uo.obra_id = ip.obra_id
      where ip.storage_path = storage.objects.name
        and uo.user_id = (select auth.uid())
        and uo.role in ('admin', 'owner', 'editor')
    )
  )
)
with check (
  bucket_id = 'inspection-photos'
  and (storage.foldername(name))[1] in (
    select uo.obra_id::text
    from public.user_obras uo
    where uo.user_id = (select auth.uid())
      and uo.role in ('admin', 'owner', 'editor')
  )
);

create policy "obra writers delete inspection photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'inspection-photos'
  and (
    (storage.foldername(name))[1] in (
      select uo.obra_id::text
      from public.user_obras uo
      where uo.user_id = (select auth.uid())
        and uo.role in ('admin', 'owner', 'editor')
    )
    or exists (
      select 1
      from public.inspection_photos ip
      join public.user_obras uo on uo.obra_id = ip.obra_id
      where ip.storage_path = storage.objects.name
        and uo.user_id = (select auth.uid())
        and uo.role in ('admin', 'owner', 'editor')
    )
  )
);
