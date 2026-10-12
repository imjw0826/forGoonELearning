import { notFound } from "next/navigation";
import { LectureWorkspace, type MaterialView } from "@/components/LectureWorkspace";
import { peekState } from "@/lib/pipeline";
import { AUDIO_BUCKET, MATERIALS_BUCKET, db } from "@/lib/supabase";
import type { Lecture, TranscriptChunk } from "@/lib/types";

export const dynamic = "force-dynamic";

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

  const [{ data: materials }, { data: chunks }, state] = await Promise.all([
    db().from("materials").select("id, filename, storage_path, size_bytes, extracted_text").eq("lecture_id", lectureId).order("created_at"),
    db().from("transcript_chunks").select("idx, start_sec, end_sec, raw_text, corrected_text").eq("lecture_id", lectureId).order("idx"),
    peekState(lectureId),
  ]);

  const audioUrl = l.audio_path
    ? (await db().storage.from(AUDIO_BUCKET).createSignedUrl(l.audio_path, 60 * 60 * 6)).data?.signedUrl ?? null
    : null;

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
            .createSignedUrl(m.storage_path as string, 60 * 60 * 6, { download: m.filename as string })
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
        source_filename: l.source_filename,
        duration_sec: l.duration_sec,
        note: l.note,
        hasAudio: !!l.audio_path,
      }}
      audioUrl={audioUrl}
      materials={materialViews}
      chunks={(chunks ?? []) as Omit<TranscriptChunk, "lecture_id">[]}
      initialState={state}
      query={q ?? null}
    />
  );
}
