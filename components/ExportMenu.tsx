"use client";

import { ChevronDown, Copy, Download, FileText, Hash, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";

export interface ExportSource {
  /** Markdown text (copied as-is and used for the .md file). */
  markdown: string;
  /** Plain text without Markdown symbols. */
  plain: string;
  /** Rendered HTML, so pasting into 한글/Word/Notion/Google Docs keeps headings and lists. */
  html?: () => string | null;
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}로 복사했어요`);
  } catch {
    toast.error("복사하지 못했어요. 브라우저의 클립보드 권한을 확인해주세요.");
  }
}

async function copyRich(html: string, plain: string) {
  try {
    if (typeof ClipboardItem === "undefined") throw new Error("no ClipboardItem");
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
    toast.success("서식을 유지해 복사했어요", { description: "한글·Word·노션·구글 문서에 붙여 넣을 수 있어요." });
  } catch {
    await copyText(plain, "텍스트");
  }
}

function downloadMarkdown(markdown: string, filename: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename.replace(/[\\/:*?"<>|]+/g, "_")}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download or lose the filename in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.success("Markdown 파일로 내보냈어요");
}

/** "복사 ▾" (서식 유지 / Markdown / 텍스트) + "Markdown 내보내기" buttons. */
export function ExportMenu({ source, filename }: { source: () => ExportSource; filename: string }) {
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Copy /> 복사 <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => {
              const s = source();
              const html = s.html?.();
              if (html) void copyRich(html, s.plain);
              else void copyText(s.plain, "텍스트");
            }}
          >
            <Type /> 서식 그대로 복사
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyText(source().markdown, "Markdown")}>
            <Hash /> Markdown으로 복사
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyText(source().plain, "텍스트")}>
            <FileText /> 텍스트만 복사
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={() => downloadMarkdown(source().markdown, filename)}>
        <Download /> Markdown 내보내기
      </Button>
    </div>
  );
}
