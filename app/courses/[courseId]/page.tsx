import { notFound } from "next/navigation";
import { CourseView } from "@/components/CourseView";
import { db } from "@/lib/supabase";
import type { Course, LectureSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { data: course } = await db().from("courses").select("*").eq("id", courseId).maybeSingle();
  if (!course) notFound();

  const { data: lectures } = await db()
    .from("lectures")
    .select("id, course_id, session_no, title, audio_path, extract_status, summary_status, created_at")
    .eq("course_id", courseId)
    .order("session_no")
    .order("created_at");

  return <CourseView course={course as Course} lectures={(lectures ?? []) as LectureSummary[]} />;
}
