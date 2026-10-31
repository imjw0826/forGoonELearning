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
    <div className="flex h-full animate-enter flex-col items-center justify-center p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-lg font-bold tracking-[-0.04em] text-primary-foreground">
        Yo
      </div>
      <h1 className="mt-5 text-2xl">Yoyaku에 오신 걸 환영해요</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        왼쪽의 <b className="font-semibold text-foreground">+</b> 버튼으로 듣는 과목을 추가하고, 강의 영상을 올려 대본과
        강의노트를 만들어 보세요.
      </p>
    </div>
  );
}
