"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import {
  RefreshCw, AlertCircle, Loader2, Search, Star, TrendingUp, TrendingDown,
} from "lucide-react";
import { usePortfolioResult } from "../PortfolioResultComponents";
import type { PortfolioAsset } from "../CustomerContext";
import StockSearchBox from "./StockSearchBox";

// ── Stock Universe ─────────────────────────────────────────────────────────

const KOSPI_UNIVERSE: { ticker: string; name: string }[] = [
  { ticker: "005930", name: "삼성전자" },
  { ticker: "000660", name: "SK하이닉스" },
  { ticker: "402340", name: "SK스퀘어" },
  { ticker: "005935", name: "삼성전자우" },
  { ticker: "009150", name: "삼성전기" },
  { ticker: "005380", name: "현대차" },
  { ticker: "032830", name: "삼성생명" },
  { ticker: "373220", name: "LG에너지솔루션" },
  { ticker: "028260", name: "삼성물산" },
  { ticker: "329180", name: "HD현대중공업" },
  { ticker: "207940", name: "삼성바이오로직스" },
  { ticker: "000270", name: "기아" },
  { ticker: "105560", name: "KB금융" },
  { ticker: "055550", name: "신한지주" },
  { ticker: "068270", name: "셀트리온" },
  { ticker: "035420", name: "NAVER" },
  { ticker: "086790", name: "하나금융지주" },
  { ticker: "005490", name: "POSCO홀딩스" },
  { ticker: "066570", name: "LG전자" },
  { ticker: "006400", name: "삼성SDI" },
];

const KOSDAQ_UNIVERSE: { ticker: string; name: string }[] = [
  { ticker: "196170", name: "알테오젠" },
  { ticker: "247540", name: "에코프로비엠" },
  { ticker: "086520", name: "에코프로" },
  { ticker: "277810", name: "레인보우로보틱스" },
  { ticker: "036930", name: "주성엔지니어링" },
  { ticker: "950240", name: "코오롱티슈진" },
  { ticker: "240810", name: "원익IPS" },
  { ticker: "058470", name: "리노공업" },
  { ticker: "028300", name: "HLB" },
  { ticker: "000250", name: "삼천당제약" },
  { ticker: "403870", name: "HPSP" },
  { ticker: "141080", name: "리가켐바이오" },
  { ticker: "214150", name: "클래시스" },
  { ticker: "263750", name: "펄어비스" },
  { ticker: "357780", name: "솔브레인" },
];

const MARKET_PROXY: Record<"KOSPI" | "KOSDAQ", { ticker: string; name: string }> = {
  KOSPI:  { ticker: "069500", name: "KODEX 200" },
  KOSDAQ: { ticker: "229200", name: "KODEX KOSDAQ150" },
};

// ── Types ──────────────────────────────────────────────────────────────────

type InvestorDay = {
  stck_bsop_date: string;
  stck_clpr: string;
  prsn_ntby_tr_pbmn: string;
  frgn_ntby_tr_pbmn: string;
  orgn_ntby_tr_pbmn: string;
  prsn_ntby_qty: string;
  frgn_ntby_qty: string;
  orgn_ntby_qty: string;
  [k: string]: string;
};

type StockSummary = {
  ticker: string; name: string;
  rank: number; marketCap: number;
  date: string;
  frgn: number; orgn: number; prsn: number; total: number;
  frgn_qty: number; orgn_qty: number; prsn_qty: number; total_qty: number;
  price: string;
};

type InvestorKey = "frgn" | "orgn" | "prsn" | "total";
type DisplayMode = "amount" | "qty";
type Market = "KOSPI" | "KOSDAQ";
type TabId = "holdings" | "market" | "top" | "investor" | "smart";

// ── Helpers ────────────────────────────────────────────────────────────────

const INVESTOR_LABELS: Record<InvestorKey, string> = {
  frgn: "외국인", orgn: "기관", prsn: "개인", total: "합산",
};
const INVESTOR_COLORS: Record<InvestorKey, string> = {
  frgn: "#3b82f6", orgn: "#f59e0b", prsn: "#22c55e", total: "#6366f1",
};

function fmtDate(d: string) {
  return d?.length >= 8 ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : d;
}
function toNum(s?: string) {
  const n = parseInt(s ?? "", 10);
  return isNaN(n) ? 0 : n;
}
function fmtAmtM(val: number) {
  const abs = Math.abs(val);
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(2)}조`;
  if (abs >= 100)     return `${sign}${Math.round(abs / 100).toLocaleString()}억`;
  if (abs >= 1)       return `${sign}${(abs * 100).toLocaleString()}만`;
  return "0";
}
function fmtQty(val: number) {
  const abs = Math.abs(val);
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(1)}천만주`;
  if (abs >= 10000)    return `${sign}${Math.round(abs / 10000)}만주`;
  if (abs >= 1000)     return `${sign}${Math.round(abs / 1000)}천주`;
  return val !== 0 ? `${sign}${abs.toLocaleString()}주` : "0주";
}
function fmtValue(val: number, mode: DisplayMode) {
  return mode === "amount" ? fmtAmtM(val) : fmtQty(val);
}
function unitLabel(mode: DisplayMode) {
  return mode === "amount" ? "단위: 억원" : "단위: 주";
}
function getSummaryVal(s: StockSummary, k: InvestorKey, mode: DisplayMode): number {
  if (mode === "qty") {
    if (k === "frgn") return s.frgn_qty;
    if (k === "orgn") return s.orgn_qty;
    if (k === "prsn") return s.prsn_qty;
    return s.total_qty;
  }
  return s[k];
}
function amtColor(val: number) {
  return val > 0 ? "text-red-500" : val < 0 ? "text-blue-500" : "text-slate-300";
}
function barColor(val: number) { return val >= 0 ? "#ef4444" : "#3b82f6"; }

function fmtAmtWon(won: number) {
  const abs = Math.abs(won);
  const sign = won > 0 ? "+" : won < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}조`;
  if (abs >= 1e8)  return `${sign}${Math.round(abs / 1e8).toLocaleString()}억`;
  if (abs >= 1e4)  return `${sign}${Math.round(abs / 1e4)}만`;
  return won !== 0 ? `${sign}${abs.toLocaleString()}` : "0";
}
function fmtQtyNum(qty: number) {
  const abs = Math.abs(qty);
  const sign = qty > 0 ? "+" : qty < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(1)}천만주`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4)}만주`;
  return qty !== 0 ? `${sign}${abs.toLocaleString()}주` : "0주";
}

const ORG_SUB_TYPES = ["기관합계", "연기금", "금융투자", "사모", "보험", "투신"] as const;
type OrgSubType = typeof ORG_SUB_TYPES[number];

type PykrxRow = { ticker: string; name: string; net_qty: number; net_amt: number };
type PykrxData = {
  ok: boolean; date: string; market: string; investor?: string;
  count?: number; buy_top?: PykrxRow[]; sell_top?: PykrxRow[];
  data?: (PykrxRow & { frgn_amt?: number; orgn_amt?: number })[];
  error?: string;
};

// Yahoo Finance 형식 ticker에서 KIS용 6자리 코드만 추출
function cleanTicker(t: string) {
  return t.replace(/\.(KS|KQ|KRX)$/i, "").trim();
}

// ── Shared UI ──────────────────────────────────────────────────────────────

function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14">
      <Loader2 size={26} className="animate-spin text-[#2f2f9d]" />
      {label && <p className="text-xs font-semibold text-slate-400">{label}</p>}
    </div>
  );
}

function ErrBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-5 my-2">
      <p className="flex items-center gap-1.5 text-sm font-bold text-red-600">
        <AlertCircle size={15} /> 데이터 로드 실패
      </p>
      <p className="text-xs font-semibold text-red-400 max-w-sm break-all text-center">{msg}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700">
          <RefreshCw size={11} /> 다시 시도
        </button>
      )}
    </div>
  );
}

// ── SharedHeader (시장/정렬 컨트롤) ───────────────────────────────────────

function SharedHeader({
  market, setMarket, investorType, setInvestorType,
  displayMode, setDisplayMode, latestDate,
  orgSubType, setOrgSubType, activeTab,
}: {
  market: Market; setMarket: (m: Market) => void;
  investorType: InvestorKey; setInvestorType: (k: InvestorKey) => void;
  displayMode: DisplayMode; setDisplayMode: (m: DisplayMode) => void;
  latestDate: string;
  orgSubType: OrgSubType; setOrgSubType: (s: OrgSubType) => void;
  activeTab: TabId;
}) {
  const [orgOpen, setOrgOpen] = useState(false);
  useEffect(() => { if (investorType !== "orgn") setOrgOpen(false); }, [investorType]);

  const handleOrgClick = () => {
    if (activeTab === "market") { setInvestorType("orgn"); setOrgOpen(false); }
    else { setOrgOpen((p) => !p); }
  };
  const handleSubType = (sub: OrgSubType) => { setOrgSubType(sub); setInvestorType("orgn"); setOrgOpen(false); };
  const orgActive = investorType === "orgn" || orgOpen;

  return (
    <div className="border-b border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">시장</span>
            <div className="flex rounded-md overflow-hidden border border-slate-200 shadow-sm">
              {(["KOSPI", "KOSDAQ"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMarket(m)}
                  className={`px-3 py-1.5 text-xs font-bold transition ${market === m ? "bg-[#2f2f9d] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          {latestDate && (
            <span className="text-xs font-semibold text-slate-400">
              기준일 <span className="text-slate-600">{fmtDate(latestDate)}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">표시</span>
            <div className="flex rounded-md overflow-hidden border border-slate-200 shadow-sm">
              {([["amount", "금액(억)"], ["qty", "수량(주)"]] as [DisplayMode, string][]).map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => setDisplayMode(mode)}
                  className={`px-2.5 py-1.5 text-xs font-bold transition ${displayMode === mode ? "bg-slate-700 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">정렬</span>
            <div className="flex rounded-md border border-slate-200 shadow-sm overflow-visible">
              <button type="button" onClick={() => { setInvestorType("frgn"); setOrgOpen(false); }}
                className={`rounded-l-md px-2.5 py-1.5 text-xs font-bold border-r border-slate-200 transition ${investorType === "frgn" ? "text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                style={investorType === "frgn" ? { backgroundColor: INVESTOR_COLORS.frgn } : {}}>
                외국인순
              </button>
              <div className="relative border-r border-slate-200">
                <button type="button" onClick={handleOrgClick}
                  className={`px-2.5 py-1.5 text-xs font-bold transition ${orgActive ? "text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                  style={orgActive ? { backgroundColor: INVESTOR_COLORS.orgn } : {}}>
                  기관순
                </button>
                {orgOpen && activeTab !== "market" && (
                  <div className="absolute top-full left-0 z-50 mt-0.5 w-20 rounded-md border border-amber-300 bg-white shadow-lg overflow-hidden">
                    {ORG_SUB_TYPES.map((sub) => (
                      <button key={sub} type="button" onClick={() => handleSubType(sub)}
                        className={`block w-full px-2.5 py-1.5 text-xs font-bold text-left whitespace-nowrap transition
                          ${orgSubType === sub && investorType === "orgn" ? "text-white" : "text-slate-600 hover:bg-slate-100"}`}
                        style={orgSubType === sub && investorType === "orgn" ? { backgroundColor: INVESTOR_COLORS.orgn } : {}}>
                        {sub}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => { setInvestorType("prsn"); setOrgOpen(false); }}
                className={`px-2.5 py-1.5 text-xs font-bold border-r border-slate-200 transition ${investorType === "prsn" ? "text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                style={investorType === "prsn" ? { backgroundColor: INVESTOR_COLORS.prsn } : {}}>
                개인순
              </button>
              <button type="button" onClick={() => { setInvestorType("total"); setOrgOpen(false); }}
                className={`rounded-r-md px-2.5 py-1.5 text-xs font-bold transition ${investorType === "total" ? "text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                style={investorType === "total" ? { backgroundColor: INVESTOR_COLORS.total } : {}}>
                합산순
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, mode }: {
  active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string; mode?: DisplayMode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg min-w-[160px]">
      <p className="mb-1.5 text-xs font-bold text-slate-500">{label}</p>
      {payload.map((p) => {
        const rawKey = p.dataKey.replace("_q", "") as InvestorKey;
        return (
          <p key={p.dataKey} className={`text-xs font-semibold ${amtColor(p.value)}`}>
            {INVESTOR_LABELS[rawKey] ?? p.dataKey}: {fmtValue(p.value, mode ?? "amount")}
          </p>
        );
      })}
    </div>
  );
}

// ── Data Fetching ──────────────────────────────────────────────────────────

function useInvestorHistory(ticker: string) {
  const [data, setData] = useState<InvestorDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nocache = false) => {
    const t = cleanTicker(ticker);
    if (!t) return;
    setLoading(true); setError(""); setData([]);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
      for (const mkt of ["J", "Q"]) {
        try {
          const res = await fetch(`/api/supply-demand?type=investor&ticker=${t}&market=${mkt}${nocache ? "&nocache=1" : ""}`);
          const json = await res.json();
          if (json.rt_cd && json.rt_cd !== "0") continue;
          const rows = (json.output ?? []).filter((d: InvestorDay) => d.frgn_ntby_tr_pbmn !== "");
          if (rows.length > 0) { setData(rows); setLoading(false); return; }
        } catch { continue; }
      }
    }
    setError("KIS 레이트리밋 또는 데이터 없음 — 잠시 후 다시 시도해주세요");
    setLoading(false);
  }, [ticker]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

async function fetchMarketCapRanking(
  universe: { ticker: string; name: string }[],
  suffix: string,
  nocache = false
): Promise<{ ticker: string; name: string; marketCap: number; rank: number }[]> {
  const tickers = universe.map((s) => s.ticker).join(",");
  let ranked: { ticker: string; marketCap: number }[] = [];
  try {
    const res = await fetch(`/api/supply-demand?type=marketcap&tickers=${tickers}&suffix=${encodeURIComponent(suffix)}${nocache ? "&nocache=1" : ""}`);
    const json = await res.json();
    ranked = (json.ranked ?? []) as { ticker: string; marketCap: number }[];
  } catch {
    return universe.map((s, i) => ({ ...s, marketCap: 0, rank: i + 1 }));
  }
  if (ranked.length < universe.length * 0.5) {
    return universe.map((s, i) => ({ ...s, marketCap: 0, rank: i + 1 }));
  }
  const yfMap = new Map(ranked.map((r) => [r.ticker, r.marketCap]));
  const caps = universe.map((s, idx) => {
    const direct = yfMap.get(s.ticker);
    if (direct != null) return direct;
    let prev = 0, next = 0;
    for (let i = idx - 1; i >= 0; i--) { const c = yfMap.get(universe[i].ticker); if (c) { prev = c; break; } }
    for (let i = idx + 1; i < universe.length; i++) { const c = yfMap.get(universe[i].ticker); if (c) { next = c; break; } }
    if (prev > 0 && next > 0) return (prev + next) / 2;
    if (prev > 0) return prev * 0.95;
    if (next > 0) return next * 1.05;
    return 0;
  });
  return universe
    .map((s, i) => ({ ...s, marketCap: caps[i] }))
    .sort((a, b) => b.marketCap - a.marketCap)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

async function fetchOneSummary(
  stock: { ticker: string; name: string; rank: number; marketCap: number },
  nocache = false
): Promise<StockSummary | null> {
  for (const mkt of ["J", "Q"]) {
    try {
      const res = await fetch(`/api/supply-demand?type=investor&ticker=${stock.ticker}&market=${mkt}${nocache ? "&nocache=1" : ""}`);
      const json = await res.json();
      const rows: InvestorDay[] = (json.output ?? []).filter((d: InvestorDay) => d.frgn_ntby_tr_pbmn !== "");
      const d = rows[0];
      if (!d) continue;
      const frgn = toNum(d.frgn_ntby_tr_pbmn), orgn = toNum(d.orgn_ntby_tr_pbmn), prsn = toNum(d.prsn_ntby_tr_pbmn);
      const frgn_qty = toNum(d.frgn_ntby_qty), orgn_qty = toNum(d.orgn_ntby_qty), prsn_qty = toNum(d.prsn_ntby_qty);
      return {
        ticker: stock.ticker, name: stock.name, rank: stock.rank, marketCap: stock.marketCap,
        date: d.stck_bsop_date, frgn, orgn, prsn, total: frgn + orgn + prsn,
        frgn_qty, orgn_qty, prsn_qty, total_qty: frgn_qty + orgn_qty + prsn_qty,
        price: d.stck_clpr,
      };
    } catch { continue; }
  }
  return null;
}

async function batchFetchSummaries(
  stocks: { ticker: string; name: string; rank: number; marketCap: number }[],
  nocache = false
): Promise<(StockSummary | null)[]> {
  const BATCH = 2;
  const results: (StockSummary | null)[] = [];
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = await Promise.all(stocks.slice(i, i + BATCH).map((s) => fetchOneSummary(s, nocache)));
    results.push(...batch);
    if (i + BATCH < stocks.length) await new Promise((r) => setTimeout(r, 700));
  }
  return results;
}

// ── 보유 종목 분석 탭 콘텐츠 (종목 선택은 최상단 박스에서 처리) ───────────

function HoldingsContent({
  data, loading, error, reload, displayMode, setDisplayMode,
}: {
  data: InvestorDay[];
  loading: boolean;
  error: string;
  reload: (nocache?: boolean) => void;
  displayMode: DisplayMode;
  setDisplayMode: (m: DisplayMode) => void;
}) {
  const latest = data[0];
  const chartData = data.slice(0, 20).reverse().map((d) => {
    const frgn = toNum(d.frgn_ntby_tr_pbmn), orgn = toNum(d.orgn_ntby_tr_pbmn), prsn = toNum(d.prsn_ntby_tr_pbmn);
    const fq = toNum(d.frgn_ntby_qty), oq = toNum(d.orgn_ntby_qty), pq = toNum(d.prsn_ntby_qty);
    return {
      date: fmtDate(d.stck_bsop_date),
      frgn, orgn, prsn, total: frgn + orgn + prsn,
      frgn_q: fq, orgn_q: oq, prsn_q: pq, total_q: fq + oq + pq,
    };
  });
  const tableRows = data.slice(0, 10);
  const dKey = displayMode === "amount" ? "frgn" : "frgn_q";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 font-semibold">
          {unitLabel(displayMode)}
        </span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400">표시</span>
            <div className="flex rounded-md overflow-hidden border border-slate-200">
              {([["amount", "금액(억)"], ["qty", "수량(주)"]] as [DisplayMode, string][]).map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => setDisplayMode(mode)}
                  className={`px-2 py-1.5 text-[11px] font-bold transition ${displayMode === mode ? "bg-slate-700 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => reload(true)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <RefreshCw size={11} /> 새로고침
          </button>
        </div>
      </div>

      {loading ? <Spinner label="수급 데이터 로드 중…" /> :
       error   ? <ErrBox msg={error} onRetry={() => reload(true)} /> : (
        <>
          {latest && (
            <div className="grid grid-cols-3 gap-3">
              {(["frgn", "orgn", "prsn"] as const).map((k) => {
                const val = displayMode === "amount" ? toNum(latest[`${k}_ntby_tr_pbmn`]) : toNum(latest[`${k}_ntby_qty`]);
                return (
                  <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500 mb-1">{INVESTOR_LABELS[k]}</p>
                    <p className={`text-base font-extrabold ${amtColor(val)}`}>{fmtValue(val, displayMode)}</p>
                  </div>
                );
              })}
            </div>
          )}

          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 16, right: 4, bottom: 8, left: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={52}
                  domain={[
                    (min: number) => Math.min(0, Math.floor(min * 1.4)),
                    (max: number) => Math.max(0, Math.ceil(max * 1.4)),
                  ]}
                  tickFormatter={(v: number) => displayMode === "amount"
                    ? (Math.abs(v) >= 100 ? `${Math.round(v / 100)}억` : `${v}백만`)
                    : (Math.abs(v) >= 10000 ? `${Math.round(v / 10000)}만주` : `${v}주`)} />
                <Tooltip content={<ChartTooltip mode={displayMode} />} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <Bar dataKey={dKey} name={dKey} radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => {
                    const val = d[dKey as keyof typeof d] as number ?? 0;
                    return <Cell key={i} fill={barColor(val)} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {tableRows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="py-2 px-3 text-left font-bold text-slate-500">일자</th>
                    {(["frgn", "orgn", "prsn", "total"] as InvestorKey[]).map((k) => (
                      <th key={k} className="py-2 px-3 text-right font-bold text-slate-500">{INVESTOR_LABELS[k]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((d) => {
                    const vals: Record<InvestorKey, number> = displayMode === "amount"
                      ? { frgn: toNum(d.frgn_ntby_tr_pbmn), orgn: toNum(d.orgn_ntby_tr_pbmn), prsn: toNum(d.prsn_ntby_tr_pbmn), total: toNum(d.frgn_ntby_tr_pbmn) + toNum(d.orgn_ntby_tr_pbmn) + toNum(d.prsn_ntby_tr_pbmn) }
                      : { frgn: toNum(d.frgn_ntby_qty), orgn: toNum(d.orgn_ntby_qty), prsn: toNum(d.prsn_ntby_qty), total: toNum(d.frgn_ntby_qty) + toNum(d.orgn_ntby_qty) + toNum(d.prsn_ntby_qty) };
                    return (
                      <tr key={d.stck_bsop_date} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-1.5 px-3 font-semibold text-slate-600">{fmtDate(d.stck_bsop_date)}</td>
                        {(["frgn", "orgn", "prsn", "total"] as InvestorKey[]).map((k) => (
                          <td key={k} className={`py-1.5 px-3 text-right font-bold ${amtColor(vals[k])}`}>
                            {fmtValue(vals[k], displayMode)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 시장 동향 ──────────────────────────────────────────────────────────────

function MarketTrendContent({
  market, investorType, displayMode,
}: { market: Market; investorType: InvestorKey; displayMode: DisplayMode }) {
  const proxy = MARKET_PROXY[market];
  const { data, loading, error, reload } = useInvestorHistory(proxy.ticker);

  const chartData = data.slice(0, 20).reverse().map((d) => {
    const frgn = toNum(d.frgn_ntby_tr_pbmn), orgn = toNum(d.orgn_ntby_tr_pbmn), prsn = toNum(d.prsn_ntby_tr_pbmn);
    const fq = toNum(d.frgn_ntby_qty), oq = toNum(d.orgn_ntby_qty), pq = toNum(d.prsn_ntby_qty);
    return {
      date: fmtDate(d.stck_bsop_date),
      frgn, orgn, prsn, total: frgn + orgn + prsn,
      frgn_q: fq, orgn_q: oq, prsn_q: pq, total_q: fq + oq + pq,
    };
  });
  const chartKey = displayMode === "amount" ? investorType : `${investorType}_q`;
  const tableRows = data.slice(0, 10);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {proxy.name} 기준 ·{" "}
          <span style={{ color: INVESTOR_COLORS[investorType] }} className="font-bold">
            {INVESTOR_LABELS[investorType]}
          </span>
          {" "}· {unitLabel(displayMode)}
        </span>
        <button type="button" onClick={() => reload(true)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <RefreshCw size={11} /> 새로고침
        </button>
      </div>

      {loading ? <Spinner label="시장 수급 데이터 불러오는 중…" /> :
       error   ? <ErrBox msg={error} onRetry={() => reload(true)} /> : (
        <>
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 16, right: 4, bottom: 8, left: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={56}
                  domain={[
                    (min: number) => Math.min(0, Math.floor(min * 1.2)),
                    (max: number) => Math.max(0, Math.ceil(max * 1.2)),
                  ]}
                  tickFormatter={(v: number) => displayMode === "amount"
                    ? (Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}조` : `${Math.round(v/100).toLocaleString()}억`)
                    : (Math.abs(v) >= 10000 ? `${Math.round(v/10000)}만주` : `${v}주`)} />
                <Tooltip content={<ChartTooltip mode={displayMode} />} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <Bar dataKey={chartKey} name={chartKey} radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => {
                    const val = d[chartKey as keyof typeof d] as number ?? 0;
                    return <Cell key={i} fill={barColor(val)} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {tableRows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="py-2 px-3 text-left font-bold text-slate-500">일자</th>
                    {(["frgn", "orgn", "prsn", "total"] as InvestorKey[]).map((k) => (
                      <th key={k} className={`py-2 px-3 text-right font-bold text-slate-500 ${investorType === k ? "underline underline-offset-2" : ""}`}>
                        {INVESTOR_LABELS[k]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((d) => {
                    const frgn = toNum(d.frgn_ntby_tr_pbmn), orgn = toNum(d.orgn_ntby_tr_pbmn), prsn = toNum(d.prsn_ntby_tr_pbmn);
                    const fq = toNum(d.frgn_ntby_qty), oq = toNum(d.orgn_ntby_qty), pq = toNum(d.prsn_ntby_qty);
                    const vals: Record<InvestorKey, number> = displayMode === "amount"
                      ? { frgn, orgn, prsn, total: frgn + orgn + prsn }
                      : { frgn: fq, orgn: oq, prsn: pq, total: fq + oq + pq };
                    return (
                      <tr key={d.stck_bsop_date} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-1.5 px-3 font-semibold text-slate-600">{fmtDate(d.stck_bsop_date)}</td>
                        {(["frgn", "orgn", "prsn", "total"] as InvestorKey[]).map((k) => (
                          <td key={k} className={`py-1.5 px-3 text-right font-bold ${amtColor(vals[k])} ${investorType === k ? "font-extrabold" : ""}`}>
                            {fmtValue(vals[k], displayMode)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 시총 상위종목 분석 ─────────────────────────────────────────────────────

function TopStocksContent({
  market, investorType, displayMode, orgSubType, summaries, loading, error, onRefresh,
}: {
  market: Market; investorType: InvestorKey; displayMode: DisplayMode; orgSubType: OrgSubType;
  summaries: (StockSummary | null)[]; loading: boolean; error: string; onRefresh: () => void;
}) {
  const useSubType = investorType === "orgn" && orgSubType !== "기관합계";
  const [subMap, setSubMap] = useState<Record<string, { net_amt: number; net_qty: number }>>({});
  const [subLoading, setSubLoading] = useState(false);

  useEffect(() => {
    if (!useSubType) { setSubMap({}); return; }
    setSubLoading(true);
    fetch(`/api/pykrx?type=orgsubtype&market=${market}&investor=${encodeURIComponent(orgSubType)}`)
      .then((r) => r.json())
      .then((d) => { setSubMap(d.tickerMap ?? {}); })
      .catch(() => setSubMap({}))
      .finally(() => setSubLoading(false));
  }, [market, orgSubType, useSubType]);

  const top10 = summaries.filter((s): s is StockSummary => s !== null).sort((a, b) => a.rank - b.rank).slice(0, 10);

  const getDisplayVal = (s: StockSummary): number => {
    if (useSubType) { const e = subMap[s.ticker]; return e ? (displayMode === "amount" ? e.net_amt : e.net_qty) : 0; }
    return getSummaryVal(s, investorType, displayMode);
  };
  const fmtDisplayVal = (s: StockSummary): string => {
    if (useSubType) { const e = subMap[s.ticker]; if (!e) return "-"; return displayMode === "amount" ? fmtAmtWon(e.net_amt) : fmtQtyNum(e.net_qty); }
    return fmtValue(getSummaryVal(s, investorType, displayMode), displayMode);
  };

  const maxAbs = Math.max(...top10.map((s) => Math.abs(getDisplayVal(s))), 1);
  const isDataLoading = loading || (useSubType && subLoading);
  const investorLabel = investorType === "orgn" ? orgSubType : INVESTOR_LABELS[investorType];
  const unitStr = useSubType ? (displayMode === "amount" ? "억원 (pykrx 세부 기관)" : "주 (pykrx 세부 기관)") : unitLabel(displayMode);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {market} 시총 상위 10종목 ·{" "}
          <span style={{ color: INVESTOR_COLORS[investorType] }} className="font-bold">{investorLabel}</span>
          {" "}· {unitStr}
        </span>
        <button type="button" onClick={onRefresh} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <RefreshCw size={11} /> 새로고침
        </button>
      </div>
      {isDataLoading ? <Spinner label={useSubType ? `${orgSubType} 세부 데이터 로드 중…` : "Yahoo Finance 시총 + KIS 수급 로드 중…"} /> :
       error ? <ErrBox msg={error} onRetry={onRefresh} /> :
       top10.length === 0 ? <p className="py-10 text-center text-xs text-slate-400">데이터 없음</p> : (
        <div className="flex flex-col gap-2">
          {top10.map((s) => {
            const val = getDisplayVal(s);
            const pct = Math.min((Math.abs(val) / maxAbs) * 100, 100);
            return (
              <div key={s.ticker} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-xs font-bold text-slate-300 text-right">{s.rank}</span>
                <div className="w-28 shrink-0">
                  <p className="text-xs font-bold text-slate-700 truncate">{s.name}</p>
                  <p className="text-[10px] font-mono text-slate-400">{s.ticker}</p>
                </div>
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor(val) }} />
                  </div>
                  <span className={`w-16 shrink-0 text-right text-xs font-bold ${amtColor(val)}`}>{fmtDisplayVal(s)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 수급 주체별 분석 ───────────────────────────────────────────────────────

function InvestorAnalysisContent({
  market, displayMode, investorType, orgSubType,
}: { market: Market; displayMode: DisplayMode; investorType: InvestorKey; orgSubType: OrgSubType }) {
  const pykrxInvestor: string | null =
    investorType === "frgn" ? "외국인" :
    investorType === "orgn" ? orgSubType :
    investorType === "prsn" ? "개인" : null;

  const [pData, setPData] = useState<PykrxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nocache = false) => {
    if (!pykrxInvestor) return;
    setLoading(true); setError(""); setPData(null);
    try {
      const res = await fetch(`/api/pykrx?market=${market}&investor=${encodeURIComponent(pykrxInvestor)}&top_n=10${nocache ? "&nocache=1" : ""}`);
      const json: PykrxData = await res.json();
      if (!json.ok) throw new Error(json.error ?? "pykrx 오류");
      setPData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, pykrxInvestor]);

  useEffect(() => { load(); }, [load]);

  const fmtRow = (r: PykrxRow) => displayMode === "amount" ? fmtAmtWon(r.net_amt) : fmtQtyNum(r.net_qty);
  const investorLabel = pykrxInvestor ?? "합산";

  if (!pykrxInvestor) {
    return (
      <div className="p-6 text-center text-xs text-slate-400">
        합산 기준 순위는 수급 주체별 분석에서 지원하지 않습니다.<br />
        시총 상위종목 분석 탭에서 합산순 정렬을 이용해 주세요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        {pData ? (
          <span className="text-xs text-slate-400">
            <span className="font-bold text-slate-600">{investorLabel}</span>
            {" "}· {market} 전체 {pData.count?.toLocaleString()}종목 · 기준일 {fmtDate(pData.date)}
            {" "}· {displayMode === "amount" ? "억원" : "주"}
          </span>
        ) : <span />}
        <button type="button" onClick={() => load(true)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <RefreshCw size={11} /> 새로고침
        </button>
      </div>
      {loading ? <Spinner label={`${market} 전체 시장 ${investorLabel} 분석 중…`} /> :
       error   ? <ErrBox msg={error} onRetry={() => load(true)} /> :
       !pData  ? null :
       (pData.buy_top?.length ?? 0) === 0 && (pData.sell_top?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-400">
          <RefreshCw size={22} className="text-slate-300" />
          <p className="text-sm font-semibold">데이터가 아직 준비되지 않았습니다</p>
          <p className="text-xs text-slate-400">
            당일 수급 데이터는 장 마감(16:00) 이후 확정됩니다.
          </p>
          <button type="button" onClick={() => load(true)}
            className="mt-2 flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 transition">
            <RefreshCw size={11} /> 새로고침
          </button>
        </div>
       ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-red-200 bg-red-50/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-red-600 mb-2">
              <TrendingUp size={13} /> {investorLabel} 순매수 TOP 10
            </p>
            <table className="w-full">
              <tbody>
                {(pData.buy_top ?? []).map((r, i) => (
                  <tr key={r.ticker} className="border-b border-red-100 last:border-0">
                    <td className="py-1.5 pr-2 text-xs font-bold text-red-300 w-5">{i + 1}</td>
                    <td className="py-1.5 pr-2">
                      <p className="text-xs font-bold text-slate-800">{r.name}</p>
                      <p className="text-[9px] text-slate-400">{r.ticker}</p>
                    </td>
                    <td className="py-1.5 text-right text-xs font-extrabold text-red-600">{fmtRow(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-blue-600 mb-2">
              <TrendingDown size={13} /> {investorLabel} 순매도 TOP 10
            </p>
            <table className="w-full">
              <tbody>
                {(pData.sell_top ?? []).map((r, i) => (
                  <tr key={r.ticker} className="border-b border-blue-100 last:border-0">
                    <td className="py-1.5 pr-2 text-xs font-bold text-blue-300 w-5">{i + 1}</td>
                    <td className="py-1.5 pr-2">
                      <p className="text-xs font-bold text-slate-800">{r.name}</p>
                      <p className="text-[9px] text-slate-400">{r.ticker}</p>
                    </td>
                    <td className="py-1.5 text-right text-xs font-extrabold text-blue-600">{fmtRow(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 스마트머니 ─────────────────────────────────────────────────────────────

function SmartMoneyContent({ market }: { market: Market }) {
  const [pData, setPData] = useState<PykrxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nocache = false) => {
    setLoading(true); setError(""); setPData(null);
    try {
      const res = await fetch(`/api/pykrx?smart=1&market=${market}&top_n=20${nocache ? "&nocache=1" : ""}`);
      const json: PykrxData = await res.json();
      if (!json.ok) throw new Error(json.error ?? "pykrx 오류");
      setPData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [market]);

  useEffect(() => { load(); }, [load]);

  const items = pData?.data ?? [];

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
          <Star size={9} /> 스마트머니
        </span>
        <span className="text-xs text-slate-500 font-semibold">
          {market} 전체 종목 중 외국인·기관 동시 순매수 교집합
        </span>
        {pData?.date && <span className="text-xs text-slate-400 ml-auto">기준일: {fmtDate(pData.date)}</span>}
        <button type="button" onClick={() => load(true)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <RefreshCw size={11} />
        </button>
      </div>
      {loading ? <Spinner label={`${market} 전체 스마트머니 분석 중…`} /> :
       error   ? <ErrBox msg={error} onRetry={() => load(true)} /> :
       items.length === 0 ? <p className="py-8 text-center text-sm font-semibold text-slate-400">외국인·기관 동시 순매수 종목 없음</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="py-2 pl-3 pr-2 text-left text-xs font-bold text-slate-500 w-7">#</th>
              <th className="py-2 px-2 text-left text-xs font-bold text-slate-500">종목</th>
              <th className="py-2 px-2 text-right text-xs font-bold text-slate-500">외국인(억)</th>
              <th className="py-2 px-2 text-right text-xs font-bold text-slate-500">기관합계(억)</th>
              <th className="py-2 pl-2 pr-3 text-right text-xs font-bold text-slate-500">합산(억)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s, i) => {
              const frgnAmt = s.frgn_amt ?? 0, orgnAmt = s.orgn_amt ?? 0;
              return (
                <tr key={s.ticker} className="border-b border-slate-100 hover:bg-amber-50 transition">
                  <td className="py-2 pl-3 pr-2 text-xs font-bold text-amber-400">{i + 1}</td>
                  <td className="py-2 px-2">
                    <p className="text-sm font-bold text-slate-800">{s.name}</p>
                    <p className="text-[10px] text-slate-400">{s.ticker}</p>
                  </td>
                  <td className="py-2 px-2 text-right text-xs font-bold text-red-500">{fmtAmtWon(frgnAmt)}</td>
                  <td className="py-2 px-2 text-right text-xs font-bold text-red-500">{fmtAmtWon(orgnAmt)}</td>
                  <td className="py-2 pl-2 pr-3 text-right text-xs font-extrabold text-red-600">{fmtAmtWon(frgnAmt + orgnAmt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Sub-tab 정의 ────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; sharedHeader: boolean }[] = [
  { id: "holdings", label: "보유 종목 분석",    sharedHeader: false },
  { id: "market",   label: "시장 동향",          sharedHeader: true },
  { id: "top",      label: "시총 상위종목 분석",  sharedHeader: true },
  { id: "investor", label: "수급 주체별 분석",    sharedHeader: true },
  { id: "smart",    label: "스마트머니",           sharedHeader: false },
];

// ── Main Component ─────────────────────────────────────────────────────────

export default function SupplyDemandAnalysisTab() {
  const portfolioData = usePortfolioResult();

  // 국내주식 중 ticker 있는 종목만 (SK하이닉스 최우선)
  const domesticAssets = useMemo<PortfolioAsset[]>(() => {
    const assets = (portfolioData?.enrichedAssets ?? []).filter(
      (a) => a.asset_class === "국내주식" && a.ticker && cleanTicker(a.ticker) !== ""
    );
    return [...assets].sort((a, b) => {
      const aH = /^000660/.test(a.ticker!), bH = /^000660/.test(b.ticker!);
      if (aH && !bH) return -1;
      if (!aH && bH) return 1;
      return 0;
    });
  }, [portfolioData]);

  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedName, setSelectedName]     = useState("");

  const [koreanNames, setKoreanNames] = useState<Record<string, string>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const a of domesticAssets) {
      if (!a.ticker || fetchedRef.current.has(a.ticker)) continue;
      fetchedRef.current.add(a.ticker);
      fetch(`/api/korean-name?ticker=${encodeURIComponent(a.ticker)}`)
        .then(r => r.json())
        .then((d: { name?: string }) => {
          if (d.name && a.ticker)
            setKoreanNames(prev => ({ ...prev, [cleanTicker(a.ticker!)]: d.name! }));
        })
        .catch(() => {});
    }
  }, [domesticAssets]);

  useEffect(() => {
    if (domesticAssets.length > 0 && !selectedTicker) {
      setSelectedTicker(cleanTicker(domesticAssets[0].ticker!));
      setSelectedName(domesticAssets[0].name);
    }
  }, [domesticAssets, selectedTicker]);

  // 보유 종목 수급 데이터 (부모에서 fetch → 헤더 기준일 표시)
  const { data: holdingsData, loading: holdingsLoading, error: holdingsError, reload: holdingsReload } = useInvestorHistory(selectedTicker);
  const holdingsLatestDate = holdingsData[0]?.stck_bsop_date ?? "";

  // 수급 분석 내부 탭 상태
  const [activeTab, setActiveTab]       = useState<TabId>("holdings");
  const [market, setMarket]             = useState<Market>("KOSPI");
  const [investorType, setInvestorType] = useState<InvestorKey>("frgn");
  const [displayMode, setDisplayMode]   = useState<DisplayMode>("amount");
  const [orgSubType, setOrgSubType]     = useState<OrgSubType>("기관합계");

  const [summaries, setSummaries]   = useState<(StockSummary | null)[]>([]);
  const [sumLoading, setSumLoading] = useState(false);
  const [sumError, setSumError]     = useState("");
  const [latestDate, setLatestDate] = useState("");

  const loadSummaries = useCallback(async (mkt: Market, nocache = false) => {
    setSumLoading(true); setSumError(""); setSummaries([]);
    const universe = mkt === "KOSPI" ? KOSPI_UNIVERSE : KOSDAQ_UNIVERSE;
    const suffix   = mkt === "KOSPI" ? ".KS" : ".KQ";
    try {
      const ranked  = await fetchMarketCapRanking(universe, suffix, nocache);
      const results = await batchFetchSummaries(ranked, nocache);
      setSummaries(results);
      const first = results.find((r): r is StockSummary => r !== null);
      if (first) setLatestDate(first.date);
    } catch (e) { setSumError(e instanceof Error ? e.message : String(e)); }
    finally { setSumLoading(false); }
  }, []);

  useEffect(() => { loadSummaries(market); }, [market, loadSummaries]);

  const handleRefresh = useCallback(() => { loadSummaries(market, true); }, [market, loadSummaries]);
  const showHeader = TABS.find((t) => t.id === activeTab)?.sharedHeader ?? false;

  return (
    <div className="space-y-4">
      {/* 최상단: 분석 종목 선택 박스 (국내주식만) */}
      {domesticAssets.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            분석 종목 선택
          </div>
          <div className="flex flex-wrap gap-2">
            {domesticAssets.map((a) => {
              const kt = cleanTicker(a.ticker!);
              const isActive = selectedTicker === kt;
              return (
                <button key={kt} type="button"
                  onClick={() => { setSelectedTicker(kt); setSelectedName(a.name); }}
                  className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition ${
                    isActive
                      ? "border-[#2f2f9d] bg-[#2f2f9d] text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                  }`}>
                  {koreanNames[kt] || a.name}
                  <span className={`ml-1.5 text-[10px] font-normal ${isActive ? "text-blue-200" : "text-slate-400"}`}>
                    {a.ticker}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 비보유 종목 검색 (국내주식만) */}
      <StockSearchBox
        market="domestic"
        onSelect={(item) => {
          setSelectedTicker(item.code);
          setSelectedName(item.name);
        }}
      />

      {/* 메인 패널: 하위 탭 포함 */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* 헤더 */}
        <div className="px-4 pt-4">
          <p className="text-[15px] font-bold text-slate-800">
            {koreanNames[selectedTicker] || selectedName || "종목 선택"}
          </p>
          <p className="text-[12px] text-slate-400">
            {selectedTicker ? `${selectedTicker} · ` : ""}기준일 {holdingsLatestDate ? fmtDate(holdingsLatestDate) : "–"}
          </p>
        </div>

        {/* 하위 탭 바 */}
        <div className="mx-4 mt-4 mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
              className={`shrink-0 flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold transition whitespace-nowrap ${
                activeTab === t.id
                  ? "bg-white text-[#2f2f9d] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 시장/정렬 공통 헤더 (해당 탭만) */}
        {showHeader && <div className="border-t border-slate-200" />}
        {showHeader && (
          <SharedHeader
            market={market} setMarket={setMarket}
            investorType={investorType} setInvestorType={setInvestorType}
            displayMode={displayMode} setDisplayMode={setDisplayMode}
            latestDate={latestDate}
            orgSubType={orgSubType} setOrgSubType={setOrgSubType}
            activeTab={activeTab}
          />
        )}

        {/* 탭 콘텐츠 */}
        {activeTab === "holdings" && selectedTicker && (
          <HoldingsContent
            data={holdingsData}
            loading={holdingsLoading}
            error={holdingsError}
            reload={holdingsReload}
            displayMode={displayMode}
            setDisplayMode={setDisplayMode}
          />
        )}
        {activeTab === "market" && (
          <MarketTrendContent market={market} investorType={investorType} displayMode={displayMode} />
        )}
        {activeTab === "top" && (
          <TopStocksContent
            market={market} investorType={investorType} displayMode={displayMode}
            orgSubType={orgSubType} summaries={summaries} loading={sumLoading}
            error={sumError} onRefresh={handleRefresh}
          />
        )}
        {activeTab === "investor" && (
          <InvestorAnalysisContent
            market={market} displayMode={displayMode}
            investorType={investorType} orgSubType={orgSubType}
          />
        )}
        {activeTab === "smart" && <SmartMoneyContent market={market} />}
      </div>
    </div>
  );
}
