// Proof — turn photos of official math exercises into interactive, XP-tracked practice.
import express from "express";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createStore } from "./store.js";
import { smartCheck } from "./answers.js";

try { process.loadEnvFile(".env"); } catch {}

const PORT = process.env.PORT || 3333;
const MODEL = "claude-opus-5-5";
const DB_VERSION = 2;
const store = await createStore();

// ---------- Career ladder ----------
const LEVELS = [
  { rank: "Stagiaire", xp: 0, unlock: "Indices, corrigés, angle business" },
  { rank: "Analyste", xp: 200, unlock: "Thème doré + statistiques du carnet d'erreurs" },
  { rank: "Associé", xp: 600, unlock: "Exercices jumeaux — même exercice, nouveaux nombres" },
  { rank: "Manager", xp: 1500, unlock: "Mode examen — sans indices, chrono, ×1,5 XP" },
  { rank: "Directeur", xp: 3000, unlock: "Thème émeraude" },
  { rank: "Vice-président", xp: 5500, unlock: "Ton palier de récompense perso : prévois quelque chose de grand" },
  { rank: "Directeur financier", xp: 9000, unlock: "Thème rubis" },
  { rank: "PDG", xp: 14000, unlock: "Titre de PDG sur ton profil" },
  { rank: "Fondateur", xp: 21000, unlock: "Titre de Fondateur" },
  { rank: "Investisseur", xp: 30000, unlock: "Tu as réussi. Apprends à quelqu'un d'autre." },
];
const levelOf = (xp) => LEVELS.reduce((acc, l, i) => (xp >= l.xp ? i : acc), 0);
const UNLOCK = { twin: 2, exam: 3 };

// ---------- Data ----------
let db;
function emptyDb() {
  return {
    version: DB_VERSION,
    profile: { xp: 0, streak: { count: 0, lastDay: null }, daily: {}, settings: { lang: "Français" }, rewards: [], mistakes: [] },
    sheets: [demoSheet()],
  };
}
async function loadDb() {
  db = (await store.load()) || emptyDb();
  if (db.version !== DB_VERSION) {
    db.version = DB_VERSION;
    db.profile.settings.lang = "Français";
    db.sheets = [...db.sheets.filter((s) => !s.demo), demoSheet()];
  }
}
// Re-read after a slow AI call so we don't overwrite changes made meanwhile (matters with Redis).
async function reload() { if (store.kind === "redis") await loadDb(); }

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const id = () => crypto.randomBytes(5).toString("hex");
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function freshPart() { return { attempts: 0, hintsUsed: 0, revealed: false, solved: false, xp: 0, feedback: null }; }
function findEx(sheetId, exId) {
  const sheet = db.sheets.find((s) => s.id === sheetId);
  const ex = sheet?.exercises.find((e) => e.id === exId);
  if (!ex) throw httpError(404, "Exercice introuvable");
  return { sheet, ex };
}

// ---------- XP engine ----------
const HINT_MULT = [1, 0.75, 0.5, 0.25];
function streakMult() { return 1 + Math.min(db.profile.streak.count, 10) * 0.05; }
function touchStreak() {
  const s = db.profile.streak, t = today();
  if (s.lastDay === t) return;
  s.count = s.lastDay === addDays(t, -1) ? s.count + 1 : 1;
  s.lastDay = t;
}
function award(ex, st) {
  touchStreak();
  const base = 10 * ex.difficulty;
  const clean = st.attempts === 1 && st.hintsUsed === 0;
  let xp = base * HINT_MULT[st.hintsUsed] * (clean ? 1.5 : 1) * streakMult();
  if (ex.exam) xp *= 1.5;
  if (ex.generated) xp *= 0.75;
  xp = Math.round(xp);
  const before = levelOf(db.profile.xp);
  db.profile.xp += xp;
  db.profile.daily[today()] = (db.profile.daily[today()] || 0) + xp;
  return { xp, clean, levelUp: levelOf(db.profile.xp) > before ? LEVELS[levelOf(db.profile.xp)] : null };
}
// Spaced repetition: anything you needed a lot of help on comes back later.
function afterExerciseDone(ex) {
  const helped = ex.state.some((s) => s.revealed || s.hintsUsed >= 2);
  const INTERVALS = [2, 7, 21];
  if (ex.review?.active) {
    const stage = helped ? 0 : ex.review.stage + 1;
    ex.review = stage >= INTERVALS.length ? { mastered: true } : { stage, due: addDays(today(), INTERVALS[stage]) };
  } else if (helped) {
    ex.review = { stage: 0, due: addDays(today(), INTERVALS[0]) };
  }
  ex.exam = null;
}

// ---------- Claude ----------
// The key comes from the browser (Réglages → Clés) or from the server's ANTHROPIC_API_KEY.
const keyOf = (req) => req.get("x-anthropic-key")?.trim() || process.env.ANTHROPIC_API_KEY;
const NO_KEY = "Ajoute ta clé Anthropic dans Réglages → Clés pour utiliser l'IA.";

function obj(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
const str = { type: "string" };
const arr = (items) => ({ type: "array", items });

async function ask(req, { system, content, schema, effort = "high" }) {
  const apiKey = keyOf(req);
  if (!apiKey) throw httpError(401, NO_KEY);
  const stream = new Anthropic({ apiKey }).beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema } },
  });
  const res = await stream.finalMessage();
  if (res.stop_reason === "refusal") throw httpError(502, "Le modèle a refusé cette demande.");
  if (res.stop_reason === "max_tokens") throw httpError(502, "Réponse coupée — essaie une photo avec moins d'exercices.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}
async function imageBlock(name) {
  const buf = await store.getImage(name);
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } };
}
const langOf = (sheet) =>
  db.profile.settings.lang === "auto" ? `the same language as the exercise (${sheet.language})` : db.profile.settings.lang;

const EX_FIELDS = {
  number: { ...str, description: "Official exercise number/label as printed, e.g. '3' or '12a'" },
  title: { ...str, description: "Short title, 2-5 words, in the exercise's language" },
  topic: { ...str, description: "Math topic in French, e.g. 'Équations du premier degré', 'Pourcentages', 'Fonctions du second degré'" },
  difficulty: { type: "integer", enum: [1, 2, 3, 4, 5] },
  statement: { ...str, description: "Shared statement/intro text, verbatim, Markdown + LaTeX ($...$ inline, $$...$$ display)" },
  figure: { ...str, description: "Precise description of any figure/graph; tables as Markdown. Empty string if none." },
  parts: arr(obj({ label: { ...str, description: "e.g. 'a)', '1.', or '' if single question" }, prompt: { ...str, description: "Verbatim sub-question, Markdown + LaTeX" } })),
};

const EXTRACT_SYSTEM = `You transcribe photos of official school math exercise sheets into structured data.
Rules — trust is the whole point of this app:
- Transcribe word for word in the original language. Never simplify, paraphrase, solve, or change a number.
- Math goes in LaTeX: $...$ inline, $$...$$ display.
- Split each exercise into its official sub-questions. If it has none, use one part with label "".
- If text is illegible, write [illisible] rather than guessing.
- If a figure, graph or table is needed to solve it, describe it precisely in "figure" (tables as Markdown).
- bbox: the exercise's location on the photo as fractions (0-1) of image width/height, generous rather than tight.
- Include every exercise visible, even partially cut ones (mark missing text [coupé]).`;

const PREP_PART = obj({
  answer: { ...str, description: "Final answer, concise, LaTeX allowed" },
  accept: { ...arr(str), description: "Machine-checkable plain-text forms of the final answer, ONE ENTRY PER SOLUTION/VALUE, using * ^ / sqrt() pi exp() log() and '.' decimals. Examples: ['x=2','x=-3'] for two solutions; ['30*x-1200'] for an expression; ['sqrt(2)/2']; ['x=1','y=2'] for a system. Exact values when possible. Empty array if the answer is not a value or expression (proof, justification, sentence, graph, interval, inequality, table)." },
  formMatters: { type: "boolean", description: "true if the question demands a specific form that an equivalent value would not satisfy: factoriser, développer, réduire, simplifier, forme canonique, valeur exacte, arrondir/donner une valeur approchée à ..., écriture scientifique, fraction irréductible." },
  hints: { ...arr(str), description: "Exactly 3 hints: 1) nudge — what to notice / which concept, 2) method — which tool and how to set it up, 3) first concrete step worked out, stopping well before the answer" },
  solution: { ...str, description: "Full step-by-step solution, Markdown + LaTeX, each step on its own line" },
  commonMistake: str,
});
const PREP_SCHEMA = obj({
  parts: arr(PREP_PART),
  businessLens: obj({
    concept: { ...str, description: "The math idea in one phrase" },
    scenario: { ...str, description: "A concrete business mini-case with real-looking numbers (in euros) that uses exactly this math (3-5 sentences)" },
    takeaway: { ...str, description: "One-line business lesson" },
  }),
});

async function prepare(req, sheetId, exId) {
  let { sheet, ex } = findEx(sheetId, exId);
  if (ex.prepared) return;
  const r = await ask(req, {
    effort: "high",
    system: `You are a rigorous math tutor preparing an official exercise for a student who is struggling and wants real progress.
Solve every part carefully, then verify (substitute back, check domain, units, signs). Accuracy matters more than speed.
Hints climb a ladder and never give away the final answer. Solutions are clear enough for a struggling student to follow line by line, using French school conventions and notation (virgule décimale, S = {…}, etc.).
The business lens shows honestly where this exact math shows up in business (pricing, margins, growth, break-even, interest, forecasting, logistics, statistics...). If the link is weak, pick the most honest application rather than forcing one.
Write everything in ${langOf(sheet)} (except the "accept" field, which is plain machine-readable math). Return one entry in "parts" per part, in order.`,
    content: [
      ...(sheet.image && !ex.generated ? [await imageBlock(sheet.image)] : []),
      { type: "text", text: `Exercise ${ex.number} (transcription of the photo):\n${JSON.stringify({ statement: ex.statement, figure: ex.figure, parts: ex.parts.map((p) => ({ label: p.label, prompt: p.prompt })) }, null, 2)}` },
    ],
    schema: PREP_SCHEMA,
  });
  await reload();
  ({ ex } = findEx(sheetId, exId));
  ex.parts.forEach((p, i) => Object.assign(p, r.parts[i] || {}));
  ex.businessLens = r.businessLens;
  ex.prepared = true;
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));
// On Vercel, public/ is served by the CDN (not bundled with this function), which only maps /index.html.
if (process.env.VERCEL) app.get("/", (req, res) => res.redirect("/index.html"));

app.get("/images/:name", async (req, res) => {
  const buf = await store.getImage(req.params.name);
  if (!buf) return res.sendStatus(404);
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" }).send(buf);
});

const route = (fn) => async (req, res) => {
  try {
    await loadDb();
    const out = await fn(req, res);
    if (req.method !== "GET") await store.save(db);
    res.json(out);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Anthropic.AuthenticationError ? "Clé Anthropic refusée — vérifie-la dans Réglages → Clés."
      : e instanceof Anthropic.RateLimitError ? "Trop de requêtes — réessaie dans un instant."
      : e instanceof Anthropic.APIConnectionError ? "Impossible de joindre l'API Anthropic."
      : e.message;
    res.status(e.status && e.status < 600 ? e.status : 500).json({ error: msg });
  }
};

// Strip answers/solutions/hints the student hasn't earned before sending to the browser.
function publicEx(ex) {
  return {
    ...ex,
    parts: ex.parts.map((p, i) => {
      const st = ex.state[i], open = st.solved || st.revealed;
      return {
        label: p.label, prompt: p.prompt,
        hints: (p.hints || []).slice(0, st.hintsUsed),
        answer: open ? p.answer : undefined,
        solution: open ? p.solution : undefined,
        commonMistake: open ? p.commonMistake : undefined,
      };
    }),
  };
}
function state(req) {
  const p = db.profile, t = today();
  if (p.streak.lastDay && p.streak.lastDay < addDays(t, -1)) p.streak.count = 0;
  return {
    profile: p, levels: LEVELS, level: levelOf(p.xp), unlocks: UNLOCK, today: t,
    keys: { server: !!process.env.ANTHROPIC_API_KEY, browser: !!req.get("x-anthropic-key"), storage: store.kind },
    sheets: db.sheets.map((s) => ({ ...s, exercises: s.exercises.map(publicEx) })),
  };
}

app.get("/api/state", route((req) => state(req)));

app.post("/api/sheets", route(async (req) => {
  const m = /^data:image\/\w+;base64,(.+)$/.exec(req.body.image || "");
  if (!m) throw httpError(400, "Envoie une image JPEG/PNG");
  if (!keyOf(req)) throw httpError(401, NO_KEY);
  const sheet = { id: id(), createdAt: new Date().toISOString(), image: `${id()}.jpg` };
  await store.putImage(sheet.image, Buffer.from(m[1], "base64"));
  try {
    const r = await ask(req, {
      effort: "high",
      system: EXTRACT_SYSTEM,
      content: [await imageBlock(sheet.image), { type: "text", text: "Transcribe every exercise on this sheet." }],
      schema: obj({
        title: { ...str, description: "Sheet title, e.g. chapter name, or a short descriptive title, in the sheet's language" },
        language: str,
        exercises: arr(obj({ ...EX_FIELDS, bbox: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }) })),
      }),
    });
    if (!r.exercises.length) throw httpError(422, "Aucun exercice trouvé sur cette photo.");
    Object.assign(sheet, { title: r.title, language: r.language });
    sheet.exercises = r.exercises.map((e) => ({ ...e, id: id(), state: e.parts.map(freshPart), prepared: false }));
  } catch (e) {
    await store.delImage(sheet.image);
    throw e;
  }
  await reload();
  db.sheets.unshift(sheet);
  return state(req);
}));

app.delete("/api/sheets/:id", route(async (req) => {
  const s = db.sheets.find((x) => x.id === req.params.id);
  if (s?.image) await store.delImage(s.image);
  db.sheets = db.sheets.filter((x) => x.id !== req.params.id);
  return state(req);
}));

app.post("/api/ex/:s/:e/prepare", route(async (req) => {
  await prepare(req, req.params.s, req.params.e);
  return state(req);
}));

const GRADE_SCHEMA = obj({
  verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
  feedback: str,
  mistakeType: { type: "string", enum: ["aucune", "calcul", "signe", "notion", "méthode", "lecture de l'énoncé", "incomplet", "notation"] },
});

app.post("/api/ex/:s/:e/check", route(async (req) => {
  const { s, e } = req.params, i = req.body.part;
  const answer = String(req.body.answer || "").trim(), work = String(req.body.work || "").trim();
  if (!answer) throw httpError(400, "Écris d'abord une réponse");
  let { sheet, ex } = findEx(s, e);
  if (ex.state[i].solved || ex.state[i].revealed) throw httpError(400, "Cette question est déjà terminée");
  if (!ex.prepared) { await prepare(req, s, e); ({ sheet, ex } = findEx(s, e)); }
  const part = ex.parts[i];

  // 1) Instant, free equivalence check: accepts any notation of the right value/expression.
  const local = smartCheck(answer, part.accept);
  let g;
  if (local === "correct" && !part.formMatters) {
    g = { verdict: "correct", feedback: "", mistakeType: "aucune" };
  } else if (keyOf(req) && !ex.demo) {
    // 2) Claude reads the answer and the working, judging the maths rather than the formatting.
    g = await ask(req, {
      effort: "medium",
      system: `You grade a student's answer to one part of an official math exercise (French school). You get the statement, the verified reference answer and solution.
Judge the MATHEMATICS, never the formatting. Accept any equivalent way of writing it: decimal comma or point, fraction vs decimal, solutions in any order, "x=2 ou x=3" / "S={2;3}" / "2 et 3", with or without "x =", plain-text math (sqrt(2), x^2, 2pi), LaTeX, typos in notation that don't change the meaning, with or without units unless the question explicitly asks for them.
verdict:
- "correct": mathematically equivalent to the reference. Sensible rounding is fine unless an exact value or a specific precision is required.
- "partial": right value but the question explicitly demands a form that isn't met (factorised, developed, exact value, rounding to a given precision, irreducible fraction…), or some solutions missing.
- "incorrect": mathematically different.
An automatic equivalence checker said: "${local}" (correct = proven equal in value, different = readable but not equal, unknown = could not read). Trust it on values, but you decide about required forms.
If the student showed work, find the FIRST wrong step and point to it precisely. Feedback is 1-3 sentences, specific, honest, encouraging.
NEVER reveal the reference answer, nor the result of the step they got wrong. Write feedback in ${langOf(sheet)}.`,
      content: [{ type: "text", text: JSON.stringify({ statement: ex.statement, figure: ex.figure, question: part.prompt, referenceAnswer: part.answer, referenceSolution: part.solution, studentAnswer: answer, studentWork: work || "(pas de calculs montrés)" }, null, 2) }],
      schema: GRADE_SCHEMA,
    });
  } else if (local === "unknown" || (part.formMatters && !ex.demo)) {
    throw httpError(422, part.formMatters && !ex.demo
      ? "Cette question demande une forme précise : ajoute ta clé Anthropic (Réglages → Clés) pour la correction."
      : "Je n'arrive pas à lire ta réponse. Écris-la par exemple : x = 3/2, 2,5, S = {1 ; 4} ou 30x − 1200.");
  } else {
    g = { verdict: local === "correct" ? "correct" : "incorrect", mistakeType: "calcul",
      feedback: "Ta réponse n'a pas la bonne valeur. Vérifie tes calculs ou prends un indice." };
  }

  await reload();
  ({ sheet, ex } = findEx(s, e));
  const st = ex.state[i];
  st.attempts++;
  st.feedback = { verdict: g.verdict, text: g.feedback };
  let reward = null;
  if (g.verdict === "correct") {
    st.solved = true;
    reward = award(ex, st);
    st.xp = reward.xp;
    if (ex.state.every((x) => x.solved || x.revealed)) afterExerciseDone(ex);
  } else {
    db.profile.mistakes.unshift({ day: today(), topic: ex.topic, type: g.mistakeType, exercise: `${sheet.title} · Ex. ${ex.number}${part.label ? " " + part.label : ""}`, note: g.feedback });
    db.profile.mistakes = db.profile.mistakes.slice(0, 200);
  }
  return { ...state(req), result: { verdict: g.verdict, reward } };
}));

app.post("/api/ex/:s/:e/hint", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  const st = ex.state[req.body.part];
  if (ex.exam) throw httpError(400, "Pas d'indices en mode examen");
  if (st.hintsUsed < 3) st.hintsUsed++;
  return state(req);
}));

app.post("/api/ex/:s/:e/reveal", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  if (ex.exam) throw httpError(400, "Pas de corrigé en mode examen");
  ex.state[req.body.part].revealed = true;
  if (ex.state.every((s) => s.solved || s.revealed)) afterExerciseDone(ex);
  return state(req);
}));

app.post("/api/ex/:s/:e/retry", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  ex.history = [...(ex.history || []), { day: today(), state: ex.state }];
  ex.state = ex.parts.map(freshPart);
  if (ex.review && !ex.review.mastered) ex.review.active = true;
  return state(req);
}));

app.post("/api/ex/:s/:e/exam", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  if (req.body.on) {
    if (levelOf(db.profile.xp) < UNLOCK.exam) throw httpError(403, `Le mode examen se débloque au rang ${LEVELS[UNLOCK.exam].rank}`);
    if (ex.state.some((s) => s.attempts || s.hintsUsed || s.revealed)) throw httpError(400, "Lance le mode examen sur une tentative neuve (utilise Recommencer)");
    ex.exam = { startedAt: Date.now() };
  } else ex.exam = null;
  return state(req);
}));

app.post("/api/ex/:s/:e/twin", route(async (req) => {
  const { s, e } = req.params;
  let { sheet, ex } = findEx(s, e);
  if (levelOf(db.profile.xp) < UNLOCK.twin) throw httpError(403, `Les exercices jumeaux se débloquent au rang ${LEVELS[UNLOCK.twin].rank}`);
  const t = await ask(req, {
    effort: "medium",
    system: `You write one new practice exercise that is a twin of an official one: same structure, same skills, same number of parts, same difficulty, same style and language as the original (${sheet.language}), but different numbers and context. Make the numbers work out as cleanly as in the original. Markdown + LaTeX.`,
    content: [{ type: "text", text: JSON.stringify({ statement: ex.statement, figure: ex.figure, parts: ex.parts.map((p) => ({ label: p.label, prompt: p.prompt })) }, null, 2) }],
    schema: obj(EX_FIELDS),
  });
  await reload();
  ({ sheet, ex } = findEx(s, e));
  const twin = { ...t, id: id(), number: `${ex.number}′`, generated: true, twinOf: ex.id, state: t.parts.map(freshPart), prepared: false };
  sheet.exercises.splice(sheet.exercises.indexOf(ex) + 1, 0, twin);
  return { ...state(req), twinId: twin.id };
}));

app.post("/api/settings", route((req) => {
  const { lang, theme } = req.body;
  if (lang) db.profile.settings.lang = String(lang);
  if (theme) db.profile.settings.theme = String(theme);
  return state(req);
}));
app.post("/api/rewards", route((req) => {
  const title = String(req.body.title || "").trim(), xp = Math.max(1, Number(req.body.xp) | 0);
  if (!title) throw httpError(400, "Donne un nom à ta récompense");
  db.profile.rewards.push({ id: id(), title, xp, claimed: null });
  db.profile.rewards.sort((a, b) => a.xp - b.xp);
  return state(req);
}));
app.post("/api/rewards/:id/claim", route((req) => {
  const r = db.profile.rewards.find((x) => x.id === req.params.id);
  if (!r || db.profile.xp < r.xp) throw httpError(400, "Pas encore débloquée");
  r.claimed = today();
  return state(req);
}));
app.delete("/api/rewards/:id", route((req) => {
  db.profile.rewards = db.profile.rewards.filter((x) => x.id !== req.params.id);
  return state(req);
}));

app.listen(PORT, () => console.log(`Proof → http://localhost:${PORT} (stockage : ${store.kind})`));

// ---------- Demo content (works without an API key) ----------
function demoSheet() {
  const ex = {
    id: "demo1", demo: true, prepared: true, number: "1", title: "Seuil de rentabilité", topic: "Équations du premier degré", difficulty: 2,
    statement: "Un petit atelier fabrique des supports de téléphone en bois. Les charges fixes mensuelles s'élèvent à $1\\,200$ €. Chaque support coûte $18$ € de matériaux et est vendu $48$ €.",
    figure: "",
    parts: [
      { label: "a)", prompt: "Exprimer le bénéfice mensuel $B(x)$ en fonction du nombre $x$ de supports vendus.", accept: ["30*x-1200"], formMatters: false,
        answer: "$B(x) = 30x - 1\\,200$", hints: ["Bénéfice = recettes − coûts. Quels coûts dépendent de $x$, et lesquels n'en dépendent pas ?", "Les recettes valent $48x$. Le coût total = charges fixes + coût d'un support × $x$.", "$B(x) = 48x - (1\\,200 + 18x)$ — il reste à réduire."],
        solution: "Recettes : $R(x) = 48x$\nCoût total : $C(x) = 1\\,200 + 18x$\n$B(x) = R(x) - C(x) = 48x - 1\\,200 - 18x = 30x - 1\\,200$", commonMistake: "Oublier les parenthèses et écrire $48x - 1\\,200 + 18x$." },
      { label: "b)", prompt: "Combien de supports faut-il vendre par mois pour atteindre le seuil de rentabilité ?", accept: ["40"], formMatters: false,
        answer: "$x = 40$", hints: ["Le seuil de rentabilité, c'est quand le bénéfice vaut exactement zéro.", "Résous $B(x) = 0$ avec ta réponse au a).", "$30x - 1\\,200 = 0 \\iff 30x = 1\\,200$"],
        solution: "$B(x) = 0$\n$30x - 1\\,200 = 0$\n$30x = 1\\,200$\n$x = 40$ supports", commonMistake: "Diviser 1 200 par 48 (le prix) au lieu de 30 (la marge par support)." },
    ],
    businessLens: { concept: "Seuil de rentabilité et marge sur coût variable", scenario: "Toute entreprise qui vend un produit vit avec cette équation. Si un sweat te coûte 18 € à fabriquer et que tu le vends 45 €, chaque vente rapporte 27 € pour couvrir tes charges fixes (pub, site, design). Avec 810 € de charges fixes par mois, il te faut 30 ventes rien que pour ne plus perdre d'argent — la 31ᵉ est ton premier vrai bénéfice.", takeaway: "Connais ta marge par unité et tes charges fixes, et tu sais exactement combien de ventes il te faut." },
  };
  ex.state = ex.parts.map(freshPart);
  return { id: "demo", demo: true, createdAt: new Date().toISOString(), title: "Démo — essaie sans photo", language: "Français", image: null, exercises: [ex] };
}
