import type { ChatMessage } from "./deepseek";
import { formatTime } from "./format";

/** Caps a long text, keeping the head (where titles/outlines usually are). */
export function cap(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + "\n…(이하 생략)" : text;
}

function materialsBlock(materials: string, max: number) {
  if (!materials.trim()) return "(업로드된 강의자료 없음)";
  return cap(materials, max);
}

/* ------------------------------------------------------------------ */
/* 1) 대본 교정                                                        */
/* ------------------------------------------------------------------ */

export function correctionMessages(args: {
  lectureTitle: string;
  materials: string;
  previousTail: string;
  chunk: string;
}): ChatMessage[] {
  // The system prompt is identical for every chunk of a lecture, so DeepSeek's prefix cache kicks in.
  const system = `당신은 대학 강의 녹취록 교정 전문가입니다. 음성 인식(Whisper)으로 만든 강의 대본의 한 구간을 받아 교정합니다.

[교정 규칙]
1. 오탈자, 띄어쓰기, 잘못 인식된 단어(특히 전공 용어·고유명사·수식·영어 용어)를 문맥과 강의자료를 근거로 바로잡습니다.
2. 끊기거나 불완전한 문장, 문맥에 맞지 않는 단어는 강의자가 실제로 말했을 법한 자연스러운 문장으로 고칩니다.
3. 내용을 요약하거나 생략하지 않습니다. 강의자가 말한 모든 설명, 예시, 질문, 농담, 공지사항을 그대로 유지합니다.
4. 의미 없는 군더더기("어", "음", "그", 같은 말의 단순 반복)만 제거합니다.
5. 문장부호를 넣고, 주제가 바뀌는 곳에서 문단을 나눕니다(빈 줄).
6. 원문에 없는 설명이나 내용을 새로 지어내지 않습니다. 확신이 없으면 원문을 유지합니다.
7. 교정된 본문만 출력합니다. 머리말, 설명, 따옴표, 마크다운 제목을 붙이지 않습니다.

[강의 제목]
${args.lectureTitle}

[강의자료 (용어 참고용)]
${materialsBlock(args.materials, 8000)}`;

  const user = `${args.previousTail ? `[바로 앞 구간의 끝부분 — 문맥 참고용, 출력하지 마세요]\n…${args.previousTail}\n\n` : ""}[교정할 구간]
${args.chunk}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ------------------------------------------------------------------ */
/* 2) 강의노트 — 목차 계획                                             */
/* ------------------------------------------------------------------ */

export interface PlanChunk {
  idx: number;
  start_sec: number | null;
  text: string;
}

export function planMessages(args: { lectureTitle: string; materials: string; chunks: PlanChunk[] }): ChatMessage[] {
  const n = args.chunks.length;
  const transcript = args.chunks
    .map((c) => `[#${c.idx}${c.start_sec != null ? ` ${formatTime(c.start_sec)}` : ""}]\n${c.text}`)
    .join("\n\n");

  const system = `당신은 대학 강의를 구조화하는 조교입니다. 강의 대본을 읽고, 강의가 진행된 순서대로 강의노트의 큰 목차(대단원)를 설계합니다.

[규칙]
- 대본은 [#번호] 구간으로 나뉘어 있습니다 (#0 ~ #${n - 1}).
- 강의에서 다룬 순서를 그대로 따르며, 각 섹션은 연속된 구간 범위를 담당합니다.
- 각 섹션의 시작 구간 번호(start_chunk)만 정하면 됩니다. 첫 섹션은 반드시 0에서 시작하고, 번호는 오름차순입니다.
- 섹션 하나는 보통 1~5개 구간을 담당합니다. 전체 섹션 수는 대략 ${Math.max(1, Math.min(n, Math.round(n / 3)))}개 내외로, 주제 전환 지점에서 나눕니다.
- 섹션 제목은 그 부분의 핵심 주제를 드러내는 구체적인 명사구로 씁니다 (번호 없이).
- 강의자료가 있으면 자료의 단원/슬라이드 제목을 참고하되, 실제 강의 진행 순서를 우선합니다.
- 반드시 다음 JSON 형식으로만 답합니다:
{"sections":[{"title":"섹션 제목","start_chunk":0}, ...]}`;

  const user = `[강의 제목]
${args.lectureTitle}

[강의자료]
${materialsBlock(args.materials, 20000)}

[강의 대본]
${transcript}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ------------------------------------------------------------------ */
/* 3) 강의노트 — 섹션 작성                                             */
/* ------------------------------------------------------------------ */

export function sectionMessages(args: {
  lectureTitle: string;
  materials: string;
  outline: string[];
  sectionNo: number;
  sectionTitle: string;
  transcript: string;
}): ChatMessage[] {
  const outline = args.outline.map((t, i) => `${i + 1}. ${t}${i + 1 === args.sectionNo ? "  ← 지금 작성할 섹션" : ""}`).join("\n");

  const system = `당신은 대학 강의노트를 작성하는 최고의 조교입니다. 강의 대본의 한 섹션을 받아, 시험 공부에 바로 쓸 수 있는 개요식 강의노트를 작성합니다.

[작성 원칙]
1. 누락 금지: 대본에 나온 모든 개념, 정의, 설명, 근거, 예시, 수식, 수치, 비교, 강조점, 질문과 답, 과제·시험 공지를 빠짐없이 담습니다. 짧게 줄이는 것보다 빠짐없는 것이 훨씬 중요합니다.
2. 순서 유지: 강의에서 나온 순서 그대로 정리합니다.
3. 위계 구조:
   - 소단원은 "### ${args.sectionNo}.1 소제목", "### ${args.sectionNo}.2 소제목" 형식의 제목으로 나눕니다.
   - 소단원 안의 내용은 "-" 글머리표로 쓰고, 하위 내용은 2칸 들여쓰기로 최대 4단계까지 계층화합니다 (주제 → 세부 설명 → 예시/근거 → 보충).
   - 문장은 간결한 개조식(명사형 종결: "~임", "~함", "~의 원리")으로 씁니다.
4. 핵심 용어는 **굵게** 표시하고, 처음 나올 때 정의를 함께 적습니다. 영어 원어가 있으면 괄호로 병기합니다.
5. 수식은 $...$ (LaTeX)로, 비교·분류는 필요하면 마크다운 표로 정리합니다.
6. 강의자료에 같은 내용이 있으면 자료의 정확한 용어·수식을 사용하고 "(자료 p.N)" 또는 "(슬라이드 N)"처럼 출처를 표시합니다. 강의자료에만 있고 대본에 없는 내용은 이 섹션에 해당할 때만 "📎 자료 보충:" 글머리로 짧게 덧붙입니다.
7. 교수가 강조한 부분("중요", "시험", "꼭 기억")은 "⭐" 표시를 붙입니다.
8. 섹션 대제목(## ...)은 쓰지 마세요. "### ${args.sectionNo}.1"부터 시작하는 본문만 출력합니다. 머리말이나 맺음말을 붙이지 않습니다.`;

  const user = `[강의 제목]
${args.lectureTitle}

[전체 목차]
${outline}

[강의자료]
${materialsBlock(args.materials, 30000)}

[이번 섹션: ${args.sectionNo}. ${args.sectionTitle} — 해당 대본]
${args.transcript}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
