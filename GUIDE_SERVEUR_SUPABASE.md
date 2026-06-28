# Configuration du serveur Supabase (gratuit) — pas à pas

Ce guide te fait créer le serveur **gratuit** qui stockera les fiches. À la fin, tu me donnes
**3 informations** et je branche l'application + les scripts Python dessus.

---

## 1. Créer un compte et un projet

1. Va sur **https://supabase.com** → **Start your project** → connecte-toi (Google ou e-mail).
2. **New project** :
   - **Name** : `caek-controle-insitu`
   - **Database Password** : choisis un mot de passe **fort** et **note-le** (tu n'en auras pas besoin pour l'app, mais garde-le).
   - **Region** : choisis la plus proche (ex. *West EU (Paris)* ou *Central EU*).
   - **Plan** : **Free**.
3. Clique **Create new project** et attends ~2 minutes que le projet soit prêt.

---

## 2. Installer le schéma (tables + sécurité)

1. Dans le menu de gauche : **SQL Editor** → **New query**.
2. Ouvre le fichier **`supabase_schema.sql`** (dans ce dossier), **copie tout** son contenu.
3. **Colle** dans l'éditeur SQL, puis clique **Run** (en bas à droite).
4. Tu dois voir *Success. No rows returned* (ou un message vert). C'est bon : tables + opérateur
   **admin** par défaut créés (**identifiant `admin` / PIN `1234`** — à changer ensuite dans l'app).

> Si une erreur apparaît, copie-la moi, je corrige.

---

## 3. Récupérer les clés (à me communiquer)

Menu de gauche : **Project Settings** (roue dentée) → **API**.

Note ces **3 éléments** :

| Élément | Où | Pour quoi | Secret ? |
|---|---|---|---|
| **Project URL** | en haut (ex. `https://xxxx.supabase.co`) | app + Python | non |
| **Clé `anon` `public`** | section *Project API keys* | l'**application** (PWA) | non (publique) |
| **Clé `service_role` `secret`** | section *Project API keys* (clique pour révéler) | le **Python** (bureau) | **OUI — secrète** |

⚠️ La clé **service_role** ne doit **jamais** être mise dans l'application ni publiée sur GitHub.
Elle restera uniquement sur l'ordinateur du bureau (fichier `server_config.json`, ignoré par git).

---

## 4. Me transmettre

Copie-moi simplement :

```
URL        = https://xxxx.supabase.co
ANON       = eyJ... (clé anon public)
SERVICE    = eyJ... (clé service_role secret)
```

Dès que je les ai :
- je renseigne la clé **anon** + l'URL dans l'app (`js/config.js`) ;
- je crée `server_config.json` (URL + **service_role**) côté bureau pour Python ;
- on teste : connexion `admin` / `1234`, un essai validé → fiche sur le serveur → PV généré par Python.

---

## Notes
- **Plan gratuit** : 500 Mo de base + accès illimité en lecture/écriture via l'API — large pour des fiches d'essai.
- **Sécurité** : l'app n'accède aux données qu'à travers des fonctions vérifiant le **token d'opérateur** ;
  la clé anon seule ne permet pas de lire/écrire les tables directement.
- **Premier admin** : `admin` / `1234`. Connecte-toi, va dans **Admin → Opérateurs**, change le PIN et crée
  les comptes des opérateurs de terrain.
