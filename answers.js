// Smart answer checking: decides whether a student's answer is mathematically the same as the
// reference, whatever the notation (2,5 = 5/2, "x=2 ou x=3" = "S={3;2}", √2, 30x-1200, LaTeX…).
// Returns "correct" (proven equivalent), "different" (both readable, not equivalent) or "unknown".
import { create, all } from "mathjs";

const math = create(all);
const KNOWN = new Set(["pi", "e", "Infinity", "sqrt", "nthRoot", "log", "log10", "exp", "sin", "cos", "tan", "abs", "i"]);

function latexToPlain(s) {
  let prev;
  do {
    prev = s;
    s = s
      .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))")
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, "nthRoot(($2),($1))")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)")
      .replace(/\\text\s*\{[^{}]*\}|\\mathrm\s*\{[^{}]*\}/g, "")
      .replace(/\^\s*\{([^{}]*)\}/g, "^($1)")
      .replace(/_\s*\{([^{}]*)\}/g, "$1");
  } while (s !== prev);
  return s
    .replace(/\\left|\\right/g, "")
    .replace(/\\(cdot|times)/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pi/g, "pi")
    .replace(/\\infty/g, "Infinity")
    .replace(/\\ln/g, "log")
    .replace(/\\(,|;|!|:| |quad|qquad)/g, " ");
}

// Superscript keys (x², x¹⁰, x⁻¹) → x^(…)
const SUP = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

function clean(s) {
  s = latexToPlain(String(s).replace(/\$/g, ""));
  return s
    .replace(/[×·⋅∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^(${[...m].map((c) => SUP[c]).join("")})`)
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/√\s*([0-9.,]+|[a-z])/gi, "sqrt($1)")
    .replace(/π/g, "pi").replace(/∞/g, "Infinity")
    .replace(/\bln\s*\(/g, "log(")
    .replace(/([a-z])[₁1]\b/gi, "$11").replace(/([a-z])[₂2]\b/gi, "$12")
    .replace(/\s+/g, " ")
    .trim();
}

// Split "S = {2 ; -3}", "x=2 ou x=-3", "2 et 3"… into items. Comma handling is ambiguous in French
// (2,5 is a decimal) so we produce both readings and accept if either matches.
function readings(raw) {
  let s = clean(raw).replace(/^S\s*=\s*/i, "");
  s = s.replace(/^\\?\{(.*)\\?\}$/, "$1").replace(/^\{(.*)\}$/, "$1");
  const sep = /\s*(?:;|\bou\b|\bor\b|\bet\b|\band\b)\s*/i;
  const decimal = s.replace(/(\d),(\d)/g, "$1.$2");
  const out = [decimal.split(new RegExp(`${sep.source}|,\\s+|\\s+,`, "i"))];
  if (decimal !== s) out.push(s.split(new RegExp(`${sep.source}|,`, "i")));
  return out.map((items) => items.map((t) => t.trim()).filter(Boolean));
}

// "x = 3", "P(x) = 30x-1200" → { label, expr }. Percent → two candidate values.
function item(t) {
  let label = null, expr = t;
  const m = /^([a-zA-Z]\w*)(\([a-z]\))?\s*=\s*(.+)$/.exec(t);
  if (m) { label = m[2] ? null : m[1]; expr = m[3]; }
  const exprs = [];
  const pct = /^(.*\d)\s*%$/.exec(expr);
  if (pct) exprs.push(pct[1], `(${pct[1]})/100`);
  else exprs.push(expr);
  // Strip trailing units / words ("40 supports", "12 cm", "25 €") as a fallback reading.
  const unitless = expr.replace(/\s*(€|\$|euros?|[a-zA-Zéèêàùç]{2,}(\^\(?\d\)?)?)(\s+[a-zA-Zéèêàùç]+)*\s*$/u, "");
  if (unitless !== expr && unitless) exprs.push(unitless);
  return { label, exprs: exprs.map(compile).filter(Boolean) };
}

function compile(expr) {
  try {
    const node = math.parse(expr);
    const vars = new Set();
    node.traverse((n, path, parent) => {
      if (n.isSymbolNode && !KNOWN.has(n.name) && !(parent?.isFunctionNode && path === "fn")) vars.add(n.name);
    });
    const code = node.compile();
    return { vars, decimals: (/\.(\d+)/.exec(expr)?.[1].length) || 0, f: (scope) => code.evaluate(scope) };
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === "number" ? v : math.isFraction(v) || math.isBigNumber(v) ? Number(v) : NaN);

function same(a, b) {
  const vars = [...new Set([...a.vars, ...b.vars])];
  if (!vars.length) {
    const x = num(safe(a.f, {})), y = num(safe(b.f, {}));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return x === y && !Number.isNaN(x);
    if (Math.abs(x - y) <= 1e-9 * (1 + Math.abs(y))) return true;
    // Accept a correctly rounded value (to the decimals the rounded side shows, at least 1 decimal).
    const d = Math.max(a.decimals, b.decimals);
    return d >= 1 && Math.abs(x - y) <= 0.5 * 10 ** -d + 1e-12 && Math.abs(x - y) <= 0.02 * Math.abs(y);
  }
  let checked = 0;
  for (let k = 0; k < 12 && checked < 6; k++) {
    const scope = Object.fromEntries(vars.map((v) => [v, Math.random() * 6 - 2.7]));
    const x = num(safe(a.f, scope)), y = num(safe(b.f, scope));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Math.abs(x - y) > 1e-7 * (1 + Math.abs(y))) return false;
    checked++;
  }
  return checked >= 3;
}
function safe(f, scope) { try { return f(scope); } catch { return NaN; } }

const itemsMatch = (s, r) =>
  (!s.label || !r.label || s.label === r.label || r.label.length > 1) && s.exprs.some((a) => r.exprs.some((b) => same(a, b)));

function setsMatch(student, ref) {
  if (student.length !== ref.length) return false;
  const used = new Set();
  return student.every((s) => {
    const j = ref.findIndex((r, k) => !used.has(k) && itemsMatch(s, r));
    if (j < 0) return false;
    used.add(j);
    return true;
  });
}

export function smartCheck(answer, accepted = []) {
  if (!accepted?.length || !String(answer).trim()) return "unknown";
  const ref = accepted.map((a) => item(clean(a).replace(/(\d),(\d)/g, "$1.$2")));
  if (ref.some((r) => !r.exprs.length)) return "unknown";
  const refVars = new Set(ref.flatMap((r) => r.exprs.flatMap((e) => [...e.vars])));
  let readable = false;
  for (const items of readings(answer)) {
    // Ignore readings that invent variables the reference doesn't have ("blabla" is not b·l·a·b·l·a).
    const st = items.map(item).map((s) => ({ ...s, exprs: s.exprs.filter((e) => [...e.vars].every((v) => refVars.has(v))) }));
    if (st.some((s) => !s.exprs.length)) continue;
    readable = true;
    if (setsMatch(st, ref)) return "correct";
  }
  return readable ? "different" : "unknown";
}

// ---------- Sets (ensembles) ----------
// Compares sets written in any usual way: ℝ, R, ℝ∖{3}, ]40;+∞[, [0;2] ∪ [5;+∞[, {1;4}, ∅, ℝ⁺*…
// Each side becomes a sorted, merged list of intervals (points are closed zero-width intervals).
const INF = Infinity;
function setTokens(raw) {
  const s = String(raw).replace(/\$/g, "")
    .replace(/\\setminus|\\backslash/g, "∖")
    .replace(/(R|ℝ|[\]\[}])\s*\\\{/g, "$1∖{") // "R\{3}" typed by hand = R minus {3}
    .replace(/([\]\[}R])\s*[uU]\s*([\[\]{R])/g, "$1∪$2"); // "]a;b[U]c;d[" = union
  return latexToPlain(s)
    .replace(/\\mathbb\s*\{?R\}?|ℝ/g, "R").replace(/\\mathbb\s*\{?N\}?|ℕ/g, "N")
    .replace(/\\mathbb\s*\{?Z\}?|ℤ/g, "Z").replace(/\\mathbb\s*\{?Q\}?|ℚ/g, "Q")
    .replace(/\\varnothing|\\emptyset|∅|\bvide\b/gi, "∅")
    .replace(/\\cup|∪|\s[uU]\s/g, "∪").replace(/\\cap|∩/g, "∩")
    .replace(/\\\{/g, "{").replace(/\\\}/g, "}")
    .replace(/\\setminus|\\backslash|∖|\\/g, "∖")
    .replace(/\\infty|∞|\binf(inity)?\b/gi, "∞")
    .replace(/[−–—]/g, "-")
    .replace(/⁺/g, "+").replace(/⁻/g, "-")
    .replace(/^\s*(S|D|D_f|E|I)\s*=\s*/i, "")
    .replace(/\s+/g, "");
}
function evalNum(t) {
  if (/^\+?∞$/.test(t)) return INF;
  if (t === "-∞") return -INF;
  const c = compile(clean(t));
  if (!c || c.vars.size) return NaN;
  return num(safe(c.f, {}));
}
// "2;5" or "2,5;3" (decimal commas when ; is used) or "1,4" (comma as separator)
function splitList(s) {
  return s.includes(";") ? s.split(";").map((x) => x.replace(/(\d),(\d)/g, "$1.$2")) : s.split(",");
}
// One term → { iv: [[lo, loClosed, hi, hiClosed]], pts: [], minus: [] } or null
function parseTerm(t) {
  if (t === "∅" || t === "{}") return { iv: [], pts: [] };
  let m = /^R(\+|-)?(\*)?(\+|-)?(?:∖\{(.+)\})?$/.exec(t);
  if (m) {
    const sign = m[1] || m[3], star = !!m[2];
    const base = sign === "+" ? [[0, !star, INF, false]] : sign === "-" ? [[-INF, false, 0, !star]] : [[-INF, false, INF, false]];
    let minus = star && !sign ? [0] : [];
    if (m[4]) { const pts = splitList(m[4]).map(evalNum); if (pts.some(Number.isNaN)) return null; minus = minus.concat(pts); }
    return { iv: base, pts: [], minus };
  }
  m = /^([[\]])(.+)([[\]])$/.exec(t);
  if (m) {
    // "]2,5;3]" → ";" separates, commas are decimals; "]2,3]" → the comma separates.
    const inner = m[2], parts = inner.includes(";") ? inner.split(";") : inner.split(",");
    if (parts.length !== 2) return null;
    const [a, b] = parts.map((x) => evalNum(x.replace(/(\d),(\d)/g, "$1.$2")));
    if (Number.isNaN(a) || Number.isNaN(b) || a > b) return null;
    return { iv: [[a, m[1] === "[", b, m[3] === "]"]], pts: [] };
  }
  m = /^\{(.*)\}$/.exec(t);
  if (m) { const pts = splitList(m[1]).map(evalNum); return pts.some(Number.isNaN) ? null : { iv: [], pts }; }
  return null;
}
function parseSet(raw) {
  const s = setTokens(raw);
  if (!s || /[NZQ∩]/.test(s)) return null;
  let iv = [], pts = [], minus = [];
  for (const t of s.split("∪")) {
    const p = parseTerm(t);
    if (!p) return null;
    iv = iv.concat(p.iv); pts = pts.concat(p.pts); minus = minus.concat(p.minus || []);
  }
  for (const x of minus) {
    iv = iv.flatMap(([a, ac, b, bc]) => (x < a || x > b || (x === a && !ac) || (x === b && !bc)) ? [[a, ac, b, bc]]
      : [[a, ac, x, false], [x, false, b, bc]].filter(([l, lc, h, hc]) => l < h || (l === h && lc && hc)));
    pts = pts.filter((p) => Math.abs(p - x) > 1e-12);
  }
  for (const p of pts) iv.push([p, true, p, true]);
  iv.sort((u, v) => u[0] - v[0] || v[1] - u[1]);
  const out = [];
  for (const cur of iv) {
    const last = out[out.length - 1];
    const touches = last && (cur[0] < last[2] || (Math.abs(cur[0] - last[2]) < 1e-12 && (last[3] || cur[1])));
    if (!touches) { out.push([...cur]); continue; }
    if (cur[2] > last[2]) { last[2] = cur[2]; last[3] = cur[3]; }
    else if (cur[2] === last[2]) last[3] = last[3] || cur[3];
  }
  return out;
}
const sameSet = (A, B) => A.length === B.length && A.every((a, i) => {
  const b = B[i], eq = (x, y) => x === y || Math.abs(x - y) <= 1e-9 * (1 + Math.abs(y));
  return eq(a[0], b[0]) && eq(a[2], b[2]) && (a[0] === -INF || a[1] === b[1]) && (a[2] === INF || a[3] === b[3]);
});
// Like smartCheck, for sets: "correct" | "different" | "unknown". ℕ, ℤ, ℚ are compared as written.
export function setCheck(answer, accepted = []) {
  if (!accepted?.length || !String(answer).trim()) return "unknown";
  const st = setTokens(answer);
  if (accepted.some((a) => setTokens(a) === st)) return "correct";
  const A = parseSet(answer);
  if (!A) return "unknown";
  let readable = false;
  for (const a of accepted) {
    const B = parseSet(a);
    if (!B) continue;
    readable = true;
    if (sameSet(A, B)) return "correct";
  }
  return readable ? "different" : "unknown";
}
