/* Operations: the brief, what needs attention, the Action Center, announcements, the
   semester, recent activity, and opening pages. The brief is built by briefing.js from
   the same tools every other answer uses, so it can never show something the person
   couldn't ask for directly. */
import { Num, num, count, names, join, s as pl, cap } from '../engine/respond.js';
import { chips, hasTag, hasToken } from './util.js';

const section = (b, title) => (b.sections || []).find(x => x.title === title);
const texts = sec => (sec?.items || []).map(i => i.text.replace(/\.$/, ''));

function briefKind(q) {
  const dr = q.filters.dateRange;
  if (hasTag(q, 'TRAIN')) return 'training';
  if (hasTag(q, 'EVAL')) return 'evaluation';
  if (hasToken(q, 'weekly', 'week') || (dr && dr.from !== dr.to && /week/.test(dr.label || ''))) return 'weekly';
  if (hasToken(q, 'morning')) return 'morning';
  return 'operations';
}
const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} minutes ago` : m < 1440 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };

function titleFrom(body) { const t = body.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 8).join(' '); return cap(t); }

export default {
  id: 'operations', label: 'Operations',
  intents: {
    'operations.brief': {
      permission: 'self.read', mode: 'read', people: 'none', params: ['dateRange'],
      async run(q, t) { const kind = briefKind(q); const r = await t.must('get_briefing', { kind }); return { b: r.data, kind }; },
      respond({ b, kind }, q, t) {
        if (b.kind === 'personal') {
          const mine = texts(section(b, 'You')), att = texts(section(b, 'Needs attention')), tr = texts(section(b, 'Training'));
          return { text: join('Here’s your brief.', ...mine.map(x => x + '.'), tr.length ? `Training: ${names(tr, 3)}.` : '', att.length ? `${Num(att.length)} thing${pl(att.length)} need${att.length === 1 ? 's' : ''} your attention: ${names(att, 3)}.` : 'Nothing needs your attention.'), suggest: chips('When is my next tour?', 'What training do I still need?') };
        }
        const today = texts(section(b, 'Today')), att = texts(section(b, 'Needs attention')), up = texts(section(b, 'Upcoming'));
        const lead = kind === 'weekly' ? 'Here’s the plan for next week.' : kind === 'training' ? 'Here’s the training picture.' : kind === 'evaluation' ? 'Here’s the evaluation picture.' : 'Here’s where things stand.';
        const text = join(lead, today.length ? `${today[0]}.` : '', att.length ? `${Num(att.length)} thing${pl(att.length)} need${att.length === 1 ? 's' : ''} attention — ${att.slice(0, 3).join('; ')}.` : 'Nothing needs attention right now.', up.length ? `Coming up — ${up[0]}.` : '', texts(section(b, 'Not available'))[0] ? texts(section(b, 'Not available'))[0] + '.' : '');
        return { text, suggest: chips(att.length ? 'Anything I need to worry about?' : null, 'Who still needs evaluated?', 'Are we ready for the next training session?') };
      }
    },

    'operations.problems': {
      permission: 'self.read', mode: 'read', people: 'none', params: [],
      async run(q, t) { const r = await t.must('get_briefing', { kind: 'operations' }, { card: false }); return { b: r.data }; },
      respond({ b }, q, t) {
        const sec = section(b, 'Needs attention'), att = texts(sec);
        const gap = texts(section(b, 'Not available'))[0];
        if (!att.length) return { text: gap ? `Nothing looks wrong in what I could check. ${gap}.` : 'Nothing looks wrong right now. I checked the schedule, evaluations, training and the data connections.', cards: 'drop', suggest: chips('Give me the brief') };
        return { text: `${Num(att.length)} thing${pl(att.length)} need${att.length === 1 ? 's' : ''} attention — ${att.slice(0, 3).join('; ')}.`, cards: [{ kind: 'brief', title: 'Needs attention', sections: [sec] }], suggest: chips('Any conflicts this week?', 'Who still needs evaluated?') };
      }
    },

    'operations.actions': {
      permission: 'actions.read', mode: 'read', people: 'none', params: ['limit'],
      async run(q, t) { const r = await t.must('get_action_center', { limit: 5 }); return { d: r.data }; },
      respond({ d }) {
        if (!d.count) return { text: 'Your Action Center is empty — nothing needs you right now.', cards: 'drop' };
        return { text: `${Num(d.count)} thing${pl(d.count)} in your Action Center${d.urgent_or_action ? `, ${num(d.urgent_or_action)} of them needing action` : ''}. Most pressing: ${d.items[0].title}.`, suggest: chips() };
      }
    },

    'operations.announcements': {
      permission: 'announcements.read', mode: 'read', people: 'none', params: ['limit'],
      async run(q, t) { const r = await t.must('get_announcements', { limit: 3 }); return { d: r.data }; },
      respond({ d }) {
        if (!d.count) return { text: 'There aren’t any announcements yet.', cards: 'drop' };
        const a = d.announcements[0];
        return { text: `${Num(d.count)} recent announcement${pl(d.count)}. The latest${a.pinned ? ' (pinned)' : ''} is “${a.title}”, posted ${a.posted} by ${a.by}.`, suggest: chips() };
      }
    },

    'operations.announce': {
      permission: 'announcements.write', mode: 'write', confirm: 'always', people: 'none', params: ['text'],
      async run(q, t) {
        let body = q.filters.text;
        if (!body) { const m = /(?::|\bthat\b|\bsaying\b|\bsays\b)\s*(.{5,1500})$/i.exec(q.text || ''); body = m ? m[1].trim() : ''; }
        body = body.replace(/^["“”']+|["“”']+$/g, '').trim();
        if (body.length < 5) throw t.ask('What should the announcement say?', [], 'text');
        body = cap(body) + (/[.!?]$/.test(body) ? '' : '.');
        return { r: await t.must('create_announcement', { title: titleFrom(body), body, pinned: hasToken(q, 'pinned', 'pin') }) };
      },
      respond: () => ({ text: '' })
    },

    'operations.mark_read': {
      permission: 'announcements.read', mode: 'write', confirm: 'always', people: 'none', params: [],
      async run(q, t) { return { r: await t.must('acknowledge_announcements', {}) }; },
      respond: () => ({ text: '' })
    },

    'operations.semester': {
      permission: 'semester.read', mode: 'read', people: 'none', params: [],
      async run(q, t) { const r = await t.must('get_semester_status'); return { d: r.data }; },
      respond({ d }) { return { text: join(`It’s ${d.semester || 'the current semester'}.`, d.starts && d.ends ? `It runs ${d.starts} to ${d.ends}.` : '', d.active_guides ? `${Num(d.active_guides)} active Tour Guides.` : ''), cards: 'drop' }; }
    },

    'operations.activity': {
      permission: 'audit.read', mode: 'read', people: 'none', params: ['limit'],
      async run(q, t) { const r = await t.must('get_recent_activity', { limit: 6 }); return { d: r.data }; },
      respond({ d }) {
        const a = d.activity || [];
        if (!a.length) return { text: 'There’s no recent activity.', cards: 'drop' };
        return { text: `The latest change: ${a[0].who} — ${a[0].did}${a[0].target ? ` (${a[0].target})` : ''}, ${a[0].at}. ${a.some(x => /^Vanessa/.test(x.who)) ? 'Some of the recent changes were made by me, on someone’s behalf.' : ''}`.trim(), suggest: chips() };
      }
    },

    'operations.open': {
      permission: 'self.read', mode: 'read', people: 'none', params: ['page'],
      async run(q, t) {
        const page = q.filters.page;
        if (!page) throw t.stop('Which page? For example “open the schedule” or “take me to training”.');
        const r = await t.must('open_page', { page, go: true });
        return { d: r.data };
      },
      respond({ d }) { return { text: `Opening ${d.page}.`, cards: 'drop' }; }
    }
  }
};
