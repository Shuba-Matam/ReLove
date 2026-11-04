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

