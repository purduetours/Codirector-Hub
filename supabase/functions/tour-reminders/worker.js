// Server only. HTTP request bodies cannot select recipients or email content.
export function createReminderHandler({env,fetcher=fetch}){
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 return async request=>{
  if(request.method!=='POST')return reply(405,{error:'POST required'});
  const secret=env('REMINDER_CRON_SECRET');
  if(!secret||secret.length<32||request.headers.get('Authorization')!==`Bearer ${secret}`)return reply(401,{error:'Unauthorized'});
  const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY'),emailKey=env('RESEND_API_KEY');
  if(!url||!key||!emailKey)return reply(503,{error:'Reminder service is not configured'});
  async function rpc(name,body={}){
   const r=await fetcher(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('Database operation failed');return r.json();
  }
  let accepted=0,failed=0,retrying=0;
  try{
   await rpc('queue_tour_reminders');
   // Three jobs cap worst-case request time to roughly 100 seconds.
   for(let i=0;i<3;i++){
    const job=await rpc('claim_tour_reminder');if(!job)break;
    let status='pending',provider=null,error=null;
    try{
     const r=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${emailKey}`,'Content-Type':'application/json','Idempotency-Key':`tour-reminder/${job.id}`},body:JSON.stringify(job.payload),signal:AbortSignal.timeout(10000)});
     if(r.ok){const data=await r.json();if(!data.id)throw Error('Missing confirmation');status='accepted';provider=data.id;}
     else {status=r.status===429||r.status>=500||r.status===409?'pending':'failed';error=`Email provider HTTP ${r.status}`;}
    }catch{error='Email provider confirmation unavailable';}
    if(!await rpc('finish_tour_reminder',{p_id:job.id,p_lease:job.lease_id,p_status:status,p_provider:provider,p_error:error}))throw Error('Could not record provider result');
    if(status==='accepted')accepted++;else if(status==='failed')failed++;else retrying++;
   }
   return reply(200,{accepted,failed,retrying});
  }catch{return reply(503,{error:'Reminder processing incomplete; inspect delivery status',accepted,failed,retrying});}
 };
}
