-- ============================================================================
-- Module « Contrôle photovoltaïque CFMS » — patch serveur
-- À exécuter une seule fois dans Supabase > SQL Editor.
--
-- Aucune table supplémentaire n'est nécessaire : public.fiches reçoit déjà
-- un type libre et un payload jsonb. Cette mise à jour ajoute uniquement la
-- numérotation indépendante QC/CFMS/<CODE>NN.
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
              when 'cfms'        then 'QC/CFMS/'
              else 'QC/P60/'
            end;
  pat := prefix || upper(coalesce(p_code, ''));
  select coalesce(max(num), 0) into maxn from (
    select nullif(regexp_replace(substring(ref from char_length(pat) + 1), '[^0-9].*$', ''), '')::int as num
    from public.fiches where type = p_type and ref like pat || '%'
  ) t where num is not null;
  return json_build_object('ok', true, 'n', maxn + 1,
    'ref', pat || lpad((maxn + 1)::text, 2, '0'));
end; $$;

grant execute on function public.op_next_ref(text,text,text) to anon, authenticated;
