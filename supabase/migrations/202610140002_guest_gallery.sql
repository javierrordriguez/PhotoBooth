-- Guest capabilities: plaintext tokens never enter PostgreSQL.
alter table public.photo_sessions add column guest_window timestamptz not null default now();
alter table public.photo_sessions add column guest_count integer not null default 0;
create table public.guest_rate_limit (
 id integer primary key check(id=1), window_start timestamptz not null, requests integer not null
);
insert into public.guest_rate_limit values(1,now(),0);
alter table public.guest_rate_limit enable row level security;
revoke all on public.guest_rate_limit from public,anon,authenticated;
grant all on public.guest_rate_limit to service_role;

create function public.booth_link(p_user uuid,p_session uuid,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.photo_sessions;
begin
 -- Reuses ownership, enabled-device, expiry and rate checks under device lock.
 perform public.booth_command(p_user,'status',p_session);
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_hash'; end if;
 select * into s from public.photo_sessions where id=p_session for update;
 if s.token_hash is not null and s.token_hash<>p_hash then raise exception 'token_conflict'; end if;
 update public.photo_sessions set token_hash=p_hash where id=p_session and token_hash is null;
 return jsonb_build_object('registered',true);
end $$;
revoke all on function public.booth_link(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.booth_link(uuid,uuid,text) to service_role;

create function public.guest_gallery(p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.photo_sessions; g public.guest_rate_limit; result jsonb;
begin
 select * into g from public.guest_rate_limit where id=1 for update;
 if g.window_start<=clock_timestamp()-interval '1 minute' then
   update public.guest_rate_limit set window_start=clock_timestamp(),requests=1 where id=1;
 elsif g.requests>=600 then return jsonb_build_object('state','limited');
 else update public.guest_rate_limit set requests=requests+1 where id=1; end if;
 select * into s from public.photo_sessions where token_hash=p_hash for update;
 if not found then return jsonb_build_object('state','invalid'); end if;
 if s.guest_window<=clock_timestamp()-interval '1 minute' then
   update public.photo_sessions set guest_window=clock_timestamp(),guest_count=1 where id=s.id;
 elsif s.guest_count>=30 then return jsonb_build_object('state','limited');
 else update public.photo_sessions set guest_count=guest_count+1 where id=s.id; end if;
 if s.revoked_at is not null then return jsonb_build_object('state','revoked'); end if;
 if s.expires_at<=clock_timestamp() then return jsonb_build_object('state','expired'); end if;
 if s.status<>'ready' or (select count(*) from public.photos where session_id=s.id and uploaded_at is not null)<>5 then
   return jsonb_build_object('state','preparing');
 end if;
 select jsonb_build_object('state','ready','name',e.name,'date',e.event_date,'expiresAt',s.expires_at,
   'photos',(select jsonb_agg(jsonb_build_object('position',p.position,'path',p.storage_path,'size',p.size_bytes) order by p.position)
             from public.photos p where p.session_id=s.id)) into result from public.events e where e.id=s.event_id;
 return result;
end $$;
revoke all on function public.guest_gallery(text) from public,anon,authenticated;
grant execute on function public.guest_gallery(text) to service_role;
