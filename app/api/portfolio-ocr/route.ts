import { NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/geminiServerEnv";

export interface OcrAsset {
  name: string;
  quantity: number | null;
  avgPrice: number | null;      // 항상 원화(KRW)로 반환
  originalCurrency?: string;    // 변환 전 원본 통화 (USD 등)
  originalAvgPrice?: number;    // 변환 전 원본 단가
  fxRate?: number;              // 적용된 환율 (1 외화 = N원)
}

// 비전(이미지) 지원 모델 폴백 순서 (429·404 시 다음 모델로 자동 교체)
// 한도가 남은 모델을 우선 배치 (Google AI Studio 무료 한도 기준 — 2026-06)
const GEMINI_MODELS = [
  "gemini-2.0-flash",        // 1순위: 비전 특화, RPD 200
  "gemini-3.1-flash-lite",   // 2순위: RPD 500 ★ 한도 가장 넉넉
  "gemini-3.5-flash",        // 3순위: RPD 20, 완전 미사용
  "gemini-3-flash",          // 4순위: RPD 20
  "gemma-4-26b",             // 5순위: RPD 1.5K, 멀티모달 지원 (미사용)
  "gemma-4-31b",             // 6순위: RPD 1.5K, 멀티모달 지원 (미사용)
  "gemini-2.5-flash",        // 7순위: RPD 20 (현재 초과 — 429 시 자동 스킵)
  "gemini-2.5-flash-lite",   // 8순위: RPD 20 (현재 초과 — 429 시 자동 스킵)
  "gemini-1.5-flash",        // 9순위: 구세대, 별도 한도 풀
] as const;

type GeminiRawResp = {
  candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
};

// ── 환율 조회 (Yahoo Finance) ─────────────────────────────────────────────────

const FX_CACHE = new Map<string, { rate: number; fetchedAt: number }>();
const FX_TTL_MS = 5 * 60 * 1000; // 5분

async function fetchKrwRate(currency: string): Promise<number | null> {
  if (currency === "KRW") return 1;

  const cached = FX_CACHE.get(currency);
  if (cached && Date.now() - cached.fetchedAt < FX_TTL_MS) return cached.rate;

  // USD→KRW: ticker = "KRW=X" (Yahoo Finance 관례)
  // 그 외: JPYKRW=X, EURKRW=X 등
  const ticker = currency === "USD" ? "KRW=X" : `${currency}KRW=X`;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const rate = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof rate === "number" && rate > 0) {
      FX_CACHE.set(currency, { rate, fetchedAt: Date.now() });
      return rate;
    }
  } catch (e) {
    console.warn(`[portfolio-ocr] 환율 조회 실패 (${ticker}):`, e);
  }
  return null;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    return isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function extractText(resp: GeminiRawResp): string {
  return resp.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── Route Handler ─────────────────────────────────────────────────────────────

const ALLOWED_TYPES = [
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "application/pdf",
];

async function fileToInlineData(file: File) {
  // PDF는 이름 기반 폴백
  let mimeType = file.type || "";
  if (!mimeType && file.name.toLowerCase().endsWith(".pdf")) mimeType = "application/pdf";
  if (!mimeType) mimeType = "image/jpeg";
  if (!ALLOWED_TYPES.includes(mimeType)) return null;
  const buf = await file.arrayBuffer();
  return { mime_type: mimeType, data: Buffer.from(buf).toString("base64") };
}

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

  // image, image1, image2 ... 최대 5장 수집
  const imageFiles: File[] = [];
  const keys = ["image", "image1", "image2", "image3", "image4"];
  for (const key of keys) {
    const val = formData.get(key);
    if (val instanceof File) imageFiles.push(val);
  }
  if (imageFiles.length === 0) {
    return NextResponse.json({ error: "이미지 파일을 찾을 수 없습니다." }, { status: 400 });
  }

  // 이미지를 병렬로 base64 변환
  const inlineDataList = (await Promise.all(imageFiles.map(fileToInlineData))).filter(Boolean);
  if (inlineDataList.length === 0) {
    return NextResponse.json({ error: "JPG, PNG, WEBP 이미지만 지원합니다." }, { status: 400 });
  }

  const hasPdf = inlineDataList.some(d => d?.mime_type === "application/pdf");
  const multiImageNote = hasPdf
    ? `\nPDF 파일이 첨부됐습니다. PDF 안에 여러 페이지(표)가 있을 수 있습니다. 종목명·보유수량이 있는 표와 평균단가가 있는 표를 종합하여 같은 종목의 수량·평균단가를 합쳐서 하나의 항목으로 응답하세요.`
    : inlineDataList.length > 1
    ? `\n이미지가 ${inlineDataList.length}장 첨부됐습니다. 같은 앱의 서로 다른 뷰일 수 있습니다(예: 수량만 보이는 화면 + 평균단가만 보이는 화면). 모든 이미지를 종합하여 같은 종목의 수량·평균단가를 합쳐서 하나의 항목으로 응답하세요.`
    : "";

  const prompt = `이 이미지는 증권사 앱 또는 HTS의 보유 종목(잔고) 화면입니다.${multiImageNote}
이미지에서 보유 종목 목록을 파악하여 아래 JSON 배열 형식으로만 응답하세요.

각 종목에서 추출할 정보:
- name: 종목명 또는 티커 (예: "삼성전자", "INTW", "TIGER 미국S&P500")
- quantity: 보유 수량
    * "21주", "21 주", "21shares" → 21
    * "수량 21", "잔고수량 21", "보유수량 21" → 21
    * 소수점 포함 가능 (ETF·채권 등)
- avgPrice: 매수단가 / 평균단가 / 매입단가
    * "내 평균 $376.73" → 376.73
    * "평균단가 72,000" → 72000
    * "매입단가 ₩18,500" → 18500
    * 통화 기호·콤마 제거 후 숫자만
- currency: avgPrice의 통화 코드
    * ₩ 또는 원 → "KRW"
    * $ 또는 USD, 또는 미국 주식(나스닥·NYSE) → "USD"
    * ¥ 또는 JPY → "JPY"
    * € 또는 EUR → "EUR"
    * HK$ 또는 HKD → "HKD"
    * 통화 표시 없고 국내 주식(KOSPI·KOSDAQ) → "KRW"
    * 통화 표시 없고 해외 주식 → "USD"

중요 규칙:
- 응답은 JSON 배열만, 다른 텍스트나 마크다운 없이
- 여러 이미지에서 같은 종목이 나오면 반드시 하나로 합쳐서 반환
- 확인 불가능한 값은 null (절대 추측 금지)
- 빈 배열 [] → 종목 없음
- 계좌 총액·평가손익·수익률·총 평가금액 행은 제외

예시 응답:
[
  {"name":"삼성전자","quantity":100,"avgPrice":72000,"currency":"KRW"},
  {"name":"INTW","quantity":21,"avgPrice":376.73,"currency":"USD"},
  {"name":"TIGER 미국S&P500","quantity":50,"avgPrice":18500,"currency":"KRW"}
]`;

  const imageParts = inlineDataList.map(d => ({ inline_data: d! }));

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          ...imageParts,
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };

  // ── Gemini 호출 (모델 폴백) ────────────────────────────────────────────────

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
      console.warn(`[portfolio-ocr] ${model} 네트워크 오류, 다음 모델로 폴백`);
      continue;
    }

    if (resp.status === 429) {
      lastError = `${model}: 한도 초과(429)`;
      console.warn(`[portfolio-ocr] ${model} 429 한도 초과, 다음 모델로 폴백`);
      continue;
    }
    // 404 = API 버전 미지원 / 400 = 모델이 이미지 입력 미지원(Gemma 등) → 다음 시도
    if (resp.status === 404 || resp.status === 400) {
      const errText = await resp.text().catch(() => "");
      lastError = `${model}: 미지원(${resp.status})`;
      console.warn(`[portfolio-ocr] ${model} ${resp.status} 미지원, 다음 모델로 폴백:`, errText.slice(0, 100));
      continue;
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      lastError = `${model}: 오류 ${resp.status} — ${errText.slice(0, 200)}`;
      console.warn(`[portfolio-ocr] ${model} 실패:`, lastError);
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
    console.log(`[portfolio-ocr] ${model} 분석 성공`);
    break;
  }

  if (!rawText) {
    return NextResponse.json(
      { error: `모든 Gemini 모델 한도 초과 또는 오류. 마지막 오류: ${lastError}` },
      { status: 502 }
    );
  }

  // ── 파싱 ─────────────────────────────────────────────────────────────────

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

  // ── 환율 변환 ─────────────────────────────────────────────────────────────

  // 필요한 통화 목록 수집 (중복 제거)
  const rawItems = parsed as Record<string, unknown>[];
  const currencies = [...new Set(
    rawItems.map(item => (typeof item.currency === "string" ? item.currency.toUpperCase() : "KRW"))
  )].filter(c => c !== "KRW");

  // 필요한 환율을 병렬로 미리 조회
  const rateMap = new Map<string, number | null>();
  await Promise.all(
    currencies.map(async (c) => {
      const rate = await fetchKrwRate(c);
      rateMap.set(c, rate);
      if (rate) console.log(`[portfolio-ocr] 환율 ${c}/KRW = ${rate}`);
      else console.warn(`[portfolio-ocr] ${c}/KRW 환율 조회 실패 — 변환 생략`);
    })
  );

  // 변환 적용
  const assets: OcrAsset[] = rawItems
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) return null;

      const quantity = parseNumber(item.quantity);
      const rawAvgPrice = parseNumber(item.avgPrice);
      const currency = typeof item.currency === "string" ? item.currency.toUpperCase() : "KRW";

      let avgPrice = rawAvgPrice;
      let fxRate: number | undefined;

      if (rawAvgPrice !== null && currency !== "KRW") {
        const rate = rateMap.get(currency);
        if (rate) {
          avgPrice = Math.round(rawAvgPrice * rate);
          fxRate = rate;
        }
        // 환율 조회 실패 시: 원본 숫자 그대로 유지하되 currency 필드로 경고 가능
      }

      return {
        name,
        quantity,
        avgPrice,
        ...(currency !== "KRW" && rawAvgPrice !== null
          ? { originalCurrency: currency, originalAvgPrice: rawAvgPrice, ...(fxRate ? { fxRate } : {}) }
          : {}),
      } satisfies OcrAsset;
    })
    .filter((a): a is OcrAsset => a !== null);

  return NextResponse.json({ assets, usedModel });
}
