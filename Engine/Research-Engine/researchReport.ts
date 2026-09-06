import { DEEP_MODELS } from "@/lib/geminiModels";
import { fetchGeminiWithFallback } from "@/lib/geminiRunner";
import type { EvidenceCard, KeywordType, SourceRef, UnifiedResearchResult } from "./types";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
};

export type GeneratedResearchReport = {
  markdown: string;
  mode: "ai" | "fallback";
  model?: string;
  warning?: string;
};

const DB_LABEL: Record<string, string> = {
  telegram: "텔레그램",
  news: "뉴스",
  report: "리포트",
  fred: "FRED",
  ecos: "ECOS",
  kosis: "KOSIS",
  technical: "기술적 분석",
  options: "옵션",
  holdings: "수급",
  dart: "공시",
  financials: "재무",
  correlation: "상관관계",
  peer: "경쟁사",
};

const TOC: Record<KeywordType, string> = {
  macro: `**세 줄 요약**
· 현재 상태와 핵심 배경
· 최근 방향과 전환 요인
· 시장과 고객 포트폴리오에 대한 함의

**1. 지표 현황과 배경**

**2. 전개 시계열**

**3. 자산군·섹터별 파급 경로**

**4. 우호적·비우호적 시나리오**

**5. PB 체크포인트**`,
  theme: `**세 줄 요약**
· 테마의 현재 상태
· 핵심 동인과 제약
· 투자 판단의 핵심

**1. 테마 현황과 핵심 동인**

**2. 최근 전개 시계열**

**3. 밸류체인과 주요 수혜 영역**

**4. 상승·하락 시나리오**

**5. PB 체크포인트**`,
  stock: `**세 줄 요약**
· 종목의 현재 상태
· 핵심 동인과 위험
· 투자 판단의 핵심

**1. 기업·주가 현황**

**2. 최근 전개 시계열**

**3. 펀더멘털과 수급**

**4. 상승·하락 시나리오**

**5. PB 체크포인트**`,
  overnight: `**세 줄 요약**
· 밤사이 시장 방향
· 주요 변동 요인
· 국내 시장 함의

**1. 글로벌 매크로 환경**

**2. 주요 자산 흐름**

**3. 국내 시장 파급 경로**

**4. 주요 위험 시나리오**

**5. PB 체크포인트**`,
  market: `**세 줄 요약**
· 시장의 현재 방향
· 주도 변수
· 다음 거래일 핵심

**1. 글로벌 매크로 환경**

**2. 국내외 시장 흐름**

**3. 섹터·수급 파급 경로**

**4. 상승·하락 시나리오**

**5. PB 체크포인트**`,
};

const cleanText = (value: string) => value
  .replace(/&middot;|&#183;|&#xB7;/gi, "·")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const numericCitation = (source: SourceRef) => {
  const number = source.id.match(/\d+/)?.[0] ?? "";
  return number ? `#${number}` : source.id;
};

function bibliography(sources: SourceRef[]) {
  return sources.map((source) => {
    const id = numericCitation(source);
    const label = DB_LABEL[source.database] ?? source.database;
    const phase = source.phase === "stored" ? "저장" : "실시간";
    const url = source.url ? ` — ${source.url}` : "";
    return `[${id}]: [${source.date || "날짜 미상"} · ${label} · ${phase}] ${cleanText(source.title)}${url}`;
  }).join("\n");
}

function sourceContext(result: UnifiedResearchResult) {
  const cards = [...result.storedCards, ...result.liveCards];
  return cards.map((card) => `[${card.databaseLabel} · ${card.phase === "stored" ? "저장" : "실시간"} · 기준일 ${card.asOfDate || "미상"}]
결론: ${card.conclusion}
근거:
${card.evidence}`).join("\n\n");
}

function debateContext(result: UnifiedResearchResult) {
  if (!result.debate) return "찬반토론 결과 없음";
  return `판정: ${result.debate.verdict} (확신도 ${result.debate.confidence})
찬성·우호 입론: ${result.debate.proOpening}
반대·비우호 입론: ${result.debate.conOpening}
찬성·우호 반박: ${result.debate.proRebuttal}
반대·비우호 반박: ${result.debate.conRebuttal}
종합 이유: ${result.debate.rationale}
관찰 포인트: ${result.debate.watchpoints}`;
}

function reportPrompt(result: UnifiedResearchResult) {
  const type = result.keywordType ?? "theme";
  return `당신은 PB에게 전달할 한국어 투자 리서치 보고서를 작성하는 선임 애널리스트입니다.
아래에 제공된 근거만 사용해 "${result.keyword}" 보고서를 작성하세요. 기사 제목을 단순 나열하지 말고, 서로 연결해 현재 국면·전개 방향·파급 경로·조건부 시나리오를 분석하세요.

필수 규칙:
1. 아래 목차를 모두 채우고, 전체 본문은 최소 1,500자 이상 작성합니다.
2. 근거 자료의 보도·주장을 사용한 문장 끝에는 [인용][#숫자]를 붙입니다.
3. 근거를 연결해 해석한 문장 끝에는 [판단(숫자)]를 붙이고, 맨 끝의 **판단 근거**에 같은 번호의 근거를 설명합니다.
4. 근거에 없는 수치나 사실을 만들지 않습니다. 자료가 부족한 부분은 부족하다고 분명히 쓰되, 확인 가능한 내용에서 도출되는 조건부 함의를 설명합니다.
5. "자료 N건을 통합했다" 같은 처리 과정 설명이나 기사 제목 목록으로 본문을 대신하지 않습니다.
6. 각 시나리오는 트리거, 전개 경로, 자산군 영향을 함께 씁니다.
7. PB 체크포인트는 앞으로 확인할 지표·이벤트와, 결과별 포트폴리오 대응을 4개 이상 제시합니다.
8. 마크다운 구분선은 사용하지 않습니다.

출력 목차:
${TOC[type]}

**판단 근거**
[판단(1)]: ...

[통합 분석]
${result.integrated.summary}
${result.integrated.tagAnalysis}
${result.integrated.timeSeries}
${result.integrated.trend}

[Gemini 찬반토론 검증]
${debateContext(result)}

[근거 자료]
${sourceContext(result)}`;
}

function normalizeAiReport(raw: string, sources: SourceRef[]) {
  const body = raw
    .replace(/^\s*```(?:markdown)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .replace(/\[S(\d+)\]/g, "[#$1]")
    .replace(/\(S(\d+)\)/g, "(#$1)")
    .replace(/\[((?:#?\d+\s*,\s*)+#?\d+)\]/g, (_match, ids: string) =>
      ids.split(",").map((id) => `[#${id.replace(/\D/g, "")}]`).join(""))
    .replace(/\[Fact\]/gi, "[팩트]")
    .trim();
  return `${body}\n\n**출처**\n${bibliography(sources)}`;
}

function validReport(report: string, type: KeywordType, sourceCount: number) {
  const structuralSignals = [
    /세\s*줄\s*요약|핵심\s*요약/,
    type === "macro" ? /현황|배경|금리|지표/ : /현황|배경|개요/,
    /시계열|전개|흐름|추이/,
    /파급|자산군|섹터|밸류체인|수급/,
    /시나리오|상방|하방|우호적|비우호적/,
    /체크포인트|관찰|모니터링/,
    /판단\s*근거/,
  ].filter((pattern) => pattern.test(report)).length;
  const headingCount = [...report.matchAll(/^\s*(?:\*\*)?(?:\d+\.|세\s*줄|핵심|판단\s*근거)/gm)].length;
  const citationCount = new Set([...report.matchAll(/#(\d+)/g)].map((match) => match[1])).size;
  return report.length >= 1_000
    && structuralSignals >= 6
    && headingCount >= 5
    && (sourceCount === 0 || citationCount >= Math.min(3, sourceCount));
}

function latestSources(result: UnifiedResearchResult, count = 6) {
  return [...result.sources]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, count);
}

function evidenceSnippets(result: UnifiedResearchResult) {
  const snippets = new Map<string, string>();
  for (const card of [...result.storedCards, ...result.liveCards]) {
    const lines = card.evidence.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const id = lines[index].match(/^-\s*\[(#\d+)\]/)?.[1];
      if (!id) continue;
      const detail: string[] = [];
      for (let next = index + 1; next < lines.length && !/^-\s*\[#\d+\]/.test(lines[next]); next += 1) {
        const text = cleanText(lines[next]);
        if (text) detail.push(text);
      }
      const snippet = cleanText(detail.join(" ")).slice(0, 320);
      if (snippet && !/제목 기반 자료/.test(snippet)) snippets.set(id, snippet);
    }
  }
  return snippets;
}

function quoted(source: SourceRef, snippets?: Map<string, string>) {
  const id = numericCitation(source);
  const title = cleanText(source.title);
  const snippet = snippets?.get(id);
  return snippet
    ? `${title}와 관련해 ${snippet} [인용][${id}]`
    : `${title}라는 이슈가 확인됩니다. [인용][${id}]`;
}

/** Gemini 장애 때도 제목 목록만 출력하지 않도록 근거와 조건부 해석을 담은 완전한 보고서를 만든다. */
export function buildEvidenceFallbackReport(result: UnifiedResearchResult): string {
  const recent = latestSources(result);
  const snippets = evidenceSnippets(result);
  const first = recent[0];
  const second = recent[1] ?? first;
  const third = recent[2] ?? second;
  const timeline = [...result.sources]
    .filter((source) => source.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8)
    .map((source) => `${source.date}: ${quoted(source, snippets)}`)
    .join("\n\n");
  const core = recent.slice(0, 5).map((source) => quoted(source, snippets)).join("\n\n")
    || "현재 선택 조건에서 확인된 근거 자료가 없어 추가 수집이 필요합니다.";

  return `# ${result.keyword} 통합 리서치

**세 줄 요약**
· ${first ? quoted(first, snippets) : "현재 상태를 판정할 직접 근거가 부족합니다. [판단(1)]"}
· ${second ? quoted(second, snippets) : "단일 방향을 확정하기보다 추가 자료를 확인해야 합니다. [판단(2)]"}
· ${third ? quoted(third, snippets) : "PB는 핵심 지표 확인 전까지 조건부 대응을 유지해야 합니다. [판단(3)]"}

**1. 지표 현황과 배경**
${core}

수집된 자료는 "${result.keyword}" 자체의 절대 수준보다 정책 기대, 채권시장 가격, 경기와 물가 신호가 어떻게 함께 움직이는지를 확인해야 한다는 점을 보여줍니다. [판단(1)]

**2. 전개 시계열**
${timeline || "날짜가 확인되는 자료가 없어 국면 전개를 확정하기 어렵습니다. [판단(2)]"}

시간 순서상 같은 방향의 제목이 반복되는지, 반대 방향의 새로운 재료가 등장하는지를 구분해야 추세 지속과 단기 노이즈를 나눌 수 있습니다. [판단(2)]

**3. 자산군·섹터별 파급 경로**
금리 기대가 높아지는 경우 채권 가격에는 하방 압력, 장기 현금흐름의 현재가치에 민감한 성장주에는 밸류에이션 부담이 커질 수 있습니다. 반대로 금리 기대가 낮아지면 해당 경로가 완화될 수 있습니다. [판단(3)]

환율과 금융주의 반응은 금리의 방향만으로 결정되지 않고, 변화 원인이 경기 개선인지 물가 압력인지에 따라 달라질 수 있으므로 원인과 시장 반응을 함께 확인해야 합니다. [판단(4)]

**4. 우호적·비우호적 시나리오**
우호적 시나리오는 물가 압력이 완화되면서 경기 훼손 없이 금리 부담이 낮아지는 경우입니다. 이때 채권과 성장주의 할인율 부담이 완화되는지 확인해야 합니다. [판단(5)]

비우호적 시나리오는 물가 또는 재정 우려로 금리 기대가 재상승하거나, 경기 둔화가 예상보다 빠르게 나타나는 경우입니다. 전자는 밸류에이션 부담을, 후자는 실적 전망 하향 위험을 키울 수 있습니다. [판단(6)]

${result.debate ? `**AI 찬반토론 검증**
최종 판정은 **${result.debate.verdict}**이며 확신도는 ${result.debate.confidence}입니다. ${result.debate.rationale}

우호·강세 측은 ${result.debate.proOpening}

비우호·약세 측은 ${result.debate.conOpening}

상호 반박 뒤 확인할 핵심 변수는 다음과 같습니다. ${result.debate.watchpoints}` : ""}

**5. PB 체크포인트**
1. 중앙은행의 정책 신호와 시장의 금리 경로 기대가 같은 방향인지 확인합니다. [판단(7)]
2. 장단기 금리와 환율이 함께 움직이는지 확인해 충격의 성격을 구분합니다. [판단(8)]
3. 물가·고용·성장 지표 발표 뒤 채권과 주식의 반응이 기존 국면을 강화하는지 확인합니다. [판단(9)]
4. 고객 포트폴리오의 듀레이션, 성장주 비중, 환 노출을 시나리오별로 점검합니다. [판단(10)]

**판단 근거**
[판단(1)]: 수집 자료가 정책 기대와 시장금리 관련 이슈를 함께 다루므로 방향뿐 아니라 변화 원인의 확인이 필요합니다.
[판단(2)]: 제목과 작성일만으로 추세를 확정할 수 없어 후속 자료와 시장 반응의 연속성을 확인해야 합니다.
[판단(3)]: 금리는 미래 현금흐름의 할인율과 채권 가격에 직접 영향을 주는 핵심 변수입니다.
[판단(4)]: 동일한 금리 변화도 경기·물가·수급 원인에 따라 환율과 금융주의 반응이 달라질 수 있습니다.
[판단(5)]: 물가 안정과 경기 연착륙이 동시에 나타날 때 금리 하락의 위험자산 우호 효과가 가장 뚜렷합니다.
[판단(6)]: 금리 상승과 경기 둔화는 각각 할인율과 이익 전망을 통해 다른 하방 경로를 만듭니다.
[판단(7)]: 정책 발언과 시장 가격의 괴리는 향후 변동성의 원인이 될 수 있습니다.
[판단(8)]: 장단기 금리와 환율의 동행 여부는 국내 자산의 외국인 수급 판단에 중요합니다.
[판단(9)]: 지표 발표 뒤 가격 반응은 시장이 이미 반영한 기대와 새 정보의 차이를 보여줍니다.
[판단(10)]: 고객별 민감도는 자산 구성과 투자 기간에 따라 달라 일률적 대응보다 노출 점검이 우선입니다.

**출처**
${bibliography(result.sources)}`;
}

export async function generateResearchReport(result: UnifiedResearchResult): Promise<GeneratedResearchReport> {
  if (!result.sources.length) {
    return { markdown: buildEvidenceFallbackReport(result), mode: "fallback", warning: "분석 가능한 출처가 없습니다." };
  }
  try {
    const call = async (prompt: string) => {
      const { res, model } = await fetchGeminiWithFallback({
        models: DEEP_MODELS,
        requestInit: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
          }),
        },
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = await res.json() as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
      if (!text) throw new Error("Gemini 응답이 비어 있습니다.");
      return { text, model };
    };

    let generated = await call(reportPrompt(result));
    let markdown = normalizeAiReport(generated.text, result.sources);
    if (!validReport(markdown, result.keywordType, result.sources.length)) {
      generated = await call(reportPrompt(result) + "\n\n방금 출력은 분량 또는 목차·각주가 부족했습니다. 모든 목차를 빠짐없이 1,500자 이상으로 다시 작성하세요.");
      markdown = normalizeAiReport(generated.text, result.sources);
    }
    if (!validReport(markdown, result.keywordType, result.sources.length)) {
      return {
        markdown: buildEvidenceFallbackReport(result),
        mode: "fallback",
        model: generated.model,
        warning: "AI 출력의 목차·분량·인용 검증에 실패해 근거 기반 보고서로 대체했습니다.",
      };
    }
    return { markdown, mode: "ai", model: generated.model };
  } catch (error) {
    return {
      markdown: buildEvidenceFallbackReport(result),
      mode: "fallback",
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}
