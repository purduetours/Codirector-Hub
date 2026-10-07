# Vanessa — architecture

For developers. Anyone running the program should read "Using Vanessa" in `ADMIN_GUIDE.md` instead. Setting up the optional local model is a separate, short document: `LOCAL_AI_SETUP.md`.

**Vanessa needs no paid AI, no API key, no AI account and no hosted function.** She is Codirector's own software: typed tools over the Hub's data, a deterministic engine that understands what people ask, and a confirmation system for changes. An optional language model running on someone's own computer can make her more flexible with unusual wording; she works fully without it.

## The short version

```
 person ──► Vanessa panel (browser: typed or spoken)
              │  conversation state, page context
              ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 2. DETERMINISTIC ENGINE  js/core/agent/engine/   ("Standard Vanessa")      │
   │    normalise → extract entities → score intents → follow-ups → Query      │
   │    clear request ─────────────────────────────► run it (no model)          │
   │    unclear + local model healthy ──► 3. LOCAL MODEL (optional) ──► Query   │
   │    unclear + no model ──► best guess / one question / her older answers    │
   └───────────────────────────┬──────────────────────────────────────────────┘
                               │  a validated Query { intent, filters }
                               ▼
        capability router  js/core/agent/capabilities/   permission check, run(), respond()
                               │
                               ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 1. TOOL LAYER  js/core/agent/tools/   typed · validated · permission-aware │
   │    reads: the Hub's loaders and tables, as the signed-in person            │
   │    writes: PREPARE only → confirmation card                                │
   └───────────────────────────┬──────────────────────────────────────────────┘
                               ▼
        confirmation (pending.js): "yes"/button, handled in code ──► admin_* RPC
                               ▼
        verify by re-reading → receipt → audit log "Vanessa on behalf of …"
```

Four decisions explain nearly everything:

1. **The important logic is application logic.** Ranking, matching, dates, names, permissions and the words she says come from Codirector's code. A model never holds the source of truth, never ranks anyone and never sees the roster.
2. **A model, if present, only translates.** It turns a sentence into a Query from a closed menu. Names and dates in that Query are re-extracted from the person's own words, so it cannot invent either. Its output is validated like any untrusted input.
3. **Authorization is the database's, not the model's and not the browser's.** Tools run as the signed-in person, so Row Level Security and every `admin_*` function's `hub_require_admin()` apply exactly as they do for the screens. The browser-side capability table is a first gate to avoid pointless attempts; it is never the only one.
4. **Nothing is invented and nothing is called done unless it was verified.** Facts come from tools each time; after every write the result is re-read.

## Two modes, chosen automatically

| | Standard Vanessa | Enhanced Vanessa |
|---|---|---|
| Needs | nothing | a model on this computer (or network) — optional |
| Understands | recognised requests, typos, follow-ups, two-part sentences | the same, plus unusual wording and loose multi-part requests |
| Speed | milliseconds | a second or three for the requests that need the model |
| Used when | always | only when Standard isn't sure, the model is on and healthy, and the admin switch allows it |
| If it fails | — | quietly drops to Standard for a minute; no error, no paid fallback |

People never choose a mode. The Admin → Vanessa page shows which one is active and has a one-click "Test Vanessa Engine".

### How a message is routed (`engine/router.js`)

```
1. the answer to a question she asked ("the first one", "Jordan Smith")  → finish that request
1b. two clearly separate requests joined by "and"                         → run both (reads; a change goes last)
2. clearly one of the things she knows (confidence ≥ 0.75)                → run it. No model.
3. a continuation ("what about Thursday?", "set it up", "just the unassigned") → run from saved state
4. unclear, a local model is on and healthy                               → ask it for a structured request; validate; run
5. unclear, no model:  confidence ≥ 0.5  → best guess (clear margin) or one short question
                       otherwise         → hand to her older built-in answers (handbook, evaluation write-up, undo)
```

The older Vanessa (`vanessa-*.js`, `vanessa-ui.js`) is untouched and still answers what the new engine does not recognise, such as handbook questions, writing up an evaluation, and undo.

## Files

```
js/core/agent/
  index.js            controller: one conversation per sign-in, UI, voice, the optional local model
  engine/
    lexicon.js        THE vocabulary: contractions, phrases, concepts (tags), typo repair
    intents.js        THE catalogue of intents: how each is recognised (rules + examples)
    phrasebook.js     extra phrasings she has been taught (data only)
    extract.js        entities: people, dates/times, sessions, requirements, major, priority, …
    match.js          scores intents; confidence bands
    dialog.js         conversation state; follow-ups; answers to her questions
    compose.js        sentence → entities → Query
    query.js          the Query shape and its validation (shared by Standard and the local model)
    split.js          "A and B" → two requests
    router.js         the hybrid router above; permission denial; clarification; pending text
    turn.js           what a capability is handed (`t.call`, `t.must`, `t.stop`, `t.ask`)
    respond.js        reusable sentence builders (numbers as words, lists, "Jordan Smith and 3 others")
    metrics.js        content-free counters; learn.js  phrasings she missed (this device only)
  capabilities/       the capability router: schedule, evaluations, training, coverage, people,
                      operations, data, assistant — each declares its intents (see below)
  local/              the OPTIONAL local model: config.js, providers.js, prompts.js, index.js
  tools/              the typed tool layer (51 tools)       registry.js, runtime.js (executeTool, confirm)
  capabilities.js     who may use what (role flags) — NOT the same file as capabilities/
  pending.js          proposal → hash → confirmation → execute → verify
  briefing.js         the operations brief         time.js   dates in code       entities.js  names
  deps.js             the only file that imports Hub modules (so the rest runs on fake data in tests)
  chat-ui.js, voice.js, format.js, page.js, errors.js, state.js, schema.js
```

## Layer 2 — the deterministic intent layer

**One vocabulary** (`lexicon.js`). Text is lower-cased, accents removed, contractions expanded ("hasn't" → "has not"), and multi-word ideas collapsed ("make up" → `makeup`, "high priority" → `highprio`, "what's going on" → `brief`). Each word then carries *tags* (concepts): `EVAL` is eval/evals/evaled/evaluate/evaluation…, `NEED`, `TOUR`, `COVER`, `PRIO`… So "Who needs evaluated?", "Who still needs an eval?" and "Who hasn't been evaled?" are the same set of concepts. Typos are repaired toward the vocabulary only for dropped, extra or swapped letters (never a changed letter, so "looking" is never "booking").

**One catalogue** (`intents.js`). Each intent lists rules and examples; there are 59:

| Capability | Intents (\* = a change, always confirmed) |
|---|---|
| schedule | `schedule.next` `.today` `.date` `.person` `.conflicts` |
| evaluations | `evaluation.needs` `.priority` `.status` `.opportunities` `.assign`\* `.set_priority`\* `.set_need`\* `.mine` `.evaluators` |
| training | `training.upcoming` `.missing` `.makeup` `.assign_makeup`\* `.person` `.mine` `.attendance` `.mark_attendance`\* `.readiness` `.overview` `.materials` `.remind` `.create_session`\* `.copy_setup`\* `.set_completion`\* |
| coverage | `coverage.open` `.suggest` `.person` |
| people | `people.search` `.profile` `.major` `.active` `.add`\* `.archive`\* `.note`\* `.update`\* `.role`\* `.semester`\* `.nickname` |
| operations | `operations.brief` `.problems` `.actions` `.announcements` `.announce`\* `.mark_read`\* `.semester` `.activity` `.open` |
| data | `data.sync_status` `.unmatched` `.match`\* |
| assistant | `assistant.help` `.greet` `.thanks` `.engine` |

A **rule** is `{ all, none, c }`: every item in `all` must hold, no item in `none` may, and the rule is worth `c`. Items are concepts (`'EVAL'`), any-of groups (`['NEED','LEFT']`), found entities (`'@date'`, `'@person'`), conversation context (`'$evaluation'`, `'$proposals'`), or literal words (`'#have'`). The best rule wins; ties go to the more specific one. Sentences that resemble a known example but match no rule can still land (similarity on concepts, with a shared-topic requirement so "who needs an eval" can never slide onto "who needs training").

**Confidence is honest.** A rule's value is multiplied by how much of the sentence she actually understood (a request that is mostly words she has no concept for is being matched on a keyword or two) and reduced for run-on compound sentences. ≥ 0.75 acts immediately; 0.5–0.75 is a guess she either hands to the local model, runs with a short caution, or turns into one question; below that she passes.

**Entity extraction** (`extract.js`), all against live Hub data:
people (full names, first names, "J Smith", aliases and saved nicknames, evaluators; two Jordans → a question; ordinary words such as *will*, *mark*, *come* never count as names unless capitalised or cued; typos only for longer, non-dictionary words; writes refuse near-miss names), dates and times (`time.js`: today, tomorrow, Friday, next Friday, this week, next week, this afternoon, tomorrow morning, Oct 12, 10/12, "in 3 days", after 2 PM …, always in the app timezone, impossible dates refused), training sessions and requirements, majors (including "comp sci", "CS", "bio"), evaluation priority ("really needs", "top priority"), status (unassigned / claimed / done), semester ("fall 2026"), counts and ordinals ("top 3", "the second one"), references ("him", "them", "that one"), pages, attendance words, quoted text.

**The Query** (`query.js`): `{ intent, filters: { dateRange, priority, major, people, limit, … }, confidence, source }`. `cleanFilters` keeps only the filters the intent declares and rejects malformed ones; dates must be real, within about two years, and no longer than a year.

**Conversation state** (`dialog.js`): `subject`, the last query, the last result set, the selected match, a pending question, plus the tools' own pointers (current person, tour, session) and the pending action. Exposed under the design's names by `view(conv)`: `currentPerson`, `currentTour`, `currentTraining`, `currentEvaluation`, `currentDateRange`, `previousResultSet`, `pendingAction`. It holds pointers, never facts; everything is re-read.

**Follow-ups** are resolved from that state, with no model: a slot-only message ("What about Thursday?", "what about Jordan?", "show me high priority", "just the unassigned", "only CS") re-runs the previous intent with that slot changed (or promotes it: a person after a schedule question becomes `schedule.person`); "the first one" picks from the last list; "more"; "why?" explains the selected match; "set it up" applies the match she just showed. Only short messages count as follow-ups, so a rambling sentence that happens to contain "Friday" is not mistaken for "what about Friday?".

**Multi-part** ("Who is touring tomorrow and who still needs evaluated?"): split at the conjunction; both halves must independently be confident and different; reads run first, a change last and still needs its confirmation.

**Teaching her a phrasing** (`phrasebook.js`): when Standard can't understand something, an administrator's browser keeps the sentence (names replaced by `{person}`; this device only; Admin → Vanessa → "Phrasings she didn't understand" → *Copy for the developer*). A developer files it under the right intent in `phrasebook.js`; the tests assert every entry resolves to its intent, so a mistake fails loudly. Nothing rewrites itself in production.

## Layer 1 — capabilities, tools and responses

Each capability module declares, per intent: `permission` (an entry of `capabilities.js`), `mode` (`read`/`write`), `confirm` (`always` for writes), `people` (how it treats names: none / optional / required / many), `params` (the filters it accepts), `promote` (where a follow-up slot goes if it can't take it), `run(query, t)` (calls typed tools through `t.call` / `t.must`) and `respond(result, query, t)` (the sentences, suggested next questions, and whether the tool's card is shown).

```js
'evaluation.opportunities': {
  permission: 'evaluations.read', mode: 'read', people: 'optional',
  params: ['dateRange', 'priority', 'major', 'limit', 'ordinal'],
  async run(q, t) { const r = await t.must('find_eval_opportunities', { …args from q.filters… }); return { d: r.data, … }; },
  respond({ d }, q, t) { return { text: 'Jordan Smith is the strongest opportunity. Jordan tours Thursday at 2 PM, and Riley Park is free to evaluate.', suggest: ['Set it up'] }; }
}
```

`checkCapabilities` (run by the tests) fails if an intent has no handler, a handler has no intent, a write doesn't require confirmation, or a permission key doesn't exist.

**Responses** are built from structured results: "14 active Tour Guides still need an evaluation this semester. Four are marked high priority." Numbers 0–9 are words in sentences, digits in cards; the same facts always give the same words (no randomness). Cards carry the detail: person, list (with per-row actions such as *Assign*), checklist, brief, draft.

**The tools** (51: 32 read, 19 change) are unchanged in principle. A tool is `{ name, description, cap, input_schema, run | prepare }`. Reads return `data` and a `card`; writes never write: `prepare` validates, resolves names, checks conflicts and returns what *would* happen plus an `execute` closure calling one `admin_*` RPC and a `verify` that re-reads. There is no tool that takes SQL; `checkRegistry` rejects a name that looks like raw database access. Free text from records passes through `untrusted()` (control characters removed, length capped). Business logic is reused: matching is `js/core/evalmatch.js` (the same engine as the Evaluation Roster's Auto-match), evaluators `js/core/evaldata.js`, training standing from `admin_training_matrix` / `my_training`, the schedule from the Schedule page's loader, the Action Center from `getActions()`. A few tools gained filters for this work: `list_eval_roster` takes a date window (and reports how many of those who need an evaluation tour in it), `find_eval_opportunities` takes `band` and `major`, and tour windows take `at_time`.

## Permissions

Four independent layers; any one refusing is enough. Standard and Enhanced use exactly the same ones:

1. **Capability check** — `can(permission, who)` before an intent runs (and the local model is only offered intents the role has). A member never gets `evaluation.assign`.
2. **Tool check** — `executeTool` re-checks the capability on every call.
3. **Row Level Security** — reads run with the person's own token. What RLS withholds is never loaded.
4. **`hub_require_admin()`** in every `admin_*` function — a hand-edited browser still can't write. `tests/node/tools.test.mjs` proves this layer is independent.

`capabilities.js` uses the same flags as the router (`is_admin`, `in_training`, `in_recruitment`). The Settings switch "Let her archive, restore and invite people" removes the people/role intents. A person sees only their own profile and training unless they have `people.read` / `training.read.people`; role changes refuse your own account and always need the explicit word "confirm".

## Confirmation

`pending.js`, `supabase/21-vanessa-agent.sql` — the same whichever way a request was understood:

- `propose`: the final parameters are deep-frozen, hashed (SHA-256 of canonical JSON) and recorded with `vanessa_begin_action`. A new proposal cancels the previous one. Expiry 10 minutes (5 for high impact).
- `confirm`: the hash is **recomputed from the frozen parameters**; `vanessa_confirm_action` refuses unless the action is pending, unexpired, owned by the caller and the hash matches. Single use.
- A bare "yes", "confirm" or "no" is matched **in code** (`handleReply`) before any understanding happens. A "yes" counts only if the proposal was the last thing said; high-impact changes need the Confirm button or the word "confirm".
- `execute` runs the `admin_*` RPC with `x-vanessa-action: <id>`; `hub_audit` believes it only if that action is confirmed, live and the caller's, then writes `admin_audit.via = 'vanessa'` ("Vanessa on behalf of …").
- `verify` re-reads and counts: done / **partial** / failed / unverified (never called done).
- Test modes (admins): *read-only* prepares nothing; *rehearse* runs the whole flow and saves nothing.

## The optional local model (Enhanced mode)

`js/core/agent/local/`. One interface, `LocalAIProvider`:

```
health(signal)  → { ok, state, models, message }      state: available | no_model | model_missing | offline | unsupported
generate({ system, user, schema?, maxTokens?, signal }) → { text, usage? }
```

Providers (`providers.js`): **Ollama** (`/api/tags`, `/api/chat` with a JSON schema), **OpenAI-style local servers** such as LM Studio or llama.cpp (`/v1/models`, `/v1/chat/completions`), and the **in-browser model** that already existed (`vanessa-llm.js`, WebGPU). Adding another runtime is one function returning that shape; nothing else changes.

- **Local only, enforced.** `checkEndpoint` accepts localhost, loopback, private ranges (10.x, 172.16–31.x, 192.168.x, 100.64/10), `*.local`, `*.lan`, `*.ts.net` and single-label hostnames, and refuses everything else, plus credentials in the URL. A hosted AI address cannot be configured. There is no key field.
- **Per computer, by an admin.** Settings are stored in this browser (`hub2.vanessa.local`), edited only on Admin → Vanessa. The one shared switch, `vanessa.mode` (`auto`/`standard`), lets an admin keep the model out of it for everyone.
- **What it is told** (`prompts.js`): the sentence, today's date, the menu of intents for *this person's role*, and a few words about the previous request. **No Hub data**: no roster, schedule, evaluations, emails or names beyond what the person typed. The reply is constrained to a JSON schema where the runtime supports it (`temperature: 0`).
- **What it can't do.** Intents outside the menu are dropped; a known intent outside the role is refused out loud by the same check as Standard. Names and dates in its answer are ignored: they are re-extracted from the person's own words. Enumerations (priority, status, limit) are accepted for reads and only if grounded in the sentence for changes. Any change it picks still only *prepares* and waits for a "yes" handled in code. Its clarifying question is stripped of markup and links.
- **Health and failure** (`index.js`): a cached 2.5-second health probe; a failed, slow (default 12 s) or unusable reply parks the model for one minute so a dead server never slows every message, and the request is answered as Standard would have. Fallback is always *local model → Standard Vanessa*, never anything with a cost.
- **Optional rewording** (off by default; `guardRephrase`): the model may reword a finished answer; the rewrite is discarded if any number changes, a name or link appears, or it grows too long.
- **Cost of a call**: nothing; it runs on the person's own machine. Everyday requests never reach it.

## Voice

Typing is always complete. Speech uses the browser's own Web Speech API (`voice.js`): recognition → the same engine → synthesised reply. There is no speech service, key or fee of ours. Where the audio is processed depends on the browser: Chrome and Edge use their vendor's free recognition service (audio leaves the device); Safari recognises on the device. Where the browser supports it, the panel offers **Keep speech on this device** (`recognition.processLocally`). Speech output is `speechSynthesis` — local — and optional.

## Observability

Per turn (content-free): engine (`standard` / `enhanced` / `legacy`), intent, confidence, local-model calls, whether the model was unavailable, tools used and failed, latency, route. Kept in memory (`engine/metrics.js`) and logged to `vanessa_turns` through `vanessa_log_turn`; Admin → Vanessa shows both. No question text or answer is stored anywhere. Unrecognised phrasings are kept only in the admin's own browser (see "Teaching her a phrasing").

## Security

- **No paid dependency anywhere.** `tests/tools/check.mjs` fails the build if app code, `config.js`, `package.json` or a migration references a hosted-AI host, SDK or API key, or if a `supabase/functions/vanessa` reappears.
- **No raw SQL, no arbitrary code.** The only way to touch data is a typed tool; the only way to change data is an `admin_*` RPC after a confirmation.
- **Prompt injection.** Records, spreadsheets, announcements and notes are untrusted. In Standard mode they are never interpreted: she reports them. With a local model they never reach it (it sees only the person's sentence). Even a manipulated model could only *prepare* a change that the person must confirm.
- **A model's output is untrusted even when local.** Validated for intent, role, filters, dates and ids; names and dates never come from it.
- **Privacy.** Roster, schedule, evaluation and training data are not sent to any AI service. With a local model the only thing it receives is what the person typed.
- Not defended: an administrator asking Vanessa to do something an administrator may do. That is intended: it is confirmed and audited.

## Failure handling

| What fails | What happens |
|---|---|
| No local model, or it is switched off | Nothing visible. Standard handles everything it understands |
| Local model offline / slow / garbled | That request is answered as Standard would; the model is parked for a minute; Admin → Vanessa says "Offline — Vanessa is using standard mode" |
| A message she doesn't understand | Best guess with a caution, or one short question, or her older built-in answers (handbook etc.) |
| A tool fails | A plain sentence; the failure is counted; the same failing call is never retried silently |
| Schedule / sheet unavailable | "The tour schedule isn't loading right now, so I can't check that." The brief says what it left out |
| A write is refused by the database | Translated message, "nothing was reported as done", pending cleared, outcome recorded |
| Partial write | Exact counts and the reason; offer to retry the rest |

## Setting up

Standard Vanessa: nothing. Run `supabase/21-vanessa-agent.sql` once (after 18, 19, 20) so confirmations are recorded and the usage page has numbers. It is safe to run twice and safe to run on top of the earlier version of that file.

Enhanced Vanessa (optional): `LOCAL_AI_SETUP.md`.

## Adding things

**A tool**: pick/add a capability in `capabilities.js`; add the tool to `tools/*.js` (reads `run`, changes `writeTool({ …, prepare })` returning `execute`, `verify`, `receipt`, `risk`); keep `input_schema` tight; resolve people with `personFrom(ctx, q, { write: true })`; wrap record text in `untrusted()`.

**An intent** (the usual way to add a capability): (1) add `def('area.thing', 'label', [rules], [examples])` in `engine/intents.js`; (2) add `'area.thing': { permission, mode, people, params, run, respond }` to the matching `capabilities/*.js`; (3) add phrases to the corpus in `tests/node/intents.test.mjs` and a conversation to `engine.test.mjs`. `checkCapabilities` and the example test fail until both halves exist and agree.

**A vocabulary word**: add it to a group in `lexicon.js` (or a phrase rule). **A new way of asking**: `phrasebook.js`.

**A local runtime**: a function in `local/providers.js` returning `{ name, health, generate }`, registered in `createProvider`.

## Testing

```
npm test                                   # 279 offline tests, under a second:
                                           #   intents.test.mjs  161  the corpus: ~150 phrasings → intent, entities, dates, names
                                           #   engine.test.mjs    28  Standard mode end to end on a fake Hub: follow-ups, writes, permissions,
                                           #                          brief, outages, "no network", metrics
                                           #   local.test.mjs     26  Enhanced mode against a fake Ollama: flexible phrasing, ambiguity,
                                           #                          multi-part, capability selection, validation, outage → Standard, timeouts,
                                           #                          local-only endpoints, no Hub data sent, rewording guard
                                           #   tools.test.mjs     31  the typed tools, the permission layers, the confirmation system
                                           #   pure.test.mjs / voice-format.test.mjs   time, schema, names, roles, registry, formatting, voice
npm run check                              # parses every JS file, resolves every import, safety + "no paid AI" rules
node supabase/tests/vanessa-agent.test.mjs # 42 checks against in-memory Postgres (needs @electric-sql/pglite)
# browser: tests/preview.html?agent=standard | local | down   (a pretend Ollama; see preview-stub.js)
```

Standard-mode tests install a `fetch` that fails the test on any network use. Enhanced-mode tests assert every request went to the local endpoint.

**What these prove, and don't.** They prove the plumbing and the guarantees: no change without a yes, no unpermitted tool, no fake success, nothing leaves the machine, a failing model never breaks Vanessa. They do **not** prove how well a real small model interprets odd phrasing; that depends on the model chosen and needs real use (Admin → Vanessa shows how often she is understood and which phrasings she missed).

## Debugging

- **"Offline — using standard mode"** → Admin → Vanessa → *Test Vanessa Engine* says why (not running, model not installed, address not allowed, too slow).
- **A tool seems broken** → *Test the tools* runs every read tool against live data. The page also lists failing tools from `vanessa_turns`.
- **She didn't understand something** → it is on the "Phrasings she didn't understand" list on that admin's computer; add it to `phrasebook.js`.
- **She understood it wrongly** → reproduce in `tests/node/intents.test.mjs`; adjust the rule (`none` lists are the usual fix), keep the corpus green. `rank()` returns the rule that fired (`via`).
- **A change didn't save** → the receipt says why. `vanessa_actions` shows the status; Admin → Activity shows confirmed changes labelled "Vanessa on behalf of …".

## Known gaps

- Tour **coverage cannot be assigned**: the schedule is a Google Sheet the Hub reads but cannot write. She finds who is free and says so. Only tour slots with a guide on them appear in the data, so a completely empty slot is invisible.
- The schedule data has no **tour type**; she recognises "group tour", "info session" and the like, says the schedule doesn't label them, and shows every tour.
- Evaluator availability is "no existing booking and not paused"; classes and personal availability are not known, and she says so.
- No reminder scheduler or email. She drafts text for copying.
- Standard Vanessa is rule-based: unusual phrasing she has no concept for is passed on (to the local model, or to her older answers). That is by design; the phrasebook is the way to improve it.
- Enhanced quality depends on the local model; small models (1–3B) are good at picking from a menu and weak at everything else, which is all she asks of them.
- Browser speech recognition is the browser vendor's; "keep speech on this device" works only where the browser offers it.
