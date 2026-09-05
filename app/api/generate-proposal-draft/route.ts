import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

interface ProposalDraftSection {
  title: string;
  content: string;
}

interface ProposalDraftResponse {
  consultationBackground: ProposalDraftSection;
  aiRationale: ProposalDraftSection;
  existingPortfolioDiagnosis: ProposalDraftSection;
  newPortfolioRationale: ProposalDraftSection;
}

interface RequestBody {
  customerName: string;
  smartInputTranscript?: string;
  additionalMemo?: string;
  aiConsultationGuide?: string;
  existingPortfolioDiagnosis?: string[];
  newPortfolioDiagnosis?: string[];
  existingRiskMetrics?: { volatility?: number; sharpeRatio?: number };
  newRiskMetrics?: { volatility?: number; sharpeRatio?: number };
  rebalancingNotes?: string;
  existingAssetsSummary?: string;
  newAssetsSummary?: string;
  customerProfileSummary?: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini API 키(GEMINI_API_KEY)가 .env.local에 설정되어 있지 않습니다." }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 파싱할 수 없습니다." }, { status: 400 });
  }

  const {
    customerName,
    smartInputTranscript,
    additionalMemo,
    aiConsultationGuide,
    existingPortfolioDiagnosis,
    newPortfolioDiagnosis,
    existingRiskMetrics,
    newRiskMetrics,
    rebalancingNotes,
    existingAssetsSummary,
    newAssetsSummary,
    customerProfileSummary,
  } = body;

  const prompt = `
당신은 삼성증권 PB(프라이빗 뱅커)를 보조하는 제안서 초안 작성 도우미입니다.
아래 상담 자료를 바탕으로, 고객에게 전달할 "포트폴리오 제안서"의 4개 섹션 초안을 작성하세요.

[작성 원칙]
- 상담 중 오간 구어체·비속어·잡담을 그대로 옮기지 말고, 공식 보고서 문체(명사형 종결, 정중체)로 정제할 것
- 추측이나 과장된 확신 표현("반드시", "확실히 오릅니다" 등)은 쓰지 말 것
- 각 섹션은 3~6문장 내외로 간결하게 작성할 것
- 숫자나 데이터가 주어지지 않은 부분은 임의로 지어내지 말고, 주어진 자료 범위 내에서만 작성할 것
- "기존 포트폴리오 진단" 섹션은 기존 포트폴리오 진단 결과와 기존 리스크 지표만 근거로 쓸 것
- "신규 포트폴리오 제안 근거" 섹션은 신규 포트폴리오 진단 결과, 신규 리스크 지표, 리밸런싱 근거를 함께 반영하여 기존 대비 무엇이 개선되는지 비교 서술할 것
- 반드시 아래 JSON 스키마 형식으로만 응답할 것 (다른 설명 텍스트 없이 JSON만)

[고객명]
${customerName}

[상담 중 Smart Input 대화록]
${smartInputTranscript || "(제공되지 않음)"}

[PB 추가 메모]
${additionalMemo || "(제공되지 않음)"}

[AI 상담 가이드 (상담 중 생성됨)]
${aiConsultationGuide || "(제공되지 않음)"}

[기존 포트폴리오 진단 결과]
${(existingPortfolioDiagnosis || []).join("\n") || "(제공되지 않음)"}

[기존 포트폴리오 리스크 지표]
변동성: ${existingRiskMetrics?.volatility ?? "제공되지 않음"}, 샤프비율: ${existingRiskMetrics?.sharpeRatio ?? "제공되지 않음"}

[기존 포트폴리오 구성]
${existingAssetsSummary || "(제공되지 않음)"}

[신규 포트폴리오 진단 결과]
${(newPortfolioDiagnosis || []).join("\n") || "(제공되지 않음)"}

[신규 포트폴리오 리스크 지표]
변동성: ${newRiskMetrics?.volatility ?? "제공되지 않음"}, 샤프비율: ${newRiskMetrics?.sharpeRatio ?? "제공되지 않음"}

[신규 제안 포트폴리오 구성]
${newAssetsSummary || "(제공되지 않음)"}

[신규 포트폴리오 리밸런싱 근거]
${rebalancingNotes || "(제공되지 않음)"}

[고객 성향 및 특이사항 — 상담 중 확인된 사실. 이 내용과 모순되는 서술은 절대 작성하지 말 것]
${customerProfileSummary || "(제공되지 않음)"}

[출력 JSON 스키마]
{
  "consultationBackground": { "title": "상담 배경 및 고객 니즈", "content": "..." },
  "aiRationale": { "title": "제안 논리 및 근거", "content": "..." },
  "existingPortfolioDiagnosis": { "title": "기존 포트폴리오 진단", "content": "..." },
  "newPortfolioRationale": { "title": "신규 포트폴리오 제안 근거", "content": "..." }
}
`.trim();

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let parsed: ProposalDraftResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 응답을 JSON으로 파싱하지 못했습니다.", raw: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true, draft: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `AI 초안 생성 실패: ${message}` }, { status: 500 });
  }
}