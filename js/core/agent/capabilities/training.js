/* Training: what's coming up, who is behind, who owes a makeup, attendance, whether a
   session is ready, and (with confirmation) makeups, attendance and new sessions.
   Standing (complete / scheduled / needs makeup) is the database's own definition. */
import { Num, num, count, names, join, whenWords, s as pl, are, has, lower } from '../engine/respond.js';
import { windowArgs, person, chips, hasTag, hasToken } from './util.js';

const reqOrSession = q => q.filters.session || q.filters.requirement || null;

const sessionLine = s => `${s.title}, ${s.when}${s.location ? ` · ${s.location}` : ''}`;

export default {
  id: 'training', label: 'Training',
  intents: {
    'training.upcoming': {
      permission: 'training.self', mode: 'read', people: 'none', params: ['dateRange', 'session', 'limit'],
      async run(q, t) {
        const f = q.filters;
        if (!t.can('training.read')) { const r = await t.must('get_training_status', {}); return { mine: true, d: r.data }; }
        const r = await t.must('get_training_sessions', { ...(f.dateRange && !f.dateRange.vague ? windowArgs(f.dateRange) : {}), ...(f.session ? { query: f.session } : {}), limit: f.limit || 6 });
        return { d: r.data, range: f.dateRange };
      },
      respond(res, q, t) {
        const { d } = res;
        if (res.mine) {
          const todo = (d.requirements || []).filter(x => !['Complete', 'Waived', 'Excused'].includes(x.state));
          if (d.linked === false) return { text: d.message, cards: 'drop' };
          return { text: todo.length ? `You’re not done with ${count(todo.length, 'training requirement')}: ${names(todo.map(x => `${x.requirement}${x.next_session ? ` (next ${x.next_session})` : ''}`))}.` : 'You’re all caught up on training requirements.', cards: 'drop', suggest: chips('Any training materials?') };
        }
        if (!d.count) return { text: res.range ? `There’s no training scheduled ${whenWords(res.range) || ''}.`.replace(/ \./, '.') : 'There aren’t any upcoming training sessions scheduled.', cards: 'drop', suggest: chips('Who still needs training?') };
        const first = d.sessions[0];
        if (d.count === 1) return { text: `${first.title} is ${first.when}${first.location ? ` in ${first.location}` : ' (no location yet)'}${first.speakers?.length ? `, with ${names(first.speakers)}` : ''}.`, cards: 'drop', suggest: chips(`Are we ready for ${first.title}?`) };
        return { text: `${Num(d.count)} training sessions ${res.range ? whenWords(res.range) : 'coming up'}. The next is ${sessionLine(first)}.`, suggest: chips('Are we ready for the next session?', 'Who still needs training?') };
      }
    },

    'training.missing': {
      permission: 'training.read.people', mode: 'read', people: 'none', params: ['dateRange', 'requirement', 'session', 'limit'],
      async run(q, t) {
        const f = q.filters, missed = hasTag(q, 'MISSED') || hasToken(q, 'noshow');
        const r = await t.must('get_training_gaps', { kind: missed ? 'missed' : 'incomplete', ...(f.requirement || f.session ? { requirement: f.requirement || f.session } : {}), ...(missed && f.dateRange ? windowArgs(f.dateRange) : {}), limit: 12 });
        return { d: r.data, missed, range: f.dateRange };
      },
      respond({ d, missed, range }) {
        if (!d.count) return { text: d.message || (missed ? `Nobody missed training ${range ? whenWords(range) : 'this week'}.` : 'Nobody is behind on training right now.'), cards: 'drop' };
        const list = (d.people || []).map(p => p.name);
        const text = missed ? `${Num(d.count)} ${d.count === 1 ? 'person' : 'people'} missed training ${range ? whenWords(range) : 'this week'}${d.session_context ? ` (${d.session_context})` : ''}${d.count <= 4 ? `: ${names(list)}.` : '.'}`
          : `${Num(d.count)} ${d.count === 1 ? 'person' : 'people'} ${d.label || 'still need training'}${d.count <= 4 ? `: ${names(list)}.` : '.'}`;
        return { text, cards: d.count <= 4 ? 'drop' : undefined, suggest: chips('Assign them to a makeup', 'Draft a reminder for them') };
      }
    },

    'training.makeup': {
      permission: 'training.read.people', mode: 'read', people: 'none', params: ['requirement', 'limit'],
      async run(q, t) { const r = await t.must('get_training_gaps', { kind: 'needs_makeup', ...(q.filters.requirement ? { requirement: q.filters.requirement } : {}), limit: 12 }); return { d: r.data }; },
      respond({ d }) {
        if (!d.count) return { text: 'Nobody needs a makeup right now.', cards: 'drop' };
        const list = (d.people || []).map(p => p.name);
        return { text: `${Num(d.count)} ${d.count === 1 ? 'person needs' : 'people need'} a makeup${d.count <= 4 ? `: ${names(list)}.` : '.'}`, cards: d.count <= 4 ? 'drop' : undefined, suggest: chips('Assign them to a makeup', 'Draft a reminder for them') };
      }
    },

    'training.assign_makeup': {
      permission: 'training.write', mode: 'write', confirm: 'always', people: 'many', params: ['dateRange', 'session', 'people'],
      async run(q, t) {
        const f = q.filters, dr = f.dateRange;
        if (!dr?.from) throw t.ask('What day should the makeup be?', [], 'date');
        const args = { when: dr.label || dr.from, ...(dr.at ? { start_time: dr.at } : {}), ...(f.session ? { session: f.session } : {}) };
        if (dr.from && dr.from === dr.to) { delete args.when; args.date = dr.from; }
        if (f.people?.length) args.people = f.people.map(p => p.id); else args.from_last_list = true;
        return { r: await t.must('assign_makeup', args) };
      },
      respond: () => ({ text: '' })
    },

    'training.person': {
      permission: 'training.self', mode: 'read', people: 'required', params: [],
      async run(q, t) {
        const p = person(q), me = p.memberId === t.who.id;
        const r = await t.must('get_training_status', me ? {} : { person: p.id });
        return { d: r.data, p };
      },
      respond({ d, p }) {
        const reqs = d.requirements || [];
        const todo = reqs.filter(x => !['Complete', 'Waived', 'Excused'].includes(x.state));
        const missed = reqs.filter(x => x.missed).map(x => x.missed);
        if (!reqs.length) return { text: `${p.label} doesn’t have any training requirements this semester.`, cards: 'drop' };
        const text = todo.length ? `${p.label} still has ${count(todo.length, 'training requirement')} open: ${names(todo.map(x => `${x.requirement} (${lower(x.state)})`))}.${missed.length ? ` They missed ${names(missed)}.` : ''}` : `${p.label} is done with all ${num(reqs.length)} training requirement${pl(reqs.length)}.`;
        return { text, cards: 'drop', suggest: todo.some(x => /makeup/i.test(x.state)) ? chips('Assign them to a makeup') : chips() };
      }
    },

    'training.mine': {
      permission: 'training.self', mode: 'read', people: 'none', params: [],
      async run(q, t) { const r = await t.must('get_training_status', {}); return { d: r.data }; },
      respond({ d }) {
        if (d.linked === false) return { text: d.message, cards: 'drop' };
        const todo = (d.requirements || []).filter(x => !['Complete', 'Waived', 'Excused'].includes(x.state));
        return { text: todo.length ? `You still have ${count(todo.length, 'training requirement')} to finish: ${names(todo.map(x => `${x.requirement}${x.next_session ? ` (next session ${x.next_session})` : ` — ${lower(x.state)}`}`))}.` : 'You’re all caught up on training. Nothing is outstanding.', cards: 'drop', suggest: chips('Any training materials?') };
      }
    },

    'training.attendance': {
      permission: 'training.read.people', mode: 'read', people: 'none', params: ['session', 'dateRange'],
      async run(q, t) {
        const f = q.filters;
        const r = await t.must('get_training_attendance', f.session ? { session: f.session } : f.dateRange?.from ? { session: f.dateRange.label || f.dateRange.from } : {});
        return { d: r.data };
      },
      respond({ d }) {
        const bits = [`${num(d.present)} present`, d.excused ? `${num(d.excused)} excused` : '', `${num(d.absent)} absent`, d.not_marked ? `${num(d.not_marked)} not marked yet` : ''].filter(Boolean);
        return { text: join(`${d.session} (${d.when}): ${bits.join(', ')}.`, d.absent && d.absent_names?.length ? `Absent: ${names(d.absent_names)}.` : '', !d.attendance_submitted && d.not_marked ? 'Attendance hasn’t been submitted yet.' : ''), cards: 'drop', suggest: d.absent ? chips('Assign them to a makeup') : chips() };
      }
    },

    'training.mark_attendance': {
      permission: 'training.write', mode: 'write', confirm: 'always', people: 'many', params: ['session', 'attendance', 'people'],
      async run(q, t) {
        const f = q.filters;
        if (!f.attendance) throw t.ask('Which status — attended, late, excused or absent?', ['Attended', 'Late', 'Excused', 'Absent'].map(x => ({ label: x, value: x })), 'attendance');
        const base = f.session ? { session: f.session } : {};
        if (f.people?.length) return { r: await t.must('update_training_attendance', { ...base, entries: f.people.map(p => ({ person: p.id, status: f.attendance })) }) };
        if (hasToken(q, 'everyone', 'all', 'everybody')) return { r: await t.must('update_training_attendance', { ...base, mark_all: { status: f.attendance } }) };
        throw t.stop('Who should I mark? Give me a name, or say “mark everyone attended”.');
      },
      respond: () => ({ text: '' })
    },

    'training.readiness': {
      permission: 'training.read', mode: 'read', people: 'none', params: ['dateRange', 'session'],
      async run(q, t) {
        const f = q.filters;
        const r = await t.must('get_training_readiness', { ...(f.session ? { session: f.session } : {}), ...(!f.session && f.dateRange && !f.dateRange.vague ? windowArgs(f.dateRange) : {}) });
        return { d: r.data };
      },
      respond({ d }) {
        if (!d.session) return { text: d.message || 'There’s no session to check.', cards: 'drop' };
        const s = d.session;
        if (d.ready && !d.nice_to_fix.length) return { text: `Yes — ${s.title} (${s.when}) looks ready. Location, speaker and attendee list are all set.`, suggest: chips('How is training going?') };
        if (d.ready) return { text: `${s.title} (${s.when}) is ready to run. Nice to fix: ${names(d.nice_to_fix.map(x => lower(x)))}`, suggest: chips() };
        return { text: `${s.title} (${s.when}) isn’t ready yet. ${names(d.blockers.map(x => x.replace(/\.$/, '')), 4)}.`, suggest: chips() };
      }
    },

    'training.overview': {
      permission: 'training.read', mode: 'read', people: 'none', params: ['semester'],
      async run(q, t) { const r = await t.must('get_training_overview', q.filters.semester ? { term: q.filters.semester } : {}); return { d: r.data }; },
      respond({ d }) {
        const reqs = d.requirements || [];
        const behind = reqs.reduce((n, r) => n + (r.not_done || 0), 0), makeup = reqs.reduce((n, r) => n + (r.makeup_needed || 0), 0);
        const att = (d.needs_attention || []).length;
        return { text: join(`${Num(reqs.length)} training requirement${pl(reqs.length)} this semester.`, behind ? `${Num(behind)} not-done ${behind === 1 ? 'entry' : 'entries'}` + (makeup ? `, ${num(makeup)} needing a makeup.` : '.') : makeup ? `${Num(makeup)} needing a makeup.` : 'Everyone is on track.', att ? `${Num(att)} session${pl(att)} need${att === 1 ? 's' : ''} attention.` : ''), suggest: chips('Who still needs training?', 'Are we ready for the next session?') };
      }
    },

    'training.materials': {
      permission: 'training.self', mode: 'read', people: 'none', params: ['session', 'requirement'],
      async run(q, t) { const r = await t.must('get_training_materials', { query: reqOrSession(q) || '' }); return { d: r.data }; },
      respond({ d }) { return { text: d.count ? `I found ${count(d.count, 'training material')}${d.materials[0]?.for ? ` — starting with ${d.materials[0].title} for ${d.materials[0].for}` : ''}.` : 'I didn’t find any training materials for that.', cards: d.count ? undefined : 'drop' }; }
    },

    'training.remind': {
      permission: 'training.write', mode: 'read', people: 'many', params: ['requirement', 'session', 'people'],
      async run(q, t) {
        const f = q.filters;
        const r = await t.must('draft_training_reminder', { ...(f.people?.length ? { people: f.people.map(p => p.id) } : {}), ...(reqOrSession(q) ? { topic: reqOrSession(q) } : {}) });
        return { d: r.data };
      },
      respond({ d }) { return { text: `I drafted a reminder for ${count(d.recipients, 'person', 'people')}. Nothing was sent — copy it from the card below.`, suggest: chips() }; }
    },

    'training.create_session': {
      permission: 'training.write', mode: 'write', confirm: 'always', people: 'none', params: ['dateRange', 'text', 'session'],
      async run(q, t) {
        const f = q.filters, dr = f.dateRange;
        const title = f.text || f.session;
        if (!title) throw t.ask('What should the session be called?', [], 'text');
        if (!dr?.from) throw t.ask('What day is it on?', [], 'date');
        return { r: await t.must('create_training_session', { title, date: dr.from, ...(dr.at ? { start_time: dr.at } : {}) }) };
      },
      respond: () => ({ text: '' })
    },

    'training.copy_setup': {
      permission: 'training.write', mode: 'write', confirm: 'always', people: 'none', params: ['semester', 'text'],
      async run(q, t) {
        const ids = [...String(q.text || '').toLowerCase().matchAll(/\b(fall|spring|summer|winter)\s*(20\d{2})\b/g)].map(m => `${m[1]}-${m[2]}`);
        if (ids.length < 2) throw t.ask('Which semesters — for example “copy fall 2026 training to spring 2027”?', [], 'text');
        return { r: await t.must('copy_training_setup', { from_term: ids[0], to_term: ids[1] }) };
      },
      respond: () => ({ text: '' })
    },

    'training.set_completion': {
      permission: 'training.write', mode: 'write', confirm: 'always', people: 'many', params: ['requirement', 'people', 'status'],
      async run(q, t) {
        const f = q.filters;
        if (!f.requirement) throw t.ask('Which training requirement?', [], 'requirement');
        const status = hasToken(q, 'excuse', 'excused') ? 'excused' : hasToken(q, 'waive', 'waived') ? 'waived' : 'complete';
        return { r: await t.must('set_training_completion', { requirement: f.requirement, people: f.people.map(p => p.id), status }) };
      },
      respond: () => ({ text: '' })
    }
  }
};
