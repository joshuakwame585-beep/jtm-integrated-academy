-- JTM Digital Academy schema for Supabase PostgreSQL
-- Run in Supabase SQL Editor. Review and test before using with real students.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  access text not null default 'free' check (access in ('free','premium')),
  level text not null default 'Beginner',
  category text not null default 'General',
  price numeric(10,2) not null default 0 check (price >= 0),
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  title text not null,
  body text not null default '',
  video_path text,
  resource_path text,
  duration text default 'Self-paced',
  position integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  question text not null,
  options jsonb not null,
  correct_index integer not null check (correct_index between 0 and 3),
  created_at timestamptz not null default now()
);
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'active' check (status in ('active','pending','completed','revoked')),
  enrolled_at timestamptz not null default now(),
  unique(student_id,course_id)
);
create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  unique(enrollment_id,lesson_id)
);
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  certificate_code text not null unique default ('JTM-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  issued_at timestamptz not null default now(),
  unique(student_id,course_id)
);

create or replace function public.is_jtm_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.admin_users where user_id=auth.uid()); $$;

create or replace function public.handle_new_jtm_user()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  insert into public.profiles(id,email,display_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',''))
  on conflict(id) do update set email=excluded.email;
  return new;
end; $$;
drop trigger if exists on_jtm_auth_user_created on auth.users;
create trigger on_jtm_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_jtm_user();

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.quizzes enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.certificates enable row level security;

-- Profiles: students can see/update their own profile; admins can view all.
create policy "profile self read" on public.profiles for select to authenticated using(id=auth.uid() or public.is_jtm_admin());
create policy "profile self update" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "admin list profiles" on public.profiles for select to authenticated using(public.is_jtm_admin());
-- Admin membership can only be managed by project owner in SQL editor; no client insert policy.
create policy "admin can read own membership" on public.admin_users for select to authenticated using(user_id=auth.uid());
-- Published catalogue is public; only admins manage courses.
create policy "published courses visible" on public.courses for select to anon,authenticated using(published=true or public.is_jtm_admin());
create policy "admin insert courses" on public.courses for insert to authenticated with check(public.is_jtm_admin() and created_by=auth.uid());
create policy "admin update courses" on public.courses for update to authenticated using(public.is_jtm_admin()) with check(public.is_jtm_admin());
create policy "admin delete courses" on public.courses for delete to authenticated using(public.is_jtm_admin());
-- Modules, lessons and quizzes can be read when their parent course is published; writes are admin-only.
create policy "modules visible with course" on public.modules for select to anon,authenticated using(exists(select 1 from public.courses c where c.id=course_id and c.published and (c.access='free' or public.is_jtm_admin() or exists(select 1 from public.enrollments e where e.course_id=c.id and e.student_id=auth.uid() and e.status='active'))));
create policy "admin manage modules" on public.modules for all to authenticated using(public.is_jtm_admin()) with check(public.is_jtm_admin());
create policy "lessons visible with course" on public.lessons for select to anon,authenticated using(exists(select 1 from public.modules m join public.courses c on c.id=m.course_id where m.id=module_id and c.published and (published or public.is_jtm_admin()) and (c.access='free' or public.is_jtm_admin() or exists(select 1 from public.enrollments e where e.course_id=c.id and e.student_id=auth.uid() and e.status='active'))));
create policy "admin manage lessons" on public.lessons for all to authenticated using(public.is_jtm_admin()) with check(public.is_jtm_admin());
create policy "quizzes visible with course" on public.quizzes for select to authenticated using(exists(select 1 from public.courses c where c.id=course_id and c.published and (c.access='free' or public.is_jtm_admin() or exists(select 1 from public.enrollments e where e.course_id=c.id and e.student_id=auth.uid() and e.status='active'))));
create policy "admin manage quizzes" on public.quizzes for all to authenticated using(public.is_jtm_admin()) with check(public.is_jtm_admin());
-- Student self-enrolment is limited to FREE courses. Premium enrolment requires a future verified payment workflow.
create policy "student read own enrollments" on public.enrollments for select to authenticated using(student_id=auth.uid() or public.is_jtm_admin());
create policy "student enroll free courses" on public.enrollments for insert to authenticated with check(student_id=auth.uid() and status='active' and exists(select 1 from public.courses c where c.id=course_id and c.access='free' and c.published));
create policy "admin manage enrollments" on public.enrollments for all to authenticated using(public.is_jtm_admin()) with check(public.is_jtm_admin());
create policy "student read own progress" on public.lesson_progress for select to authenticated using(exists(select 1 from public.enrollments e where e.id=enrollment_id and (e.student_id=auth.uid() or public.is_jtm_admin())));
create policy "student save own progress" on public.lesson_progress for insert to authenticated with check(exists(select 1 from public.enrollments e where e.id=enrollment_id and e.student_id=auth.uid() and e.status='active'));
create policy "student update own progress" on public.lesson_progress for update to authenticated using(exists(select 1 from public.enrollments e where e.id=enrollment_id and e.student_id=auth.uid())) with check(exists(select 1 from public.enrollments e where e.id=enrollment_id and e.student_id=auth.uid()));
create policy "admin read progress" on public.lesson_progress for select to authenticated using(public.is_jtm_admin());
create policy "student read own certificates" on public.certificates for select to authenticated using(student_id=auth.uid() or public.is_jtm_admin());
-- Certificate issuance is intentionally not available to the browser in this starter release.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('course-media','course-media',false,524288000,array['video/mp4','video/webm','video/quicktime','application/pdf'])
on conflict(id) do nothing;
create policy "admin upload course media" on storage.objects for insert to authenticated with check(bucket_id='course-media' and public.is_jtm_admin());
create policy "admin update course media" on storage.objects for update to authenticated using(bucket_id='course-media' and public.is_jtm_admin()) with check(bucket_id='course-media' and public.is_jtm_admin());
create policy "admin delete course media" on storage.objects for delete to authenticated using(bucket_id='course-media' and public.is_jtm_admin());
create policy "enrolled students read course media" on storage.objects for select to authenticated using(bucket_id='course-media' and (public.is_jtm_admin() or exists(select 1 from public.enrollments e where e.student_id=auth.uid() and e.status='active' and e.course_id::text=(storage.foldername(name))[1])));

-- After signing up with your own admin email, run this separately in SQL Editor:
-- insert into public.admin_users(user_id) values ('YOUR-AUTH-USER-UUID');
