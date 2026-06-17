"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { RefreshCw, AlertCircle, Globe, Building2, Users, Loader2, Search, Star, TrendingUp, TrendingDown } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";

// ── Constants ─────────────────────────────────────────────────────────────

// KOSPI 주요 종목 (티커, 이름, 시장코드)
const MAJOR_STOCKS = [
  { ticker: "005930", name: "삼성전자",          market: "J" },
  { ticker: "000660", name: "SK하이닉스",         market: "J" },
  { ticker: "005490", name: "POSCO홀딩스",        market: "J" },
  { ticker: "005380", name: "현대차",             market: "J" },
  { ticker: "035420", name: "NAVER",              market: "J" },
  { ticker: "105560", name: "KB금융",             market: "J" },
  { ticker: "051910", name: "LG화학",             market: "J" },
  { ticker: "068270", name: "셀트리온",           market: "J" },
];

// 시장 프록시 ETF
const MARKET_PROXIES = {
  KOSPI:  { ticker: "069500", name: "KODEX 200",         market: "J" },
  KOSDAQ: { ticker: "229200", name: "KODEX KOSDAQ150",   market: "J" },
};

// ── Types ──────────────────────────────────────────────────────────────────

type InvestorDayItem = {
  stck_bsop_date: string;
  stck_clpr: string;
  prsn_ntby_tr_pbmn: string;
  frgn_ntby_tr_pbmn: string;
  orgn_ntby_tr_pbmn: string;
  prsn_ntby_qty: string;
  frgn_ntby_qty: string;
  orgn_ntby_qty: string;
};

type InvestorApiResponse = {
  rt_cd?: string;
  msg1?: string;
  output?: InvestorDayItem[];
  _cached?: boolean;
};

type StockSummary = {
  ticker: string;
  name: string;
  date: string;
  frgn: number;
  orgn: number;
  prsn: number;
  price: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  if (!d || d.length < 8) return d;
  return `${d.slice(4, 6)}/${d.slice(6, 8)}`;
}

function toNum(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

function fmtAmt(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "+";
  if (abs >= 10000) return `${sign}${Math.round(abs / 10000)}만`;
  if (abs === 0) return "0";
  return `${sign}${abs.toLocaleString()}`;
}

function fmtBillion(val: number): number {
  return val; // 이미 백만원 단위로 옴
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
        <button type="button" onClick={onRetry}
          className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700">
          <RefreshCw size={12} /> 다시 시도
        </button>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg min-w-[140px]">
      <p className="mb-2 text-xs font-bold text-slate-500">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-xs font-semibold" style={{ color: p.color }}>
          {p.dataKey}: {p.value > 0 ? "+" : ""}{p.value.toLocaleString()}백만
        </p>
      ))}
    </div>
  );
}

// 투자자별 순매수 Bar (개인/외국인/기관 3색 수평 바)
function InvestorBar({ frgn, orgn, prsn, maxAbs }: { frgn: number; orgn: number; prsn: number; maxAbs: number }) {
  const scale = maxAbs > 0 ? 100 / maxAbs : 1;
  return (
    <div className="flex flex-col gap-0.5">
      {([
        { label: "외국인", val: frgn, pos: "#3b82f6", neg: "#93c5fd" },
        { label: "기관",   val: orgn, pos: "#f59e0b", neg: "#fde68a" },
        { label: "개인",   val: prsn, pos: "#22c55e", neg: "#86efac" },
      ] as const).map(({ label, val, pos, neg }) => {
        const pct = Math.min(Math.abs(val) * scale, 100);
        return (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-8 text-right text-[10px] font-semibold text-slate-400">{label}</span>
            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: val >= 0 ? pos : neg }} />
            </div>
            <span className={`w-16 text-right text-[10px] font-bold ${val >= 0 ? "text-red-500" : "text-blue-500"}`}>
              {fmtAmt(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Custom hook: fetch investor data ──────────────────────────────────────

function useInvestorData(ticker: string, market = "J", enabled = true) {
  const [data, setData] = useState<InvestorDayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetch_ = useCallback(async (nocache = false) => {
    if (!ticker || !enabled) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/supply-demand?type=investor&ticker=${ticker}&market=${market}${nocache ? "&nocache=1" : ""}`
      );
      const json: InvestorApiResponse = await res.json();
      if (json.rt_cd === "E") throw new Error(json.msg1 ?? "알 수 없는 오류");
      if (json.rt_cd && json.rt_cd !== "0") throw new Error(`KIS 오류 (${json.rt_cd}): ${json.msg1 ?? ""}`);
      setData((json.output ?? []).filter((d) => d.frgn_ntby_tr_pbmn !== ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ticker, market, enabled]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refetch: (nocache?: boolean) => fetch_(nocache) };
}

// ── Market Trend Section ────────────────────────────────────────────────────

function MarketTrendSection({ market }: { market: "KOSPI" | "KOSDAQ" }) {
  const proxy = MARKET_PROXIES[market];
  const { data, loading, error, refetch } = useInvestorData(proxy.ticker, proxy.market);

  const chartData = data.slice(0, 20).reverse().map((d) => ({
    date: fmtDate(d.stck_bsop_date),
    외국인: fmtBillion(toNum(d.frgn_ntby_tr_pbmn)),
    기관:   fmtBillion(toNum(d.orgn_ntby_tr_pbmn)),
    개인:   fmtBillion(toNum(d.prsn_ntby_tr_pbmn)),
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-700">
          {market} 투자자별 순매수 동향
        </h2>
        <span className="text-xs font-semibold text-slate-400">({proxy.name} 기준, 백만원)</span>
        <button type="button" onClick={() => refetch(true)}
          className="ml-auto flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600">
          <RefreshCw size={11} />
        </button>
      </div>

      {loading ? (
        <LoadingSpinner label="시장 수급 데이터 불러오는 중…" />
      ) : error ? (
        <ErrorBox msg={error} onRetry={() => refetch(true)} />
      ) : chartData.length === 0 ? (
        <p className="py-8 text-center text-sm font-semibold text-slate-400">데이터 없음</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 10000 || v <= -10000 ? `${Math.round(v/10000)}만` : `${v}`} width={48} />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            <Bar dataKey="외국인" fill="#3b82f6" radius={[2, 2, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.외국인 >= 0 ? "#3b82f6" : "#93c5fd"} />)}
            </Bar>
            <Bar dataKey="기관" fill="#f59e0b" radius={[2, 2, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.기관 >= 0 ? "#f59e0b" : "#fde68a"} />)}
            </Bar>
            <Bar dataKey="개인" fill="#22c55e" radius={[2, 2, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.개인 >= 0 ? "#22c55e" : "#86efac"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Major Stocks Section ───────────────────────────────────────────────────

function MajorStocksSection({ market }: { market: "KOSPI" | "KOSDAQ" }) {
  const [summaries, setSummaries] = useState<StockSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<"frgn" | "orgn" | "prsn">("frgn");
  const fetchedRef = useRef(false);

  const loadAll = useCallback(async (nocache = false) => {
    setLoading(true);
    setError("");
    fetchedRef.current = true;
    try {
      const results = await Promise.all(
        MAJOR_STOCKS.map(async (s) => {
          const res = await fetch(
            `/api/supply-demand?type=investor&ticker=${s.ticker}&market=${s.market}${nocache ? "&nocache=1" : ""}`
          );
          const json: InvestorApiResponse = await res.json();
          const rows = (json.output ?? []).filter((d) => d.frgn_ntby_tr_pbmn !== "");
          const latest = rows[0];
          return {
            ticker: s.ticker,
            name: s.name,
            date: latest?.stck_bsop_date ?? "-",
            frgn: toNum(latest?.frgn_ntby_tr_pbmn),
            orgn: toNum(latest?.orgn_ntby_tr_pbmn),
            prsn: toNum(latest?.prsn_ntby_tr_pbmn),
            price: latest?.stck_clpr ?? "-",
          };
        })
      );
      setSummaries(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) loadAll();
  }, [loadAll]);

  const sorted = [...summaries].sort((a, b) => b[sortBy] - a[sortBy]);
  const maxAbs = Math.max(...summaries.flatMap((s) => [Math.abs(s.frgn), Math.abs(s.orgn), Math.abs(s.prsn)]));

  const SortBtn = ({ key_, label }: { key_: "frgn" | "orgn" | "prsn"; label: string }) => (
    <button type="button" onClick={() => setSortBy(key_)}
      className={`px-2 py-1 text-xs font-bold rounded transition ${sortBy === key_ ? "bg-[#2f2f9d] text-white" : "text-slate-500 hover:bg-slate-100"}`}>
      {label}순
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="text-sm font-bold text-slate-700">주요 KOSPI 종목 투자자 현황</h2>
        <span className="text-xs text-slate-400">최근 영업일 기준</span>
        <div className="ml-auto flex items-center gap-1">
          <SortBtn key_="frgn" label="외국인" />
          <SortBtn key_="orgn" label="기관" />
          <SortBtn key_="prsn" label="개인" />
          <button type="button" onClick={() => loadAll(true)}
            className="ml-2 flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner label="주요 종목 수급 분석 중…" />
      ) : error ? (
        <ErrorBox msg={error} onRetry={() => loadAll(true)} />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((s, i) => (
            <div key={s.ticker} className="flex items-center gap-3">
              <span className="w-4 text-xs font-bold text-slate-300">{i + 1}</span>
              <div className="w-24 flex-shrink-0">
                <p className="text-xs font-bold text-slate-700 truncate">{s.name}</p>
                <p className="text-[10px] font-semibold text-slate-400">{s.ticker}</p>
              </div>
              <div className="flex-1">
                <InvestorBar frgn={s.frgn} orgn={s.orgn} prsn={s.prsn} maxAbs={maxAbs} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Portfolio Stocks Section ───────────────────────────────────────────────

function PortfolioSection() {
  const { portfolioAssets } = useCustomerContext();
  const [summaries, setSummaries] = useState<StockSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 국내주식만 필터
  const domesticStocks = portfolioAssets.filter(
    (a) => (a.productType === "국내주식" || a.asset_class === "국내주식") && a.name
  );

  const loadPortfolio = useCallback(async () => {
    if (!domesticStocks.length) return;
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        domesticStocks.map(async (a) => {
          const ticker = a.name?.match(/\d{6}/)?.[0] ?? "";
          if (!ticker) return null;
          const res = await fetch(`/api/supply-demand?type=investor&ticker=${ticker}&market=J`);
          const json: InvestorApiResponse = await res.json();
          const rows = (json.output ?? []).filter((d) => d.frgn_ntby_tr_pbmn !== "");
          const latest = rows[0];
          if (!latest) return null;
          return {
            ticker,
            name: a.name ?? ticker,
            date: latest.stck_bsop_date,
            frgn: toNum(latest.frgn_ntby_tr_pbmn),
            orgn: toNum(latest.orgn_ntby_tr_pbmn),
            prsn: toNum(latest.prsn_ntby_tr_pbmn),
            price: latest.stck_clpr,
          } as StockSummary;
        })
      );
      setSummaries(results.filter((r): r is StockSummary => r !== null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [domesticStocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!domesticStocks.length) {
    return (
      <p className="py-6 text-center text-sm font-semibold text-slate-400">
        고객 포트폴리오에 국내주식이 없습니다.
      </p>
    );
  }

  const maxAbs = Math.max(...summaries.flatMap((s) => [Math.abs(s.frgn), Math.abs(s.orgn), Math.abs(s.prsn)]), 1);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-700">포트폴리오 종목 수급 현황</h2>
        <span className="text-xs text-slate-400">— 티커(6자리 숫자) 포함된 종목만 조회</span>
        {!summaries.length && !loading && (
          <button type="button" onClick={loadPortfolio}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[#2f2f9d] text-white rounded-md hover:bg-blue-700">
            <TrendingUp size={12} /> 수급 조회
          </button>
        )}
        {summaries.length > 0 && (
          <button type="button" onClick={loadPortfolio}
            className="ml-auto flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600">
            <RefreshCw size={11} />
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner label="포트폴리오 종목 수급 분석 중…" />
      ) : error ? (
        <ErrorBox msg={error} onRetry={loadPortfolio} />
      ) : summaries.length === 0 ? (
        <p className="py-4 text-center text-xs font-semibold text-slate-400">
          조회 버튼을 눌러 수급 데이터를 불러오세요.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {summaries.sort((a, b) => b.frgn - a.frgn).map((s, i) => (
            <div key={s.ticker} className="flex items-center gap-3">
              <span className="w-4 text-xs font-bold text-slate-300">{i + 1}</span>
              <div className="w-28 flex-shrink-0">
                <p className="text-xs font-bold text-slate-700 truncate">{s.name}</p>
                <p className="text-[10px] font-semibold text-slate-400">{s.ticker}</p>
              </div>
              <div className="flex-1">
                <InvestorBar frgn={s.frgn} orgn={s.orgn} prsn={s.prsn} maxAbs={maxAbs} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stock Search Section ───────────────────────────────────────────────────

function StockSearchSection() {
  const [query, setQuery] = useState("005930");
  const [submitted, setSubmitted] = useState("005930");
  const { data, loading, error, refetch } = useInvestorData(submitted);

  const chartData = data.slice(0, 20).reverse().map((d) => ({
    date: fmtDate(d.stck_bsop_date),
    외국인: fmtBillion(toNum(d.frgn_ntby_tr_pbmn)),
    기관:   fmtBillion(toNum(d.orgn_ntby_tr_pbmn)),
    개인:   fmtBillion(toNum(d.prsn_ntby_tr_pbmn)),
  }));

  const latest = data[0];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-bold text-slate-700">종목별 투자자 동향 조회</h2>
      </div>

      {/* 검색 입력 */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSubmitted(query.trim()); }}
            placeholder="종목코드 (예: 005930)"
            className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#2f2f9d] focus:ring-1 focus:ring-[#2f2f9d]"
          />
        </div>
        <button type="button" onClick={() => setSubmitted(query.trim())}
          className="px-4 py-2 text-xs font-bold bg-[#2f2f9d] text-white rounded-md hover:bg-blue-700">
          조회
        </button>
      </div>

      {/* 최근 1일 요약 */}
      {latest && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {([
            { label: "외국인", val: toNum(latest.frgn_ntby_tr_pbmn), icon: <Globe size={14} />, color: "text-blue-600" },
            { label: "기관",   val: toNum(latest.orgn_ntby_tr_pbmn), icon: <Building2 size={14} />, color: "text-amber-600" },
            { label: "개인",   val: toNum(latest.prsn_ntby_tr_pbmn), icon: <Users size={14} />, color: "text-green-600" },
          ]).map(({ label, val, icon, color }) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className={`flex items-center gap-1.5 mb-1 ${color}`}>
                {icon}
                <span className="text-xs font-bold">{label}</span>
              </div>
              <p className={`text-base font-extrabold ${val >= 0 ? "text-red-500" : "text-blue-500"}`}>
                {fmtAmt(val)}
                <span className="text-xs font-semibold text-slate-400 ml-0.5">백만</span>
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">{fmtDate(latest.stck_bsop_date)} 기준</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorBox msg={error} onRetry={() => refetch(true)} />
      ) : chartData.length === 0 ? (
        <p className="py-4 text-center text-xs font-semibold text-slate-400">데이터 없음</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}`} width={48} />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            <Bar dataKey="외국인" fill="#3b82f6" radius={[2, 2, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.외국인 >= 0 ? "#3b82f6" : "#93c5fd"} />)}
            </Bar>
            <Bar dataKey="기관" fill="#f59e0b" radius={[2, 2, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.기관 >= 0 ? "#f59e0b" : "#fde68a"} />)}
            </Bar>
            <Bar dataKey="개인" fill="#22c55e" radius={[2, 2, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.개인 >= 0 ? "#22c55e" : "#86efac"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Smart Money Section ────────────────────────────────────────────────────

function SmartMoneySection() {
  const [summaries, setSummaries] = useState<StockSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        MAJOR_STOCKS.map(async (s) => {
          const res = await fetch(`/api/supply-demand?type=investor&ticker=${s.ticker}&market=${s.market}`);
          const json: InvestorApiResponse = await res.json();
          const rows = (json.output ?? []).filter((d) => d.frgn_ntby_tr_pbmn !== "");
          const latest = rows[0];
          if (!latest) return null;
          return {
            ticker: s.ticker, name: s.name,
            date: latest.stck_bsop_date,
            frgn: toNum(latest.frgn_ntby_tr_pbmn),
            orgn: toNum(latest.orgn_ntby_tr_pbmn),
            prsn: toNum(latest.prsn_ntby_tr_pbmn),
            price: latest.stck_clpr,
          } as StockSummary;
        })
      );
      if (cancelled) return;
      const smart = results.filter((r): r is StockSummary => r !== null && r.frgn > 0 && r.orgn > 0);
      setSummaries(smart.sort((a, b) => (b.frgn + b.orgn) - (a.frgn + a.orgn)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
          <Star size={10} /> 스마트머니
        </span>
        <h2 className="text-sm font-bold text-slate-700">외국인 + 기관 동시 순매수 종목</h2>
        <span className="text-xs text-slate-400">— 주요 KOSPI 8종목 기준</span>
      </div>

      {loading ? (
        <LoadingSpinner label="스마트머니 분석 중…" />
      ) : summaries.length === 0 ? (
        <p className="py-6 text-center text-sm font-semibold text-slate-400">
          외국인·기관 동시 순매수 종목이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="py-2 pl-3 pr-2 text-left text-xs font-bold text-slate-500 w-8">순위</th>
                <th className="py-2 px-2 text-left text-xs font-bold text-slate-500">종목</th>
                <th className="py-2 px-2 text-right text-xs font-bold text-blue-600">외국인</th>
                <th className="py-2 px-2 text-right text-xs font-bold text-amber-600">기관</th>
                <th className="py-2 pl-2 pr-3 text-right text-xs font-bold text-slate-500">합산</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s, i) => (
                <tr key={s.ticker} className="border-b border-slate-100 hover:bg-amber-50 transition">
                  <td className="py-2 pl-3 pr-2 text-xs font-bold text-amber-400">{i + 1}</td>
                  <td className="py-2 px-2">
                    <p className="text-sm font-bold text-slate-800">{s.name}</p>
                    <p className="text-[10px] font-semibold text-slate-400">{s.ticker}</p>
                  </td>
                  <td className="py-2 px-2 text-right text-xs font-bold text-blue-500">+{fmtAmt(s.frgn)}</td>
                  <td className="py-2 px-2 text-right text-xs font-bold text-amber-500">+{fmtAmt(s.orgn)}</td>
                  <td className="py-2 pl-2 pr-3 text-right text-xs font-extrabold text-red-500">
                    +{fmtAmt(s.frgn + s.orgn)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function SupplyDemandPage() {
  const [market, setMarket] = useState<"KOSPI" | "KOSDAQ">("KOSPI");
  const [activeTab, setActiveTab] = useState<"market" | "major" | "search" | "smart">("market");

  const tabs = [
    { id: "market" as const, label: "시장 동향" },
    { id: "major"  as const, label: "주요 종목" },
    { id: "search" as const, label: "종목 조회" },
    { id: "smart"  as const, label: "스마트머니" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ── 컨트롤 헤더 ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-soft overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">시장</span>
            <div className="flex rounded-md overflow-hidden border border-slate-200">
              {(["KOSPI", "KOSDAQ"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMarket(m)}
                  className={`px-3 py-1.5 text-xs font-bold transition ${market === m ? "bg-[#2f2f9d] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs text-slate-400">KIS OpenAPI 기반 · 30분 캐시 · 영업일 T+1 확정</span>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-slate-200">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2.5 text-xs font-bold transition border-b-2 ${activeTab === t.id ? "border-[#2f2f9d] text-[#2f2f9d] bg-blue-50" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === "market"  && <MarketTrendSection market={market} />}
          {activeTab === "major"   && <MajorStocksSection market={market} />}
          {activeTab === "search"  && <StockSearchSection />}
          {activeTab === "smart"   && <SmartMoneySection />}
        </div>
      </div>

      {/* ── 포트폴리오 수급 연동 (항상 표시) ──────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-soft overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <TrendingUp size={14} className="text-[#2f2f9d]" />
          <h2 className="text-sm font-bold text-slate-700">고객 포트폴리오 수급 연동</h2>
          <span className="text-xs text-slate-400">— 보유 국내주식 투자자 동향</span>
        </div>
        <div className="p-4">
          <PortfolioSection />
        </div>
      </div>
    </div>
  );
}
