import { NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/geminiServerEnv";

export interface WeeklyPick {
  name: string;
  recommendedDate: string | null; // 예: "1/2", "8/31"
  returnPct: number | null;       // 추천일 대비 수익률(%)
  thesis: string | null;          // 투자 포인트 한 줄 요약
  isNew: boolean;                 // 이번 주 신규 편입 종목
  isNonCoverage: boolean;         // 비커버리지 종목 (원문 * 표기)
}

// portfolio-ocr과 동일한 비전 모델 폴백 순서 재사용
const GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemma-4-26b",
  "gemma-4-31b",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
] as const;

type GeminiRawResp = {
  candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
};

function extractText(resp: GeminiRawResp): string {
  return resp.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

const ALLOWED_TYPES = [
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "application/pdf",
];

async function fileToInlineData(file: File) {
  let mimeType = file.type || "";
  if (!mimeType && file.name.toLowerCase().endsWith(".pdf")) mimeType = "application/pdf";
  if (!mimeType) mimeType = "image/jpeg";
  if (!ALLOWED_TYPES.includes(mimeType)) return null;
  const buf = await file.arrayBuffer();
  return { mime_type: mimeType, data: Buffer.from(buf).toString("base64") };
}

const PROMPT = `이 문서(또는 이미지)는 삼성증권 리서치센터의 "주간 투자 전략" 리포트입니다.
이 안에서 "주간 추천 종목" 표(종목명·주가·시가총액·추천일·수익률·투자포인트가 열로 나열된 표)를 찾아 각 행을 아래 JSON 배열 형식으로만 응답하세요. 다른 페이지의 내용(매크로, 밸류에이션 테이블, Watching list 등)은 무시하세요.

각 종목에서 추출할 정보:
- name: 종목명 (예: "삼성전자"). 종목명 옆에 있는 "*" 표시는 name에서 제외하고 isNonCoverage로 별도 표시
- recommendedDate: 추천일 (예: "1/2", "8/31") — 표에 있는 그대로
- returnPct: 수익률(%) — 숫자만 (예: 114.3, -2.4)
- thesis: 투자 포인트 한 줄 (표의 마지막 열 텍스트 그대로)
- isNew: 종목명 옆/행에 "NEW" 표시가 있으면 true, 없으면 false
- isNonCoverage: 종목명에 "*" 표시가 있으면 true, 없으면 false

중요 규칙:
- 응답은 JSON 배열만, 다른 텍스트나 마크다운 없이
- 표에 나온 순서 그대로 유지
- 확인 불가능한 값은 null
- "주간 추천 종목" 표를 찾을 수 없으면 빈 배열 []

예시 응답:
[
  {"name":"삼성전자","recommendedDate":"1/2","returnPct":114.3,"thesis":"주주 환원 규모로 삼성전자의 저평가를 증명","isNew":false,"isNonCoverage":false},
  {"name":"SK스퀘어","recommendedDate":"6/22","returnPct":-42.2,"thesis":"SK하이닉스 지분 가치(20.5%) 및 주주 환원 정책 확대","isNew":false,"isNonCoverage":true}
]`;

export async function POST(request: Request) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini API 키가 설정되지 않았습니다." }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "요청 파싱 오류" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 400 });
  }

  const inlineData = await fileToInlineData(file);
  if (!inlineData) {
    return NextResponse.json({ error: "PDF, JPG, PNG, WEBP 파일만 지원합니다." }, { status: 400 });
  }

  const requestBody = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: inlineData },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };

  let rawText = "";
  let usedModel = "";
  let lastError = "";

  for (const model of GEMINI_MODELS) {
    let resp: Response;
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }
      );
    } catch {
      lastError = `${model}: 네트워크 오류`;
      continue;
    }

    if (resp.status === 429) {
      lastError = `${model}: 한도 초과(429)`;
      continue;
    }
    if (resp.status === 404 || resp.status === 400) {
      const errText = await resp.text().catch(() => "");
      lastError = `${model}: 미지원(${resp.status})`;
      console.warn(`[weekly-picks-ocr] ${model} ${resp.status} 미지원, 다음 모델로 폴백:`, errText.slice(0, 100));
      continue;
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      lastError = `${model}: 오류 ${resp.status} — ${errText.slice(0, 200)}`;
      continue;
    }

    const geminiData = (await resp.json()) as GeminiRawResp;
    const text = extractText(geminiData);
    if (!text) {
      lastError = `${model}: 빈 응답`;
      continue;
    }

    rawText = text;
    usedModel = model;
    console.log(`[weekly-picks-ocr] ${model} 분석 성공`);
    break;
  }

  if (!rawText) {
    return NextResponse.json(
      { error: `모든 Gemini 모델 한도 초과 또는 오류. 마지막 오류: ${lastError}` },
      { status: 502 }
    );
  }

  let parsed: unknown;
  try {
    const cleaned = rawText.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "응답 파싱 실패", usedModel, raw: rawText.slice(0, 500) }, { status: 500 });
  }

  if (!Array.isArray(parsed)) {
    return NextResponse.json({ error: "예상치 못한 응답 형식", usedModel }, { status: 500 });
  }

  const rawItems = parsed as Record<string, unknown>[];
  const picks: WeeklyPick[] = rawItems
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) return null;
      return {
        name,
        recommendedDate: typeof item.recommendedDate === "string" ? item.recommendedDate : null,
        returnPct: typeof item.returnPct === "number" && isFinite(item.returnPct) ? item.returnPct : null,
        thesis: typeof item.thesis === "string" ? item.thesis : null,
        isNew: item.isNew === true,
        isNonCoverage: item.isNonCoverage === true,
      } satisfies WeeklyPick;
    })
    .filter((p): p is WeeklyPick => p !== null);

  return NextResponse.json({ picks, usedModel });
}
