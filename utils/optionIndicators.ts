// 옵션 분석 순수 계산 함수 모음
// I/O 없음 — API 라우트와 React 컴포넌트에서 공동 사용

export interface RawContract {
  strike: number;
  volume: number;
  openInterest: number;
  iv: number; // impliedVolatility (0~1 스케일)
}

export interface RawExpiry {
  expirationDate: number; // unix 초
  calls: RawContract[];
  puts: RawContract[];
}

export interface BucketData {
  name: string;
  cOI: number;
  pOI: number;
  cVol: number;
  pVol: number;
  n: number;
  pcOI: number | null;
  pcVol: number | null;
}

export interface TargetExpiry {
  exp: string; // YYYY-MM-DD
  dte: number;
  atmIV: number | null;
  maxPain: number;
  callWall: number | null;
  putWall: number | null;
  cOI: number;
  pOI: number;
}

export interface WallData {
  strikes: number[];
  callOI: number[];
  putOI: number[];
}

export interface TermItem {
  dte: number;
  iv: number;
}

export interface SkewData {
  strikes: number[];
  callIV: (number | null)[];
  putIV: (number | null)[];
}

export interface Anomaly {
  icon: string;
  severity: "high" | "mid" | "low";
  title: string;
  detail: string;
}

export interface OptionsChainResponse {
  ticker: string;
  spot: number;
  hv20: number;
  generatedAt: string;
  nExp: number;
  totCOI: number;
  totPOI: number;
  totCVol: number;
  totPVol: number;
  pcOI: number | null;
  pcVol: number | null;
  score: number;
  scoreLabel: string;
  scoreColor: string;
  buckets: BucketData[];
  target: TargetExpiry;
  walls: WallData;
  skew: SkewData;
  term: TermItem[];
  anomalies: Anomaly[];
  earnings: { date: string; dte: number } | null;
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────────────

function computeHV(prices: number[], n = 20): number {
  if (prices.length < n + 1) return 0;
  const slice = prices.slice(-(n + 1));
  const logRets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] > 0 && slice[i - 1] > 0) logRets.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (logRets.length < 2) return 0;
  const mean = logRets.reduce((a, b) => a + b, 0) / logRets.length;
  const variance = logRets.reduce((a, b) => a + (b - mean) ** 2, 0) / logRets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function getATMIV(contracts: RawContract[], spot: number): number | null {
  const valid = contracts.filter((c) => c.iv > 0.005);
  if (!valid.length) return null;
  const closest = valid.reduce((a, b) =>
    Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a
  );
  return closest.iv * 100;
}

// 3번째 금요일 여부 (미국 월간 만기 기준)
function isMonthlyFriday(ts: number): boolean {
  const d = new Date(ts * 1000);
  return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
}

function computeMaxPain(calls: RawContract[], puts: RawContract[], strikes: number[]): number {
  if (!strikes.length) return 0;
  const cMap: Record<number, number> = {};
  const pMap: Record<number, number> = {};
  for (const c of calls) cMap[c.strike] = (cMap[c.strike] ?? 0) + c.openInterest;
  for (const p of puts) pMap[p.strike] = (pMap[p.strike] ?? 0) + p.openInterest;
  let minPayout = Infinity;
  let mpStrike = strikes[0];
  for (const S of strikes) {
    let payout = 0;
    for (const k of strikes) {
      payout += Math.max(0, S - k) * (cMap[k] ?? 0);
      payout += Math.max(0, k - S) * (pMap[k] ?? 0);
    }
    if (payout < minPayout) { minPayout = payout; mpStrike = S; }
  }
  return mpStrike;
}

function pcScoreFunc(r: number | null): number {
  if (r === null) return 0;
  if (r <= 0.5) return 80;
  if (r <= 0.7) return 50;
  if (r <= 0.9) return 25;
  if (r <= 1.1) return 0;
  if (r <= 1.4) return -25;
  if (r <= 1.8) return -50;
  return -80;
}

// ── 메인 계산 함수 ────────────────────────────────────────────────────

export function computeOptionsResult(
  ticker: string,
  spot: number,
  chains: RawExpiry[],
  hvPrices: number[],
  earnings: { date: string; dte: number } | null,
): OptionsChainResponse {
  const todaySec = Date.now() / 1000;
  const hv20 = computeHV(hvPrices);

  interface PerExp {
    ts: number;
    dte: number;
    cOI: number;
    pOI: number;
    cVol: number;
    pVol: number;
    atmIV: number | null;
    calls: RawContract[];
    puts: RawContract[];
  }

  const perExp: PerExp[] = chains
    .map((ch) => {
      const d = Math.round((ch.expirationDate - todaySec) / 86400);
      const cOI = ch.calls.reduce((s, c) => s + (c.openInterest || 0), 0);
      const pOI = ch.puts.reduce((s, p) => s + (p.openInterest || 0), 0);
      const cVol = ch.calls.reduce((s, c) => s + (c.volume || 0), 0);
      const pVol = ch.puts.reduce((s, p) => s + (p.volume || 0), 0);
      const ivArr = [getATMIV(ch.calls, spot), getATMIV(ch.puts, spot)].filter(
        (v): v is number => v !== null,
      );
      const atmIV = ivArr.length ? ivArr.reduce((a, b) => a + b, 0) / ivArr.length : null;
      return { ts: ch.expirationDate, dte: d, cOI, pOI, cVol, pVol, atmIV, calls: ch.calls, puts: ch.puts };
    })
    .filter((e) => e.dte >= 0)
    .sort((a, b) => a.dte - b.dte);

  // 전체 합산
  const totCOI = perExp.reduce((s, e) => s + e.cOI, 0);
  const totPOI = perExp.reduce((s, e) => s + e.pOI, 0);
  const totCVol = perExp.reduce((s, e) => s + e.cVol, 0);
  const totPVol = perExp.reduce((s, e) => s + e.pVol, 0);
  const pcOI = totCOI ? Math.round((totPOI / totCOI) * 100) / 100 : null;
  const pcVol = totCVol ? Math.round((totPVol / totCVol) * 100) / 100 : null;

  // 점수
  const score = Math.round(0.55 * pcScoreFunc(pcOI) + 0.45 * pcScoreFunc(pcVol));
  let scoreLabel: string, scoreColor: string;
  if (score >= 50) { scoreLabel = "강한 콜 우세 (강세)"; scoreColor = "#16a34a"; }
  else if (score >= 20) { scoreLabel = "콜 우세 (강세)"; scoreColor = "#65a30d"; }
  else if (score > -20) { scoreLabel = "중립"; scoreColor = "#64748b"; }
  else if (score > -50) { scoreLabel = "풋 우세 (약세)"; scoreColor = "#ea580c"; }
  else { scoreLabel = "강한 풋 우세 (약세)"; scoreColor = "#dc2626"; }

  // DTE 버킷
  const BUCKET_DEFS: [string, number, number][] = [
    ["0-7일", 0, 7], ["8-30일", 8, 30], ["31-90일", 31, 90], ["91-365일", 91, 365], ["365일+", 366, 99999],
  ];
  const buckets: BucketData[] = BUCKET_DEFS.map(([name, lo, hi]) => {
    const sub = perExp.filter((e) => e.dte >= lo && e.dte <= hi);
    const cOI = sub.reduce((s, e) => s + e.cOI, 0);
    const pOI = sub.reduce((s, e) => s + e.pOI, 0);
    const cVol = sub.reduce((s, e) => s + e.cVol, 0);
    const pVol = sub.reduce((s, e) => s + e.pVol, 0);
    return {
      name, cOI, pOI, cVol, pVol, n: sub.length,
      pcOI: cOI ? Math.round((pOI / cOI) * 100) / 100 : null,
      pcVol: cVol ? Math.round((pVol / cVol) * 100) / 100 : null,
    };
  });

  // 대상 만기 (가장 가까운 월간 만기, 없으면 가장 가까운 것)
  const withData = perExp.filter((e) => e.cOI + e.pOI > 0);
  const monthly = withData.filter((e) => isMonthlyFriday(e.ts));
  const targetE = monthly.length ? monthly[0] : withData.length ? withData[0] : perExp[0];

  if (!targetE) {
    return {
      ticker, spot: Math.round(spot * 100) / 100, hv20: Math.round(hv20 * 10) / 10,
      generatedAt: new Date().toLocaleString("ko-KR"), nExp: 0,
      totCOI: 0, totPOI: 0, totCVol: 0, totPVol: 0, pcOI: null, pcVol: null,
      score: 0, scoreLabel: "데이터 없음", scoreColor: "#94a3b8",
      buckets, target: { exp: "", dte: 0, atmIV: null, maxPain: spot, callWall: null, putWall: null, cOI: 0, pOI: 0 },
      walls: { strikes: [], callOI: [], putOI: [] }, skew: { strikes: [], callIV: [], putIV: [] },
      term: [], anomalies: [], earnings,
    };
  }

  // Max Pain
  const tStrikes = [...new Set([...targetE.calls.map((c) => c.strike), ...targetE.puts.map((p) => p.strike)])].sort((a, b) => a - b);
  const maxPainStrike = tStrikes.length ? computeMaxPain(targetE.calls, targetE.puts, tStrikes) : spot;
  const callWall = targetE.calls.length ? targetE.calls.reduce((a, b) => b.openInterest > a.openInterest ? b : a).strike : null;
  const putWall = targetE.puts.length ? targetE.puts.reduce((a, b) => b.openInterest > a.openInterest ? b : a).strike : null;

  const target: TargetExpiry = {
    exp: new Date(targetE.ts * 1000).toISOString().slice(0, 10),
    dte: targetE.dte,
    atmIV: targetE.atmIV !== null ? Math.round(targetE.atmIV * 10) / 10 : null,
    maxPain: Math.round(maxPainStrike * 100) / 100,
    callWall: callWall !== null ? Math.round(callWall * 100) / 100 : null,
    putWall: putWall !== null ? Math.round(putWall * 100) / 100 : null,
    cOI: targetE.cOI,
    pOI: targetE.pOI,
  };

  // 벽 차트 데이터 (현재가 ±45% 범위, 최대 30개 행사가)
  const loS = spot * 0.55, hiS = spot * 1.55;
  let wallSt = tStrikes.filter((s) => s >= loS && s <= hiS);
  if (wallSt.length > 30) {
    wallSt = wallSt.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 30).sort((a, b) => a - b);
  }
  const cOIMap: Record<number, number> = {};
  const pOIMap: Record<number, number> = {};
  for (const c of targetE.calls) cOIMap[c.strike] = (cOIMap[c.strike] ?? 0) + c.openInterest;
  for (const p of targetE.puts) pOIMap[p.strike] = (pOIMap[p.strike] ?? 0) + p.openInterest;
  const walls: WallData = {
    strikes: wallSt.map((s) => Math.round(s * 10) / 10),
    callOI: wallSt.map((s) => cOIMap[s] ?? 0),
    putOI: wallSt.map((s) => pOIMap[s] ?? 0),
  };

  // IV 스큐
  const cIVMap: Record<number, number> = {};
  const pIVMap: Record<number, number> = {};
  for (const c of targetE.calls) if (c.iv > 0.01) cIVMap[c.strike] = Math.round(c.iv * 1000) / 10;
  for (const p of targetE.puts) if (p.iv > 0.01) pIVMap[p.strike] = Math.round(p.iv * 1000) / 10;
  const skew: SkewData = {
    strikes: wallSt.map((s) => Math.round(s * 10) / 10),
    callIV: wallSt.map((s) => cIVMap[s] ?? null),
    putIV: wallSt.map((s) => pIVMap[s] ?? null),
  };

  // IV 기간 구조
  const term: TermItem[] = perExp
    .filter((e) => e.atmIV !== null)
    .map((e) => ({ dte: e.dte, iv: Math.round(e.atmIV! * 10) / 10 }));

  // ── 특이사항 탐지 ──────────────────────────────────────────────────

  const anomalies: Anomaly[] = [];

  // 1. 신규 대량 진입 (거래량 > OI × 2 && 거래량 ≥ 500)
  const ua: { vol: number; oi: number; side: string; strike: number; exp: string; dte: number }[] = [];
  for (const e of perExp) {
    if (e.dte < 0 || e.dte > 120) continue;
    const expStr = new Date(e.ts * 1000).toISOString().slice(0, 10);
    for (const [side, contracts] of [["콜", e.calls], ["풋", e.puts]] as [string, RawContract[]][]) {
      for (const c of contracts) {
        const vol = c.volume || 0, oi = c.openInterest || 0;
        if (vol >= 500 && vol >= 2 * Math.max(oi, 1)) ua.push({ vol, oi, side, strike: c.strike, exp: expStr, dte: e.dte });
      }
    }
  }
  ua.sort((a, b) => b.vol - a.vol);
  for (const u of ua.slice(0, 5)) {
    const isOTM = (u.side === "콜" && u.strike > spot) || (u.side === "풋" && u.strike < spot);
    anomalies.push({
      icon: "⚡", severity: u.vol >= 3000 ? "high" : "mid",
      title: `${u.side}옵션 신규 대량 진입 → $${u.strike} (${u.exp})`,
      detail: `당일 거래량 ${u.vol.toLocaleString()}계약이 기존 미결제약정 ${u.oi.toLocaleString()}계약을 크게 앞섭니다. 만기 ${u.dte}일 남은 ${isOTM ? "외가격(OTM)" : "내가격(ITM)"} ${u.side}옵션에 새로운 베팅이 집중됐습니다. 정보 기반 베팅 또는 헤지·롤오버일 수 있으니 뉴스와 함께 확인하세요.`,
    });
  }

  // 2. 단일 행사가 OI 집중
  for (const [side, contracts, total] of [["콜", targetE.calls, targetE.cOI], ["풋", targetE.puts, targetE.pOI]] as [string, RawContract[], number][]) {
    if (!total || !contracts.length) continue;
    const maxC = contracts.reduce((a, b) => b.openInterest > a.openInterest ? b : a);
    const share = (maxC.openInterest / total) * 100;
    if (share >= 18) {
      anomalies.push({
        icon: "🧱", severity: share >= 30 ? "mid" : "low",
        title: `${side} OI 단일 행사가 집중 → $${maxC.strike}`,
        detail: `${target.exp} 만기 ${side} 미결제약정의 ${share.toFixed(0)}%가 $${maxC.strike} 한 곳에 몰려 있습니다. 이 가격은 강한 ${side === "콜" ? "저항" : "지지"} 벽으로 작용할 가능성이 높습니다.`,
      });
    }
  }

  // 3. IV 과열
  if (target.atmIV && hv20 && target.atmIV / hv20 >= 1.4) {
    anomalies.push({
      icon: "🌡️", severity: "mid",
      title: `내재변동성 과열 → IV ${target.atmIV.toFixed(0)}% vs HV ${hv20.toFixed(0)}%`,
      detail: `근월 등가격 IV가 실현변동성의 ${(target.atmIV / hv20).toFixed(2)}배입니다. 옵션이 비싸게 거래되고 있으며, 임박한 이벤트(실적·뉴스) 가능성을 점검하세요.`,
    });
  }

  // 4. P/C 극단
  if (pcOI !== null && pcOI >= 1.5) {
    anomalies.push({
      icon: "🐻", severity: "high",
      title: `풋 편중 극단 → P/C(OI) ${pcOI}`,
      detail: "미결제약정이 풋에 크게 쏠려 있습니다. 강한 하락 베팅이거나 대규모 헤지 움직임일 수 있습니다. 뉴스로 방향성을 확인하세요.",
    });
  } else if (pcOI !== null && pcOI <= 0.5) {
    anomalies.push({
      icon: "🐂", severity: "mid",
      title: `콜 편중 극단 → P/C(OI) ${pcOI}`,
      detail: "미결제약정이 콜에 과도하게 쏠려 있습니다. 낙관적 투기 포지션이 과열됐을 수 있어 변동성 확대에 유의하세요.",
    });
  }

  // 5. 실적 임박
  if (earnings && earnings.dte >= 0 && earnings.dte <= Math.max(target.dte, 35)) {
    anomalies.push({
      icon: "📅", severity: "high",
      title: `실적 발표 임박 → ${earnings.date} (D-${earnings.dte})`,
      detail: `${earnings.dte}일 뒤 실적 발표가 예상됩니다. 발표 직후 'IV 크러시'로 방향이 맞아도 옵션 매수자가 손실을 볼 수 있습니다.`,
    });
  }

  // 6. IV 백워데이션
  if (term.length >= 2) {
    const nearIV = term[0].iv, farIV = term[term.length - 1].iv;
    if (nearIV && farIV && nearIV / farIV >= 1.3) {
      anomalies.push({
        icon: "⏳", severity: "mid",
        title: `변동성 백워데이션 → 근월 ${nearIV.toFixed(0)}% vs 원월 ${farIV.toFixed(0)}%`,
        detail: `가까운 만기 IV가 먼 만기보다 ${(nearIV / farIV).toFixed(2)}배 높습니다. 단기에 집중된 불안·이벤트 기대가 큰 상태입니다.`,
      });
    }
  }

  return {
    ticker,
    spot: Math.round(spot * 100) / 100,
    hv20: Math.round(hv20 * 10) / 10,
    generatedAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    nExp: perExp.length,
    totCOI, totPOI, totCVol, totPVol,
    pcOI, pcVol,
    score, scoreLabel, scoreColor,
    buckets, target, walls, skew, term,
    anomalies, earnings,
  };
}
