import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "강의노트 — 클라우드에서 만드는 학습 노트",
  description: "강의 영상이나 소리 파일을 올리면 외부 음성 인식 API와 DeepSeek가 핵심 개념과 복습 포인트를 정리합니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
