import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  let firstId: string | null = null;
  try {
    const { data } = await db().from("courses").select("id").order("created_at").limit(1);
    firstId = data?.[0]?.id ?? null;
  } catch {
    /* layout shows the connection error */
  }
  if (firstId) redirect(`/courses/${firstId}`);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">Y</div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Yoyaku에 오신 걸 환영해요</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        왼쪽 사이드바의 <b>+</b> 버튼으로 듣는 과목을 추가하고, 강의 영상을 올려 대본과 강의노트를 만들어 보세요.
      </p>
    </div>
  );
}
