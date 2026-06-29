-- ============================================================================
--  Suivi de livraison des PV (tableau de bord bureau).
--  À exécuter une fois dans Supabase -> SQL Editor.
--  (Déjà inclus dans supabase_schema.sql pour les installations neuves.)
-- ============================================================================
alter table public.fiches add column if not exists pv_livre      boolean    default false;
alter table public.fiches add column if not exists pv_genere_at   timestamptz;
alter table public.fiches add column if not exists pv_livre_at    timestamptz;
