-- ============================================================================
--  Colonnes projet : contrôle (Oui/Non) + maître d'ouvrage (auto-contrôle).
--  À exécuter une fois dans Supabase -> SQL Editor -> Create new snippet -> Run.
--  (Déjà inclus dans supabase_schema.sql pour les installations neuves.)
--  controle = true  -> contrôle (entête CAEK, on désigne le client, pas de maître d'ouvrage)
--  controle = false -> auto-contrôle (entête entreprise = le client, maître d'ouvrage requis)
-- ============================================================================
alter table public.projets add column if not exists controle       boolean default false;
alter table public.projets add column if not exists maitre_ouvrage text    default '';
