-- Archer's Planner — full schema. Safe to re-run.
-- Already applied to the live project; kept here so the repo stays the source of truth.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- courses
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  canvas_course_id text not null,
  code text not null,
  name text not null,
  instructor text,
  room text,
  color text,
  created_at timestamptz not null default now(),
  unique (user_id, canvas_course_id)
);

-- -------------------------------------------------------------- deadlines
create table if not exists deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  canvas_assignment_id text not null,
  title text not null,
  due_at timestamptz,
  type text not null default 'assignment' check (type in ('assignment','quiz','exam','discussion','other')),
  points_possible numeric,
  canvas_url text,
  status text not null default 'open' check (status in ('open','submitted','graded','dismissed')),
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_assignment_id)
);
create index if not exists deadlines_user_due_idx on deadlines (user_id, due_at);

-- ------------------------------------------------------------------ files
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  deadline_id uuid references deadlines on delete set null,
  canvas_file_id text not null,
  filename text not null,
  content_type text,
  size_bytes bigint,
  canvas_url text,
  storage_path text,
  parsed_at timestamptz,          -- set once AI extraction has run; prevents re-parsing
  created_at timestamptz not null default now(),
  unique (user_id, canvas_file_id)
);
create index if not exists files_user_course_idx on files (user_id, course_id);

-- -------------------------------------------------------- grade_components
create table if not exists grade_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  label text not null,
  weight_percent numeric not null check (weight_percent >= 0 and weight_percent <= 100),
  source text not null default 'manual' check (source in ('ai_extracted','manual')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- grades
create table if not exists grades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  component_id uuid references grade_components on delete cascade,
  label text,
  score numeric,
  max_score numeric,
  source text not null default 'manual' check (source in ('scraped','manual')),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ sync_tokens
-- The extension's bearer token. Only the sha256 hash is ever stored.
create table if not exists sync_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- ------------------------------------------------------------------- RLS
do $policies$
declare t text;
begin
  foreach t in array array['courses','deadlines','files','grade_components','grades','sync_tokens']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists own_rows on %I', t);
    execute format(
      'create policy own_rows on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t);
  end loop;
end
$policies$;

-- --------------------------------------------------------------- storage
-- One private bucket, per-user path prefix: <user_id>/<course_id>/<filename>
insert into storage.buckets (id, name, public)
values ('course-files', 'course-files', false)
on conflict (id) do nothing;

drop policy if exists own_files on storage.objects;
create policy own_files on storage.objects for all to authenticated
  using (bucket_id = 'course-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'course-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ------------------------------------------------------------ ingest_sync
-- The extension's write path. Runs as definer so it can write rows for the
-- student the sync token belongs to — which is why the app needs no
-- service-role key anywhere. The token IS the authorisation, and nothing in
-- the payload can name a different user.
create or replace function public.ingest_sync(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid;
  v_token_id uuid;
  n_courses int := 0;
  n_deadlines int := 0;
  n_files int := 0;
begin
  if p_token is null or p_token !~ '^csp_[A-Za-z0-9_-]{16,}$' then
    raise exception 'invalid sync token' using errcode = '28000';
  end if;

  select id, user_id into v_token_id, v_user
  from sync_tokens
  where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
    and revoked_at is null;

  if v_user is null then
    raise exception 'invalid or revoked sync token' using errcode = '28000';
  end if;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload -> 'courses', '[]'::jsonb))
      as x(canvas_course_id text, code text, name text, instructor text, room text)
    limit 60
  )
  insert into courses (user_id, canvas_course_id, code, name, instructor, room)
  select v_user, canvas_course_id, left(code, 64), left(name, 300), left(instructor, 120), left(room, 60)
  from incoming
  where canvas_course_id is not null and code is not null and name is not null
  on conflict (user_id, canvas_course_id) do update
    set code = excluded.code, name = excluded.name,
        instructor = excluded.instructor, room = excluded.room;
  get diagnostics n_courses = row_count;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload -> 'deadlines', '[]'::jsonb))
      as x(canvas_course_id text, canvas_assignment_id text, title text, due_at timestamptz,
           type text, points_possible numeric, canvas_url text, status text)
    limit 3000
  )
  insert into deadlines (user_id, course_id, canvas_assignment_id, title, due_at, type,
                         points_possible, canvas_url, status, updated_at)
  select v_user, c.id, i.canvas_assignment_id, left(coalesce(i.title, 'Untitled'), 400), i.due_at,
         case when i.type in ('assignment','quiz','exam','discussion','other') then i.type else 'other' end,
         i.points_possible, left(i.canvas_url, 900),
         case when i.status in ('open','submitted','graded','dismissed') then i.status else 'open' end,
         now()
  from incoming i
  join courses c on c.user_id = v_user and c.canvas_course_id = i.canvas_course_id
  where i.canvas_assignment_id is not null
  on conflict (user_id, canvas_assignment_id) do update
    set title = excluded.title, due_at = excluded.due_at, type = excluded.type,
        points_possible = excluded.points_possible, canvas_url = excluded.canvas_url,
        -- Canvas wins only when it has firmer news than "still open", so a
        -- student's own "mark done" is not undone on every sync.
        status = case when excluded.status = 'open' then deadlines.status else excluded.status end,
        updated_at = now();
  get diagnostics n_deadlines = row_count;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(p_payload -> 'files', '[]'::jsonb))
      as x(canvas_course_id text, canvas_assignment_id text, canvas_file_id text,
           filename text, content_type text, size_bytes bigint, canvas_url text)
    limit 5000
  )
  insert into files (user_id, course_id, deadline_id, canvas_file_id, filename,
                     content_type, size_bytes, canvas_url)
  select v_user, c.id, d.id, i.canvas_file_id, left(coalesce(i.filename, 'file'), 300),
         left(i.content_type, 120), i.size_bytes, left(i.canvas_url, 900)
  from incoming i
  join courses c on c.user_id = v_user and c.canvas_course_id = i.canvas_course_id
  left join deadlines d on d.user_id = v_user and d.canvas_assignment_id = i.canvas_assignment_id
  where i.canvas_file_id is not null
  on conflict (user_id, canvas_file_id) do update
    set filename = excluded.filename, content_type = excluded.content_type,
        size_bytes = excluded.size_bytes, canvas_url = excluded.canvas_url,
        deadline_id = coalesce(excluded.deadline_id, files.deadline_id);
  get diagnostics n_files = row_count;

  update sync_tokens set last_used_at = now() where id = v_token_id;

  return jsonb_build_object('ok', true,
    'counts', jsonb_build_object('courses', n_courses, 'deadlines', n_deadlines, 'files', n_files));
end;
$fn$;

revoke all on function public.ingest_sync(text, jsonb) from public;
grant execute on function public.ingest_sync(text, jsonb) to anon, authenticated;
