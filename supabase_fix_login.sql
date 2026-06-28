-- ============================================================================
--  CORRECTIF — token de session stable (à exécuter une fois dans le SQL Editor)
--
--  Problème corrigé : avec l'ancienne version, chaque connexion générait un
--  nouveau token et écrasait le précédent -> se reconnecter (ou se connecter
--  depuis un autre appareil) invalidait la session ouverte, et les actions
--  d'administration échouaient ("Échec").
--
--  Avec ce correctif, le token est RÉUTILISÉ : plusieurs connexions du même
--  opérateur cohabitent. (Déjà inclus dans supabase_schema.sql pour les
--  installations neuves — inutile si vous réinstallez tout le schéma.)
--
--  Après l'avoir exécuté : déconnectez-vous puis reconnectez-vous dans l'app.
-- ============================================================================

create or replace function public.op_login(p_identifiant text, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; t text;
begin
  select * into r from public.operators where lower(identifiant) = lower(p_identifiant);
  if not found then return json_build_object('ok', false, 'error', 'identifiant'); end if;
  if r.actif is not true then return json_build_object('ok', false, 'error', 'inactif'); end if;
  if r.pin_hash <> public._pin_hash(p_identifiant, p_pin) then
    return json_build_object('ok', false, 'error', 'pin');
  end if;
  t := coalesce(r.token, gen_random_uuid()::text);   -- token stable (réutilisé)
  update public.operators set token = t, token_at = now() where id = r.id;
  return json_build_object('ok', true, 'token', t, 'nom', r.nom,
    'identifiant', r.identifiant, 'fonction', r.fonction, 'is_admin', r.is_admin);
end; $$;
