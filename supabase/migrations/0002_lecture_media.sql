-- 한 강의에 여러 영상(파트)을 올리고, 긴 영상은 여러 mp3 조각으로 저장하기 위한 테이블.
--
--   lectures 1 ─ N lecture_media (업로드한 영상/오디오 파일, 순서 = idx)
--   lecture_media 1 ─ N audio_segments (변환된 mp3 조각, 순서 = seg_idx, 조각당 ≤ 2시간)
--
-- 강의 전체의 재생 순서는 (media.idx, seg_idx) 이고, 대본 타임스탬프는 이 순서로 이어 붙인 누적 시간입니다.

create table if not exists public.lecture_media (
  id            uuid primary key default gen_random_uuid(),
  lecture_id    uuid not null references public.lectures(id) on delete cascade,
  idx           int  not null,
  filename      text not null,
  size_bytes    bigint,
  -- pending(생성됨) → uploading → converting → ready | error
  status        text not null default 'pending'
                check (status in ('pending', 'uploading', 'converting', 'ready', 'error')),
  error         text,
  duration_sec  numeric,
  created_at    timestamptz not null default now(),
  unique (lecture_id, idx)
);
create index if not exists lecture_media_lecture_idx on public.lecture_media (lecture_id, idx);

create table if not exists public.audio_segments (
  media_id          uuid not null references public.lecture_media(id) on delete cascade,
  seg_idx           int  not null,
  lecture_id        uuid not null references public.lectures(id) on delete cascade,
  storage_path      text not null,
  duration_sec      numeric not null,
  -- Whisper(fal) 작업 상태 (조각마다 따로 인식)
  fal_status_url    text,
  fal_response_url  text,
  primary key (media_id, seg_idx)
);
create index if not exists audio_segments_lecture_idx on public.audio_segments (lecture_id);

alter table public.lecture_media  enable row level security;
alter table public.audio_segments enable row level security;

-- 기존 강의(오디오 1개)를 새 구조로 옮깁니다.
insert into public.lecture_media (lecture_id, idx, filename, status, duration_sec)
select l.id, 0, coalesce(l.source_filename, 'audio.mp3'), 'ready', l.duration_sec
from public.lectures l
where l.audio_path is not null
  and not exists (select 1 from public.lecture_media m where m.lecture_id = l.id);

insert into public.audio_segments (media_id, seg_idx, lecture_id, storage_path, duration_sec)
select m.id, 0, l.id, l.audio_path, coalesce(l.duration_sec, 0)
from public.lectures l
join public.lecture_media m on m.lecture_id = l.id and m.idx = 0
where l.audio_path is not null
  and not exists (select 1 from public.audio_segments s where s.media_id = m.id);
