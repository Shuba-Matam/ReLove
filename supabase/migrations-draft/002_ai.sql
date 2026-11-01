-- Re-Love optional AI limits — approved scope, November 1, 2026. Sole release integrator owns remote application.
-- One locked budget row serializes ALL features. Pending and failed attempts count.
create table public.ai_budget (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 daily_limit integer not null default 50 check(daily_limit between 0 and 10000),
 per_user_limit integer not null default 5 check(per_user_limit between 0 and 1000)
);
insert into public.ai_budget(id) values(true);
create table public.ai_settings (
 feature text primary key check(feature in ('draft','transcribe','cutout','moderation')),
 enabled boolean not null default false,
 daily_limit integer not null default 50 check(daily_limit between 0 and 10000),
 per_user_limit integer not null default 5 check(per_user_limit between 0 and 1000)
);
insert into public.ai_settings(feature) values('draft'),('transcribe'),('cutout'),('moderation');
create table public.ai_usage (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references public.profiles(id) on delete set null,
 feature text not null references public.ai_settings(feature),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 ok boolean,
 duration_ms integer check(duration_ms between 0 and 60000)
);
create index ai_usage_created_idx on public.ai_usage(created_at);
create index ai_usage_user_created_idx on public.ai_usage(user_id,created_at);
create index ai_usage_feature_created_idx on public.ai_usage(feature,created_at);
alter table public.ai_budget enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.ai_budget, public.ai_settings, public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
create policy own_ai_usage on public.ai_usage for select to authenticated using(user_id=auth.uid());

create or replace function public.reserve_ai_usage(p_feature text,p_daily_limit integer,p_user_limit integer)
returns table(allowed boolean,usage_id uuid,reason text)
language plpgsql security definer set search_path = '' as $$
declare
 who uuid := auth.uid(); budget public.ai_budget; feature_config public.ai_settings;
 today timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 global_count integer; user_count integer; feature_count integer; feature_user_count integer; reservation uuid;
begin
 if who is null then return query select false,null::uuid,'unauthorized'::text; return; end if;
 if p_daily_limit is null or p_user_limit is null or p_daily_limit <= 0 or p_user_limit <= 0 then return query select false,null::uuid,'invalid_limits'::text; return; end if;
 select * into budget from public.ai_budget where id=true for update;
 select * into feature_config from public.ai_settings where feature=p_feature;
 if not found or budget.enabled is distinct from true or feature_config.enabled is distinct from true then return query select false,null::uuid,'disabled'::text; return; end if;
 select count(*),count(*) filter(where user_id=who),count(*) filter(where feature=p_feature),count(*) filter(where user_id=who and feature=p_feature)
 into global_count,user_count,feature_count,feature_user_count from public.ai_usage where created_at>=today;
 if global_count >= least(budget.daily_limit,p_daily_limit) or feature_count >= feature_config.daily_limit then return query select false,null::uuid,'global_limit'::text; return; end if;
 if user_count >= least(budget.per_user_limit,p_user_limit) or feature_user_count >= feature_config.per_user_limit then return query select false,null::uuid,'user_limit'::text; return; end if;
 insert into public.ai_usage(user_id,feature) values(who,p_feature) returning id into reservation;
 return query select true,reservation,null::text;
end; $$;
revoke all on function public.reserve_ai_usage(text,integer,integer) from public;
grant execute on function public.reserve_ai_usage(text,integer,integer) to authenticated;

create or replace function public.complete_ai_usage(p_usage_id uuid,p_ok boolean,p_ms integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_ms < 0 or p_ms > 60000 or p_ok is null then raise exception 'Invalid completion'; end if;
 if not exists(select 1 from public.ai_usage where id=p_usage_id and user_id=auth.uid()) then raise exception 'Reservation not found'; end if;
 update public.ai_usage set completed_at=now(),ok=p_ok,duration_ms=p_ms where id=p_usage_id and user_id=auth.uid() and completed_at is null;
end; $$;
revoke all on function public.complete_ai_usage(uuid,boolean,integer) from public;
grant execute on function public.complete_ai_usage(uuid,boolean,integer) to authenticated;
