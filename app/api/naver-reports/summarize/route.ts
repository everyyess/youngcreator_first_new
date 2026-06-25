import { NextRequest, NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/geminiServerEnv';
import { DEMO_NAVER_PDF_URL, DEMO_NAVER_SUMMARY } from '../route';

// ─── 실제 라우트 ──────────────────────────────────────────────────────────────

// Next.js App Router 라우트 핸들러 최대 실행 시간 (초)
// PDF 다운로드 + Gemini 분석이 기본 10초를 초과할 수 있음
export const maxDuration = 60;

// 한도 초과(429) 또는 미지원(404) 시 순서대로 폴백
// PDF inline_data 지원 모델만 포함 (Google AI Studio 무료 한도 기준 — 2026-06)
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',   // 1순위: RPD 500 ★ 한도 가장 넉넉
  'gemini-1.5-flash',        // 2순위: 구세대, 별도 한도 풀
  'gemini-2.5-flash-lite',   // 3순위: RPD 20
  'gemini-2.5-flash',        // 4순위: RPD 20
] as const;

const PDF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://finance.naver.com',
  'Accept': 'application/pdf,application/octet-stream,*/*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

export async function GET(req: NextRequest) {
  const pdfUrl = req.nextUrl.searchParams.get('pdfUrl') ?? '';
  const title = req.nextUrl.searchParams.get('title') ?? '';

  if (!pdfUrl) {
    return NextResponse.json({ error: 'PDF URL이 필요합니다.' }, { status: 400 });
  }

  // 데모 PDF 즉시 반환
  if (pdfUrl === DEMO_NAVER_PDF_URL) {
    return NextResponse.json({ summary: DEMO_NAVER_SUMMARY });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Gemini API 키(GEMINI_API_KEY)가 .env.local에 설정되어 있지 않습니다.' },
      { status: 500 }
    );
  }

  // ── PDF 다운로드 ─────────────────────────────────────────────────────────────
  let pdfBase64: string;
  let pdfSizeKb: number;
  try {
    const pdfRes = await fetch(pdfUrl, { headers: PDF_HEADERS });
    if (!pdfRes.ok) {
      return NextResponse.json(
        { error: `PDF 다운로드 실패: HTTP ${pdfRes.status} (${pdfUrl})` },
        { status: 502 }
      );
    }
    const contentType = pdfRes.headers.get('content-type') ?? '';
    if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      const preview = await pdfRes.text();
      return NextResponse.json(
        { error: `PDF가 아닌 응답 수신 (Content-Type: ${contentType}). 미리보기: ${preview.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const buf = await pdfRes.arrayBuffer();
    pdfSizeKb = Math.round(buf.byteLength / 1024);
    // Gemini inline_data 제한: 약 20MB. 초과 시 에러 반환
    if (buf.byteLength > 18 * 1024 * 1024) {
      return NextResponse.json(
        { error: `PDF 크기(${pdfSizeKb}KB)가 너무 큽니다. Gemini inline_data 한도 초과.` },
        { status: 413 }
      );
    }
    pdfBase64 = Buffer.from(buf).toString('base64');
  } catch (e) {
    return NextResponse.json(
      { error: `PDF 다운로드 중 네트워크 오류: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }

  // ── Gemini API 요약 요청 ──────────────────────────────────────────────────────
  const prompt = `당신은 주식 리서치 애널리스트입니다.
첨부된 증권사 리서치 리포트(${pdfSizeKb!}KB)를 분석하여 아래 형식에 맞춰 한국어로 작성하세요.

**📌 핵심 요약**
- 리포트의 핵심 메시지를 1~2문장으로 요약

**📊 주요 수치**
- 목표주가, 투자의견, 예상 EPS·매출·영업이익 등 핵심 수치를 항목별로 나열

**💡 투자 포인트**
- 매수/중립/매도 근거가 되는 주요 포인트를 2~4개 항목으로 나열

**⚠️ 주요 리스크**
- 투자 리스크 요인을 1~3개 항목으로 나열

리포트 제목: ${title || '(미제공)'}

출력 규칙:
- 섹션 제목은 반드시 **굵게** 형식으로 단독 줄에 작성하세요
- 각 항목은 반드시 "- "로 시작하세요
- 없는 정보는 해당 섹션을 생략하세요
- 인사말·설명·출처 표기 없이 내용만 출력하세요
- 모든 내용은 한국어로 작성하세요`;

  const requestBody = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  };

  // ── Gemini 폴백 루프 ─────────────────────────────────────────────────────────
  // 429(한도 초과) · 404(미지원) 수신 시 다음 모델로 자동 전환
  type GeminiData = {
    candidates?: Array<{ content: { parts: Array<{ text: string }> }; finishReason?: string }>;
    error?: { message?: string };
  };

  let summary = '';
  let lastError = '';

  for (const model of GEMINI_MODELS) {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    let geminiRes: Response;
    let geminiData: GeminiData;
    try {
      geminiRes = await fetch(`${geminiUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      geminiData = await geminiRes.json() as GeminiData;
    } catch (e) {
      lastError = `${model} 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`;
      console.warn(`[naver-summarize] ${model} 네트워크 오류, 다음 모델로 폴백`);
      continue;
    }

    if (geminiRes.status === 429) {
      const errMsg = geminiData?.error?.message ?? '한도 초과';
      lastError = `${model} 429: ${errMsg.slice(0, 120)}`;
      console.warn(`[naver-summarize] ${model} 429 한도 초과, 다음 모델로 폴백`);
      const retryAfter = geminiRes.headers.get('retry-after');
      if (retryAfter) console.log(`[naver-summarize] retry-after: ${retryAfter}s`);
      continue;
    }

    if (geminiRes.status === 404) {
      lastError = `${model} 404 미지원`;
      console.warn(`[naver-summarize] ${model} 404 미지원, 다음 모델로 폴백`);
      continue;
    }

    if (!geminiRes.ok) {
      const errMsg = geminiData?.error?.message ?? JSON.stringify(geminiData).slice(0, 200);
      lastError = `${model} HTTP ${geminiRes.status}: ${errMsg}`;
      console.warn(`[naver-summarize] ${model} 실패:`, lastError);
      continue;
    }

    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) {
      const finishReason = geminiData?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
      lastError = `${model} 빈 응답 (finishReason: ${finishReason})`;
      console.warn(`[naver-summarize] ${model} 빈 응답, 다음 모델로 폴백`);
      continue;
    }

    summary = text;
    console.log(`[naver-summarize] ${model} 요약 성공`);
    break;
  }

  if (!summary) {
    return NextResponse.json(
      { error: `모든 Gemini 모델 실패. 마지막 오류: ${lastError}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ summary });
}
