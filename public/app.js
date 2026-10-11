// Proof — client
let S = null; // server state
const app = document.getElementById("app");
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function api(url, body, method) {
  const res = await fetch(url, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
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
  setTimeout(() => t.classList.add("out"), 3200);
  setTimeout(() => t.remove(), 3700);
}
const fail = (e) => toast(esc(e.message), "bad");

// ---------- Helpers ----------
const lvl = () => S.levels[S.level];
const next = () => S.levels[S.level + 1];
const exDone = (ex) => ex.state.every((s) => s.solved || s.revealed);
const exStarted = (ex) => ex.state.some((s) => s.attempts || s.hintsUsed || s.revealed);
const reviewDue = (ex) => ex.review?.due && !ex.review.mastered && ex.review.due <= S.today;
const allEx = () => S.sheets.flatMap((sh) => sh.exercises.map((ex) => ({ sh, ex })));
const dots = (n) => `<span class="dots">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
function applyTheme() {
  const themes = [[1, "gold"], [4, "emerald"], [6, "crimson"]].filter(([l]) => S.level >= l).map(([, t]) => t);
  const t = S.profile.settings.theme;
  document.documentElement.dataset.accent = t && (t === "default" || themes.includes(t)) ? t : "default";
}

function hud() {
  const p = S.profile, L = lvl(), N = next();
  const pct = N ? ((p.xp - L.xp) / (N.xp - L.xp)) * 100 : 100;
  $("#hud").innerHTML = `
    <div class="streak" title="Daily streak: +5% XP per day, up to +50%">🔥 ${p.streak.count}</div>
    <a href="#/career" class="rank"><span class="rank-name">${L.rank}</span>
      <span class="bar"><span style="width:${pct}%"></span></span>
      <span class="mono xp">${p.xp.toLocaleString()} XP${N ? ` / ${N.xp.toLocaleString()}` : ""}</span></a>`;
  applyTheme();
}

// ---------- Router ----------
function render() {
  if (!S) return;
  hud();
  const [, view, a, b] = location.hash.split("/");
  if (view === "sheet") return viewSheet(a);
  if (view === "ex") return viewEx(a, b);
  if (view === "career") return viewCareer();
  viewDesk();
}
addEventListener("hashchange", () => { scrollTo(0, 0); render(); });

// ---------- Desk ----------
function viewDesk() {
  const due = allEx().filter(({ ex }) => reviewDue(ex));
  const todayXp = S.profile.daily[S.today] || 0;
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Your desk</h1>
        <p class="muted">Photograph an official exercise sheet. Proof transcribes it word for word and turns it into practice that checks your actual work.</p>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="mono">${todayXp}</span><label>XP today</label></div>
        <div class="kpi"><span class="mono">${allEx().filter(({ ex }) => exDone(ex)).length}</span><label>exercises closed</label></div>
        <div class="kpi"><span class="mono">${due.length}</span><label>reviews due</label></div>
      </div>
    </section>
    <label class="drop" id="drop">
      <input type="file" accept="image/*" capture="environment" hidden id="file" />
      <div class="drop-icon">⇪</div>
      <b>Upload a photo of your exercises</b>
      <span class="muted">Drop it here, click to choose, or paste (Ctrl+V)</span>
    </label>
    ${due.length ? `<h2>Due for review <span class="muted small">— exercises you needed help with. Redo them cold to lock them in.</span></h2>
      <div class="grid">${due.map(({ sh, ex }) => exCard(sh, ex)).join("")}</div>` : ""}
    <h2>Sheets</h2>
    <div class="sheets">${S.sheets.map(sheetCard).join("") || `<p class="muted">No sheets yet.</p>`}</div>`;
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
    <div class="muted small">${sh.exercises.length} exercises · ${done} closed · ${new Date(sh.createdAt).toLocaleDateString()}</div>
    <div class="progress"><span style="width:${(done / sh.exercises.length) * 100}%"></span></div></div></a>`;
}

async function upload(f) {
  const drop = $("#drop");
  drop.classList.add("busy");
  drop.innerHTML = `<div class="spinner"></div><b>Reading your sheet…</b><span class="muted">Transcribing every exercise word for word. This takes 20–60 seconds.</span>`;
  try {
    const dataUrl = await shrink(f);
    await api("/api/sheets", { image: dataUrl });
    toast("Sheet transcribed ✓", "good");
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
    img.onerror = () => no(new Error("Could not read that image"));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Sheet ----------
function exCard(sh, ex) {
  const solved = ex.state.filter((s) => s.solved).length;
  const status = reviewDue(ex) ? `<span class="tag warn">Review due</span>` : ex.review?.mastered ? `<span class="tag good">Mastered</span>`
    : exDone(ex) ? `<span class="tag good">Closed</span>` : exStarted(ex) ? `<span class="tag">In progress</span>` : "";
  const xp = ex.state.reduce((a, s) => a + s.xp, 0);
  return `<a class="card ex-card" href="#/ex/${sh.id}/${ex.id}">
    <div class="row"><span class="exnum mono">${esc(ex.number)}</span>${ex.generated ? `<span class="tag">Twin</span>` : ""}${status}</div>
    <b>${esc(ex.title)}</b>
    <div class="muted small">${esc(ex.topic)} · ${ex.parts.length} part${ex.parts.length > 1 ? "s" : ""}</div>
    <div class="row between">${dots(ex.difficulty)}<span class="mono small">${solved}/${ex.parts.length}${xp ? ` · +${xp} XP` : ""}</span></div></a>`;
}

function viewSheet(id) {
  const sh = S.sheets.find((s) => s.id === id);
  if (!sh) return (location.hash = "#/");
  app.innerHTML = `
    <a href="#/" class="back">← Desk</a>
    <div class="row between"><h1>${esc(sh.title)}</h1>${sh.demo ? "" : `<button class="ghost danger" id="del">Delete sheet</button>`}</div>
    <div class="sheet-layout">
      <div class="grid">${sh.exercises.map((ex) => exCard(sh, ex)).join("")}</div>
      ${sh.image ? `<a href="/images/${sh.image}" target="_blank" class="original"><img src="/images/${sh.image}" alt="Original sheet"><span class="muted small">Original photo — click to enlarge</span></a>` : ""}
    </div>`;
  const del = $("#del");
  if (del) del.onclick = async () => { if (confirm("Delete this sheet and its progress?")) { await api(`/api/sheets/${id}`, null, "DELETE").catch(fail); location.hash = "#/"; } };
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
              <div class="muted small">${esc(ex.topic)} · ${dots(ex.difficulty)} ${ex.generated ? `· <span class="tag">AI twin — not official</span>` : `· <span class="tag official">Official</span>`}</div></div></div>
            ${sh.image && ex.bbox && !ex.generated ? `<button class="ghost" id="scanBtn">Show original</button>` : ""}
          </div>
          <div id="scan" class="scan" hidden></div>
          <div class="md">${md(ex.statement)}</div>
          ${ex.figure ? `<div class="figure"><span class="muted small">Figure</span><div class="md">${md(ex.figure)}</div></div>` : ""}
        </div>
        ${ex.exam ? `<div class="exam-bar"><b>Exam mode</b><span class="mono" id="clock">00:00</span><span class="muted small">No hints · ×1.5 XP</span><button class="ghost" id="examOff">Leave exam mode</button></div>` : ""}
        ${ex.parts.map((p, i) => partHtml(ex, p, i)).join("")}
        ${exDone(ex) ? `<div class="card done">
            <b>${ex.state.every((s) => s.solved) ? "Exercise closed." : "Exercise closed with help."}</b>
            <span class="muted">${ex.review?.due ? `It comes back for review on <b>${ex.review.due}</b> — redo it cold then to make it stick.` : ex.review?.mastered ? "Mastered: solved cleanly across spaced reviews." : "Clean work. On to the next."}</span>
            <div class="row">${idx < sibl.length - 1 ? `<a class="btn" href="#/ex/${sid}/${sibl[idx + 1].id}">Next exercise →</a>` : ""}<button class="ghost" id="retry">Retry from scratch</button></div></div>` : ""}
      </article>
      <aside>
        <div class="card side">
          <h3>XP on this exercise</h3>
          <p class="small muted">Base ${10 * ex.difficulty} per part (difficulty × 10).<br>Clean first try ×1.5 · each hint lowers it (×0.75, ×0.5, ×0.25) · solution shown = 0.<br>Streak +${Math.min(S.profile.streak.count, 10) * 5}%${ex.exam ? " · Exam ×1.5" : ""}${ex.generated ? " · Twin ×0.75" : ""}</p>
        </div>
        <div class="card side lens" id="lens">${ex.businessLens ? lensHtml(ex.businessLens) : `<h3>💼 Business lens</h3><p class="muted small">${ex.prepared ? "" : "Preparing…"}</p>`}</div>
        <div class="card side">
          <h3>Train harder</h3>
          ${unlockBtn("exam", ex.exam ? "" : `<button class="ghost wide" id="examOn">⏱ Exam mode</button>`)}
          ${unlockBtn("twin", ex.generated ? "" : `<button class="ghost wide" id="twin">⧉ Twin exercise (new numbers)</button>`)}
        </div>
      </aside>
    </div>`;
  typeset();

  // Wire up parts
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
        busy(e.target, "Checking…");
        try {
          const r = await api(`${base}/check`, { part: i, answer: ans.value, work: work.value });
          celebrate(r.result);
          render();
        } catch (err) { fail(err); render(); }
      };
    }
    $(".hint", el)?.addEventListener("click", () => api(`${base}/hint`, { part: i }).then(render, fail));
    $(".reveal", el)?.addEventListener("click", () => confirm("Show the full solution? This part will give 0 XP and the exercise will come back for review.") && api(`${base}/reveal`, { part: i }).then(render, fail));
  });
  $("#scanBtn")?.addEventListener("click", () => toggleScan(sh, ex));
  $("#retry")?.addEventListener("click", () => api(`${base}/retry`, {}).then(render, fail));
  $("#examOn")?.addEventListener("click", () => api(`${base}/exam`, { on: true }).then(render, fail));
  $("#examOff")?.addEventListener("click", () => api(`${base}/exam`, { on: false }).then(render, fail));
  $("#twin")?.addEventListener("click", async (e) => {
    busy(e.target, "Writing a twin…");
    try { const r = await api(`${base}/twin`, {}); location.hash = `#/ex/${sid}/${r.twinId}`; } catch (err) { fail(err); render(); }
  });
  if (ex.exam) {
    const tick = () => { const s = ((Date.now() - ex.exam.startedAt) / 1000) | 0; const c = $("#clock"); if (c) c.textContent = `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
    tick(); examTimer = setInterval(tick, 1000);
  }

  // Solve + build hints/business lens in the background the first time an exercise is opened.
  if (!ex.prepared) {
    try { await api(`${base}/prepare`, {}); if (location.hash === `#/ex/${sid}/${eid}`) render(); }
    catch (e) { const l = $("#lens"); if (l) l.innerHTML = `<h3>💼 Business lens</h3><p class="small bad-text">${esc(e.message)}</p>`; }
  }
}

function unlockBtn(feature, html) {
  const need = S.unlocks[feature];
  if (S.level >= need) return html;
  return `<div class="locked">🔒 ${feature === "exam" ? "Exam mode" : "Twin exercises"} <span class="muted small">— unlocks at ${S.levels[need].rank}</span></div>`;
}

function lensHtml(l) {
  return `<h3>💼 Business lens</h3><div class="small lens-concept">${md(l.concept)}</div><p class="small">${md(l.scenario)}</p><p class="small takeaway">→ ${md(l.takeaway)}</p>`;
}

function partHtml(ex, p, i) {
  const st = ex.state[i];
  const closed = st.solved || st.revealed;
  const fb = st.feedback && !closed ? `<div class="feedback ${st.feedback.verdict}"><b>${{ correct: "Correct", partial: "Almost", incorrect: "Not yet" }[st.feedback.verdict]}</b> ${md(st.feedback.text)}</div>` : "";
  const hints = p.hints.map((h, k) => `<div class="hint-item"><span class="mono small">Hint ${k + 1}</span><div>${md(h)}</div></div>`).join("");
  return `<section class="card part ${st.solved ? "solved" : st.revealed ? "revealed" : ""}" id="part-${i}">
    <div class="part-head">${p.label ? `<span class="label mono">${esc(p.label)}</span>` : ""}<div class="md">${md(p.prompt)}</div>
      ${st.solved ? `<span class="tag good">+${st.xp} XP</span>` : st.revealed ? `<span class="tag">0 XP</span>` : st.attempts ? `<span class="muted small mono">${st.attempts} attempt${st.attempts > 1 ? "s" : ""}</span>` : ""}</div>
    ${hints ? `<div class="hints">${hints}</div>` : ""}
    ${closed ? `
      <div class="answer-box"><span class="muted small">Answer</span><div class="md">${md(p.answer || "")}</div></div>
      <details ${st.revealed ? "open" : ""}><summary>Full solution</summary><div class="md solution">${md(p.solution || "")}</div>
      ${p.commonMistake ? `<p class="small muted"><b>Common mistake:</b> ${md(p.commonMistake)}</p>` : ""}</details>` : `
      ${fb}
      <div class="sym">${["√", "²", "³", "π", "≤", "≥", "≠", "±", "·", "÷", "∞", "°", "^", "/"].map((s) => `<button data-s="${s}" tabindex="-1">${s}</button>`).join("")}</div>
      <input class="ans" placeholder="Your final answer — e.g. x = 3/2" autocomplete="off" />
      <textarea class="work" rows="3" placeholder="Your working (optional, but this is how you get feedback on WHERE it went wrong)"></textarea>
      <div class="row">
        <button class="btn check">Check answer</button>
        ${ex.exam ? "" : `${st.hintsUsed < 3 ? `<button class="ghost hint">💡 Hint ${st.hintsUsed + 1}/3</button>` : ""}<button class="ghost reveal">Show solution</button>`}
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
  if (r.verdict !== "correct") return toast(r.verdict === "partial" ? "Almost — read the feedback" : "Not yet — read the feedback", "warn");
  toast(`<span class="mono big">+${r.reward.xp} XP</span>${r.reward.clean ? " · clean solve ✦" : ""}`, "good");
  if (r.reward.levelUp) setTimeout(() => toast(`<b>Promoted to ${r.reward.levelUp.rank}</b><br><span class="small">${esc(r.reward.levelUp.unlock)}</span>`, "promo"), 600);
}

function toggleScan(sh, ex) {
  const box = $("#scan");
  box.hidden = !box.hidden;
  $("#scanBtn").textContent = box.hidden ? "Show original" : "Hide original";
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
  const themes = [["default", 0], ["gold", 1], ["emerald", 4], ["crimson", 6]];

  app.innerHTML = `
    <h1>Career</h1>
    <div class="career">
      <div>
        <div class="card"><h3>Ladder</h3>
          <ol class="ladder">${S.levels.map((L, i) => `<li class="${i < S.level ? "past" : i === S.level ? "now" : ""}">
            <span class="mono small">${L.xp.toLocaleString()}</span><b>${L.rank}</b><span class="muted small">${esc(L.unlock)}</span></li>`).join("")}</ol></div>
        <div class="card"><h3>Your own rewards</h3>
          <p class="muted small">Set real-life rewards at XP milestones — the game only works if the prize is something you actually want.</p>
          <ul class="rewards">${p.rewards.map((r) => `<li class="${p.xp >= r.xp ? "ready" : ""}">
            <span class="mono small">${r.xp.toLocaleString()} XP</span><span>${esc(r.title)}</span>
            ${r.claimed ? `<span class="tag good">Claimed ${r.claimed}</span>` : p.xp >= r.xp ? `<button class="btn sm" data-claim="${r.id}">Claim</button>` : `<span class="muted small">${(r.xp - p.xp).toLocaleString()} to go</span>`}
            <button class="x" data-del="${r.id}" title="Remove">×</button></li>`).join("") || `<li class="muted small">No rewards yet.</li>`}</ul>
          <form id="rew" class="row"><input name="title" placeholder="e.g. New sneakers, cinema night" /><input name="xp" type="number" min="1" placeholder="XP" style="max-width:110px" /><button class="btn">Add</button></form>
        </div>
      </div>
      <div>
        <div class="card"><h3>Last 14 days</h3>
          <div class="chart">${days.map((d) => `<div title="${d}: ${p.daily[d] || 0} XP"><span style="height:${((p.daily[d] || 0) / maxDay) * 100}%"></span></div>`).join("")}</div></div>
        <div class="card"><h3>Portfolio by topic</h3>
          ${topics.length ? `<table class="tbl"><tr><th>Topic</th><th>Solved</th><th>Clean</th><th>XP</th></tr>${topics.map(([n, t]) => `<tr><td>${esc(n)}</td><td class="mono">${t.solved}/${t.parts}</td><td class="mono">${Math.round((t.clean / t.parts) * 100)}%</td><td class="mono">${t.xp}</td></tr>`).join("")}</table>` : `<p class="muted small">Solve exercises to build your portfolio.</p>`}</div>
        <div class="card"><h3>Mistake journal</h3>
          ${S.level >= 1 && p.mistakes.length ? `<div class="chips">${Object.entries(mTypes).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="tag">${esc(t)} × ${n}</span>`).join("")}</div>` : ""}
          <ul class="mistakes">${p.mistakes.slice(0, 12).map((m) => `<li><span class="muted small">${m.day} · ${esc(m.exercise)} · ${esc(m.type)}</span><div class="small">${md(m.note)}</div></li>`).join("") || `<li class="muted small">Every wrong attempt lands here with what went wrong. Read it before a test.</li>`}</ul></div>
        <div class="card"><h3>Settings</h3>
          <label class="small muted">Language for hints, feedback & solutions</label>
          <select id="lang">${["English", "Polski", "Français", "auto"].map((l) => `<option ${p.settings.lang === l ? "selected" : ""} value="${l}">${l === "auto" ? "Same as the exercise" : l}</option>`).join("")}</select>
          <label class="small muted">Accent</label>
          <div class="row">${themes.map(([t, need]) => `<button class="swatch ${t}" data-theme="${t}" ${S.level < need ? `disabled title="Unlocks at ${S.levels[need].rank}"` : ""}>${S.level < need ? "🔒" : ""}</button>`).join("")}</div>
        </div>
      </div>
    </div>`;
  typeset();
  $("#rew").onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); api("/api/rewards", { title: f.get("title"), xp: f.get("xp") }).then(render, fail); };
  app.querySelectorAll("[data-claim]").forEach((b) => (b.onclick = () => api(`/api/rewards/${b.dataset.claim}/claim`, {}).then(() => { toast("Enjoy it — you earned it 🎉", "promo"); render(); }, fail)));
  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => api(`/api/rewards/${b.dataset.del}`, null, "DELETE").then(render, fail)));
  app.querySelectorAll("[data-theme]").forEach((b) => (b.onclick = () => api("/api/settings", { theme: b.dataset.theme }).then(render, fail)));
  $("#lang").onchange = (e) => api("/api/settings", { lang: e.target.value }).then(render, fail);
}

api("/api/state").then(render, fail);
