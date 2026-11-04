-- Re-Love messaging realtime, idempotency, inbox aggregation, and push delivery.
-- Review and apply after 001_initial.sql through 004_listing_photo_display.sql.

alter table public.messages add column if not exists client_action_id uuid;
create unique index if not exists messages_sender_action_unique
  on public.messages(sender_id, client_action_id) where client_action_id is not null;
create index if not exists messages_thread_order_idx on public.messages(thread_id, created_at desc, id desc);
create index if not exists messages_recipient_unread_order_idx
  on public.messages(recipient_id, created_at desc, id desc) where read_at is null;

grant insert (client_action_id) on public.messages to authenticated;

create or replace function public.mark_thread_read(p_thread_id uuid, p_through_created_at timestamptz, p_through_id uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare changed integer;
begin
  if not exists(select 1 from public.threads where id=p_thread_id and (buyer_id=auth.uid() or seller_id=auth.uid())) then
    raise exception 'Thread not found or unavailable';
  end if;
  update public.messages set read_at=now()
   where thread_id=p_thread_id and recipient_id=auth.uid() and read_at is null
     and (created_at < p_through_created_at or (created_at = p_through_created_at and id <= p_through_id));
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.mark_thread_read(uuid,timestamptz,uuid) from public;
grant execute on function public.mark_thread_read(uuid,timestamptz,uuid) to authenticated;

create or replace function public.get_inbox(p_limit integer default 100)
returns table(
  id uuid, listing_id uuid, buyer_id uuid, seller_id uuid, updated_at timestamptz,
  listing_title text, listing_image_url text, listing_price_inr integer, listing_status text,
  participant_id uuid, participant_display_name text, participant_avatar_url text, participant_hostel_block text,
  last_body text, last_created_at timestamptz, last_sender_id uuid, unread_count bigint
)
language sql stable security invoker set search_path=public as $$
  select t.id,t.listing_id,t.buyer_id,t.seller_id,t.updated_at,
    coalesce(l.title,'Listing unavailable'),coalesce(l.image_url,'/icons/icon-192.png'),coalesce(l.price_inr,0),coalesce(l.status,'hidden'),
    p.id,coalesce(p.display_name,'Unknown'),p.avatar_url,p.hostel_block,
    lm.body,lm.created_at,lm.sender_id,
    count(m.id) filter(where m.recipient_id=auth.uid() and m.read_at is null)::bigint
  from public.threads t
  left join public.listings l on l.id=t.listing_id
  left join public.profiles p on p.id=case when t.buyer_id=auth.uid() then t.seller_id else t.buyer_id end
  left join lateral (
    select body,created_at,sender_id from public.messages
    where thread_id=t.id order by created_at desc,id desc limit 1
  ) lm on true
  left join public.messages m on m.thread_id=t.id and m.recipient_id=auth.uid() and m.read_at is null
  where t.buyer_id=auth.uid() or t.seller_id=auth.uid()
  group by t.id,l.id,p.id,lm.body,lm.created_at,lm.sender_id
  order by t.updated_at desc,t.id desc limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.get_inbox(integer) from public;
grant execute on function public.get_inbox(integer) to authenticated;

-- Supabase Realtime applies table RLS to authenticated Postgres Changes.
do $$
begin
  if to_regclass('pg_catalog.pg_publication') is not null
     and exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_catalog.pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='messages'
     ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check(char_length(endpoint) between 20 and 2000),
  p256dh text not null check(char_length(p256dh) between 20 and 300),
  auth text not null check(char_length(auth) between 8 and 200),
  version uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revoked_at timestamptz
);
create index if not exists push_subscriptions_user_active_idx on public.push_subscriptions(user_id) where revoked_at is null;
alter table public.push_subscriptions enable row level security;
drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions" on public.push_subscriptions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.push_subscriptions from anon,authenticated;
grant select on public.push_subscriptions to authenticated;
grant insert(user_id,endpoint,p256dh,auth) on public.push_subscriptions to authenticated;
grant update(p256dh,auth,version,updated_at,revoked_at) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(), message_id uuid not null references public.messages(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade, recipient_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade, subscription_version uuid not null,
  status text not null default 'pending' check(status in('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0 check(attempts between 0 and 5), next_attempt_at timestamptz not null default now(),
  lease_owner uuid, lease_expires_at timestamptz, last_status integer, created_at timestamptz not null default now(), sent_at timestamptz,
  unique(message_id,subscription_id)
);
create index if not exists push_outbox_due_idx on public.push_outbox(next_attempt_at,created_at) where status in('pending','sending');
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon,authenticated;
grant select,update on public.push_outbox to service_role;
grant select,insert,update,delete on public.push_subscriptions to service_role;
grant select on public.messages to service_role;

create or replace function public.enqueue_message_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.push_outbox(message_id,thread_id,recipient_id,subscription_id,subscription_version)
  select new.id,new.thread_id,new.recipient_id,s.id,s.version from public.push_subscriptions s
   where s.user_id=new.recipient_id and s.revoked_at is null
   order by s.updated_at desc limit 5 on conflict do nothing;
  return new;
end $$;
drop trigger if exists messages_enqueue_push on public.messages;
create trigger messages_enqueue_push after insert on public.messages for each row execute function public.enqueue_message_push();
revoke all on function public.enqueue_message_push() from public;

create or replace function public.claim_push_outbox(p_limit integer,p_lease_owner uuid)
returns setof public.push_outbox language plpgsql security definer set search_path='' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  return query update public.push_outbox o set status='sending',attempts=o.attempts+1,lease_owner=p_lease_owner,lease_expires_at=now()+interval '2 minutes'
   where o.id in(select id from public.push_outbox where attempts<5 and next_attempt_at<=now() and (status='pending' or (status='sending' and lease_expires_at<now())) order by next_attempt_at,created_at for update skip locked limit least(greatest(p_limit,1),50)) returning o.*;
end $$;
create or replace function public.complete_push_outbox(p_id uuid,p_lease_owner uuid,p_result text,p_status integer default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.push_outbox set
    status=case when p_result='sent' then 'sent' when p_result='cancelled' then 'cancelled' when attempts>=5 then 'failed' else 'pending' end,
    next_attempt_at=case when p_result='retry' and attempts<5 then now()+make_interval(secs=>least(3600,30*(2^attempts))) else next_attempt_at end,
    sent_at=case when p_result='sent' then now() else sent_at end,last_status=p_status,lease_owner=null,lease_expires_at=null
   where id=p_id and status='sending' and lease_owner=p_lease_owner;
  if not found then raise exception 'lease mismatch'; end if;
end $$;
revoke all on function public.claim_push_outbox(integer,uuid),public.complete_push_outbox(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_push_outbox(integer,uuid),public.complete_push_outbox(uuid,uuid,text,integer) to service_role;

