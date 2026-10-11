// Proof — turn photos of official math exercises into interactive, XP-tracked practice.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

try { process.loadEnvFile(".env"); } catch {}

const PORT = process.env.PORT || 3333;
const MODEL = "claude-opus-5-5";
const DATA = path.resolve("data");
const DB_FILE = path.join(DATA, "db.json");
const IMG_DIR = path.join(DATA, "images");
fs.mkdirSync(IMG_DIR, { recursive: true });

const client = new Anthropic();

// ---------- Career ladder ----------
const LEVELS = [
  { rank: "Intern", xp: 0, unlock: "Hints, solutions, business lens" },
  { rank: "Analyst", xp: 200, unlock: "Gold accent theme + Mistake journal insights" },
  { rank: "Associate", xp: 600, unlock: "Twin exercises — same exercise, new numbers" },
  { rank: "Manager", xp: 1500, unlock: "Exam mode — no hints, timer, ×1.5 XP" },
  { rank: "Director", xp: 3000, unlock: "Emerald theme" },
  { rank: "VP", xp: 5500, unlock: "Your custom reward tier: plan something big" },
  { rank: "CFO", xp: 9000, unlock: "Crimson theme" },
  { rank: "CEO", xp: 14000, unlock: "Title on your profile: CEO" },
  { rank: "Founder", xp: 21000, unlock: "Founder badge" },
  { rank: "Investor", xp: 30000, unlock: "You made it. Teach someone else." },
];
const levelOf = (xp) => LEVELS.reduce((acc, l, i) => (xp >= l.xp ? i : acc), 0);
const UNLOCK = { twin: 2, exam: 3 };

// ---------- Storage ----------
function emptyDb() {
  return {
    profile: { xp: 0, streak: { count: 0, lastDay: null }, daily: {}, settings: { lang: "English" }, rewards: [], mistakes: [] },
    sheets: [],
  };
}
let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, "utf8")) : emptyDb();
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const id = () => crypto.randomBytes(5).toString("hex");

if (!db.sheets.length) { db.sheets.push(demoSheet()); save(); }

function findEx(sheetId, exId) {
  const sheet = db.sheets.find((s) => s.id === sheetId);
  const ex = sheet?.exercises.find((e) => e.id === exId);
  if (!ex) throw httpError(404, "Exercise not found");
  return { sheet, ex };
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function freshPart() { return { attempts: 0, hintsUsed: 0, revealed: false, solved: false, xp: 0, feedback: null }; }

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
function obj(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
const str = { type: "string" };
const arr = (items) => ({ type: "array", items });

async function ask({ system, content, schema, effort = "high" }) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema } },
  });
  const res = await stream.finalMessage();
  if (res.stop_reason === "refusal") throw httpError(502, "The model declined this request.");
  if (res.stop_reason === "max_tokens") throw httpError(502, "Response was cut off — try a photo with fewer exercises.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}
const imageBlock = (sheet) => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(path.join(IMG_DIR, sheet.image)).toString("base64") },
});
const langOf = (sheet) =>
  db.profile.settings.lang === "auto" ? `the same language as the exercise (${sheet.language})` : db.profile.settings.lang;

const EX_FIELDS = {
  number: { ...str, description: "Official exercise number/label as printed, e.g. '3' or '12a'" },
  title: { ...str, description: "Short title, 2-5 words, in the exercise's language" },
  topic: { ...str, description: "Math topic in English, e.g. 'Linear equations', 'Percentages', 'Quadratic functions'" },
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
- If text is illegible, write [illegible] rather than guessing.
- If a figure, graph or table is needed to solve it, describe it precisely in "figure" (tables as Markdown).
- bbox: the exercise's location on the photo as fractions (0-1) of image width/height, generous rather than tight.
- Include every exercise visible, even partially cut ones (mark missing text [cut off]).`;

const PREP_PART = obj({
  answer: { ...str, description: "Final answer, concise, LaTeX allowed" },
  hints: { ...arr(str), description: "Exactly 3 hints: 1) nudge — what to notice / which concept, 2) method — which tool and how to set it up, 3) first concrete step worked out, stopping well before the answer" },
  solution: { ...str, description: "Full step-by-step solution, Markdown + LaTeX, each step on its own line" },
  commonMistake: str,
});
const PREP_SCHEMA = obj({
  parts: arr(PREP_PART),
  businessLens: obj({
    concept: { ...str, description: "The math idea in one phrase" },
    scenario: { ...str, description: "A concrete business mini-case with real-looking numbers that uses exactly this math (3-5 sentences)" },
    takeaway: { ...str, description: "One-line business lesson" },
  }),
});

async function prepare(sheet, ex) {
  const lang = langOf(sheet);
  const r = await ask({
    effort: "high",
    system: `You are a rigorous math tutor preparing an official exercise for a student who is struggling and wants real progress.
Solve every part carefully, then verify (substitute back, check domain, units, signs). Accuracy matters more than speed.
Hints climb a ladder and never give away the final answer. Solutions are clear enough for a struggling student to follow line by line.
The business lens shows honestly where this exact math shows up in business (pricing, margins, growth, break-even, interest, forecasting, logistics, statistics...). If the link is weak, pick the most honest application rather than forcing one.
Write everything in ${lang}. Return one entry in "parts" per part, in order.`,
    content: [
      ...(sheet.image && !ex.generated ? [imageBlock(sheet)] : []),
      { type: "text", text: `Exercise ${ex.number} (transcription of the photo):\n${JSON.stringify({ statement: ex.statement, figure: ex.figure, parts: ex.parts }, null, 2)}` },
    ],
    schema: PREP_SCHEMA,
  });
  ex.parts.forEach((p, i) => Object.assign(p, r.parts[i] || {}));
  ex.businessLens = r.businessLens;
  ex.prepared = true;
  save();
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));
app.use("/images", express.static(IMG_DIR));

const route = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) {
    console.error(e);
    const msg = e instanceof Anthropic.AuthenticationError || /api key|apiKey|authentication/i.test(e.message)
      ? "No Anthropic API key found. Add ANTHROPIC_API_KEY=... to proof/.env and restart."
      : e.message;
    res.status(e.status && e.status < 600 ? e.status : 500).json({ error: msg });
  }
};

// Strip answers/solutions/hints the student hasn't earned before sending to the browser.
function publicEx(ex) {
  return {
    ...ex,
    parts: ex.parts.map((p, i) => {
      const st = ex.state[i];
      return {
        label: p.label, prompt: p.prompt,
        hints: (p.hints || []).slice(0, st.hintsUsed),
        answer: st.solved || st.revealed ? p.answer : undefined,
        solution: st.solved || st.revealed ? p.solution : undefined,
        commonMistake: st.solved || st.revealed ? p.commonMistake : undefined,
      };
    }),
  };
}
function state() {
  const p = db.profile, li = levelOf(p.xp);
  const t = today();
  if (p.streak.lastDay && p.streak.lastDay < addDays(t, -1)) p.streak.count = 0;
  return {
    profile: p, levels: LEVELS, level: li, unlocks: UNLOCK, today: t,
    sheets: db.sheets.map((s) => ({ ...s, exercises: s.exercises.map(publicEx) })),
  };
}

app.get("/api/state", route(() => state()));

app.post("/api/sheets", route(async (req) => {
  const m = /^data:image\/\w+;base64,(.+)$/.exec(req.body.image || "");
  if (!m) throw httpError(400, "Send a JPEG/PNG image");
  const sheet = { id: id(), createdAt: new Date().toISOString(), image: `${id()}.jpg` };
  fs.writeFileSync(path.join(IMG_DIR, sheet.image), Buffer.from(m[1], "base64"));
  try {
    const r = await ask({
      effort: "high",
      system: EXTRACT_SYSTEM,
      content: [imageBlock(sheet), { type: "text", text: "Transcribe every exercise on this sheet." }],
      schema: obj({
        title: { ...str, description: "Sheet title, e.g. chapter name, or a short descriptive title" },
        language: str,
        exercises: arr(obj({ ...EX_FIELDS, bbox: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }) })),
      }),
    });
    if (!r.exercises.length) throw httpError(422, "No exercises found on that photo.");
    Object.assign(sheet, { title: r.title, language: r.language });
    sheet.exercises = r.exercises.map((e) => ({ ...e, id: id(), state: e.parts.map(freshPart), prepared: false }));
  } catch (e) {
    fs.rmSync(path.join(IMG_DIR, sheet.image), { force: true });
    throw e;
  }
  db.sheets.unshift(sheet);
  save();
  return state();
}));

app.delete("/api/sheets/:id", route((req) => {
  const s = db.sheets.find((x) => x.id === req.params.id);
  if (s?.image) fs.rmSync(path.join(IMG_DIR, s.image), { force: true });
  db.sheets = db.sheets.filter((x) => x.id !== req.params.id);
  save();
  return state();
}));

app.post("/api/ex/:s/:e/prepare", route(async (req) => {
  const { sheet, ex } = findEx(req.params.s, req.params.e);
  if (!ex.prepared) await prepare(sheet, ex);
  return state();
}));

app.post("/api/ex/:s/:e/check", route(async (req) => {
  const { sheet, ex } = findEx(req.params.s, req.params.e);
  const i = req.body.part, st = ex.state[i], part = ex.parts[i];
  const answer = String(req.body.answer || "").trim(), work = String(req.body.work || "").trim();
  if (!answer) throw httpError(400, "Write an answer first");
  if (st.solved || st.revealed) throw httpError(400, "This part is already closed");
  if (!ex.prepared) await prepare(sheet, ex);
  st.attempts++;

  let g;
  if (ex.demo) {
    const norm = (s) => s.replace(/[\s$\\{}]|x=|left|right/g, "").replace(/,/g, ".").toLowerCase();
    const ok = part.accept.some((a) => norm(a) === norm(answer));
    g = { verdict: ok ? "correct" : "incorrect", feedback: ok ? "Correct." : "Not quite — check your arithmetic, or take a hint. (Demo mode uses exact matching; with an API key, Claude reads your working and spots the first wrong step.)", mistakeType: ok ? "none" : "calculation" };
  } else {
    g = await ask({
      effort: "medium",
      system: `You grade a student's answer to one part of an official math exercise. You get the statement, the verified reference answer and solution.
verdict:
- "correct": mathematically equivalent to the reference in any valid form (e.g. 0.5 = 1/2), sensible rounding unless an exact value is required.
- "partial": on the right track but incomplete (a missing solution, unsimplified when the exercise demands it, missing unit/justification the question explicitly asks for).
- "incorrect": otherwise.
If the student showed work, find the FIRST wrong step and point to it precisely. Feedback is 1-3 sentences, specific, honest, encouraging.
NEVER reveal the reference answer, nor the result of the step they got wrong. Write feedback in ${langOf(sheet)}.`,
      content: [{ type: "text", text: JSON.stringify({ statement: ex.statement, figure: ex.figure, question: part.prompt, referenceAnswer: part.answer, referenceSolution: part.solution, studentAnswer: answer, studentWork: work || "(no work shown)" }, null, 2) }],
      schema: obj({
        verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
        feedback: str,
        mistakeType: { type: "string", enum: ["none", "calculation", "sign", "concept", "method", "reading the question", "incomplete", "notation"] },
      }),
    });
  }

  st.feedback = { verdict: g.verdict, text: g.feedback };
  let reward = null;
  if (g.verdict === "correct") {
    st.solved = true;
    reward = award(ex, st);
    st.xp = reward.xp;
    if (ex.state.every((s) => s.solved || s.revealed)) afterExerciseDone(ex);
  } else {
    db.profile.mistakes.unshift({ day: today(), topic: ex.topic, type: g.mistakeType, exercise: `${sheet.title} · Ex. ${ex.number}${part.label ? " " + part.label : ""}`, note: g.feedback });
    db.profile.mistakes = db.profile.mistakes.slice(0, 200);
  }
  save();
  return { ...state(), result: { verdict: g.verdict, reward } };
}));

app.post("/api/ex/:s/:e/hint", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  const st = ex.state[req.body.part];
  if (ex.exam) throw httpError(400, "No hints in exam mode");
  if (st.hintsUsed < 3) st.hintsUsed++;
  save();
  return state();
}));

app.post("/api/ex/:s/:e/reveal", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  if (ex.exam) throw httpError(400, "No solutions in exam mode");
  ex.state[req.body.part].revealed = true;
  if (ex.state.every((s) => s.solved || s.revealed)) afterExerciseDone(ex);
  save();
  return state();
}));

app.post("/api/ex/:s/:e/retry", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  ex.history = [...(ex.history || []), { day: today(), state: ex.state }];
  ex.state = ex.parts.map(freshPart);
  if (ex.review && !ex.review.mastered) ex.review.active = true;
  save();
  return state();
}));

app.post("/api/ex/:s/:e/exam", route((req) => {
  const { ex } = findEx(req.params.s, req.params.e);
  if (req.body.on) {
    if (levelOf(db.profile.xp) < UNLOCK.exam) throw httpError(403, `Exam mode unlocks at ${LEVELS[UNLOCK.exam].rank}`);
    if (ex.state.some((s) => s.attempts || s.hintsUsed || s.revealed)) throw httpError(400, "Start exam mode on a fresh attempt (use Retry)");
    ex.exam = { startedAt: Date.now() };
  } else ex.exam = null;
  save();
  return state();
}));

app.post("/api/ex/:s/:e/twin", route(async (req) => {
  const { sheet, ex } = findEx(req.params.s, req.params.e);
  if (levelOf(db.profile.xp) < UNLOCK.twin) throw httpError(403, `Twin exercises unlock at ${LEVELS[UNLOCK.twin].rank}`);
  const t = await ask({
    effort: "medium",
    system: `You write one new practice exercise that is a twin of an official one: same structure, same skills, same number of parts, same difficulty, same style and language as the original (${sheet.language}), but different numbers and context. Make the numbers work out as cleanly as in the original. Markdown + LaTeX.`,
    content: [{ type: "text", text: JSON.stringify({ statement: ex.statement, figure: ex.figure, parts: ex.parts.map((p) => ({ label: p.label, prompt: p.prompt })) }, null, 2) }],
    schema: obj(EX_FIELDS),
  });
  const twin = { ...t, id: id(), number: `${ex.number}′`, generated: true, twinOf: ex.id, state: t.parts.map(freshPart), prepared: false };
  sheet.exercises.splice(sheet.exercises.indexOf(ex) + 1, 0, twin);
  save();
  return { ...state(), twinId: twin.id };
}));

app.post("/api/settings", route((req) => {
  Object.assign(db.profile.settings, req.body);
  save();
  return state();
}));
app.post("/api/rewards", route((req) => {
  const title = String(req.body.title || "").trim(), xp = Math.max(1, Number(req.body.xp) | 0);
  if (!title) throw httpError(400, "Name your reward");
  db.profile.rewards.push({ id: id(), title, xp, claimed: null });
  db.profile.rewards.sort((a, b) => a.xp - b.xp);
  save();
  return state();
}));
app.post("/api/rewards/:id/claim", route((req) => {
  const r = db.profile.rewards.find((x) => x.id === req.params.id);
  if (!r || db.profile.xp < r.xp) throw httpError(400, "Not unlocked yet");
  r.claimed = today();
  save();
  return state();
}));
app.delete("/api/rewards/:id", route((req) => {
  db.profile.rewards = db.profile.rewards.filter((x) => x.id !== req.params.id);
  save();
  return state();
}));

app.listen(PORT, () => console.log(`Proof running → http://localhost:${PORT}`));

// ---------- Demo content (works without an API key) ----------
function demoSheet() {
  const ex = {
    id: "demo1", demo: true, prepared: true, number: "1", title: "Break-even point", topic: "Linear equations", difficulty: 2,
    statement: "A small workshop makes wooden phone stands. Fixed monthly costs are $1\\,200$ zł. Each stand costs $18$ zł in materials and sells for $48$ zł.",
    figure: "",
    parts: [
      { label: "a)", prompt: "Write the monthly profit $P(x)$ as a function of the number $x$ of stands sold.", accept: ["P(x)=30x-1200", "30x-1200", "P=30x-1200"],
        answer: "$P(x) = 30x - 1200$", hints: ["Profit = revenue − costs. Which costs change with $x$ and which don't?", "Revenue is $48x$. Total cost is fixed cost + cost per stand × $x$.", "$P(x) = 48x - (1200 + 18x)$ — now simplify."],
        solution: "Revenue: $R(x) = 48x$\nCost: $C(x) = 1200 + 18x$\n$P(x) = R(x) - C(x) = 48x - 1200 - 18x = 30x - 1200$", commonMistake: "Forgetting the brackets and writing $48x - 1200 + 18x$." },
      { label: "b)", prompt: "How many stands must be sold per month to break even?", accept: ["40", "x=40", "40stands"],
        answer: "$x = 40$", hints: ["Break-even means profit is exactly zero.", "Solve $P(x) = 0$ using your answer to a).", "$30x - 1200 = 0 \\Rightarrow 30x = 1200$"],
        solution: "$P(x) = 0$\n$30x - 1200 = 0$\n$30x = 1200$\n$x = 40$ stands", commonMistake: "Dividing 1200 by 48 (the price) instead of 30 (the margin per unit)." },
    ],
    businessLens: { concept: "Break-even & contribution margin", scenario: "Every product business lives on this equation. If a hoodie costs you 70 zł to make and sells for 150 zł, each sale contributes 80 zł toward fixed costs (ads, Shopify, design). With 2 400 zł of monthly fixed costs you need 30 sales just to stop losing money — sale 31 is your first real profit.", takeaway: "Know your margin per unit and your fixed costs, and you know exactly how many sales you need." },
  };
  ex.state = ex.parts.map(freshPart);
  return { id: "demo", demo: true, createdAt: new Date().toISOString(), title: "Demo — try it without a photo", language: "English", image: null, exercises: [ex] };
}
