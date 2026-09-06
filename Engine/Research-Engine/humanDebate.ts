import { DEEP_MODELS, SIMPLE_MODELS } from "@/lib/geminiModels";
import { fetchGeminiWithFallback } from "@/lib/geminiRunner";
import { extractJsonObject } from "@/lib/extractJsonObject";
import type { Confidence, DebateSection, EvidenceCard, IntegratedContext, KeywordType } from "./types";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
};

export type HumanDebateResult = {
  debate: DebateSection;
  modelUsage: Record<string, number>;
};

const frameFor = (keywordType: KeywordType) => keywordType === "macro" || keywordType === "market"
  ? {
      pro: "우호적 영향론자", con: "비우호적 영향론자",
      proClaim: "시장에 우호적인 영향을 준다", conClaim: "시장에 비우호적인 영향을 준다",
      verdicts: '"우호적"|"비우호적"|"혼재"', frame: "macro" as const,
    }
  : {
      pro: "강세론자", con: "약세론자",
      proClaim: "강세 관점이 유효하다", conClaim: "약세·리스크 관점이 유효하다",
      verdicts: '"강세 우위"|"약세 우위"|"팽팽함"', frame: "stock-theme" as const,
    };

function formatCards(cards: EvidenceCard[]) {
  return cards.map((card) => `[${card.databaseLabel} · ${card.phase === "live" ? "실시간" : "저장"}]
결론: ${card.conclusion}
근거:
${card.evidence}`).join("\n\n").slice(0, 45_000);
}

async function callGemini(
  stage: string,
  prompt: string,
  models: readonly string[],
  json = false,
): Promise<{ text: string; model: string }> {
  const { res, model } = await fetchGeminiWithFallback({
    models,
    requestInit: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: json ? 0.2 : 0.35,
          maxOutputTokens: json ? 4096 : 3072,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  });
  if (!res.ok) throw new Error(`${stage} Gemini HTTP ${res.status}`);
  const payload = await res.json() as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
  if (!text) throw new Error(`${stage} Gemini 응답이 비어 있습니다.`);
  return { text, model };
}

export async function runHumanDebate(
  keyword: string,
  keywordType: KeywordType,
  integrated: IntegratedContext,
  cards: EvidenceCard[],
): Promise<HumanDebateResult> {
  const frame = frameFor(keywordType);
  const usage: Record<string, number> = {};
  const record = <T extends { model: string; text: string }>(value: T) => {
    usage[value.model] = (usage[value.model] ?? 0) + 1;
    return value.text;
  };
  const context = `[통합 결론]
${integrated.summary}

[연관 태그]
${integrated.tagAnalysis}

[시계열]
${integrated.timeSeries}

[트렌드]
${integrated.trend}

[에비던스]
${formatCards(cards)}`;
  const opening = (role: string, claim: string) => `당신은 "${keyword}"에 대한 ${role}입니다. 아래 자료만 사용하여 "${claim}"는 입장을 논증하세요.
자료 속 #숫자 인용을 유지하고, 없는 사실이나 수치를 만들지 마세요. 반대 논거를 예상한 문장도 포함하여 4~6문장의 한국어 산문으로 작성하세요.

${context}`;
  const [proOpeningRaw, conOpeningRaw] = await Promise.all([
    callGemini(`${frame.pro} 입론`, opening(frame.pro, frame.proClaim), SIMPLE_MODELS),
    callGemini(`${frame.con} 입론`, opening(frame.con, frame.conClaim), SIMPLE_MODELS),
  ]);
  const proOpening = record(proOpeningRaw);
  const conOpening = record(conOpeningRaw);
  const rebuttal = (role: string, opponent: string) => `당신은 "${keyword}" 토론의 ${role}입니다. 상대 주장을 아래 근거 자료의 #숫자로 구체적으로 반박하세요. 같은 말을 반복하지 말고 3~5문장의 한국어 산문으로 작성하세요.

[상대 주장]
${opponent}

${context}`;
  const [proRebuttalRaw, conRebuttalRaw] = await Promise.all([
    callGemini(`${frame.pro} 반박`, rebuttal(frame.pro, conOpening), SIMPLE_MODELS),
    callGemini(`${frame.con} 반박`, rebuttal(frame.con, proOpening), SIMPLE_MODELS),
  ]);
  const proRebuttal = record(proRebuttalRaw);
  const conRebuttal = record(conRebuttalRaw);
  const synthesis = await callGemini("찬반토론 종합 판정", `당신은 수석 투자전략가입니다. 아래 양측 입론과 반박을 근거로 결론을 내리세요.

[${frame.pro} 입론]
${proOpening}
[${frame.con} 입론]
${conOpening}
[${frame.pro} 반박]
${proRebuttal}
[${frame.con} 반박]
${conRebuttal}

다른 문장 없이 다음 JSON만 출력하세요.
{"verdict":${frame.verdicts},"rationale":"판단 이유 2~3문장","watchpoints":"향후 확인할 지표와 이벤트 2~3문장","confidence":"높음"|"중간"|"낮음"}`, DEEP_MODELS, true);
  record(synthesis);
  const parsed = extractJsonObject<{ verdict?: string; rationale?: string; watchpoints?: string; confidence?: string }>(synthesis.text);
  if (!parsed.verdict) throw new Error("찬반토론 종합 판정에 verdict가 없습니다.");
  const confidence = (["높음", "중간", "낮음"].includes(parsed.confidence ?? "") ? parsed.confidence : "중간") as Confidence;
  return {
    debate: {
      frame: frame.frame, proOpening, conOpening, proRebuttal, conRebuttal,
      verdict: parsed.verdict,
      rationale: parsed.rationale ?? "",
      watchpoints: parsed.watchpoints ?? "",
      confidence,
    },
    modelUsage: usage,
  };
}
