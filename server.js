// Proof — turn photos of official math exercises into interactive, XP-tracked practice.
import express from "express";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { createStore } from "./store.js";
import { smartCheck } from "./answers.js";

try { process.loadEnvFile(".env"); } catch {}

const PORT = process.env.PORT || 3333;
const MODEL = "claude-opus-5-5";
const DB_VERSION = 3;
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
function emptyDb() {
  return {
    version: DB_VERSION,
    profile: { xp: 0, streak: { count: 0, lastDay: null }, daily: {}, settings: { lang: "Français" }, rewards: [], mistakes: [], auto: {}, autoRuns: [] },
    sheets: [demoSheet()],
  };
}
// Each request runs with its own { uid, db } so several users on one server never mix their data.
const als = new AsyncLocalStorage();
const ctx = () => als.getStore();
async function loadDb() {
  const db = (await store.load(ctx().uid)) || emptyDb();
  if (db.version !== DB_VERSION) {
    db.version = DB_VERSION;
    db.profile.settings.lang = "Français";
    db.sheets = [...db.sheets.filter((s) => !s.demo), demoSheet()];
  }
  db.profile.auto ||= {};
  db.profile.autoRuns ||= [];
  ctx().db = db;
}
// Re-read after a slow AI call so we don't overwrite changes made meanwhile from another tab or device.
async function reload() { if (store.kind === "supabase") await loadDb(); }

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const id = () => crypto.randomBytes(5).toString("hex");
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function freshPart() { return { attempts: 0, hintsUsed: 0, revealed: false, solved: false, xp: 0, feedback: null }; }
function findEx(sheetId, exId) {
  const sheet = ctx().db.sheets.find((s) => s.id === sheetId);
  const ex = sheet?.exercises.find((e) => e.id === exId);
  if (!ex) throw httpError(404, "Exercice introuvable");
  return { sheet, ex };
}

// ---------- XP engine ----------
const HINT_MULT = [1, 0.75, 0.5, 0.25];
function streakMult() { return 1 + Math.min(ctx().db.profile.streak.count, 10) * 0.05; }
function touchStreak() {
  const s = ctx().db.profile.streak, t = today();
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
  return { xp, clean, levelUp: gainXp(xp) };
}
// Adds XP to today's total; returns the new rank if this crossed a level.
function gainXp(xp) {
  const before = levelOf(ctx().db.profile.xp);
  ctx().db.profile.xp += xp;
  ctx().db.profile.daily[today()] = (ctx().db.profile.daily[today()] || 0) + xp;
  return levelOf(ctx().db.profile.xp) > before ? LEVELS[levelOf(ctx().db.profile.xp)] : null;
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
  const buf = await store.getImage(ctx().uid, name);
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } };
}
const langOf = (sheet) =>
  ctx().db.profile.settings.lang === "auto" ? `the same language as the exercise (${sheet.language})` : ctx().db.profile.settings.lang;

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

const COACH_VOICE = `You are Léo, the student's friendly coach: like a cool older friend who is great at math. Talk to them directly and casually (in French: tutoiement).
- Short sentences, everyday words. Explain the WHY, not just the how.
- Make it tangible: money, pizza slices, phone battery, sneakers, followers, a bus trip… one concrete picture beats three abstract sentences.
- Show the chain of reasoning with arrows: "48 € la vente − 18 € de matériaux → 30 € qui restent par support".
- Warm and encouraging, never condescending, never fake hype. At most one emoji per message.`;

const PREP_PART = obj({
  answer: { ...str, description: "Final answer, concise, LaTeX allowed" },
  accept: { ...arr(str), description: "Machine-checkable plain-text forms of the final answer, ONE ENTRY PER SOLUTION/VALUE, using * ^ / sqrt() pi exp() log() and '.' decimals. Examples: ['x=2','x=-3'] for two solutions; ['30*x-1200'] for an expression; ['sqrt(2)/2']; ['x=1','y=2'] for a system. Exact values when possible. Empty array if the answer is not a value or expression (proof, justification, sentence, graph, interval, inequality, table)." },
  formMatters: { type: "boolean", description: "true if the question demands a specific form that an equivalent value would not satisfy: factoriser, développer, réduire, simplifier, forme canonique, valeur exacte, arrondir/donner une valeur approchée à ..., écriture scientifique, fraction irréductible." },
  hints: { ...arr(str), description: "Exactly 3 hints in Léo's voice (1-3 short sentences each): 1) nudge — what to notice, with a tangible picture, 2) method — which tool and how to set it up, 3) first concrete step worked out with arrows, stopping well before the answer" },
  steps: { ...arr(obj({
    say: { ...str, description: "What we do in this step and WHY, in Léo's voice, 1-2 short sentences, arrows welcome" },
    math: { ...str, description: "The math of this step in LaTeX WITHOUT $ delimiters (e.g. 'B(x) = 48x - (1200 + 18x)'), or empty string if none" },
  })), description: "Full worked solution as 2-6 small steps, ending with the answer" },
  commonMistake: str,
});
const PREP_SCHEMA = obj({
  coachIntro: { ...str, description: "Léo's 1-2 sentence welcome to this exercise: what it's really about in tangible terms and the game plan with arrows. No answers." },
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
    system: `${COACH_VOICE}

You are preparing an official exercise for a student who is struggling and wants real progress.
Solve every part carefully FIRST, then verify (substitute back, check domain, units, signs). Accuracy matters more than anything — friendly tone never replaces rigour.
Hints climb a ladder and never give away the final answer. Solution steps are small enough for a struggling student to follow, using French school conventions and notation (virgule décimale, S = {…}, etc.).
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
  ex.coachIntro = r.coachIntro;
  ex.prepared = true;
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));
// On Vercel, public/ is served by the CDN (not bundled with this function), which only maps /index.html.
if (process.env.VERCEL) app.get("/", (req, res) => res.redirect("/index.html"));

// ---------- Accounts ----------
// With Supabase, every request carries the user's session token; locally there is one user and no login.
const userCache = new Map(); // token → { uid, until }
async function userOf(req) {
  if (!store.auth) return "local";
  const token = /^Bearer (.+)$/.exec(req.get("authorization") || "")?.[1];
  if (!token) throw httpError(401, "Connecte-toi pour continuer.");
  const hit = userCache.get(token);
  if (hit && hit.until > Date.now()) return hit.uid;
  const user = await store.userFromToken(token);
  if (!user) throw httpError(401, "Session expirée — reconnecte-toi.");
  if (userCache.size > 500) userCache.clear();
  userCache.set(token, { uid: user.id, until: Date.now() + 5 * 60e3 });
  return user.id;
}

function sendError(res, e) {
  console.error(e);
  const msg = e instanceof Anthropic.AuthenticationError ? "Clé Anthropic refusée — vérifie-la dans Réglages → Clés."
    : e instanceof Anthropic.RateLimitError ? "Trop de requêtes — réessaie dans un instant."
    : e instanceof Anthropic.APIConnectionError ? "Impossible de joindre l'API Anthropic."
    : e.message;
  res.status(e.status && e.status < 600 ? e.status : 500).json({ error: msg });
}

const route = (fn) => async (req, res) => {
  try {
    const uid = await userOf(req);
    await als.run({ uid, db: null }, async () => {
      await loadDb();
      const out = await fn(req, res);
      if (req.method !== "GET") await store.save(ctx().uid, ctx().db);
      res.json(out);
    });
  } catch (e) { sendError(res, e); }
};

// Public: tells the browser whether to show the login screen, and which Supabase project to log in to.
app.get("/api/config", async (req, res) => {
  try {
    await store.health();
    res.json({ auth: store.auth, storage: store.kind });
  } catch (e) { sendError(res, e); }
});

app.post("/api/signup", async (req, res) => {
  try {
    if (!store.auth) throw httpError(400, "Pas de comptes en mode local.");
    const email = String(req.body.email || "").trim().toLowerCase(), password = String(req.body.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, "Adresse e-mail invalide.");
    if (password.length < 8) throw httpError(400, "Le mot de passe doit faire au moins 8 caractères.");
    try { await store.signUp(email, password); }
    catch (e) { throw httpError(/already|exists|registered/i.test(e.message) ? 409 : 400, /already|exists|registered/i.test(e.message) ? "Un compte existe déjà avec cet e-mail — connecte-toi." : e.message); }
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// Photos are private: the browser fetches them with its session token, not as public URLs.
app.get("/images/:name", async (req, res) => {
  try {
    const uid = await userOf(req);
    const buf = await store.getImage(uid, req.params.name);
    if (!buf) return res.sendStatus(404);
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" }).send(buf);
  } catch (e) { sendError(res, e); }
});

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
        steps: open ? p.steps : undefined,
        commonMistake: open ? p.commonMistake : undefined,
      };
    }),
  };
}
function state(req) {
  const p = ctx().db.profile, t = today();
  if (p.streak.lastDay && p.streak.lastDay < addDays(t, -1)) p.streak.count = 0;
  return {
    profile: p, levels: LEVELS, level: levelOf(p.xp), unlocks: UNLOCK, today: t,
    keys: { server: !!process.env.ANTHROPIC_API_KEY, browser: !!req.get("x-anthropic-key"), storage: store.kind },
    sheets: ctx().db.sheets.map((s) => ({ ...s, exercises: s.exercises.map(publicEx) })),
  };
}

app.get("/api/state", route((req) => state(req)));

app.post("/api/sheets", route(async (req) => {
  const m = /^data:image\/\w+;base64,(.+)$/.exec(req.body.image || "");
  if (!m) throw httpError(400, "Envoie une image JPEG/PNG");
  if (!keyOf(req)) throw httpError(401, NO_KEY);
  const sheet = { id: id(), createdAt: new Date().toISOString(), image: `${id()}.jpg` };
  await store.putImage(ctx().uid, sheet.image, Buffer.from(m[1], "base64"));
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
    await store.delImage(ctx().uid, sheet.image);
    throw e;
  }
  await reload();
  ctx().db.sheets.unshift(sheet);
  return state(req);
}));

app.delete("/api/sheets/:id", route(async (req) => {
  const s = ctx().db.sheets.find((x) => x.id === req.params.id);
  if (s?.image) await store.delImage(ctx().uid, s.image);
  ctx().db.sheets = ctx().db.sheets.filter((x) => x.id !== req.params.id);
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
    const cheers = ["Nickel, c'est exactement ça 🎯", "Bien joué ! Tu l'as eue.", "Propre. Rien à redire.", "Yes ! C'est la bonne réponse.", "Parfait → question validée."];
    g = { verdict: "correct", feedback: cheers[Math.floor(Math.random() * cheers.length)], mistakeType: "aucune" };
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
Feedback is written by Léo, the student's coach:
${COACH_VOICE}
If the student showed work, find the FIRST wrong step and point to it precisely (use an arrow to show where it went off track). Feedback is 1-3 short sentences, specific, honest, encouraging. If correct, say briefly what they did well.
NEVER reveal the reference answer, nor the result of the step they got wrong. Write feedback in ${langOf(sheet)}.`,
      content: [{ type: "text", text: JSON.stringify({ statement: ex.statement, figure: ex.figure, question: part.prompt, referenceAnswer: part.answer, referenceSolution: part.steps || part.solution, studentAnswer: answer, studentWork: work || "(pas de calculs montrés)" }, null, 2) }],
      schema: GRADE_SCHEMA,
    });
  } else if (local === "unknown" || (part.formMatters && !ex.demo)) {
    throw httpError(422, part.formMatters && !ex.demo
      ? "Cette question demande une forme précise : ajoute ta clé Anthropic (Réglages → Clés) pour la correction."
      : "Je n'arrive pas à lire ta réponse. Écris-la par exemple : x = 3/2, 2,5, S = {1 ; 4} ou 30x − 1200.");
  } else {
    g = { verdict: local === "correct" ? "correct" : "incorrect", mistakeType: "calcul",
      feedback: "Hmm, ce n'est pas la bonne valeur. Reprends ton calcul étape par étape → ou prends un indice, c'est fait pour ça 😉" };
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
    ctx().db.profile.mistakes.unshift({ day: today(), topic: ex.topic, type: g.mistakeType, exercise: `${sheet.title} · Ex. ${ex.number}${part.label ? " " + part.label : ""}`, note: g.feedback });
    ctx().db.profile.mistakes = ctx().db.profile.mistakes.slice(0, 200);
  }
  return { ...state(req), result: { verdict: g.verdict, reward } };
}));

// "Je comprends pas" — Léo re-explains the question (before solving) or one solution step (after), in simpler words.
app.post("/api/ex/:s/:e/explain", route(async (req) => {
  const { sheet, ex } = findEx(req.params.s, req.params.e);
  const i = req.body.part, part = ex.parts[i], st = ex.state[i];
  const step = Number.isInteger(req.body.step) ? part.steps?.[req.body.step] : null;
  if (step && !(st.solved || st.revealed)) throw httpError(400, "Termine d'abord la question");
  const r = await ask(req, {
    effort: "low",
    system: `${COACH_VOICE}

The student is stuck and asked you to explain ${step ? "one step of the worked solution" : "what the question is asking"} differently and more simply.
Use a concrete everyday picture or a tiny example with small numbers, and arrows to show the chain. 3-5 short sentences.
${step ? "" : "Do NOT solve it or give the answer or the method's result: only make the question and its key idea crystal clear."}
Write in ${langOf(sheet)}. Math in LaTeX with $...$.`,
    content: [{ type: "text", text: JSON.stringify({ statement: ex.statement, figure: ex.figure, question: part.prompt, ...(step ? { step, answer: part.answer } : {}) }, null, 2) }],
    schema: obj({ text: str }),
  });
  return { ...state(req), explanation: r.text };
}));

// The student's notes / working for one question (autosaved from the notes box).
app.post("/api/ex/:s/:e/notes", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  const st = ex.state[req.body.part];
  if (!st) throw httpError(400, "Question introuvable");
  st.notes = String(req.body.notes ?? "").slice(0, 5000);
  return { ok: true };
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
    if (levelOf(ctx().db.profile.xp) < UNLOCK.exam) throw httpError(403, `Le mode examen se débloque au rang ${LEVELS[UNLOCK.exam].rank}`);
    if (ex.state.some((s) => s.attempts || s.hintsUsed || s.revealed)) throw httpError(400, "Lance le mode examen sur une tentative neuve (utilise Recommencer)");
    ex.exam = { startedAt: Date.now() };
  } else ex.exam = null;
  return state(req);
}));

app.post("/api/ex/:s/:e/twin", route(async (req) => {
  const { s, e } = req.params;
  let { sheet, ex } = findEx(s, e);
  if (levelOf(ctx().db.profile.xp) < UNLOCK.twin) throw httpError(403, `Les exercices jumeaux se débloquent au rang ${LEVELS[UNLOCK.twin].rank}`);
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

// Automatismes: questions are generated and checked in the browser; the server keeps stats and awards XP.
// Training: 4 XP per right answer + combo bonus. Épreuve (12 questions, timed): 6 XP each, +25 for a perfect sheet.
app.post("/api/auto/finish", route((req) => {
  const mode = req.body.mode === "exam" ? "exam" : "train";
  const results = (Array.isArray(req.body.results) ? req.body.results : []).slice(0, 40)
    .filter((r) => /^[a-z]-[a-z0-9-]{2,40}$/.test(r?.skill)).map((r) => ({ skill: r.skill, ok: !!r.ok }));
  if (!results.length) throw httpError(400, "Aucune réponse");
  const p = ctx().db.profile;
  let xp = 0, combo = 0, best = 0;
  for (const r of results) {
    const st = (p.auto[r.skill] ||= { n: 0, ok: 0 });
    st.n++; st.last = today();
    if (r.ok) {
      st.ok++; combo++; best = Math.max(best, combo);
      xp += mode === "exam" ? 6 : 4 + Math.min(Math.max(combo - 2, 0), 4);
    } else combo = 0;
  }
  const score = results.filter((r) => r.ok).length;
  if (mode === "exam" && results.length >= 12 && score === results.length) xp += 25;
  touchStreak();
  xp = Math.round(xp * streakMult());
  const levelUp = gainXp(xp);
  p.autoRuns.unshift({ day: today(), mode, theme: String(req.body.theme || "mix").slice(0, 10), score, total: results.length, xp, seconds: Number(req.body.seconds) | 0 });
  p.autoRuns = p.autoRuns.slice(0, 60);
  return { ...state(req), result: { xp, levelUp, score, total: results.length, bestCombo: best } };
}));

app.post("/api/settings", route((req) => {
  const { lang, theme } = req.body;
  if (lang) ctx().db.profile.settings.lang = String(lang);
  if (theme) ctx().db.profile.settings.theme = String(theme);
  return state(req);
}));
app.post("/api/rewards", route((req) => {
  const title = String(req.body.title || "").trim(), xp = Math.max(1, Number(req.body.xp) | 0);
  if (!title) throw httpError(400, "Donne un nom à ta récompense");
  ctx().db.profile.rewards.push({ id: id(), title, xp, claimed: null });
  ctx().db.profile.rewards.sort((a, b) => a.xp - b.xp);
  return state(req);
}));
app.post("/api/rewards/:id/claim", route((req) => {
  const r = ctx().db.profile.rewards.find((x) => x.id === req.params.id);
  if (!r || ctx().db.profile.xp < r.xp) throw httpError(400, "Pas encore débloquée");
  r.claimed = today();
  return state(req);
}));
app.delete("/api/rewards/:id", route((req) => {
  ctx().db.profile.rewards = ctx().db.profile.rewards.filter((x) => x.id !== req.params.id);
  return state(req);
}));

app.listen(PORT, () => console.log(`Proof → http://localhost:${PORT} (stockage : ${store.kind})`));

// ---------- Demo content (works without an API key) ----------
function demoSheet() {
  const ex = {
    id: "demo1", demo: true, prepared: true, number: "1", title: "Seuil de rentabilité", topic: "Équations du premier degré", difficulty: 2,
    statement: "Un petit atelier fabrique des supports de téléphone en bois. Les charges fixes mensuelles s'élèvent à $1\\,200$ €. Chaque support coûte $18$ € de matériaux et est vendu $48$ €.",
    figure: "",
    coachIntro: "Imagine que c'est ton atelier 🪵 Chaque support vendu te rapporte un peu d'argent, mais le loyer et les machines coûtent 1 200 € même si tu ne vends rien. On va trouver → combien tu gagnes par support → combien il en faut pour ne plus perdre d'argent.",
    parts: [
      { label: "a)", prompt: "Exprimer le bénéfice mensuel $B(x)$ en fonction du nombre $x$ de supports vendus.", accept: ["30*x-1200"], formMatters: false,
        answer: "$B(x) = 30x - 1\\,200$",
        hints: ["Le bénéfice, c'est ce qui reste dans ta poche : l'argent qui rentre − l'argent qui sort. Qu'est-ce qui dépend du nombre de supports vendus, et qu'est-ce qui ne bouge jamais ?", "Argent qui rentre → $48$ € par support, donc $48x$. Argent qui sort → $1\\,200$ € fixes + $18$ € par support.", "Ça donne $B(x) = 48x - (1\\,200 + 18x)$. Attention aux parenthèses → il te reste juste à simplifier 😉"],
        steps: [
          { say: "D'abord, l'argent qui rentre : chaque support vendu → 48 €. Pour $x$ supports :", math: "R(x) = 48x" },
          { say: "Ensuite, l'argent qui sort : le fixe (1 200 €, vendu ou pas) + 18 € de bois par support :", math: "C(x) = 1\\,200 + 18x" },
          { say: "Bénéfice = ce qui rentre − ce qui sort. On met bien les parenthèses, le − s'applique à TOUT le coût :", math: "B(x) = 48x - (1\\,200 + 18x) = 48x - 1\\,200 - 18x" },
          { say: "On regroupe les $x$ : 48 − 18 = 30 € qui restent par support → c'est ta marge.", math: "B(x) = 30x - 1\\,200" },
        ],
        commonMistake: "Oublier les parenthèses et écrire $48x - 1\\,200 + 18x$ → le coût du bois devient un gain !" },
      { label: "b)", prompt: "Combien de supports faut-il vendre par mois pour atteindre le seuil de rentabilité ?", accept: ["40"], formMatters: false,
        answer: "$x = 40$",
        hints: ["Le seuil de rentabilité, c'est le moment pile où tu ne perds plus rien… mais où tu ne gagnes encore rien non plus. Ça veut dire quoi pour $B(x)$ ?", "Bénéfice nul → résous $B(x) = 0$ avec ta formule du a).", "$30x - 1\\,200 = 0$ → passe le $1\\,200$ de l'autre côté. Combien de fois 30 € pour remplir 1 200 € ?"],
        steps: [
          { say: "Seuil de rentabilité = bénéfice zéro pile. On écrit ça :", math: "30x - 1\\,200 = 0" },
          { say: "On passe les 1 200 de l'autre côté → il faut que les marges couvrent tout le fixe :", math: "30x = 1\\,200" },
          { say: "Chaque support remplit 30 € du « trou » de 1 200 € → 1 200 ÷ 30 :", math: "x = 40" },
          { say: "Donc 40 supports par mois. Le 41ᵉ, c'est ton premier vrai bénéfice 🎉", math: "" },
        ],
        commonMistake: "Diviser 1 200 par 48 (le prix de vente) au lieu de 30 (ce qu'il te reste vraiment par support)." },
    ],
    businessLens: { concept: "Seuil de rentabilité et marge sur coût variable", scenario: "Toute entreprise qui vend un produit vit avec cette équation. Si un sweat te coûte 18 € à fabriquer et que tu le vends 45 €, chaque vente rapporte 27 € pour couvrir tes charges fixes (pub, site, design). Avec 810 € de charges fixes par mois, il te faut 30 ventes rien que pour ne plus perdre d'argent — la 31ᵉ est ton premier vrai bénéfice.", takeaway: "Connais ta marge par unité et tes charges fixes, et tu sais exactement combien de ventes il te faut." },
  };
  ex.state = ex.parts.map(freshPart);
  return { id: "demo", demo: true, createdAt: new Date().toISOString(), title: "Démo — essaie sans photo", language: "Français", image: null, exercises: [ex] };
}
