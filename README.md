# Proof

Transforme les photos de tes fiches d'exercices de maths officielles en entraînement interactif : transcription mot pour mot, correction intelligente qui accepte toute écriture équivalente et lit tes calculs, indices progressifs, angle business, XP, rangs de carrière et révisions espacées.

## Lancer en local

1. `npm install`
2. `npm start` puis ouvre http://localhost:3333
3. Dans **Réglages → Clés**, colle ta clé Anthropic (`sk-ant-…`). Elle reste dans ton navigateur.
   (Ou mets `ANTHROPIC_API_KEY=…` dans `.env` pour une clé côté serveur.)

La progression est enregistrée dans `data/`.

## Sur Vercel

- Clé : colle-la dans **Réglages → Clés** sur le site. Ne mets **pas** `ANTHROPIC_API_KEY` dans Vercel si l'URL est publique : n'importe qui pourrait utiliser tes crédits.
- Progression : sans base de données, Vercel l'efface au redémarrage. Projet Vercel → **Storage** → **Create Database** → **Upstash for Redis** → connecter au projet → redéployer. Proof utilise automatiquement `KV_REST_API_URL` / `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).

## Correction des réponses

1. Vérification instantanée et gratuite ([answers.js](answers.js)) : `2,5` = `5/2`, `x=2 ou x=3` = `S={3;2}`, `√2/2` = `1/√2`, `30x−1200` = `−1200+30×x`, LaTeX, unités, arrondis…
2. Si ce n'est pas tranché, ou si la question exige une forme (factoriser, valeur exacte, arrondi…), Claude juge les maths — pas la mise en forme — et pointe la première étape fausse de tes calculs.

## Règles du jeu

- XP par question = difficulté × 10. Juste du premier coup ×1,5. Indices : ×0,75 / ×0,5 / ×0,25. Corrigé affiché = 0 XP.
- Série de jours : +5 % par jour, max +50 %. Mode examen ×1,5. Exercices jumeaux ×0,75.
- Ce qui a demandé 2 indices ou plus, ou le corrigé, revient en révision après 2, 7 et 21 jours.
