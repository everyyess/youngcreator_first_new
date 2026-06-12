import { NextResponse } from "next/server";

type SectionPayload = Record<string, string | string[] | boolean | null | undefined>;

type ExtractionEnvelope = {
  extracted: {
    profile: SectionPayload;
    financialProfile: SectionPayload;
    rrttllu: SectionPayload;
  };
  inferred: {
    profile: SectionPayload;
    financialProfile: SectionPayload;
    rrttllu: SectionPayload;
  };
  unmapped: string[];
  notes: string[];
  confidence: Record<string, number>;
};

type GeminiExtractionResult = {
  source: "gemini" | "mock";
  fallback?: boolean;
  fallbackReason?: string;
  retryDelay?: number;
  quotaLimit?: number;
  estimatedUsageToday?: number;
  estimatedRemainingToday?: number;
  data: ExtractionEnvelope;
  debug?: {
    prompt?: string;
    rawResponse?: unknown;
    rawTextBeforeParse?: string;
    parsedBeforeMapping?: unknown;
    usedFallbackReason?: string;
  };
};

const GEMINI_FREE_TIER_DAILY_LIMIT = 20;

class GeminiExtractionError extends Error {
  reason: string;
  details?: unknown;

  constructor(reason: string, message: string, details?: unknown) {
    super(message);
    this.name = "GeminiExtractionError";
    this.reason = reason;
    this.details = details;
  }
}

const options = {
  returnObjective: [
    "적극적 수익 추구",
    "시장수익률 수준의 수익 추구",
    "예금, 채권이자 수준의 안정적 수익 추구",
    "원금 보존 투자",
  ],
  investmentExperience: [
    "ELW, 선물옵션, 주식신용거래, 파생상품 펀드",
    "주식, 주식형펀드, 원금비보장ELS, 고위험회사채",
    "혼합형펀드, 원금부분보장ELS, 일반 회사채",
    "은행 예/적금, 채권형펀드, 원금지급형ELB, 금융채",
    "금융상품에 투자해 본 경험 없음",
  ],
  knowledgeLevel: [
    "금융상품을 잘 이해하며 스스로 의사결정 가능",
    "금융상품을 이해하며 설명 듣고 의사결정 가능",
    "서로 다른 금융상품을 구별할 수 있음",
    "금융상품에 대해 전혀 모름",
  ],
  derivativesExperience: ["3년 이상", "2년 이상", "1년 이상", "1년 미만", "없음"],
  financialAssetRatio: ["10% 미만", "10~25% 미만", "25~50% 미만", "50~75% 미만", "75% 이상"],
  investmentAssetRatio: ["10% 미만", "10~20% 미만", "20~30% 미만", "30~40% 미만", "40% 이상"],
  riskAttitude: [
    "고수익의 기회를 위해 큰 폭의 손실 가능성도 받아들일 수 있음",
    "수익을 기대할 수 있다면 일정 수준의 손실을 수용할 수 있음",
    "일부 손실은 감수할 수 있으나, 전체적인 안정성이 중요",
    "원금 보전을 최우선으로 하며 손실 가능성을 원하지 않음",
  ],
  lossResponse: ["신규 자금 추가 투자", "관망", "일부 환매", "전액 환매 또는 계약 해지"],
  timeHorizon: ["5년 이상", "3~5년", "2~3년", "1~2년", "1년 미만"],
  giftingPlan: ["없음", "검토 중", "있음"],
  taxImportance: ["아니오", "보통", "매우 중요"],
  recentTax: ["예", "아니오", "모름"],
  legalConstraints: ["없음", "임직원 매매 제한", "기타"],
};

const emptyEnvelope = (): ExtractionEnvelope => ({
  extracted: { profile: {}, financialProfile: {}, rrttllu: {} },
  inferred: { profile: {}, financialProfile: {}, rrttllu: {} },
  unmapped: [],
  notes: [],
  confidence: {},
});

const stringField = { type: "string", nullable: true };
const stringArrayField = { type: "array", items: { type: "string" }, nullable: true };
const booleanField = { type: "boolean", nullable: true };
const profileSchema = {
  type: "object",
  properties: {
    name: stringField,
    gender: stringField,
    birthYear: stringField,
    birth_year: stringField,
    age: stringField,
    job: stringField,
  },
};
const financialProfileSchema = {
  type: "object",
  properties: {
    totalAssets: stringField,
    financialAssets: stringField,
    realEstate: stringField,
    debt: stringField,
    annualFixedIncome: stringField,
    monthlyFixedExpense: stringField,
    irregularIncome: stringField,
    irregularIncomeNone: booleanField,
    investableAssets: stringField,
  },
};
const rrttlluSchema = {
  type: "object",
  properties: {
    returnObjective: stringField,
    expectedReturn: stringField,
    expectedReturnUnknown: booleanField,
    investmentExperience: stringArrayField,
    knowledgeLevel: stringField,
    derivativesExperience: stringField,
    financialAssetRatio: stringField,
    investmentAssetRatio: stringField,
    riskAttitude: stringField,
    lossResponse: stringField,
    timeHorizon: stringField,
    giftingPlan: stringField,
    globalTaxImportance: stringField,
    recentGlobalTaxSubject: stringField,
    foreignStockTaxImportance: stringField,
    regularCashflowNeed: stringField,
    lumpSumPlan: stringField,
    emergencyReservePlan: stringField,
    legalConstraints: stringArrayField,
    legalConstraintOther: stringField,
    preferredAssets: stringField,
    avoidedAssets: stringField,
    holdingOrDisposalPlan: stringField,
    uniqueOther: stringField,
  },
};

const responseSchema = {
  type: "object",
  properties: {
    extracted: {
      type: "object",
      properties: {
        profile: profileSchema,
        financialProfile: financialProfileSchema,
        rrttllu: rrttlluSchema,
      },
      required: ["profile", "financialProfile", "rrttllu"],
    },
    inferred: {
      type: "object",
      properties: {
        profile: profileSchema,
        financialProfile: financialProfileSchema,
        rrttllu: rrttlluSchema,
      },
      required: ["profile", "financialProfile", "rrttllu"],
    },
    unmapped: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
    confidence: { type: "object" },
  },
  required: ["extracted", "inferred", "unmapped", "notes", "confidence"],
};

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return (match[1] ?? match[0]).trim();
  }
  return null;
}

function addConfidence(result: ExtractionEnvelope, key: string, score: number) {
  result.confidence[key] = score;
}

function normalizeReturnRange(value: string) {
  return value.replace(/\s+/g, "").replace(/^연/, "").replace(/%$/, "") + "%";
}

function extractExpectedReturn(text: string) {
  const percent = String.raw`\d+(?:\.\d+)?(?:\s*[~\-]\s*\d+(?:\.\d+)?)?\s*%`;
  return firstMatch(text, [
    new RegExp(`(?:기대\\s*수익률|목표\\s*수익률|수익\\s*목표)(?:은|은\\s*연|\\s*연)?\\s*(${percent})`),
    new RegExp(`(?:기대\\s*수익률|목표\\s*수익률|수익\\s*목표)[^.;\\n]{0,12}?(${percent})`),
    new RegExp(`연\\s*(${percent})\\s*(?:수익|수익률|수준|목표|기대)`),
    new RegExp(`(${percent})\\s*(?:수준의\\s*)?(?:수익|수익률)\\s*(?:목표|기대)`),
  ]);
}

function extractAmountNear(text: string, labelPattern: string) {
  return firstMatch(text, [
    new RegExp(`${labelPattern}[^.;\\n]*?((?:약\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억|천만|백만|만)?\\s*원?(?:\\s*[~\\-]\\s*\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억|천만|백만|만)?\\s*원?)?(?:\\s*이상|\\s*수준|\\s*예상)?)`),
  ]);
}

function splitMemoClauses(text: string) {
  return text
    .split(/(?<!\d),(?!\d)|[.;\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function extractClauseContaining(text: string, pattern: RegExp, includeNext?: RegExp) {
  const clauses = splitMemoClauses(text);
  const index = clauses.findIndex((clause) => pattern.test(clause));
  if (index < 0) return null;
  const picked = [clauses[index]];
  const next = clauses[index + 1];
  if (next && includeNext?.test(next)) picked.push(next);
  return picked.join(", ");
}

function collectCandidateNotes(text: string) {
  const importantPattern =
    /(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?|\d+(?:\.\d+)?(?:\s*[~\-]\s*\d+(?:\.\d+)?)?\s*%|수십억|수백억|성과급|스톡옵션|매각|자금\s*유입|유학|등록금|생활비|현금\s*흐름|현금흐름|월급\s*외|노후\s*생활비|은퇴\s*후\s*생활비|배당\s*기반|세금|절세|증여|금융소득종합과세|금융종합소득세|임직원|자사주|선행\s*매매|매매\s*제한|전략기획|공격적|고위험|초저위험|원금\s*보전|레버리지|신중|선호|기피|피하고|관심|외화자산|부동산|주식|채권|ETF|암호화폐|가상자산|Time horizon|투자\s*시계|자산\s*집중|벤치마크|본업이\s*바빠|보유\s*지분\s*가치|배우자|가족|부모님|부모\s*부양|교육비|시장\s*뉴스|단기\s*이슈|민감|예민|꼼꼼|의심|성격|급함|질문|설명\s*선호|의사결정|심리|성향|모니터링|관리\s*시간|기존\s*PB|PB\s*서비스|불만족)/i;
  return splitMemoClauses(text)
    .filter((clause) => importantPattern.test(clause))
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function uniqueOtherMeaningKey(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (/크게흔들리지않|민감하지않|예민하지않/.test(compact)) return "market-stable";
  if (/빠르지않|급하지않|속도가빠르지않/.test(compact)) return "not-fast-decision";
  if (/시장뉴스|단기이슈|민감|예민/.test(compact)) return "market-sensitivity";
  if (/의사결정.*빠|결정.*빠|성격.*급|급함/.test(compact)) return "fast-decision";
  if (/꼼꼼|질문.*많|의심|충분한설명|설명선호/.test(compact)) return "explanation-detail";
  if (/배우자/.test(compact)) return "spouse-influence";
  if (/가족|자녀|교육비/.test(compact)) return "family-education";
  if (/부모|부양|의료비|돌봄/.test(compact)) return "parent-support";
  if (/레버리지|급등주|손실|수익률.*훼손|망가진/.test(compact)) return "past-loss";
  if (/벤치마크|포트폴리오.*부진|수익률.*낮/.test(compact)) return "portfolio-underperformance";
  if (/모니터링|관리시간|본업이바빠|주도주편입/.test(compact)) return "monitoring-time";
  if (/기존PB|PB서비스|불만족/.test(compact)) return "pb-experience";
  return compact.replace(/[^\p{Script=Hangul}a-zA-Z0-9]/gu, "").slice(0, 36);
}

function hasNegatedTrait(compactClause: string, traitPatterns: RegExp[]) {
  const negativePattern = /않|아니|아님|없음|없는|없다|적음|적은|낮음|낮은|덜함|덜한|크지않|많지않|높지않|강하지않/;
  if (!negativePattern.test(compactClause)) return false;
  return traitPatterns.some((pattern) => pattern.test(compactClause));
}

function summarizeQualitativeClause(clause: string) {
  const compact = clause.replace(/\s+/g, "");
  const marketTraitPatterns = [/시장뉴스/, /단기이슈/, /민감/, /예민/];
  const fastDecisionTraitPatterns = [/의사결정.*빠/, /결정.*빠/, /성격.*급/, /급함/, /급하/];
  const explanationTraitPatterns = [/의심/, /질문.*많/];

  if (hasNegatedTrait(compact, marketTraitPatterns)) return "시장 뉴스와 단기 이슈에 크게 흔들리지 않는 편";
  if (/시장\s*뉴스|단기\s*이슈|민감|예민/.test(clause)) return "시장 뉴스와 단기 이슈에 민감하게 반응";
  if (hasNegatedTrait(compact, fastDecisionTraitPatterns)) return "투자 의사결정 속도가 빠르지 않은 편";
  if (/의사결정.*빠|결정.*빠|성격.*급|급함/.test(clause)) return "투자 의사결정 속도가 빠름";
  if (/꼼꼼/.test(clause)) return "투자 의사결정 전 정보와 근거를 꼼꼼히 확인하는 성향";
  if (hasNegatedTrait(compact, explanationTraitPatterns)) return "";
  if (/의심|질문.*많|충분한\s*설명|설명\s*선호/.test(clause)) return "투자 결정 전 충분한 설명과 근거를 선호";
  if (/배우자/.test(clause)) return "배우자의 투자 의사결정 영향력이 큰 편";
  if (/자녀.*교육비|교육비|유학/.test(clause)) return "자녀 교육비 관련 재무 부담 또는 지출 계획 존재";
  if (/부모님|부모\s*부양|부양|고령\s*부모|돌봄|의료비/.test(clause)) return "부모 부양 또는 고령 부모 관련 재무 이슈 가능성";
  if (/레버리지|급등주|손실|망가진|수익률.*훼손/.test(clause)) return "과거 공격적 투자 또는 레버리지 투자로 손실 경험 존재";
  if (/벤치마크|포트폴리오.*부진|수익률.*낮|불만족/.test(clause)) return "기존 포트폴리오 성과에 대한 불만 또는 개선 니즈 존재";
  if (/모니터링|관리\s*시간|본업이\s*바빠|주도주\s*편입/.test(clause)) return "자산 모니터링 또는 적극적 투자 관리 시간이 부족한 편";
  if (/기존\s*PB|PB\s*서비스|새로운\s*PB|PB.*불만/.test(clause)) return "기존 PB 서비스 이용 경험 또는 불만족 맥락 존재";
  return "";
}

function mergeUniqueOtherValues(...sources: unknown[]) {
  const byMeaning = new Map<string, string>();
  sources
    .flatMap((source) => typeof source === "string" ? source.split(/\n/) : [])
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = uniqueOtherMeaningKey(item);
      if (!byMeaning.has(key)) byMeaning.set(key, item);
    });
  return Array.from(byMeaning.values()).join("\n");
}

function enrichUniqueOther(data: ExtractionEnvelope, originalText: string) {
  const candidates = [
    ...splitMemoClauses(originalText),
    ...(data.notes ?? []),
    ...(data.unmapped ?? []),
  ];
  const summarized = candidates
    .map(summarizeQualitativeClause)
    .filter(Boolean);
  if (!summarized.length) return data;
  data.extracted.rrttllu.uniqueOther = mergeUniqueOtherValues(data.extracted.rrttllu.uniqueOther, summarized.join("\n"));
  return data;
}

function cleanAssetCandidate(value: string) {
  return value
    .replace(/\([^)]*(?:이유|원인|때문|취약|위험|필요|선호|요구|관심|투자|편입|보유)[^)]*\)/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^(?:(?:자산|선호|선호하는|기피|피하고 싶은|관심|투자|편입|요구|보유|매입|및|등에|등|기존|막대한)\s*)+/g, "")
    .replace(/(?:금융자산|총자산|총 자산)\s*[\d,.]+\s*(?:억|천만|백만|만)?\s*원?\s*\+?\s*/g, "")
    .replace(/\s*[\d,.]+\s*(?:억|천만|백만|만)\s*원?.*$/g, "")
    .replace(/(?:등에\s*)?(?:관심|선호|요구|편입|투자|보유|매입).*$/g, "")
    .replace(/(예금|적금|부동산|암호화폐|가상자산|외화자산|주식|채권|국채|회사채)(?:을|를|이|가|은|는)?.*$/g, "$1")
    .replace(/\s*매매$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAssetCandidates(text: string) {
  const candidates = new Set<string>();
  const assetKeyword = /(ETF|MMF|ELS|ELB|REITs|리츠|주식|채권|국채|회사채|예금|적금|부동산|암호화폐|가상자산|외화자산|달러|레버리지)/;
  const preferenceSignal = /(관심|선호|편입|요구|보유|매입|투자|피하고|기피)/;
  const clauses = splitMemoClauses(text);

  clauses.forEach((clause, index) => {
    if (/신중|피하고|기피|원하지 않|제외|제한/.test(clause)) return;
    const hasNearbyPreference =
      preferenceSignal.test(clause) ||
      preferenceSignal.test(clauses[index - 1] ?? "") ||
      preferenceSignal.test(clauses[index + 1] ?? "");
    if (!hasNearbyPreference || !assetKeyword.test(clause)) return;
    clause
      .split(/\s*(?:,|및|과|와|\/|·|등|또는|\+|하며|하고)\s*/)
      .map(cleanAssetCandidate)
      .filter((item) => item.length >= 2)
      .filter((item) => item.length <= 28)
      .filter((item) => assetKeyword.test(item))
      .filter((item) => !/(이유|원인|때문|필요|수익률|상태|벤치마크|개인\s*포폴|개인\s*포트폴리오)/.test(item))
      .forEach((item) => candidates.add(item));
  });

  const cleaned = Array.from(candidates).filter((item) => !/^(ETF|MMF|ELS|ELB)$/.test(item));
  return cleaned.filter((item) => !cleaned.some((other) => other !== item && other.length < item.length && item.includes(other)));
}

function normalizeExperience(items: string[]) {
  const none = options.investmentExperience[4];
  if (items.includes(none)) return [none];
  return Array.from(new Set(items.filter((item) => item !== none)));
}

function mockExtract(note: string): ExtractionEnvelope {
  const result = emptyEnvelope();
  const text = note.replace(/\s+/g, " ").trim();
  result.notes = collectCandidateNotes(text);

  const name = firstMatch(text, [/^([가-힣]{2,5})(?=,|\s|님|고객)/, /(?:성명|이름|고객명)\s*[:：]?\s*([가-힣]{2,5})/]);
  if (name) {
    result.extracted.profile.name = name;
    addConfidence(result, "profile.name", 0.86);
  }

  const age = firstMatch(text, [/(\d{2,3})\s*세/]);
  if (age) {
    result.extracted.profile.age = `만 ${age}세`;
    addConfidence(result, "profile.age", 0.9);
  }

  const gender = firstMatch(text, [/(?:^|[,(\s])(남|여)(?:[,)\s]|$)/, /(남성|여성)/]);
  if (gender) {
    result.extracted.profile.gender = gender.startsWith("남") ? "남" : "여";
    addConfidence(result, "profile.gender", 0.84);
  }

  const job = firstMatch(text, [
    /(?:남|여|\d{2,3}\s*세)\s*,?\s*([^,]+?(?:임직원|전문직|의사|대표|은퇴|교수|변호사|임원|사업가|소속))/,
    /직업\s*[:：]?\s*([^,.;\n]+)/,
  ]);
  if (job) {
    result.extracted.profile.job = job.replace(/^,\s*/, "").trim();
    addConfidence(result, "profile.job", 0.72);
  }

  const totalAssets = extractAmountNear(text, "총\\s*자산");
  const financialAssets = extractAmountNear(text, "금융\\s*자산");
  const realEstate = extractAmountNear(text, "부동산");
  const debt = extractAmountNear(text, "부채|대출");
  const annualIncome = extractAmountNear(text, "연\\s*(?:고정)?소득|연봉|사업소득");
  const monthlyExpense = firstMatch(text, [
    /(?:월|매월)[^.;\n]*?(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?(?:\s*이상)?)/,
    new RegExp(`(?:월\\s*(?:고정)?(?:지출|생활비|비용)|매월)[^.;\\n]*?((?:약\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억|천만|백만|만)?\\s*원?(?:\\s*이상)?)`),
  ]);
  const irregularIncome = firstMatch(text, [
    /(성과급[^,.;\n]*(?:예상|원|억|만)?)/,
    /(스톡옵션[^,.;\n]*)/,
    /((?:지분\s*)?매각[^,.;\n]*(?:수십억|수백억|자금\s*유입|원|억|만)[^,.;\n]*)/,
    /((?:수십억|수백억)[^,.;\n]*(?:자금\s*유입|예상|기대)[^,.;\n]*)/,
  ]);
  const investableAssets = firstMatch(text, [
    /(?:투자\s*가능\s*자산|투자\s*가능\s*금액|포트폴리오\s*구성\s*가능\s*자금)[^,.;\n]*?(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?)/,
    /(?:실제\s*투자|운용\s*가능|투입\s*가능)[^,.;\n]*?(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?)/,
  ]);
  if (totalAssets) result.extracted.financialProfile.totalAssets = totalAssets;
  if (financialAssets) result.extracted.financialProfile.financialAssets = financialAssets;
  if (realEstate) result.extracted.financialProfile.realEstate = realEstate;
  if (debt) result.extracted.financialProfile.debt = debt;
  if (annualIncome) result.extracted.financialProfile.annualFixedIncome = annualIncome;
  if (monthlyExpense) result.extracted.financialProfile.monthlyFixedExpense = monthlyExpense;
  if (irregularIncome) result.extracted.financialProfile.irregularIncome = irregularIncome;
  if (investableAssets) result.extracted.financialProfile.investableAssets = investableAssets;

  const expectedReturn = extractExpectedReturn(text);
  if (expectedReturn) {
    result.extracted.rrttllu.expectedReturn = normalizeReturnRange(expectedReturn);
    const maxReturn = Number((expectedReturn.match(/\d+(?:\.\d+)?/g) ?? []).at(-1));
    if (maxReturn >= 10) result.inferred.rrttllu.returnObjective = options.returnObjective[0];
    else if (maxReturn >= 6) result.inferred.rrttllu.returnObjective = options.returnObjective[1];
  }

  if (/원금\s*보전|초저위험|물가\s*상승률\s*방어/.test(text)) {
    result.inferred.rrttllu.returnObjective = options.returnObjective[3];
    result.inferred.rrttllu.riskAttitude = options.riskAttitude[3];
    result.inferred.rrttllu.lossResponse = options.lossResponse[3];
    result.inferred.rrttllu.investmentExperience = [options.investmentExperience[3]];
  } else if (/공격적|고위험|확\s*불리|레버리지|급등주|손실.*감수/.test(text)) {
    result.inferred.rrttllu.returnObjective = options.returnObjective[0];
    result.inferred.rrttllu.riskAttitude = options.riskAttitude[0];
    result.inferred.rrttllu.lossResponse = options.lossResponse[0];
  } else if (!result.inferred.rrttllu.returnObjective && /안정적|현금흐름|예금|국채|MMF|안전\s*투자/.test(text)) {
    result.inferred.rrttllu.returnObjective = options.returnObjective[2];
    result.inferred.rrttllu.riskAttitude = options.riskAttitude[2];
    result.inferred.rrttllu.lossResponse = options.lossResponse[1];
  }

  const experiences: string[] = [];
  if (/선물|옵션|파생|레버리지|인버스|신용거래/.test(text)) experiences.push(options.investmentExperience[0]);
  if (/주식|주도주|급등주|ETF|ELS|회사채/.test(text)) experiences.push(options.investmentExperience[1]);
  if (/펀드|채권|리츠/.test(text)) experiences.push(options.investmentExperience[2]);
  if (/예금|적금|MMF|CMA|국채/.test(text)) experiences.push(options.investmentExperience[3]);
  if (/투자\s*경험\s*없|투자해 본 경험 없음/.test(text)) experiences.push(options.investmentExperience[4]);
  if (experiences.length) result.inferred.rrttllu.investmentExperience = normalizeExperience(experiences);

  if (/레버리지|파생|선물|옵션|인버스/.test(text)) result.inferred.rrttllu.derivativesExperience = options.derivativesExperience[3];
  if (/본업이 바빠|설명|PB|상담/.test(text)) result.inferred.rrttllu.knowledgeLevel = options.knowledgeLevel[1];

  if (/2년\s*뒤|2년\s*후/.test(text)) result.inferred.rrttllu.timeHorizon = options.timeHorizon[2];
  else if (/3년|4년|5년/.test(text)) result.inferred.rrttllu.timeHorizon = options.timeHorizon[1];
  else if (/자녀|손주|세대|매우\s*길|5년\s*이상|장기/.test(text)) result.inferred.rrttllu.timeHorizon = options.timeHorizon[0];

  if (/증여세|증여|절세|금융소득종합과세|금융종합소득세|세금/.test(text)) {
    result.inferred.rrttllu.globalTaxImportance = options.taxImportance[2];
    result.inferred.rrttllu.giftingPlan = /증여/.test(text) ? options.giftingPlan[1] : undefined;
    result.inferred.rrttllu.recentGlobalTaxSubject = options.recentTax[2];
  }
  if (/해외주식|외화자산|달러/.test(text)) result.inferred.rrttllu.foreignStockTaxImportance = options.taxImportance[1];

  const cashflow = firstMatch(text, [
    /((?:월급\s*외\s*현금\s*흐름|정기적인\s*현금\s*유입|배당\s*기반\s*현금\s*흐름)[^.;\n]*(?:필요|선호|중요)?)/,
    /((?:월|매월)\s*\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?[^.;\n]*(?:생활비|현금\s*흐름|현금흐름|품위\s*유지비)[^.;\n]*)/,
  ]) ?? extractClauseContaining(
    text,
    /(?:월|매월).*(?:생활비|현금\s*흐름|현금흐름|품위\s*유지비)|(?:안정적인\s*)?(?:현금\s*흐름|현금흐름).*(?:필요|선호|중요|확보)|(?:생활비|노후\s*생활비|은퇴\s*후\s*생활비).*(?:필요|중요|확보)|(?:정기적인\s*현금\s*유입|월급\s*외\s*현금\s*흐름|배당\s*기반\s*현금\s*흐름).*(?:필요|선호|중요)?/,
  );
  const largeCash = firstMatch(text, [/(?:\d+\s*년\s*뒤|향후)[^,.;\n]*(?:유학|등록금|생활비|부동산\s*매입|목돈)[^,.;\n]*/]);
  if (cashflow) result.extracted.rrttllu.regularCashflowNeed = cashflow;
  if (largeCash) result.extracted.rrttllu.lumpSumPlan = largeCash;

  const legal: string[] = [];
  if (/임직원|자사주|선행\s*매매|매매\s*제한|전략기획|내부자/.test(text)) {
    legal.push(options.legalConstraints[1], options.legalConstraints[2]);
    result.extracted.rrttllu.legalConstraintOther =
      extractClauseContaining(text, /자사주|선행\s*매매|매매\s*제한|전략기획|내부자/, /ETF|경쟁사|장기보유|선회/) ?? null;
  }
  if (legal.length) result.inferred.rrttllu.legalConstraints = Array.from(new Set(legal));

  const assets = extractAssetCandidates(text);
  if (assets.length) result.extracted.rrttllu.preferredAssets = Array.from(new Set(assets)).join(", ");
  const cautionAssets = extractClauseContaining(text, /레버리지.*신중|신중.*레버리지|피하고|기피|원하지 않|제외/, /위험|손실|변동성/);
  if (cautionAssets) result.extracted.rrttllu.avoidedAssets = cautionAssets;
  if (/외화자산|PB 서비스/.test(text)) {
    result.extracted.rrttllu.uniqueOther =
      extractClauseContaining(text, /외화자산|PB 서비스/, /외화자산|현금흐름|주도주|본업/) ?? null;
  }
  const qualitativeUnique = splitMemoClauses(text)
    .filter((clause) => /회사\s*성장|보유\s*지분\s*가치|자산\s*집중\s*위험|벤치마크\s*대비\s*낮|본업이\s*바빠|주도주\s*편입/.test(clause))
    .map((clause) =>
      clause
        .replace(/\([^)]*\)/g, "")
        .replace(/수익률이\s*/, "수익률 ")
        .replace(/낮음|낮다|부진함/g, "부진")
        .trim(),
    )
    .filter(Boolean);
  if (qualitativeUnique.length) {
    const current = typeof result.extracted.rrttllu.uniqueOther === "string" ? result.extracted.rrttllu.uniqueOther : "";
    result.extracted.rrttllu.uniqueOther = Array.from(new Set([current, ...qualitativeUnique].filter(Boolean))).join("\n");
  }
  const personalContext = splitMemoClauses(text)
    .map(summarizeQualitativeClause)
    .filter(Boolean);
  if (personalContext.length) {
    const current = typeof result.extracted.rrttllu.uniqueOther === "string" ? result.extracted.rrttllu.uniqueOther : "";
    result.extracted.rrttllu.uniqueOther = Array.from(new Set([current, ...personalContext].filter(Boolean))).join("\n");
  }
  if (/개인\s*포폴|개인\s*포트폴리오|기존\s*포트폴리오|망가진|리밸런싱|장기보유|경쟁사 주식/.test(text)) {
    result.extracted.rrttllu.holdingOrDisposalPlan =
      extractClauseContaining(
        text,
        /개인\s*포폴|개인\s*포트폴리오|기존\s*포트폴리오|망가진|리밸런싱|장기보유|경쟁사 주식/,
        /원인|레버리지|급등주|ETF|경쟁사|장기보유|수익률|확대|매수/,
      ) ?? null;
  }

  Object.entries(result.extracted.financialProfile).forEach(([key, value]) => {
    if (value) addConfidence(result, `financialProfile.${key}`, 0.76);
  });
  Object.entries(result.extracted.rrttllu).forEach(([key, value]) => {
    if (value) addConfidence(result, `rrttllu.${key}`, 0.72);
  });
  Object.entries(result.inferred.rrttllu).forEach(([key, value]) => {
    if (value) addConfidence(result, `inferred.rrttllu.${key}`, 0.58);
  });
  result.unmapped = result.notes.filter((note) => {
    const mappedValues = [
      ...Object.values(result.extracted.profile),
      ...Object.values(result.extracted.financialProfile),
      ...Object.values(result.extracted.rrttllu),
      ...Object.values(result.inferred.rrttllu),
    ].flat();
    return !mappedValues.some((value) => typeof value === "string" && (value.includes(note) || note.includes(value)));
  });

  return enrichUniqueOther(result, text);
}

function buildPrompt(note: string) {
  return [
    "You are a high-recall JSON extraction engine for a Korean private banking RRTTLLU intake form.",
    "Return ONLY JSON matching the schema.",
    "Do not hardcode names or examples. Extract any customer memo using the same rules.",
    "Work in two steps internally: (1) first identify every important candidate sentence, (2) then map candidates to the form fields.",
    "Important candidates include any sentence or clause about money amounts, time periods, occupation, investment attitude, tax, liquidity, legal restrictions, preferred assets, avoided/caution assets, existing portfolio state, or family/succession needs.",
    "Always preserve money/time clauses as candidates, especially irregular income, future inflows, large cash needs, and recurring cashflow needs.",
    "Examples of candidate patterns, not hardcoded examples: future equity/share sale causing tens of billions of KRW inflow; bonus of 6~7억; study-abroad funding of 3억 in 2 years; monthly cashflow need of 1,000만 원; caution around leverage investments.",
    "After candidate extraction, classify each candidate as profile, financialProfile, Return, Risk, Time Horizon, Tax, Liquidity, Legal, Unique, notes, or unmapped.",
    "Use extracted for facts explicitly stated in the memo. Use inferred only for values reasonably implied by context.",
    "If a candidate is important but cannot be confidently mapped, do not discard it. Put it in notes and/or unmapped.",
    "Use null only when there is no evidence for that field. Do not silently drop meaningful ambiguous clauses.",
    "For selectable fields, use only one of the existing Korean option strings listed below.",
    `Return objective options: ${options.returnObjective.join(" | ")}`,
    `Risk investmentExperience options: ${options.investmentExperience.join(" | ")}`,
    `Risk knowledgeLevel options: ${options.knowledgeLevel.join(" | ")}`,
    `Risk derivativesExperience options: ${options.derivativesExperience.join(" | ")}`,
    `Risk financialAssetRatio options: ${options.financialAssetRatio.join(" | ")}`,
    `Risk investmentAssetRatio options: ${options.investmentAssetRatio.join(" | ")}`,
    `Risk riskAttitude options: ${options.riskAttitude.join(" | ")}`,
    `Risk lossResponse options: ${options.lossResponse.join(" | ")}`,
    `Time Horizon options: ${options.timeHorizon.join(" | ")}`,
    `Tax importance options: ${options.taxImportance.join(" | ")}`,
    `Gift plan options: ${options.giftingPlan.join(" | ")}`,
    `Recent tax history options: ${options.recentTax.join(" | ")}`,
    `Legal constraints options: ${options.legalConstraints.join(" | ")}`,
    "For Risk investmentExperience, return an array. If the no-experience option is selected, do not include any other option.",
    "For inferred selectable fields, return null rather than guessing when confidence is low.",
    "For free-text fields, keep the original Korean phrase as much as possible.",
    "Expected return extraction is mandatory when a percentage is stated. Put the percentage or range into extracted.rrttllu.expectedReturn, not only into returnObjective.",
    "Examples of expected return patterns, not hardcoded examples: 기대수익률 15%, 기대수익률 연 10~12%, 기대수익률은 연 7~8% 수준, 목표수익률 12%, 연 10% 수익 목표, 10~12% 수준의 수익 기대.",
    "Keep expected return ranges exactly, such as 10~12% or 7~8%.",
    "Return objective and expectedReturn are separate fields. Map high expected return context to returnObjective, but always preserve the numeric percentage in expectedReturn.",
    "For preferredAssets, include assets the customer wants, prefers, is interested in, wants to buy, or asks to include.",
    "For avoidedAssets, include assets the customer wants to avoid, is cautious about, or should limit. Do not put caution assets into preferredAssets.",
    "For irregularIncome, capture future non-recurring inflows such as bonus, stock options, business sale proceeds, share/equity sale proceeds, and large expected cash inflows even when exact amount is approximate.",
    "For investableAssets, capture the amount the customer can actually use for portfolio construction or investment operation. This is a user-provided amount, not a calculated value.",
    "For Liquidity, capture recurring cashflow needs, large lump-sum use plans, and emergency reserve needs separately when possible.",
    "Liquidity cashflow needs must be captured even when no exact amount exists. Expressions such as 안정적인 현금흐름 필요, 현금흐름이 중요, 생활비 확보가 중요, 정기적인 현금 유입 필요, 은퇴 후 생활비 확보 필요, 월급 외 현금흐름 필요, 배당 기반 현금흐름 선호, 노후 생활비 확보 목적 should map to regularCashflowNeed.",
    "For Tax, capture tax concerns including financial income comprehensive taxation, gift/inheritance tax, capital gains tax, and general tax reduction needs.",
    "For Legal, capture employee trading restrictions, insider/self-company stock restrictions, pre-trading restrictions, and other institutional limits.",
    "Ambiguous but important qualitative facts must go into extracted.rrttllu.uniqueOther and also notes if not otherwise represented. Examples of patterns, not hardcoded examples: company growth increased stake value, concentration risk management, personal portfolio underperformed benchmark, main occupation made active management difficult.",
    "Customer-specific qualitative context that does not naturally fit the financial, Return, Risk, Time Horizon, Tax, Liquidity, Legal, preferred assets, avoided assets, or existing asset plan fields must be summarized into extracted.rrttllu.uniqueOther.",
    "This includes decision-making influence from spouse/family, sensitivity to market news or short-term issues, impatient or fast decision style, many questions, preference for detailed explanation, parents' age or family finance issues, behavioral tendencies, consultation style, psychological concerns, and other personal circumstances.",
    "The following qualitative categories must be actively checked and summarized into extracted.rrttllu.uniqueOther when present: customer personality, decision-making style, consultation response style, market-news sensitivity, investment psychology, past investment failure, dissatisfaction with current portfolio, family/spouse influence, child education burden, parent support possibility, lack of asset monitoring time, prior PB service experience or dissatisfaction.",
    "Do not leave those qualitative facts only in notes or unmapped. If they are important for PB counseling but do not fit another form field, extracted.rrttllu.uniqueOther must contain concise Korean PB notes separated by new lines.",
    "Good uniqueOther style examples of form only, not hardcoded content: '시장 뉴스와 단기 이슈에 민감하게 반응', '투자 의사결정 속도가 빠름', '배우자의 투자 의사결정 영향력이 큰 편', '과거 레버리지 투자로 손실 경험 존재'.",
    "Handle Korean negation accurately before summarizing qualitative traits. Do not infer a positive trait from a negated phrase.",
    "Examples of negation to respect: 급하지 않음, 민감하지 않음, 예민하지 않음, 의심이 많지 않음, 질문이 많지 않음, 영향력이 크지 않음, 경험 없음, 관심 없음.",
    "If a trait is negated, either omit it from uniqueOther or summarize the neutral/opposite meaning. Never store '투자 의사결정 속도가 빠름' for '성격이 급하지 않음', and never store '시장 뉴스와 단기 이슈에 민감하게 반응' for '시장 뉴스에 민감하지 않음'.",
    "Do not merely copy those clauses. Rewrite them as concise PB-use notes in Korean, preserving meaning and avoiding overstatement.",
    "notes must include every important candidate clause that was not fully represented in extracted or inferred.",
    "unmapped must include important candidate clauses that do not fit any current field.",
    `Memo:\n${note}`,
  ].join("\n\n");
}

function isEmptyExtraction(data: ExtractionEnvelope) {
  return !Object.values(data.extracted.profile).length &&
    !Object.values(data.extracted.financialProfile).length &&
    !Object.values(data.extracted.rrttllu).length &&
    !Object.values(data.inferred.profile).length &&
    !Object.values(data.inferred.financialProfile).length &&
    !Object.values(data.inferred.rrttllu).length &&
    !data.notes.length &&
    !data.unmapped.length;
}

function getJsonParseCandidate(rawText: string) {
  const trimmed = rawText.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (unfenced.startsWith("{") && unfenced.endsWith("}")) return unfenced;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) return unfenced.slice(start, end + 1);
  return unfenced;
}

function normalizeExtractionEnvelope(value: unknown): ExtractionEnvelope {
  if (!value || typeof value !== "object") {
    throw new GeminiExtractionError("schema_mismatch", "Gemini JSON root is not an object.", { parsed: value });
  }
  const source = value as Partial<ExtractionEnvelope>;
  const extracted = source.extracted && typeof source.extracted === "object" ? source.extracted : {};
  const inferred = source.inferred && typeof source.inferred === "object" ? source.inferred : {};
  const normalized: ExtractionEnvelope = {
    extracted: {
      profile: { ...((extracted as ExtractionEnvelope["extracted"]).profile ?? {}) },
      financialProfile: { ...((extracted as ExtractionEnvelope["extracted"]).financialProfile ?? {}) },
      rrttllu: { ...((extracted as ExtractionEnvelope["extracted"]).rrttllu ?? {}) },
    },
    inferred: {
      profile: { ...((inferred as ExtractionEnvelope["inferred"]).profile ?? {}) },
      financialProfile: { ...((inferred as ExtractionEnvelope["inferred"]).financialProfile ?? {}) },
      rrttllu: { ...((inferred as ExtractionEnvelope["inferred"]).rrttllu ?? {}) },
    },
    unmapped: Array.isArray(source.unmapped) ? source.unmapped.filter((item): item is string => typeof item === "string") : [],
    notes: Array.isArray(source.notes) ? source.notes.filter((item): item is string => typeof item === "string") : [],
    confidence: source.confidence && typeof source.confidence === "object" && !Array.isArray(source.confidence)
      ? source.confidence as Record<string, number>
      : {},
  };
  return normalized;
}

function parseGeminiJson(rawText: string) {
  try {
    return normalizeExtractionEnvelope(JSON.parse(rawText));
  } catch (firstError) {
    const recovered = getJsonParseCandidate(rawText);
    if (recovered !== rawText) {
      try {
        const parsed = normalizeExtractionEnvelope(JSON.parse(recovered));
        console.info("Gemini JSON recovered after extracting JSON candidate", {
          rawLength: rawText.length,
          recoveredLength: recovered.length,
        });
        return parsed;
      } catch (recoveryError) {
        throw new GeminiExtractionError("json_parse_failed", "Gemini JSON.parse failed after recovery attempt.", {
          firstError,
          recoveryError,
          rawTextBeforeParse: rawText,
          recoveredCandidate: recovered,
        });
      }
    }
    throw new GeminiExtractionError("json_parse_failed", "Gemini JSON.parse failed.", {
      firstError,
      rawTextBeforeParse: rawText,
    });
  }
}

function parseGeminiErrorDetails(details: unknown) {
  const body = typeof details === "object" && details && "responseBody" in details
    ? String((details as { responseBody?: unknown }).responseBody ?? "")
    : "";
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : undefined;
  } catch {
    parsed = undefined;
  }
  const textBody = body || JSON.stringify(details ?? {});
  const retryDelayText = textBody.match(/"retryDelay"\s*:\s*"(\d+)s"/)?.[1]
    ?? textBody.match(/retryDelay['"]?\s*[:=]\s*['"]?(\d+)s/)?.[1];
  const quotaValueText = textBody.match(/"quotaValue"\s*:\s*"(\d+)"/)?.[1]
    ?? textBody.match(/quotaValue['"]?\s*[:=]\s*['"]?(\d+)/)?.[1];
  const status = typeof parsed === "object" && parsed && "error" in parsed
    ? (parsed as { error?: { status?: string; message?: string } }).error?.status
    : undefined;
  return {
    retryDelay: retryDelayText ? Number(retryDelayText) : undefined,
    quotaLimit: quotaValueText ? Number(quotaValueText) : GEMINI_FREE_TIER_DAILY_LIMIT,
    status,
    message: typeof parsed === "object" && parsed && "error" in parsed
      ? (parsed as { error?: { message?: string } }).error?.message
      : undefined,
  };
}

function quotaEstimate(clientEstimatedUsageToday: number | undefined, quotaLimit: number) {
  const estimatedUsageToday = Math.min(Math.max(clientEstimatedUsageToday ?? quotaLimit, 0), quotaLimit);
  return {
    estimatedUsageToday,
    estimatedRemainingToday: Math.max(quotaLimit - estimatedUsageToday, 0),
  };
}

async function callGemini(note: string, clientEstimatedUsageToday?: number): Promise<GeminiExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Smart Input extraction fallback: GEMINI_API_KEY is missing. Using mock parser only because API key is absent.", {
      fallbackReason: "api_key_missing",
      smartInputLength: note.length,
      trimmedLength: note.trim().length,
    });
    return {
      source: "mock",
      fallback: true,
      fallbackReason: "api_key_missing",
      quotaLimit: GEMINI_FREE_TIER_DAILY_LIMIT,
      ...quotaEstimate(clientEstimatedUsageToday, GEMINI_FREE_TIER_DAILY_LIMIT),
      data: mockExtract(note),
      debug: { usedFallbackReason: "api_key_missing" },
    };
  }

  const prompt = buildPrompt(note);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  let result: unknown;

  try {
    console.info("[Gemini Call] extract-customer", {
      smartInputLength: note.length,
      trimmedLength: note.trim().length,
      estimatedUsageToday: clientEstimatedUsageToday,
      timestamp: new Date().toISOString(),
    });
    console.log("Gemini extraction prompt", prompt);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.05,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const reason = response.status === 429 ? "rate_limit" : "api_request_failed";
      throw new GeminiExtractionError(reason, `Gemini request failed: ${response.status}`, {
        status: response.status,
        statusText: response.statusText,
        responseBody: errorText,
      });
    }
    result = await response.json();
    console.log("Gemini raw response", result);
    const responsePayload = result as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
    const text = responsePayload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      throw new GeminiExtractionError("schema_mismatch", "Gemini response did not include JSON text.", {
        rawResponse: result,
      });
    }
    console.log("Gemini raw text before JSON.parse", text);
    try {
      const parsed = parseGeminiJson(text);
      const enriched = enrichUniqueOther(parsed, note);
      console.log("Gemini parsed extraction before client mapping", enriched);
      if (isEmptyExtraction(enriched)) {
        console.warn("Gemini returned an empty extraction object", {
          rawTextBeforeParse: text,
          parsedBeforeMapping: enriched,
          smartInput: note,
        });
      }
      return {
        source: "gemini",
        data: enriched,
        debug: {
          prompt,
          rawResponse: result,
          rawTextBeforeParse: text,
          parsedBeforeMapping: enriched,
        },
      };
    } catch (parseError) {
      console.error("Gemini JSON parsing or schema validation failed", {
        reason: parseError instanceof GeminiExtractionError ? parseError.reason : "json_parse_failed",
        error: parseError,
        rawTextBeforeParse: text,
        rawResponse: result,
        smartInput: note,
      });
      throw parseError;
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    const geminiError = error instanceof GeminiExtractionError
      ? error
      : new GeminiExtractionError(isAbort ? "timeout" : "api_request_failed", isAbort ? "Gemini request timed out." : "Gemini extraction failed.", { error });
    console.error("Gemini extraction failed. Mock parser was NOT used because GEMINI_API_KEY is configured.", {
      reason: geminiError.reason,
      message: geminiError.message,
      details: geminiError.details,
      error,
      smartInput: note,
      smartInputLength: note.length,
      trimmedLength: note.trim().length,
    });
    if (geminiError.reason === "rate_limit") {
      const quota = parseGeminiErrorDetails(geminiError.details);
      const quotaLimit = quota.quotaLimit ?? GEMINI_FREE_TIER_DAILY_LIMIT;
      const estimate = quotaEstimate(Math.max(clientEstimatedUsageToday ?? 0, quotaLimit), quotaLimit);
      console.error("Smart Input extraction fallback: Gemini free tier rate limit reached. Using mock parser.", {
        fallbackReason: "rate_limit",
        retryDelay: quota.retryDelay,
        quotaLimit,
        estimatedUsageToday: estimate.estimatedUsageToday,
        estimatedRemainingToday: estimate.estimatedRemainingToday,
        quotaStatus: quota.status,
        quotaMessage: quota.message,
      });
      return {
        source: "mock",
        fallback: true,
        fallbackReason: "rate_limit",
        retryDelay: quota.retryDelay,
        quotaLimit,
        ...estimate,
        data: mockExtract(note),
        debug: { usedFallbackReason: "rate_limit" },
      };
    }
    throw geminiError;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    const estimatedUsageToday = typeof body?.estimatedUsageToday === "number" ? body.estimatedUsageToday : undefined;
    if (!note) return NextResponse.json({ error: "메모를 입력해주세요." }, { status: 400 });
    const result = await callGemini(note, estimatedUsageToday);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const reason = error instanceof GeminiExtractionError ? error.reason : "unknown";
    console.error("customer extraction failed", {
      reason,
      error,
      details: error instanceof GeminiExtractionError ? error.details : undefined,
    });
    return NextResponse.json({
      ok: false,
      source: "gemini",
      error: "추출에 실패했습니다. 직접 입력하거나 다시 시도해주세요.",
      reason,
    }, { status: reason === "api_key_missing" ? 500 : 502 });
  }
}
