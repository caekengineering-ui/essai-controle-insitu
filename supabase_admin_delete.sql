-- ============================================================================
--  Donne à l'ADMIN le pouvoir de supprimer n'importe quelle fiche (même validée).
--  À exécuter une fois dans Supabase -> SQL Editor -> Create new snippet -> Run.
--  (Déjà inclus dans supabase_schema.sql pour les installations neuves.)
-- ============================================================================
create or replace function public.admin_delete_fiche(p_token text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  update public.fiches set remplacee_par = '' where remplacee_par = p_ref;
  delete from public.fiches where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

grant execute on function public.admin_delete_fiche(text,text) to anon, authenticated;
