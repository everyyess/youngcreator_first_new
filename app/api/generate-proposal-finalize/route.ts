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
  issues: Partial<Record<SectionKey, string>>;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY_FINALIZE || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API 키(GEMINI_API_KEY_FINALIZE 또는 GEMINI_API_KEY)가 .env.local에 설정되어 있지 않습니다." },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 파싱할 수 없습니다." }, { status: 400 });
  }

  const { draft, issues } = body;

  if (!draft) {
    return NextResponse.json({ error: "반영할 초안(draft)이 전달되지 않았습니다." }, { status: 400 });
  }

  const issueKeys = SECTION_ORDER.filter((key) => issues?.[key]);

  if (issueKeys.length === 0) {
    return NextResponse.json({ ok: true, draft });
  }

  const issueText = issueKeys
    .map((key) => `[${draft[key]?.title ?? key}]\n지적사항: ${issues[key]}\n기존 내용: ${draft[key]?.content ?? ""}`)
    .join("\n\n");

  const untouchedText = SECTION_ORDER.filter((key) => !issueKeys.includes(key))
    .map((key) => `[${draft[key]?.title ?? key}]\n${draft[key]?.content ?? ""}`)
    .join("\n\n");

  const prompt = `
당신은 삼성증권 PB 제안서 초안을 수정하는 담당자입니다.
아래 [지적사항이 있는 섹션]은 팩트체크 담당자가 문제를 지적한 부분입니다. 지적사항을 반영해서 해당 섹션만 다시 작성하세요.
[지적사항이 없는 섹션]은 그대로 유지해서 결과에 포함하세요(내용을 바꾸지 말 것).

[작성 원칙]
- 공식 보고체(명사형 종결)로 작성, 구어체·줄임말 배제
- 추측이나 과장된 확신 표현 금지
- 지적사항이 지적한 문제만 고치고, 나머지 내용까지 임의로 바꾸지 말 것
- 반드시 아래 JSON 스키마 형식으로만 응답할 것(다른 설명 텍스트 없이 JSON만)

[지적사항이 있는 섹션]
${issueText}

[지적사항이 없는 섹션 - 그대로 유지]
${untouchedText || "(해당 없음)"}

[출력 JSON 스키마 - 4개 섹션 전부 포함, title은 원래 제목 그대로 유지]
{
  "consultationBackground": { "title": "...", "content": "..." },
  "aiRationale": { "title": "...", "content": "..." },
  "existingPortfolioDiagnosis": { "title": "...", "content": "..." },
  "newPortfolioRationale": { "title": "...", "content": "..." }
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

    let parsed: Partial<ProposalDraftResponse>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 응답을 JSON으로 파싱하지 못했습니다.", raw: text }, { status: 502 });
    }

    const finalDraft = {} as ProposalDraftResponse;
    for (const key of SECTION_ORDER) {
      finalDraft[key] = parsed[key] && parsed[key]?.content ? parsed[key]! : draft[key];
    }

    return NextResponse.json({ ok: true, draft: finalDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `최종본 반영 실패: ${message}` }, { status: 500 });
  }
}