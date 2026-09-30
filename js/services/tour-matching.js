const ALIASES = {
  'nick s.':   'Nicholas (Nick) Steingraeber',
  'myelei c.': 'Myelei Whitaker'
};



export function buildNameIndex(guides) {
  const index = new Map();
  const add = (key, g) => {
    key = String(key || '').trim().toLowerCase();
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    const arr = index.get(key);
    if (!arr.includes(g)) arr.push(g);
  };
  guides.forEach(g => {
    const first = String(g.first || '').trim();
    const paren = /^(.*?)\s*\((.*?)\)\s*$/.exec(first);
    if (paren) { add(paren[1], g); add(paren[2], g); } else { add(first, g); }
    add(first.split(/\s+/)[0], g);
  });
  return index;
}

export function resolveGuide(label, index, byName) {
  const clean = String(label || '').replace(/[*+`\u00b4']+/g, '').trim();
  if (!clean) return null;

  const alias = ALIASES[clean.toLowerCase()];
  if (alias) return byName.get(alias.toLowerCase()) || null;

  const m = /^(.+?)\s+([A-Za-z]+)\.?$/.exec(clean);
  if (!m) return null;
  const first = m[1].trim().toLowerCase();
  const surname = m[2].trim().toLowerCase();
  const surnameFits = g => String(g.last || '').trim().toLowerCase().startsWith(surname);

  const exact = index.get(first);
  if (exact && exact.length) {
    const hits = exact.filter(surnameFits);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;          // genuinely ambiguous
  }

  // The schedule sometimes shortens a first name the roster spells out. Accept
  // that only when the surname agrees and exactly one guide fits.
  const loose = [];
  for (const [key, group] of index) {
    if (!key.startsWith(first)) continue;
    group.forEach(g => { if (surnameFits(g) && !loose.includes(g)) loose.push(g); });
  }
  return loose.length === 1 ? loose[0] : null;
}

