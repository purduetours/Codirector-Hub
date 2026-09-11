import { createReminderHandler } from './worker.js';
Deno.serve(createReminderHandler({env:(key:string)=>Deno.env.get(key)}));
