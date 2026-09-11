-- Run LAST, after REMINDERS-SETUP.md. This activates real automatic email.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
 if not exists(select 1 from public.tour_reminder_settings s
 join public.members m on m.id=s.owner_id and m.active
 join auth.users u on u.id=m.id and u.email_confirmed_at is not null
 where s.from_email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 and s.hub_url ~ '^https://[^[:space:]]+$') then
 raise exception 'Configure the verified owner account, sender email and hub URL first. See REMINDERS-SETUP.md.';end if;
 if (select count(*) from vault.decrypted_secrets where name='hub_reminder_project_url' and decrypted_secret ~ '^https://[^/[:space:]]+$')<>1
 or (select count(*) from vault.decrypted_secrets where name='hub_reminder_cron_secret' and length(decrypted_secret)>=32)<>1 then
 raise exception 'Add the two reminder Vault secrets first. See REMINDERS-SETUP.md.';end if;
end $$;
select cron.schedule('hub-tour-reminders','*/5 * * * *',$job$
 select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='hub_reminder_project_url')||'/functions/v1/tour-reminders',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
 (select decrypted_secret from vault.decrypted_secrets where name='hub_reminder_cron_secret')),
 body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
update public.tour_reminder_settings set enabled=true where singleton;
commit;
