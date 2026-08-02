-- ============================================================================
--  Module « Essai d'arrachement sur clous d'ancrage » — patch serveur.
--  À exécuter une fois dans Supabase -> SQL Editor -> Create new snippet -> Run.
--
--  La table public.fiches accepte déjà un type libre et un payload jsonb :
--  aucune migration de schéma n'est nécessaire. Seule la NUMÉROTATION des
--  références doit connaître le nouveau préfixe QC/ARR/.
--  Plaque, compacité et arrachement s'incrémentent indépendamment, par code
--  projet. Remplace la version de op_next_ref livrée dans supabase_schema.sql
--  et supabase_next_ref.sql.
-- ============================================================================
create or replace function public.op_next_ref(p_token text, p_type text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; prefix text; pat text; maxn int;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  prefix := case p_type
              when 'compacite'   then 'QC/COMP/'
              when 'arrachement' then 'QC/ARR/'
              else 'QC/P60/'
            end;
  pat := prefix || upper(coalesce(p_code, ''));
  select coalesce(max(num), 0) into maxn from (
    select nullif(regexp_replace(substring(ref from char_length(pat) + 1), '[^0-9].*$', ''), '')::int as num
    from public.fiches
    where type = p_type and ref like pat || '%'
  ) t where num is not null;
  return json_build_object('ok', true, 'n', maxn + 1,
    'ref', pat || lpad((maxn + 1)::text, 2, '0'));
end; $$;

grant execute on function public.op_next_ref(text,text,text) to anon, authenticated;

-- ----------------------------------------------------------------------------
--  Le payload d'un essai d'arrachement porte les paliers, toutes les lectures
--  horodatées avec leurs corrections, les photos (à la validation) et les
--  anomalies : il est nettement plus volumineux que ceux des deux autres
--  modules. Index GIN pour rester efficace sur les requêtes du bureau.
-- ----------------------------------------------------------------------------
create index if not exists fiches_type_idx    on public.fiches (type);
create index if not exists fiches_payload_idx on public.fiches using gin (payload jsonb_path_ops);
