/**
 * /api/etf-correlation-html  GET ?strategy=balanced&k=3
 * - slice-specific 점수 계산 (Bug A fix)
 * - CAGR 동적 연환산, Rf=4% Sharpe (Bug B fix)
 * - 몬테카를로 비중 최적화 (역변동성 대체)
 * - 1시간 인메모리 캐시
 */

export const runtime = 'nodejs';

import path from 'path';
import fs from 'fs';

// ── Yahoo Finance 실시간 데이터 페칭 ──────────────────────────────────────────

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchYahooTicker(ticker: string, period1: number, period2: number): Promise<{ dates: string[]; prices: (number | null)[] } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includePrePost=false`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const json = await res.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> } };
    const result = json?.chart?.result?.[0];
    if (!result?.timestamp?.length) return null;
    const dates = result.timestamp.map((t: number) => new Date(t * 1000).toISOString().slice(0, 10));
    const prices = (result.indicators?.quote?.[0]?.close ?? Array(dates.length).fill(null)) as (number | null)[];
    return { dates, prices };
  } catch {
    return null;
  }
}

async function fetchLiveData(tickers: string[]): Promise<ETFBatch | null> {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 400 * 24 * 3600;

  const settled = await Promise.allSettled(tickers.map((t) => fetchYahooTicker(t, period1, now)));

  const tickerDataMap = new Map<string, { dates: string[]; prices: (number | null)[] }>();
  let successCount = 0;
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      tickerDataMap.set(tickers[i], r.value);
      successCount++;
    }
  });

  if (successCount < Math.ceil(tickers.length * 0.5)) return null;

  const allDatesSet = new Set<string>();
  for (const data of tickerDataMap.values()) data.dates.forEach((d) => allDatesSet.add(d));
  const allDates = [...allDatesSet].sort();
  if (allDates.length === 0) return null;

  const dateIdx = new Map(allDates.map((d, i) => [d, i]));
  const prices: Record<string, (number | null)[]> = {};
  for (const t of tickers) {
    const td = tickerDataMap.get(t);
    const arr: (number | null)[] = new Array(allDates.length).fill(null);
    if (td) td.dates.forEach((d, j) => { const idx = dateIdx.get(d); if (idx !== undefined) arr[idx] = td.prices[j]; });
    prices[t] = arr;
  }

  return { tickers, dates: allDates, prices };
}

// ── 타입 ──────────────────────────────────────────────────────────────────────
type Strategy = 'conservative' | 'balanced' | 'aggressive';

interface ETFBatch {
  tickers: string[];
  dates: string[];
  prices: Record<string, (number | null)[]>;
}

interface PeriodResult {
  start: string;
  end: string;
  n_days: number;
  corr_matrix: Record<string, Record<string, number>>;
  optimal: string[];
  opt_avg_corr: number;
  opt_score: number;
  global_avg: number;
  dates: string[];
  prices: Record<string, number[]>;
  capped_weights: Record<string, number>;
  scores: Record<string, number>;
}

// ── 캐시 ─────────────────────────────────────────────────────────────────────
const dataCache = new Map<string, { data: Record<string, unknown>; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;
const RF_RATE = 0.04;

// ── 섹터 맵 ───────────────────────────────────────────────────────────────────
const SECTOR_MAP: Record<string, string> = {
  SOXX: '반도체',     URA:  '원자력·우라늄', AIQ:  'AI·빅데이터',  CIBR: '사이버보안',
  BOTZ: '로보틱스',   ICLN: '청정에너지',   XAR:  '방산·우주항공', ARKG: '바이오테크',
  IPAY: '핀테크',     QTUM: '양자컴퓨팅',   PAVE: '인프라',        LIT:  '2차전지·리튬',
  REMX: '희토류·전략소재', DTCR: '데이터센터',
  VGLT: '채권(장기)', VGIT: '채권(중기)',   VGSH: '채권(단기)',   AGG:  '채권(종합)',
  VTI:  '시장전체',   VOO:  '시장전체',     IBIT: '암호화폐',
  SLV:  '귀금속·원자재', GLD: '귀금속·원자재',
  USO:  '에너지원자재', UNG: '에너지원자재',
  WEAT: '농산물원자재', CORN: '농산물원자재',
  QQQ:  '시장전체',   '069500.KS': '한국시장', '229200.KS': '한국시장',
};

const TICKERS_ORDERED = [
  'SOXX','URA','AIQ','CIBR','BOTZ','ICLN','XAR','ARKG','IPAY','QTUM',
  'PAVE','LIT','REMX','DTCR','VGLT','VGIT','VGSH','AGG',
  'VTI','VOO','IBIT','SLV','GLD','USO','UNG','WEAT','CORN','QQQ',
  '069500.KS','229200.KS',
];

// ── 수학 헬퍼 ─────────────────────────────────────────────────────────────────

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function computeReturns(prices: number[]): number[] {
  return prices.slice(1).map((p, i) => p / prices[i] - 1);
}

function ffill(arr: (number | null)[]): number[] {
  let last = 0;
  return arr.map((v) => {
    if (v != null && !isNaN(v)) last = v;
    return last;
  });
}

// ── 그리디 종목 선정 (섹터 다양성 제약, slice-specific scores 수신) ───────────

function greedyOptimal(
  cm: Record<string, Record<string, number>>,
  tickers: string[],
  k: number,
  strategy: Strategy,
  vols: Record<string, number>,
  scores: Record<string, number>,
  seed?: string,
): string[] {
  const sectors: Record<string, string> = {};
  for (const t of tickers) sectors[t] = SECTOR_MAP[t] ?? 'other';

  // conservative: vol을 중간값(median) 기준으로 정규화, 하한 0.25 상한 2.0 적용.
  // maxVol 기준은 UNG 같은 극단 outlier 하나가 기준이 되면 VOO/VTI까지
  // 채권과 같은 normVol(0.25)로 무너져 vol 항이 무의미해지는 문제 발생.
  const sortedByVol = [...tickers].sort((a, b) => vols[a] - vols[b]);
  const medianVol = vols[sortedByVol[Math.floor(sortedByVol.length / 2)]];
  const normVol = (t: string) => Math.min(Math.max(vols[t] / medianVol, 0.25), 2.0);

  const calcScore = (a: string, b: string): number => {
    const c = cm[a][b];
    if (strategy === 'aggressive' || strategy === 'balanced') {
      const denom = scores[a] + scores[b];
      return c / (denom > 0 ? denom : 0.001);
    }
    return (c + 1.01) * (normVol(a) + normVol(b));
  };

  const selected: string[] = [];
  const usedSectors = new Set<string>();
  let remaining = [...tickers];

  if (seed && tickers.includes(seed)) {
    selected.push(seed);
    remaining = remaining.filter((x) => x !== seed);
    usedSectors.add(sectors[seed]);
  } else {
    let bestPair: [string, string] | null = null;
    let bestScore = 999999;
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const a = remaining[i], b = remaining[j];
        if (sectors[a] === sectors[b]) continue;
        const score = calcScore(a, b);
        if (score < bestScore) { bestScore = score; bestPair = [a, b]; }
      }
    }
    if (bestPair) {
      for (const t of bestPair) {
        selected.push(t);
        remaining = remaining.filter((x) => x !== t);
        usedSectors.add(sectors[t]);
      }
    }
  }

  while (selected.length < k && remaining.length > 0) {
    let cands = remaining.filter((t) => !usedSectors.has(sectors[t]));
    if (!cands.length) cands = [...remaining];
    let best: string | null = null;
    let bestAvg = 999999;
    for (const t of cands) {
      const avg = selected.reduce((s, s2) => s + calcScore(t, s2), 0) / selected.length;
      if (avg < bestAvg) { bestAvg = avg; best = t; }
    }
    if (!best) break;
    selected.push(best);
    remaining = remaining.filter((x) => x !== best);
    usedSectors.add(sectors[best]);
  }

  return selected.slice(0, k);
}

// ── 광의 자산군 분류 (섹터명 키워드 기반 — 티커 미참조) ────────────────────────

function broadClass(sector: string): string {
  if (sector.includes('채권')) return '채권';
  if (
    sector.includes('원자재') ||
    sector.includes('귀금속') ||
    sector.includes('희토류') ||
    sector.includes('농산물')
  ) return '원자재';
  if (sector.includes('암호화폐')) return '암호화폐';
  if (sector.includes('시장전체') || sector.includes('주식시장')) return '시장전체';
  return '성장주식';
}

// ── 몬테카를로 비중 최적화 ─────────────────────────────────────────────────────
// 개선사항:
//   ① 전략별 단일 자산군 최대 비중 상한(MAX_CLASS_W) 위반 시 즉시 탈락
//   ② HHI 집중도 감점 + 25% 초과 종목 추가 감점 → 분산 유도

function monteCarloWeights(
  assets: string[],
  annRets: Record<string, number>,
  annVols: Record<string, number>,
  corrMatrix: Record<string, Record<string, number>>,
  strategy: Strategy,
  sectorMap: Record<string, string> = {},
  iterations = 20000,
): Record<string, number> {
  const k = assets.length;
  const MIN_W = 0.05;

  // 전략별 단일 자산군 최대 비중 상한 (제약 미주입 시 단일 종목에도 동일 적용)
  const MAX_CLASS_W =
    strategy === 'conservative' ? 0.35 :
    strategy === 'balanced'     ? 0.50 : 0.65;

  // 개별 종목 상한 = min(0.45, 자산군 상한) — 자산군 상한이 더 엄격하면 동기화
  const MAX_W = Math.min(0.45, MAX_CLASS_W);

  // 루프 전 사전 계산 — 이터레이션마다 재계산 방지
  const assetClasses = assets.map((t) => broadClass(sectorMap[t] ?? '성장주식'));
  const hasMultipleClasses = new Set(assetClasses).size > 1; // 복수 자산군일 때만 클래스 상한 적용

  // 연환산 공분산 행렬
  const cov: number[][] = [];
  for (let i = 0; i < k; i++) {
    cov.push([]);
    for (let j = 0; j < k; j++) {
      cov[i].push(
        corrMatrix[assets[i]][assets[j]] * annVols[assets[i]] * annVols[assets[j]],
      );
    }
  }

  const annRetsArr = assets.map((t) => annRets[t]);

  // 등비중 초기값 (유효 샘플 미발견 시 폴백)
  let bestW: number[] = Array(k).fill(1 / k);
  let bestScore = -Infinity;

  for (let iter = 0; iter < iterations; iter++) {
    const raw = Array.from({ length: k }, () => Math.random());
    const total = raw.reduce((a, b) => a + b, 0);
    const w = raw.map((v) => v / total);

    // 개별 종목 상·하한 가드
    if (w.some((v) => v > MAX_W || v < MIN_W)) continue;

    // ① 자산군 집중도 상한 가드 (복수 자산군 포트폴리오에만 적용)
    if (hasMultipleClasses) {
      const classWeights: Record<string, number> = {};
      for (let i = 0; i < k; i++) {
        const cls = assetClasses[i];
        classWeights[cls] = (classWeights[cls] ?? 0) + w[i];
      }
      if (Object.values(classWeights).some((cw) => cw > MAX_CLASS_W)) continue;
    }

    let pRet = 0;
    for (let i = 0; i < k; i++) pRet += w[i] * annRetsArr[i];

    let pVar = 0;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) pVar += w[i] * w[j] * cov[i][j];
    }
    const pVol = Math.sqrt(Math.max(pVar, 0));

    const rawScore = (pRet - RF_RATE) / (pVol || 0.0001);

    // ② HHI 집중도 페널티 + 25% 초과 종목 추가 감점
    let hhi = 0;
    let concentrationPenalty = 0;
    for (let i = 0; i < k; i++) {
      hhi += w[i] * w[i];
      if (w[i] > 0.25) concentrationPenalty += (w[i] - 0.25) * 2;
    }
    const score = rawScore - hhi * 0.5 - concentrationPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestW = [...w];
    }
  }

  const result: Record<string, number> = {};
  assets.forEach((t, i) => { result[t] = Math.round(bestW[i] * 10000) / 10000; });
  return result;
}

// ── 핵심 연산 ─────────────────────────────────────────────────────────────────

function computePeriodData(
  b1: ETFBatch,
  b2: ETFBatch,
  strategy: Strategy,
  k: number,
): Record<string, PeriodResult> {
  // 1. 공통 날짜 교집합
  const datesSet1 = new Set(b1.dates);
  const commonDates = b2.dates.filter((d) => datesSet1.has(d)).sort();
  const N = commonDates.length;

  // 2. 날짜 인덱스 맵
  const idx1: Record<string, number> = {};
  b1.dates.forEach((d, i) => { idx1[d] = i; });
  const idx2: Record<string, number> = {};
  b2.dates.forEach((d, i) => { idx2[d] = i; });

  // 3. 전체 가격 배열 (ffill)
  const tickers = TICKERS_ORDERED;
  const pricesAll: Record<string, number[]> = {};
  for (const t of b1.tickers) {
    pricesAll[t] = ffill(commonDates.map((d) => b1.prices[t]?.[idx1[d]] ?? null));
  }
  for (const t of b2.tickers) {
    pricesAll[t] = ffill(commonDates.map((d) => b2.prices[t]?.[idx2[d]] ?? null));
  }

  const PERIOD_SLICES: Record<string, number> = {
    '1W': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': N,
  };

  const result: Record<string, PeriodResult> = {};

  for (const [pname, nDays] of Object.entries(PERIOD_SLICES)) {
    const sl = Math.min(nDays, N);
    if (sl < 2) continue;
    const startIdx = N - sl;
    const datesSl = commonDates.slice(startIdx);

    // 슬라이스 가격 및 수익률
    const pricesSl: Record<string, number[]> = {};
    const retsSl: Record<string, number[]> = {};
    for (const t of tickers) {
      pricesSl[t] = pricesAll[t].slice(startIdx);
      retsSl[t] = computeReturns(pricesSl[t]);
    }

    // ── slice-specific 점수 계산 (Bug A + B + Rf 수정) ─────────────────────
    const sliceVols: Record<string, number> = {};        // 일간 std (greedy용)
    const sliceAnnVols: Record<string, number> = {};     // 연환산 vol (MC용)
    const sliceAnnRets: Record<string, number> = {};     // 산술 평균 연환산 수익률 (MC용)
    const strategyScores: Record<string, number> = {};   // greedy 점수

    for (const t of tickers) {
      const rets = retsSl[t];
      const n = rets.length || 1;
      const mean = rets.reduce((s, v) => s + v, 0) / n;
      const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
      const std = Math.sqrt(variance) || 0.0001;
      const annVol = std * Math.sqrt(252);

      sliceVols[t] = std;
      sliceAnnVols[t] = annVol;
      sliceAnnRets[t] = mean * 252;

      // CAGR (동적 연환산 — 하드코딩 /3 제거)
      const firstP = pricesSl[t][0];
      const lastP = pricesSl[t][pricesSl[t].length - 1];
      const years = sl / 252;
      const cagr = firstP > 0 && years > 0
        ? Math.pow(lastP / firstP, 1 / years) - 1
        : 0;

      if (strategy === 'aggressive') {
        strategyScores[t] = cagr > 0 ? cagr : 0.001;
      } else if (strategy === 'balanced') {
        const sharpe = (cagr - RF_RATE) / (annVol || 0.0001);
        strategyScores[t] = sharpe > 0 ? sharpe : 0.001;
      } else {
        // conservative: 변동성 낮을수록 선호
        strategyScores[t] = annVol;
      }
    }

    // ── 상관행렬 ───────────────────────────────────────────────────────────
    const cm: Record<string, Record<string, number>> = {};
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      cm[t] = {};
      for (let j = 0; j < tickers.length; j++) {
        const t2 = tickers[j];
        if (t === t2) {
          cm[t][t2] = 1.0;
        } else if (cm[t2]?.[t] !== undefined) {
          cm[t][t2] = cm[t2][t];
        } else {
          cm[t][t2] = Math.round(pearson(retsSl[t], retsSl[t2]) * 10000) / 10000;
        }
      }
    }

    // 전체 평균 상관계수
    let pairSum = 0, pairCnt = 0;
    for (let i = 0; i < tickers.length; i++) {
      for (let j = i + 1; j < tickers.length; j++) {
        pairSum += cm[tickers[i]][tickers[j]]; pairCnt++;
      }
    }
    const globalAvg = pairSum / pairCnt;

    // ── 그리디 종목 선정: 모든 시드 시도 후 최저 평균 상관계수 조합 선택 ──
    const avgCorrOf = (combo: string[]) => {
      let s = 0, n = 0;
      for (let i = 0; i < combo.length; i++)
        for (let j = i + 1; j < combo.length; j++) { s += cm[combo[i]][combo[j]]; n++; }
      return n ? s / n : 0;
    };
    let optimal = greedyOptimal(cm, tickers, k, strategy, sliceVols, strategyScores);
    let optBestCorr = avgCorrOf(optimal);
    for (const seedTicker of tickers) {
      const candidate = greedyOptimal(cm, tickers, k, strategy, sliceVols, strategyScores, seedTicker);
      const c = avgCorrOf(candidate);
      if (c < optBestCorr) { optBestCorr = c; optimal = candidate; }
    }

    let optPairSum = 0, optPairCnt = 0;
    for (let i = 0; i < optimal.length; i++) {
      for (let j = i + 1; j < optimal.length; j++) {
        optPairSum += cm[optimal[i]][optimal[j]]; optPairCnt++;
      }
    }
    const optAvgCorr = optPairCnt ? optPairSum / optPairCnt : 0;
    const optScore = Math.max(0, Math.min(100, Math.round((1 - optAvgCorr) / 2 * 100)));

    // ── 몬테카를로 비중 최적화 ─────────────────────────────────────────────
    const cappedWeights = monteCarloWeights(
      optimal, sliceAnnRets, sliceAnnVols, cm, strategy, SECTOR_MAP,
    );

    result[pname] = {
      start: datesSl[0],
      end: datesSl[datesSl.length - 1],
      n_days: datesSl.length,
      corr_matrix: cm,
      optimal,
      opt_avg_corr: Math.round(optAvgCorr * 10000) / 10000,
      opt_score: optScore,
      global_avg: Math.round(globalAvg * 10000) / 10000,
      dates: datesSl,
      prices: pricesSl,
      capped_weights: cappedWeights,
      scores: strategyScores,
    };
  }

  return result;
}

// ── 라우트 핸들러 ─────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const strategy = (['conservative', 'balanced', 'aggressive'].includes(
    url.searchParams.get('strategy') ?? '',
  )
    ? url.searchParams.get('strategy')
    : 'balanced') as Strategy;
  const k = Math.min(8, Math.max(3, parseInt(url.searchParams.get('k') ?? '3', 10)));
  const lockedTicker = TICKERS_ORDERED.includes(url.searchParams.get('lockedTicker') ?? '')
    ? url.searchParams.get('lockedTicker')
    : null;

  const cacheKey = `${strategy}-${k}`;
  const dataDir = path.join(process.cwd(), 'data');

  try {
    let periodData: Record<string, unknown>;
    const hit = dataCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      periodData = hit.data;
    } else {
      let b1: ETFBatch, b2: ETFBatch;
      const liveBatch = await fetchLiveData(TICKERS_ORDERED);
      if (liveBatch) {
        const half = Math.ceil(TICKERS_ORDERED.length / 2);
        b1 = {
          tickers: TICKERS_ORDERED.slice(0, half),
          dates: liveBatch.dates,
          prices: Object.fromEntries(TICKERS_ORDERED.slice(0, half).map((t) => [t, liveBatch.prices[t]])),
        };
        b2 = {
          tickers: TICKERS_ORDERED.slice(half),
          dates: liveBatch.dates,
          prices: Object.fromEntries(TICKERS_ORDERED.slice(half).map((t) => [t, liveBatch.prices[t]])),
        };
      } else {
        b1 = JSON.parse(fs.readFileSync(path.join(dataDir, 'etf_b1.json'), 'utf-8'));
        b2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'etf_b2.json'), 'utf-8'));
      }
      periodData = computePeriodData(b1, b2, strategy, k) as Record<string, unknown>;
      dataCache.set(cacheKey, { data: periodData, ts: Date.now() });
    }

    if (url.searchParams.get('format') === 'json') {
      const periodKey = url.searchParams.get('period') ?? '1Y';
      const period = (periodData as Record<string, unknown>)[periodKey] ?? null;
      return Response.json({ period, sectorMap: SECTOR_MAP });
    }

    const tmpl = fs.readFileSync(path.join(dataDir, 'template.html'), 'utf-8');

    const strategyTexts: Record<Strategy, string> = {
      conservative: '🛡️ 안전형 (Conservative → 상관계수+변동성 댐핑 리스크 낮춤)',
      balanced:     '⚖️ 밸런스형 (Balanced → 상관계수+샤프지수 최대화)',
      aggressive:   '🔥 공격형 (Aggressive → 상관계수+CAGR 최대화)',
    };

    const html = tmpl
      .replace('##PERIOD_DATA_JS##', JSON.stringify(periodData))
      .replace('##K_VAL_JS##', String(k))
      .replace('##STRATEGY_TYPE##', strategy)
      .replace('##INITIAL_LOCKED_TICKER##', lockedTicker ?? '')
      .replace('##STRATEGY_TXT##', strategyTexts[strategy]);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[etf-correlation-html]', err);
    return new Response(
      '<h1>ETF 데이터 로드 실패</h1><p>data/etf_b1.json, etf_b2.json, template.html 파일을 확인하세요.</p>',
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}
