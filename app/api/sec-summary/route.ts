import { NextRequest, NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/geminiServerEnv";

const cache = new Map<string, { summary: string; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

const UA = "investment-analysis-app/1.0 contact@noreply.example.com";

// ── rcpNo 파싱 ────────────────────────────────────────────────────────────────

function parseRcpNo(rcpNo: string): { cik: string; accNoDashes: string; primaryDoc: string } {
  const slashIdx = rcpNo.indexOf("/");
  const secondSlashIdx = rcpNo.indexOf("/", slashIdx + 1);
  if (slashIdx === -1 || secondSlashIdx === -1) throw new Error("rcpNo 형식 오류");
  return {
    cik: rcpNo.slice(0, slashIdx),
    accNoDashes: rcpNo.slice(slashIdx + 1, secondSlashIdx),
    primaryDoc: rcpNo.slice(secondSlashIdx + 1),
  };
}

// accNoDashes "000173016826000054" → 대시 형식 "0001730168-26-000054"
function toDashedAccession(acc: string): string {
  return `${acc.slice(0, 10)}-${acc.slice(10, 12)}-${acc.slice(12)}`;
}

// ── XBRL company concept API (실적 공시 전용) ─────────────────────────────────

type XBRLEntry = {
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
};

type MetricResult = {
  labelKr: string;
  curr: number;
  prev: number | null;
  unit: "USD" | "USD/shares";
  period: string;
  form: string;
} | null;

async function fetchMetric(
  paddedCik: string,
  conceptNames: string[],
  labelKr: string,
  accDashed: string,
): Promise<MetricResult> {
  for (const name of conceptNames) {
    try {
      const res = await fetch(
        `https://data.sec.gov/api/xbrl/companyconcept/CIK${paddedCik}/us-gaap/${name}.json`,
        { headers: { "User-Agent": UA } },
      );
      if (!res.ok) continue;

      const data = (await res.json()) as { units: Record<string, XBRLEntry[]> };

      for (const unitKey of ["USD", "USD/shares"] as const) {
        const entries = data.units[unitKey];
        if (!entries) continue;

        // 현재 공시 기간 (accession 매칭)
        const curr = entries.find(e => e.accn === accDashed);
        if (!curr) continue;

        // 전년 동기 (같은 fp, fy-1, 같은 form)
        const prev = entries.find(
          e => e.fp === curr.fp && e.fy === curr.fy - 1 && e.form === curr.form,
        ) ?? null;

        return { labelKr, curr: curr.val, prev: prev?.val ?? null, unit: unitKey, period: curr.end, form: curr.form };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function fmtMoney(val: number, unit: "USD" | "USD/shares"): string {
  if (unit === "USD/shares") return `$${val.toFixed(2)}`;
  const b = val / 1e9;
  const m = val / 1e6;
  return Math.abs(b) >= 0.1 ? `$${b.toFixed(3)}B` : `$${m.toFixed(0)}M`;
}

function fmtYoY(curr: number, prev: number): string {
  if (prev === 0) return "";
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

async function buildXbrlContext(cik: string, accNoDashes: string): Promise<string> {
  const paddedCik = cik.padStart(10, "0");
  const accDashed = toDashedAccession(accNoDashes);

  // 폭넓은 fallback — 금융업종·일반산업 모두 커버
  const METRICS: [string[], string][] = [
    [
      [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "RevenuesNetOfInterestExpense",      // 은행: 순이자·비이자수익 합계
        "InterestAndDividendIncomeOperating", // 은행: 이자·배당 수입
        "NoninterestIncome",                 // 은행: 비이자수익
        "HealthCareOrganizationRevenue",
        "RealEstateRevenueNet",
      ],
      "매출액(Revenue)",
    ],
    [["GrossProfit"], "매출총이익(Gross Profit)"],
    [
      [
        "OperatingIncomeLoss",
        // 금융업종은 영업이익 대신 세전이익으로 대체
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
      ],
      "영업이익(Operating/Pre-tax Income)",
    ],
    [["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"], "순이익(Net Income)"],
    [["EarningsPerShareBasic"], "EPS (기본)"],
    [["EarningsPerShareDiluted"], "EPS (희석)"],
  ];

  const results = await Promise.all(
    METRICS.map(([names, label]) => fetchMetric(paddedCik, names, label, accDashed)),
  );

  const valid = results.filter((r): r is NonNullable<MetricResult> => r !== null);
  if (valid.length === 0) return "";

  const period = valid[0].period;
  const form = valid[0].form;
  const lines = [`[SEC XBRL 재무 데이터 — ${period} 기준 / ${form}]`, ""];

  for (const m of valid) {
    const currStr = fmtMoney(m.curr, m.unit);
    const prevStr = m.prev !== null ? fmtMoney(m.prev, m.unit) : "N/A";
    const yoy = m.prev !== null ? ` / YoY ${fmtYoY(m.curr, m.prev)}` : "";
    lines.push(`- ${m.labelKr}: ${currStr} (전년 동기 ${prevStr}${yoy})`);
  }

  console.log(`[sec-summary] XBRL 재무 데이터 ${valid.length}개 지표 수집 완료`);
  return lines.join("\n");
}

// ── HTML 원문 → 텍스트 ────────────────────────────────────────────────────────

function stripHtml(raw: string): string {
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z#\d]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFilingText(cik: string, accNoDashes: string, primaryDoc: string): Promise<string> {
  const url = primaryDoc
    ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/${primaryDoc}`
    : `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/`;

  console.log(`[sec-summary] 문서 fetch: ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`SEC 문서 fetch 실패: ${res.status}`);

  return stripHtml(await res.text());
}

// 손익계산서 섹션 추출 (iXBRL 전체 문서에서 재무제표 위치를 찾음)
function extractIncomeStatement(text: string, maxChars = 8000): string {
  // 손익계산서 시작을 알리는 키워드 (우선순위 순)
  const ANCHORS = [
    "consolidated statements of income",
    "consolidated statement of income",
    "condensed consolidated statements of income",
    "consolidated statements of operations",
    "condensed consolidated statements of operations",
    "consolidated statement of operations",
    "statements of income (unaudited)",
    "total net revenue",
    "total revenue",
    "net revenues",
  ];

  const lc = text.toLowerCase();
  let bestIdx = -1;

  for (const anchor of ANCHORS) {
    const idx = lc.indexOf(anchor);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
    }
  }

  if (bestIdx >= 0) {
    const start = Math.max(0, bestIdx - 200);
    console.log(`[sec-summary] 손익계산서 발견: 위치 ${bestIdx} / 전체 ${text.length}자`);
    return text.slice(start, start + maxChars);
  }

  // fallback: 문서 20~40% 구간 (대부분 재무제표가 위치)
  console.warn("[sec-summary] 손익계산서 섹션 미발견 — 문서 중간 구간 사용");
  const start = Math.floor(text.length * 0.2);
  return text.slice(start, start + maxChars);
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const rcpNo = (req.nextUrl.searchParams.get("rcpNo") ?? "").trim();
  const title = (req.nextUrl.searchParams.get("title") ?? "").trim();
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  if (!rcpNo) return NextResponse.json({ error: "rcpNo required" }, { status: 400 });

  const cacheKey = `sec-summary:${rcpNo}`;
  if (!refresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return NextResponse.json({ summary: hit.summary, cached: true });
    }
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini API key가 설정되지 않았습니다." }, { status: 500 });
  }

  try {
    const { cik, accNoDashes, primaryDoc } = parseRcpNo(rcpNo);

    // 공시 유형 판별
    const isEarnings = /10-K|10-Q|Annual\s*Report|Quarterly\s*Report/i.test(title);
    const isInsider = /Form\s*4|4\/A|Insider/i.test(title);
    const isStake = /SC\s*13G|SC\s*13D/i.test(title);

    let contextBlock = "";

    if (isEarnings) {
      // 실적 공시: XBRL API 먼저 시도 (구조화된 데이터)
      const xbrlData = await buildXbrlContext(cik, accNoDashes);
      const xbrlMetricCount = (xbrlData.match(/^- /gm) ?? []).length;

      if (xbrlMetricCount >= 3) {
        // XBRL에 충분한 지표가 있으면 그대로 사용 (Broadcom 등 일반 기업)
        contextBlock = xbrlData;
      } else {
        // XBRL 지표 부족 (JPMorgan 등 금융업종 — 커스텀 namespace 사용)
        // → 원문 HTML에서 손익계산서 섹션 직접 추출
        console.log(`[sec-summary] XBRL 지표 ${xbrlMetricCount}개 — HTML 손익계산서 섹션 추출`);
        const fullText = await fetchFilingText(cik, accNoDashes, primaryDoc);
        const incomeSection = extractIncomeStatement(fullText, 8000);

        // XBRL 부분 데이터(있으면) + HTML 섹션 병합
        contextBlock = xbrlData
          ? `${xbrlData}\n\n[손익계산서 원문 (HTML)]\n${incomeSection}`
          : `[손익계산서 원문 (HTML)]\n${incomeSection}`;
      }
    } else {
      // 비실적 공시: HTML 원문 텍스트 (앞부분이 핵심)
      const raw = await fetchFilingText(cik, accNoDashes, primaryDoc);
      contextBlock = raw.slice(0, 15000);
    }

    if (!contextBlock || contextBlock.length < 20) {
      return NextResponse.json({ error: "공시 내용을 불러올 수 없습니다." }, { status: 500 });
    }

    // ── 프롬프트 구성 ──────────────────────────────────────────────────────────

    const earningsSection = `**📊 주요 수치 (전기 대비 변화)**
아래 데이터에서 찾을 수 있는 항목만 작성하세요. 데이터에 없는 항목은 절대 쓰지 마세요.
찾아야 할 항목 (업종별 명칭이 다를 수 있음):
- Total net revenue / Total revenue / Net revenues / 매출 → "매출액"으로 표기
- Gross profit (있는 경우만) → "매출총이익"으로 표기
- Operating income / Income before income tax → "영업이익" 또는 "세전이익"으로 표기
- Net income / 순이익
- EPS Basic / EPS Diluted
형식: [항목명]: [당기 금액] (전년 동기 [금액], YoY [+/-X%])`;

    const insiderSection = `**👤 거래 주체**
- 보고자 성명 및 직위
- 거래 유형: 매수(Acquisition) / 매도(Disposition)
- 주식 수량 및 거래 단가

**📅 거래 일정**
- 거래일 / 보고 기한`;

    const stakeSection = `**📊 지분 현황**
- 보유자 성명 및 유형(기관/개인)
- 보유 주식 수 및 지분율
- 보유 목적(투자 목적, 경영권 개입 여부 등)`;

    const contractSection = `**📋 계약 상세**
- 계약 상대방 / 계약 금액(공시된 경우) / 계약 기간 / 주요 계약 조건`;

    const numericSection = isEarnings
      ? earningsSection
      : isInsider
        ? insiderSection
        : isStake
          ? stakeSection
          : contractSection;

    const dataLabel = isEarnings ? "SEC 재무 데이터" : "SEC EDGAR 공시 원문";

    const prompt = `당신은 PB(프라이빗 뱅커)를 위한 SEC 공시 요약 어시스턴트입니다.
아래 데이터를 읽고, 고객 상담에 즉시 활용할 수 있도록 핵심만 한국어로 요약해주세요.

공시 제목: ${title}

출력 형식 (마크다운, 아래 순서 준수):
**📌 핵심 내용**
- (2~3줄 이내로 공시의 핵심을 서술)

${numericSection}

**💡 투자 시사점**
- (투자자 관점에서 주목해야 할 사항 2~3가지)

---
[${dataLabel}]
${contextBlock}
---
위 형식에 따라 한국어로 간결하게 요약하세요. 불필요한 서론 없이 바로 요약을 시작하세요.`;

    // ── Gemini 호출 (폴백 포함) ───────────────────────────────────────────────

    const GEMINI_MODELS = [
      "gemini-3.1-flash-lite",
      "gemini-1.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
    ] as const;

    type GeminiResp = {
      candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    };

    let summary = "";
    let usedModel = "";
    let lastError = "";

    for (const model of GEMINI_MODELS) {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 },
          }),
        },
      );

      if (geminiRes.status === 429) {
        lastError = `${model} 한도 초과(429)`;
        console.warn(`[sec-summary] ${model} 429, 다음 모델로 폴백`);
        continue;
      }
      if (geminiRes.status === 404) {
        lastError = `${model} 미지원(404)`;
        continue;
      }
      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        lastError = `${model} 오류 ${geminiRes.status}: ${errText.slice(0, 200)}`;
        continue;
      }

      const result = (await geminiRes.json()) as GeminiResp;
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) { lastError = `${model}: 응답에 요약 없음`; continue; }

      summary = text;
      usedModel = model;
      console.log(`[sec-summary] ${model} 요약 성공`);
      break;
    }

    if (!summary) throw new Error(`모든 Gemini 모델 실패. 마지막 오류: ${lastError}`);

    cache.set(cacheKey, { summary, ts: Date.now() });
    return NextResponse.json({ summary, rcpNo, model: usedModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sec-summary]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
