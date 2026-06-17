"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { RefreshCw, AlertCircle, TrendingUp, TrendingDown, Globe, Building2, Users, Loader2 } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Market = "KOSPI" | "KOSDAQ";
type InvestorType = "foreign" | "institution" | "individual";
type Direction = "buy" | "sell";

interface MarketTrendItem {
  stck_bsop_date?: string;   // 날짜 YYYYMMDD
  bsop_date?: string;
  frgn_ntby_qty?: string;    // 외국인 순매수량
  orgn_ntby_qty?: string;    // 기관 순매수량
  ivtr_ntby_qty?: string;    // 개인 순매수량
  frgn_ntby_tr_pbmn?: string; // 외국인 순매수 거래대금
  orgn_ntby_tr_pbmn?: string;
  ivtr_ntby_tr_pbmn?: string;
  [key: string]: string | undefined;
}

interface RankingItem {
  data_rank?: string;
  mksc_shrn_iscd?: string;   // 종목코드
  hts_kor_isnm?: string;     // 종목명
  ntby_qty?: string;         // 순매수수량
  ntby_tr_pbmn?: string;     // 순매수 거래대금
  stck_prpr?: string;        // 현재가
  prdy_vrss?: string;        // 전일대비
  prdy_ctrt?: string;        // 등락률
  prdy_vrss_sign?: string;   // 부호
  [key: string]: string | undefined;
}

interface ApiResponse {
  rt_cd?: string;
  msg1?: string;
  output?: MarketTrendItem[] | RankingItem[];
  output1?: MarketTrendItem[] | RankingItem[];
  output2?: unknown[];
  _cached?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const INVESTOR_LABELS: Record<InvestorType, string> = {
  foreign: "외국인",
  institution: "기관",
  individual: "개인",
};

const INVESTOR_ICONS: Record<InvestorType, React.ReactNode> = {
  foreign: <Globe size={14} />,
  institution: <Building2 size={14} />,
  individual: <Users size={14} />,
};

const COLORS = {
  foreign: "#3b82f6",
  institution: "#f59e0b",
  individual: "#22c55e",
  negative: "#ef4444",
};

function fmtDate(d: string) {
  if (d.length === 8) return `${d.slice(4, 6)}/${d.slice(6, 8)}`;
  return d;
}

function fmtAmt(val: string | undefined): string {
  if (!val) return "-";
  const n = parseInt(val, 10);
  if (isNaN(n)) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}억`;
  if (abs >= 10000) return `${sign}${Math.round(abs / 10000)}만`;
  return `${sign}${n.toLocaleString()}`;
}

function fmtAmtBillion(val: string | undefined): number {
  if (!val) return 0;
  const n = parseInt(val, 10);
  if (isNaN(n)) return 0;
  return Math.round(n / 100000000);  // 억 단위
}

function fmtPrice(val: string | undefined): string {
  if (!val) return "-";
  const n = parseInt(val, 10);
  if (isNaN(n)) return val;
  return n.toLocaleString("ko-KR");
}

// ── Sub-components ─────────────────────────────────────────────────────────

function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <Loader2 size={28} className="animate-spin text-[#2f2f9d]" />
      <p className="text-sm font-semibold text-slate-500">{label ?? "데이터 불러오는 중…"}</p>
    </div>
  );
}

function ErrorBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6">
      <div className="flex items-center gap-2 text-red-600">
        <AlertCircle size={18} />
        <span className="text-sm font-bold">데이터 로드 실패</span>
      </div>
      <p className="text-center text-xs font-semibold text-red-500 max-w-md break-all">{msg}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
        >
          <RefreshCw size={12} /> 다시 시도
        </button>
      )}
    </div>
  );
}

// Custom tooltip for the market trend chart
function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="mb-2 text-xs font-bold text-slate-600">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-xs font-semibold" style={{ color: p.color }}>
          {p.dataKey}: {p.value > 0 ? "+" : ""}{p.value.toLocaleString()}억
        </p>
      ))}
    </div>
  );
}

// ── Ranking Table ──────────────────────────────────────────────────────────

function RankingTable({
  items,
  direction,
}: {
  items: RankingItem[];
  direction: Direction;
}) {
  if (!items.length) {
    return <p className="py-8 text-center text-sm font-semibold text-slate-400">데이터 없음</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="py-2 pl-3 pr-2 text-left text-xs font-bold text-slate-500 w-8">순위</th>
            <th className="py-2 px-2 text-left text-xs font-bold text-slate-500">종목명</th>
            <th className="py-2 px-2 text-center text-xs font-bold text-slate-500">코드</th>
            <th className="py-2 px-2 text-right text-xs font-bold text-slate-500">
              {direction === "buy" ? "순매수금액" : "순매도금액"}
            </th>
            <th className="py-2 px-2 text-right text-xs font-bold text-slate-500">현재가</th>
            <th className="py-2 pl-2 pr-3 text-right text-xs font-bold text-slate-500">등락률</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 10).map((item, i) => {
            const sign = item.prdy_vrss_sign;
            const isUp = sign === "1" || sign === "2";
            const isDown = sign === "4" || sign === "5";
            const priceColor = isUp ? "text-red-500" : isDown ? "text-blue-500" : "text-slate-600";
            const pct = item.prdy_ctrt ? `${parseFloat(item.prdy_ctrt) > 0 ? "+" : ""}${parseFloat(item.prdy_ctrt).toFixed(2)}%` : "-";
            const amt = item.ntby_tr_pbmn ?? item.ntby_qty;
            return (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition">
                <td className="py-2 pl-3 pr-2 text-xs font-bold text-slate-400">{item.data_rank ?? i + 1}</td>
                <td className="py-2 px-2 text-sm font-bold text-slate-800">{item.hts_kor_isnm ?? "-"}</td>
                <td className="py-2 px-2 text-center text-xs font-semibold text-slate-400">{item.mksc_shrn_iscd ?? "-"}</td>
                <td className={`py-2 px-2 text-right text-xs font-bold ${direction === "buy" ? "text-red-500" : "text-blue-500"}`}>
                  {fmtAmt(amt)}
                </td>
                <td className="py-2 px-2 text-right text-xs font-semibold text-slate-700">{fmtPrice(item.stck_prpr)}</td>
                <td className={`py-2 pl-2 pr-3 text-right text-xs font-bold ${priceColor}`}>{pct}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function SupplyDemandPage() {
  const [market, setMarket] = useState<Market>("KOSPI");
  const [rankingInvestor, setRankingInvestor] = useState<InvestorType>("foreign");
  const [activeSection, setActiveSection] = useState<"buy" | "sell">("buy");

  // Market trend
  const [trendData, setTrendData] = useState<MarketTrendItem[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState("");
  const [trendCached, setTrendCached] = useState(false);

  // Ranking (buy + sell)
  const [buyRanking, setBuyRanking] = useState<RankingItem[]>([]);
  const [sellRanking, setSellRanking] = useState<RankingItem[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState("");

  // Smart money: institution + foreign simultaneous buy
  const [smartMoney, setSmartMoney] = useState<RankingItem[]>([]);
  const [smartLoading, setSmartLoading] = useState(false);

  const fetchTrend = useCallback(async (nocache = false) => {
    setTrendLoading(true);
    setTrendError("");
    try {
      const res = await fetch(
        `/api/supply-demand?type=market&market=${market}${nocache ? "&nocache=1" : ""}`
      );
      const data: ApiResponse = await res.json();
      if (data.rt_cd === "E") throw new Error(data.msg1 ?? "알 수 없는 오류");
      if (data.rt_cd && data.rt_cd !== "0") throw new Error(`KIS 오류 (${data.rt_cd}): ${data.msg1 ?? ""}`);
      const output = (data.output ?? data.output1 ?? []) as MarketTrendItem[];
      setTrendData(output.slice(0, 20).reverse());
      setTrendCached(!!data._cached);
    } catch (e) {
      setTrendError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrendLoading(false);
    }
  }, [market]);

  const fetchRanking = useCallback(async (investorType: InvestorType, nocache = false) => {
    setRankingLoading(true);
    setRankingError("");
    try {
      const [buyRes, sellRes] = await Promise.all([
        fetch(`/api/supply-demand?type=ranking&market=${market}&investor=${investorType}&direction=buy${nocache ? "&nocache=1" : ""}`),
        fetch(`/api/supply-demand?type=ranking&market=${market}&investor=${investorType}&direction=sell${nocache ? "&nocache=1" : ""}`),
      ]);
      const [buyData, sellData]: [ApiResponse, ApiResponse] = await Promise.all([
        buyRes.json(),
        sellRes.json(),
      ]);
      if (buyData.rt_cd === "E") throw new Error(buyData.msg1 ?? "매수 순위 오류");
      if (sellData.rt_cd === "E") throw new Error(sellData.msg1 ?? "매도 순위 오류");
      setBuyRanking((buyData.output ?? buyData.output1 ?? []) as RankingItem[]);
      setSellRanking((sellData.output ?? sellData.output1 ?? []) as RankingItem[]);
    } catch (e) {
      setRankingError(e instanceof Error ? e.message : String(e));
    } finally {
      setRankingLoading(false);
    }
  }, [market]);

  // Smart money: find intersection of foreign buy + institution buy top-20
  const fetchSmartMoney = useCallback(async () => {
    setSmartLoading(true);
    try {
      const [fRes, iRes] = await Promise.all([
        fetch(`/api/supply-demand?type=ranking&market=${market}&investor=foreign&direction=buy`),
        fetch(`/api/supply-demand?type=ranking&market=${market}&investor=institution&direction=buy`),
      ]);
      const [fData, iData]: [ApiResponse, ApiResponse] = await Promise.all([
        fRes.json(),
        iRes.json(),
      ]);
      const foreignTop = (fData.output ?? fData.output1 ?? []) as RankingItem[];
      const instTop = (iData.output ?? iData.output1 ?? []) as RankingItem[];
      const instCodes = new Set(instTop.map((r) => r.mksc_shrn_iscd));
      const intersection = foreignTop.filter(
        (r) => r.mksc_shrn_iscd && instCodes.has(r.mksc_shrn_iscd)
      );
      setSmartMoney(intersection.slice(0, 10));
    } catch {
      // smart money is secondary — fail silently
    } finally {
      setSmartLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchTrend();
    fetchSmartMoney();
  }, [fetchTrend, fetchSmartMoney]);

  useEffect(() => {
    fetchRanking(rankingInvestor);
  }, [fetchRanking, rankingInvestor]);

  // Chart data transformation
  const chartData = trendData.map((d) => ({
    date: fmtDate(d.stck_bsop_date ?? d.bsop_date ?? ""),
    외국인: fmtAmtBillion(d.frgn_ntby_tr_pbmn ?? d.frgn_ntby_qty),
    기관: fmtAmtBillion(d.orgn_ntby_tr_pbmn ?? d.orgn_ntby_qty),
    개인: fmtAmtBillion(d.ivtr_ntby_tr_pbmn ?? d.ivtr_ntby_qty),
  }));

  const handleRefresh = () => {
    fetchTrend(true);
    fetchRanking(rankingInvestor, true);
    fetchSmartMoney();
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── 헤더 ──────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">시장</span>
            <div className="flex rounded-md overflow-hidden border border-slate-200">
              {(["KOSPI", "KOSDAQ"] as Market[]).map((m) => (
                <button
                  key={m} type="button"
                  onClick={() => setMarket(m)}
                  className={`px-3 py-1.5 text-xs font-bold transition ${market === m ? "bg-[#2f2f9d] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button" onClick={handleRefresh}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 transition"
          >
            <RefreshCw size={12} /> 새로고침
          </button>

          {trendCached && (
            <span className="text-xs font-semibold text-slate-400">캐시됨 (30분)</span>
          )}
        </div>

        {/* ── 시장 전체 수급 동향 차트 ──────────────────────────────────── */}
        <div className="p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-700">
            {market} 투자자별 일별 순매수 동향
            <span className="ml-2 text-xs font-semibold text-slate-400">(억원)</span>
          </h2>

          {trendLoading ? (
            <LoadingSpinner label="시장 수급 데이터 불러오는 중…" />
          ) : trendError ? (
            <ErrorBox msg={trendError} onRetry={() => fetchTrend(true)} />
          ) : chartData.length === 0 ? (
            <p className="py-8 text-center text-sm font-semibold text-slate-400">데이터 없음</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}억`} width={52} />
                <Tooltip content={<TrendTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <Bar dataKey="외국인" fill={COLORS.foreign} radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.외국인 >= 0 ? COLORS.foreign : "#93c5fd"} />
                  ))}
                </Bar>
                <Bar dataKey="기관" fill={COLORS.institution} radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.기관 >= 0 ? COLORS.institution : "#fde68a"} />
                  ))}
                </Bar>
                <Bar dataKey="개인" fill={COLORS.individual} radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.개인 >= 0 ? COLORS.individual : "#86efac"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── 투자자별 순매수/순매도 상위 종목 ─────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-soft overflow-hidden">
        {/* 투자자 탭 + 방향 탭 */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <span className="text-xs font-semibold text-slate-500">투자 주체</span>
          <div className="flex rounded-md overflow-hidden border border-slate-200">
            {(["foreign", "institution", "individual"] as InvestorType[]).map((inv) => (
              <button
                key={inv} type="button"
                onClick={() => setRankingInvestor(inv)}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold transition ${rankingInvestor === inv ? "bg-[#2f2f9d] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              >
                {INVESTOR_ICONS[inv]} {INVESTOR_LABELS[inv]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex rounded-md overflow-hidden border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveSection("buy")}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold transition ${activeSection === "buy" ? "bg-red-500 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              <TrendingUp size={12} /> 순매수 TOP 10
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("sell")}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold transition ${activeSection === "sell" ? "bg-blue-500 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              <TrendingDown size={12} /> 순매도 TOP 10
            </button>
          </div>
        </div>

        {/* 순위 테이블 */}
        {rankingLoading ? (
          <LoadingSpinner label="순위 데이터 불러오는 중…" />
        ) : rankingError ? (
          <div className="p-4">
            <ErrorBox msg={rankingError} onRetry={() => fetchRanking(rankingInvestor, true)} />
          </div>
        ) : (
          <div>
            {activeSection === "buy" ? (
              <>
                <div className="px-4 pt-3 pb-1">
                  <h3 className="text-xs font-bold text-slate-500">
                    {INVESTOR_LABELS[rankingInvestor]} 순매수 상위 10종목 — {market}
                  </h3>
                </div>
                <RankingTable items={buyRanking} direction="buy" />
              </>
            ) : (
              <>
                <div className="px-4 pt-3 pb-1">
                  <h3 className="text-xs font-bold text-slate-500">
                    {INVESTOR_LABELS[rankingInvestor]} 순매도 상위 10종목 — {market}
                  </h3>
                </div>
                <RankingTable items={sellRanking} direction="sell" />
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 스마트머니 동조 (외국인 + 기관 동시 순매수) ───────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-soft overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
            ★ 스마트머니
          </span>
          <h2 className="text-sm font-bold text-slate-700">외국인 + 기관 동시 순매수 종목</h2>
          <span className="text-xs font-semibold text-slate-400">— 외국인 순매수 TOP 20 기준</span>
        </div>

        {smartLoading ? (
          <LoadingSpinner label="스마트머니 분석 중…" />
        ) : smartMoney.length === 0 ? (
          <p className="py-8 text-center text-sm font-semibold text-slate-400">
            외국인·기관 동시 순매수 종목이 없거나 데이터를 불러오지 못했습니다.
          </p>
        ) : (
          <>
            <div className="px-4 pt-3 pb-1">
              <p className="text-xs font-semibold text-slate-500">
                외국인 순매수 상위 20종목 중 기관도 동시 순매수한 종목 ({smartMoney.length}개)
              </p>
            </div>
            <RankingTable items={smartMoney} direction="buy" />
          </>
        )}
      </div>
    </div>
  );
}
