import { NextRequest, NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/geminiServerEnv";

// ─── 데모 데이터 (SK하이닉스 · 발표용 즉시 반환) ────────────────────────────────

const DEMO_KEYWORD = "SK하이닉스";
const DEMO_TG_SUMMARIES = [
  "JP모건이 SK하이닉스 목표주가를 310,000원으로 상향 조정했습니다. " +
  "HBM4 출하량이 기존 전망 대비 30% 초과 달성이 예상되고, NVIDIA Blackwell Ultra 단독 공급이 확정됐으며, " +
  "2분기 HBM ASP가 전분기 대비 12% 상승한 것이 주요 근거입니다.",

  "블룸버그에 따르면, SK하이닉스의 290억 달러 규모 나스닥 ADR 상장의 핵심 쟁점은 ADR과 서울 상장 주식 간 " +
  "'펀저빌리티(상호전환 가능성)'입니다. 전환이 자유롭지 않을 경우 TSMC처럼 ADR이 국내 주식 대비 지속적인 " +
  "프리미엄을 형성할 수 있으며, 차익거래 투자자들은 ADR 배정 참여 여부를 놓고 촉각을 곤두세우고 있습니다.",

  "SK하이닉스의 30일 이동평균 이격도가 +30.49%를 기록하며 단기 과열 구간에 진입했습니다. " +
  "종가 291만 7천 원 대비 MA30은 223만 5천 원으로 乖離가 확대된 상태이며, " +
  "기간 최대 이격도 +60.51% 대비 현재 위치를 고려 시 추가 상승 여력과 조정 가능성을 함께 점검할 필요가 있습니다.",
];

// ─── 실제 라우트 ──────────────────────────────────────────────────────────────

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

  // SK하이닉스: 첫 3개 메시지 즉시 요약 반환
  if (keyword === DEMO_KEYWORD) {
    return NextResponse.json({ summaries: texts.map((_, i) => DEMO_TG_SUMMARIES[i] ?? null) });
  }

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
