# Essai de contrôle in situ — CAEK Engineering Lab

Application web (PWA) de terrain regroupant **quatre modules** :

- 🛞 **Essai à la plaque** (EV2 Ø600, NF P94-117-1)
- 🧱 **Essai de compacité** (taux de compactage, NF P94-061-1/-2/-3 selon la méthode)
- ⚓ **Essai d'arrachement sur clous d'ancrage** (NF P94-242-1, XP P94-444, NF EN 14490)
- ☀️ **Contrôle de fondation photovoltaïque CFMS** (5 % ELS / 1 min → décharge → 110 % ELS / 5 min → décharge)

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

Sur une installation **déjà en service**, exécuter en plus `supabase_add_arrachement.sql`
(numérotation `QC/ARR/` + index). Aucune migration de table : `fiches.type` est un texte libre
et le `payload` un `jsonb`.

Pour activer la numérotation photovoltaïque indépendante (`QC/CFMS/<CODE>NN`),
exécuter également `supabase_add_cfms.sql` dans Supabase.

## Module arrachement — repères métier
- Références : `QC/ARR/<CODE><NN>`. Une fiche = une campagne, un « essai » = un clou.
- **Effort → pression** : `P [MPa] = F [kN] × 10 / A [cm²]`, soit `P [bar] = F [kN] × 100 / A [cm²]`.
  Contrôle : 40 kN sur RCH-302 → 8,59 MPa = 85,9 bar. Si une courbe d'étalonnage de l'exemplaire
  (`F = a·P + b`) est renseignée, **elle prime** et le PV l'indique.
- **Origine des déplacements** : la dernière lecture du **palier de serrage Pa**, jamais l'effort nul.
- **Fluage** : `α = [y(t₂) − y(t₁)] / log₁₀(t₂/t₁)` mm/décade (t₁ = 1 min, t₂ = 5 min → α = 1,43 × [y(5) − y(1)]).
- **Détection de stabilisation** : suggestion seulement, jamais automatique, et **jamais sur le palier final**.
- **Catalogue vérins** : donnée modifiable dans `js/calc_arrachement.js` (`VERINS_BASE`), extensible
  par `ArrachementCalc.setVerinsSup()`.
- **Photos** : stockées à part en IndexedDB (store `photos`), jointes au payload **à la validation**
  seulement, pour ne pas saturer une liaison de chantier à chaque enregistrement de brouillon.
- **Traçabilité** : aucune lecture n'est écrasée — une correction est un événement horodaté qui
  conserve la valeur d'origine et son motif.

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
