import { notFound } from "next/navigation";
import { NewLectureForm } from "@/components/NewLectureForm";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function NewLecturePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { data: course } = await db().from("courses").select("id, name").eq("id", courseId).maybeSingle();
  if (!course) notFound();
  const { data: last } = await db()
    .from("lectures")
    .select("session_no")
    .eq("course_id", courseId)
    .order("session_no", { ascending: false })
    .limit(1);
  const nextSessionNo = (last?.[0]?.session_no ?? 0) + 1;

  return <NewLectureForm courseId={course.id} courseName={course.name} nextSessionNo={nextSessionNo} />;
}
