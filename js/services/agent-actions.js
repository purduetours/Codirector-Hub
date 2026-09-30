import { rpc, select } from '../core/db.js';
import { state, inTraining } from '../core/state.js';
import { invalidateWorkspace } from './workspace.js';
export async function agentAction(action,parameters,requestId){
 if(!state.me)throw Error('Sign in to use Vanessa.');
 if(action.startsWith('evaluation.')&&!inTraining())throw Error('Evaluation access required.');
 if(!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestId||''))throw Error('A valid request identity is required.');
 const owner=state.me.id,version=state.sessionVersion;
 const saved=await rpc('hub_agent_action',{p_request_id:requestId,p_action:action,p_params:parameters});
 if(!saved?.id||!saved.created_at||saved.action!==action||!saved.result)throw Error('The server did not confirm this action. Retry this task to check its status.');
 if(owner!==state.me?.id||version!==state.sessionVersion)throw Error('Your account changed.');
 if(action.startsWith('evaluation.')&&Object.hasOwn(saved.result,'evaluator_id')){
  const r=saved.result,g=state.guides.find(g=>g.id===r.id);
  if(g)Object.assign(g,{evaluatorId:r.evaluator_id,evaluator:r.evaluator_id===owner?state.me.full_name:'',date:r.tour_date||'',time:(r.tour_time||'').slice(0,5),claimedAt:r.claimed_at||'',submitted:!!r.submitted_at,status:r.evaluator_id?'claimed':'open'});
  state.loadedAt=null;
 }
 invalidateWorkspace();return saved;
}
export function agentHistory({limit=20,offset=0}={}){
 if(!state.me)throw Error('Sign in to view your action history.');
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw Error('Invalid history page.');
 return select('hub_agent_actions',`select=id,action,summary,created_at,eval_id,result&order=created_at.desc,id.desc&limit=${limit}&offset=${offset}`);
}
