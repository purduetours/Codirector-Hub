import test from 'node:test';
import assert from 'node:assert/strict';
import { completion, aggregate, matches, panelProgress } from '../../js/modules/interviews/model.js';
import { createAutosave } from '../../js/modules/interviews/autosave.js';
const value=(n,note='')=>({scores:{spk:n,per:n,imp:n},note});
const storage=()=>{const m=new Map();return{getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('completion validates every criterion and optional comments',()=>{
 assert.equal(completion().status,'Not Started');assert.equal(completion({},'note').status,'In Progress');
 assert.deepEqual(completion({spk:3}).missing,['per','imp']);assert.equal(completion(value(5).scores).status,'Complete');
 for(const n of [0,6,2.5,'4',NaN])assert.equal(completion({...value(3).scores,spk:n}).status,'In Progress');
});
test('aggregate preserves criterion means and partial scores',()=>{
 assert.deepEqual(aggregate({id1:{spk:5,per:1,imp:3},id2:{spk:1}}),{spk:3,per:1,imp:3,final:7/3,raters:2});
 assert.equal(aggregate({notes:{}}).raters,0);assert.equal(aggregate({}).final,null);
});
test('panel completeness counts assigned IDs independently of historical scores',()=>{
 const c={scores:{a:value(4).scores,b:{spk:3},former:value(5).scores}};
 assert.deepEqual(panelProgress(c,['a','b','missing']),{complete:1,expected:3,missing:['b','missing']});assert.equal(aggregate(c.scores).raters,3);
});
test('forgiving search matches accents and reordered words',()=>{assert.ok(matches({name:'José Maria Smith'},'smith jose'));assert.ok(!matches({name:'Jose'},'Joan'))});
test('rapid edits debounce into latest snapshot',async()=>{
 const writes=[],q=createAutosave({write:async(...v)=>writes.push(v),delay:10});q.get('a',value(null));q.edit('a',value(1));q.edit('a',value(5,'latest'));
 await new Promise(r=>setTimeout(r,30));assert.deepEqual(writes,[['a',value(5,'latest')]]);assert.equal(q.pending(),false);q.stop();
});
test('pending writes serialize newer edits without fake success',async()=>{
 let release;const writes=[],q=createAutosave({delay:10000,write:async(_,v)=>{writes.push(v);if(writes.length===1)await new Promise(r=>release=r)}});
 q.get('a',value(null));q.edit('a',value(1));const flight=q.flush('a');q.edit('a',value(5));assert.ok(q.pending());release();await flight;
 assert.deepEqual(writes,[value(1),value(5)]);assert.equal(q.entries.get('a').state,'saved');q.stop();
});
test('candidate switching isolates queues and comments',async()=>{
 const writes=[],q=createAutosave({delay:10000,write:async(...v)=>writes.push(v)});
 for(const id of ['a','b']){q.get(id,value(null));q.edit(id,value(3,id))}await q.flushAll();assert.deepEqual(writes,[['a',value(3,'a')],['b',value(3,'b')]]);q.stop();
});
test('failed saves retain drafts until successful retry',async()=>{
 const store=storage();let fail=true;const q=createAutosave({storage:store,namespace:'owner/',delay:10000,write:async()=>{if(fail)throw Error()}});
 q.get('a',value(null));q.edit('a',value(4,'keep'));await q.flush('a');assert.equal(q.entries.get('a').state,'error');assert.equal(JSON.parse(store.getItem('owner/a')).note,'keep');
 fail=false;await q.flush('a');assert.equal(q.pending(),false);assert.equal(store.getItem('owner/a'),undefined);q.stop();
});
test('recovered drafts require explicit retry',async()=>{
 const store=storage();store.setItem('x/a',JSON.stringify(value(2,'recovered')));let calls=0;const q=createAutosave({storage:store,namespace:'x/',write:async()=>calls++});
 assert.equal(q.get('a',value(5)).state,'recovered');await q.flushAll();assert.equal(calls,0);await q.flush('a');assert.equal(calls,1);q.stop();
});
test('account namespaces and stop prevent cross-account saves',async()=>{
 const store=storage();store.setItem('alice/a',JSON.stringify(value(2)));let calls=0;const q=createAutosave({storage:store,namespace:'bob/',delay:5,write:async()=>calls++});
 assert.equal(q.get('a',value(5)).value.scores.spk,5);q.edit('a',value(3));q.stop();await new Promise(r=>setTimeout(r,20));assert.equal(calls,0);
});
test('storage failure retains edits in memory',async()=>{
 const q=createAutosave({storage:{setItem(){throw Error()}},write:async()=>{throw Error()}});q.get('a',value(null));q.edit('a',value(2,'still here'));await q.flush('a');
 assert.equal(q.entries.get('a').durable,false);assert.equal(q.entries.get('a').value.note,'still here');q.stop();
});
