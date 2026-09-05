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

type SectionKey = keyof ProposalDraftResponse;

const SECTION_ORDER: SectionKey[] = [
  "consultationBackground",
  "aiRationale",
  "existingPortfolioDiagnosis",
  "newPortfolioRationale",
];

interface RequestBody {
  draft: ProposalDraftResponse;
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

interface FactcheckResponse {
  ok: true;
  issues: Partial<Record<SectionKey, string>>;
  hasIssues: boolean;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY_FACTCHECK || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API 키(GEMINI_API_KEY_FACTCHECK 또는 GEMINI_API_KEY)가 .env.local에 설정되어 있지 않습니다." },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 파싱할 수 없습니다." }, { status: 400 });
  }

  const {
    draft,
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

  if (!draft) {
    return NextResponse.json({ error: "검증할 초안(draft)이 전달되지 않았습니다." }, { status: 400 });
  }

  const draftText = SECTION_ORDER.map(
    (key) => `[${draft[key]?.title ?? key}]\n${draft[key]?.content ?? ""}`,
  ).join("\n\n");

  const prompt = `
당신은 삼성증권 PB의 제안서 초안을 검증하는 팩트체크 담당자입니다.
아래 [원본 자료]는 실제 상담 및 분석 과정에서 나온 사실관계이고, [검증 대상 초안]은 다른 AI가 이 원본 자료를 바탕으로 작성한 제안서 초안입니다.

[검증 원칙]
- 초안의 각 섹션이 원본 자료로 뒷받침되지 않는 수치, 사실, 결론을 포함하고 있는지 확인할 것
- 원본에 없는 내용을 확대해석하거나 과장한 표현이 있는지 확인할 것
- "기존 포트폴리오 진단" 섹션에 신규 포트폴리오 정보가 섞여 있거나, "신규 포트폴리오 제안 근거" 섹션에 기존 진단만 반복되어 있는지도 확인할 것
- 초안 내용이 [고객 성향 및 특이사항]에 명시된 사실과 모순되는지 반드시 확인할 것 (예: 고객이 원하지 않는다고 밝힌 것을 제안하거나, 고객의 법적 제약을 무시하는 경우)
- 문제가 있는 섹션만 지적사항을 작성하고, 문제가 없는 섹션은 issues 객체에서 해당 키를 아예 생략할 것
- 지적사항은 1~2문장으로 구체적으로 작성할 것(어느 부분이 왜 문제인지)
- 반드시 아래 JSON 스키마 형식으로만 응답할 것(다른 설명 텍스트 없이 JSON만)

[고객명]
${customerName}

[원본 자료 - Smart Input 대화록]
${smartInputTranscript || "(제공되지 않음)"}

[원본 자료 - PB 추가 메모]
${additionalMemo || "(제공되지 않음)"}

[원본 자료 - AI 상담 가이드]
${aiConsultationGuide || "(제공되지 않음)"}

[원본 자료 - 기존 포트폴리오 진단 결과]
${(existingPortfolioDiagnosis || []).join("\n") || "(제공되지 않음)"}

[원본 자료 - 기존 포트폴리오 리스크 지표]
변동성: ${existingRiskMetrics?.volatility ?? "제공되지 않음"}, 샤프비율: ${existingRiskMetrics?.sharpeRatio ?? "제공되지 않음"}

[원본 자료 - 기존 포트폴리오 구성]
${existingAssetsSummary || "(제공되지 않음)"}

[원본 자료 - 신규 포트폴리오 진단 결과]
${(newPortfolioDiagnosis || []).join("\n") || "(제공되지 않음)"}

[원본 자료 - 신규 포트폴리오 리스크 지표]
변동성: ${newRiskMetrics?.volatility ?? "제공되지 않음"}, 샤프비율: ${newRiskMetrics?.sharpeRatio ?? "제공되지 않음"}

[원본 자료 - 신규 제안 포트폴리오 구성]
${newAssetsSummary || "(제공되지 않음)"}

[원본 자료 - 신규 포트폴리오 리밸런싱 근거]
${rebalancingNotes || "(제공되지 않음)"}

[원본 자료 - 고객 성향 및 특이사항]
${customerProfileSummary || "(제공되지 않음)"}

[검증 대상 초안]
${draftText}

[출력 JSON 스키마]
{
  "issues": {
    "consultationBackground": "문제가 있을 때만 이 키를 포함, 지적사항 텍스트",
    "aiRationale": "문제가 있을 때만 이 키를 포함, 지적사항 텍스트",
    "existingPortfolioDiagnosis": "문제가 있을 때만 이 키를 포함, 지적사항 텍스트",
    "newPortfolioRationale": "문제가 있을 때만 이 키를 포함, 지적사항 텍스트"
  }
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

    let parsed: { issues?: Partial<Record<SectionKey, string>> };
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 응답을 JSON으로 파싱하지 못했습니다.", raw: text }, { status: 502 });
    }

    const issues: Partial<Record<SectionKey, string>> = {};
    for (const key of SECTION_ORDER) {
      const value = parsed.issues?.[key];
      if (typeof value === "string" && value.trim()) {
        issues[key] = value.trim();
      }
    }

    const response: FactcheckResponse = {
      ok: true,
      issues,
      hasIssues: Object.keys(issues).length > 0,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `팩트체크 실행 실패: ${message}` }, { status: 500 });
  }
}