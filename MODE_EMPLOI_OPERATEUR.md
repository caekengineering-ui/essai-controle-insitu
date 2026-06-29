# Essai de contrôle in situ — Mode d'emploi

## 🔗 Adresse de l'application
**https://caekengineering-ui.github.io/essai-controle-insitu/**

## 📲 Installer sur le téléphone (recommandé)
1. Ouvrir le lien ci-dessus dans **Chrome** (Android) ou **Safari** (iPhone).
2. Menu **⋮** (ou *Partager* sur iPhone) → **« Ajouter à l'écran d'accueil »**.
3. L'application s'installe comme une vraie appli (icône CAEK). Elle fonctionne même sans réseau pour la saisie.

## 🔑 Se connecter
- Entrer son **identifiant** et son **code PIN** (fournis par le responsable).
- La connexion est gardée en mémoire ; elle est revérifiée à chaque enregistrement.

## 🧪 Réaliser un essai
1. Sur l'accueil, choisir **🛞 Essai à la plaque** ou **🧱 Essai de compacité**.
2. Suivre l'assistant :
   - **Projet** (client → projet, ou code projet) ; cocher *auto-contrôle* si le PV est à l'entête de l'entreprise.
   - **Exigences** (EV/K pour la plaque, ou taux de compactage mini pour la compacité).
   - **Ouvrage** (+ matériau en compacité).
   - **Méthodo / Proctor** (compacité : méthode de mesure + densité OPM).
   - **Sécurité** : cocher tous les points.
3. Saisir chaque point de mesure → **Afficher les résultats** → **Enregistrer & suivant**.
4. Le **GPS** : bouton « 📍 Obtenir ma position » (fonctionne sur téléphone).

## ✅ Valider et envoyer au bureau
- Aller dans **Répertoire des fiches** → ouvrir la fiche (*Brouillon achevé*) → **✅ Valider définitivement**.
- La fiche est alors **envoyée au serveur** : le bureau peut générer le PV.
- Une fiche validée n'est plus modifiable. Pour corriger : **« Créer une version corrigée »**.

## 📴 Hors-ligne
- La saisie fonctionne sans réseau. Les fiches validées hors-ligne sont **synchronisées automatiquement** dès le retour de la connexion.

---

## 👤 Pour l'administrateur
- Accès : bouton **🔐 Administration** sur l'accueil (visible uniquement pour les comptes admin).
  - **Opérateurs** : créer / activer / désactiver les comptes (identifiant + PIN).
  - **Entreprises** : identités pour l'auto-contrôle (le logo se place côté bureau dans `logos/`).
  - **Projets** : import `client.xlsx` ou ajout manuel.
- Premier compte : `admin` / `1234` → **changer le PIN immédiatement** (Profil → Changer mon PIN).

© CAEK Engineering Lab — usage interne.
