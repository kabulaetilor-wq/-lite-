# Élite Sniper

Jeu de tireur d'élite en 3D (Three.js), empaqueté en application Android avec Capacitor.
L'APK est compilé automatiquement par GitHub Actions.

## Obtenir l'APK (GitHub Actions)

1. Créez un dépôt GitHub et poussez-y tout le contenu de ce dossier (y compris `.github/`).
2. Allez dans l'onglet **Actions** → workflow **Build Android APK** (il démarre à chaque push, ou via **Run workflow**).
3. Une fois terminé, téléchargez l'artefact **elite-sniper-apk** → `app-debug.apk`.
4. Copiez l'APK sur le téléphone et installez-le (autorisez les sources inconnues).

## Tester sur PC

```bash
npm install
npm run dev
```

## Structure

- `src/main.js` : boucle de jeu, visée, balistique, missions, HUD
- `src/world.js` : terrain, ciel, tour, bâtiments, arbres, rochers
- `src/enemy.js` : ennemis (patrouille, alerte, tir)
- `src/missions.js` : définition des 5 missions
- `src/audio.js` : sons synthétisés
- `android-overrides/MainActivity.java` : plein écran immersif (copié par le workflow)
- `.github/workflows/android-build.yml` : build de l'APK

## Contrôles

Mobile : glisser = viser · LUNETTE · ZOOM (4x/8x/12x) · RETENIR SOUFFLE · TIR · RECHARGER.
PC : clic = verrouiller la souris / tirer · clic droit ou X = lunette · Z = zoom · Maj = souffle · R = recharger · Échap = pause.

## Gameplay

- Chute de balle et vent simulés (flèche du vent en haut à gauche, repères de chute dans la lunette).
- Un tir attire l'attention des ennemis proches ; les ennemis alertés (« ! ») ripostent.
- Têtes = mort instantanée, bonus de distance, ralenti sur les tirs à la tête lointains.
