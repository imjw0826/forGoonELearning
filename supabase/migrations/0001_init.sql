-- Yoyaku schema
-- Supabase SQL Editor에 그대로 붙여넣어 실행하거나 `supabase db push`로 적용하세요.

create extension if not exists pgcrypto;

-- 과목
create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- 강의 (회차)
create table if not exists public.lectures (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.courses(id) on delete cascade,
  session_no       int  not null,
  title            text not null,
  source_filename  text,
  audio_path       text,              -- storage: audio/<lecture_id>/audio.mp3

  -- 추출 파이프라인: idle → transcribing(Whisper) → correcting(DeepSeek) → done
  extract_status   text not null default 'idle'
                   check (extract_status in ('idle', 'transcribing', 'correcting', 'done')),
  extract_error    text,
  fal_request_id   text,
  fal_status_url   text,
  fal_response_url text,
  language         text,
  duration_sec     numeric,
  raw_transcript   text,              -- Whisper 원문
  transcript       text,              -- DeepSeek 교정본

  -- 요약 파이프라인: idle → planning(목차) → writing(섹션별) → done
  summary_status   text not null default 'idle'
                   check (summary_status in ('idle', 'planning', 'writing', 'done')),
  summary_error    text,
  note             text,              -- 최종 강의노트 (Markdown)

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists lectures_course_idx on public.lectures (course_id, session_no);

-- 강의자료 (PDF / PPTX / DOCX / TXT)
create table if not exists public.materials (
  id              uuid primary key default gen_random_uuid(),
  lecture_id      uuid not null references public.lectures(id) on delete cascade,
  filename        text not null,
  storage_path    text not null,
  size_bytes      bigint,
  extracted_text  text,
  created_at      timestamptz not null default now()
);
create index if not exists materials_lecture_idx on public.materials (lecture_id);

-- Whisper 결과를 ~2,000자 단위로 나눈 조각. DeepSeek 교정은 조각 단위로 진행.
create table if not exists public.transcript_chunks (
  lecture_id      uuid not null references public.lectures(id) on delete cascade,
  idx             int  not null,
  start_sec       numeric,
  end_sec         numeric,
  raw_text        text not null,
  corrected_text  text,
  primary key (lecture_id, idx)
);

-- 강의노트 섹션 (목차 계획 후 섹션별로 작성)
create table if not exists public.note_sections (
  lecture_id   uuid not null references public.lectures(id) on delete cascade,
  idx          int  not null,
  title        text not null,
  start_chunk  int  not null,
  end_chunk    int  not null,
  content      text,
  primary key (lecture_id, idx)
);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists lectures_touch on public.lectures;
create trigger lectures_touch before update on public.lectures
  for each row execute function public.touch_updated_at();

-- 대본 검색 (과목 단위, 대소문자 무시)
create or replace function public.search_lectures(p_course_id uuid, p_query text)
returns table (id uuid, session_no int, title text, snippet text, match_count int)
language sql stable as $$
  select
    l.id,
    l.session_no,
    l.title,
    substr(b.body, greatest(1, strpos(lower(b.body), lower(p_query)) - 90), length(p_query) + 180) as snippet,
    ((length(b.body) - length(replace(lower(b.body), lower(p_query), ''))) / greatest(length(p_query), 1))::int as match_count
  from public.lectures l
  cross join lateral (select coalesce(l.transcript, l.raw_transcript, '') as body) b
  where l.course_id = p_course_id
    and length(p_query) > 0
    and strpos(lower(b.body), lower(p_query)) > 0
  order by l.session_no;
$$;

-- 모든 접근은 서버(service role)를 통해서만 이루어집니다.
-- RLS를 켜고 정책을 만들지 않으면 anon 키로는 아무것도 읽거나 쓸 수 없습니다.
alter table public.courses           enable row level security;
alter table public.lectures          enable row level security;
alter table public.materials         enable row level security;
alter table public.transcript_chunks enable row level security;
alter table public.note_sections     enable row level security;

-- Storage 버킷 (비공개)
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false), ('materials', 'materials', false)
on conflict (id) do nothing;
