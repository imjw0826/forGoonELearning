import { notFound } from "next/navigation";
import { LectureWorkspace, type MaterialView } from "@/components/LectureWorkspace";
import { peekState } from "@/lib/pipeline";
import { AUDIO_BUCKET, MATERIALS_BUCKET, db } from "@/lib/supabase";
import type { AudioSegmentView, Lecture, TranscriptChunk } from "@/lib/types";

export const dynamic = "force-dynamic";

const URL_TTL = 60 * 60 * 6;

export default async function LecturePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; lectureId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { courseId, lectureId } = await params;
  const { q } = await searchParams;

  const [{ data: lecture }, { data: course }] = await Promise.all([
    db().from("lectures").select("*").eq("id", lectureId).eq("course_id", courseId).maybeSingle(),
    db().from("courses").select("id, name").eq("id", courseId).maybeSingle(),
  ]);
  if (!lecture || !course) notFound();
  const l = lecture as Lecture;

  const [{ data: materials }, { data: chunks }, { data: segments }, state] = await Promise.all([
    db().from("materials").select("id, filename, storage_path, size_bytes, extracted_text").eq("lecture_id", lectureId).order("created_at"),
    db().from("transcript_chunks").select("idx, start_sec, end_sec, raw_text, corrected_text").eq("lecture_id", lectureId).order("idx"),
    db().from("audio_segments").select("media_id, seg_idx, storage_path, duration_sec").eq("lecture_id", lectureId),
    peekState(lectureId),
  ]);

  // Playlist: ready files in their order, each file's segments in order, laid end to end.
  const order = new Map(state.media.filter((m) => m.status === "ready").map((m) => [m.id, m.idx]));
  const ordered = (segments ?? [])
    .filter((s) => order.has(s.media_id as string))
    .sort((a, b) => order.get(a.media_id)! - order.get(b.media_id)! || a.seg_idx - b.seg_idx);
  const signed = ordered.length
    ? (await db().storage.from(AUDIO_BUCKET).createSignedUrls(ordered.map((s) => s.storage_path as string), URL_TTL)).data ?? []
    : [];
  const urlByPath = new Map(signed.map((x) => [x.path, x.signedUrl]));
  let offset = 0;
  const playlist: AudioSegmentView[] = ordered.map((s) => {
    const view = {
      media_id: s.media_id as string,
      seg_idx: s.seg_idx as number,
      offset_sec: offset,
      duration_sec: Number(s.duration_sec ?? 0),
      url: urlByPath.get(s.storage_path as string) ?? null,
    };
    offset += view.duration_sec;
    return view;
  });

  const materialViews: MaterialView[] = await Promise.all(
    (materials ?? []).map(async (m) => ({
      id: m.id as string,
      filename: m.filename as string,
      size: (m.size_bytes as number | null) ?? null,
      chars: (m.extracted_text as string | null)?.length ?? 0,
      url:
        (
          await db()
            .storage.from(MATERIALS_BUCKET)
            .createSignedUrl(m.storage_path as string, URL_TTL, { download: m.filename as string })
        ).data?.signedUrl ?? null,
    })),
  );

  return (
    <LectureWorkspace
      courseId={course.id}
      courseName={course.name}
      lecture={{
        id: l.id,
        session_no: l.session_no,
        title: l.title,
        duration_sec: l.duration_sec,
        note: l.note,
      }}
      playlist={playlist}
      materials={materialViews}
      chunks={(chunks ?? []) as Omit<TranscriptChunk, "lecture_id">[]}
      initialState={state}
      query={q ?? null}
    />
  );
}
