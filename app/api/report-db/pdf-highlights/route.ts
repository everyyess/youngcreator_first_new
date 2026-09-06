import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { ADVANCED_MODELS } from "@/lib/geminiModels";
import { fetchGeminiWithFallback } from "@/lib/geminiRunner";
import { formatSupabaseError, getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";
import { TAG_RULES_PROMPT, normalizeCompanies, normalizeTopics, normalizeMacro } from "@/lib/tagRules";

/**
 * /api/report-db/pdf-highlights — 리포트 PDF 업로드 → 노랑 하이라이트 텍스트 추출
 *
 * POST multipart/form-data { file: PDF, model?: string }
 *  → Gemini가 PDF에서 노랑색 형광펜 하이라이트 구간만 추출하고 태그 생성
 *  → report_db 테이블에 저장 (url = upload://<hash>)
 */

export const runtime = "nodejs";
export const maxDuration = 60;

// Models are loaded centrally from geminiModels

type GeminiResp = {
  candidates?: Array<{ content: { parts: Array<{ text: string }> }; finishReason?: string }>;
  error?: { message?: string };
};

export async function POST(req: NextRequest) {
  const db = getInsightSupabase(req);
  if (!db) {
    return NextResponse.json(insightDbUnavailable(), { status: 401 });
  }
  // Keys will be retrieved automatically inside fetchGeminiWithFallback

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 요청이 필요합니다." }, { status: 400 });
  }
  const file = form.get("file");
  const preferredModel = String(form.get("model") ?? "");
  const mode = String(form.get("mode") ?? "highlights"); // "highlights" | "full"

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF 파일(file 필드)이 필요합니다." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > 18 * 1024 * 1024) {
    return NextResponse.json({ error: "PDF가 너무 큽니다 (18MB 초과)." }, { status: 413 });
  }
  const pdfBase64 = buf.toString("base64");
  const fileName = file.name.replace(/\.pdf$/i, "");

  const hash = createHash("sha1").update(buf).digest("hex").slice(0, 16);
  const url = `upload://pdf/${hash}`;

  // ── report_db 기존 저장 여부 확인 ──────────────────────────────────────────
  try {
    const { data: existing, error } = await db.from("report_db").select("*").eq("url", url).maybeSingle();
    if (error) console.error("DB 조회 오류:", formatSupabaseError(error));
    if (existing) {
      return NextResponse.json({
        title: existing.title,
        broker: existing.broker,
        published_date: existing.published_date,
        ai_summary: existing.ai_summary,
        original_text: existing.original_text,
        companies: normalizeCompanies(existing.company_tags ?? []),
        topics: normalizeTopics(existing.topic_tags ?? []),
        macro: normalizeMacro(existing.macro_tags ?? []),
        url: existing.url,
        saved: true,
        report: existing
      });
    }
  } catch (e) {
    console.error("DB 조회 오류:", e);
  }

  let prompt = "";
  if (mode === "full") {
    prompt = `당신은 주식 리서치 애널리스트입니다.
첨부된 증권사/기관 리서치 리포트 PDF를 전체적으로 읽고 분석하여 요약 및 태그 정보를 생성해 주세요.

규칙:
1. 리포트의 핵심 내용을 파악하고, 아래의 구조화된 요약을 작성하세요.
   **📌 핵심 요약**
   - 리포트의 핵심 메시지를 1~2문장으로 요약

   **📊 주요 수치**
   - 목표주가, 투자의견, 예상 실적 등 핵심 수치를 나열

   **💡 투자 포인트**
   - 주요 투자 포인트를 2~4개 항목으로 나열

   **⚠️ 주요 리스크**
   - 투자 리스크 요인을 1~3개 항목으로 나열

2. 분석 결과를 바탕으로 리포트의 핵심 주체이며 비중 있게 다뤄진 주요 기업명(companies, 최대 10개, 단순 언급/비교 기업 제외)과 핵심 토픽(topics, 최대 8개), 매크로 지표(macro, 금리·환율·유가·물가·GDP·고용·관세·지정학 등을 다루는 경우에만 최대 5개) 태그를 추출하세요.

${TAG_RULES_PROMPT}

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "title": "리포트 제목 (표지에서 추출, 없으면 빈 문자열)",
  "broker": "발행 증권사/기관명 (없으면 빈 문자열)",
  "published_date": "발행일 yyyy-mm-dd (없으면 빈 문자열)",
  "summary": "구조화된 요약 내용 (마크다운 형식)",
  "companies": ["리포트의 핵심 주체인 주요 기업명 (단순 언급/비교 기업 제외)"],
  "topics": ["핵심 토픽 태그"],
  "macro": ["매크로 지표 태그"]
}`;
  } else {
    prompt = `첨부된 증권사/기관 리서치 리포트 PDF에서 **노란색 형광펜으로 하이라이트된 텍스트**만 찾아 추출하세요.

규칙:
- 노란색(또는 노랑 계열) 하이라이트가 칠해진 문장·구절만 추출합니다. 하이라이트가 없는 텍스트는 포함하지 마세요.
- 추출한 하이라이트는 페이지 순서대로 나열하세요.
- 하이라이트가 하나도 없으면 highlights를 빈 배열로 반환하세요.
- 하이라이트 내용을 기반으로 그 중 핵심 주체인 주요 기업명(companies, 최대 10개, 단순 언급/비교 기업 제외)과 핵심 토픽(topics, 최대 8개), 매크로 지표(macro, 금리·환율·유가·물가·GDP·고용·관세·지정학 등을 다루는 경우에만 최대 5개) 태그를 생성하세요.

${TAG_RULES_PROMPT}

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "title": "리포트 제목 (표지에서 추출, 없으면 빈 문자열)",
  "broker": "발행 증권사/기관명 (없으면 빈 문자열)",
  "published_date": "발행일 yyyy-mm-dd (없으면 빈 문자열)",
  "highlights": ["하이라이트된 텍스트 1", "하이라이트된 텍스트 2"],
  "companies": ["하이라이트 내용의 핵심 주체인 주요 기업명, 최대 10개 (단순 언급/비교 기업 제외)"],
  "topics": ["핵심 토픽 태그, 최대 8개"],
  "macro": ["매크로 지표 태그, 최대 5개"]
}`;
  }

  const requestBody = {
    contents: [{
      parts: [
        { inline_data: { mime_type: "application/pdf", data: pdfBase64 } },
        { text: prompt },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: "application/json" },
  };

  type ParsedHighlights = {
    title?: string; broker?: string; published_date?: string;
    highlights?: string[]; summary?: string; companies?: string[]; topics?: string[]; macro?: string[];
  };
  let parsed: ParsedHighlights | null = null;
  let lastError = "";

  try {
    const { res } = await fetchGeminiWithFallback({
      models: ADVANCED_MODELS,
      preferredModel,
      requestInit: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(55_000),
      },
    });

    const data = (await res.json()) as GeminiResp;
    if (!res.ok) {
      return NextResponse.json(
        { error: `Gemini HTTP ${res.status}: ${data.error?.message ?? ""}`.slice(0, 200) },
        { status: res.status }
      );
    }
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!raw) {
      return NextResponse.json({ error: "Gemini 빈 응답" }, { status: 502 });
    }
    try {
      const jsonStr = raw.startsWith("{") ? raw : (raw.match(/\{[\s\S]*\}/) ?? [""])[0];
      parsed = JSON.parse(jsonStr) as ParsedHighlights;
    } catch {
      return NextResponse.json({ error: "Gemini JSON 파싱 실패" }, { status: 502 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: `Gemini 호출 실패: ${error.message}` }, { status: 502 });
  }

  const highlights = (parsed.highlights ?? []).filter((h) => h && h.trim());
  const highlightText = highlights.map((h) => `- ${h}`).join("\n");

  const result = {
    title: parsed.title?.trim() || fileName,
    broker: parsed.broker?.trim() ?? "",
    published_date: parsed.published_date || null,
    ai_summary: mode === "full"
      ? (parsed.summary?.trim() ?? "")
      : (highlightText ? `**🖍️ 하이라이트 발췌**\n${highlightText}` : ""),
    original_text: mode === "full"
      ? (parsed.summary?.trim() ?? "")
      : highlightText,
    companies: normalizeCompanies(parsed.companies ?? []),
    topics: normalizeTopics(parsed.topics ?? []),
    macro: normalizeMacro(parsed.macro ?? []),
    url,
    saved: false
  };

  return NextResponse.json(result);
}
