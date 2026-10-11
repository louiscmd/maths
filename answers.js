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

function clean(s) {
  s = latexToPlain(String(s).replace(/\$/g, ""));
  return s
    .replace(/[×·⋅∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2").replace(/³/g, "^3")
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
  const unitless = expr.replace(/\s*(€|\$|euros?|[a-zA-Zéèêàùç]{2,}\^?\d?)(\s+[a-zA-Zéèêàùç]+)*\s*$/u, "");
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
