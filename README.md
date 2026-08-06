# Gestio — Coffre-fort de mots de passe

Application locale et chiffrée pour gérer tes mots de passe. Un seul **mot de passe maître**
déverrouille toutes tes notes (titre, identifiant, mot de passe, site, remarques), avec **recherche**.

- 🔒 **Chiffrement AES-256-GCM**, clé dérivée par **PBKDF2** (300 000 itérations).
- 📴 **100 % hors-ligne** — rien ne quitte l'appareil, aucun compte, aucun serveur.
- 📱 **Windows + Android** avec le même code (application web installable / PWA).
- ⇅ **Synchro manuelle** que tu contrôles : export/import d'un fichier chiffré.

> ⚠️ **Important :** ton mot de passe maître n'est stocké nulle part. Si tu l'oublies,
> tes données sont **définitivement irrécupérables**. Note-le en lieu sûr.

---

## Lancer l'application sur Windows

1. Double-clique sur **`serve.ps1`** → *« Exécuter avec PowerShell »*.
   (Ou dans un terminal : `powershell -ExecutionPolicy Bypass -File .\serve.ps1`)
2. Ton navigateur s'ouvre sur `http://localhost:8080`.
3. Dans **Chrome** ou **Edge**, clique sur l'icône **Installer** dans la barre d'adresse
   (ou menu ⋮ → *Installer Gestio*). L'app s'ouvre alors dans sa propre fenêtre, comme un vrai logiciel.

Une fois installée, elle fonctionne même sans lancer le serveur (mise en cache hors-ligne).
Pour arrêter le serveur : ferme la fenêtre PowerShell.

## Installer sur Android

Pour installer une PWA, Android a besoin d'une adresse **https** ou d'un hébergement.
Le plus simple :

1. Copie le dossier `Gestio` sur un hébergement statique gratuit (par ex. **GitHub Pages**,
   **Netlify Drop**, **Cloudflare Pages**) — ce sont des fichiers statiques, aucun backend requis.
2. Ouvre l'adresse https obtenue dans **Chrome Android**.
3. Menu ⋮ → **Ajouter à l'écran d'accueil** / **Installer l'application**.

> Astuce : héberge une fois, et tu peux installer aussi bien sur Windows que sur Android
> depuis la même adresse.

---

## Synchroniser Windows ↔ Android (manuel)

Tu gardes la main : rien n'est synchronisé automatiquement.

1. Sur l'appareil A : bouton **⇅** → **Exporter le coffre chiffré**.
   → tu obtiens un fichier `gestio-coffre-AAAAMMJJ.json` (illisible sans ton mot de passe maître).
2. Transfère ce fichier vers l'appareil B (câble USB, Google Drive, e-mail à toi-même…).
3. Sur l'appareil B : bouton **⇅** → **Choisir un fichier coffre…**, saisis ton mot de passe
   maître, puis choisis :
   - **Fusionner** (recommandé) : ajoute les nouvelles notes et met à jour les plus récentes.
   - **Remplacer tout** : écrase le coffre local par le fichier.

Comme le fichier est chiffré, il reste sûr même s'il passe par le cloud ou l'e-mail.

---

## Sauvegarde

Le coffre est stocké dans le navigateur (localStorage). **Exporte régulièrement** un fichier
coffre et range-le en lieu sûr : c'est ta sauvegarde. Vider les données du navigateur efface
le coffre local — mais un fichier exporté permet toujours de tout restaurer.

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de l'interface |
| `styles.css` | Apparence |
| `app.js` | Logique : chiffrement, coffre, notes, recherche, synchro |
| `sw.js` | Service worker (fonctionnement hors-ligne) |
| `manifest.webmanifest` | Rend l'app installable |
| `icon.svg` | Icône de l'application |
| `serve.ps1` | Petit serveur local pour lancer l'app sur Windows |

## Sécurité — en bref

- La clé de chiffrement n'existe qu'en mémoire, le temps de la session ; elle est effacée au
  verrouillage et au bout de **5 minutes d'inactivité** (verrouillage automatique).
- Le mot de passe maître n'est jamais enregistré, ni en clair ni sous forme de « hash de vérification » :
  un mauvais mot de passe échoue simplement au déchiffrement.
- Aucune dépendance externe, aucune connexion réseau.
