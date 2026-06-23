import { NextRequest, NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/geminiServerEnv";

// gemini-3.1-flash-lite 우선 (RPD 500으로 여유 있음) → 1.5-flash 폴백
const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-1.5-flash", "gemini-2.5-flash-lite"] as const;
type GeminiResp = { candidates?: Array<{ content: { parts: Array<{ text: string }> } }> };

// 실패 시 null 반환 (200자 원문을 요약으로 오인하지 않도록)
async function summarizeOne(text: string, keyword: string, apiKey: string): Promise<string | null> {
  const clean = text.replace(/https?\S+/g, "").replace(/[#@]\S+/g, "").trim();
  const prompt =
    `아래 텔레그램 메시지에서 "${keyword}" 관련 핵심 사실만 2~3문장으로 요약하세요.\n` +
    `규칙: ①원문 문장 복사 금지 ②이모지·해시태그 제거 ③수치·기업명 보존 ④2~3문장 초과 금지\n\n` +
    `[메시지]\n${clean.slice(0, 1500)}\n\n[2~3문장 요약]`;

  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );
      if (res.status === 429) {
        console.warn(`[tg-summarize] ${model} 429 rate limit → 5초 대기`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        console.warn(`[tg-summarize] ${model} HTTP ${res.status}: ${err.slice(0, 200)}`);
        continue;
      }
      const data = (await res.json()) as GeminiResp;
      const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      if (summary.length > 10) {
        console.log(`[tg-summarize] ${model} 성공 (${summary.length}자)`);
        return summary;
      }
    } catch (e) {
      console.warn(`[tg-summarize] ${model} 예외:`, e instanceof Error ? e.message : e);
      continue;
    }
  }
  console.warn("[tg-summarize] 모든 모델 실패 → null");
  return null;
}

// POST /api/telegram-summarize
// body: { texts: string[], keyword: string }
// returns: { summaries: (string | null)[] }
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { texts?: string[]; keyword?: string };
  const texts   = body.texts   ?? [];
  const keyword = body.keyword ?? "";

  if (texts.length === 0) return NextResponse.json({ summaries: [] });

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.warn("[tg-summarize] GEMINI_API_KEY 없음");
    return NextResponse.json({ summaries: texts.map(() => null) });
  }

  const summaries: (string | null)[] = [];
  for (const text of texts) {
    const s = await summarizeOne(text, keyword, apiKey);
    summaries.push(s);
    if (texts.length > 1) await new Promise(r => setTimeout(r, 1000));
  }

  return NextResponse.json({ summaries });
}
