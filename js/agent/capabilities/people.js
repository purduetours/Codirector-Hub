/* People: finding Tour Guides, one person's profile, majors, and (with confirmation) adding,
   archiving and editing them. Names resolve through the canonical Tour Guide list. */
import { Num, num, count, names, firstName, possessive, join, are, has, cap, or } from '../engine/respond.js';
import { person, plainSlot, chips, hasTag, hasToken } from './util.js';

const titleCase = s => s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

function facet(q) {
  const f = q.filters;
  if (f.major) return { filter: 'major', major: f.major, label: `${f.major} majors` };
  if (hasTag(q, 'LEADERSHIP')) return { filter: 'leadership', label: 'leadership' };
  if (hasTag(q, 'NOMAJOR')) return { filter: 'no_major', label: 'active guides with no major listed' };
  if (hasTag(q, 'NOTONSCHEDULE')) return { filter: 'not_on_schedule', label: 'active guides with no upcoming tour' };
  if (hasTag(q, 'NEWGUIDE')) return { filter: 'new_this_semester', label: 'new this semester' };
  if (hasToken(q, 'inactive', 'archived')) return { filter: 'inactive', label: 'inactive guides' };
  return { filter: 'all_active', label: 'active Tour Guides' };
}

const personAsk = 'Whose profile?';

export default {
  id: 'people', label: 'People',
  intents: {
    'people.search': {
      permission: 'people.read', mode: 'read', people: 'none', params: ['major', 'limit'],
      async run(q, t) { const fc = facet(q); const r = await t.must('list_people', { filter: fc.filter, ...(fc.major ? { major: fc.major } : {}), limit: q.filters.limit || 12 }); return { d: r.data, fc, howmany: hasTag(q, 'HOWMANY') }; },
      respond({ d, fc, howmany }) {
        const list = (d.people || []).map(p => p.name);
        if (!d.count) return { text: `I don’t see any ${fc.label}.`, cards: 'drop' };
        if (howmany) return { text: `There ${d.count === 1 ? 'is' : 'are'} ${d.count} ${fc.label}${fc.filter === 'all_active' ? '' : ''}.`, cards: 'drop' };
        const few = d.count <= 6;
        return { text: few ? `${Num(d.count)} ${fc.label}: ${names(list, 6)}.` : `${Num(d.count)} ${fc.label}, including ${names(list, 3)}.`, cards: few ? 'drop' : undefined, suggest: chips() };
      }
    },

    'people.profile': {
      permission: 'self.read', mode: 'read', people: 'required', params: [],
      async run(q, t) { const p = person(q); const r = await t.must('get_person_profile', { person: p.id }); return { d: r.data, p }; },
      respond({ d, p }, q, t) {
        const first = firstName(d.name);
        const bits = [];
        bits.push(`${d.name} is ${d.active ? 'an active' : 'an inactive'} Tour Guide${d.major ? ` majoring in ${d.major}` : ''}${d.leadership ? ' and part of leadership' : ''}.`);
        if (d.next_tours?.length) bits.push(`${cap(first)}’s next tour is ${plainSlot(d.next_tours[0])}${d.upcoming_tours > 1 ? ` (${num(d.upcoming_tours)} coming up)` : ''}.`);
        else if (!d.tours_unavailable) bits.push(`${cap(first)} has no upcoming tours on the schedule.`);
        const e = d.evaluation;
        if (e) bits.push(({ open: `Still needs an evaluation${e.priority ? ` (${e.priority})` : ''}, with no evaluator yet.`, claimed: `Evaluation: ${e.evaluator || 'an evaluator'} is lined up${e.date ? ` for ${e.date}` : ''}.`, submitted: 'Already evaluated this semester.', reviewed: 'Already evaluated this semester.', skip: 'Doesn’t need an evaluation this semester.', not_on_roster: 'Not on this semester’s evaluation roster.' })[e.status] || '');
        if (d.training) bits.push(`Training: ${d.training.done} of ${d.training.total} requirements complete${d.training.makeup_needed.length ? `; needs a makeup for ${names(d.training.makeup_needed)}` : ''}.`);
        return { text: join(...bits), suggest: chips(d.upcoming_tours ? `When is ${possessive(first)} next tour?` : null, e?.status === 'open' && t.can('evaluations.read') ? `Who can evaluate ${first}?` : null, d.training?.makeup_needed?.length && t.can('training.read.people') ? `What training does ${first} still need?` : null) };
      }
    },

    'people.major': {
      permission: 'people.read', mode: 'read', people: 'optional', params: [],
      async run(q, t) {
        const p = person(q);
        if (p) { const r = await t.must('get_person_profile', { person: p.id }, { card: false }); return { d: r.data, p }; }
        const r = await t.must('list_people', { filter: 'all_active', limit: 1 }, { card: false });
        return { d: r.data, breakdown: true };
      },
      respond({ d, p, breakdown }) {
        if (breakdown) return { text: `Active Tour Guides by major: ${(d.by_major || []).slice(0, 6).map(x => `${x.major} (${x.n})`).join(', ')}.`, cards: 'drop', suggest: chips('Which guides have no major?') };
        return { text: d.major ? `${possessive(d.name)} major is ${d.major}.` : `I don’t have a major on file for ${d.name}.`, cards: 'drop' };
      }
    },

    'people.active': {
      permission: 'people.read', mode: 'read', people: 'none', params: ['limit'],
      async run(q, t) { const fc = facet(q); const r = await t.must('list_people', { filter: fc.filter, limit: 12 }); return { d: r.data, fc }; },
      respond({ d, fc }) { return { text: `There ${d.count === 1 ? 'is' : 'are'} ${d.count} ${fc.label}.`, cards: d.count > 0 && d.count <= 12 ? undefined : 'drop' }; }
    },

    'people.add': {
      permission: 'people.write', mode: 'write', confirm: 'always', people: 'none', params: ['major', 'text'],
      async run(q, t) {
        const m = /\b(?:add|create|register|invite|enroll)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:tour\s+guide\s+|guide\s+|member\s+|person\s+)?(?:named\s+|called\s+)?([^,.;:()]+)/i.exec(q.text || '');
        let raw = m ? m[1].split(/\s+(?:as|to|on|in|for|with|who|and|email|major)\s+/i)[0].trim() : '';
        const parts = raw.split(/\s+/).filter(w => /^[\p{L}][\p{L}'’.-]*$/u.test(w));
        if (parts.length < 2) throw t.ask('What’s their first and last name?', [], 'text');
        const first = titleCase(parts[0]), last = titleCase(parts.slice(1).join(' '));
        return { r: await t.must('add_tour_guide', { first_name: first, last_name: last, ...(q.filters.email ? { email: q.filters.email } : {}), ...(q.filters.major ? { major: q.filters.major } : {}) }) };
      },
      respond: () => ({ text: '' })
    },

    'people.archive': {
      permission: 'people.write', mode: 'write', confirm: 'always', people: 'many', params: ['people'],
      async run(q, t) { const active = hasTag(q, 'RESTORE') || hasToken(q, 'reactivate', 'unarchive'); return { r: await t.must('set_guides_active', { people: q.filters.people.map(p => p.id), active }) }; },
      respond: () => ({ text: '' })
    },

    'people.note': {
      permission: 'people.write', mode: 'write', confirm: 'always', people: 'required', params: ['text', 'people'],
      async run(q, t) {
        const p = person(q);
        const m = /(?::|\bthat\b|\bsaying\b|\bsays\b|\babout\b)\s*(.+)$/i.exec((q.text || '').replace(/["“”]/g, ''));
        const note = q.filters.text || (m ? m[1].trim() : '');
        if (note.length < 3) throw t.ask(`What should the note say?`, [], 'text');
        return { r: await t.must('add_guide_note', { person: p.id, note: note.slice(0, 240) }) };
      },
      respond: () => ({ text: '' })
    },

    'people.update': {
      permission: 'people.write', mode: 'write', confirm: 'always', people: 'required', params: ['major', 'people'],
      async run(q, t) {
        const p = person(q), fields = {};
        if (q.filters.major) fields.major = q.filters.major; else { const m = /\bmajor\b.*?\bto\s+([A-Za-z &-]{3,60})/i.exec(q.text || ''); if (m) fields.major = titleCase(m[1].trim()); }
        if (q.filters.email) fields.email = q.filters.email;
        if (hasToken(q, 'leadership') && hasToken(q, 'make', 'set', 'mark')) fields.is_leadership = !hasToken(q, 'not', 'remove');
        if (!Object.keys(fields).length) throw t.ask('What should I change — their major, email or leadership status?', [], 'text');
        return { r: await t.must('update_tour_guide', { person: p.id, fields }) };
      },
      respond: () => ({ text: '' })
    },

    'people.role': {
      permission: 'roles.write', mode: 'write', confirm: 'always', people: 'optional', ownsPeople: true, params: ['people', 'text'],
      async run(q, t) {
        const roles = await t.deps.roles(), members = await t.deps.members();
        const said = (q.filters.text || q.text || '').toLowerCase(), nrm = x => String(x || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
        const p0 = person(q), target = members.find(x => nrm(said).includes(nrm(x.full_name))) || members.find(x => p0 && nrm(x.full_name) === nrm(p0.label));
        const p = target ? { label: target.full_name } : p0;
        if (!p) throw t.stop('Whose role? Give me a full name, like “make Riley Park a Co-Director”.');
        const role = roles.find(r => said.includes(r.name.toLowerCase())) || (/\badmin|administrator|co-?director/.test(said) ? roles.find(r => r.is_admin) : null);
        if (!role) throw t.ask('Which role — ' + or(roles.map(r => r.name)) + '?', roles.map(r => ({ label: r.name, value: r.name })), 'role');
        if (!target) throw t.stop(`I don’t see ${p.label} among the people who can sign in to the Hub, so there’s no role to change.`);
        return { r: await t.must('change_person_role', { person_email: target.email, role: role.name }) };
      },
      respond: () => ({ text: '' })
    },

    'people.semester': {
      permission: 'people.write', mode: 'write', confirm: 'always', people: 'required', params: ['people', 'semester'],
      async run(q, t) {
        const active = !(hasToken(q, 'inactive', 'not') || hasTag(q, 'NEG'));
        return { r: await t.must('set_semester_participation', { people: q.filters.people.map(p => p.id), active, ...(q.filters.semester ? { term: q.filters.semester } : {}) }) };
      },
      respond: () => ({ text: '' })
    },

    'people.nickname': {
      permission: 'self.read', mode: 'read', people: 'optional', params: [],
      async run(q, t) {
        const text = q.text || '';
        const forget = /\bforget\b/i.test(text);
        const m = /\b(?:say|call|calls)\s+["“']?([\p{L}][\p{L} .'-]{0,38}?)["”']?\s+(?:i mean|means|is|as)\b/iu.exec(text) || /\bnickname\s+["“']?([\p{L}][\p{L}.'-]{1,30})["”']?/iu.exec(text) || /\bcall\s+[\p{L} ]+?\s+["“']?([\p{L}][\p{L}.-]{1,12})["”']?\s*$/iu.exec(text);
        const nick = m?.[1]?.trim();
        if (!nick) throw t.stop('What nickname should I remember?');
        if (forget) { await t.must('forget_nickname', { nickname: nick }); return { forgot: nick }; }
        const p = person(q); if (!p) throw t.stop('Who does that nickname stand for?');
        await t.must('remember_nickname', { nickname: nick, person: p.id });
        return { nick, p };
      },
      respond: r => (r.forgot ? { text: `Okay, I’ve forgotten “${r.forgot}”.` } : { text: `Got it — when you say “${r.nick}”, I’ll know you mean ${r.p.label}. I only remember that on this device.` })
    }
  }
};
