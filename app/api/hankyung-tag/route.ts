import { NextRequest, NextResponse } from "next/server";
import { SIMPLE_MODELS } from "@/lib/geminiModels";
import { fetchGeminiWithFallback } from "@/lib/geminiRunner";
import { TAG_RULES_PROMPT, normalizeTopics, normalizeCompanies, normalizeMacro, buildDynamicTagListHint } from "@/lib/tagRules";
import { getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";

export const runtime = "nodejs";

const CATEGORY_KR: Record<string, string> = {
  economy: "경제",
  industry: "산업",
  financial: "금융",
};

type GeminiResp = {
  candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
  error?: { message?: string };
};

export async function POST(req: NextRequest) {
  if (!getInsightSupabase(req)) {
    return NextResponse.json(insightDbUnavailable(), { status: 401 });
  }
  const body = (await req.json()) as { title?: string; content?: string; category?: string; url?: string };
  const title = body.title?.trim() ?? "";
  const content = body.content?.trim() ?? "";
  const category = CATEGORY_KR[body.category ?? ""] ?? "경제/금융";
  const url = body.url?.trim() ?? "";

  if (!title) return NextResponse.json({ topics: ["News"], companies: [], macro: [] });

  let channelGuideline = "";
  const isUsChannel = url.includes("yahoo.com") || url.includes("cnbc.com");
  const isChinaChannel = url.includes("globaltimes.cn");

  if (isUsChannel) {
    channelGuideline = `\n※ 중요 지침: 이 기사는 미국 매체(Yahoo Finance, CNBC 등)에서 수집된 외신 뉴스입니다. 기사 제목이나 내용이 구체적으로 미국 연준 금리 결정, 미국 관세, 미국 대선 등 미국 거시 경제/정책적 주요 이슈를 다루는 것이 아니라면, 단순히 미국 매체 기사라는 이유만으로 '미국' 태그를 자동으로 지정하지 마십시오.`;
  } else if (isChinaChannel) {
    channelGuideline = `\n※ 중요 지침: 이 기사는 중국 매체(Global Times 등)에서 수집된 외신 뉴스입니다. 기사 제목이나 내용이 중국 거시 경제 정책, 미중 무역 갈등 등 중국 중심의 주요 매크로 이슈를 구체적으로 다루고 있는 경우가 아니라면, 단순히 중국 매체 기사라는 이유만으로 '중국' 태그를 자동으로 지정하지 마십시오.`;
  }

  const prompt = `다음 뉴스 기사를 분석하여 Topic 태그, Company 태그, Macro 태그를 JSON으로만 반환하세요.

기사 제목: "${title}"
${content ? `기사 본문:\n${content.slice(0, 6000)}\n` : "(본문 없음 — 제목만으로 판단)"}
카테고리: ${category}
${channelGuideline}

태깅 원칙:
- 태그는 본문 내용을 기준으로 판단한다. 본문이 없으면 제목만으로 판단한다.
- 제목에도 등장하는 개념은 본문에서도 핵심적으로 다뤄졌을 가능성이 높으므로, 태그 채택 우선순위를 더 높게 준다.

Topic 태그 규칙:
- "News" 태그는 반드시 포함
- 아래 기준 Topic 태그 목록을 최우선으로 사용 (최대 5개 합산)

Company 태그 규칙:
- 본문(또는 제목)의 핵심 주체이며 비중 있게 다뤄진 주요 기업명만 포함 (단순 언급/비교 기업 제외, 없으면 빈 배열)
- 아래 기준 Company 태그 목록의 표기를 최우선 사용

Macro 태그 규칙:
- 금리·환율·유가·물가·GDP·고용·관세·지정학·부동산처럼 top-down 매크로·경제 지표를 다루는 기사에만 부여 (해당 없으면 빈 배열)
- 아래 기준 Macro 태그 목록을 최우선으로 사용 (최대 3개)

${buildDynamicTagListHint(title, content)}

${TAG_RULES_PROMPT}

응답 형식 (JSON만, 다른 텍스트 없이):
{"topics": ["News", "태그"], "companies": ["기업명"], "macro": ["매크로태그"]}`;

  try {
    const { res } = await fetchGeminiWithFallback({
      models: SIMPLE_MODELS,
      requestInit: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(25_000),
      },
    });

    if (!res.ok) {
      return NextResponse.json({ topics: ["News"], companies: [], macro: [] });
    }

    const data = (await res.json()) as GeminiResp;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ topics: ["News"], companies: [], macro: [] });

    const parsed = JSON.parse(jsonMatch[0]) as { topics?: unknown; companies?: unknown; macro?: unknown };
    const topics = normalizeTopics(
      Array.isArray(parsed.topics) ? (parsed.topics as string[]) : ["News"],
    );
    const companies = normalizeCompanies(
      Array.isArray(parsed.companies) ? (parsed.companies as string[]) : [],
    );
    const macro = normalizeMacro(
      Array.isArray(parsed.macro) ? (parsed.macro as string[]) : [],
    );

    const haystack = `${title} ${content}`;
    let finalTopics = [...topics];
    if (isUsChannel && finalTopics.includes("미국")) {
      const hasUsKeyword = /(미국|미국산|미국인|미\.?\s*국|u\.?\s*s\.?\s*a?|fed|연준|트럼프|바이든|해리스|백악관|국채)/i.test(haystack);
      if (!hasUsKeyword) {
        finalTopics = finalTopics.filter((t) => t !== "미국");
      }
    }
    if (isChinaChannel && finalTopics.includes("중국")) {
      const hasChinaKeyword = /(중국|중\.?\s*국|china|베이징|상하이|시진핑|위안화|인민은행)/i.test(haystack);
      if (!hasChinaKeyword) {
        finalTopics = finalTopics.filter((t) => t !== "중국");
      }
    }

    if (!finalTopics.includes("News")) finalTopics.unshift("News");
    return NextResponse.json({ topics: finalTopics, companies, macro });
  } catch {
    return NextResponse.json({ topics: ["News"], companies: [], macro: [] });
  }
}
