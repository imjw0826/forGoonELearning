import type { Metadata } from "next";
import { AccessProvider } from "@/components/AccessProvider";
import { Sidebar } from "@/components/Sidebar";
import { isUnlocked } from "@/lib/access";
import { db } from "@/lib/supabase";
import type { Course } from "@/lib/types";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yoyaku",
  description: "강의 영상으로 대본과 강의노트를 만드는 웹 강의노트 플랫폼",
};

export const dynamic = "force-dynamic";

async function loadCourses(): Promise<{ courses: Course[]; error: string | null }> {
  try {
    const { data, error } = await db().from("courses").select("*").order("created_at");
    if (error) return { courses: [], error: error.message };
    return { courses: (data ?? []) as Course[], error: null };
  } catch (err) {
    return { courses: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ courses, error }, unlocked] = await Promise.all([loadCourses(), isUnlocked()]);

  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <AccessProvider initialUnlocked={unlocked}>
          <div className="flex h-dvh flex-col md:flex-row">
            <Sidebar courses={courses} />
            <main className="min-w-0 flex-1 overflow-y-auto">
              {error && (
                <div className="m-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-medium">Supabase 연결에 실패했습니다.</p>
                  <p className="mt-1 text-amber-800">{error}</p>
                  <p className="mt-1 text-amber-800">README의 설정 방법(환경변수, SQL 마이그레이션)을 확인해주세요.</p>
                </div>
              )}
              {children}
            </main>
          </div>
        </AccessProvider>
      </body>
    </html>
  );
}
