-- Proposal only: seller-selected listing photo display and source-bound prepublish cutouts.
-- Do not apply without explicit schema approval.

alter table public.listings
  add column if not exists photo_display_mode text,
  add column if not exists cutout_operation_id uuid;

update public.listings
set photo_display_mode = case when cutout_path is null then 'original' else 'both' end
where photo_display_mode is null;

alter table public.listings
  alter column photo_display_mode set default 'original',
  alter column photo_display_mode set not null,
  drop constraint if exists listings_photo_display_mode_check,
  drop constraint if exists listings_display_cutout_required;

alter table public.listings
  add constraint listings_photo_display_mode_check check (photo_display_mode in ('original','cutout','both')),
  add constraint listings_display_cutout_required check (photo_display_mode = 'original' or (cutout_path is not null and cutout_url is not null));

alter table public.listings
  drop constraint if exists listings_cutout_operation_fk;

alter table public.listings
  add constraint listings_cutout_operation_fk
  foreign key (cutout_operation_id) references public.ai_operations(id) on delete set null;

revoke insert, update on public.listings from authenticated;
grant insert (seller_id,category_id,title,description,price_inr,condition,hostel_block,status,image_path,image_url,cutout_path,cutout_url,cutout_operation_id,photo_display_mode,tags,ai_status) on public.listings to authenticated;
grant update (category_id,title,description,price_inr,condition,hostel_block,status,image_path,image_url,cutout_path,cutout_url,cutout_operation_id,photo_display_mode,tags,ai_status) on public.listings to authenticated;

create or replace function public.validate_listing_image_and_content()
returns trigger language plpgsql security definer set search_path = '' as $$
declare tag text; op public.ai_operations;
begin
 if new.image_path not like new.seller_id::text || '/%' then raise exception 'Invalid image ownership'; end if;
 perform 1 from storage.objects where bucket_id='listing-images' and name=new.image_path for key share;
 if not found then raise exception 'Original image does not exist'; end if;
 if TG_OP = 'UPDATE' and new.image_path is distinct from old.image_path and new.cutout_operation_id is not distinct from old.cutout_operation_id then
  new.cutout_path := null; new.cutout_url := null; new.cutout_operation_id := null; new.ai_status := 'none'; new.photo_display_mode := 'original';
 end if;
 if new.cutout_path is not null then
  if new.cutout_path not like new.seller_id::text || '/%' then raise exception 'Invalid cutout ownership'; end if;
  if new.cutout_url is null or right(new.cutout_url,length(new.cutout_path)) <> new.cutout_path then raise exception 'Invalid cutout URL'; end if;
  if left(new.cutout_url,length(new.cutout_url)-length(new.cutout_path)) <> left(new.image_url,length(new.image_url)-length(new.image_path)) then raise exception 'Invalid cutout origin'; end if;
  perform 1 from storage.objects where bucket_id='listing-images' and name=new.cutout_path for key share;
  if not found then raise exception 'Cutout does not exist'; end if;
  if (TG_OP = 'INSERT' or new.cutout_path is distinct from old.cutout_path or new.image_path is distinct from old.image_path) and new.cutout_operation_id is null then raise exception 'New cutout requires completed operation'; end if;
  if new.cutout_operation_id is not null then
   select * into op from public.ai_operations where id=new.cutout_operation_id and user_id=new.seller_id and feature='cutout' and status='done';
   if not found
      or op.result->>'status' is distinct from 'done'
      or op.result->>'source_image_path' is distinct from new.image_path
      or op.result->>'cutout_path' is distinct from new.cutout_path
      or op.result->>'cutout_url' is distinct from new.cutout_url
   then raise exception 'Cutout operation does not match listing source'; end if;
  end if;
 end if;
 if new.cutout_url is not null and new.cutout_path is null then raise exception 'Cutout path is required'; end if;
 if new.cutout_operation_id is not null and new.cutout_path is null then raise exception 'Cutout path is required for operation'; end if;
 if new.photo_display_mode <> 'original' and new.cutout_path is null then raise exception 'Selected display mode requires cutout'; end if;
 foreach tag in array new.tags loop if length(btrim(tag)) < 1 or length(tag) > 32 then raise exception 'Invalid tag'; end if; end loop;
 if concat_ws(' ',new.title,new.description,array_to_string(new.tags,' ')) ~* '\m(firearm|ammunition|cocaine|heroin|methamphetamine|stolen goods|fake id|exam answers|leaked exam)\M' then new.status := 'hidden'; end if;
 if TG_OP = 'UPDATE' and old.status='hidden' and auth.uid() is not null then new.status := 'hidden'; end if;
 return new;
end; $$;
revoke all on function public.validate_listing_image_and_content() from public;
