/* Short-lived, account-bound context. Never restored into another sign-in. */
import { state } from './state.js';
const TTL = 20 * 60e3;
let owner = '', context = null, receipts = [], pending = null, draft = null;
const key = () => `${state.me?.id || ''}:${state.sessionVersion}`;
function check() {
  if (owner !== key()) resetConversation();
  if (context && Date.now() - context.at > TTL) context = null;
  if (pending && Date.now() - pending.at > TTL) pending = null;
}
export function resetConversation() { owner = key(); context = null; receipts = []; pending = null; draft = null; }
export function rememberConversation(topic, person = null) { check(); context = { topic, person, at: Date.now() }; }
export function conversationContext() { check(); return context && { ...context }; }
export function rememberReceipt(receipt) { check(); receipts.unshift({ ...receipt, owner: key(), at: Date.now() }); receipts = receipts.slice(0, 15); return receipts[0]; }
export function recentReceipts() { check(); return receipts.filter(r => !r.undone); }
export function ownsReceipt(receipt) { check(); return receipt.owner === key() && !!state.me; }
export function waitForReview(plan) { check(); pending = { plan, at: Date.now() }; return plan; }
export function clearReview() { pending = null; }
export function pendingReview() { check(); return pending?.plan || null; }
export function rememberDraft(value) { check(); draft = value; return value; }
export function currentDraft() { check(); return draft; }
