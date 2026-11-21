"use client";

import "katex/dist/katex.min.css";
import { isValidElement, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { slugify } from "@/lib/format";
import { ExportMenu } from "./ExportMenu";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const components: Components = {
  h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
  a: ({ href, children }) =>
    href?.startsWith("#") ? (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        {children}
      </a>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

export function NoteView({ note, filename }: { note: string; filename: string }) {
  const article = useRef<HTMLElement>(null);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <ExportMenu
          filename={filename}
          source={() => ({
            markdown: note,
            plain: article.current?.innerText.trim() ?? note,
            html: () => article.current?.innerHTML ?? null,
          })}
        />
      </div>
      <article
        ref={article}
        className="note-body prose max-w-none prose-headings:text-balance prose-h2:mt-12 prose-h3:mt-8 prose-a:font-normal prose-a:no-underline hover:prose-a:underline prose-ul:my-1.5 prose-hr:my-10 prose-table:text-sm"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
          {note}
        </ReactMarkdown>
      </article>
    </div>
  );
}
