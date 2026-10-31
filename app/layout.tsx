import type { Metadata } from "next";
import { AccessProvider } from "@/components/AccessProvider";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <TooltipProvider delayDuration={300}>
          <AccessProvider initialUnlocked={unlocked}>
            <ConfirmProvider>
            <div className="flex h-dvh flex-col md:flex-row">
              <Sidebar courses={courses} />
              <main id="main" className="min-w-0 flex-1 overflow-y-auto">
                {error && (
                  <div className="mx-auto mt-6 max-w-5xl px-4 sm:px-8">
                    <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm">
                      <p className="font-medium">Supabase 연결에 실패했습니다.</p>
                      <p className="mt-1 text-muted-foreground">{error}</p>
                    </div>
                  </div>
                )}
                {children}
              </main>
            </div>
            </ConfirmProvider>
          </AccessProvider>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
