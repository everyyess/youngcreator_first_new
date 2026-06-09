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
  data: ExtractionEnvelope;
  debug?: {
    prompt?: string;
    rawResponse?: unknown;
    rawTextBeforeParse?: string;
    parsedBeforeMapping?: unknown;
    usedFallbackReason?: string;
  };
};

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
    /(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?|\d+(?:\.\d+)?(?:\s*[~\-]\s*\d+(?:\.\d+)?)?\s*%|수십억|수백억|성과급|스톡옵션|매각|자금\s*유입|유학|등록금|생활비|현금\s*흐름|현금흐름|월급\s*외|노후\s*생활비|은퇴\s*후\s*생활비|배당\s*기반|세금|절세|증여|금융소득종합과세|금융종합소득세|임직원|자사주|선행\s*매매|매매\s*제한|전략기획|공격적|고위험|초저위험|원금\s*보전|레버리지|신중|선호|기피|피하고|관심|외화자산|부동산|주식|채권|ETF|암호화폐|가상자산|Time horizon|투자\s*시계|자산\s*집중|벤치마크|본업이\s*바빠|보유\s*지분\s*가치)/i;
  return splitMemoClauses(text)
    .filter((clause) => importantPattern.test(clause))
    .map((clause) => clause.trim())
    .filter(Boolean);
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
  if (totalAssets) result.extracted.financialProfile.totalAssets = totalAssets;
  if (financialAssets) result.extracted.financialProfile.financialAssets = financialAssets;
  if (realEstate) result.extracted.financialProfile.realEstate = realEstate;
  if (debt) result.extracted.financialProfile.debt = debt;
  if (annualIncome) result.extracted.financialProfile.annualFixedIncome = annualIncome;
  if (monthlyExpense) result.extracted.financialProfile.monthlyFixedExpense = monthlyExpense;
  if (irregularIncome) result.extracted.financialProfile.irregularIncome = irregularIncome;

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

  return result;
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
    "For Liquidity, capture recurring cashflow needs, large lump-sum use plans, and emergency reserve needs separately when possible.",
    "Liquidity cashflow needs must be captured even when no exact amount exists. Expressions such as 안정적인 현금흐름 필요, 현금흐름이 중요, 생활비 확보가 중요, 정기적인 현금 유입 필요, 은퇴 후 생활비 확보 필요, 월급 외 현금흐름 필요, 배당 기반 현금흐름 선호, 노후 생활비 확보 목적 should map to regularCashflowNeed.",
    "For Tax, capture tax concerns including financial income comprehensive taxation, gift/inheritance tax, capital gains tax, and general tax reduction needs.",
    "For Legal, capture employee trading restrictions, insider/self-company stock restrictions, pre-trading restrictions, and other institutional limits.",
    "Ambiguous but important qualitative facts must go into extracted.rrttllu.uniqueOther and also notes if not otherwise represented. Examples of patterns, not hardcoded examples: company growth increased stake value, concentration risk management, personal portfolio underperformed benchmark, main occupation made active management difficult.",
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

async function callGemini(note: string): Promise<GeminiExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { source: "mock", data: mockExtract(note) };

  try {
    const prompt = buildPrompt(note);
    console.log("Gemini extraction prompt", prompt);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.05,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });

    if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);
    const result = await response.json();
    console.log("Gemini raw response", result);
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Gemini response did not include JSON text.");
    console.log("Gemini raw text before JSON.parse", text);
    try {
      const parsed = JSON.parse(text) as ExtractionEnvelope;
      console.log("Gemini parsed extraction before client mapping", parsed);
      if (isEmptyExtraction(parsed)) {
        console.warn("Gemini returned an empty extraction object", {
          rawTextBeforeParse: text,
          parsedBeforeMapping: parsed,
          smartInput: note,
        });
      }
      return {
        source: "gemini",
        data: parsed,
        debug: {
          prompt,
          rawResponse: result,
          rawTextBeforeParse: text,
          parsedBeforeMapping: parsed,
        },
      };
    } catch (parseError) {
      console.error("Gemini JSON.parse failed", {
        parseError,
        rawTextBeforeParse: text,
        smartInput: note,
      });
      throw parseError;
    }
  } catch (error) {
    console.error("Gemini extraction failed. Falling back to mock parser.", {
      error,
      smartInput: note,
      smartInputLength: note.length,
      trimmedLength: note.trim().length,
    });
    return {
      source: "mock",
      fallback: true,
      data: mockExtract(note),
      debug: {
        usedFallbackReason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) return NextResponse.json({ error: "메모를 입력해주세요." }, { status: 400 });
    const result = await callGemini(note);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("customer extraction failed", { error });
    return NextResponse.json({ error: "추출에 실패했습니다. 직접 입력하거나 다시 시도해주세요." }, { status: 500 });
  }
}
