// Mathéo — client
import { THEMES, SKILLS, skillById, makeQuestion, nextSkill } from "/auto.js";

let S = null; // server state
const app = document.getElementById("app");
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("fr-FR");
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;

// ---------- Keys & accounts ----------
// The Anthropic key lives only in this browser and is sent with each request; the server never stores it.
const KEY = "proof.anthropicKey";
const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const setKey = (k) => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };

// Accounts (when the server uses Supabase): the session token goes with every request.
let CONFIG = { auth: null }, sb = null, session = null;
function authHeaders() {
  const h = {};
  if (getKey()) h["x-anthropic-key"] = getKey();
  if (session) h.Authorization = `Bearer ${session.access_token}`;
  return h;
}
async function api(url, body, method) {
  const headers = { "Content-Type": "application/json", ...authHeaders() };
  const res = await fetch(url, { method: method || (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (res.status === 401 && CONFIG.auth) { session = null; viewLogin(); }
  if (!res.ok) throw new Error(data.error || "La requête a échoué");
  S = data;
  return data;
}

// Private photos: fetched with the session token, then shown from memory.
const imgCache = {};
function imageUrl(name) {
  return (imgCache[name] ||= fetch(`/images/${name}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.blob() : Promise.reject()))
    .then((b) => URL.createObjectURL(b))
    .catch(() => { delete imgCache[name]; return ""; }));
}
function hydrateImages(root = app) {
  root.querySelectorAll("[data-img]").forEach(async (el) => {
    const u = await imageUrl(el.dataset.img);
    if (el.tagName === "IMG") el.src = u; else el.href = u;
  });
}

// ---------- Rendering helpers ----------
// Markdown-lite + KaTeX. Math is protected before escaping so LaTeX survives.
function md(text = "") {
  const math = [];
  let s = String(text).replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (m) => `\u0000${math.push(m) - 1}\u0000`);
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-•] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  s = mdTables(s).replace(/\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => esc(math[i]));
}
function mdTables(s) {
  return s.replace(/(^\|.+\|$\n?){2,}/gm, (block) => {
    const rows = block.trim().split("\n").filter((r) => !/^\|[\s:|-]+\|$/.test(r));
    return "<table>" + rows.map((r, i) => "<tr>" + r.slice(1, -1).split("|").map((c) => (i ? `<td>${c.trim()}</td>` : `<th>${c.trim()}</th>`)).join("") + "</tr>").join("") + "</table>";
  });
}
function typeset(el = app) {
  if (window.renderMathInElement)
    renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false });
  else setTimeout(() => typeset(el), 100);
}
function toast(html, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = html;
  $("#toasts").append(t);
  setTimeout(() => t.classList.add("out"), 3600);
  setTimeout(() => t.remove(), 4100);
}
const fail = (e) => toast(esc(e.message), "bad");
function busy(btn, text) { btn.disabled = true; btn.innerHTML = `<span class="spinner sm"></span> ${text}`; }

// Léo, the coach: every hint, feedback and explanation is a speech bubble.
const coach = (html, kind = "", who = "Léo") =>
  `<div class="coach ${kind}"><div class="avatar">🦊</div><div class="bubble"><span class="who">${who}</span>${html}</div></div>`;

function confetti(from) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = from?.getBoundingClientRect?.() || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const colors = ["#2f6bff", "#ff7a1a", "#12b07a", "#ffb347", "#8b5cf6"];
  for (let i = 0; i < 36; i++) {
    const d = document.createElement("i");
    d.className = "confetti";
    d.style.cssText = `background:${colors[i % 5]};left:${cx}px;top:${cy}px`;
    document.body.append(d);
    const a = Math.random() * Math.PI * 2, v = 90 + Math.random() * 200;
    d.animate([
      { transform: "translate(-50%,-50%) rotate(0)", opacity: 1 },
      { transform: `translate(${Math.cos(a) * v}px, ${Math.sin(a) * v - 110}px) rotate(${Math.random() * 720}deg)`, opacity: 1, offset: 0.65 },
      { transform: `translate(${Math.cos(a) * v * 1.15}px, ${Math.sin(a) * v + 160}px) rotate(${Math.random() * 900}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 500, easing: "cubic-bezier(.2,.7,.4,1)" }).onfinish = () => d.remove();
  }
}

// ---------- State helpers ----------
const lvl = () => S.levels[S.level];
const next = () => S.levels[S.level + 1];
const hasAi = () => S.keys.server || !!getKey();
const exDone = (ex) => ex.state.every((s) => s.solved || s.revealed);
const exStarted = (ex) => ex.state.some((s) => s.attempts || s.hintsUsed || s.revealed);
const reviewDue = (ex) => ex.review?.due && !ex.review.mastered && ex.review.due <= S.today;
const allEx = () => S.sheets.flatMap((sh) => sh.exercises.map((ex) => ({ sh, ex })));
const dots = (n) => `<span class="dots" title="Difficulté ${n}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
function applyTheme() {
  const themes = [[1, "gold"], [4, "emerald"], [6, "crimson"]].filter(([l]) => S.level >= l).map(([, t]) => t);
  const t = S.profile.settings.theme;
  document.documentElement.dataset.accent = t && (t === "default" || themes.includes(t)) ? t : "default";
}

// ---------- Shell: navigation + rank ----------
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  career: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
const NAV = [["#/", "Bureau", "home"], ["#/auto", "Automatismes", "auto"], ["#/career", "Carrière", "career"], ["#/settings", "Réglages", "settings"]];
function shell() {
  const h = location.hash || "#/";
  const cur = ["#/auto", "#/career", "#/settings"].find((p) => h.startsWith(p)) || "#/";
  const due = allEx().filter(({ ex }) => reviewDue(ex)).length;
  const links = NAV.map(([href, label, ic]) => `<a href="${href}" class="${cur === href ? "on" : ""}">${ICON[ic]}<span>${label}</span>${href === "#/" && due ? `<span class="badge">${due}</span>` : ""}</a>`).join("");
  $("#nav").innerHTML = links;
  $("#tabbar").innerHTML = links;
  const p = S.profile, L = lvl(), N = next();
  const pct = N ? ((p.xp - L.xp) / (N.xp - L.xp)) * 100 : 100;
  const streak = `🔥 ${p.streak.count} jour${p.streak.count > 1 ? "s" : ""}`, xpLine = `${fmt(p.xp)} XP${N ? ` · encore ${fmt(N.xp - p.xp)} → ${N.rank}` : ""}`;
  const bar = $("#hud .xpbar span");
  if (bar) {
    // Update in place so the bar's width transition animates the gain.
    bar.style.width = `${pct}%`;
    $("#hud .rank-name").textContent = L.rank;
    $("#hud .xp").textContent = xpLine;
    $("#hud .streak-pill").textContent = streak;
  } else $("#hud").innerHTML = `
    <span class="streak-pill" title="Série de jours : +5 % d'XP par jour, jusqu'à +50 %">${streak}</span>
    <a href="#/career" class="rank-card"><span class="muted small">Rang</span><div class="rank-name">${L.rank}</div>
      <div class="xpbar"><span style="width:${pct}%"></span></div>
      <span class="xp mono">${xpLine}</span></a>`;
  $("#hud-mobile").innerHTML = `<span class="streak-pill">🔥 ${p.streak.count}</span><a class="tag orange" href="#/career">${L.rank} · ${fmt(p.xp)} XP</a>`;
  applyTheme();
}
function banners() {
  const out = [];
  if (!hasAi()) out.push(`<a class="banner" href="#/settings">🔑 <span><b>Ajoute ta clé Anthropic</b> pour transcrire tes photos et avoir Léo en correcteur intelligent. <u>Réglages → Clés</u></span></a>`);
  if (S.keys.storage === "temp") out.push(`<a class="banner warn" href="#/settings">⚠️ <span><b>Progression temporaire</b> : ce serveur efface les données au redémarrage. <u>Voir comment la garder</u></span></a>`);
  return out.join("");
}

// ---------- Router ----------
function render() {
  if (CONFIG.auth && !session) return viewLogin();
  if (!S) return;
  document.body.classList.remove("out");
  shell();
  const [, view, a, b] = location.hash.split("/");
  if (view !== "auto" || a !== "play") { stopQuiz(); if (Q?.finished) Q = null; }
  if (view === "sheet") viewSheet(a);
  else if (view === "ex") viewEx(a, b);
  else if (view === "career") viewCareer();
  else if (view === "settings") viewSettings();
  else if (view === "auto") a === "play" ? viewQuiz(b) : viewAuto();
  else viewDesk();
  hydrateImages();
}
addEventListener("hashchange", () => { scrollTo(0, 0); render(); });

// ---------- Desk ----------
function viewDesk() {
  const due = allEx().filter(({ ex }) => reviewDue(ex));
  const p = S.profile, todayXp = p.daily[S.today] || 0;
  const hello = due.length ? `Tu as <b>${plural(due.length, "exercice")} à réviser</b> → on commence par là ? C'est là que ça rentre vraiment.`
    : p.streak.count > 1 ? `Série de <b>${p.streak.count} jours</b> 🔥 → une petite session aujourd'hui pour la garder ?`
    : todayXp ? `Déjà <b>${todayXp} XP</b> aujourd'hui, propre. On enchaîne ?`
    : `Prends en photo une fiche du prof → je la transforme en entraînement. Ou échauffe-toi avec 10 automatismes ⚡`;
  app.innerHTML = `
    ${banners()}
    <div class="desk-top">
      <div class="card hello">
        <h1>Salut 👋</h1>
        ${coach(hello)}
        <div class="kpis">
          <div class="kpi c-orange"><div class="ico">⚡</div><span class="v">${todayXp}</span><label>XP aujourd'hui</label></div>
          <div class="kpi c-yellow"><div class="ico">🔥</div><span class="v">${p.streak.count}</span><label>jours de série</label></div>
          <div class="kpi c-green"><div class="ico">✅</div><span class="v">${allEx().filter(({ ex }) => exDone(ex)).length}</span><label>exercices terminés</label></div>
          <div class="kpi c-blue"><div class="ico">🔁</div><span class="v">${due.length}</span><label>révisions dues</label></div>
        </div>
      </div>
      <label class="drop" id="drop">
        <input type="file" accept="image/*" hidden id="file" />
        <div class="drop-icon">📸</div>
        <b>Importe une fiche d'exercices</b>
        <span>Glisse une photo ici, clique, ou colle-la (Ctrl+V)</span>
      </label>
    </div>
    <h2>S'échauffer</h2>
    <div class="quick">
      <a class="card lift quick-card c-orange" href="#/auto/play/mix"><div class="ico">⚡</div><div><b>10 automatismes</b><div class="muted small">Questions flash, tous thèmes</div></div></a>
      <a class="card lift quick-card c-blue" href="#/auto/play/exam"><div class="ico">🎯</div><div><b>Épreuve blanche</b><div class="muted small">12 questions · 20 min</div></div></a>
      <a class="card lift quick-card c-purple" href="#/auto"><div class="ico">🧭</div><div><b>Choisir un thème</b><div class="muted small">Pourcentages, fonctions, probas…</div></div></a>
    </div>
    ${due.length ? `<h2>À réviser</h2><div class="grid">${due.map(({ sh, ex }) => exCard(sh, ex)).join("")}</div>` : ""}
    <h2>Mes fiches</h2>
    <div class="sheets">${S.sheets.map(sheetCard).join("") || `<p class="muted">Aucune fiche pour l'instant.</p>`}</div>`;
  const file = $("#file"), drop = $("#drop");
  file.onchange = () => file.files[0] && upload(file.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]); };
  typeset();
}
document.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (f && (location.hash || "#/") === "#/") upload(f);
});

function sheetCard(sh) {
  const done = sh.exercises.filter(exDone).length;
  return `<a class="sheet card lift" href="#/sheet/${sh.id}">
    ${sh.image ? `<img data-img="${sh.image}" alt="">` : `<div class="noimg">📄</div>`}
    <div><b>${esc(sh.title)}</b>
    <div class="muted small">${plural(sh.exercises.length, "exercice")} · ${plural(done, "terminé")} · ${new Date(sh.createdAt).toLocaleDateString("fr-FR")}</div>
    <div class="progress"><span style="width:${(done / sh.exercises.length) * 100}%"></span></div></div></a>`;
}

async function upload(f) {
  if (!hasAi()) { toast("Ajoute d'abord ta clé Anthropic dans Réglages → Clés.", "warn"); location.hash = "#/settings"; return; }
  const drop = $("#drop");
  drop.classList.add("busy");
  drop.innerHTML = `<div class="spinner"></div><b>Léo lit ta fiche…</b><span>Chaque exercice est recopié mot pour mot. Compte 20 à 60 secondes.</span>`;
  try {
    await api("/api/sheets", { image: await shrink(f) });
    toast("Fiche transcrite ✓", "good");
    location.hash = `#/sheet/${S.sheets[0].id}`;
  } catch (e) { fail(e); render(); }
}
// Downscale to ≤2000px JPEG so uploads stay small but text stays readable.
function shrink(file) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = img.width * k; c.height = img.height * k;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => no(new Error("Impossible de lire cette image"));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Sheet ----------
function exCard(sh, ex) {
  const solved = ex.state.filter((s) => s.solved).length;
  const status = reviewDue(ex) ? `<span class="tag warn">À réviser</span>` : ex.review?.mastered ? `<span class="tag good">Maîtrisé</span>`
    : exDone(ex) ? `<span class="tag good">Terminé</span>` : exStarted(ex) ? `<span class="tag blue">En cours</span>` : "";
  const xp = ex.state.reduce((a, s) => a + s.xp, 0);
  return `<a class="card lift ex-card" href="#/ex/${sh.id}/${ex.id}">
    <div class="row"><span class="exnum">${esc(ex.number)}</span>${ex.generated ? `<span class="tag">Jumeau</span>` : ""}${status}</div>
    <b>${esc(ex.title)}</b>
    <div class="muted small">${esc(ex.topic)} · ${plural(ex.parts.length, "question")}</div>
    <div class="row between">${dots(ex.difficulty)}<span class="mono small">${solved}/${ex.parts.length}${xp ? ` · <b class="good-text">+${xp} XP</b>` : ""}</span></div></a>`;
}

function viewSheet(id) {
  const sh = S.sheets.find((s) => s.id === id);
  if (!sh) return (location.hash = "#/");
  app.innerHTML = `
    <a href="#/" class="back">← Bureau</a>
    <div class="row between"><h1>${esc(sh.title)}</h1>${sh.demo ? "" : `<button class="ghost danger sm" id="del">Supprimer la fiche</button>`}</div>
    <div class="sheet-layout">
      <div class="grid">${sh.exercises.map((ex) => exCard(sh, ex)).join("")}</div>
      ${sh.image ? `<a data-img="${sh.image}" target="_blank" class="original"><img data-img="${sh.image}" alt="Fiche originale"><span class="muted small">Photo originale — clique pour agrandir</span></a>` : ""}
    </div>`;
  const del = $("#del");
  if (del) del.onclick = async () => { if (confirm("Supprimer cette fiche et ta progression dessus ?")) { await api(`/api/sheets/${id}`, null, "DELETE").catch(fail); location.hash = "#/"; } };
}

// ---------- Exercise ----------
const drafts = {}; // typed answers survive re-renders
const notesOpen = {}; // which notes boxes are unrolled
// [inserted text, key label, tooltip]: the variable x is drawn in math italics so it never looks like ×.
// Keyboard groups. "calc" and "pow" show on number/expression lines, "set" on ensemble lines, all of them in the notes.
const SYMBOLS = {
  calc: [["x", "x", "La variable x (≠ ×, le signe fois)"], ["(", "(", "Parenthèse"], [")", ")", "Parenthèse"], ["×", "×", "Multiplier (fois)"], ["÷", "÷", "Diviser"], ["/", "/", "Fraction : 3/4"], ["√", "√", "Racine carrée"], ["π", "π", "Pi"], ["≤", "≤", "Inférieur ou égal"], ["≥", "≥", "Supérieur ou égal"], ["≠", "≠", "Différent de"], ["±", "±", "Plus ou moins"], ["∞", "∞", "Infini"], [";", ";", "Séparer plusieurs solutions"], ["°", "°", "Degré"]],
  pow: [["²", "²", "Au carré"], ["³", "³", "Au cube"], ["⁴", "⁴", "Puissance 4"], ["⁵", "⁵", "Puissance 5"], ["⁶", "⁶", "Puissance 6"], ["⁷", "⁷", "Puissance 7"], ["⁸", "⁸", "Puissance 8"], ["⁹", "⁹", "Puissance 9"], ["¹⁰", "¹⁰", "Puissance 10"], ["⁻", "⁻", "Exposant négatif : x⁻¹"], ["^", "^", "Autre puissance : x^12"]],
  set: [["ℝ", "ℝ", "Les réels"], ["ℕ", "ℕ", "Les entiers naturels"], ["ℤ", "ℤ", "Les entiers relatifs"], ["ℚ", "ℚ", "Les rationnels"], ["]", "]", "Crochet"], ["[", "[", "Crochet"], [";", ";", "Séparateur"], ["-∞", "−∞", "Moins l'infini"], ["+∞", "+∞", "Plus l'infini"], ["∪", "∪", "Union"], ["∩", "∩", "Intersection"], ["∖", "∖", "Privé de : ℝ∖{0}"], ["{", "{", "Accolade"], ["}", "}", "Accolade"], ["∅", "∅", "Ensemble vide"], ["∈", "∈", "Appartient à"], ["∉", "∉", "N'appartient pas à"], ["⊂", "⊂", "Inclus dans"], ["⁺", "⁺", "Positifs : ℝ⁺"], ["*", "*", "Sans zéro : ℝ*"]],
};
function keyboard(mode) {
  const btn = (g) => ([s, label, tip]) => `<button data-s="${s}" data-g="${g}" tabindex="-1" title="${tip}" class="${s === "x" ? "var" : g === "pow" ? "sup" : ""}">${label}</button>`;
  return `<div class="sym" data-mode="${mode}">
    ${SYMBOLS.calc.map(btn("calc")).join("")}<i class="sep" data-g="pow"></i>${SYMBOLS.pow.map(btn("pow")).join("")}
    <i class="sep" data-g="set"></i>${SYMBOLS.set.map(btn("set")).join("")}
    <button class="more" tabindex="-1" title="Afficher / masquer les autres symboles">⋯</button></div>`;
}
// One answer line. Its kind (nombre, expression, ensemble, texte) sets the placeholder and the keyboard.
const PLACEHOLDER = { nombre: "ex : 40   2,5   3/4", expression: "ex : 30x − 1200   x⁵ + 2x", ensemble: "ex : ]2 ; +∞[   ℝ∖{3}   [0 ; 1] ∪ [4 ; 5]", texte: "Ta phrase / justification" };
function fieldRow(f, k, st, n) {
  const ok = st.attempts && st.fieldsOk ? st.fieldsOk[k] : null;
  const mark = n > 1 && ok !== null ? `<span class="fmark ${ok ? "good" : "bad"}">${ok ? "✓" : "✗"}</span>` : "";
  const ph = !f.label && n === 1 && !f.hint ? "Ta réponse — écris-la comme tu veux : x = 3/2, 1,5, S = {2 ; 5}…" : PLACEHOLDER[f.kind] || PLACEHOLDER.expression;
  return `<div class="field-row kind-${f.kind} ${ok === true && n > 1 ? "ok" : ok === false && n > 1 ? "ko" : ""}">
    ${f.label ? `<span class="flabel md">${md(f.label)}</span>` : ""}
    <div class="fbox">
      <input class="ans" data-k="${k}" data-kind="${f.kind}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false" />
      ${f.hint || f.kind === "ensemble" ? `<span class="fhint">${f.kind === "ensemble" ? "🔣 ensemble · " : ""}${esc(f.hint || "")}</span>` : ""}
    </div>${mark}
  </div>`;
}
function notesBox(ex, i, title) {
  const key = `${ex.id}:${i}`, text = drafts[key]?.w ?? ex.state[i].notes ?? "";
  const open = notesOpen[key] ?? !!text;
  return `<details class="notes-box" ${open ? "open" : ""}>
    <summary><span class="nb-title">${title}</span><span class="muted small">${text ? `${text.split("\n").filter(Boolean).length} ligne${text.split("\n").filter(Boolean).length > 1 ? "s" : ""}` : "Développe ta réponse ici — Léo s'en sert pour trouver où ça coince"}</span><span class="saved small"></span><span class="chev">▾</span></summary>
    <textarea class="work" rows="6" spellcheck="false" placeholder="Une étape par ligne, par exemple :&#10;B(x) = 48x − (1200 + 18x)&#10;B(x) = 30x − 1200"></textarea>
  </details>`;
}
const explanations = {}; // "Je comprends pas" answers from Léo, per question/step
let examTimer = null;

async function viewEx(sid, eid) {
  clearInterval(examTimer);
  const sh = S.sheets.find((s) => s.id === sid), ex = sh?.exercises.find((e) => e.id === eid);
  if (!ex) return (location.hash = "#/");
  const base = `/api/ex/${sid}/${eid}`;
  const sibl = sh.exercises, idx = sibl.indexOf(ex);

  app.innerHTML = `
    <a href="#/sheet/${sid}" class="back">← ${esc(sh.title)}</a>
    <div class="ex-layout">
      <div class="ex-left">
        <div class="card statement">
          <div class="row between">
            <div class="row"><span class="exnum big">${esc(ex.number)}</span><div><h1>${esc(ex.title)}</h1>
              <div class="row small muted">${esc(ex.topic)} ${dots(ex.difficulty)} ${ex.generated ? `<span class="tag">Jumeau IA — non officiel</span>` : `<span class="tag official">Officiel</span>`}</div></div></div>
            ${sh.image && ex.bbox && !ex.generated ? `<button class="ghost sm" id="scanBtn">Voir l'original</button>` : ""}
          </div>
          <div id="scan" class="scan" hidden></div>
          <div class="md">${md(ex.statement)}</div>
          ${ex.figure ? `<div class="figure"><span class="muted small">Figure</span><div class="md">${md(ex.figure)}</div></div>` : ""}
        </div>
        ${ex.coachIntro ? coach(md(ex.coachIntro), "blue", "Léo · Le plan") : !ex.prepared && hasAi() ? coach(`<span class="spinner sm"></span> Je lis l'exercice et je prépare tes indices…`, "blue") : ""}
        <div class="card lens" id="lens">${ex.businessLens ? lensHtml(ex.businessLens) : `<h3>💼 Angle business</h3><p class="muted small">${ex.prepared ? "" : hasAi() ? "En préparation…" : "Nécessite ta clé Anthropic."}</p>`}</div>
        <div class="card">
          <h3>S'entraîner plus dur</h3>
          ${unlockBtn("exam", ex.exam ? "" : `<button class="ghost wide" id="examOn">⏱ Mode examen</button>`)}
          ${unlockBtn("twin", ex.generated ? "" : `<button class="ghost wide" id="twin">⧉ Exercice jumeau (nouveaux nombres)</button>`)}
          <details class="xp-rules"><summary>Comment je gagne de l'XP ?</summary>
            <p>Base ${10 * ex.difficulty} par question (difficulté × 10) → juste du premier coup ×1,5 → chaque indice réduit (×0,75, ×0,5, ×0,25) → corrigé affiché = 0.<br>Série +${Math.min(S.profile.streak.count, 10) * 5} %${ex.exam ? " · Examen ×1,5" : ""}${ex.generated ? " · Jumeau ×0,75" : ""}</p></details>
        </div>
      </div>
      <div class="ex-right">
        ${ex.exam ? `<div class="exam-bar"><b>Mode examen</b><span class="mono" id="clock">00:00</span><span class="small">Sans indices · ×1,5 XP</span><button class="ghost sm" id="examOff">Quitter</button></div>` : ""}
        ${ex.parts.map((p, i) => partHtml(ex, p, i)).join("")}
        ${exDone(ex) ? `<div class="card done">
            <b class="big">${ex.state.every((s) => s.solved) ? "Exercice terminé 🎉" : "Exercice terminé avec de l'aide"}</b>
            <span class="muted">${ex.review?.due ? `Il reviendra en révision le <b>${new Date(ex.review.due).toLocaleDateString("fr-FR")}</b> → refais-le à froid ce jour-là, c'est comme ça qu'il reste.` : ex.review?.mastered ? "Maîtrisé : résolu proprement sur toutes les révisions espacées." : "Travail propre. Au suivant."}</span>
            <div class="row">${idx < sibl.length - 1 ? `<a class="orange-btn" href="#/ex/${sid}/${sibl[idx + 1].id}">Exercice suivant →</a>` : ""}<button class="ghost" id="retry">Recommencer à zéro</button></div></div>` : ""}
      </div>
    </div>`;
  typeset();

  ex.parts.forEach((p, i) => {
    const el = $(`#part-${i}`), key = `${eid}:${i}`;
    if (!el) return;
    const inputs = [...el.querySelectorAll(".ans")], work = $(".work", el), box = $(".notes-box", el);
    // Notes: saved to the account a moment after you stop typing, and read by Léo when you check.
    work.value = drafts[key]?.w ?? ex.state[i].notes ?? "";
    box.ontoggle = () => (notesOpen[key] = box.open);
    let saveTimer = null;
    work.oninput = () => {
      drafts[key] = { ...drafts[key], w: work.value };
      const flag = $(".saved", el);
      flag.textContent = "…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => fetch(`${base}/notes`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ part: i, notes: work.value }) })
        .then((r) => { flag.textContent = r.ok ? "Enregistré ✓" : "Non enregistré"; }, () => (flag.textContent = "Non enregistré")), 700);
    };
    if (inputs.length) {
      const saved = drafts[key]?.a || ex.state[i].lastAnswers || [];
      const sym = $(".sym", el), modeOf = (inp) => (inp.dataset.kind === "ensemble" ? "set" : "expr");
      // Symbols go into whichever box you were last typing in; the keyboard follows that box's kind.
      let target = inputs[0];
      inputs.forEach((inp, k) => {
        inp.value = saved[k] || "";
        inp.oninput = () => (drafts[key] = { ...drafts[key], a: inputs.map((x) => x.value) });
        inp.onfocus = () => { target = inp; sym.dataset.mode = modeOf(inp); };
        // Block body on purpose: returning false from an on-handler would cancel every keypress.
        inp.onkeydown = (e) => { if (e.key === "Enter") { if (k < inputs.length - 1) inputs[k + 1].focus(); else $(".check", el).click(); } };
      });
      work.onfocus = () => { target = work; sym.dataset.mode = "all"; };
      sym.querySelectorAll("button[data-s]").forEach((b) => {
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = () => { if (target === work) box.open = true; insertAt(target, b.dataset.s); target.dispatchEvent(new Event("input")); };
      });
      const more = $(".more", sym);
      more.onmousedown = (e) => e.preventDefault();
      more.onclick = () => (sym.dataset.mode = sym.dataset.mode === "all" ? (target === work ? "all" : modeOf(target)) : "all");
      $(".check", el).onclick = async (e) => {
        const btn = e.currentTarget;
        busy(btn, "Léo vérifie…");
        try {
          const r = await api(`${base}/check`, { part: i, answers: inputs.map((x) => x.value), work: work.value });
          if (r.result?.verdict === "correct") confetti(btn);
          celebrate(r.result);
          render();
        } catch (err) { fail(err); render(); }
      };
    }
    $(".hint", el)?.addEventListener("click", () => api(`${base}/hint`, { part: i }).then(render, fail));
    $(".reveal", el)?.addEventListener("click", () => confirm("Afficher le corrigé complet ? Cette question rapportera 0 XP et l'exercice reviendra en révision.") && api(`${base}/reveal`, { part: i }).then(render, fail));
    el.querySelectorAll("[data-explain]").forEach((b) => (b.onclick = async () => {
      const step = b.dataset.explain === "q" ? null : Number(b.dataset.explain);
      busy(b, "Léo réfléchit…");
      try {
        const r = await api(`${base}/explain`, { part: i, step });
        explanations[`${eid}:${i}:${step ?? "q"}`] = r.explanation;
        render();
      } catch (err) { fail(err); render(); }
    }));
  });
  $("#scanBtn")?.addEventListener("click", () => toggleScan(sh, ex));
  $("#retry")?.addEventListener("click", () => api(`${base}/retry`, {}).then(render, fail));
  $("#examOn")?.addEventListener("click", () => api(`${base}/exam`, { on: true }).then(render, fail));
  $("#examOff")?.addEventListener("click", () => api(`${base}/exam`, { on: false }).then(render, fail));
  $("#twin")?.addEventListener("click", async (e) => {
    busy(e.currentTarget, "Écriture du jumeau…");
    try { const r = await api(`${base}/twin`, {}); location.hash = `#/ex/${sid}/${r.twinId}`; } catch (err) { fail(err); render(); }
  });
  if (ex.exam) {
    const tick = () => { const s = ((Date.now() - ex.exam.startedAt) / 1000) | 0; const c = $("#clock"); if (c) c.textContent = `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
    tick(); examTimer = setInterval(tick, 1000);
  }

  // First visit: Léo solves the exercise and prepares hints, steps and the business lens in the background.
  // (Also re-prepares exercises from before answer frames existed, if not started yet.)
  if ((!ex.prepared || (ex.legacy && !exStarted(ex))) && hasAi()) {
    try { await api(`${base}/prepare`, {}); if (location.hash === `#/ex/${sid}/${eid}`) render(); }
    catch (e) { const l = $("#lens"); if (l) l.innerHTML = `<h3>💼 Angle business</h3><p class="small bad-text">${esc(e.message)}</p>`; }
  }
}

function unlockBtn(feature, html) {
  const need = S.unlocks[feature];
  if (S.level >= need) return html;
  return `<div class="locked">🔒 ${feature === "exam" ? "Mode examen" : "Exercices jumeaux"} <span class="small">— débloqué au rang ${S.levels[need].rank}</span></div>`;
}
function lensHtml(l) {
  return `<h3>💼 Angle business</h3><div class="lens-concept">${md(l.concept)}</div><p class="small">${md(l.scenario)}</p><p class="small takeaway">→ ${md(l.takeaway)}</p>`;
}

function stepsHtml(ex, p, i) {
  const eid = ex.id;
  if (!p.steps?.length) return `<div class="md step-plain">${md(p.solution || "")}</div>`;
  const cards = p.steps.map((s, k) => {
    const ex2 = explanations[`${eid}:${i}:${k}`];
    return `<div class="step"><div class="num">${k + 1}</div><div>
        <div class="say">${md(s.say)}</div>
        ${s.math ? `<div class="math">${md(`$\\displaystyle ${s.math}$`)}</div>` : ""}
        ${ex2 ? `<div class="mini">${coach(md(ex2), "blue", "Léo · Autrement dit")}</div>` : hasAi() && !ex.demo ? `<button class="link ask" data-explain="${k}">🤔 Pas clair ? Explique autrement</button>` : ""}
      </div></div>`;
  });
  return `<div class="steps">${cards.join(`<div class="arrow">↓</div>`)}</div>`;
}

function partHtml(ex, p, i) {
  const st = ex.state[i];
  const closed = st.solved || st.revealed;
  const verdict = st.feedback?.verdict;
  const fb = st.feedback && !closed ? coach(md(st.feedback.text), verdict, { correct: "Léo · Juste !", partial: "Léo · Presque", incorrect: "Léo · Pas encore" }[verdict]) : "";
  const hints = p.hints.map((h, k) => coach(md(h), "hint", `Léo · Indice ${k + 1}/3`)).join("");
  const qExplain = explanations[`${ex.id}:${i}:q`];
  return `<section class="card part ${st.solved ? "solved" : st.revealed ? "revealed" : ""}" id="part-${i}">
    <div class="part-head">${p.label ? `<span class="label">${esc(p.label)}</span>` : ""}<div class="md">${md(p.prompt)}</div>
      ${st.solved ? `<span class="tag good">+${st.xp} XP</span>` : st.revealed ? `<span class="tag">0 XP</span>` : st.attempts ? `<span class="tag">${plural(st.attempts, "essai")}</span>` : ""}</div>
    ${qExplain ? coach(md(qExplain), "blue", "Léo · La question, en clair") : ""}
    ${hints}
    ${closed ? `
      ${st.solved && st.feedback?.text ? coach(md(st.feedback.text), "good", "Léo · Juste !") : ""}
      <div class="final"><span class="lbl">Réponse</span><div class="final-rows">${p.fields.some((f) => f.label)
        ? p.fields.map((f) => `<div class="md">${md(f.label)} ${md(/\$/.test(f.answer || "") ? f.answer : `$${f.answer || ""}$`)}</div>`).join("")
        : `<div class="md">${md(p.answer || "")}</div>`}</div></div>
      <details ${st.revealed ? "open" : ""}><summary class="link">Voir la correction pas à pas</summary><div style="margin-top:12px">${stepsHtml(ex, p, i)}</div></details>
      ${p.commonMistake ? `<div class="mistake">⚠️ <b>Le piège classique :</b> ${md(p.commonMistake)}</div>` : ""}
      ${notesBox(ex, i, "📝 Mes notes")}` : `
      ${fb}
      ${keyboard(p.fields[0]?.kind === "ensemble" ? "set" : "expr")}
      <div class="fields">${p.fields.map((f, k) => fieldRow(f, k, st, p.fields.length)).join("")}</div>
      <div class="row"><button class="orange-btn check">Vérifier${p.fields.length > 1 ? ` les ${p.fields.length} lignes` : ""}</button></div>
      ${notesBox(ex, i, "📝 Brouillon & notes")}
      ${ex.exam ? "" : `<div class="actions">
        ${st.hintsUsed < 3 ? `<button class="ghost hint">💡 Indice ${st.hintsUsed + 1}/3</button>` : ""}
        ${hasAi() && !ex.demo && !qExplain ? `<button class="ghost" data-explain="q">🤔 Je comprends pas la question</button>` : ""}
        <button class="link reveal">Voir le corrigé</button>
      </div>`}`}
  </section>`;
}

function insertAt(t, s) {
  const a = t.selectionStart ?? t.value.length;
  t.value = t.value.slice(0, a) + s + t.value.slice(t.selectionEnd ?? a);
  t.focus(); t.selectionStart = t.selectionEnd = a + s.length;
}
function celebrate(r) {
  if (!r) return;
  if (r.verdict !== "correct") return toast(r.verdict === "partial" ? "Presque — lis ce que dit Léo" : "Pas encore — lis ce que dit Léo", "warn");
  xpBurst(S.profile.xp - r.reward.xp, S.profile.xp, r.reward.clean ? "sans faute ✦ ×1,5" : "");
  levelUp(r.reward.levelUp);
}

// XP bar that slides up from the bottom after a good answer: fills live, counts up, then leaves after ~5 s (countdown line).
let xpfxTimer = null;
const levelIndex = (xp) => S.levels.reduce((a, l, i) => (xp >= l.xp ? i : a), 0);
function pctIn(xp, i) { const L = S.levels[i], N = S.levels[i + 1]; return N ? Math.min(100, ((xp - L.xp) / (N.xp - L.xp)) * 100) : 100; }
function xpBurst(from, to, note = "") {
  if (!(to > from)) return;
  let el = $("#xpfx");
  if (!el) { el = document.createElement("div"); el.id = "xpfx"; document.body.append(el); }
  const i0 = levelIndex(from), i1 = levelIndex(to), N = S.levels[i0 + 1], LIFE = 5000;
  el.className = "";
  el.innerHTML = `<div class="top"><span class="spark">⚡</span><span class="rank">${S.levels[i0].rank}</span><span class="gain mono">+0 XP</span></div>
    <div class="bar"><span style="width:${pctIn(from, i0)}%"></span></div>
    <div class="meta"><span class="cur">${fmt(from)} XP</span><span>${note || (N ? `${N.rank} à ${fmt(N.xp)}` : "")}</span></div><i class="life"></i>`;
  void el.offsetWidth;
  el.classList.add("show");
  const bar = $(".bar span", el), gain = $(".gain", el), cur = $(".cur", el);
  const t0 = performance.now(), D = 1100;
  const count = (t) => {
    const k = Math.min(1, (t - t0) / D), v = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    gain.textContent = `+${v - from} XP`; cur.textContent = `${fmt(v)} XP`;
    if (k < 1) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  // Animation frames pause in background tabs; make sure the final numbers always land.
  setTimeout(() => { gain.textContent = `+${to - from} XP`; cur.textContent = `${fmt(to)} XP`; }, D + 60);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (i1 === i0) return (bar.style.width = `${pctIn(to, i0)}%`);
    // Rank up: fill to the end, flip to the new rank, then fill again from zero.
    bar.style.width = "100%";
    setTimeout(() => {
      $(".rank", el).textContent = `${S.levels[i1].rank} 🎉`;
      el.classList.add("lvl");
      bar.style.transition = "none"; bar.style.width = "0%"; void bar.offsetWidth; bar.style.transition = "";
      bar.style.width = `${pctIn(to, i1)}%`;
    }, 950);
  }));
  const life = LIFE + (i1 > i0 ? 1200 : 0);
  $(".life", el).animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: life, easing: "linear", fill: "forwards" });
  clearTimeout(xpfxTimer);
  xpfxTimer = setTimeout(() => el.classList.remove("show"), life);
}
// Same streak bonus the server applies (+5 % per day of streak, max +50 %), counting today's activity.
function streakMultNow() {
  const s = S.profile.streak, y = new Date(Date.parse(S.today) - 864e5).toISOString().slice(0, 10);
  const c = s.lastDay === S.today ? s.count : s.lastDay === y ? s.count + 1 : 1;
  return 1 + Math.min(c, 10) * 0.05;
}
function levelUp(L) {
  if (!L) return;
  setTimeout(() => { confetti(); toast(`<b>Promotion : ${L.rank} 🎉</b><br><span class="small">${esc(L.unlock)}</span>`, "promo"); }, 600);
}
function toggleScan(sh, ex) {
  const box = $("#scan");
  box.hidden = !box.hidden;
  $("#scanBtn").textContent = box.hidden ? "Voir l'original" : "Masquer l'original";
  if (box.hidden || box.firstChild) return;
  const img = new Image();
  img.onload = () => {
    const pad = 0.02, b = ex.bbox;
    const x = Math.max(0, b.x - pad) * img.width, y = Math.max(0, b.y - pad) * img.height;
    const w = Math.min(1, b.w + 2 * pad) * img.width, h = Math.min(1, b.h + 2 * pad) * img.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
    box.append(c);
  };
  imageUrl(sh.image).then((u) => (img.src = u));
}

// ---------- Automatismes ----------
const autoStats = () => S.profile.auto || {};
function mastery(ids) {
  const st = autoStats();
  let n = 0, ok = 0, seen = 0;
  for (const id of ids) if (st[id]?.n) { n += st[id].n; ok += st[id].ok; seen++; }
  return { pct: n ? Math.round((ok / n) * 100) : 0, seen, n };
}
const pipColor = (s) => (!s?.n ? "var(--line)" : s.ok / s.n >= 0.8 ? "var(--good)" : s.ok / s.n >= 0.5 ? "var(--warn)" : "var(--bad)");

function viewAuto() {
  const all = mastery(SKILLS.map((s) => s.id));
  const runs = S.profile.autoRuns || [];
  const bestExam = runs.filter((r) => r.mode === "exam").reduce((b, r) => Math.max(b, r.score), -1);
  app.innerHTML = `
    <div class="auto-hero">
      <div class="card">
        <span class="tag orange">Première · ${SKILLS.length} automatismes</span>
        <h1 style="margin-top:12px">Automatismes ⚡</h1>
        ${coach("Des questions flash à 4 choix sur tous les automatismes de Première. Le but → des réflexes rapides et sûrs, sans calculatrice. Je t'explique chaque piège au fur et à mesure 😉")}
        <div class="kpis">
          <div class="kpi c-blue"><div class="ico">🧠</div><span class="v">${all.n}</span><label>réponses données</label></div>
          <div class="kpi c-green"><div class="ico">🎯</div><span class="v">${all.n ? all.pct + " %" : "—"}</span><label>de réussite</label></div>
          <div class="kpi c-purple"><div class="ico">🗺️</div><span class="v">${all.seen}/${SKILLS.length}</span><label>automatismes vus</label></div>
          <div class="kpi c-orange"><div class="ico">🏆</div><span class="v">${bestExam >= 0 ? bestExam + "/12" : "—"}</span><label>meilleure épreuve</label></div>
        </div>
        <div class="row" style="margin-top:18px"><a class="btn lg" href="#/auto/play/mix">⚡ Entraînement mixte · 10 questions</a></div>
      </div>
      <div class="card exam-card">
        <span style="font-size:40px">🎯</span>
        <h2>Épreuve blanche</h2>
        <p style="margin:0;opacity:.92">12 questions tirées dans tous les thèmes, 20 minutes, aucune aide pendant l'épreuve. La correction complète arrive à la fin.</p>
        <a class="ghost lg" href="#/auto/play/exam" style="margin-top:8px">Lancer l'épreuve →</a>
      </div>
    </div>
    <h2>Par thème</h2>
    <div class="themes">${THEMES.map((t) => {
      const sk = SKILLS.filter((s) => s.theme === t.id), m = mastery(sk.map((s) => s.id));
      return `<div class="card theme-card c-${t.color}">
        <div class="head"><div class="ico">${t.icon}</div><div><b>${t.name}</b><div class="muted small">${m.seen}/${sk.length} vus${m.n ? ` · ${m.pct} % de réussite` : ""}</div></div></div>
        <div class="mastery"><span style="width:${m.n ? m.pct : 0}%"></span></div>
        <div class="row"><a class="orange-btn sm" href="#/auto/play/T-${t.id}">S'entraîner</a></div>
        <details><summary class="link">Voir les ${sk.length} automatismes</summary><div class="skills">${sk.map((s) => {
          const st = autoStats()[s.id];
          return `<a class="skill" href="#/auto/play/S-${s.id}"><span class="pip" style="background:${pipColor(st)}"></span>${esc(s.title)}<span class="pct">${st?.n ? Math.round((st.ok / st.n) * 100) + " %" : "nouveau"}</span></a>`;
        }).join("")}</div></details>
      </div>`;
    }).join("")}</div>
    <p class="muted small" style="margin-top:28px">Liste des automatismes inspirée du programme officiel de Première (et du découpage de MathALÉA). Les questions sont générées par Mathéo, avec des nombres différents à chaque fois.</p>`;
}

// One quiz session lives in memory: { spec, mode, items: [{ q, picked }], i, combo, best, startedAt }.
let Q = null, quizTimer = null;
const EXAM_N = 12, TRAIN_N = 10, EXAM_SECONDS = 20 * 60;
function stopQuiz() { clearInterval(quizTimer); quizTimer = null; }
function quizTitle(spec) {
  if (spec === "exam") return "Épreuve blanche";
  if (spec === "mix") return "Entraînement mixte";
  if (spec.startsWith("T-")) return THEMES.find((t) => t.id === spec.slice(2))?.name || "Thème";
  return skillById[spec.slice(2)]?.title || "Automatisme";
}
function startQuiz(spec) {
  const mode = spec === "exam" ? "exam" : "train";
  const n = mode === "exam" ? EXAM_N : TRAIN_N;
  let skills;
  if (mode === "exam") {
    // Spread the 12 questions across all themes, then shuffle.
    const order = Array.from({ length: n }, (_, k) => THEMES[k % THEMES.length].id);
    skills = order.map((t) => nextSkill(t, autoStats())).sort(() => Math.random() - 0.5);
  } else if (spec.startsWith("S-") && skillById[spec.slice(2)]) skills = Array(n).fill(spec.slice(2));
  else skills = Array.from({ length: n }, () => nextSkill(spec.startsWith("T-") ? spec.slice(2) : null, autoStats()));
  Q = { spec, mode, items: skills.map((s) => ({ q: makeQuestion(s), picked: null })), i: 0, combo: 0, best: 0, pending: 0, startedAt: Date.now(), finished: false, result: null };
}

function viewQuiz(spec = "mix") {
  if (!Q || Q.spec !== spec || (Q.finished && !Q.result)) startQuiz(spec);
  if (Q.finished) return viewQuizResult();
  const it = Q.items[Q.i], q = it.q, answered = it.picked !== null && Q.mode === "train";
  const dotsHtml = Q.items.map((x, k) => {
    const cls = k === Q.i ? "now" : x.picked === null ? "" : Q.mode === "exam" ? "done" : x.picked === x.q.answer ? "ok" : "ko";
    return `<i class="${cls}"></i>`;
  }).join("");
  const right = it.picked === q.answer;
  app.innerHTML = `
    <div class="quiz">
      <div class="quiz-top">
        <button class="x" id="quit" title="Quitter">✕</button>
        <div class="qprogress">${dotsHtml}</div>
        ${Q.mode === "exam" ? `<span class="timer" id="timer">20:00</span>` : `<span class="combo ${Q.combo >= 2 ? "pop" : ""}">🔥 ×${Q.combo}</span>`}
      </div>
      <div class="card qcard">
        <div>
          <div class="skill-name">${esc(quizTitle(spec))} · ${Q.i + 1}/${Q.items.length}${Q.mode === "exam" ? "" : ` · ${esc(q.title)}`}</div>
          <div class="qtext md">${md(q.q)}</div>
        </div>
        ${q.svg ? `<div>${q.svg}</div>` : ""}
      </div>
      <div class="choices">${q.choices.map((c, k) => {
        let cls = "";
        if (answered) cls = k === q.answer ? "right" : k === it.picked ? "wrong" : "dim";
        else if (it.picked === k) cls = "picked";
        return `<button class="choice ${cls}" data-k="${k}" ${answered ? "disabled" : ""}><span class="key">${"ABCD"[k]}</span><span class="md">${md(c)}</span></button>`;
      }).join("")}</div>
      <div class="quiz-foot">
        ${answered ? coach(`${right ? pick(["Exactement ! 🎯", "Bien vu.", "Propre → réflexe acquis.", "Yes ! C'est ça."]) : "Pas grave, c'est un piège classique. Regarde :"}<br>${q.explain.map(md).join("<br>")}`, right ? "good" : "incorrect", right ? "Léo · Juste !" : "Léo · Explication") : ""}
        ${answered ? `<button class="orange-btn lg" id="nextQ">${Q.i < Q.items.length - 1 ? "Suivant →" : "Voir mon score →"}</button>`
          : Q.mode === "exam" ? `<div style="flex:1"></div><button class="btn lg" id="nextQ" ${it.picked === null ? "disabled" : ""}>${Q.i < Q.items.length - 1 ? "Valider →" : "Terminer l'épreuve →"}</button>` : ""}
      </div>
      <p class="muted small" style="text-align:center">Raccourcis : touches <b>A B C D</b> (ou 1-4) pour répondre, <b>Entrée</b> pour continuer.</p>
    </div>`;
  typeset();
  app.querySelectorAll(".choice").forEach((b) => (b.onclick = () => pickChoice(Number(b.dataset.k), b)));
  $("#nextQ")?.addEventListener("click", nextQuestion);
  $("#quit").onclick = () => { if (!Q.items.some((x) => x.picked !== null) || confirm("Quitter la session ? Tes réponses ne seront pas comptées.")) { Q = null; location.hash = "#/auto"; } };
  if (Q.mode === "exam") {
    stopQuiz();
    const tick = () => {
      const left = Math.max(0, EXAM_SECONDS - ((Date.now() - Q.startedAt) / 1000 | 0)), t = $("#timer");
      if (t) { t.textContent = `${String((left / 60) | 0).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`; t.classList.toggle("low", left < 120); }
      if (!left) { stopQuiz(); toast("Temps écoulé ⏱", "warn"); finishQuiz(); }
    };
    tick(); quizTimer = setInterval(tick, 1000);
  }
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function pickChoice(k, el) {
  const it = Q.items[Q.i];
  if (Q.mode === "train" && it.picked !== null) return;
  it.picked = k;
  if (Q.mode === "train") {
    if (k === it.q.answer) {
      Q.combo++; Q.best = Math.max(Q.best, Q.combo); confetti(el);
      // Mirrors the server: 4 XP + combo bonus, times the streak bonus, credited at the end of the series.
      const before = Q.pending, m = streakMultNow();
      Q.pending += 4 + Math.min(Math.max(Q.combo - 2, 0), 4);
      xpBurst(S.profile.xp + Math.round(before * m), S.profile.xp + Math.round(Q.pending * m), Q.combo >= 3 ? `combo ×${Q.combo} 🔥` : "crédités en fin de série");
    }
    else Q.combo = 0;
  }
  viewQuiz(Q.spec);
}
function nextQuestion() {
  const it = Q.items[Q.i];
  if (it.picked === null) return;
  if (Q.i < Q.items.length - 1) { Q.i++; viewQuiz(Q.spec); scrollTo(0, 0); }
  else finishQuiz();
}
async function finishQuiz() {
  if (Q.finished) return;
  stopQuiz();
  Q.finished = true;
  const results = Q.items.filter((x) => x.picked !== null || Q.mode === "exam").map((x) => ({ skill: x.q.skill, ok: x.picked === x.q.answer }));
  app.innerHTML = `<div class="quiz"><div class="card result-hero"><div class="spinner sm"></div><b>Calcul du score…</b></div></div>`;
  try {
    const r = await api("/api/auto/finish", { mode: Q.mode, theme: Q.spec, results, seconds: (Date.now() - Q.startedAt) / 1000 | 0 });
    Q.result = r.result;
    if (Q.mode === "exam") xpBurst(S.profile.xp - r.result.xp, S.profile.xp, `épreuve : ${r.result.score}/${r.result.total}`);
    shell();
    levelUp(r.result.levelUp);
  } catch (e) { fail(e); Q.result = { xp: 0, score: results.filter((x) => x.ok).length, total: results.length, bestCombo: Q.best, offline: true }; }
  viewQuizResult();
}
function viewQuizResult() {
  const r = Q.result, pctScore = Math.round((r.score / r.total) * 100);
  const msg = pctScore === 100 ? "Sans faute. Là, c'est du réflexe 🔥" : pctScore >= 75 ? "Très solide ! Regarde juste les questions ratées → c'est là que tu gagnes encore des points."
    : pctScore >= 50 ? "La moitié est acquise. Lis bien mes explications sur les ratés, puis relance une session sur le même thème." : "Ça pique un peu, et c'est normal au début. Chaque erreur corrigée maintenant, c'est un point gagné le jour J → relis les explications.";
  if (pctScore >= 75) setTimeout(() => confetti($(".score-ring")), 200);
  app.innerHTML = `
    <div class="quiz">
      <div class="card result-hero">
        <span class="tag blue">${esc(quizTitle(Q.spec))}</span>
        <div class="score-ring" style="--p:${pctScore}"><div>${r.score}/${r.total}</div></div>
        <div class="row" style="justify-content:center">
          <span class="tag orange">+${r.xp} XP</span>
          ${Q.mode === "train" ? `<span class="tag">🔥 meilleur combo ×${r.bestCombo ?? Q.best}</span>` : `<span class="tag">⏱ ${Math.floor((Date.now() - Q.startedAt) / 60000)} min</span>`}
        </div>
        <div style="max-width:620px;text-align:left;width:100%">${coach(msg)}</div>
        <div class="row" style="justify-content:center"><button class="orange-btn lg" id="again">Rejouer</button><a class="ghost lg" href="#/auto">Retour aux automatismes</a></div>
      </div>
      <h2>Correction</h2>
      <div class="review">${Q.items.map((x, k) => {
        const ok = x.picked === x.q.answer;
        return `<div class="card review-item"><span class="mark" style="background:${ok ? "var(--good)" : "var(--bad)"}">${ok ? "✓" : "✗"}</span><div>
          <div class="muted small">${k + 1}. ${esc(x.q.title)}</div>
          <div class="md">${md(x.q.q)}</div>
          ${x.q.svg ? `<div style="margin-top:8px">${x.q.svg}</div>` : ""}
          <div class="row" style="margin-top:8px">${x.picked !== null && !ok ? `<span class="tag" style="color:var(--bad)">Ta réponse : <span class="md">${md(x.q.choices[x.picked])}</span></span>` : x.picked === null ? `<span class="tag">Pas répondu</span>` : ""}<span class="tag good">Bonne réponse : <span class="md">${md(x.q.choices[x.q.answer])}</span></span></div>
          <details ${ok ? "" : "open"}><summary>Explication de Léo</summary><div style="margin-top:8px">${coach(x.q.explain.map(md).join("<br>"), "blue")}</div></details>
        </div></div>`;
      }).join("")}</div>
    </div>`;
  typeset();
  $("#again").onclick = () => { const spec = Q.spec; Q = null; startQuiz(spec); viewQuiz(spec); scrollTo(0, 0); };
}
// Keyboard: A-D / 1-4 to answer, Enter to continue.
document.addEventListener("keydown", (e) => {
  if (!Q || Q.finished || !location.hash.startsWith("#/auto/play") || e.target.matches("input, textarea")) return;
  const k = "abcd".indexOf(e.key.toLowerCase()) >= 0 ? "abcd".indexOf(e.key.toLowerCase()) : "1234".indexOf(e.key);
  if (k >= 0) { const b = app.querySelectorAll(".choice")[k]; if (b && !b.disabled) b.click(); }
  else if (e.key === "Enter") $("#nextQ")?.click();
});

// ---------- Career ----------
function viewCareer() {
  const p = S.profile;
  const byTopic = {};
  for (const { ex } of allEx()) {
    const t = (byTopic[ex.topic] ||= { parts: 0, solved: 0, clean: 0, xp: 0 });
    ex.state.forEach((s) => { if (s.attempts || s.revealed) t.parts++; if (s.solved) t.solved++; if (s.solved && s.attempts === 1 && !s.hintsUsed) t.clean++; t.xp += s.xp; });
  }
  const topics = Object.entries(byTopic).filter(([, t]) => t.parts).sort((a, b) => b[1].xp - a[1].xp);
  const mTypes = {};
  p.mistakes.forEach((m) => (mTypes[m.type] = (mTypes[m.type] || 0) + 1));
  const days = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
  const maxDay = Math.max(1, ...days.map((d) => p.daily[d] || 0));
  const runs = (p.autoRuns || []).slice(0, 6);

  app.innerHTML = `
    <h1>Carrière</h1>
    <p class="muted">Chaque bonne réponse vérifiée te fait monter. Pas de raccourci → que du vrai travail.</p>
    <div class="career">
      <div>
        <div class="card"><h3>Échelons</h3>
          <ol class="ladder">${S.levels.map((L, i) => `<li class="${i < S.level ? "past" : i === S.level ? "now" : ""}">
            <span class="mono small">${fmt(L.xp)}</span><b>${i < S.level ? "✓ " : i === S.level ? "→ " : ""}${L.rank}</b><span class="small">${esc(L.unlock)}</span></li>`).join("")}</ol></div>
        <div class="card"><h3>Tes propres récompenses</h3>
          <p class="muted small">Fixe de vraies récompenses à des paliers d'XP — le jeu ne marche que si le prix est quelque chose que tu veux vraiment.</p>
          <ul class="rewards">${p.rewards.map((r) => `<li class="${p.xp >= r.xp ? "ready" : ""}">
            <span class="mono small">${fmt(r.xp)} XP</span><span>${esc(r.title)}</span>
            ${r.claimed ? `<span class="tag good">Obtenue le ${new Date(r.claimed).toLocaleDateString("fr-FR")}</span>` : p.xp >= r.xp ? `<button class="orange-btn sm" data-claim="${r.id}">Réclamer 🎁</button>` : `<span class="muted small">encore ${fmt(r.xp - p.xp)}</span>`}
            <button class="x" data-del="${r.id}" title="Supprimer">×</button></li>`).join("") || `<li class="muted small">Aucune récompense pour l'instant.</li>`}</ul>
          <form id="rew" class="row"><input name="title" placeholder="ex. Nouvelles baskets, soirée ciné" /><input name="xp" type="number" min="1" placeholder="XP" style="max-width:110px" /><button class="btn">Ajouter</button></form>
        </div>
      </div>
      <div>
        <div class="card"><h3>XP des 14 derniers jours</h3>
          <div class="chart">${days.map((d) => `<div title="${d} : ${p.daily[d] || 0} XP"><span style="height:${((p.daily[d] || 0) / maxDay) * 100}%"></span></div>`).join("")}</div></div>
        <div class="card"><h3>Automatismes récents</h3>
          ${runs.length ? `<table class="tbl"><tr><th>Date</th><th>Session</th><th>Score</th><th>XP</th></tr>${runs.map((r) => `<tr><td>${new Date(r.day).toLocaleDateString("fr-FR")}</td><td>${esc(quizTitle(r.theme))}</td><td class="mono">${r.score}/${r.total}</td><td class="mono">+${r.xp}</td></tr>`).join("")}</table>` : `<p class="muted small">Lance une session dans <a href="#/auto"><u>Automatismes</u></a> pour la voir ici.</p>`}</div>
        <div class="card"><h3>Portefeuille par thème</h3>
          ${topics.length ? `<table class="tbl"><tr><th>Thème</th><th>Réussies</th><th>Sans faute</th><th>XP</th></tr>${topics.map(([n, t]) => `<tr><td>${esc(n)}</td><td class="mono">${t.solved}/${t.parts}</td><td class="mono">${Math.round((t.clean / t.parts) * 100)} %</td><td class="mono">${t.xp}</td></tr>`).join("")}</table>` : `<p class="muted small">Résous des exercices de tes fiches pour construire ton portefeuille.</p>`}</div>
        <div class="card"><h3>Carnet d'erreurs</h3>
          ${S.level >= 1 && p.mistakes.length ? `<div class="chips">${Object.entries(mTypes).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="tag orange">${esc(t)} × ${n}</span>`).join("")}</div>` : ""}
          <ul class="mistakes">${p.mistakes.slice(0, 10).map((m) => `<li><span class="muted small">${new Date(m.day).toLocaleDateString("fr-FR")} · ${esc(m.exercise)} · ${esc(m.type)}</span><div class="small">${md(m.note)}</div></li>`).join("") || `<li class="muted small">Chaque essai raté arrive ici avec ce qui n'allait pas. Relis-le avant un contrôle.</li>`}</ul></div>
      </div>
    </div>`;
  typeset();
  $("#rew").onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); api("/api/rewards", { title: f.get("title"), xp: f.get("xp") }).then(render, fail); };
  app.querySelectorAll("[data-claim]").forEach((b) => (b.onclick = () => api(`/api/rewards/${b.dataset.claim}/claim`, {}).then(() => { confetti(b); toast("Profites-en, tu l'as mérité 🎉", "promo"); render(); }, fail)));
  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => api(`/api/rewards/${b.dataset.del}`, null, "DELETE").then(render, fail)));
}

// ---------- Settings ----------
function viewSettings() {
  const p = S.profile, k = S.keys, mine = getKey();
  const themes = [["default", 0], ["gold", 1], ["emerald", 4], ["crimson", 6]];
  const storage = { supabase: ["good", "Supabase — ta progression est sauvegardée dans ton compte."], file: ["good", "Fichiers locaux (dossier data/) — ta progression est sauvegardée."], temp: ["warn", "Temporaire — Vercel efface les données au redémarrage."] }[k.storage];
  app.innerHTML = `
    <h1>Réglages</h1>
    <div class="career">
      <div>
        <div class="card"><h3>Clés</h3>
          <label class="small"><b>Clé API Anthropic</b> <span class="muted">— pour lire tes photos, préparer les indices et corriger tes calculs</span></label>
          <div class="row keyrow"><input id="key" type="password" placeholder="${mine ? "•••• enregistrée dans ce navigateur" : "sk-ant-…"}" autocomplete="off" spellcheck="false" />
            <button class="btn" id="saveKey">Enregistrer</button>${mine ? `<button class="ghost danger" id="delKey">Retirer</button>` : ""}</div>
          <p class="small muted">Stockée <b>uniquement dans ce navigateur</b> et envoyée à ton serveur Mathéo à chaque requête — jamais enregistrée côté serveur. Crée-en une sur <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener"><u>console.anthropic.com</u></a>.</p>
          <ul class="status">
            <li class="${mine ? "good" : "muted"}">${mine ? "✓" : "○"} Clé dans ce navigateur</li>
            <li class="${k.server ? "good" : "muted"}">${k.server ? "✓" : "○"} Clé sur le serveur (<span class="mono">ANTHROPIC_API_KEY</span>)</li>
          </ul>
          <h3 style="margin-top:22px">Sauvegarde de la progression</h3>
          <p class="small ${storage[0]}-text">● ${storage[1]}</p>
          ${k.storage === "temp" ? `<p class="small muted">Pour garder ta progression sur Vercel : projet Vercel → <b>Storage</b> → <b>Create Database</b> → <b>Supabase</b> → connecte-la au projet, puis redéploie.</p>` : ""}
        </div>
      </div>
      <div>
        ${session ? `<div class="card"><h3>Compte</h3><p class="small">Connecté en tant que <b>${esc(session.user.email)}</b></p><button class="ghost" id="logout">Se déconnecter</button></div>` : ""}
        <div class="card"><h3>Langue</h3>
          <label class="small muted">Langue des indices, retours et corrigés</label>
          <select id="lang">${["Français", "English", "Polski", "auto"].map((l) => `<option ${p.settings.lang === l ? "selected" : ""} value="${l}">${l === "auto" ? "Celle de l'exercice" : l}</option>`).join("")}</select>
          <p class="small muted">Les énoncés restent toujours dans leur langue d'origine, mot pour mot.</p>
        </div>
        <div class="card"><h3>Couleur</h3>
          <div class="row">${themes.map(([t, need]) => `<button class="swatch ${t}" data-theme="${t}" ${S.level < need ? `disabled title="Débloqué au rang ${S.levels[need].rank}"` : ""}>${S.level < need ? "🔒" : ""}</button>`).join("")}</div>
        </div>
      </div>
    </div>`;
  $("#saveKey").onclick = async () => {
    const v = $("#key").value.trim();
    if (!v) return toast("Colle ta clé d'abord.", "warn");
    if (!/^sk-ant-/.test(v)) return toast("Une clé Anthropic commence par sk-ant-", "warn");
    setKey(v);
    toast("Clé enregistrée dans ce navigateur ✓", "good");
    api("/api/state").then(render, fail);
  };
  $("#delKey")?.addEventListener("click", () => { setKey(""); toast("Clé retirée de ce navigateur."); api("/api/state").then(render, fail); });
  app.querySelectorAll("[data-theme]").forEach((b) => (b.onclick = () => api("/api/settings", { theme: b.dataset.theme }).then(render, fail)));
  $("#lang").onchange = (e) => api("/api/settings", { lang: e.target.value }).then(render, fail);
  $("#logout")?.addEventListener("click", () => sb.auth.signOut());
}

// ---------- Login ----------
function viewLogin(mode = "login") {
  document.body.classList.add("out");
  for (const id of ["#nav", "#tabbar", "#hud", "#hud-mobile"]) $(id).innerHTML = "";
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-art">
        <div class="brand" style="padding:0"><span class="logo">M</span><span>Mathéo</span></div>
        <div><h1>Tes vrais exercices de maths, en mode jeu.</h1>
          <p>Photo de ta fiche → exercices interactifs, corrigés intelligents, XP et automatismes de Première. Ta progression te suit partout.</p></div>
        ${coach("Salut, moi c'est Léo 🦊 Je t'explique tout simplement, avec des flèches → et des exemples concrets. On s'y met ?")}
      </div>
      <div class="auth-form">
        <div class="tabs"><button class="${mode === "login" ? "on" : ""}" data-mode="login">Se connecter</button><button class="${mode === "signup" ? "on" : ""}" data-mode="signup">Créer un compte</button></div>
        <form id="auth">
          <label class="small">E-mail</label>
          <input name="email" type="email" autocomplete="email" required />
          <label class="small">Mot de passe${mode === "signup" ? " <span class='muted'>(8 caractères minimum)</span>" : ""}</label>
          <input name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" minlength="${mode === "signup" ? 8 : 1}" required />
          <button class="orange-btn lg">${mode === "signup" ? "Créer mon compte" : "Se connecter"}</button>
        </form>
      </div>
    </div>`;
  app.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => viewLogin(b.dataset.mode)));
  $("#auth").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), email = f.get("email").trim(), password = f.get("password");
    busy($("#auth .orange-btn"), mode === "signup" ? "Création…" : "Connexion…");
    try {
      if (mode === "signup") {
        const r = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(/invalid/i.test(error.message) ? "E-mail ou mot de passe incorrect." : error.message);
    } catch (err) { fail(err); viewLogin(mode); }
  };
}

async function boot() {
  CONFIG = await fetch("/api/config").then((r) => r.json());
  if (CONFIG.error) throw new Error(CONFIG.error);
  if (CONFIG.auth) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm");
    sb = createClient(CONFIG.auth.url, CONFIG.auth.anon);
    session = (await sb.auth.getSession()).data.session;
    sb.auth.onAuthStateChange((event, s) => {
      const was = session?.user.id;
      session = s;
      if (!s) { S = null; Q = null; for (const k in imgCache) delete imgCache[k]; location.hash = "#/"; return viewLogin(); }
      if (s.user.id !== was) api("/api/state").then(render, fail);
    });
    if (!session) return viewLogin();
  }
  await api("/api/state");
  render();
}
boot().catch(fail);
