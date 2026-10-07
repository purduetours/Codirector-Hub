/* The assistant herself: what she can do (for this person's role), hello, thanks, and
   how she is running. No Hub data is read here, so none is ever at risk. */
import { join } from '../engine/respond.js';
import { chips } from './util.js';

const hour = t => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: t.ctx.tz }).format(t.ctx.now));

export default {
  id: 'assistant', label: 'Assistant',
  intents: {
    'assistant.help': {
      permission: 'self.read', mode: 'read', people: 'none', params: [],
      async run() { return {}; },
      respond(_r, q, t) {
        const lines = ['**Schedule** — who is touring when, your next tour, conflicts.'];
        if (t.can('evaluations.read')) lines.push('**Evaluations** — who still needs one, who is high priority, the best opportunity this week, and assigning an evaluator (I always ask you to confirm).');
        if (t.can('training.read')) lines.push('**Training** — what’s coming up, who missed it or owes a makeup, attendance, whether a session is ready.');
        else lines.push('**Training** — what you still need and when the next session is.');
        lines.push('**Coverage** — empty desk slots and who could cover a tour.');
        if (t.can('people.read')) lines.push('**People** — look anyone up, find guides by major, leadership or status.');
        lines.push(t.can('data.read') ? '**Operations & data** — the daily brief, what needs attention, announcements, whether the spreadsheets are syncing and which names don’t match.' : '**Operations** — your brief, what needs your attention, announcements.');
        const text = `Here’s what I can do:\n${lines.map(l => `- ${l}`).join('\n')}\nAnything that changes something shows you a confirmation first; nothing is saved until you say yes.`;
        return { text, suggest: chips(t.can('evaluations.read') ? 'Who still needs evaluated?' : 'When is my next tour?', 'Give me the brief', t.can('training.read.people') ? 'Who missed training?' : 'What training do I still need?') };
      }
    },

    'assistant.greet': {
      permission: 'self.read', mode: 'read', people: 'none', params: [],
      async run() { return {}; },
      respond(_r, q, t) {
        const h = hour(t), part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening', first = String(t.who.name || '').trim().split(/\s+/)[0];
        return { text: `${part}${first ? ', ' + first : ''}. What can I help with?`, suggest: chips('Give me the brief', t.can('evaluations.read') ? 'Who still needs evaluated?' : 'When is my next tour?') };
      }
    },

    'assistant.thanks': { permission: 'self.read', mode: 'read', people: 'none', params: [], async run() { return {}; }, respond: () => ({ text: 'Anytime.' }) },

    'assistant.engine': {
      permission: 'self.read', mode: 'read', people: 'none', params: [],
      async run() { return {}; },
      respond(_r, q, t) {
        const e = t.engine || {};
        const text = e.mode === 'enhanced'
          ? `I’m in Enhanced mode: a language model running on this computer helps me understand unusual phrasing. The answers still come from the Hub’s own data and tools. Nothing is sent to an outside AI service.`
          : join('I’m in Standard mode, which needs no AI model at all: I recognise what you ask and answer straight from the Hub’s data. Nothing is sent to an outside AI service.', e.local?.configured ? 'A local model is set up but isn’t responding, so I’m not using it right now.' : 'An admin can optionally connect a model running on their own computer for more flexible wording (see Admin → Vanessa).');
        return { text, cards: 'drop' };
      }
    }
  }
};
