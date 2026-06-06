/**
 * /api/parse-portfolio
 * POST: PDF 파일 → pdf-parse 텍스트 추출 → Claude Structured Output → 표준 자산 JSON
 *
 * Request:  multipart/form-data { file: File, skipHealthCheck: 'true'|'false' }
 * Response: { assets: PortfolioAsset[], summary: string, confidence: 'high'|'medium'|'low' }
 */

import Anthropic from '@anthropic-ai/sdk';
import { createRequire } from 'module';

export const runtime = 'nodejs';

// pdf-parse is loaded lazily inside the handler to avoid DOMMatrix errors during build
function loadPdfParse() {
  const _require = createRequire(import.meta.url);
  return _require('pdf-parse');
}

// ── Claude Structured Output 스키마 ─────────────────────────
const PORTFOLIO_EXTRACTION_TOOL = {
  name:        'extract_portfolio',
  description: '자산 현황 문서에서 투자 포트폴리오 자산 목록을 표준 JSON으로 추출합니다.',
  input_schema: {
    type: 'object',
    properties: {
      assets: {
        type:  'array',
        items: {
          type:       'object',
          properties: {
            name: {
              type:        'string',
              description: '종목명 또는 티커 심볼 (예: 삼성전자, AAPL, QQQ)',
            },
            asset_class: {
              type: 'string',
              enum: ['국내주식', '해외주식', '국내채권', '해외채권', '금', '리츠', '현금', '달러'],
              description: '8대 표준 자산군',
            },
            theme: {
              type: 'string',
              enum: ['기술주', '반도체주', '금융주', '헬스케어주', '에너지주', '소비재주', '산업재주', 'ETF', '기타'],
              description: '세부 테마',
            },
            country: {
              type:        'string',
              description: '투자 국가 (예: 한국, 미국, 글로벌, 일본)',
            },
            buy_price: {
              type:        ['number', 'null'],
              description: '매수 단가. 원화 또는 해당 통화 기준. 불명확하면 null.',
            },
            amount: {
              type:        'number',
              description: '보유 수량(주수) 또는 보유 금액(원). amount_type 참조.',
            },
            amount_type: {
              type: 'string',
              enum: ['quantity', 'value'],
              description: '수량(quantity) 또는 금액(value) 여부',
            },
            is_hedged: {
              type:        'boolean',
              description: '환헤지 여부 (불명확하면 false)',
            },
            needs_review: {
              type:        'boolean',
              description: '핵심 정보가 불충분하여 사용자 검토가 필요하면 true',
            },
            review_reason: {
              type:        ['string', 'null'],
              description: 'needs_review가 true일 때 그 이유',
            },
          },
          required: ['name', 'asset_class', 'theme', 'country', 'amount', 'amount_type', 'is_hedged', 'needs_review'],
        },
      },
      summary: {
        type:        'string',
        description: '파싱 결과 요약 (총 자산 수, 주요 자산군 분포 등)',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: '전체 추출 신뢰도. 정보가 명확하면 high.',
      },
    },
    required: ['assets', 'summary', 'confidence'],
  },
};

// ── 시스템 프롬프트 ──────────────────────────────────────────
const SYSTEM_STRICT = `당신은 자산 현황 문서에서 투자 포트폴리오를 추출하는 금융 전문가입니다.
규칙:
- 종목명·티커가 명확한 경우에만 name 필드에 기입하고, 불명확하면 needs_review: true로 표시하세요.
- buy_price 또는 amount가 확인되지 않으면 null 또는 추정값 + needs_review: true.
- 자산군이 불명확한 경우 가장 유사한 군으로 배정하되 needs_review: true로 표시하세요.
- 모든 금액은 원화(KRW) 또는 해당 통화 기준으로 숫자만 입력하세요 (콤마, 단위 제거).
- 부동산은 '리츠' 또는 별도 항목으로 표시하고 amount_type: 'value'로 처리하세요.`;

const SYSTEM_SKIP = `당신은 자산 현황 문서에서 투자 포트폴리오를 추출하는 금융 전문가입니다.
규칙:
- 정보가 불완전하더라도 needs_review: false로 설정하고 가장 포괄적인 개념으로 자동 매핑하세요.
- 자산군 불명: '해외주식', 테마 불명: '기타', 국가 불명: '미국', is_hedged 불명: false.
- buy_price 불명: null, amount 불명: 0으로 처리하세요.
- 모든 자산을 8대 표준 자산군 중 하나로 반드시 분류하세요.
- 금액은 원화 기준 숫자로 변환하세요 (1억 → 100000000).`;

// ── Route Handler ────────────────────────────────────────────
export async function POST(request) {
  try {
    const formData        = await request.formData();
    const file            = formData.get('file');
    const skipHealthCheck = formData.get('skipHealthCheck') === 'true';

    if (!file) {
      return Response.json({ error: 'PDF 파일(file)이 필요합니다.' }, { status: 400 });
    }

    // ── 1. PDF → 텍스트 추출 ─────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);
    let pdfText       = '';

    try {
      const pdfParse = loadPdfParse();
      const parsed = await pdfParse(buffer, { max: 0 });
      pdfText = parsed.text ?? '';
    } catch (parseErr) {
      console.warn('[parse-portfolio] pdf-parse 실패, 원문 텍스트 시도:', parseErr?.message);
      pdfText = buffer.toString('utf-8').replace(/[^\x20-\x7E가-힣぀-ヿ一-鿿]/g, ' ');
    }

    if (!pdfText.trim()) {
      return Response.json({ error: 'PDF에서 텍스트를 추출할 수 없습니다. 스캔 이미지 PDF는 지원하지 않습니다.' }, { status: 422 });
    }

    // 텍스트가 너무 길면 토큰 절약을 위해 앞부분 우선 사용
    const truncatedText = pdfText.length > 12_000 ? pdfText.slice(0, 12_000) + '\n...(이하 생략)' : pdfText;

    // ── 2. Claude API Structured Output ──────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
    }

    const client  = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     skipHealthCheck ? SYSTEM_SKIP : SYSTEM_STRICT,
      messages:   [{
        role:    'user',
        content: `다음 자산 현황 문서에서 투자 포트폴리오 자산 목록을 추출하고 표준화하여 반환하세요.\n\n===== 문서 내용 =====\n${truncatedText}`,
      }],
      tools:       [PORTFOLIO_EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_portfolio' },
    });

    // ── 3. 응답 파싱 ─────────────────────────────────────────
    const toolUse = message.content.find(c => c.type === 'tool_use' && c.name === 'extract_portfolio');
    if (!toolUse) {
      return Response.json({ error: 'Claude 응답에서 구조화 데이터를 찾을 수 없습니다.' }, { status: 500 });
    }

    const { assets = [], summary = '', confidence = 'low' } = toolUse.input;

    // ── 4. 후처리: amount 숫자화 보장 ────────────────────────
    const normalizedAssets = assets.map(asset => ({
      ...asset,
      amount:    typeof asset.amount === 'number' ? asset.amount : parseFloat(String(asset.amount).replace(/[^0-9.]/g, '')) || 0,
      buy_price: asset.buy_price != null ? (typeof asset.buy_price === 'number' ? asset.buy_price : parseFloat(String(asset.buy_price).replace(/[^0-9.]/g, '')) || null) : null,
    }));

    return Response.json({ assets: normalizedAssets, summary, confidence });

  } catch (err) {
    console.error('[parse-portfolio] 서버 오류:', err);

    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: `Claude API 오류: ${err.message}` }, { status: 502 });
    }

    return Response.json({ error: err?.message ?? '서버 내부 오류' }, { status: 500 });
  }
}
