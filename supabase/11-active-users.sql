-- Names only. Visible/active tabs heartbeat every 30 seconds; expiry is 90 seconds.
begin;
create table if not exists public.hub_presence (
 member_id uuid not null references public.members(id) on delete cascade,
 tab_id uuid not null,seen_at timestamptz not null default now(),primary key(member_id,tab_id)
);
alter table public.hub_presence enable row level security;
revoke all on public.hub_presence from public,anon,authenticated;
create or replace function public.hub_heartbeat(p_tab uuid,p_active boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.is_member() then raise exception 'Active hub account required';end if;
 if p_tab is null then raise exception 'Tab ID required';end if;
 delete from public.hub_presence where seen_at<now()-interval '90 seconds';
 if p_active then
  if (select count(*) from public.hub_presence where member_id=auth.uid())>=20
   and not exists(select 1 from public.hub_presence where member_id=auth.uid() and tab_id=p_tab)
   then raise exception 'Too many active tabs';end if;
  insert into public.hub_presence(member_id,tab_id,seen_at) values(auth.uid(),p_tab,now())
   on conflict(member_id,tab_id) do update set seen_at=excluded.seen_at;
 else delete from public.hub_presence where member_id=auth.uid() and tab_id=p_tab;
 end if;
end $$;
create or replace function public.hub_active_users() returns table(member_id uuid,full_name text)
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.is_member() then raise exception 'Active hub account required';end if;
 return query select m.id,m.full_name from public.members m where m.active
 and exists(select 1 from public.hub_presence p where p.member_id=m.id and p.seen_at>now()-interval '90 seconds')
 order by m.full_name,m.id;
end $$;
revoke all on function public.hub_heartbeat(uuid,boolean),public.hub_active_users() from public,anon;
grant execute on function public.hub_heartbeat(uuid,boolean),public.hub_active_users() to authenticated;
commit;
