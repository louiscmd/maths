// Proof — client
let S = null; // server state
const app = document.getElementById("app");
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("fr-FR");

// The Anthropic key lives only in this browser and is sent with each request; the server never stores it.
const KEY = "proof.anthropicKey";
const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const setKey = (k) => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };

async function api(url, body, method) {
  const headers = { "Content-Type": "application/json" };
  if (getKey()) headers["x-anthropic-key"] = getKey();
  const res = await fetch(url, { method: method || (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "La requête a échoué");
  S = data;
  return data;
}

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

// ---------- Helpers ----------
const lvl = () => S.levels[S.level];
const next = () => S.levels[S.level + 1];
const hasAi = () => S.keys.server || !!getKey();
const exDone = (ex) => ex.state.every((s) => s.solved || s.revealed);
const exStarted = (ex) => ex.state.some((s) => s.attempts || s.hintsUsed || s.revealed);
const reviewDue = (ex) => ex.review?.due && !ex.review.mastered && ex.review.due <= S.today;
const allEx = () => S.sheets.flatMap((sh) => sh.exercises.map((ex) => ({ sh, ex })));
const dots = (n) => `<span class="dots" title="Difficulté ${n}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
function applyTheme() {
  const themes = [[1, "gold"], [4, "emerald"], [6, "crimson"]].filter(([l]) => S.level >= l).map(([, t]) => t);
  const t = S.profile.settings.theme;
  document.documentElement.dataset.accent = t && (t === "default" || themes.includes(t)) ? t : "default";
}

function hud() {
  const p = S.profile, L = lvl(), N = next();
  const pct = N ? ((p.xp - L.xp) / (N.xp - L.xp)) * 100 : 100;
  $("#hud").innerHTML = `
    <div class="streak" title="Série de jours : +5 % d'XP par jour, jusqu'à +50 %">🔥 ${p.streak.count}</div>
    <a href="#/career" class="rank"><span class="rank-name">${L.rank}</span>
      <span class="bar"><span style="width:${pct}%"></span></span>
      <span class="mono xp">${fmt(p.xp)} XP${N ? ` / ${fmt(N.xp)}` : ""}</span></a>`;
  applyTheme();
}

function banners() {
  const out = [];
  if (!hasAi()) out.push(`<a class="banner" href="#/settings">🔑 <span><b>Ajoute ta clé Anthropic</b> pour transcrire tes photos et avoir une correction intelligente. <u>Réglages → Clés</u></span></a>`);
  if (S.keys.storage === "temp") out.push(`<a class="banner warn" href="#/settings">⚠️ <span><b>Progression temporaire</b> : ce serveur efface les données au redémarrage. <u>Voir comment la garder</u></span></a>`);
  return out.join("");
}

// ---------- Router ----------
function render() {
  if (!S) return;
  hud();
  const [, view, a, b] = location.hash.split("/");
  if (view === "sheet") return viewSheet(a);
  if (view === "ex") return viewEx(a, b);
  if (view === "career") return viewCareer();
  if (view === "settings") return viewSettings();
  viewDesk();
}
addEventListener("hashchange", () => { scrollTo(0, 0); render(); });

// ---------- Desk ----------
function viewDesk() {
  const due = allEx().filter(({ ex }) => reviewDue(ex));
  const todayXp = S.profile.daily[S.today] || 0;
  app.innerHTML = `
    ${banners()}
    <section class="hero">
      <div>
        <h1>Ton bureau</h1>
        <p class="muted">Prends en photo une fiche d'exercices officielle. Proof la recopie mot pour mot et en fait un entraînement qui vérifie vraiment ton travail.</p>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="mono">${todayXp}</span><label>XP aujourd'hui</label></div>
        <div class="kpi"><span class="mono">${allEx().filter(({ ex }) => exDone(ex)).length}</span><label>exercices terminés</label></div>
        <div class="kpi"><span class="mono">${due.length}</span><label>révisions dues</label></div>
      </div>
    </section>
    <label class="drop" id="drop">
      <input type="file" accept="image/*" hidden id="file" />
      <div class="drop-icon">⇪</div>
      <b>Importe une photo de tes exercices</b>
      <span class="muted">Glisse-la ici, clique pour choisir, ou colle-la (Ctrl+V)</span>
    </label>
    ${due.length ? `<h2>À réviser <span class="muted small">— les exercices où tu as eu besoin d'aide. Refais-les à froid pour les ancrer.</span></h2>
      <div class="grid">${due.map(({ sh, ex }) => exCard(sh, ex)).join("")}</div>` : ""}
    <h2>Fiches</h2>
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
  return `<a class="sheet card" href="#/sheet/${sh.id}">
    ${sh.image ? `<img src="/images/${sh.image}" alt="">` : `<div class="noimg">∎</div>`}
    <div><b>${esc(sh.title)}</b>
    <div class="muted small">${plural(sh.exercises.length, "exercice")} · ${plural(done, "terminé")} · ${new Date(sh.createdAt).toLocaleDateString("fr-FR")}</div>
    <div class="progress"><span style="width:${(done / sh.exercises.length) * 100}%"></span></div></div></a>`;
}

async function upload(f) {
  if (!hasAi()) { toast("Ajoute d'abord ta clé Anthropic dans Réglages → Clés.", "warn"); location.hash = "#/settings"; return; }
  const drop = $("#drop");
  drop.classList.add("busy");
  drop.innerHTML = `<div class="spinner"></div><b>Lecture de ta fiche…</b><span class="muted">Chaque exercice est recopié mot pour mot. Compte 20 à 60 secondes.</span>`;
  try {
    const dataUrl = await shrink(f);
    await api("/api/sheets", { image: dataUrl });
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
    : exDone(ex) ? `<span class="tag good">Terminé</span>` : exStarted(ex) ? `<span class="tag">En cours</span>` : "";
  const xp = ex.state.reduce((a, s) => a + s.xp, 0);
  return `<a class="card ex-card" href="#/ex/${sh.id}/${ex.id}">
    <div class="row"><span class="exnum mono">${esc(ex.number)}</span>${ex.generated ? `<span class="tag">Jumeau</span>` : ""}${status}</div>
    <b>${esc(ex.title)}</b>
    <div class="muted small">${esc(ex.topic)} · ${plural(ex.parts.length, "question")}</div>
    <div class="row between">${dots(ex.difficulty)}<span class="mono small">${solved}/${ex.parts.length}${xp ? ` · +${xp} XP` : ""}</span></div></a>`;
}

function viewSheet(id) {
  const sh = S.sheets.find((s) => s.id === id);
  if (!sh) return (location.hash = "#/");
  app.innerHTML = `
    <a href="#/" class="back">← Bureau</a>
    <div class="row between"><h1>${esc(sh.title)}</h1>${sh.demo ? "" : `<button class="ghost danger" id="del">Supprimer la fiche</button>`}</div>
    <div class="sheet-layout">
      <div class="grid">${sh.exercises.map((ex) => exCard(sh, ex)).join("")}</div>
      ${sh.image ? `<a href="/images/${sh.image}" target="_blank" class="original"><img src="/images/${sh.image}" alt="Fiche originale"><span class="muted small">Photo originale — clique pour agrandir</span></a>` : ""}
    </div>`;
  const del = $("#del");
  if (del) del.onclick = async () => { if (confirm("Supprimer cette fiche et ta progression dessus ?")) { await api(`/api/sheets/${id}`, null, "DELETE").catch(fail); location.hash = "#/"; } };
}

// ---------- Exercise ----------
const drafts = {}; // keep typed answers across re-renders
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
      <article>
        <div class="card statement">
          <div class="row between">
            <div class="row"><span class="exnum mono big">${esc(ex.number)}</span><div><h1>${esc(ex.title)}</h1>
              <div class="muted small">${esc(ex.topic)} · ${dots(ex.difficulty)} ${ex.generated ? `· <span class="tag">Jumeau IA — non officiel</span>` : `· <span class="tag official">Officiel</span>`}</div></div></div>
            ${sh.image && ex.bbox && !ex.generated ? `<button class="ghost" id="scanBtn">Voir l'original</button>` : ""}
          </div>
          <div id="scan" class="scan" hidden></div>
          <div class="md">${md(ex.statement)}</div>
          ${ex.figure ? `<div class="figure"><span class="muted small">Figure</span><div class="md">${md(ex.figure)}</div></div>` : ""}
        </div>
        ${ex.exam ? `<div class="exam-bar"><b>Mode examen</b><span class="mono" id="clock">00:00</span><span class="muted small">Sans indices · ×1,5 XP</span><button class="ghost" id="examOff">Quitter le mode examen</button></div>` : ""}
        ${ex.parts.map((p, i) => partHtml(ex, p, i)).join("")}
        ${exDone(ex) ? `<div class="card done">
            <b>${ex.state.every((s) => s.solved) ? "Exercice terminé." : "Exercice terminé avec de l'aide."}</b>
            <span class="muted">${ex.review?.due ? `Il reviendra en révision le <b>${new Date(ex.review.due).toLocaleDateString("fr-FR")}</b> — refais-le à froid ce jour-là pour qu'il reste.` : ex.review?.mastered ? "Maîtrisé : résolu proprement sur toutes les révisions espacées." : "Travail propre. Au suivant."}</span>
            <div class="row">${idx < sibl.length - 1 ? `<a class="btn" href="#/ex/${sid}/${sibl[idx + 1].id}">Exercice suivant →</a>` : ""}<button class="ghost" id="retry">Recommencer à zéro</button></div></div>` : ""}
      </article>
      <aside>
        <div class="card side">
          <h3>XP sur cet exercice</h3>
          <p class="small muted">Base ${10 * ex.difficulty} par question (difficulté × 10).<br>Juste du premier coup ×1,5 · chaque indice réduit (×0,75, ×0,5, ×0,25) · corrigé affiché = 0.<br>Série +${Math.min(S.profile.streak.count, 10) * 5} %${ex.exam ? " · Examen ×1,5" : ""}${ex.generated ? " · Jumeau ×0,75" : ""}</p>
        </div>
        <div class="card side lens" id="lens">${ex.businessLens ? lensHtml(ex.businessLens) : `<h3>💼 Angle business</h3><p class="muted small">${ex.prepared ? "" : hasAi() ? "Préparation…" : "Nécessite ta clé Anthropic."}</p>`}</div>
        <div class="card side">
          <h3>S'entraîner plus dur</h3>
          ${unlockBtn("exam", ex.exam ? "" : `<button class="ghost wide" id="examOn">⏱ Mode examen</button>`)}
          ${unlockBtn("twin", ex.generated ? "" : `<button class="ghost wide" id="twin">⧉ Exercice jumeau (nouveaux nombres)</button>`)}
        </div>
      </aside>
    </div>`;
  typeset();

  ex.parts.forEach((p, i) => {
    const el = $(`#part-${i}`), key = `${eid}:${i}`;
    if (!el) return;
    const ans = $(".ans", el), work = $(".work", el);
    if (ans) {
      ans.value = drafts[key]?.a || ""; work.value = drafts[key]?.w || "";
      ans.oninput = work.oninput = () => (drafts[key] = { a: ans.value, w: work.value });
      el.querySelectorAll(".sym button").forEach((b) => (b.onclick = () => { const t = document.activeElement === work ? work : ans; insertAt(t, b.dataset.s); t.dispatchEvent(new Event("input")); }));
      ans.onkeydown = (e) => e.key === "Enter" && $(".check", el).click();
      $(".check", el).onclick = async (e) => {
        busy(e.target, "Vérification…");
        try {
          const r = await api(`${base}/check`, { part: i, answer: ans.value, work: work.value });
          celebrate(r.result);
          render();
        } catch (err) { fail(err); render(); }
      };
    }
    $(".hint", el)?.addEventListener("click", () => api(`${base}/hint`, { part: i }).then(render, fail));
    $(".reveal", el)?.addEventListener("click", () => confirm("Afficher le corrigé complet ? Cette question rapportera 0 XP et l'exercice reviendra en révision.") && api(`${base}/reveal`, { part: i }).then(render, fail));
  });
  $("#scanBtn")?.addEventListener("click", () => toggleScan(sh, ex));
  $("#retry")?.addEventListener("click", () => api(`${base}/retry`, {}).then(render, fail));
  $("#examOn")?.addEventListener("click", () => api(`${base}/exam`, { on: true }).then(render, fail));
  $("#examOff")?.addEventListener("click", () => api(`${base}/exam`, { on: false }).then(render, fail));
  $("#twin")?.addEventListener("click", async (e) => {
    busy(e.target, "Écriture du jumeau…");
    try { const r = await api(`${base}/twin`, {}); location.hash = `#/ex/${sid}/${r.twinId}`; } catch (err) { fail(err); render(); }
  });
  if (ex.exam) {
    const tick = () => { const s = ((Date.now() - ex.exam.startedAt) / 1000) | 0; const c = $("#clock"); if (c) c.textContent = `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
    tick(); examTimer = setInterval(tick, 1000);
  }

  // Solve + build hints/business lens in the background the first time an exercise is opened.
  if (!ex.prepared && hasAi()) {
    try { await api(`${base}/prepare`, {}); if (location.hash === `#/ex/${sid}/${eid}`) render(); }
    catch (e) { const l = $("#lens"); if (l) l.innerHTML = `<h3>💼 Angle business</h3><p class="small bad-text">${esc(e.message)}</p>`; }
  }
}

function unlockBtn(feature, html) {
  const need = S.unlocks[feature];
  if (S.level >= need) return html;
  return `<div class="locked">🔒 ${feature === "exam" ? "Mode examen" : "Exercices jumeaux"} <span class="muted small">— débloqué au rang ${S.levels[need].rank}</span></div>`;
}

function lensHtml(l) {
  return `<h3>💼 Angle business</h3><div class="small lens-concept">${md(l.concept)}</div><p class="small">${md(l.scenario)}</p><p class="small takeaway">→ ${md(l.takeaway)}</p>`;
}

function partHtml(ex, p, i) {
  const st = ex.state[i];
  const closed = st.solved || st.revealed;
  const fb = st.feedback && !closed ? `<div class="feedback ${st.feedback.verdict}"><b>${{ correct: "Juste", partial: "Presque", incorrect: "Pas encore" }[st.feedback.verdict]}</b> ${md(st.feedback.text)}</div>` : "";
  const hints = p.hints.map((h, k) => `<div class="hint-item"><span class="mono small">Indice ${k + 1}</span><div>${md(h)}</div></div>`).join("");
  return `<section class="card part ${st.solved ? "solved" : st.revealed ? "revealed" : ""}" id="part-${i}">
    <div class="part-head">${p.label ? `<span class="label mono">${esc(p.label)}</span>` : ""}<div class="md">${md(p.prompt)}</div>
      ${st.solved ? `<span class="tag good">+${st.xp} XP</span>` : st.revealed ? `<span class="tag">0 XP</span>` : st.attempts ? `<span class="muted small mono">${plural(st.attempts, "essai")}</span>` : ""}</div>
    ${hints ? `<div class="hints">${hints}</div>` : ""}
    ${closed ? `
      <div class="answer-box"><span class="muted small">Réponse</span><div class="md">${md(p.answer || "")}</div></div>
      <details ${st.revealed ? "open" : ""}><summary>Corrigé complet</summary><div class="md solution">${md(p.solution || "")}</div>
      ${p.commonMistake ? `<p class="small muted"><b>Erreur fréquente :</b> ${md(p.commonMistake)}</p>` : ""}</details>` : `
      ${fb}
      <div class="sym">${["√", "²", "³", "π", "≤", "≥", "≠", "±", "×", "÷", "∞", "°", "^", "/", ";"].map((s) => `<button data-s="${s}" tabindex="-1">${s}</button>`).join("")}</div>
      <input class="ans" placeholder="Ta réponse finale — écris-la comme tu veux : x = 3/2, 1,5, S = {2 ; 5}…" autocomplete="off" />
      <textarea class="work" rows="3" placeholder="Tes calculs (facultatif, mais c'est comme ça que tu sais OÙ ça a coincé)"></textarea>
      <div class="row">
        <button class="btn check">Vérifier</button>
        ${ex.exam ? "" : `${st.hintsUsed < 3 ? `<button class="ghost hint">💡 Indice ${st.hintsUsed + 1}/3</button>` : ""}<button class="ghost reveal">Voir le corrigé</button>`}
      </div>`}
  </section>`;
}

function insertAt(t, s) {
  const a = t.selectionStart ?? t.value.length;
  t.value = t.value.slice(0, a) + s + t.value.slice(t.selectionEnd ?? a);
  t.focus(); t.selectionStart = t.selectionEnd = a + s.length;
}
function busy(btn, text) { btn.disabled = true; btn.innerHTML = `<span class="spinner sm"></span> ${text}`; }

function celebrate(r) {
  if (!r) return;
  if (r.verdict !== "correct") return toast(r.verdict === "partial" ? "Presque — lis le retour" : "Pas encore — lis le retour", "warn");
  toast(`<span class="mono big">+${r.reward.xp} XP</span>${r.reward.clean ? " · sans faute ✦" : ""}`, "good");
  if (r.reward.levelUp) setTimeout(() => toast(`<b>Promotion : ${r.reward.levelUp.rank}</b><br><span class="small">${esc(r.reward.levelUp.unlock)}</span>`, "promo"), 600);
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
  img.src = `/images/${sh.image}`;
}

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

  app.innerHTML = `
    <h1>Carrière</h1>
    <div class="career">
      <div>
        <div class="card"><h3>Échelons</h3>
          <ol class="ladder">${S.levels.map((L, i) => `<li class="${i < S.level ? "past" : i === S.level ? "now" : ""}">
            <span class="mono small">${fmt(L.xp)}</span><b>${L.rank}</b><span class="muted small">${esc(L.unlock)}</span></li>`).join("")}</ol></div>
        <div class="card"><h3>Tes propres récompenses</h3>
          <p class="muted small">Fixe de vraies récompenses à des paliers d'XP — le jeu ne marche que si le prix est quelque chose que tu veux vraiment.</p>
          <ul class="rewards">${p.rewards.map((r) => `<li class="${p.xp >= r.xp ? "ready" : ""}">
            <span class="mono small">${fmt(r.xp)} XP</span><span>${esc(r.title)}</span>
            ${r.claimed ? `<span class="tag good">Obtenue le ${new Date(r.claimed).toLocaleDateString("fr-FR")}</span>` : p.xp >= r.xp ? `<button class="btn sm" data-claim="${r.id}">Réclamer</button>` : `<span class="muted small">encore ${fmt(r.xp - p.xp)}</span>`}
            <button class="x" data-del="${r.id}" title="Supprimer">×</button></li>`).join("") || `<li class="muted small">Aucune récompense pour l'instant.</li>`}</ul>
          <form id="rew" class="row"><input name="title" placeholder="ex. Nouvelles baskets, soirée ciné" /><input name="xp" type="number" min="1" placeholder="XP" style="max-width:110px" /><button class="btn">Ajouter</button></form>
        </div>
      </div>
      <div>
        <div class="card"><h3>14 derniers jours</h3>
          <div class="chart">${days.map((d) => `<div title="${d} : ${p.daily[d] || 0} XP"><span style="height:${((p.daily[d] || 0) / maxDay) * 100}%"></span></div>`).join("")}</div></div>
        <div class="card"><h3>Portefeuille par thème</h3>
          ${topics.length ? `<table class="tbl"><tr><th>Thème</th><th>Réussies</th><th>Sans faute</th><th>XP</th></tr>${topics.map(([n, t]) => `<tr><td>${esc(n)}</td><td class="mono">${t.solved}/${t.parts}</td><td class="mono">${Math.round((t.clean / t.parts) * 100)} %</td><td class="mono">${t.xp}</td></tr>`).join("")}</table>` : `<p class="muted small">Résous des exercices pour construire ton portefeuille.</p>`}</div>
        <div class="card"><h3>Carnet d'erreurs</h3>
          ${S.level >= 1 && p.mistakes.length ? `<div class="chips">${Object.entries(mTypes).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="tag">${esc(t)} × ${n}</span>`).join("")}</div>` : ""}
          <ul class="mistakes">${p.mistakes.slice(0, 12).map((m) => `<li><span class="muted small">${new Date(m.day).toLocaleDateString("fr-FR")} · ${esc(m.exercise)} · ${esc(m.type)}</span><div class="small">${md(m.note)}</div></li>`).join("") || `<li class="muted small">Chaque essai raté arrive ici avec ce qui n'allait pas. Relis-le avant un contrôle.</li>`}</ul></div>
      </div>
    </div>`;
  typeset();
  $("#rew").onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); api("/api/rewards", { title: f.get("title"), xp: f.get("xp") }).then(render, fail); };
  app.querySelectorAll("[data-claim]").forEach((b) => (b.onclick = () => api(`/api/rewards/${b.dataset.claim}/claim`, {}).then(() => { toast("Profites-en, tu l'as mérité 🎉", "promo"); render(); }, fail)));
  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => api(`/api/rewards/${b.dataset.del}`, null, "DELETE").then(render, fail)));
}

// ---------- Settings ----------
function viewSettings() {
  const p = S.profile, k = S.keys, mine = getKey();
  const themes = [["default", 0], ["gold", 1], ["emerald", 4], ["crimson", 6]];
  const storage = { redis: ["good", "Upstash Redis — ta progression est sauvegardée."], file: ["good", "Fichiers locaux (dossier data/) — ta progression est sauvegardée."], temp: ["warn", "Temporaire — Vercel efface les données au redémarrage."] }[k.storage];
  app.innerHTML = `
    <h1>Réglages</h1>
    <div class="career">
      <div>
        <div class="card"><h3>Clés</h3>
          <label class="small"><b>Clé API Anthropic</b> <span class="muted">— nécessaire pour lire tes photos, préparer les indices et corriger tes calculs</span></label>
          <div class="row keyrow"><input id="key" type="password" placeholder="${mine ? "•••• enregistrée dans ce navigateur" : "sk-ant-…"}" autocomplete="off" spellcheck="false" />
            <button class="btn" id="saveKey">Enregistrer</button>${mine ? `<button class="ghost danger" id="delKey">Retirer</button>` : ""}</div>
          <p class="small muted">Stockée <b>uniquement dans ce navigateur</b> et envoyée à ton serveur Proof à chaque requête — jamais enregistrée côté serveur. Crée-en une sur <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener"><u>console.anthropic.com</u></a>.</p>
          <ul class="status">
            <li class="${mine ? "good" : "muted"}">${mine ? "✓" : "○"} Clé dans ce navigateur</li>
            <li class="${k.server ? "good" : "muted"}">${k.server ? "✓" : "○"} Clé sur le serveur (<span class="mono">ANTHROPIC_API_KEY</span>)</li>
          </ul>
          <h3 style="margin-top:20px">Sauvegarde de la progression</h3>
          <p class="small ${storage[0]}-text">● ${storage[1]}</p>
          ${k.storage === "temp" ? `<p class="small muted">Pour garder ta progression sur Vercel : dans ton projet Vercel → <b>Storage</b> → <b>Create Database</b> → <b>Upstash for Redis</b> (gratuit) → connecte-la au projet, puis redéploie. Les clés <span class="mono">KV_REST_API_URL</span> et <span class="mono">KV_REST_API_TOKEN</span> sont ajoutées automatiquement et Proof les utilise.</p>` : ""}
        </div>
      </div>
      <div>
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
}

api("/api/state").then(render, fail);
