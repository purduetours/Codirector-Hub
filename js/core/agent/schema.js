/* ============================================================ tool arguments
   The model proposes arguments; this decides whether they are acceptable.

   A deliberately small JSON-Schema subset (type, enum, min/max, length,
   pattern, items, required, no unknown keys). It is the same shape the model is
   shown, so the schema Vanessa is given and the schema her arguments are
   checked against are one object, not two that can drift.

   Nothing is "fixed up" silently except trimming strings and turning numeric
   strings into numbers, which models do constantly and which is harmless.
   Anything else wrong is an error the model is told about, in plain words.
============================================================================ */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const realDate = s => { const d = new Date(s + 'T12:00:00Z'); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s; };

function check(v, s, path, errors) {
  const where = path || 'input';
  if (v === undefined || v === null) return undefined;
  switch (s.type) {
    case 'string': {
      if (typeof v !== 'string') { errors.push(`${where} must be text.`); return v; }
      v = v.trim();
      if (s.minLength != null && v.length < s.minLength) errors.push(`${where} is too short.`);
      if (s.maxLength != null && v.length > s.maxLength) errors.push(`${where} is too long (max ${s.maxLength}).`);
      if (s.enum && !s.enum.includes(v)) errors.push(`${where} must be one of: ${s.enum.join(', ')}.`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${where} is not in the expected format.`);
      if (s.format === 'uuid' && !UUID.test(v)) errors.push(`${where} is not a valid id.`);
      if (s.format === 'date' && !(DATE.test(v) && realDate(v))) errors.push(`${where} must be a real date as YYYY-MM-DD.`);
      if (s.format === 'time' && !TIME.test(v)) errors.push(`${where} must be a 24-hour time as HH:MM.`);
      return v;
    }
    case 'integer': case 'number': {
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v);
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${where} must be a number.`); return v; }
      if (s.type === 'integer' && !Number.isInteger(v)) errors.push(`${where} must be a whole number.`);
      if (s.minimum != null && v < s.minimum) errors.push(`${where} must be at least ${s.minimum}.`);
      if (s.maximum != null && v > s.maximum) errors.push(`${where} must be at most ${s.maximum}.`);
      return v;
    }
    case 'boolean': {
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (typeof v !== 'boolean') errors.push(`${where} must be true or false.`);
      return v;
    }
    case 'array': {
      if (!Array.isArray(v)) { errors.push(`${where} must be a list.`); return v; }
      if (s.maxItems != null && v.length > s.maxItems) errors.push(`${where} has too many items (max ${s.maxItems}).`);
      if (s.minItems != null && v.length < s.minItems) errors.push(`${where} needs at least ${s.minItems} item${s.minItems === 1 ? '' : 's'}.`);
      return s.items ? v.map((x, i) => check(x, s.items, `${where}[${i}]`, errors)) : v;
    }
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) { errors.push(`${where} must be an object.`); return v; }
      return checkObject(v, s, path, errors);
    }
    default: return v;
  }
}

function checkObject(obj, s, path, errors) {
  const props = s.properties || {}, out = {};
  for (const k of Object.keys(obj)) {
    if (!(k in props)) { if (s.additionalProperties !== true) errors.push(`${path ? path + '.' : ''}${k} is not something this tool accepts.`); continue; }
    const r = check(obj[k], props[k], (path ? path + '.' : '') + k, errors);
    if (r !== undefined) out[k] = r;
  }
  for (const k of s.required || []) {
    if (out[k] === undefined || out[k] === '') errors.push(`${path ? path + '.' : ''}${k} is required.`);
  }
  return out;
}

/** @returns {{ok:boolean, value?:object, errors:string[]}} */
export function validate(args, schema) {
  const errors = [];
  if (args == null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, errors: ['The tool input must be an object.'] };
  const value = checkObject(args, { ...schema, type: 'object' }, '', errors);
  return errors.length ? { ok: false, errors } : { ok: true, value, errors };
}

/** Stable JSON: sorted keys, so the same parameters always hash the same. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

export async function hashParams(v) {
  const bytes = new TextEncoder().encode(canonical(v));
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
export const isUuid = s => typeof s === 'string' && UUID.test(s);
