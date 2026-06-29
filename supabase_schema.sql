-- ============================================================================
--  CAEK — Essai de contrôle in situ
--  Schéma Supabase : tables + fonctions RPC (sécurité par fonctions SECURITY DEFINER)
--
--  À COLLER tel quel dans Supabase :  SQL Editor  ->  New query  ->  Run.
--  La clé "anon" (publique, dans l'app) ne peut appeler QUE les fonctions op_* / admin_* ;
--  elle n'a aucun accès direct aux tables (RLS activé sans policy = tout refusé).
--  La clé "service_role" (secrète, côté bureau Python) contourne RLS pour lire les fiches.
--
--  Opérateur admin par défaut créé en bas :  identifiant = admin   PIN = 1234
--  >>> Changez ce PIN dès la première connexion (écran Admin de l'app). <<<
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================== TABLES ======================================

create table if not exists public.operators (
  id           uuid primary key default gen_random_uuid(),
  identifiant  text unique not null,
  pin_hash     text not null,
  nom          text not null,
  fonction     text default '',
  is_admin     boolean default false,
  actif        boolean default true,
  token        text,
  token_at     timestamptz,
  created_at   timestamptz default now()
);

create table if not exists public.entreprises (
  id         uuid primary key default gen_random_uuid(),
  cle        text unique not null,          -- clé d'association (ex. nom client normalisé)
  nom        text not null,
  activite   text default '',
  adresse    text default '',
  capital    text default '',
  rc         text default '',
  logo_key   text default '',               -- nom du logo côté bureau (logos/<logo_key>.png)
  actif      boolean default true,
  updated_at timestamptz default now()
);

create table if not exists public.projets (
  code_projet    text primary key,
  client         text default '',
  entreprise     text default '',
  nom_projet     text default '',
  lieu           text default '',
  wilaya         text default '',
  client_id      text default '',
  entreprise_cle text default '',           -- lien vers entreprises.cle
  controle       boolean default false,     -- Oui = contrôle (entête CAEK, pas de maître d'ouvrage)
  maitre_ouvrage text default '',           -- rempli uniquement en auto-contrôle (controle = false)
  actif          boolean default true,
  updated_at     timestamptz default now()
);

create table if not exists public.fiches (
  ref             text primary key,
  type            text not null,            -- 'plaque' | 'compacite'
  statut          text not null default 'brouillon', -- incomplet|brouillon|valide
  payload         jsonb not null,
  operateur       text default '',
  valide_par      text default '',
  date_validation text default '',
  version         int default 1,
  ref_base        text default '',          -- réf. de la 1re version
  ref_precedente  text default '',          -- version remplacée par celle-ci
  remplacee_par   text default '',          -- réf. de la version corrigée suivante
  pv_genere       boolean default false,
  pv_livre        boolean default false,
  pv_genere_at    timestamptz,
  pv_livre_at     timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- RLS : activé, aucune policy => accès direct refusé pour anon/authenticated.
-- (service_role contourne RLS ; les fonctions ci-dessous sont SECURITY DEFINER.)
alter table public.operators   enable row level security;
alter table public.entreprises enable row level security;
alter table public.projets     enable row level security;
alter table public.fiches      enable row level security;

-- ============================== HELPERS =====================================

-- Hash du PIN : sha256( identifiant_minuscule + ':' + pin )
create or replace function public._pin_hash(p_identifiant text, p_pin text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(lower(p_identifiant) || ':' || coalesce(p_pin,''), 'sha256'), 'hex');
$$;

-- Opérateur actif à partir d'un token de session
create or replace function public._op_by_token(p_token text)
returns public.operators language sql stable security definer set search_path = public as $$
  select * from public.operators
   where token = p_token and p_token is not null and actif = true
   limit 1;
$$;

-- ============================== AUTH ========================================

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
  -- Token de session STABLE : on réutilise le token existant s'il y en a un, afin
  -- qu'une nouvelle connexion (autre appareil/onglet) n'invalide PAS les sessions
  -- déjà ouvertes du même opérateur. Un nouveau token n'est créé qu'au 1er login
  -- (ou après désactivation, qui remet le token à NULL).
  t := coalesce(r.token, gen_random_uuid()::text);
  update public.operators set token = t, token_at = now() where id = r.id;
  return json_build_object('ok', true, 'token', t, 'nom', r.nom,
    'identifiant', r.identifiant, 'fonction', r.fonction, 'is_admin', r.is_admin);
end; $$;

create or replace function public.op_verify(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'nom', r.nom,
    'identifiant', r.identifiant, 'is_admin', r.is_admin);
end; $$;

-- Changer son propre PIN
create or replace function public.op_change_pin(p_token text, p_old_pin text, p_new_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if r.pin_hash <> public._pin_hash(r.identifiant, p_old_pin) then
    return json_build_object('ok', false, 'error', 'pin');
  end if;
  update public.operators set pin_hash = public._pin_hash(r.identifiant, p_new_pin) where id = r.id;
  return json_build_object('ok', true);
end; $$;

-- ============================== FICHES ======================================

-- Insert/maj d'une fiche. Refuse toute écriture sur une fiche déjà 'valide' (immuabilité).
create or replace function public.op_save_fiche(p_token text, p_ref text, p_type text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.fiches;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into ex from public.fiches where ref = p_ref;
  if found and ex.statut = 'valide' then
    return json_build_object('ok', false, 'error', 'verrouillee');
  end if;
  insert into public.fiches(ref, type, statut, payload, operateur, version, ref_base,
                            ref_precedente, updated_at)
    values (p_ref, p_type, coalesce(p_payload->>'statut','brouillon'), p_payload, r.nom,
            coalesce((p_payload->>'version')::int, 1),
            coalesce(nullif(p_payload->>'refBase',''), p_ref),
            coalesce(p_payload->>'refPrecedente',''), now())
  on conflict (ref) do update set
    type = excluded.type, statut = excluded.statut, payload = excluded.payload,
    operateur = excluded.operateur, version = excluded.version, updated_at = now();
  return json_build_object('ok', true);
end; $$;

-- Validation : fige operateur / valide_par / date_validation / version (immuable ensuite).
create or replace function public.op_valider_fiche(p_token text, p_ref text, p_type text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.fiches; v text; pl jsonb;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into ex from public.fiches where ref = p_ref;
  if found and ex.statut = 'valide' then
    return json_build_object('ok', false, 'error', 'deja_validee');
  end if;
  v  := to_char(now(), 'DD/MM/YYYY');
  pl := p_payload || jsonb_build_object('statut','valide','valideePar', r.nom, 'dateValidation', v);
  insert into public.fiches(ref, type, statut, payload, operateur, valide_par, date_validation,
                            version, ref_base, ref_precedente, updated_at)
    values (p_ref, p_type, 'valide', pl, r.nom, r.nom, v,
            coalesce((p_payload->>'version')::int, 1),
            coalesce(nullif(p_payload->>'refBase',''), p_ref),
            coalesce(p_payload->>'refPrecedente',''), now())
  on conflict (ref) do update set
    statut = 'valide', payload = pl, valide_par = r.nom, date_validation = v, updated_at = now();
  return json_build_object('ok', true, 'valide_par', r.nom, 'date_validation', v);
end; $$;

-- Créer une version corrigée d'une fiche (validée) -> nouvelle réf, brouillon modifiable.
create or replace function public.op_creer_version(p_token text, p_ref text, p_new_ref text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; src public.fiches; pl jsonb; nv int; base text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into src from public.fiches where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if exists (select 1 from public.fiches where ref = p_new_ref) then
    return json_build_object('ok', false, 'error', 'ref_existe');
  end if;
  nv   := coalesce(src.version, 1) + 1;
  base := coalesce(nullif(src.ref_base, ''), src.ref);
  pl   := src.payload || jsonb_build_object(
            'ref', p_new_ref, 'statut', 'brouillon', 'version', nv,
            'refBase', base, 'refPrecedente', src.ref,
            'valideePar', '', 'dateValidation', '');
  insert into public.fiches(ref, type, statut, payload, operateur, version, ref_base,
                            ref_precedente, updated_at)
    values (p_new_ref, src.type, 'brouillon', pl, r.nom, nv, base, src.ref, now());
  update public.fiches set remplacee_par = p_new_ref, updated_at = now() where ref = p_ref;
  return json_build_object('ok', true, 'ref', p_new_ref, 'version', nv);
end; $$;

create or replace function public.op_list_fiches(p_token text, p_type text default null)
returns setof public.fiches language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  return query
    select * from public.fiches
     where (p_type is null or type = p_type)
     order by updated_at desc;
end; $$;

create or replace function public.op_delete_fiche(p_token text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.fiches;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into ex from public.fiches where ref = p_ref;
  if not found then return json_build_object('ok', true); end if;
  if ex.statut = 'valide' then return json_build_object('ok', false, 'error', 'verrouillee'); end if;
  delete from public.fiches where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

-- ============================== PROJETS / ENTREPRISES (lecture op) ==========

create or replace function public.op_list_projets(p_token text)
returns setof public.projets language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  return query select * from public.projets where actif = true order by code_projet;
end; $$;

create or replace function public.op_list_entreprises(p_token text)
returns setof public.entreprises language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  return query select * from public.entreprises where actif = true order by nom;
end; $$;

-- ============================== ADMIN =======================================

create or replace function public._is_admin(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public._op_by_token(p_token)), false);
$$;

create or replace function public.admin_list_operators(p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  return json_build_object('ok', true, 'operators', coalesce((
    select json_agg(json_build_object('id', id, 'identifiant', identifiant, 'nom', nom,
             'fonction', fonction, 'is_admin', is_admin, 'actif', actif) order by nom)
    from public.operators), '[]'::json));
end; $$;

-- Crée (sans id) ou met à jour (avec id) un opérateur. PIN seulement si fourni.
create or replace function public.admin_upsert_operator(
  p_token text, p_id uuid, p_identifiant text, p_pin text,
  p_nom text, p_fonction text, p_is_admin boolean, p_actif boolean)
returns json language plpgsql security definer set search_path = public as $$
declare existing public.operators;
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if p_id is null then
    if exists (select 1 from public.operators where lower(identifiant) = lower(p_identifiant)) then
      return json_build_object('ok', false, 'error', 'identifiant_existe');
    end if;
    if coalesce(p_pin,'') = '' then return json_build_object('ok', false, 'error', 'pin_requis'); end if;
    insert into public.operators(identifiant, pin_hash, nom, fonction, is_admin, actif)
      values (p_identifiant, public._pin_hash(p_identifiant, p_pin),
              p_nom, coalesce(p_fonction,''), coalesce(p_is_admin,false), coalesce(p_actif,true));
  else
    select * into existing from public.operators where id = p_id;
    if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
    update public.operators set
      identifiant = p_identifiant, nom = p_nom, fonction = coalesce(p_fonction,''),
      is_admin = coalesce(p_is_admin, existing.is_admin), actif = coalesce(p_actif, existing.actif),
      pin_hash = case when coalesce(p_pin,'') <> '' then public._pin_hash(p_identifiant, p_pin)
                      else existing.pin_hash end
      where id = p_id;
  end if;
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_set_operator_active(p_token text, p_id uuid, p_actif boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  update public.operators set actif = p_actif, token = case when p_actif then token else null end
    where id = p_id;
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_upsert_entreprise(p_token text, p_ent jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  insert into public.entreprises(cle, nom, activite, adresse, capital, rc, logo_key, actif, updated_at)
    values (lower(p_ent->>'cle'), p_ent->>'nom', coalesce(p_ent->>'activite',''),
            coalesce(p_ent->>'adresse',''), coalesce(p_ent->>'capital',''),
            coalesce(p_ent->>'rc',''), coalesce(p_ent->>'logoKey',''),
            coalesce((p_ent->>'actif')::boolean, true), now())
  on conflict (cle) do update set
    nom = excluded.nom, activite = excluded.activite, adresse = excluded.adresse,
    capital = excluded.capital, rc = excluded.rc, logo_key = excluded.logo_key,
    actif = excluded.actif, updated_at = now();
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_save_projet(p_token text, p_projet jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  insert into public.projets(code_projet, client, entreprise, nom_projet, lieu, wilaya,
                             client_id, entreprise_cle, actif, updated_at)
    values (upper(p_projet->>'codeProjet'), coalesce(p_projet->>'client',''),
            coalesce(p_projet->>'entreprise',''), coalesce(p_projet->>'nomProjet',''),
            coalesce(p_projet->>'lieu',''), coalesce(p_projet->>'wilaya',''),
            coalesce(p_projet->>'clientId',''), coalesce(p_projet->>'entrepriseCle',''),
            coalesce((p_projet->>'actif')::boolean, true), now())
  on conflict (code_projet) do update set
    client = excluded.client, entreprise = excluded.entreprise, nom_projet = excluded.nom_projet,
    lieu = excluded.lieu, wilaya = excluded.wilaya, client_id = excluded.client_id,
    entreprise_cle = excluded.entreprise_cle, actif = excluded.actif, updated_at = now();
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_delete_projet(p_token text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  delete from public.projets where code_projet = upper(p_code);
  return json_build_object('ok', true);
end; $$;

-- Suppression d'une fiche par un ADMIN (n'importe quel statut, y compris validée).
create or replace function public.admin_delete_fiche(p_token text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  -- detache les liens de version pour ne pas laisser de reference cassee
  update public.fiches set remplacee_par = '' where remplacee_par = p_ref;
  delete from public.fiches where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

-- ============================== DROITS D'EXÉCUTION ==========================
-- La clé anon (et authenticated) ne peut appeler QUE ces fonctions.
grant execute on function
  public.op_login(text,text),
  public.op_verify(text),
  public.op_change_pin(text,text,text),
  public.op_save_fiche(text,text,text,jsonb),
  public.op_valider_fiche(text,text,text,jsonb),
  public.op_creer_version(text,text,text),
  public.op_list_fiches(text,text),
  public.op_delete_fiche(text,text),
  public.op_list_projets(text),
  public.op_list_entreprises(text),
  public.admin_list_operators(text),
  public.admin_upsert_operator(text,uuid,text,text,text,text,boolean,boolean),
  public.admin_set_operator_active(text,uuid,boolean),
  public.admin_upsert_entreprise(text,jsonb),
  public.admin_save_projet(text,jsonb),
  public.admin_delete_projet(text,text),
  public.admin_delete_fiche(text,text)
to anon, authenticated;

-- ============================== AMORÇAGE ADMIN ==============================
-- Opérateur admin par défaut : identifiant = admin  /  PIN = 1234
-- (à changer immédiatement depuis l'écran Admin de l'application).
insert into public.operators(identifiant, pin_hash, nom, fonction, is_admin, actif)
values ('admin', public._pin_hash('admin', '1234'), 'Administrateur', 'Responsable labo', true, true)
on conflict (identifiant) do nothing;

-- FIN ------------------------------------------------------------------------
