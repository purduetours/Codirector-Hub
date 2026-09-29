import { go } from './router.js';
import { queueOpenEval } from '../modules/evals.js';
export function openNotification(n){
 if(!n || !['evals','reminders','activity'].includes(n.route))return;
 if(n.eval_id)queueOpenEval(n.eval_id);
 go(n.reminder_id?`reminders?item=${encodeURIComponent(n.reminder_id)}`:n.route);
}
