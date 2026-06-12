/**
 * 기술적 분석 지표 계산 유틸
 * SKILL.md 의 Python 로직을 TypeScript 로 직접 이식
 * 순수 수학 함수만 포함 — 외부 의존성 없음
 */

type N = number | null;

// ── 마지막 유효값 ──────────────────────────────────────────────────
export function lv(arr: N[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null) return arr[i];
  }
  return null;
}

// ── 단순이동평균 ───────────────────────────────────────────────────
export function sma(prices: number[], n: number): N[] {
  const r: N[] = new Array(n - 1).fill(null);
  for (let i = n - 1; i < prices.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += prices[j];
    r.push(s / n);
  }
  return r;
}

// ── 지수이동평균 ───────────────────────────────────────────────────
export function ema(prices: number[], n: number): N[] {
  if (prices.length < n) return new Array(prices.length).fill(null);
  const k = 2 / (n + 1);
  const r: N[] = new Array(n - 1).fill(null);
  let e = prices.slice(0, n).reduce((a, b) => a + b, 0) / n;
  r.push(e);
  for (let i = n; i < prices.length; i++) {
    e = prices[i] * k + e * (1 - k);
    r.push(e);
  }
  return r;
}

// ── RSI (14) ───────────────────────────────────────────────────────
export function rsi(prices: number[], n = 14): N[] {
  const r: N[] = new Array(n).fill(null);
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  let ag = gains.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let al = losses.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const calc = (ag: number, al: number) => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  r.push(calc(ag, al));
  for (let i = n; i < gains.length; i++) {
    ag = (ag * (n - 1) + gains[i]) / n;
    al = (al * (n - 1) + losses[i]) / n;
    r.push(calc(ag, al));
  }
  return r;
}

// ── MACD (12/26/9) ────────────────────────────────────────────────
export function macdCalc(prices: number[]): { macd: N[]; signal: N[]; histogram: N[] } {
  const e12 = ema(prices, 12);
  const e26 = ema(prices, 26);
  const macdLine: N[] = e12.map((v, i) =>
    v !== null && e26[i] !== null ? (v as number) - (e26[i] as number) : null,
  );
  const macdValues = macdLine.filter((v): v is number => v !== null);
  const signalRaw = ema(macdValues, 9);
  const nullCount = macdLine.filter((v) => v === null).length;
  const signalLine: N[] = [...new Array(nullCount + 8).fill(null), ...signalRaw];
  const histogram: N[] = macdLine.map((m, i) =>
    m !== null && signalLine[i] !== null ? (m as number) - (signalLine[i] as number) : null,
  );
  return { macd: macdLine, signal: signalLine, histogram };
}

// ── ROC (10) ──────────────────────────────────────────────────────
export function roc(prices: number[], n = 10): N[] {
  const r: N[] = new Array(n).fill(null);
  for (let i = n; i < prices.length; i++) {
    r.push(((prices[i] - prices[i - n]) / prices[i - n]) * 100);
  }
  return r;
}

// ── Momentum (10) ─────────────────────────────────────────────────
export function momentum(prices: number[], n = 10): N[] {
  const r: N[] = new Array(n).fill(null);
  for (let i = n; i < prices.length; i++) {
    r.push(prices[i] - prices[i - n]);
  }
  return r;
}

// ── 볼린저밴드 (20, 2σ) ───────────────────────────────────────────
export function bollinger(
  prices: number[],
  n = 20,
  k = 2,
): { upper: N[]; mid: N[]; lower: N[]; pctB: N[] } {
  const upper: N[] = new Array(n - 1).fill(null);
  const mid: N[] = new Array(n - 1).fill(null);
  const lower: N[] = new Array(n - 1).fill(null);
  const pctB: N[] = new Array(n - 1).fill(null);
  for (let i = n - 1; i < prices.length; i++) {
    const w = prices.slice(i - n + 1, i + 1);
    const mv = w.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(w.reduce((a, b) => a + (b - mv) ** 2, 0) / n);
    const ub = mv + k * std;
    const lb = mv - k * std;
    upper.push(ub);
    mid.push(mv);
    lower.push(lb);
    pctB.push(ub - lb !== 0 ? (prices[i] - lb) / (ub - lb) : 0.5);
  }
  return { upper, mid, lower, pctB };
}

// ── 역사적 변동성 (연율화, 20일) ──────────────────────────────────
export function hvol(prices: number[], n = 20): N[] {
  const r: N[] = new Array(n).fill(null);
  const lr: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0)
      lr.push(Math.log(prices[i] / prices[i - 1]));
    else lr.push(0);
  }
  for (let i = n - 1; i < lr.length; i++) {
    const w = lr.slice(i - n + 1, i + 1);
    const mv = w.reduce((a, b) => a + b, 0) / n;
    const variance = w.reduce((a, b) => a + (b - mv) ** 2, 0) / n;
    r.push(Math.sqrt(variance) * Math.sqrt(252) * 100);
  }
  if (r.length > 0 && r[r.length - 1] === null && r.length > 1) {
    r.push(r[r.length - 1]);
  }
  return r;
}

// ── OBV ───────────────────────────────────────────────────────────
export function obv(closes: number[], volumes: number[]): number[] {
  const r: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) r.push(r[r.length - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) r.push(r[r.length - 1] - volumes[i]);
    else r.push(r[r.length - 1]);
  }
  return r;
}

// ── 일목균형표 중간값 ──────────────────────────────────────────────
export function hlMid(highs: number[], lows: number[], n: number): N[] {
  const r: N[] = new Array(n - 1).fill(null);
  for (let i = n - 1; i < highs.length; i++) {
    const hSlice = highs.slice(i - n + 1, i + 1);
    const lSlice = lows.slice(i - n + 1, i + 1);
    r.push((Math.max(...hSlice) + Math.min(...lSlice)) / 2);
  }
  return r;
}

// ── 미래 거래일 생성 (토/일 제외) ─────────────────────────────────
export function futureBdays(lastDate: string, n: number): string[] {
  const result: string[] = [];
  const d = new Date(lastDate);
  while (result.length < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6)
      result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

// ── 타입 정의 ─────────────────────────────────────────────────────

export interface ScoreItem {
  score: number;
  max: number;
  desc: string;
}

export interface TAScore {
  이동평균배열: ScoreItem;
  골든데드크로스: ScoreItem;
  일목균형표: ScoreItem;
  추세합계: ScoreItem;
  RSI: ScoreItem;
  MACD: ScoreItem;
  ROC: ScoreItem;
  모멘텀합계: ScoreItem;
  볼린저밴드: ScoreItem;
  역사적변동성: ScoreItem;
  변동성합계: ScoreItem;
  OBV: ScoreItem;
  거래량합계: ScoreItem;
  total: number;
}

export interface TAIndicators {
  dates: string[];
  prices: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  sma5: N[];
  sma20: N[];
  sma50: N[];
  sma200: N[];
  ema12: N[];
  ema26: N[];
  rsi: N[];
  macd: N[];
  signal: N[];
  histogram: N[];
  roc: N[];
  mom: N[];
  bbUp: N[];
  bbMid: N[];
  bbLow: N[];
  pctB: N[];
  hvol: N[];
  obvArr: number[];
  obvEma: N[];
  tenkan: N[];
  kijun: N[];
  spanA: N[];
  spanB: N[];
  // 일목 차트용 확장 배열 (미래 26 거래일 포함)
  ichDates: string[];
  ichPrice: N[];
  ichTenkan: N[];
  ichKijun: N[];
  ichSpanA: N[];
  ichSpanB: N[];
  ichChikou: N[];
}

export interface TAResult {
  indicators: TAIndicators;
  score: TAScore;
  grade: string;
  gradeColor: string;
  gradeEmoji: string;
}

// ── 전체 지표 + 점수 계산 ─────────────────────────────────────────
export function computeTA(
  dates: string[],
  prices: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): TAResult {
  const N = prices.length;
  const SHIFT = 26;

  const sma5a = sma(prices, 5);
  const sma20a = sma(prices, 20);
  const sma50a = sma(prices, 50);
  const sma200a = sma(prices, 200);
  const ema12a = ema(prices, 12);
  const ema26a = ema(prices, 26);
  const rsiA = rsi(prices, 14);
  const { macd: macdA, signal: signalA, histogram: histA } = macdCalc(prices);
  const rocA = roc(prices, 10);
  const momA = momentum(prices, 10);
  const { upper: bbU, mid: bbM, lower: bbL, pctB: pbA } = bollinger(prices, 20, 2);
  const hvolA = hvol(prices, 20);
  const obvA = obv(prices, volumes);
  const obvEmaA = ema(obvA, 20);
  const tenkan = hlMid(highs, lows, 9);
  const kijun = hlMid(highs, lows, 26);
  const spanA: N[] = tenkan.map((t, i) =>
    t !== null && kijun[i] !== null ? ((t as number) + (kijun[i] as number)) / 2 : null,
  );
  const spanB = hlMid(highs, lows, 52);

  // ── 일목 차트용 확장 ─────────────────────────────────────────────
  const futureDates = futureBdays(dates[dates.length - 1], SHIFT);
  const ichDates = [...dates, ...futureDates];
  const M = ichDates.length;
  const ichPrice: N[] = [...prices, ...new Array(SHIFT).fill(null)];
  const ichTenkan: N[] = [...tenkan, ...new Array(SHIFT).fill(null)];
  const ichKijun: N[] = [...kijun, ...new Array(SHIFT).fill(null)];
  const ichSpanA: N[] = [...new Array(SHIFT).fill(null), ...spanA];
  const ichSpanB: N[] = [...new Array(SHIFT).fill(null), ...spanB];
  const ichChikou: N[] = Array.from({ length: M }, (_, k) =>
    k + SHIFT < N ? prices[k + SHIFT] : null,
  );

  // ── 점수 계산 ─────────────────────────────────────────────────────
  const p = prices[N - 1];

  // 추세 — 이동평균 배열 (10)
  const s20v = lv(sma20a);
  const s50v = lv(sma50a);
  const s200v = lv(sma200a);
  let maScore = 0;
  if (s20v !== null && p > s20v) maScore += 4;
  if (s50v !== null && p > s50v) maScore += 3;
  if (s200v !== null && p > s200v) maScore += 3;
  const maDesc =
    `현재가 ${p.toFixed(2)} | SMA20 ${s20v?.toFixed(2) ?? 'N/A'}` +
    ` | SMA50 ${s50v?.toFixed(2) ?? 'N/A'} | SMA200 ${s200v?.toFixed(2) ?? 'N/A'}`;

  // 추세 — 골든/데드크로스 (10)
  let csScore = 5;
  let csDesc = '';
  if (N >= 50) {
    const a20 = sma(prices, 20);
    const a50 = sma(prices, 50);
    let found = false;
    for (let i = Math.max(1, a20.length - 20); i < a20.length; i++) {
      const c = a20[i];
      const p0 = a20[i - 1];
      const b = a50[i];
      const b0 = a50[i - 1];
      if (c === null || p0 === null || b === null || b0 === null) continue;
      if ((c as number) > (b as number) && (p0 as number) <= (b0 as number)) {
        csScore = 10;
        csDesc = '최근 골든크로스 발생';
        found = true;
        break;
      }
      if ((c as number) < (b as number) && (p0 as number) >= (b0 as number)) {
        csScore = 0;
        csDesc = '최근 데드크로스 발생';
        found = true;
        break;
      }
    }
    if (!found) {
      const n20 = lv(sma20a);
      const n50 = lv(sma50a);
      if (n20 !== null && n50 !== null) {
        csScore = n20 > n50 ? 8 : 2;
        csDesc = n20 > n50 ? 'SMA20 > SMA50 (상승 배열)' : 'SMA20 < SMA50 (하락 배열)';
      }
    }
  }

  // 추세 — 일목균형표 (15)
  let ichScore = 0;
  const ichDescParts: string[] = [];
  const ca = N - 1 - SHIFT >= 0 ? spanA[N - 1 - SHIFT] : null;
  const cb = N - 1 - SHIFT >= 0 ? spanB[N - 1 - SHIFT] : null;
  if (ca !== null && cb !== null) {
    const ctop = Math.max(ca as number, cb as number);
    const cbot = Math.min(ca as number, cb as number);
    if (p > ctop) { ichScore += 7; ichDescParts.push('구름 위(+7)'); }
    else if (p < cbot) { ichDescParts.push('구름 아래(0)'); }
    else { ichScore += 3; ichDescParts.push('구름 내부(+3)'); }
  }
  const tkv = lv(tenkan);
  const kjv = lv(kijun);
  if (tkv !== null && kjv !== null) {
    if (tkv > kjv) { ichScore += 4; ichDescParts.push('전환>기준(+4)'); }
    else { ichDescParts.push('전환<기준(0)'); }
  }
  const sav = lv(spanA);
  const sbv = lv(spanB);
  if (sav !== null && sbv !== null) {
    if ((sav as number) > (sbv as number)) { ichScore += 2; ichDescParts.push('양운(+2)'); }
    else { ichDescParts.push('음운(0)'); }
  }
  if (N - 1 - SHIFT >= 0) {
    if (prices[N - 1] > prices[N - 1 - SHIFT]) { ichScore += 2; ichDescParts.push('후행스팬 위(+2)'); }
    else { ichDescParts.push('후행스팬 아래(0)'); }
  }

  const trendTotal = maScore + csScore + ichScore;

  // 모멘텀 — RSI (12)
  const rv = lv(rsiA);
  let rsiScore = 0;
  let rsiDesc = '';
  if (rv !== null) {
    if (rv < 30) { rsiScore = 10; rsiDesc = `RSI ${rv.toFixed(1)} - 과매도`; }
    else if (rv < 50) { rsiScore = 8; rsiDesc = `RSI ${rv.toFixed(1)} - 약세 구간`; }
    else if (rv < 70) { rsiScore = 12; rsiDesc = `RSI ${rv.toFixed(1)} - 적정 강세`; }
    else { rsiScore = 5; rsiDesc = `RSI ${rv.toFixed(1)} - 과매수`; }
  }

  // 모멘텀 — MACD (12)
  const mv = lv(macdA);
  const sv = lv(signalA);
  const hv2 = lv(histA);
  let macdScore = 0;
  let macdDesc = '';
  if (mv !== null && sv !== null) {
    const above = mv > sv;
    const posHist = hv2 !== null && hv2 > 0;
    if (above && posHist) { macdScore = 12; macdDesc = 'MACD above Signal, Histogram 양수'; }
    else if (above) { macdScore = 8; macdDesc = 'MACD above Signal, Histogram 음수'; }
    else if (!above && posHist) { macdScore = 5; macdDesc = 'MACD below Signal, Histogram 양수'; }
    else { macdScore = 2; macdDesc = 'MACD below Signal, Histogram 음수'; }
  }

  // 모멘텀 — ROC (6)
  const rv2 = lv(rocA);
  let rocScore = 0;
  if (rv2 !== null) {
    if (rv2 > 5) rocScore = 6;
    else if (rv2 > 0) rocScore = 4;
    else if (rv2 > -5) rocScore = 2;
  }
  const rocDesc = rv2 !== null ? `ROC(10) ${rv2.toFixed(2)}%` : 'N/A';

  const momentumTotal = rsiScore + macdScore + rocScore;

  // 변동성 — 볼린저밴드 (10)
  const pbv = lv(pbA);
  let bbScore = 0;
  let bbDesc = '';
  if (pbv !== null) {
    if (pbv < 0) { bbScore = 7; bbDesc = `%B ${pbv.toFixed(3)} - 밴드 하단 이탈`; }
    else if (pbv < 0.2) { bbScore = 8; bbDesc = `%B ${pbv.toFixed(3)} - 하단 근처`; }
    else if (pbv < 0.8) { bbScore = 7; bbDesc = `%B ${pbv.toFixed(3)} - 밴드 중간`; }
    else if (pbv < 1.0) { bbScore = 4; bbDesc = `%B ${pbv.toFixed(3)} - 상단 근처`; }
    else { bbScore = 2; bbDesc = `%B ${pbv.toFixed(3)} - 밴드 상단 이탈`; }
  }

  // 변동성 — 역사적 변동성 (10)
  const hval = lv(hvolA);
  let hvolScore = 0;
  let hvolDesc = '';
  if (hval !== null) {
    if (hval < 20) { hvolScore = 10; hvolDesc = `연간변동성 ${hval.toFixed(1)}% - 매우 안정적`; }
    else if (hval < 35) { hvolScore = 7; hvolDesc = `연간변동성 ${hval.toFixed(1)}% - 보통 수준`; }
    else if (hval < 55) { hvolScore = 4; hvolDesc = `연간변동성 ${hval.toFixed(1)}% - 변동성 높음`; }
    else { hvolScore = 1; hvolDesc = `연간변동성 ${hval.toFixed(1)}% - 매우 높은 변동성`; }
  }

  const volTotal = bbScore + hvolScore;

  // 거래량 — OBV (15)
  const ov = obvA[N - 1];
  const oev = lv(obvEmaA);
  let obvScore = 0;
  const obvDescParts: string[] = [];
  if (oev !== null) {
    if (ov > oev) { obvScore += 7; obvDescParts.push('OBV>이평(+7)'); }
    else { obvScore += 2; obvDescParts.push('OBV<이평(+2)'); }
  }
  if (N > 21) {
    if (obvA[N - 1] > obvA[N - 21]) { obvScore += 5; obvDescParts.push('20일 상승(+5)'); }
    else if (obvA[N - 1] === obvA[N - 21]) { obvScore += 2; obvDescParts.push('20일 횡보(+2)'); }
    else { obvDescParts.push('20일 하락(0)'); }
    const pchg = prices[N - 1] - prices[N - 21];
    const ochg = obvA[N - 1] - obvA[N - 21];
    if (pchg > 0 && ochg < 0) { obvDescParts.push('약세 다이버전스(0)'); }
    else if (pchg < 0 && ochg > 0) { obvScore += 3; obvDescParts.push('강세 다이버전스(+3)'); }
    else { obvScore += 3; obvDescParts.push('가격-OBV 동행(+3)'); }
  }

  const total = trendTotal + momentumTotal + volTotal + obvScore;

  const grade =
    total >= 75 ? '강한 매수' :
    total >= 60 ? '매수 우세' :
    total >= 45 ? '중립' :
    total >= 30 ? '매도 우세' : '강한 매도';

  const gradeColor =
    total >= 75 ? '#16a34a' :
    total >= 60 ? '#f59e0b' :
    total >= 45 ? '#f97316' : '#dc2626';

  const gradeEmoji =
    total >= 75 ? '🟢' :
    total >= 60 ? '🟡' :
    total >= 45 ? '⚪' :
    total >= 30 ? '🟠' : '🔴';

  return {
    indicators: {
      dates, prices, highs, lows, volumes,
      sma5: sma5a, sma20: sma20a, sma50: sma50a, sma200: sma200a,
      ema12: ema12a, ema26: ema26a,
      rsi: rsiA, macd: macdA, signal: signalA, histogram: histA,
      roc: rocA, mom: momA,
      bbUp: bbU, bbMid: bbM, bbLow: bbL, pctB: pbA,
      hvol: hvolA,
      obvArr: obvA, obvEma: obvEmaA,
      tenkan, kijun, spanA, spanB,
      ichDates, ichPrice, ichTenkan, ichKijun, ichSpanA, ichSpanB, ichChikou,
    },
    score: {
      이동평균배열: { score: maScore, max: 10, desc: maDesc },
      골든데드크로스: { score: csScore, max: 10, desc: csDesc },
      일목균형표: { score: ichScore, max: 15, desc: ichDescParts.join(' · ') },
      추세합계: { score: trendTotal, max: 35, desc: '' },
      RSI: { score: rsiScore, max: 12, desc: rsiDesc },
      MACD: { score: macdScore, max: 12, desc: macdDesc },
      ROC: { score: rocScore, max: 6, desc: rocDesc },
      모멘텀합계: { score: momentumTotal, max: 30, desc: '' },
      볼린저밴드: { score: bbScore, max: 10, desc: bbDesc },
      역사적변동성: { score: hvolScore, max: 10, desc: hvolDesc },
      변동성합계: { score: volTotal, max: 20, desc: '' },
      OBV: { score: obvScore, max: 15, desc: obvDescParts.join(' · ') },
      거래량합계: { score: obvScore, max: 15, desc: '' },
      total,
    },
    grade,
    gradeColor,
    gradeEmoji,
  };
}
