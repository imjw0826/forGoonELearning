import { notFound } from "next/navigation";
import { CourseView } from "@/components/CourseView";
import { db } from "@/lib/supabase";
import type { Course, LectureSummary, MediaStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { data: course } = await db().from("courses").select("*").eq("id", courseId).maybeSingle();
  if (!course) notFound();

  const { data: lectures } = await db()
    .from("lectures")
    .select("id, course_id, session_no, title, extract_status, summary_status, created_at, duration_sec")
    .eq("course_id", courseId)
    .order("session_no")
    .order("created_at");
  const ids = (lectures ?? []).map((l) => l.id as string);
  const { data: media } = ids.length
    ? await db().from("lecture_media").select("lecture_id, status, duration_sec").in("lecture_id", ids)
    : { data: [] };

  const rows: LectureSummary[] = (lectures ?? []).map((l) => {
    const files = (media ?? []).filter((m) => m.lecture_id === l.id) as {
      status: MediaStatus;
      duration_sec: number | null;
    }[];
    const ready = files.filter((f) => f.status === "ready");
    return {
      ...(l as Omit<LectureSummary, "mediaCount" | "mediaBusy">),
      duration_sec: ready.length ? ready.reduce((s, f) => s + Number(f.duration_sec ?? 0), 0) : l.duration_sec,
      mediaCount: ready.length,
      // Only server-side conversions are reliably "in progress"; a browser upload can be abandoned.
      mediaBusy: files.some((f) => f.status === "converting"),
    };
  });

  return <CourseView course={course as Course} lectures={rows} />;
}
