# Essai de contrôle in situ — CAEK Engineering Lab

Application web (PWA) de terrain regroupant **deux essais** :

- 🛞 **Essai à la plaque** (EV2 Ø600, NF P94-117-1)
- 🧱 **Essai de compacité** (taux de compactage, NF P94-061-1/-2/-3 selon la méthode)

Les fiches validées sont **enregistrées sur un serveur** (Supabase) — elles ne dépendent
plus du cache du navigateur et sont **partagées** entre tous les opérateurs. Au bureau,
un script Python lit ces fiches et génère **le PV PDF** (plus besoin du modèle Excel).

## Connexion
Chaque opérateur se connecte avec **identifiant + code PIN** (vérifié à chaque enregistrement).
Les comptes sont gérés dans **Admin → Opérateurs** (réservé aux administrateurs).
Admin par défaut : `admin` / `1234` (à changer immédiatement).

## Configuration serveur
Voir **GUIDE_SERVEUR_SUPABASE.md** : créer le projet Supabase, exécuter `supabase_schema.sql`,
puis renseigner `js/config.js` (URL + clé `anon`).

## Fonctionnement
1. L'opérateur choisit un module, suit l'assistant (projet → exigences → ouvrage → méthodo → sécurité),
   saisit les points, puis **valide** la fiche → envoi automatique au serveur.
2. Hors-ligne : la saisie reste possible ; les fiches sont **mises en file d'attente** et
   synchronisées au retour du réseau.
3. Une fiche **validée est verrouillée** (traçabilité : opérateur, date, version). Pour la corriger,
   utiliser **« Créer une version corrigée »** (nouvelle version, l'ancienne est archivée).

## Technique
- HTML/CSS/JS vanilla, IndexedDB (cache + file d'attente), Supabase (RPC via fetch), SheetJS (import projets).
- PWA installable, hors-ligne pour la saisie. Hébergée sur GitHub Pages (HTTPS requis pour le GPS).

## Génération des PV (bureau)
Voir, dans le dossier parent `Essai insitu/`, le fichier **LISEZMOI_SERVEUR_PV.txt** et le script
`generer_pv_serveur.py`.

---
© CAEK Engineering Lab — usage interne.
