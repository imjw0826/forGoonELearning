import "server-only";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

/** Calls the DeepSeek chat completions API (OpenAI-compatible) with a couple of retries. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY 환경변수가 설정되지 않았습니다.");

  const body = {
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 8192,
    stream: false,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(250_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`DeepSeek 일시 오류 (${res.status})`);
        continue;
      }
      if (!res.ok) throw new Error(`DeepSeek 요청 실패 (${res.status}): ${(await res.text()).slice(0, 500)}`);
      const data = await res.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("DeepSeek 응답이 비어 있습니다.");
      return content.trim();
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.startsWith("DeepSeek 요청 실패")) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
