-- Fase 2: ninguna operación de negocio es accesible directamente al navegador.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 40),
  event_date date not null,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  retention_days integer not null default 30 check (retention_days between 1 and 365),
  created_at timestamptz not null default now()
);
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  auth_user_id uuid not null unique references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  enabled boolean not null default false,
  max_sessions integer not null default 1000 check (max_sessions between 1 and 10000),
  request_window timestamptz not null default now(),
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id,event_id)
);
create table public.event_admins (
  event_id uuid not null references public.events(id),
  user_id uuid not null references auth.users(id),
  primary key (event_id,user_id)
);
create table public.photo_sessions (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  device_id uuid not null,
  status text not null default 'pending' check (status in ('pending','uploading','ready','failed')),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'),
  -- Se emitirá en Fase 3. NULL no autoriza ningún acceso de invitado.
  token_hash text unique check (token_hash ~ '^[a-f0-9]{64}$'),
  revoked_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (device_id,event_id) references public.devices(id,event_id),
  check (expires_at > created_at)
);
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.photo_sessions(id),
  type text not null check (type in ('original','strip')),
  position smallint not null check (position between 0 and 4),
  storage_path text not null unique,
  mime_type text not null check (mime_type = 'image/jpeg'),
  size_bytes integer not null check (size_bytes between 1 and 12582912),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id,position),
  check (width::bigint*height <= 12000000),
  check ((type='strip' and position=0 and width=1200 and height=3600) or (type='original' and position between 1 and 4))
);
create index sessions_event_created on public.photo_sessions(event_id,created_at desc);
create index sessions_device_created on public.photo_sessions(device_id,created_at desc);
create index sessions_status on public.photo_sessions(event_id,status);
create index devices_event on public.devices(event_id);

alter table public.events enable row level security;
alter table public.devices enable row level security;
alter table public.event_admins enable row level security;
alter table public.photo_sessions enable row level security;
alter table public.photos enable row level security;
revoke all on public.events,public.devices,public.event_admins,public.photo_sessions,public.photos from anon,authenticated;
grant all on public.events,public.devices,public.event_admins,public.photo_sessions,public.photos to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('booth-photos','booth-photos',false,12582912,array['image/jpeg']);
-- No policies for authenticated/anon: only the Edge Function's service client.
-- Restrictive guard also blocks access if a project has a permissive policy elsewhere.
create policy booth_private_guard on storage.objects as restrictive for all to anon,authenticated
using (bucket_id <> 'booth-photos') with check (bucket_id <> 'booth-photos');

create function public.booth_transition_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.event_id<>old.event_id or new.device_id<>old.device_id or new.manifest<>old.manifest then
    raise exception 'immutable_session';
  end if;
  if new.status<>old.status and not (
    (old.status='pending' and new.status in ('uploading','failed')) or
    (old.status='uploading' and new.status in ('ready','failed')) or
    (old.status='failed' and new.status='uploading')
  ) then raise exception 'invalid_transition'; end if;
  if new.status='ready' and old.status<>'ready' and
    (select count(*) from public.photos where session_id=new.id and uploaded_at is not null)<>5 then
    raise exception 'incomplete_session';
  end if;
  new.updated_at=clock_timestamp(); return new;
end $$;
create trigger booth_transition before update on public.photo_sessions for each row execute function public.booth_transition_guard();

-- Only service_role may call this RPC. p_user is the identity verified by Auth.getUser in Edge.
-- Lock the device per command to serialize counters, session creation and disable operations.
create function public.booth_command(
  p_user uuid, p_action text, p_session uuid default null,
  p_manifest jsonb default null, p_position integer default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.devices; s public.photo_sessions; ev public.events; item jsonb; result jsonb;
begin
  select * into d from public.devices where auth_user_id=p_user for update;
  if not found or not d.enabled then raise exception 'device_forbidden' using errcode='42501'; end if;
  if d.request_window <= clock_timestamp()-interval '1 minute' then
    update public.devices set request_window=clock_timestamp(),request_count=1 where id=d.id;
  elsif d.request_count>=120 then
    raise exception 'rate_limited' using errcode='P0001';
  else update public.devices set request_count=request_count+1 where id=d.id; end if;
  select * into ev from public.events where id=d.event_id;
  if p_action='context' then
    return jsonb_build_object('deviceId',d.id,'eventId',d.event_id,'deviceName',d.name,'eventName',ev.name,'eventDate',ev.event_date,'settings',ev.settings);
  end if;
  if p_action='init' then
    if p_session is null or p_manifest is null or jsonb_typeof(p_manifest)<>'array' or jsonb_array_length(p_manifest)<>5 then raise exception 'invalid_manifest'; end if;
    select * into s from public.photo_sessions where id=p_session;
    if found then
      if s.device_id<>d.id or s.event_id<>d.event_id then raise exception 'session_forbidden' using errcode='42501'; end if;
      if s.manifest<>p_manifest then raise exception 'manifest_conflict'; end if;
    else
      if (select count(*) from public.photo_sessions where device_id=d.id)>=d.max_sessions or
         (select count(*) from public.photo_sessions where device_id=d.id and created_at>clock_timestamp()-interval '1 hour')>=120 then raise exception 'session_limit'; end if;
      insert into public.photo_sessions(id,event_id,device_id,manifest,expires_at)
      values(p_session,d.event_id,d.id,p_manifest,clock_timestamp()+make_interval(days=>ev.retention_days));
      for item in select value from jsonb_array_elements(p_manifest) loop
        insert into public.photos(session_id,type,position,storage_path,mime_type,size_bytes,sha256,width,height)
        values(p_session,item->>'type',(item->>'position')::integer,
          d.event_id::text||'/'||p_session::text||'/'||(item->>'position')||'.jpg',
          'image/jpeg',(item->>'size')::integer,item->>'sha256',(item->>'width')::integer,(item->>'height')::integer);
      end loop;
    end if;
  end if;
  select * into s from public.photo_sessions where id=p_session for update;
  if not found or s.device_id<>d.id or s.event_id<>d.event_id then raise exception 'session_forbidden' using errcode='42501'; end if;
  if s.revoked_at is not null or s.expires_at<=clock_timestamp() then raise exception 'session_inactive' using errcode='42501'; end if;
  if p_action='slot' then
    if s.status in ('pending','failed') then update public.photo_sessions set status='uploading',error_code=null where id=s.id; end if;
    select to_jsonb(p) into result from public.photos p where session_id=s.id and position=p_position;
    if result is null then raise exception 'invalid_position'; end if;
    return result;
  elsif p_action='ack' then
    if s.status not in ('uploading','ready') then raise exception 'invalid_transition'; end if;
    update public.photos set uploaded_at=coalesce(uploaded_at,clock_timestamp()) where session_id=s.id and position=p_position;
    if not found then raise exception 'invalid_position'; end if;
  elsif p_action='failed' then
    if s.status<>'ready' then update public.photo_sessions set status='failed',error_code='storage_retry' where id=s.id; end if;
  elsif p_action='finalize' then
    if (select count(*) from public.photos where session_id=s.id and uploaded_at is not null)<>5 then raise exception 'incomplete_session'; end if;
    if s.status='failed' then update public.photo_sessions set status='uploading',error_code=null where id=s.id; end if;
    update public.photo_sessions set status='ready',error_code=null where id=s.id;
  elsif p_action not in ('status','init') then raise exception 'invalid_action';
  end if;
  select jsonb_build_object('status',x.status,'photos',(select jsonb_agg(to_jsonb(p) order by p.position) from public.photos p where p.session_id=x.id))
    into result from public.photo_sessions x where x.id=s.id;
  return result;
end $$;
revoke all on function public.booth_command(uuid,text,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.booth_command(uuid,text,uuid,jsonb,integer) to service_role;
revoke all on function public.booth_transition_guard() from public,anon,authenticated;
