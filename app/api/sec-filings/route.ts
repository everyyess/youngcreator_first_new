import { NextRequest, NextResponse } from "next/server";
import type { DartDisclosure, DartDisclosuresResponse } from "../dart-disclosures/route";

// ── 캐시 ─────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: DartDisclosuresResponse; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

// Ticker → CIK 매핑 캐시 (24시간)
let tickerMap: Map<string, { cik: string; name: string }> | null = null;
let tickerMapTs = 0;
const TICKER_MAP_TTL = 24 * 60 * 60 * 1000;

const UA = "investment-analysis-app/1.0 contact@noreply.example.com";

// ── Ticker → CIK 로드 ─────────────────────────────────────────────────────────

type TickerEntry = { cik_str: number; ticker: string; title: string };

async function loadTickerMap(): Promise<Map<string, { cik: string; name: string }>> {
  if (tickerMap && Date.now() - tickerMapTs < TICKER_MAP_TTL) return tickerMap;

  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`SEC company_tickers fetch failed: ${res.status}`);

  const json = (await res.json()) as Record<string, TickerEntry>;
  const map = new Map<string, { cik: string; name: string }>();
  for (const e of Object.values(json)) {
    map.set(e.ticker.toUpperCase(), {
      cik: String(e.cik_str).padStart(10, "0"),
      name: e.title,
    });
  }

  tickerMap = map;
  tickerMapTs = Date.now();
  return map;
}

// ── SEC Submissions 타입 ──────────────────────────────────────────────────────

type RecentFilings = {
  accessionNumber: string[];
  filingDate: string[];
  form: string[];
  primaryDocument: string[];
  items: string[];
  primaryDocDescription: string[];
};

type Submissions = {
  name: string;
  filings: { recent: RecentFilings };
};

async function fetchSubmissions(cik: string): Promise<Submissions> {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`SEC submissions fetch failed (CIK=${cik}): ${res.status}`);
  return res.json() as Promise<Submissions>;
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

// "2024-02-15" → "2024.02.15" (DartDisclosure.date 형식 맞춤)
function isoToDisplay(d: string): string {
  return d.replace(/-/g, ".");
}

function cutoffDate(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

const REPORTER_MAP: Record<string, string> = {
  "10-K": "Annual Report",
  "10-K/A": "Annual Report (Amended)",
  "10-Q": "Quarterly Report",
  "10-Q/A": "Quarterly Report (Amended)",
  "4": "Form 4 (Insider)",
  "4/A": "Form 4 (Amended)",
  "SC 13G": "SC 13G (≥5% Holder)",
  "SC 13G/A": "SC 13G/A (≥5% Holder)",
  "SC 13D": "SC 13D (≥5% Holder)",
  "SC 13D/A": "SC 13D/A (≥5% Holder)",
  "8-K": "8-K Current Report",
};

// ── 중요 계약 체결 유형 감지 ──────────────────────────────────────────────────

const AGR_FINANCIAL  = /indenture|credit\s+agreement|loan\s+agreement|note\s+purchase|revolving|term\s+loan|\bbond[s]?\b|debenture|credit\s+facility|promissory/i;
const AGR_SETTLEMENT = /settlement|consent\s+decree|stipulation|consent\s+order|release\s+agreement/i;
const AGR_LEASE      = /lease\s+agreement|sublease|\blease\b|rental\s+agreement|real\s+estate/i;
const AGR_LICENSE    = /licen[sc][ei]|royalty\s+agreement|patent\s+licens/i;
const AGR_MA         = /merger\s+agreement|acquisition\s+agreement|asset\s+purchase|stock\s+purchase|share\s+purchase/i;
const AGR_MOU        = /memorandum\s+of\s+understanding|\bmou\b|letter\s+of\s+intent|framework\s+agreement/i;

function getAgreementTag(desc: string, items: string): string | null {
  if (items.includes("2.03") || AGR_FINANCIAL.test(desc))  return "회사채·대출";
  if (AGR_SETTLEMENT.test(desc))                            return "법적 합의";
  if (AGR_LEASE.test(desc))                                 return "부동산 임대";
  if (AGR_LICENSE.test(desc))                               return "라이선스";
  if (AGR_MA.test(desc))                                    return "M&A";
  if (AGR_MOU.test(desc))                                   return "MOU";
  return null;
}

function makeFiling(
  cik: string,
  company: string,
  accession: string,
  date: string,
  form: string,
  primaryDoc: string,
  desc: string,
  items: string,
  tag?: string,
): DartDisclosure {
  const numericCik = parseInt(cik, 10);
  const accNoDash = accession.replace(/-/g, "");

  // rcpNo: "{numericCik}/{accNoDash}/{primaryDoc}" — sec-summary가 파싱해 문서 fetch
  const rcpNo = `${numericCik}/${accNoDash}/${primaryDoc}`;
  const url = primaryDoc
    ? `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accNoDash}/${primaryDoc}`
    : `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accNoDash}/`;

  const titleParts: string[] = [form];
  if (desc && desc !== form) titleParts.push(desc);
  if (form === "8-K" && items) titleParts.push(`[Item ${items}]`);
  if (tag) titleParts.push(tag);

  return {
    date: isoToDisplay(date),
    company,
    title: titleParts.join(" · "),
    rcpNo,
    url,
    reporter: REPORTER_MAP[form] ?? form,
  };
}

// ── 카테고리 분류 ──────────────────────────────────────────────────────────────

const EARNINGS_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A"]);
const STAKES_FORMS = new Set(["SC 13G", "SC 13G/A", "SC 13D", "SC 13D/A"]);
const INSIDER_FORMS = new Set(["4", "4/A"]);

function categorize(cik: string, company: string, sub: Submissions): DartDisclosuresResponse {
  const c5 = cutoffDate(5);
  const c2 = cutoffDate(2);

  const earnings: DartDisclosure[] = [];
  const stakes: DartDisclosure[] = [];
  const insiders: DartDisclosure[] = [];
  const contracts: DartDisclosure[] = [];
  const agreements: DartDisclosure[] = [];

  const r = sub.filings.recent;
  const n = r.accessionNumber.length;

  for (let i = 0; i < n; i++) {
    const form = r.form[i];
    const date = r.filingDate[i];
    const accession = r.accessionNumber[i];
    if (!form || !date || !accession) continue;

    const doc = r.primaryDocument[i] ?? "";
    const desc = r.primaryDocDescription[i] ?? "";
    const items = r.items[i] ?? "";

    const f = () => makeFiling(cik, company, accession, date, form, doc, desc, items);

    if (EARNINGS_FORMS.has(form) && date >= c5 && earnings.length < 10) {
      earnings.push(f());
    } else if (STAKES_FORMS.has(form) && date >= c2 && stakes.length < 10) {
      stakes.push(f());
    } else if (INSIDER_FORMS.has(form) && date >= c2 && insiders.length < 10) {
      insiders.push(f());
    } else if (form === "8-K" && date >= c2 && items.includes("1.01")) {
      const tag = getAgreementTag(desc, items);
      if (tag && agreements.length < 10) {
        agreements.push(makeFiling(cik, company, accession, date, form, doc, desc, items, tag));
      } else if (!tag && contracts.length < 10) {
        contracts.push(f());
      }
    }

    if (
      earnings.length >= 10 && stakes.length >= 10 &&
      insiders.length >= 10 && contracts.length >= 10 && agreements.length >= 10
    ) break;
  }

  return { company, earnings, stakes, insiders, contracts, agreements };
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ticker: Yahoo Finance 티커에서 기본 심볼 (예: "AAPL.US" → "AAPL")
  const raw = (req.nextUrl.searchParams.get("ticker") ?? "").trim();
  const ticker = raw.split(".")[0].toUpperCase();
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const cacheKey = `sec:${ticker}`;
  if (!refresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return NextResponse.json({ ...hit.data, _cached: true });
    }
  }

  try {
    const map = await loadTickerMap();
    const entry = map.get(ticker);
    if (!entry) {
      return NextResponse.json(
        { error: `SEC에 등록된 기업을 찾을 수 없습니다 (${ticker}). 미국 증시 상장 종목만 지원합니다.` },
        { status: 404 },
      );
    }

    console.log(`[sec-filings] ${ticker} → CIK ${entry.cik} (${entry.name})`);

    const sub = await fetchSubmissions(entry.cik);
    const data = categorize(entry.cik, sub.name || entry.name, sub);

    console.log(
      `[sec-filings] ${ticker} — earnings:${data.earnings.length} stakes:${data.stakes.length} ` +
        `insiders:${data.insiders.length} contracts:${data.contracts.length} agreements:${data.agreements.length}`,
    );

    cache.set(cacheKey, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sec-filings]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
