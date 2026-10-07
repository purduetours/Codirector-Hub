/* Data: are the connected spreadsheets syncing, which names don't match a Tour Guide, and
   (with confirmation) matching one. Admin-only: this is the plumbing under the Hub. */
import { Num, count, names, join, s as pl } from '../engine/respond.js';
import { person, chips } from './util.js';
import { normalize, tokenize, STOP } from '../engine/lexicon.js';

const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} minutes ago` : m < 1440 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };

export default {
  id: 'data', label: 'Data',
  intents: {
    'data.sync_status': {
      permission: 'data.read', mode: 'read', people: 'none', params: [],
      async run(q, t) { const r = await t.must('get_data_health'); return { d: r.data }; },
      respond({ d }) {
        const src = d.sources || [], lastOk = src.filter(x => x.last_success).sort((a, b) => String(b.last_success).localeCompare(String(a.last_success)))[0];
        if (d.healthy) return { text: join('Everything is synced.', lastOk ? `The most recent sync was ${ago(lastOk.last_success)} (${lastOk.name}).` : ''), cards: 'drop', suggest: chips('Any conflicts this week?') };
        return { text: `${Num(d.problems.length)} thing${pl(d.problems.length)} need${d.problems.length === 1 ? 's' : ''} a look: ${names(d.problems.map(x => x.replace(/\.$/, '')), 3)}.`, suggest: chips('Which names don’t match?') };
      }
    },

    'data.unmatched': {
      permission: 'data.read', mode: 'read', people: 'none', params: ['limit'],
      async run(q, t) { const r = await t.must('get_unmatched_identities', { limit: 6 }); return { d: r.data }; },
      respond({ d }) {
        if (!d.count) return { text: 'Every name from the spreadsheets is matched to a Tour Guide.', cards: 'drop' };
        const first = d.items[0], sug = first.suggestions?.[0]?.name;
        return { text: join(`${Num(d.count)} name${pl(d.count)} from the spreadsheets still ${d.count === 1 ? 'needs' : 'need'} matching.`, `For example “${first.name}”${sug ? ` — I’d guess ${sug}` : ''}.`), suggest: sug ? chips(`Match “${first.name}” to ${sug}`) : chips('Is everything synced?') };
      }
    },

    'data.match': {
      permission: 'identity.write', mode: 'write', confirm: 'always', people: 'required', params: ['people', 'issue'],
      async run(q, t) {
        const p = person(q);
        const u = (await t.must('get_unmatched_identities', { limit: 20 }, { card: false })).data;
        if (!u.count) throw t.stop('There are no unmatched names to resolve right now.');
        const pnames = new Set(tokenize(normalize(p.label)));
        const want = tokenize(normalize(q.text || '')).filter(x => !STOP.has(x) && !pnames.has(x) && x.length > 1);
        const score = i => tokenize(normalize(i.name)).filter(x => want.includes(x)).length;
        const ranked = u.items.map(i => ({ i, s: score(i) })).sort((a, b) => b.s - a.s);
        let pick = q.filters.issue ? u.items.find(i => String(i.issue_id) === String(q.filters.issue)) : null;
        if (!pick) pick = ranked[0].s > 0 && (ranked.length === 1 || ranked[0].s > ranked[1].s) ? ranked[0].i : u.items.length === 1 ? u.items[0] : null;
        if (!pick) throw t.ask(`Which spreadsheet name is ${p.label}?`, u.items.slice(0, 6).map(i => ({ label: i.name, value: String(i.issue_id) })), 'issue');
        return { r: await t.must('resolve_identity_mapping', { issue_id: pick.issue_id, person: p.id }) };
      },
      respond: () => ({ text: '' })
    }
  }
};
