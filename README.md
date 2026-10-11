# Proof

Turn photos of official math exercise sheets into interactive practice: verbatim transcription, answer checking that reads your working, a 3-step hint ladder, a business lens per exercise, XP, career ranks and spaced review.

## Run

1. Put your Anthropic API key in `.env`: `ANTHROPIC_API_KEY=sk-ant-...` (see `.env.example`)
2. `npm install`
3. `npm start` and open http://localhost:3333

Without a key, only the built-in demo exercise works. Progress is stored in `data/db.json`; photos in `data/images/`.

## Rules of the game

- XP per part = difficulty × 10. Clean first try ×1.5. Hints: ×0.75 / ×0.5 / ×0.25. Solution shown = 0 XP.
- Daily streak: +5% per day, max +50%. Exam mode ×1.5. Twin exercises ×0.75.
- Anything solved with 2+ hints or a revealed solution returns for review after 2, 7 and 21 days.
