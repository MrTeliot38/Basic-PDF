# Basic PDF

**Basic PDF** est un lecteur et éditeur de PDF complet, **100 % gratuit**, **sans publicité**, **sans compte** et **100 % hors ligne** (projet personnel ouvert à tous).

Vos documents restent strictement sur votre appareil : aucune donnée n’est envoyée sur Internet (seule une vérification facultative et manuelle des nouvelles versions sur GitHub est proposée, avec contrôle d’intégrité **SHA-256**).

---

## Fonctions principales

- **Lecture confortable** : onglets indépendants (`Ctrl+Tab`, `Ctrl+W`), miniatures, recherche et « Rechercher et remplacer », thème clair / sombre, zoom tactile et molette.
- **Édition de texte avec fond préservé** : correction directe du texte PDF tout en conservant fidèlement la couleur de fond, les encadrés et les dégradés.
- **OCR hors ligne (français)** : lecture automatique des scans et documents multi-colonnes sans mélanger les colonnes, avec recherche automatique de la police la plus proche sous Windows.
- **Images, formulaires, signatures et annotations** : déplacement/rotation/remplacement d’images (sans sélectionner l’image de fond sous le texte), signature mémorisée, formulaires, caviardage irréversible.
- **Pages, impression & partage** : ajouter, pivoter, extraire, diviser, fusionner, exporter en JPG/PNG, compresser, imprimer (aperçu livret / plusieurs pages par feuille), partager par e-mail ou WhatsApp.
- **Scanner de documents intégré (Android & navigateur)** : cadre bleu en direct autour de la feuille, redressement de perspective, recadrage 4 coins, noir et blanc / couleur / gris, 3 niveaux de qualité, multi-pages.

---

## Plateformes disponibles

1. **Application Web (PWA)** : installable directement depuis le navigateur sur ordinateur et téléphone.
2. **Windows (`.exe`)** : installateur sans droits administrateur (`per-user`), polices Windows installées intégrées dans le PDF, ouverture par double-clic depuis l’Explorateur et mise à jour par-dessus l’ancienne version.
3. **Android (`.apk`, Android 7 et plus)** : scanner de documents intégré, ouverture des PDF depuis WhatsApp/Gmail/Mes fichiers, réglage en lecteur PDF par défaut et enregistrement anti-fichier vide (0 Ko).

---

## Sécurité et clé de signature Android

- La clé privée Android (`*.jks`, `*.keystore`, `android/keystore.properties`) est **strictement exclue de Git** par `.gitignore`.
- Pour que GitHub Actions signe automatiquement vos futures versions avec **votre** clé (afin que les mises à jour s’installent par-dessus l’ancienne version sur téléphone), conservez une copie hors ligne de votre `.jks` (clé USB, gestionnaire de mots de passe) et configurez les secrets GitHub du dépôt (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
- Code source distribué sous licence libre [MIT](LICENSE).
