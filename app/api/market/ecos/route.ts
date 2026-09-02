import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 한국은행 ECOS Open API
// URL: https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/json/kr/{startRow}/{endRow}/{statCode}/{cycle}/{startDate}/{endDate}/

const API_KEY = process.env.ECOS_API_KEY ?? "";

// KeyStatisticList 응답 캐시 — BOK 100대 지표는 하루 1~2회 갱신이므로 4h TTL로 절약
let keystatCache: { groups: KeystatGroup[]; total: number; generatedAt: string } | null = null;
let keystatCacheExpiry = 0;
const KEYSTAT_CACHE_TTL = 4 * 60 * 60 * 1000; // 4시간 (기존 15분에서 상향)

// 일반 지표 조회 캐시 (macro/chart 프리셋) — 30분 TTL
const presetCache = new Map<string, { data: unknown; expiry: number }>();
const PRESET_CACHE_TTL = 30 * 60 * 1000;

type KeystatItem = { name: string; value: string; cycle: string; unit: string };
type KeystatGroup = { className: string; items: KeystatItem[] };

function parseKeystatXml(xml: string): { groups: KeystatGroup[]; total: number } {
  const totalMatch = xml.match(/<list_total_count[^>]*>(\d+)<\/list_total_count>/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  const groupMap = new Map<string, KeystatItem[]>();
  const groupOrder: string[] = [];

  function getTag(block: string, tag: string): string {
    const start = block.indexOf(`<${tag}>`);
    const end   = block.indexOf(`</${tag}>`);
    if (start < 0 || end < 0) return "";
    return block.slice(start + tag.length + 2, end).trim();
  }

  for (const part of xml.split("<row>").slice(1)) {
    const block = part.split("</row>")[0];
    const className = getTag(block, "CLASS_NAME");
    const item: KeystatItem = {
      name:  getTag(block, "KEYSTAT_NAME"),
      value: getTag(block, "DATA_VALUE"),
      cycle: getTag(block, "CYCLE"),
      unit:  getTag(block, "UNIT_NAME"),
    };
    if (!item.name) continue;
    if (!groupMap.has(className)) {
      groupMap.set(className, []);
      groupOrder.push(className);
    }
    groupMap.get(className)!.push(item);
  }

  return {
    groups: groupOrder.map((cls) => ({ className: cls, items: groupMap.get(cls)! })),
    total,
  };
}

async function fetchKeyStatisticList(): Promise<{ groups: KeystatGroup[]; total: number }> {
  const url = `https://ecos.bok.or.kr/api/KeyStatisticList/${API_KEY}/xml/kr/1/200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`한국은행 KeyStatisticList 오류 (HTTP ${res.status})`);
  const xml = await res.text();
  if (xml.includes("<RESULT>") && !xml.includes("INFO-000")) {
    const msg = xml.match(/<MESSAGE>(.*?)<\/MESSAGE>/)?.[1] ?? "ECOS API 오류";
    throw new Error(msg);
  }
  return parseKeystatXml(xml);
}

type PresetItem = { statCode: string; cycle: string; itemCode?: string; label: string; unit: string };

// preset=macro — 최신 값 조회 (기본 6행) — 검증된 ECOS 코드만 사용
const PRESET_MACRO: PresetItem[] = [
  { statCode: "722Y001", cycle: "M",                      label: "기준금리",                        unit: "%" },
  { statCode: "731Y004", cycle: "M", itemCode: "0000001", label: "원/달러 환율",                     unit: "KRW" },
  { statCode: "901Y009", cycle: "M", itemCode: "0",       label: "소비자물가지수",                   unit: "2020=100" },
  { statCode: "404Y014", cycle: "M", itemCode: "*AA",     label: "생산자물가지수",                   unit: "2020=100" },
  { statCode: "721Y001", cycle: "M", itemCode: "5020000", label: "국고채 3년 금리",                 unit: "%" },
  { statCode: "721Y001", cycle: "M", itemCode: "5050000", label: "국고채 10년 금리",                unit: "%" },
  { statCode: "901Y027", cycle: "M", itemCode: "I61BC",   label: "실업률",                          unit: "%" },
  { statCode: "901Y067", cycle: "M", itemCode: "I16E",    label: "선행지수 순환변동치",               unit: "2020=100" },
];

// preset=chart — 시계열 (하위 호환)
const PRESET_CHART: PresetItem[] = [
  { statCode: "722Y001", cycle: "M",                      label: "기준금리",         unit: "%" },
  { statCode: "731Y004", cycle: "M", itemCode: "0000001", label: "원/달러 환율",     unit: "KRW" },
  { statCode: "801Y002", cycle: "M",                      label: "KOSPI",           unit: "pt" },
  { statCode: "901Y009", cycle: "M", itemCode: "0",       label: "소비자물가지수",   unit: "2020=100" },
];

type EcosRow = {
  STAT_NAME: string;
  ITEM_NAME1?: string;
  TIME: string;
  DATA_VALUE: string;
};

type EcosResponse = {
  StatisticSearch?: {
    list_total_count?: number;
    row?: EcosRow[];
  };
  RESULT?: { CODE: string; MESSAGE: string };
};

function buildEcosUrl(
  statCode: string, cycle: string, startDate: string, endDate: string,
  itemCode?: string, maxRows = 20,
): string {
  const base = `https://ecos.bok.or.kr/api/StatisticSearch/${API_KEY}/json/kr/1/${maxRows}/${statCode}/${cycle}/${startDate}/${endDate}`;
  return itemCode ? `${base}/${itemCode}` : base;
}

function defaultDateRange(cycle: string): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const todayStr = `${y}${mo}${d}`;
  const monthStr = `${y}${mo}`;
  const quarterStr = `${y}Q${Math.ceil(now.getMonth() / 3 + 1)}`;

  if (cycle === "D") return { startDate: `${y - 1}${mo}01`, endDate: todayStr };
  if (cycle === "M") return { startDate: `${y - 2}01`, endDate: monthStr };
  if (cycle === "Q") return { startDate: `${y - 3}Q1`, endDate: quarterStr };
  return { startDate: `${y - 5}`, endDate: String(y) };
}

function chartDateRange(cycle: string): { startDate: string; endDate: string; maxRows: number } {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const todayStr = `${y}${mo}${d}`;
  const monthStr = `${y}${mo}`;
  const start1y = new Date(Date.now() - 370 * 24 * 3600 * 1000);
  const sy = start1y.getFullYear();
  const smo = String(start1y.getMonth() + 1).padStart(2, "0");
  const sd = String(start1y.getDate()).padStart(2, "0");
  if (cycle === "D") return { startDate: `${sy}${smo}${sd}`, endDate: todayStr, maxRows: 430 };
  if (cycle === "W") return { startDate: `${sy}${smo}${sd}`, endDate: todayStr, maxRows: 65 };
  if (cycle === "M") return { startDate: `${y - 2}01`, endDate: monthStr, maxRows: 30 };
  return { startDate: `${y - 5}Q1`, endDate: `${y}Q4`, maxRows: 25 };
}

async function fetchEcosIndicator(
  statCode: string, cycle: string, startDate: string, endDate: string,
  itemCode?: string, chartMode = false,
): Promise<{ time: string; value: string }[]> {
  // 월별 차트는 다중 항목 시리즈(예: 731Y004 약 30종/월)를 위해 rows를 넉넉하게 확보
  const maxRows = chartMode
    ? (cycle === "D" ? 430 : cycle === "W" ? 65 : 2000)
    : 20;
  const url = buildEcosUrl(statCode, cycle, startDate, endDate, itemCode, maxRows);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as EcosResponse;
  if (data.RESULT?.CODE !== "INFO-000" && data.RESULT) {
    console.log(`[ECOS] ${statCode}/${itemCode ?? "-"} RESULT.CODE=${data.RESULT.CODE} msg="${data.RESULT.MESSAGE}"`);
    return [];
  }
  const rows = (data.StatisticSearch?.row ?? []).filter((r) => r.DATA_VALUE && r.DATA_VALUE !== "");
  if (rows.length === 0) console.log(`[ECOS] ${statCode}/${itemCode ?? "-"} rows=0 url=${url.split("ecos.bok.or.kr")[1]}`);
  if (chartMode) {
    return rows
      .sort((a, b) => a.TIME.localeCompare(b.TIME))
      .map((r) => ({ time: r.TIME, value: r.DATA_VALUE }));
  }
  return rows
    .sort((a, b) => b.TIME.localeCompare(a.TIME))
    .slice(0, 6)
    .map((r) => ({ time: r.TIME, value: r.DATA_VALUE }));
}

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json({ error: "ECOS_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  }

  const preset = req.nextUrl.searchParams.get("preset") ?? "";
  const statCode = req.nextUrl.searchParams.get("statCode")?.trim() ?? "";
  const cycle = req.nextUrl.searchParams.get("cycle")?.trim().toUpperCase() ?? "M";
  const itemCode = req.nextUrl.searchParams.get("itemCode")?.trim() || undefined;
  const startDate = req.nextUrl.searchParams.get("startDate")?.trim() ?? "";
  const endDate = req.nextUrl.searchParams.get("endDate")?.trim() ?? "";

  try {
    const isChart = req.nextUrl.searchParams.get("chart") === "true";

    // preset=keystat: 한국은행 100대 통계지표 전체 (KeyStatisticList)
    if (preset === "keystat") {
      if (keystatCache && Date.now() < keystatCacheExpiry) {
        return NextResponse.json(keystatCache);
      }
      const { groups, total } = await fetchKeyStatisticList();
      const payload = { groups, total, generatedAt: new Date().toISOString() };
      keystatCache = payload;
      keystatCacheExpiry = Date.now() + KEYSTAT_CACHE_TTL;
      return NextResponse.json(payload);
    }

    // preset=macro: 기본 거시 지표 일괄 조회 (30분 캐시)
    if (preset === "macro" || (!statCode && !preset)) {
      const macroHit = presetCache.get("macro");
      if (macroHit && macroHit.expiry > Date.now()) return NextResponse.json(macroHit.data);

      const indicators = await Promise.all(
        PRESET_MACRO.map(async (p) => {
          const { startDate: sd, endDate: ed } = defaultDateRange(p.cycle);
          const observations = await fetchEcosIndicator(p.statCode, p.cycle, sd, ed, p.itemCode);
          return { statCode: p.statCode, label: p.label, unit: p.unit, cycle: p.cycle, observations };
        }),
      );
      const macroPayload = { indicators, generatedAt: new Date().toISOString() };
      presetCache.set("macro", { data: macroPayload, expiry: Date.now() + PRESET_CACHE_TTL });
      return NextResponse.json(macroPayload);
    }

    // preset=chart: 1년 시계열 (한국 지표 차트용) — 기준금리·원달러·KOSPI·CPI (30분 캐시)
    if (preset === "chart") {
      const chartKey = `chart:${isChart ? 1 : 0}`;
      const chartHit = presetCache.get(chartKey);
      if (chartHit && chartHit.expiry > Date.now()) return NextResponse.json(chartHit.data);

      const indicators = await Promise.all(
        PRESET_CHART.map(async (p) => {
          const { startDate: sd, endDate: ed } = isChart ? chartDateRange(p.cycle) : defaultDateRange(p.cycle);
          const observations = await fetchEcosIndicator(p.statCode, p.cycle, sd, ed, p.itemCode, isChart);
          return { statCode: p.statCode, label: p.label, unit: p.unit, cycle: p.cycle, observations };
        }),
      );
      const chartPayload = { indicators, generatedAt: new Date().toISOString() };
      presetCache.set(chartKey, { data: chartPayload, expiry: Date.now() + PRESET_CACHE_TTL });
      return NextResponse.json(chartPayload);
    }

    // 단건 조회
    if (!statCode) {
      return NextResponse.json({ error: "statCode 또는 preset 파라미터가 필요합니다." }, { status: 400 });
    }
    const { startDate: defaultSd, endDate: defaultEd } = isChart ? chartDateRange(cycle) : defaultDateRange(cycle);
    const observations = await fetchEcosIndicator(statCode, cycle, startDate || defaultSd, endDate || defaultEd, itemCode, isChart);
    return NextResponse.json({
      indicators: [{ statCode, label: statCode, unit: "", cycle, observations }],
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ECOS 조회 중 오류" },
      { status: 500 },
    );
  }
}
