// Automatismes — Première. Original random-question generators covering the official "automatismes" skills
// (calcul, proportions, évolutions, fonctions, géométrie, statistiques, probabilités).
// Each generator returns { q, choices[4], answer, explain[], svg? }. Distractors come from typical mistakes.

// ---------- helpers ----------
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[ri(0, a.length - 1)];
const nz = (a, b) => { let x; do x = ri(a, b); while (x === 0); return x; };
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const round = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// French number in LaTeX: 1{,}75 · 12\,000
function dec(x, d = 4) {
  x = round(x, d);
  const neg = x < 0, [int, frac] = Math.abs(x).toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").split(".");
  const grouped = int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, "\\,") : int;
  return (neg ? "-" : "") + grouped + (frac ? "{,}" + frac : "");
}
// Simplified fraction in LaTeX
function fr(p, q) {
  if (q < 0) { p = -p; q = -q; }
  const g = gcd(p, q) || 1; p /= g; q /= g;
  if (q === 1) return dec(p);
  return (p < 0 ? "-" : "") + `\\dfrac{${Math.abs(p)}}{${q}}`;
}
const pct = (x) => `${dec(x, 2)}\\,\\%`;
const sgn = (c, first = false) => (c < 0 ? "-" : first ? "" : "+");
// a·x² + b·x + c  (any zero term skipped)
function poly(coefs, v = "x") {
  const deg = coefs.length - 1;
  const parts = [];
  coefs.forEach((c, i) => {
    if (!c) return;
    const p = deg - i, a = Math.abs(c);
    const coef = p && a === 1 ? "" : dec(a);
    const pow = p === 0 ? "" : p === 1 ? v : `${v}^{${p}}`;
    parts.push(`${sgn(c, !parts.length)}${parts.length ? " " : ""}${coef}${pow}`);
  });
  return parts.join(" ").replace(/^\+ ?/, "") || "0";
}
const lin = (a, b, v = "x") => poly([a, b], v);
const m = (s) => `$${s}$`;

// Build a question from numeric values: dedupes by value, keeps 3 distractors.
function numQ(q, correct, wrongs, fmt, explain, extra = {}) {
  const seen = new Set([round(correct)]);
  const ws = [];
  for (const w of wrongs) {
    if (!Number.isFinite(w) || seen.has(round(w))) continue;
    seen.add(round(w)); ws.push(w);
    if (ws.length === 3) break;
  }
  if (ws.length < 3) return null;
  return textQ(q, m(fmt(correct)), ws.map((w) => m(fmt(w))), explain, extra);
}
function textQ(q, correct, wrongs, explain, extra = {}) {
  const uniq = [...new Set(wrongs.filter((w) => w !== correct))].slice(0, 3);
  if (uniq.length < 3) return null;
  const choices = shuffle([correct, ...uniq]);
  return { q, choices, answer: choices.indexOf(correct), explain, ...extra };
}

// ---------- tiny SVG plots ----------
function plot({ lines = [], points = [], range = 5 }) {
  const S = 300, u = S / (2 * range), X = (x) => S / 2 + x * u, Y = (y) => S / 2 - y * u;
  let g = "";
  for (let k = -range; k <= range; k++) {
    g += `<line class="g-grid" x1="${X(k)}" y1="0" x2="${X(k)}" y2="${S}"/><line class="g-grid" x1="0" y1="${Y(k)}" x2="${S}" y2="${Y(k)}"/>`;
    if (k && k % 1 === 0) g += `<text class="g-tick" x="${X(k)}" y="${Y(0) + 13}" text-anchor="middle">${k}</text><text class="g-tick" x="${X(0) - 6}" y="${Y(k) + 4}" text-anchor="end">${k}</text>`;
  }
  g += `<line class="g-axis" x1="0" y1="${Y(0)}" x2="${S}" y2="${Y(0)}"/><line class="g-axis" x1="${X(0)}" y1="0" x2="${X(0)}" y2="${S}"/>`;
  g += `<text class="g-tick" x="${X(0) - 6}" y="${Y(0) + 13}" text-anchor="end">0</text>`;
  for (const pts of lines) g += `<polyline class="g-curve" points="${pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}"/>`;
  for (const [x, y, label] of points) g += `<circle class="g-dot" cx="${X(x)}" cy="${Y(y)}" r="4.5"/>${label ? `<text class="g-label" x="${X(x) + 8}" y="${Y(y) - 8}">${label}</text>` : ""}`;
  return `<svg class="plot" viewBox="-4 -4 ${S + 8} ${S + 8}" role="img">${g}</svg>`;
}
function bars(labels, values, yLabel) {
  const W = 340, H = 220, max = Math.max(...values), top = Math.ceil(max / 5) * 5, bw = (W - 50) / labels.length;
  let g = "";
  for (let v = 0; v <= top; v += top / 5) {
    const y = H - 30 - ((H - 50) * v) / top;
    g += `<line class="g-grid" x1="40" y1="${y}" x2="${W}" y2="${y}"/><text class="g-tick" x="34" y="${y + 4}" text-anchor="end">${v}</text>`;
  }
  labels.forEach((l, i) => {
    const h = ((H - 50) * values[i]) / top, x = 48 + i * bw;
    g += `<rect class="g-bar" x="${x}" y="${H - 30 - h}" width="${bw - 16}" height="${h}" rx="5"/><text class="g-tick" x="${x + (bw - 16) / 2}" y="${H - 12}" text-anchor="middle">${l}</text>`;
  });
  g += `<line class="g-axis" x1="40" y1="${H - 30}" x2="${W}" y2="${H - 30}"/><text class="g-tick" x="4" y="12">${yLabel}</text>`;
  return `<svg class="plot bars" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

// ---------- themes & skills ----------
export const THEMES = [
  { id: "C", name: "Calcul numérique et algébrique", icon: "🧮", color: "blue" },
  { id: "R", name: "Proportions et pourcentages", icon: "🥧", color: "orange" },
  { id: "E", name: "Évolutions et variations", icon: "📈", color: "green" },
  { id: "F", name: "Fonctions et représentations", icon: "〽️", color: "purple" },
  { id: "G", name: "Géométrie et grandeurs", icon: "📐", color: "teal" },
  { id: "S", name: "Statistiques", icon: "📊", color: "pink" },
  { id: "P", name: "Probabilités", icon: "🎲", color: "yellow" },
];

const SK = [];
const skill = (theme, id, title, gen) => SK.push({ theme, id, title, gen });

// ===== C — Calcul =====
skill("C", "c-plusgrand", "Trouver le plus grand nombre", () => {
  const q1 = pick([3, 6, 7, 9, 11]), p1 = ri(1, q1 * 2 - 1), q2 = pick([4, 8, 12, 15]), p2 = ri(1, q2 * 2 - 1);
  const v = [p1 / q1, p2 / q2, round(p1 / q1 + pick([-1, 1]) * ri(1, 6) / 100, 2), round(p2 / q2 + pick([-1, 1]) * ri(1, 6) / 100, 2)];
  if (new Set(v.map((x) => round(x, 4))).size < 4 || v.some((x) => x <= 0)) return null;
  const shown = [fr(p1, q1), fr(p2, q2), dec(v[2]), dec(v[3])];
  const best = v.indexOf(Math.max(...v));
  return textQ("Quel est le plus grand de ces nombres ?", m(shown[best]), shown.filter((_, i) => i !== best).map(m), [
    "Le plus simple → on met tout en écriture décimale, comme des prix.",
    `$${fr(p1, q1)} \\approx ${dec(p1 / q1, 3)}$ et $${fr(p2, q2)} \\approx ${dec(p2 / q2, 3)}$`,
    `On compare → le plus grand est $${shown[best]}$.`,
  ]);
});
skill("C", "c-fractions", "Additionner des fractions", () => {
  const b = ri(2, 9), d = ri(2, 9), a = nz(1, 9), c = nz(1, 9);
  if (b === d) return null;
  const ok = (a * d + c * b) / (b * d);
  return numQ(`$${fr(a, b)} + ${fr(c, d)} = \\;?$`, ok, [(a + c) / (b + d), (a + c) / (b * d), (a * c) / (b * d), (a * d + c * b) / (b + d)], (x) => fracOf(x, b * d), [
    "On ne peut additionner que des parts de même taille → même dénominateur.",
    `$${fr(a, b)} = \\dfrac{${a * d}}{${b * d}}$ et $${fr(c, d)} = \\dfrac{${c * b}}{${b * d}}$`,
    `→ $\\dfrac{${a * d} + ${c * b}}{${b * d}} = ${fracOf(ok, b * d)}$ (on simplifie si on peut).`,
  ]);
});
function fracOf(x, den) { for (const q of [den, ...Array.from({ length: 400 }, (_, i) => i + 1)]) { const p = x * q; if (Math.abs(p - Math.round(p)) < 1e-9) return fr(Math.round(p), q); } return dec(x, 3); }
skill("C", "c-puiss10", "Calculer avec des puissances de 10", () => {
  const a = nz(-5, 8), b = nz(-5, 8), c = nz(-4, 6), ok = a + b - c;
  const ws = [a + b + c, a * b - c, a - b - c, -ok, a * b / c].filter(Number.isInteger);
  return numQ(`$\\dfrac{10^{${a}} \\times 10^{${b}}}{10^{${c}}} = \\;?$`, ok, ws, (n) => `10^{${n}}`, [
    "Multiplier → on ADDITIONNE les exposants. Diviser → on les SOUSTRAIT.",
    `$${a} + (${b}) - (${c}) = ${ok}$`,
    `→ $10^{${ok}}$`,
  ]);
});
skill("C", "c-puisspuiss", "Puissance de puissance et produit", () => {
  const mm = ri(2, 5), n = ri(2, 4), p = ri(1, 6), ok = mm * n + p;
  return numQ(`Pour $x \\neq 0$ : $(x^{${mm}})^{${n}} \\times x^{${p}} = \\;?$`, ok, [mm + n + p, mm * n * p, (mm + n) * p, mm * (n + p)], (k) => `x^{${k}}`, [
    `$(x^{${mm}})^{${n}}$ → c'est $x^{${mm}}$ répété ${n} fois → exposants multipliés : $x^{${mm * n}}$.`,
    `Puis $x^{${mm * n}} \\times x^{${p}}$ → on additionne : $${mm * n} + ${p} = ${ok}$.`,
  ]);
});
skill("C", "c-scientifique", "Passer de l'écriture scientifique à l'écriture décimale", () => {
  const a = ri(101, 999) / 100, n = nz(-4, 5), ok = a * 10 ** n;
  return numQ(`$${dec(a)} \\times 10^{${n}} = \\;?$`, ok, [a * 10 ** (n + 1), a * 10 ** (n - 1), a * 10 ** -n], (x) => dec(x, 8), [
    `$10^{${n}}$ → la virgule se déplace de ${Math.abs(n)} rang${Math.abs(n) > 1 ? "s" : ""} vers la ${n > 0 ? "droite (le nombre grossit)" : "gauche (le nombre rapetisse)"}.`,
    `→ $${dec(ok, 8)}$`,
  ]);
});
skill("C", "c-heures", "Transformer des minutes en heures décimales", () => {
  const h = ri(0, 3), mn = pick([6, 12, 15, 18, 24, 30, 36, 42, 45, 48, 54]), ok = h + mn / 60;
  return numQ(`$${h}$ h $${mn}$ min, c'est combien d'heures ?`, ok, [h + mn / 100, h + mn / 60 + 0.1, (h * 60 + mn) / 100, h + 60 / mn / 10], (x) => `${dec(x, 2)}\\text{ h}`, [
    "Piège classique : 1 h = 60 min, pas 100 !",
    `$${mn}$ min $= \\dfrac{${mn}}{60}$ h $= ${dec(mn / 60, 2)}$ h`,
    `→ $${h} + ${dec(mn / 60, 2)} = ${dec(ok, 2)}$ h`,
  ]);
});
skill("C", "c-vitesse", "Calculer une vitesse", () => {
  const t = pick([10, 12, 15, 20, 30, 40, 45]), v = ri(4, 20) * 6, d = (v * t) / 60;
  if (!Number.isInteger(d * 10)) return null;
  return numQ(`Un scooter parcourt $${dec(d)}$ km en $${t}$ minutes. Sa vitesse moyenne est :`, v, [d / t, (d * t) / 60, v / 2, d * 2], (x) => `${dec(x, 2)}\\text{ km/h}`, [
    `Vitesse = distance ÷ temps, avec le temps en heures → $${t}$ min $= \\dfrac{${t}}{60}$ h.`,
    `$${dec(d)} \\div \\dfrac{${t}}{60} = ${dec(d)} \\times \\dfrac{60}{${t}} = ${v}$`,
    `→ $${v}$ km/h`,
  ]);
});
skill("C", "c-dev-carre", "Développer avec une identité remarquable", () => {
  const a = ri(1, 5), b = nz(-9, 9);
  const ok = poly([a * a, 2 * a * b, b * b]);
  return textQ(`Développer $(${lin(a, b)})^2$`, m(ok), [poly([a * a, 0, b * b]), poly([a * a, a * b, b * b]), poly([a * a, -2 * a * b, b * b]), poly([a, 2 * a * b, b * b])].map(m), [
    "$(A + B)^2 = A^2 + 2AB + B^2$ → n'oublie jamais le double produit $2AB$ !",
    `$A = ${poly([a, 0])}$, $B = ${b}$ → $A^2 = ${poly([a * a, 0, 0])}$, $2AB = ${poly([2 * a * b, 0])}$, $B^2 = ${b * b}$`,
    `→ $${ok}$`,
  ]);
});
skill("C", "c-fact-diff", "Factoriser une différence de deux carrés", () => {
  const k = ri(1, 5), n = ri(1, 9), kx = poly([k, 0]);
  const ok = `(${lin(k, -n)})(${lin(k, n)})`;
  return textQ(`Factoriser $${poly([k * k, 0, -n * n])}$`, m(ok), [`(${lin(k, -n)})^2`, `(${lin(k, n)})^2`, `(${lin(k * k, -n)})(${lin(k * k, n)})`, `(${lin(k, -n * n)})(${lin(k, n * n)})`].map(m), [
    "$A^2 - B^2 = (A - B)(A + B)$ → repère les deux carrés.",
    `$${poly([k * k, 0, 0])} = (${kx})^2$ et $${n * n} = ${n}^2$`,
    `→ $${ok}$`,
  ]);
});
skill("C", "c-double-dist", "Développer avec la double distributivité", () => {
  const a = nz(-9, 9), b = nz(-9, 9);
  const ok = poly([1, a + b, a * b]);
  return textQ(`Développer $(${lin(1, a)})(${lin(1, b)})$`, m(ok), [poly([1, 0, a * b]), poly([1, a + b, a + b]), poly([1, a * b, a * b]), poly([1, a - b, a * b])].map(m), [
    "Chaque terme de la 1ʳᵉ parenthèse multiplie chaque terme de la 2ᵉ → 4 produits.",
    `$x \\times x = x^2$, $x \\times (${b}) + (${a}) \\times x = ${poly([a + b, 0])}$, $(${a}) \\times (${b}) = ${a * b}$`,
    `→ $${ok}$`,
  ]);
});
skill("C", "c-equation", "Résoudre une équation ax + b = c", () => {
  const a = nz(-9, 9), s = ri(-9, 9), b = nz(-12, 12), c = a * s + b;
  if (a === 1) return null;
  return numQ(`Résoudre $${lin(a, b)} = ${c}$`, s, [(c + b) / a, (c - b) * a, (b - c) / a, a / (c - b)], (x) => `x = ${fracOf(x, Math.abs(a))}`, [
    `On isole $x$ → on enlève d'abord le ${b > 0 ? `+${b}` : b} des deux côtés : $${poly([a, 0])} = ${c} ${b > 0 ? "-" : "+"} ${Math.abs(b)} = ${c - b}$`,
    `Puis on divise par $${a}$ → $x = \\dfrac{${c - b}}{${a}} = ${dec(s)}$`,
  ]);
});
skill("C", "c-x2", "Résoudre une équation x² = a", () => {
  const kind = pick(["carre", "carre", "racine", "negatif"]);
  const n = ri(2, 12), k = kind === "carre" ? n * n : kind === "racine" ? pick([2, 3, 5, 6, 7, 10, 11, 13]) : -ri(1, 30);
  const r = kind === "carre" ? `${n}` : `\\sqrt{${Math.abs(k)}}`;
  const all = [`S = \\{-${r}\\,;\\,${r}\\}`, `S = \\{${r}\\}`, `S = \\varnothing`, `S = \\{-${fr(Math.abs(k), 2)}\\,;\\,${fr(Math.abs(k), 2)}\\}`];
  const ok = k < 0 ? all[2] : all[0];
  return textQ(`Résoudre $x^2 = ${k}$`, m(ok), all.filter((a) => a !== ok).map(m), k < 0
    ? ["Un carré n'est jamais négatif → $x^2$ ne peut pas valoir un nombre négatif.", "→ aucune solution : $S = \\varnothing$"]
    : ["Deux nombres ont le même carré : un positif et son opposé → $3^2 = 9$ et $(-3)^2 = 9$ !", `→ $x = ${r}$ ou $x = -${r}$`]);
});
skill("C", "c-inequation", "Résoudre une inéquation ax + b > 0", () => {
  const a = nz(-6, 6), b = nz(-12, 12), s = fr(-b, a), ms = fr(b, a);
  if (-b / a === 0) return null;
  const ok = a > 0 ? `]${s}\\,;+\\infty[` : `]-\\infty\\,;${s}[`;
  return textQ(`Les solutions de $${lin(a, b)} > 0$ sont :`, m(ok), [`]${s}\\,;+\\infty[`, `]-\\infty\\,;${s}[`, `]${ms}\\,;+\\infty[`, `]-\\infty\\,;${ms}[`].map(m), [
    `$${poly([a, 0])} > ${-b}$ → on divise par $${a}$.`,
    a < 0 ? `⚠️ $${a}$ est négatif → on RETOURNE le sens de l'inégalité : $x < ${s}$` : `$${a}$ est positif → le sens ne change pas : $x > ${s}$`,
    `→ $${ok}$`,
  ]);
});
skill("C", "c-isoler", "Exprimer une variable en fonction des autres", () => {
  const F = pick([
    { f: "P = U \\times I", ask: "I", ok: "I = \\dfrac{P}{U}", w: ["I = P \\times U", "I = \\dfrac{U}{P}", "I = P - U"], e: ["$P = U \\times I$ → $I$ est multiplié par $U$.", "Pour l'isoler on fait l'inverse → on divise par $U$ : $I = \\dfrac{P}{U}$"] },
    { f: "v = \\dfrac{d}{t}", ask: "t", ok: "t = \\dfrac{d}{v}", w: ["t = v \\times d", "t = \\dfrac{v}{d}", "t = d - v"], e: ["On multiplie les deux côtés par $t$ → $v \\times t = d$", "Puis on divise par $v$ → $t = \\dfrac{d}{v}$"] },
    { f: "y = 3x - 5", ask: "x", ok: "x = \\dfrac{y + 5}{3}", w: ["x = \\dfrac{y - 5}{3}", "x = \\dfrac{y}{3} - 5", "x = 3y + 5"], e: ["On défait dans l'ordre inverse → d'abord on ajoute 5 : $y + 5 = 3x$", "Puis on divise par 3 → $x = \\dfrac{y + 5}{3}$"] },
    { f: "A = \\pi r^2", ask: "r", ok: "r = \\sqrt{\\dfrac{A}{\\pi}}", w: ["r = \\dfrac{A}{2\\pi}", "r = \\dfrac{\\sqrt{A}}{2\\pi}", "r = \\sqrt{A \\pi}"], e: ["$r^2 = \\dfrac{A}{\\pi}$ → on divise par $\\pi$.", "Puis on prend la racine (un rayon est positif) → $r = \\sqrt{\\dfrac{A}{\\pi}}$"] },
    { f: "E = \\dfrac{1}{2} m v^2", ask: "m", ok: "m = \\dfrac{2E}{v^2}", w: ["m = \\dfrac{E}{2v^2}", "m = 2E v^2", "m = \\dfrac{2v^2}{E}"], e: ["On multiplie par 2 → $2E = m v^2$", "Puis on divise par $v^2$ → $m = \\dfrac{2E}{v^2}$"] },
    { f: "C = 2\\pi R", ask: "R", ok: "R = \\dfrac{C}{2\\pi}", w: ["R = 2\\pi C", "R = \\dfrac{2\\pi}{C}", "R = C - 2\\pi"], e: ["$R$ est multiplié par $2\\pi$.", "→ on divise par $2\\pi$ : $R = \\dfrac{C}{2\\pi}$"] },
  ]);
  return textQ(`On a $${F.f}$ (toutes les grandeurs sont non nulles). Alors :`, m(F.ok), F.w.map(m), F.e);
});
skill("C", "c-produit-nul", "Résoudre une équation produit nul", () => {
  const a = nz(-9, 9), b = nz(-9, 9);
  const S = (x, y) => `S = \\{${Math.min(x, y)}\\,;\\,${Math.max(x, y)}\\}`;
  return textQ(`Résoudre $(${lin(1, -a)})(${lin(1, b)}) = 0$`, m(S(a, -b)), [S(-a, b), S(a, b), S(-a, -b)].map(m), [
    "Un produit vaut 0 → l'un des facteurs vaut 0 (comme 0 × n'importe quoi = 0).",
    `$${lin(1, -a)} = 0$ → $x = ${a}$ ; $${lin(1, b)} = 0$ → $x = ${-b}$`,
  ]);
});
skill("C", "c-ordre", "Déterminer un ordre de grandeur", () => {
  const A = pick([2, 3, 4, 5, 6, 8]), B = pick([0.2, 0.5, 20, 50, 0.3, 30]);
  const a = round(A * (1 + pick([-1, 1]) * ri(1, 4) / 100), 2), b = round(B * (1 + pick([-1, 1]) * ri(1, 4) / 100), 3), ok = A * B;
  return numQ(`Un ordre de grandeur de $${dec(a)} \\times ${dec(b, 3)}$ est :`, ok, [ok * 10, ok / 10, ok * 100, A + B], (x) => dec(x), [
    `On arrondit chaque nombre à une valeur simple → $${dec(a)} \\approx ${A}$ et $${dec(b, 3)} \\approx ${dec(B)}$`,
    `→ $${A} \\times ${dec(B)} = ${dec(ok)}$`,
  ]);
});
skill("C", "c-conversion", "Convertir des unités d'aire et de volume", () => {
  const c = pick([
    { from: "m^2", to: "cm^2", k: 1e4, e: "1 m = 100 cm → 1 m² = 100 × 100 = 10 000 cm²" },
    { from: "cm^2", to: "m^2", k: 1e-4, e: "1 cm² = 0,0001 m² (on divise par 100 × 100)" },
    { from: "m^3", to: "L", k: 1e3, e: "1 m³ = 1 000 dm³ et 1 dm³ = 1 L → 1 m³ = 1 000 L" },
    { from: "cm^3", to: "L", k: 1e-3, e: "1 L = 1 dm³ = 1 000 cm³ → on divise par 1 000" },
    { from: "km^2", to: "m^2", k: 1e6, e: "1 km = 1 000 m → 1 km² = 1 000 × 1 000 = 1 000 000 m²" },
  ]);
  const v = pick([2.5, 3.2, 0.7, 4, 12, 0.35, 1.8]), ok = v * c.k;
  const U = (u) => { const [base, p] = u.split("^"); return `\\text{ ${base}}${p ? `^${p}` : ""}`; };
  return numQ(`$${dec(v)}${U(c.from)} = \\;?${U(c.to)}$`, ok, [v * c.k / 100, v * c.k * 10, v * c.k / 10, v / c.k], (x) => dec(x, 8), [
    c.e,
    `→ $${dec(v)} \\times ${dec(c.k, 8)} = ${dec(ok, 8)}$`,
  ]);
});

// ===== R — Proportions =====
skill("R", "r-pct-de", "Calculer un pourcentage d'une quantité", () => {
  const t = pick([5, 10, 15, 20, 25, 30, 40, 60, 75]), N = ri(2, 24) * 20, ok = (t * N) / 100;
  return numQ(`$${t}\\,\\%$ de $${N}$ €, c'est :`, ok, [N - ok, (t * N) / 10, N / t, t + N / 100], (x) => `${dec(x)}\\text{ €}`, [
    `$${t}\\,\\%$ → c'est $\\dfrac{${t}}{100}$, donc on multiplie par $${dec(t / 100)}$.`,
    `→ $${N} \\times ${dec(t / 100)} = ${dec(ok)}$ €`,
  ]);
});
skill("R", "r-proportion", "Écrire une proportion en pourcentage", () => {
  const n = pick([20, 25, 40, 50, 80, 200]), k = ri(1, n - 1), ok = (100 * k) / n;
  if (!Number.isInteger(ok * 2)) return null;
  return numQ(`Dans un club de $${n}$ membres, $${k}$ font du foot. Quelle proportion cela représente ?`, ok, [k, 100 - ok, n / k, ok / 10], pct, [
    `Proportion = partie ÷ total → $\\dfrac{${k}}{${n}} = ${dec(k / n)}$`,
    `En pourcentage → × 100 : $${dec(ok)}\\,\\%$`,
  ]);
});
skill("R", "r-tout", "Retrouver le total connaissant une partie", () => {
  const p = pick([10, 20, 25, 40, 50, 75]), tot = ri(2, 20) * 20, k = (p * tot) / 100;
  if (!Number.isInteger(k)) return null;
  return numQ(`$${p}\\,\\%$ des élèves d'un lycée, soit $${k}$ élèves, sont internes. Combien y a-t-il d'élèves ?`, tot, [(k * p) / 100, k + p, k * p, k * (100 - p) / 100], (x) => dec(x), [
    `$${p}\\,\\%$ du total → $${k}$ élèves. Donc $1\\,\\%$ → $${k} \\div ${p} = ${dec(k / p)}$.`,
    `$100\\,\\%$ → $${dec(k / p)} \\times 100 = ${tot}$ élèves`,
  ]);
});
skill("R", "r-pct-de-pct", "Calculer un pourcentage de pourcentage", () => {
  const a = pick([10, 20, 25, 40, 50, 60, 80]), b = pick([10, 20, 30, 40, 50, 70]), ok = (a * b) / 100;
  return numQ(`$${a}\\,\\%$ des élèves sont en Première, et parmi eux $${b}\\,\\%$ font l'option maths expertes. Quelle part de TOUS les élèves cela représente ?`, ok, [a + b, (a + b) / 2, a * b, Math.abs(a - b)], pct, [
    `« ${b} % de ${a} % » → on multiplie les proportions.`,
    `$${dec(a / 100)} \\times ${dec(b / 100)} = ${dec(ok / 100)}$ → $${dec(ok)}\\,\\%$`,
  ]);
});
skill("R", "r-proportionnalite", "Calculer un prix par proportionnalité", () => {
  const x = ri(2, 6), unit = pick([1.5, 2, 2.5, 3, 4, 1.2]), y = x * unit, z = ri(7, 15), ok = z * unit;
  return numQ(`$${x}$ cahiers coûtent $${dec(y)}$ €. Combien coûtent $${z}$ cahiers ?`, ok, [y + (z - x), (y * x) / z, y * z, ok + unit], (v) => `${dec(v, 2)}\\text{ €}`, [
    `D'abord le prix d'UN cahier → $${dec(y)} \\div ${x} = ${dec(unit)}$ €`,
    `Puis pour $${z}$ → $${z} \\times ${dec(unit)} = ${dec(ok)}$ €`,
  ]);
});

// ===== E — Évolutions =====
skill("E", "e-cm", "Passer du taux d'évolution au coefficient multiplicateur", () => {
  const t = pick([-60, -45, -30, -25, -12, -8, -3, 2, 5, 7, 15, 30, 60, 120]), ok = 1 + t / 100;
  return numQ(`Une ${t > 0 ? "hausse" : "baisse"} de $${Math.abs(t)}\\,\\%$ correspond au coefficient multiplicateur :`, ok, [t / 100, 1 - t / 100, 1 + t / 10, Math.abs(t) / 100], (x) => dec(x), [
    "Coefficient = $1 +$ taux (le taux en décimal, négatif si c'est une baisse).",
    `→ $1 ${t > 0 ? "+" : "-"} ${dec(Math.abs(t) / 100)} = ${dec(ok)}$`,
    t > 0 ? "Logique : ça augmente → coefficient plus grand que 1." : "Logique : ça baisse → coefficient entre 0 et 1.",
  ]);
});
skill("E", "e-taux", "Passer du coefficient multiplicateur au taux", () => {
  const ok = pick([-55, -36, -20, -15, -4, 3, 8, 18, 40, 75, 150]), cm = 1 + ok / 100;
  return numQ(`Multiplier par $${dec(cm)}$ revient à :`, ok, [-ok, cm * 100, (cm - 1) * 10, 100 - cm * 100], (x) => (x >= 0 ? `\\text{augmenter de } ${dec(x, 2)}\\,\\%` : `\\text{baisser de } ${dec(-x, 2)}\\,\\%`), [
    `Taux = coefficient $- 1$ → $${dec(cm)} - 1 = ${dec(cm - 1)}$`,
    `→ ${ok >= 0 ? "+" : ""}$${dec(ok)}\\,\\%$ : ${ok >= 0 ? "une hausse" : "une baisse"}`,
  ]);
});
skill("E", "e-prix", "Calculer un prix après une évolution", () => {
  const P = ri(4, 30) * 10, t = pick([-40, -30, -25, -20, -15, -10, 5, 10, 20, 25, 50]), ok = P * (1 + t / 100);
  return numQ(`Un sweat à $${P}$ € subit une ${t > 0 ? "hausse" : "remise"} de $${Math.abs(t)}\\,\\%$. Nouveau prix :`, ok, [P + t, (P * Math.abs(t)) / 100, P * (1 - t / 100), P - t], (x) => `${dec(x, 2)}\\text{ €}`, [
    `${t > 0 ? "Hausse" : "Remise"} de $${Math.abs(t)}\\,\\%$ → coefficient $${dec(1 + t / 100)}$`,
    `→ $${P} \\times ${dec(1 + t / 100)} = ${dec(ok)}$ €`,
  ]);
});
skill("E", "e-taux-entre", "Calculer un taux d'évolution entre deux valeurs", () => {
  const V0 = pick([40, 50, 80, 120, 200, 250, 400]), t = pick([-50, -40, -25, -20, -10, 10, 15, 20, 25, 50, 75]), V1 = (V0 * (100 + t)) / 100;
  return numQ(`Un abonnement passe de $${V0}$ € à $${dec(V1)}$ €. Le taux d'évolution est :`, t, [((V1 - V0) / V1) * 100, V1 - V0, -t, (V1 / V0) * 100], (x) => `${x > 0 ? "+" : ""}${dec(x, 2)}\\,\\%`, [
    "Taux = (arrivée − départ) ÷ départ → toujours diviser par la valeur de DÉPART.",
    `$\\dfrac{${dec(V1)} - ${V0}}{${V0}} = ${dec(t / 100)}$ → $${t > 0 ? "+" : ""}${t}\\,\\%$`,
  ]);
});
skill("E", "e-successives", "Déterminer une évolution globale", () => {
  const t1 = pick([-20, -10, 10, 20, 30, 50]), t2 = pick([-50, -20, -10, 10, 20, 25]), ok = ((1 + t1 / 100) * (1 + t2 / 100) - 1) * 100;
  return numQ(`Un prix ${t1 > 0 ? "augmente" : "baisse"} de $${Math.abs(t1)}\\,\\%$ puis ${t2 > 0 ? "augmente" : "baisse"} de $${Math.abs(t2)}\\,\\%$. Évolution globale :`, ok, [t1 + t2, (t1 + t2) / 2, (t1 * t2) / 100, t1 - t2], (x) => `${x > 0 ? "+" : ""}${dec(x, 2)}\\,\\%`, [
    "⚠️ Les pourcentages ne s'additionnent pas → on MULTIPLIE les coefficients.",
    `$${dec(1 + t1 / 100)} \\times ${dec(1 + t2 / 100)} = ${dec(1 + ok / 100)}$`,
    `→ coefficient $${dec(1 + ok / 100)}$ → $${ok > 0 ? "+" : ""}${dec(ok)}\\,\\%$`,
  ]);
});
skill("E", "e-reciproque", "Calculer un taux réciproque", () => {
  const [t, ok] = pick([[25, -20], [100, -50], [-20, 25], [-50, 100], [60, -37.5], [-25, 100 / 3], [50, -100 / 3], [-75, 300]]);
  return numQ(`Après une ${t > 0 ? "hausse" : "baisse"} de $${Math.abs(t)}\\,\\%$, quelle évolution permet de revenir à la valeur de départ ?`, ok, [-t, -t / 2, t, ok - 10], (x) => `${x > 0 ? "+" : ""}${dec(x, 2)}\\,\\%`, [
    `Coefficient aller $${dec(1 + t / 100)}$ → pour revenir, on divise : coefficient retour $\\dfrac{1}{${dec(1 + t / 100)}} \\approx ${dec(1 / (1 + t / 100), 4)}$`,
    `→ ${ok > 0 ? "+" : ""}$${dec(ok, 2)}\\,\\%$ (et non $${-t > 0 ? "+" : ""}${-t}\\,\\%$ !)`,
  ]);
});

// ===== F — Fonctions =====
skill("F", "f-image-affine", "Calculer une image par une fonction affine", () => {
  const a = nz(-7, 7), b = nz(-9, 9), k = nz(-6, 6), ok = a * k + b;
  return numQ(`$f(x) = ${lin(a, b)}$. Que vaut $f(${k})$ ?`, ok, [a * k - b, -(a * k) + b, a + b * k, a * (k + b)], (x) => dec(x), [
    `On remplace $x$ par $${k}$ (avec des parenthèses !) → $f(${k}) = ${a} \\times (${k}) ${b > 0 ? "+" : "-"} ${Math.abs(b)}$`,
    `→ $${a * k} ${b > 0 ? "+" : "-"} ${Math.abs(b)} = ${ok}$`,
  ]);
});
skill("F", "f-image-carre", "Calculer une image avec le second degré", () => {
  const a = nz(-3, 3), b = ri(-5, 5), c = ri(-6, 6), k = nz(-4, -1), ok = a * k * k + b * k + c;
  return numQ(`$f(x) = ${poly([a, b, c])}$. Que vaut $f(${k})$ ?`, ok, [-a * k * k + b * k + c, a * k * 2 + b * k + c, a * k * k - b * k + c, ok + 2 * a], (x) => dec(x), [
    `⚠️ $(${k})^2 = ${k * k}$ (un carré est positif) → on calcule le carré AVANT de multiplier par $${a}$.`,
    `$${a} \\times ${k * k} ${b ? `+ (${b}) \\times (${k})` : ""} ${c ? `${c > 0 ? "+" : "-"} ${Math.abs(c)}` : ""} = ${ok}$`,
  ]);
});
skill("F", "f-antecedent", "Déterminer un antécédent par une fonction affine", () => {
  const a = nz(-6, 6), s = ri(-8, 8), b = nz(-9, 9), y = a * s + b;
  if (a === 1) return null;
  return numQ(`$f(x) = ${lin(a, b)}$. Quel est l'antécédent de $${y}$ ?`, s, [a * y + b, (y + b) / a, (b - y) / a, y], (x) => fracOf(x, Math.abs(a)), [
    `Antécédent → on cherche $x$ tel que $f(x) = ${y}$ : $${lin(a, b)} = ${y}$`,
    `$${poly([a, 0])} = ${y - b}$ → $x = \\dfrac{${y - b}}{${a}} = ${s}$`,
  ]);
});
skill("F", "f-coef", "Calculer un coefficient directeur", () => {
  const x1 = ri(-5, 3), x2 = x1 + ri(1, 5), y1 = ri(-6, 6), y2 = ri(-6, 6), ok = (y2 - y1) / (x2 - x1);
  return numQ(`La droite passe par $A(${x1}\\,;${y1})$ et $B(${x2}\\,;${y2})$. Son coefficient directeur est :`, ok, [(x2 - x1) / (y2 - y1), -ok, (y2 + y1) / (x2 + x1), (y2 - y1) * (x2 - x1)], (x) => fracOf(x, x2 - x1), [
    "Coefficient directeur = « de combien on monte » ÷ « de combien on avance » → $\\dfrac{y_B - y_A}{x_B - x_A}$",
    `$\\dfrac{${y2} - (${y1})}{${x2} - (${x1})} = \\dfrac{${y2 - y1}}{${x2 - x1}} = ${fracOf(ok, x2 - x1)}$`,
  ]);
});
skill("F", "f-droite-graphe", "Lire l'équation réduite d'une droite", () => {
  const a = pick([-3, -2, -1, 1, 2, 3, 0.5, -0.5]), b = ri(-3, 3);
  const eq = (u, v) => `y = ${lin(u, v)}`;
  const ok = eq(a, b);
  return textQ("Quelle est l'équation de la droite tracée ?", m(ok), [eq(b || 1, a), eq(-a, b), eq(a, -b), eq(a, b + 1)].map(m), [
    `L'ordonnée à l'origine → là où la droite coupe l'axe vertical : $${b}$.`,
    `La pente → quand on avance de 1 vers la droite, on ${a > 0 ? "monte" : "descend"} de $${dec(Math.abs(a))}$ → coefficient $${dec(a)}$.`,
    `→ $${ok}$`,
  ], { svg: plot({ lines: [[[-5, a * -5 + b], [5, a * 5 + b]]], points: [[0, b]] }) });
});
skill("F", "f-image-graphe", "Lire une image graphiquement", () => {
  const xs = [-4, -2, 0, 2, 4], ys = xs.map(() => ri(-4, 4));
  const i = ri(0, 4), k = xs[i], ok = ys[i];
  const other = ys.findIndex((y, j) => j !== i && y !== ok);
  if (other < 0) return null;
  return numQ(`Voici la courbe de $f$. Que vaut $f(${k})$ ?`, ok, [k, -ok, ys[other], ok + 1], (x) => dec(x), [
    `$f(${k})$ → on part de $${k}$ sur l'axe HORIZONTAL, on monte/descend jusqu'à la courbe…`,
    `…puis on lit la hauteur sur l'axe vertical → $${ok}$`,
  ], { svg: plot({ lines: [xs.map((x, j) => [x, ys[j]])], points: [[k, ok]] }) });
});
skill("F", "f-reconnaitre", "Reconnaître une fonction affine", () => {
  const aff = pick(["5 - 2x", "\\dfrac{x + 1}{3}", "-x", "3x + \\sqrt{2}", "\\dfrac{2}{5}x - 1"]);
  const non = shuffle(["x^2 + 1", "\\dfrac{2}{x} + 1", "3\\sqrt{x}", "x(x + 1)", "x^3 - x", "\\dfrac{1}{x + 1}"]).slice(0, 3);
  return textQ("Laquelle de ces fonctions est affine ?", m(`f(x) = ${aff}`), non.map((n) => m(`f(x) = ${n}`)), [
    "Affine → elle s'écrit $ax + b$ : le $x$ apparaît seul, à la puissance 1, jamais au dénominateur ni sous une racine.",
    `$${aff}$ → c'est bien de la forme $ax + b$ ✔`,
  ]);
});
skill("F", "f-sommet", "Lire le sommet d'une parabole (forme canonique)", () => {
  const a = nz(-3, 3), al = nz(-5, 5), be = ri(-6, 6);
  const P = (x, y) => `(${x}\\,;${y})`;
  return textQ(`$f(x) = ${a === 1 ? "" : a === -1 ? "-" : a}(x ${al > 0 ? "-" : "+"} ${Math.abs(al)})^2 ${be >= 0 ? "+" : "-"} ${Math.abs(be)}$. Le sommet de la parabole est :`, m(P(al, be)), [P(-al, be), P(be, al), P(al, -be)].map(m), [
    "Forme canonique $a(x - \\alpha)^2 + \\beta$ → sommet $(\\alpha\\,;\\beta)$.",
    `⚠️ Le signe dans la parenthèse est inversé : $(x ${al > 0 ? "-" : "+"} ${Math.abs(al)})$ → $\\alpha = ${al}$`,
    `→ sommet $${P(al, be)}$`,
  ]);
});

// ===== G — Géométrie =====
skill("G", "g-disque", "Aire d'un disque et périmètre d'un cercle", () => {
  const r = ri(2, 9), useD = Math.random() < 0.5, area = Math.random() < 0.5;
  const give = useD ? `de diamètre $${2 * r}$ cm` : `de rayon $${r}$ cm`;
  const pi = (k) => `${k}\\pi`;
  if (area) return textQ(`L'aire d'un disque ${give} est :`, m(pi(r * r) + "\\text{ cm}^2"), [pi(2 * r), pi(4 * r * r), pi(r)].map((x) => m(x + "\\text{ cm}^2")), [
    `Aire = $\\pi \\times r^2$${useD ? ` → attention, le rayon c'est la moitié du diamètre : $r = ${r}$` : ""}`,
    `→ $\\pi \\times ${r}^2 = ${r * r}\\pi$ cm²`,
  ]);
  return textQ(`Le périmètre d'un cercle ${give} est :`, m(pi(2 * r) + "\\text{ cm}"), [pi(r * r), pi(r), pi(4 * r)].map((x) => m(x + "\\text{ cm}")), [
    `Périmètre = $2 \\times \\pi \\times r$ (ou $\\pi \\times$ diamètre)`,
    `→ $2 \\times \\pi \\times ${r} = ${2 * r}\\pi$ cm`,
  ]);
});
skill("G", "g-cylindre", "Calculer le volume d'un cylindre", () => {
  const r = ri(2, 6), h = ri(3, 12), pi = (k) => m(`${k}\\pi\\text{ cm}^3`);
  return textQ(`Le volume d'un cylindre de rayon $${r}$ cm et de hauteur $${h}$ cm est :`, pi(r * r * h), [pi(2 * r * h), pi(r * h), pi(4 * r * r * h)], [
    "Volume = aire de la base × hauteur → comme une pile de disques.",
    `Base : $\\pi \\times ${r}^2 = ${r * r}\\pi$ → × $${h}$ → $${r * r * h}\\pi$ cm³`,
  ]);
});
skill("G", "g-pythagore", "Calculer une longueur avec Pythagore", () => {
  const [a0, b0, c0] = pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10]]), k = pick([1, 1, 2, 3]);
  const a = a0 * k, b = b0 * k, c = c0 * k;
  return numQ(`Triangle $ABC$ rectangle en $A$ avec $AB = ${a}$ et $AC = ${b}$. Combien mesure $BC$ ?`, c, [a + b, a * a + b * b, Math.sqrt(a + b), b - a], (x) => (Number.isInteger(x) ? `${x}` : `\\sqrt{${a + b}}`), [
    "$BC$ est l'hypoténuse (en face de l'angle droit) → $BC^2 = AB^2 + AC^2$",
    `$BC^2 = ${a * a} + ${b * b} = ${c * c}$ → $BC = \\sqrt{${c * c}} = ${c}$`,
  ]);
});
skill("G", "g-trigo", "Utiliser cosinus, sinus et tangente", () => {
  const [adj, opp, hyp] = pick([[4, 3, 5], [3, 4, 5], [12, 5, 13], [5, 12, 13], [15, 8, 17], [8, 15, 17]]);
  const f = pick(["cos", "sin", "tan"]);
  const val = { cos: [adj, hyp], sin: [opp, hyp], tan: [opp, adj] }[f];
  const all = [[adj, hyp], [opp, hyp], [opp, adj], [hyp, adj]];
  return textQ(`Triangle $ABC$ rectangle en $B$ : $AB = ${adj}$, $BC = ${opp}$, $AC = ${hyp}$. Que vaut $\\${f}(\\widehat{BAC})$ ?`, m(fr(...val)),
    all.filter(([p, q]) => p !== val[0] || q !== val[1]).map(([p, q]) => m(fr(p, q))), [
      "Depuis l'angle $A$ : adjacent → $AB$, opposé → $BC$, hypoténuse → $AC$.",
      "Moyen mnémo → SOH CAH TOA : Sin = Opp/Hyp, Cos = Adj/Hyp, Tan = Opp/Adj.",
      `→ $\\${f}(\\widehat{BAC}) = ${fr(...val)}$`,
    ]);
});
skill("G", "g-thales", "Calculer une longueur avec Thalès", () => {
  const AB = pick([6, 8, 9, 10, 12, 15]), r = pick([1 / 3, 1 / 2, 2 / 3, 3 / 4]), AM = AB * r, BC = pick([6, 8, 9, 12, 16]), ok = BC * r;
  if (!Number.isInteger(AM * 2) || !Number.isInteger(ok * 2)) return null;
  return numQ(`$(MN) \\parallel (BC)$, $M \\in [AB]$, $N \\in [AC]$. $AM = ${dec(AM)}$, $AB = ${AB}$, $BC = ${BC}$. Combien mesure $MN$ ?`, ok, [(BC * AB) / AM, BC - (AB - AM), AM, (BC * AM) / (AB + AM)], (x) => dec(x, 2), [
    `Le petit triangle $AMN$ est une réduction de $ABC$ → coefficient $\\dfrac{AM}{AB} = \\dfrac{${dec(AM)}}{${AB}} = ${fracOf(r, 12)}$`,
    `→ $MN = ${BC} \\times ${fracOf(r, 12)} = ${dec(ok)}$`,
  ]);
});
skill("G", "g-boule", "Calculer le volume d'une boule", () => {
  const r = pick([3, 6, 9]), ok = (4 * r ** 3) / 3;
  return textQ(`Le volume d'une boule de rayon $${r}$ cm est :`, m(`${ok}\\pi\\text{ cm}^3`), [4 * r * r, r ** 3, (4 * r * r) / 3].map((k) => m(`${dec(k)}\\pi\\text{ cm}^3`)), [
    "Volume d'une boule = $\\dfrac{4}{3} \\pi r^3$",
    `→ $\\dfrac{4}{3} \\times \\pi \\times ${r ** 3} = ${ok}\\pi$ cm³`,
  ]);
});

// ===== S — Statistiques =====
skill("S", "s-moyenne", "Calculer une moyenne", () => {
  const n = ri(4, 6), vals = Array.from({ length: n }, () => ri(6, 18)), tot = vals.reduce((a, b) => a + b, 0);
  const fix = (n - (tot % n)) % n; vals[n - 1] += fix;
  const sum = tot + fix, ok = sum / n, s = [...vals].sort((a, b) => a - b), med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return numQ(`Notes : $${vals.join(" \\,;\\, ")}$. La moyenne est :`, ok, [med, (s[0] + s[n - 1]) / 2, sum / (n - 1), ok + 1], (x) => dec(x, 2), [
    "Moyenne → on additionne tout puis on partage équitablement.",
    `Somme : $${sum}$ → $${sum} \\div ${n} = ${dec(ok)}$`,
  ]);
});
skill("S", "s-mediane", "Déterminer une médiane", () => {
  const n = pick([7, 8, 9]), vals = Array.from({ length: n }, () => ri(1, 20)), s = [...vals].sort((a, b) => a - b);
  const ok = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, mean = vals.reduce((a, b) => a + b, 0) / n;
  return numQ(`Série : $${vals.join(" \\,;\\, ")}$. La médiane est :`, ok, [vals[Math.floor(n / 2)], round(mean, 1), s[Math.floor(n / 2) + 1], (s[0] + s[n - 1]) / 2], (x) => dec(x, 2), [
    "⚠️ D'abord on RANGE les valeurs dans l'ordre croissant :",
    `$${s.join(" \\,;\\, ")}$`,
    n % 2 ? `${n} valeurs → celle du milieu est la ${(n + 1) / 2}ᵉ → $${ok}$` : `${n} valeurs → milieu entre la ${n / 2}ᵉ et la ${n / 2 + 1}ᵉ → $\\dfrac{${s[n / 2 - 1]} + ${s[n / 2]}}{2} = ${dec(ok)}$`,
  ]);
});
skill("S", "s-manquante", "Retrouver une valeur manquante avec la moyenne", () => {
  const a = ri(6, 18), b = ri(6, 18), c = ri(6, 18), x = ri(5, 20), mean = (a + b + c + x) / 4;
  if (!Number.isInteger(mean)) return null;
  return numQ(`Léa a eu $${a}$, $${b}$ et $${c}$. Quelle note lui faut-il au 4ᵉ contrôle pour avoir $${mean}$ de moyenne ?`, x, [mean, 3 * mean - (a + b + c), x + 2, 4 * mean - (a + b)], (v) => dec(v), [
    `Moyenne $${mean}$ sur 4 notes → total nécessaire $= 4 \\times ${mean} = ${4 * mean}$`,
    `Elle a déjà $${a} + ${b} + ${c} = ${a + b + c}$ → il manque $${4 * mean} - ${a + b + c} = ${x}$`,
  ]);
});
skill("S", "s-barres", "Exploiter un diagramme en barres", () => {
  const labels = ["0", "1", "2", "3", "4"], v = labels.map(() => ri(1, 12)), tot = v.reduce((a, b) => a + b, 0);
  const k = ri(0, 4);
  if (Math.random() < 0.5) return numQ("On a demandé aux élèves combien ils ont de frères et sœurs. Combien d'élèves ont été interrogés ?", tot, [labels.length, Math.max(...v), tot - v[k], v.reduce((a, b, i) => a + b * i, 0)], (x) => dec(x), [
    "Chaque barre = un nombre d'élèves → l'effectif total, c'est la somme de toutes les hauteurs.",
    `$${v.join(" + ")} = ${tot}$`,
  ], { svg: bars(labels, v, "élèves") });
  const j = ri(1, 3), atLeast = v.slice(j).reduce((a, b) => a + b, 0);
  return numQ(`Combien d'élèves ont au moins $${j}$ frère${j > 1 ? "s" : ""} ou sœur${j > 1 ? "s" : ""} ?`, atLeast, [v[j], tot - atLeast, tot, atLeast - v[j]], (x) => dec(x), [
    `« Au moins ${j} » → ${j} OU PLUS → on additionne les barres de ${j} à 4.`,
    `→ $${v.slice(j).join(" + ")} = ${atLeast}$`,
  ], { svg: bars(labels, v, "élèves") });
});

// ===== P — Probabilités =====
skill("P", "p-contraire", "Calculer la probabilité de l'événement contraire", () => {
  const p = ri(5, 95) / 100, ok = 1 - p;
  return numQ(`$P(A) = ${dec(p)}$. Que vaut $P(\\overline{A})$ ?`, ok, [p, 1 + p, round(1 - p + 0.1, 2), p / 2], (x) => dec(x), [
    "$\\overline{A}$ = « A ne se produit pas » → à eux deux, ils couvrent 100 % des cas.",
    `$P(\\overline{A}) = 1 - ${dec(p)} = ${dec(ok)}$`,
  ]);
});
skill("P", "p-valide", "Reconnaître un nombre pouvant être une probabilité", () => {
  const ok = pick(["\\dfrac{7}{9}", "0{,}98", "\\dfrac{3}{8}", "0{,}001", "1"]);
  const bad = shuffle(["1{,}2", "-0{,}3", "\\dfrac{13}{12}", "150\\,\\%", "\\dfrac{9}{7}", "-\\dfrac{1}{4}"]).slice(0, 3);
  return textQ("Lequel de ces nombres peut être une probabilité ?", m(ok), bad.map(m), [
    "Une probabilité est toujours entre 0 (impossible) et 1 (certain).",
    `→ seul $${ok}$ est dans $[0\\,;1]$`,
  ]);
});
skill("P", "p-des", "Probabilité d'une somme avec deux dés", () => {
  const s = ri(2, 12), ways = 6 - Math.abs(7 - s), ok = ways / 36;
  return numQ(`On lance deux dés équilibrés. Probabilité que la somme fasse $${s}$ ?`, ok, [1 / 11, ways / 12, 1 / 6, (ways + 1) / 36], (x) => fracOf(x, 36), [
    "Il y a $6 \\times 6 = 36$ résultats équiprobables (dé 1, dé 2) → les sommes ne sont PAS toutes aussi probables.",
    `Somme ${s} → ${ways} façon${ways > 1 ? "s" : ""} : ${Array.from({ length: 6 }, (_, i) => i + 1).filter((a) => s - a >= 1 && s - a <= 6).map((a) => `(${a};${s - a})`).join(" ")}`,
    `→ $\\dfrac{${ways}}{36} = ${fracOf(ok, 36)}$`,
  ]);
});
skill("P", "p-urne", "Calculer une probabilité dans une situation d'équiprobabilité", () => {
  const r = ri(2, 9), b = ri(2, 9), g = ri(1, 6), n = r + b + g;
  return numQ(`Une urne contient $${r}$ boules rouges, $${b}$ bleues et $${g}$ vertes. On en tire une au hasard. $P(\\text{rouge}) = \\;?$`, r / n, [r / (b + g), 1 / 3, r / (n - 1), (r + 1) / n], (x) => fracOf(x, n), [
    "Proba = cas favorables ÷ cas possibles.",
    `$${r}$ rouges sur $${r} + ${b} + ${g} = ${n}$ boules → $${fracOf(r / n, n)}$`,
  ]);
});
skill("P", "p-tableau", "Calculer une probabilité dans un tableau", () => {
  const a = ri(5, 20), b = ri(5, 20), c = ri(5, 20), d = ri(5, 20), T = a + b + c + d, cond = Math.random() < 0.5;
  const table = `\n\n| | Externe | Demi-pensionnaire | Total |\n|---|---|---|---|\n| Fille | ${a} | ${b} | ${a + b} |\n| Garçon | ${c} | ${d} | ${c + d} |\n| Total | ${a + c} | ${b + d} | ${T} |\n\n`;
  if (cond) return numQ(`On choisit au hasard une **fille**. Probabilité qu'elle soit demi-pensionnaire ?${table}`, b / (a + b), [b / T, b / (b + d), (a + b) / T, a / (a + b)], (x) => fracOf(x, a + b), [
    "« Une fille » → on ne regarde QUE la ligne des filles : c'est notre nouveau total.",
    `$${b}$ demi-pensionnaires sur $${a + b}$ filles → $${fracOf(b / (a + b), a + b)}$`,
  ]);
  return numQ(`On choisit un élève au hasard. Probabilité que ce soit une fille demi-pensionnaire ?${table}`, b / T, [b / (a + b), b / (b + d), (a + b) / T, (b + d) / T], (x) => fracOf(x, T), [
    "« Fille ET demi-pensionnaire » → la case au croisement, sur le total de TOUS les élèves.",
    `$\\dfrac{${b}}{${T}}$${gcd(b, T) > 1 ? ` $= ${fracOf(b / T, T)}$` : ""}`,
  ]);
});
skill("P", "p-arbre", "Utiliser un arbre (probabilités totales)", () => {
  const a = pick([0.2, 0.3, 0.4, 0.6, 0.7]), b = pick([0.1, 0.2, 0.5, 0.8, 0.9]), c = pick([0.3, 0.4, 0.6, 0.25]), ok = a * b + (1 - a) * c;
  return numQ(`$P(A) = ${dec(a)}$, $P_A(B) = ${dec(b)}$ et $P_{\\overline{A}}(B) = ${dec(c)}$. Que vaut $P(B)$ ?`, ok, [a * b, b + c, a * b + c, (b + c) / 2], (x) => dec(x, 4), [
    "B peut arriver par deux chemins de l'arbre → par A, ou par « pas A ». On additionne les deux chemins.",
    `Chemin A→B : $${dec(a)} \\times ${dec(b)} = ${dec(a * b)}$ ; chemin $\\overline{A}$→B : $${dec(1 - a)} \\times ${dec(c)} = ${dec((1 - a) * c)}$`,
    `→ $P(B) = ${dec(ok)}$`,
  ], { svg: tree(a, b, c) });
});
function tree(a, b, c) {
  const t = (x, y, s) => `<text class="g-label" x="${x}" y="${y}">${s}</text>`;
  const l = (x1, y1, x2, y2) => `<line class="g-curve thin" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const f = (x) => String(round(x, 2)).replace(".", ",");
  return `<svg class="plot tree" viewBox="0 0 320 200" role="img">
    ${l(10, 100, 110, 50)}${l(10, 100, 110, 150)}${l(130, 50, 230, 20)}${l(130, 50, 230, 80)}${l(130, 150, 230, 120)}${l(130, 150, 230, 180)}
    ${t(115, 55, "A")}${t(115, 155, "Ā")}${t(238, 24, "B")}${t(238, 84, "B̄")}${t(238, 124, "B")}${t(238, 184, "B̄")}
    ${t(40, 66, f(a))}${t(40, 146, f(1 - a))}${t(165, 28, f(b))}${t(165, 80, f(1 - b))}${t(165, 128, f(c))}${t(165, 180, f(1 - c))}</svg>`;
}

export const SKILLS = SK;
export const skillById = Object.fromEntries(SK.map((s) => [s.id, s]));

// One question for a skill; retries until a generator produces 4 valid, distinct choices.
export function makeQuestion(skillId) {
  const s = skillById[skillId];
  for (let i = 0; i < 40; i++) {
    const q = s.gen();
    if (q && q.choices.length === 4 && new Set(q.choices).size === 4) return { ...q, skill: s.id, theme: s.theme, title: s.title };
  }
  throw new Error(`Impossible de générer ${skillId}`);
}

// Pick the next skill: weaker skills (by success rate) come up more often.
export function nextSkill(themeId, stats = {}) {
  const pool = SK.filter((s) => !themeId || s.theme === themeId);
  const w = pool.map((s) => { const st = stats[s.id]; return st?.n ? 1.6 - st.ok / st.n : 1.6; });
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i].id;
  return pool[pool.length - 1].id;
}
