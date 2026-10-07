// A small static check for a project with no build step: every JavaScript file parses,
// every relative import resolves, every named import exists in the module it comes
// from, and a few safety rules hold (no secrets in the app, no eval in Vanessa).
//   node tests/tools/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name === 'node_modules' || f.name.startsWith('.')) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(m?js)$/.test(f.name)) files.push(p); } })(root);

const problems = [];
// Vanessa has no paid dependency: no hosted-AI hosts, SDKs, or API keys anywhere in app code.
const PAID_AI = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis|api\.cohere|api\.mistral|api\.groq|openrouter\.ai|x-api-key|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|@anthropic-ai|from ['"]openai['"]|sk-ant-|sk-proj-/i;
const exportsOf = new Map();
const src = new Map(files.map(f => [f, fs.readFileSync(f, 'utf8')]));

function exportsFor(f) {
  if (exportsOf.has(f)) return exportsOf.get(f);
  const s = src.get(f) || '', set = new Set(); let star = [];
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) set.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (n) set.add(n); }
  for (const m of s.matchAll(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm)) star.push(m[1]);
  if (/^export\s+default\b/m.test(s)) set.add('default');
  exportsOf.set(f, set);
  for (const rel of star) { const t = resolve(f, rel); if (t) exportsFor(t).forEach(x => set.add(x)); }
  return set;
}
const resolve = (from, rel) => { if (!rel.startsWith('.')) return null; const p = path.resolve(path.dirname(from), rel); return [p, p + '.js', path.join(p, 'index.js')].find(x => fs.existsSync(x) && fs.statSync(x).isFile()) || null; };

let parsed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); parsed++; } catch (e) { problems.push(`syntax: ${path.relative(root, f)}\n${String(e.stderr).split('\n').slice(0, 4).join('\n')}`); continue; }
  const s = src.get(f);
  for (const m of s.matchAll(/^import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:\*\s+as\s+[\w$]+\s*)?from\s+['"]([^'"]+)['"]/gm)) {
    const target = resolve(f, m[3]);
    if (m[3].startsWith('.') && !target) { problems.push(`import: ${path.relative(root, f)} imports missing file ${m[3]}`); continue; }
    if (!target) continue;
    const ex = exportsFor(target);
    if (m[1] && !ex.has('default')) problems.push(`import: ${path.relative(root, f)} imports a default from ${m[3]}, which has none`);
    for (const part of (m[2] || '').split(',')) { const n = part.trim().split(/\s+as\s+/)[0].trim(); if (n && !ex.has(n)) problems.push(`import: ${path.relative(root, f)} imports { ${n} } but ${path.relative(root, target)} does not export it`); }
  }
}

const app = files.filter(f => !f.includes(`${path.sep}tests${path.sep}`));
for (const f of app) {
  const s = src.get(f), rel = path.relative(root, f);
  if (/sk-ant-|service_role\s*[:=]\s*['"]ey|SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]/.test(s)) problems.push(`secret: ${rel} looks like it contains a secret`);
  if (rel.startsWith('js/core/agent') && /\beval\s*\(|new\s+Function\s*\(/.test(s)) problems.push(`safety: ${rel} uses eval/new Function`);
  if (PAID_AI.test(s)) problems.push(`cost: ${rel} references a paid AI service, key or SDK. Vanessa must run with no paid dependency`);
  if (rel.startsWith('js/') && /\.(rpc)\(\s*['"](?:exec|execute|run)_sql|query\(\s*[`'"]\s*(?:insert|update|delete|drop)\b/i.test(s)) problems.push(`safety: ${rel} looks like raw SQL execution`);
}
for (const f of ['config.js', 'package.json']) if (PAID_AI.test(fs.readFileSync(path.join(root, f), 'utf8'))) problems.push(`cost: ${f} mentions a paid AI service or key`);
if (fs.existsSync(path.join(root, 'supabase/functions/vanessa'))) problems.push('cost: supabase/functions/vanessa should not exist: Vanessa needs no hosted function or model key');
for (const f of fs.readdirSync(path.join(root, 'supabase')).filter(x => /\.sql$/.test(x))) if (PAID_AI.test(fs.readFileSync(path.join(root, 'supabase', f), 'utf8'))) problems.push(`cost: supabase/${f} mentions a paid AI service or key`);

console.log(`${files.length} files, ${parsed} parse, ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
problems.forEach(p => console.log(' - ' + p));
process.exit(problems.length ? 1 : 0);
