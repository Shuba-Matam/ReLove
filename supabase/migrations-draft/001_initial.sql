-- Re-Love initial schema — REVIEW DRAFT
-- Owner approved the agreed schema on November 1, 2026. The sole release integrator owns final scope review and remote application.
-- This file is for local review only. Do not contact or apply to remote DB; do not read .env.local secrets.

-- ============================================================================
-- Tables
-- ============================================================================

-- Profiles: one per auth user, public safe cols only (no email)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) >= 2 and char_length(display_name) <= 60),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  hostel_block text check (hostel_block is null or char_length(hostel_block) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_display_name_idx on public.profiles (display_name);
create index if not exists profiles_hostel_block_idx on public.profiles (hostel_block);

-- Categories: fixed ids from src/lib/marketplace.ts CATEGORIES
create table if not exists public.categories (
  id uuid primary key,
  slug text not null unique check (char_length(slug) >= 1 and char_length(slug) <= 50),
  name text not null check (char_length(name) >= 1 and char_length(name) <= 100),
  icon text not null check (char_length(icon) >= 1 and char_length(icon) <= 50)
);
create index if not exists categories_slug_idx on public.categories (slug);

-- Listings: original source image path/url ownership, FTS, status active/sold/hidden
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  title text not null check (char_length(title) >= 3 and char_length(title) <= 100),
  description text not null check (char_length(description) >= 10 and char_length(description) <= 3000),
  price_inr integer not null check (price_inr >= 0 and price_inr <= 10000000),
  condition text not null check (condition in ('new','like_new','good','fair')),
  hostel_block text not null check (char_length(hostel_block) >= 1 and char_length(hostel_block) <= 60),
  status text not null default 'active' check (status in ('active','sold','hidden')),
  image_path text not null check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  image_url text not null check (char_length(image_url) >= 10 and char_length(image_url) <= 1000),
  cutout_path text,
  cutout_url text check (cutout_url is null or char_length(cutout_url) <= 1000),
  tags text[] not null default '{}'::text[] check (array_length(tags,1) is null or array_length(tags,1) <= 12),
  ai_status text not null default 'none' check (ai_status in ('none','pending','done','failed')),
  search tsvector,
  constraint cutout_path_owner check (cutout_path is null or cutout_path like seller_id::text || '/%'),
  constraint listing_image_url_shape check (image_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/storage/v1/object/public/listing-images/' and right(image_url, length(image_path)) = image_path),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listings_seller_id_idx on public.listings (seller_id);
create index if not exists listings_category_id_idx on public.listings (category_id);
create index if not exists listings_status_idx on public.listings (status);
create index if not exists listings_price_inr_idx on public.listings (price_inr);
create index if not exists listings_created_at_idx on public.listings (created_at desc);
create index if not exists listings_hostel_block_idx on public.listings (hostel_block);
create index if not exists listings_image_path_idx on public.listings (image_path);
create index if not exists listings_search_idx on public.listings using gin (search);
create index if not exists listings_tags_idx on public.listings using gin (tags);

-- Threads: buyer initiates, seller owns listing; race-safe unique per buyer/listing
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint threads_buyer_not_seller check (buyer_id != seller_id)
);
create unique index if not exists threads_listing_buyer_unique on public.threads (listing_id, buyer_id);
create index if not exists threads_buyer_id_idx on public.threads (buyer_id);
create index if not exists threads_seller_id_idx on public.threads (seller_id);
create index if not exists threads_updated_at_idx on public.threads (updated_at desc);

-- Messages: validate sender+recipient against immutable thread, no arbitrary update other than own received read_at
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz check (read_at is null or read_at >= created_at),
  constraint messages_sender_not_recipient check (sender_id != recipient_id)
);
create index if not exists messages_thread_id_created_idx on public.messages (thread_id, created_at);
create index if not exists messages_recipient_read_idx on public.messages (recipient_id, read_at) where read_at is null;
create index if not exists messages_sender_id_idx on public.messages (sender_id);

-- Reports: insert only
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('prohibited','misleading','spam','other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists reports_listing_id_idx on public.reports (listing_id);
create index if not exists reports_reporter_id_idx on public.reports (reporter_id);

-- ============================================================================
-- Triggers & functions
-- ============================================================================

-- Updated_at auto
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.handle_updated_at();
drop trigger if exists listings_updated_at on public.listings;
create trigger listings_updated_at before update on public.listings for each row execute function public.handle_updated_at();
drop trigger if exists threads_updated_at on public.threads;
create trigger threads_updated_at before update on public.threads for each row execute function public.handle_updated_at();

-- FTS: listings search vector from title + description + tags
create or replace function public.listings_search_trigger()
returns trigger language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('english', coalesce(new.title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.description,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(new.tags,' '),'')), 'C');
  return new;
end;
$$;

drop trigger if exists listings_search_update on public.listings;
create trigger listings_search_update before insert or update of title, description, tags on public.listings
  for each row execute function public.listings_search_trigger();

-- Seller ids immutable via triggers (column grants alternative)
create or replace function public.prevent_listing_seller_change()
returns trigger language plpgsql as $$
begin
  if old.seller_id is distinct from new.seller_id or old.id is distinct from new.id or old.created_at is distinct from new.created_at then
    raise exception 'seller_id is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists listings_seller_immutable on public.listings;
create trigger listings_seller_immutable before update on public.listings for each row execute function public.prevent_listing_seller_change();

create or replace function public.prevent_thread_immutable()
returns trigger language plpgsql as $$
begin
  if old.listing_id is distinct from new.listing_id or old.buyer_id is distinct from new.buyer_id or old.seller_id is distinct from new.seller_id then
    raise exception 'thread participants and listing are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists threads_immutable on public.threads;
create trigger threads_immutable before update on public.threads for each row execute function public.prevent_thread_immutable();

-- Messages: validate sender+recipient against immutable thread
create or replace function public.validate_message_thread()
returns trigger language plpgsql as $$
declare
  t_buyer uuid;
  t_seller uuid;
begin
  select buyer_id, seller_id into t_buyer, t_seller from public.threads where id = new.thread_id;
  if not found then
    raise exception 'Thread % not found', new.thread_id;
  end if;
  if not ((new.sender_id = t_buyer and new.recipient_id = t_seller) or (new.sender_id = t_seller and new.recipient_id = t_buyer)) then
    raise exception 'Sender/recipient must match thread participants';
  end if;
  if new.sender_id != auth.uid() then
    raise exception 'Sender must be authenticated user';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_validate_thread on public.messages;
create trigger messages_validate_thread before insert on public.messages for each row execute function public.validate_message_thread();

create or replace function public.enforce_message_update_only_read_at()
returns trigger language plpgsql as $$
begin
  -- No arbitrary update other than own received read_at
  if old.id is distinct from new.id or old.thread_id is distinct from new.thread_id
     or old.sender_id is distinct from new.sender_id
     or old.recipient_id is distinct from new.recipient_id
     or old.body is distinct from new.body
     or old.created_at is distinct from new.created_at then
    raise exception 'Only read_at may be updated on messages';
  end if;
  if new.read_at is distinct from old.read_at then
    if old.read_at is not null then
      raise exception 'Message already marked read';
    end if;
    if new.recipient_id != auth.uid() then
      raise exception 'Only recipient may mark as read';
    end if;
    if new.read_at is null then
      raise exception 'read_at cannot be set to null';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists messages_enforce_read_at on public.messages;
create trigger messages_enforce_read_at before update on public.messages for each row execute function public.enforce_message_update_only_read_at();

-- Bump thread updated_at on new message
create or replace function public.bump_thread_updated_at()
returns trigger language plpgsql as $$
begin
  update public.threads set updated_at = now() where id = new.thread_id;
  return new;
end;
$$;
drop trigger if exists messages_bump_thread on public.messages;
create trigger messages_bump_thread after insert on public.messages for each row execute function public.bump_thread_updated_at();

-- Signup trigger: auto-create profile on auth.users insert (production auth.users)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,display_name,avatar_url)
 values(new.id, case when length(btrim(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',''))) >= 2 then left(btrim(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name','')),60) else 'Campus member' end,
 case when new.raw_user_meta_data->>'avatar_url' ~ '^https://' and length(new.raw_user_meta_data->>'avatar_url') <= 500 then new.raw_user_meta_data->>'avatar_url' else null end)
 on conflict(id) do nothing;
 return new;
end; $$;
drop trigger if exists relove_on_auth_user_created on auth.users;
create trigger relove_on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;

-- Profiles: public safe cols (app selects only safe cols), owner can update own
drop policy if exists "Public profiles are viewable" on public.profiles;
create policy "Public profiles are viewable" on public.profiles for select using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert with check (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Categories: public read
drop policy if exists "Categories are viewable by all" on public.categories;
create policy "Categories are viewable by all" on public.categories for select using (true);

-- Listings: anon reads active+sold, owner sees hidden; authenticated own writes with image_path own prefix
drop policy if exists "Anon can view active and sold listings" on public.listings;
create policy "Anon can view active and sold listings" on public.listings for select to anon using (status in ('active','sold'));

drop policy if exists "Authenticated can view active sold or own hidden" on public.listings;
create policy "Authenticated can view active sold or own hidden" on public.listings for select to authenticated using (status in ('active','sold') or (status = 'hidden' and seller_id = auth.uid()));

drop policy if exists "Authenticated can create own listing" on public.listings;
create policy "Authenticated can create own listing" on public.listings for insert to authenticated with check (
  seller_id = auth.uid()
  and image_path like auth.uid()::text || '/%'
);

drop policy if exists "Owner can update own listing" on public.listings;
create policy "Owner can update own listing" on public.listings for update to authenticated using (seller_id = auth.uid()) with check (
  seller_id = auth.uid()
  and image_path like auth.uid()::text || '/%'
);

drop policy if exists "Owner can delete own listing" on public.listings;
create policy "Owner can delete own listing" on public.listings for delete to authenticated using (seller_id = auth.uid());

-- Threads: participants only; insert binds seller_id to actual listing seller and requires active listing
drop policy if exists "Participants can view own threads" on public.threads;
create policy "Participants can view own threads" on public.threads for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());

drop policy if exists "Buyer can create thread" on public.threads;
create policy "Buyer can create thread" on public.threads for insert to authenticated with check (
  buyer_id = auth.uid()
  and seller_id = (select seller_id from public.listings where id = listing_id)
  and exists (select 1 from public.listings where id = listing_id and status = 'active')
  and buyer_id != seller_id
);

drop policy if exists "Participants can update thread timestamp" on public.threads;
create policy "Participants can update thread timestamp" on public.threads for update to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid()) with check (buyer_id = auth.uid() or seller_id = auth.uid());

-- Messages: participants only
drop policy if exists "Participants can view messages" on public.messages;
create policy "Participants can view messages" on public.messages for select to authenticated using (
  exists (select 1 from public.threads t where t.id = messages.thread_id and (t.buyer_id = auth.uid() or t.seller_id = auth.uid()))
);

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists (select 1 from public.threads t where t.id = messages.thread_id and ((t.buyer_id = sender_id and t.seller_id = recipient_id) or (t.seller_id = sender_id and t.buyer_id = recipient_id)))
);

drop policy if exists "Recipient can mark read" on public.messages;
create policy "Recipient can mark read" on public.messages for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Reports: insert only
drop policy if exists "Authenticated can report" on public.reports;
create policy "Authenticated can report" on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- ============================================================================
-- Storage bucket listing-images: public-read own-folder upload/remove (delete unreferenced only via API), MIME/size restrictions
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 2097152, array['image/jpeg','image/png','image/webp','image/jpg'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/jpg'];

drop policy if exists "Public can view listing images" on storage.objects;
create policy "Public can view listing images" on storage.objects for select using (bucket_id = 'listing-images');

drop policy if exists "Users can upload own listing images" on storage.objects;
create policy "Users can upload own listing images" on storage.objects for insert to authenticated with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Original uploads are immutable; replacing a photo uses a new object name.
drop policy if exists "Users can update own listing images" on storage.objects;

drop policy if exists "Users can delete own listing images" on storage.objects;
create policy "Users can delete own listing images" on storage.objects for delete to authenticated using (
  bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text
  and not exists(select 1 from public.listings where image_path = storage.objects.name or cutout_path = storage.objects.name)
);

-- ============================================================================
-- Category seeds — fixed ids from src/lib/marketplace.ts CATEGORIES
-- ============================================================================

insert into public.categories (id, slug, name, icon) values
  ('00000000-0000-4000-8000-000000000001', 'books', 'Books & notes', 'BookOpen'),
  ('00000000-0000-4000-8000-000000000002', 'electronics', 'Electronics', 'Headphones'),
  ('00000000-0000-4000-8000-000000000003', 'furniture', 'Room essentials', 'Armchair'),
  ('00000000-0000-4000-8000-000000000004', 'cycles', 'Cycles', 'Bike'),
  ('00000000-0000-4000-8000-000000000005', 'fashion', 'Clothing', 'Shirt'),
  ('00000000-0000-4000-8000-000000000006', 'sports', 'Sports', 'Dumbbell'),
  ('00000000-0000-4000-8000-000000000007', 'kitchen', 'Kitchen', 'Coffee'),
  ('00000000-0000-4000-8000-000000000008', 'other', 'Everything else', 'Shapes')
on conflict (id) do update set slug = excluded.slug, name = excluded.name, icon = excluded.icon;

-- Orphan handling: on listing DELETE or image_path change, server attempts delete only if no other listings.image_path references old path.
-- If storage deletion fails, DB mutation still succeeds; orphan is owned and recoverable via DELETE /api/uploads (verified unreferenced).

-- Explicit privileges are required in addition to RLS. Never rely on project defaults.
revoke all on public.profiles, public.categories, public.listings, public.threads, public.messages, public.reports from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.categories, public.listings to anon, authenticated;
grant insert (id,display_name,avatar_url,hostel_block) on public.profiles to authenticated;
grant update (display_name,hostel_block) on public.profiles to authenticated;
grant insert (seller_id,category_id,title,description,price_inr,condition,hostel_block,status,image_path,image_url,tags,ai_status) on public.listings to authenticated;
grant update (category_id,title,description,price_inr,condition,hostel_block,status,image_path,image_url,tags,ai_status,cutout_url,cutout_path) on public.listings to authenticated;
grant delete on public.listings to authenticated;
grant select on public.threads, public.messages to authenticated;
grant insert (listing_id,buyer_id,seller_id) on public.threads to authenticated;
grant update (updated_at) on public.threads to authenticated;
grant insert (thread_id,sender_id,recipient_id,body) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant insert (listing_id,reporter_id,reason,details) on public.reports to authenticated;

-- Original files must exist and belong to the seller, even when REST bypasses the app.
create or replace function public.validate_listing_image_and_content()
returns trigger language plpgsql security definer set search_path = '' as $$
declare tag text;
begin
 if new.image_path not like new.seller_id::text || '/%' then raise exception 'Invalid image ownership'; end if;
 perform 1 from storage.objects where bucket_id='listing-images' and name=new.image_path for key share;
 if not found then raise exception 'Original image does not exist'; end if;
 if new.cutout_path is not null then
  if new.cutout_path not like new.seller_id::text || '/%' then raise exception 'Invalid cutout ownership'; end if;
  if new.cutout_url is null or right(new.cutout_url,length(new.cutout_path)) <> new.cutout_path then raise exception 'Invalid cutout URL'; end if;
  if left(new.cutout_url,length(new.cutout_url)-length(new.cutout_path)) <> left(new.image_url,length(new.image_url)-length(new.image_path)) then raise exception 'Invalid cutout origin'; end if;
  perform 1 from storage.objects where bucket_id='listing-images' and name=new.cutout_path for key share;
  if not found then raise exception 'Cutout does not exist'; end if;
 end if;
 if new.cutout_url is not null and new.cutout_path is null then raise exception 'Cutout path is required'; end if;
 foreach tag in array new.tags loop if length(btrim(tag)) < 1 or length(tag) > 32 then raise exception 'Invalid tag'; end if; end loop;
 if concat_ws(' ',new.title,new.description,array_to_string(new.tags,' ')) ~* '\m(firearm|ammunition|cocaine|heroin|methamphetamine|stolen goods|fake id|exam answers|leaked exam)\M' then new.status := 'hidden'; end if;
 if TG_OP = 'UPDATE' and old.status='hidden' and auth.uid() is not null then new.status := 'hidden'; end if;
 if TG_OP = 'UPDATE' and new.image_path is distinct from old.image_path then new.cutout_path := null; new.cutout_url := null; new.ai_status := 'none'; end if;
 return new;
end; $$;
create trigger listings_validate_source before insert or update on public.listings for each row execute function public.validate_listing_image_and_content();

-- No authenticated caller can execute trigger functions as general RPCs.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_updated_at() from public;
revoke all on function public.listings_search_trigger() from public;
revoke all on function public.prevent_listing_seller_change() from public;
revoke all on function public.prevent_thread_immutable() from public;
revoke all on function public.validate_message_thread() from public;
revoke all on function public.enforce_message_update_only_read_at() from public;
revoke all on function public.bump_thread_updated_at() from public;
revoke all on function public.validate_listing_image_and_content() from public;

-- Backfill profiles for accounts that signed up before this migration.
insert into public.profiles(id,display_name)
select id, 'Campus member' from auth.users on conflict(id) do nothing;
