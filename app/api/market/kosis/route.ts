import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 통계청 KOSIS Open API
// 구직급여 등 KOSIS 전용 지표를 위한 폴백 처리 포함
// KOSIS_API_KEY가 유효하지 않거나 없는 경우 빈 observations 반환 (앱 크래시 없음)

const API_KEY = process.env.KOSIS_API_KEY ?? "";

// KOSIS 응답 캐시 — 구직급여 등 월간 데이터는 1시간 캐시로 충분
const kosisCache = new Map<string, { data: unknown; expiry: number }>();
const KOSIS_CACHE_TTL = 60 * 60 * 1000; // 1시간

// 구직급여: 고용노동부 데이터 (ECOS에 없음) — KOSIS 전용
const PRESET_MACRO: Array<{
  label: string; unit: string;
  orgId: string; tblId: string; objL1: string; itmId: string; prdSe: string;
}> = [
  { label: "구직급여 신규 신청 (월간)", unit: "천명",
    orgId: "350", tblId: "DT_350_2018_N002", objL1: "ALL", itmId: "T", prdSe: "M" },
];

type KosisRow = { PRD_DE: string; DT: string };

async function fetchKosis(
  orgId: string, tblId: string, objL1: string, itmId: string, prdSe: string,
  startPrdDe: string, endPrdDe: string, chartMode = false,
): Promise<{ time: string; value: string }[]> {
  if (!API_KEY) return [];
  try {
    const params = new URLSearchParams({
      method: "getList", apiKey: API_KEY, format: "json", jsonVD: "Y",
      orgId, tblId, objL1Id: objL1, objL2Id: "", objL3Id: "", itmId, prdSe, startPrdDe, endPrdDe,
    });
    const res = await fetch(
      `https://kosis.kr/openapi/statisticsData.do?${params.toString()}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as KosisRow[] | { err?: string };
    if (!Array.isArray(data)) return [];
    const filtered = data.filter((r) => r.DT && r.PRD_DE);
    if (chartMode) {
      return filtered.sort((a, b) => a.PRD_DE.localeCompare(b.PRD_DE)).map((r) => ({ time: r.PRD_DE, value: r.DT }));
    }
    return filtered.sort((a, b) => b.PRD_DE.localeCompare(a.PRD_DE)).slice(0, 6).map((r) => ({ time: r.PRD_DE, value: r.DT }));
  } catch {
    // API 키 미등록 또는 KOSIS 서버 오류 — 앱 크래시 없이 빈 배열 반환
    return [];
  }
}

function defaultPrdRange(prdSe: string): { startPrdDe: string; endPrdDe: string } {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  if (prdSe === "M") return { startPrdDe: `${y - 2}01`, endPrdDe: `${y}${mo}` };
  if (prdSe === "Q") return { startPrdDe: `${y - 3}Q1`, endPrdDe: `${y}Q4` };
  return { startPrdDe: String(y - 5), endPrdDe: String(y) };
}

function chartPrdRange(prdSe: string): { startPrdDe: string; endPrdDe: string } {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  if (prdSe === "M") return { startPrdDe: `${y - 4}01`, endPrdDe: `${y}${mo}` };
  if (prdSe === "Q") return { startPrdDe: `${y - 5}Q1`, endPrdDe: `${y}Q4` };
  return { startPrdDe: String(y - 5), endPrdDe: String(y) };
}

export async function GET(req: NextRequest) {
  const isChart = req.nextUrl.searchParams.get("chart") === "true";
  const preset = req.nextUrl.searchParams.get("preset") ?? "";
  const orgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? "";
  const tblId = req.nextUrl.searchParams.get("tblId")?.trim() ?? "";
  const objL1 = req.nextUrl.searchParams.get("objL1")?.trim() ?? "ALL";
  const itmId = req.nextUrl.searchParams.get("itmId")?.trim() ?? "T";
  const prdSe = req.nextUrl.searchParams.get("prdSe")?.trim().toUpperCase() ?? "M";
  const startPrdDe = req.nextUrl.searchParams.get("startPrdDe")?.trim() ?? "";
  const endPrdDe = req.nextUrl.searchParams.get("endPrdDe")?.trim() ?? "";

  try {
    if (preset === "macro" || (!orgId && !tblId && !preset)) {
      const hit = kosisCache.get("macro");
      if (hit && hit.expiry > Date.now()) return NextResponse.json(hit.data);

      const indicators = await Promise.all(
        PRESET_MACRO.map(async (p) => {
          const { startPrdDe: sd, endPrdDe: ed } = defaultPrdRange(p.prdSe);
          const observations = await fetchKosis(p.orgId, p.tblId, p.objL1, p.itmId, p.prdSe, sd, ed);
          return {
            label: p.label, unit: p.unit, orgId: p.orgId, tblId: p.tblId, prdSe: p.prdSe,
            observations,
            apiKeyRequired: !API_KEY || observations.length === 0,
          };
        }),
      );
      const payload = { indicators, generatedAt: new Date().toISOString() };
      kosisCache.set("macro", { data: payload, expiry: Date.now() + KOSIS_CACHE_TTL });
      return NextResponse.json(payload);
    }

    if (!orgId || !tblId) {
      return NextResponse.json({ error: "orgId, tblId 또는 preset 파라미터가 필요합니다." }, { status: 400 });
    }
    const customKey = `${orgId}:${tblId}:${objL1}:${itmId}:${prdSe}:${isChart ? 1 : 0}`;
    const customHit = kosisCache.get(customKey);
    if (customHit && customHit.expiry > Date.now()) return NextResponse.json(customHit.data);

    const { startPrdDe: defaultSd, endPrdDe: defaultEd } = isChart ? chartPrdRange(prdSe) : defaultPrdRange(prdSe);
    const observations = await fetchKosis(orgId, tblId, objL1, itmId, prdSe, startPrdDe || defaultSd, endPrdDe || defaultEd, isChart);
    const customPayload = {
      indicators: [{ label: tblId, unit: "", orgId, tblId, prdSe, observations, apiKeyRequired: !API_KEY || observations.length === 0 }],
      generatedAt: new Date().toISOString(),
    };
    kosisCache.set(customKey, { data: customPayload, expiry: Date.now() + KOSIS_CACHE_TTL });
    return NextResponse.json(customPayload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "KOSIS 조회 중 오류" },
      { status: 500 },
    );
  }
}
