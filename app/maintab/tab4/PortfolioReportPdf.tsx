"use client";
import {
  Document, Page, Text, View, StyleSheet, Font, Svg, Circle, Image, Polygon, Line,
} from "@react-pdf/renderer";
Font.register({
  family: "Pretendard",
  fonts: [
    { src: "https://cdn.jsdelivr.net/gh/fonts-archive/Pretendard/Pretendard-Regular.otf", fontWeight: "normal" },
    { src: "https://cdn.jsdelivr.net/gh/fonts-archive/Pretendard/Pretendard-Bold.otf", fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => [word]);
export type ReportSectionKey = "stress" | "health" | "taxIncome" | "holdings";
export type ReportMode = "normal" | "easy";
export const OPTIONAL_SECTIONS: { key: ReportSectionKey; label: string }[] = [
  { key: "health", label: "PB 권고사항" },
  { key: "stress", label: "스트레스 테스트 결과" },
  { key: "taxIncome", label: "금융소득종합과세 분석" },
  { key: "holdings", label: "보유 종목 상세" },
];
export interface ReportSectionToggles {
  stress: boolean; health: boolean; taxIncome: boolean; holdings: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = any;
interface PortfolioSide {
  label: string;
  quantResult?: AnyResult;
  stressResult?: AnyResult;
  healthResult?: AnyResult;
  enrichedAssets?: AnyResult[];
  afterTaxReturn?: number | null;
  portfolioIssueSummary?: string;
}
export interface ConsultationProposalSection {
  title: string;
  content: string;
  pbComment?: string;
}
export interface ConsultationProposalSections {
  approvedAt?: string;
  consultationBackground: ConsultationProposalSection;
  aiRationale: ConsultationProposalSection;
  existingPortfolioDiagnosis: ConsultationProposalSection;
  newPortfolioRationale: ConsultationProposalSection;
}
export interface PortfolioReportProps {
  customerName: string; pbName?: string; reportDate: string;
  sections: ReportSectionToggles;
  left: PortfolioSide | null; right: PortfolioSide | null;
  leftTaxSummary?: AnyResult | null; rightTaxSummary?: AnyResult | null;
  marginalTaxRate?: number; aiComment?: string; mode?: ReportMode;
  consultationProposal?: ConsultationProposalSections;
}
const GLOSSARY: Record<string, string> = {
  "세후 수익률": "세금을 뺀 후 실제로 손에 남는 수익률입니다.",
  "MDD": "투자 기간 중 가장 크게 떨어진 손실 비율입니다. 숫자가 클수록 하락 위험이 큽니다.",
  "샤프 비율": "위험 대비 얼마나 수익을 냈는지 보여주는 지표입니다. 높을수록 효율적인 투자입니다.",
  "소르티노 비율": "하락할 때의 위험만 따로 고려해 수익 효율을 계산한 지표입니다. 높을수록 좋습니다.",
  "변동성": "가격이 얼마나 크게 오르내리는지 나타냅니다. 숫자가 클수록 가격 변화가 심합니다.",
  "베타": "시장이 1% 움직일 때 내 포트폴리오가 얼마나 따라 움직이는지를 나타냅니다.",
  "금융소득종합과세": "이자·배당 등 금융소득이 연 2천만원을 넘으면 다른 소득과 합산되어 높은 세율로 세금이 매겨지는 제도입니다.",
  "이자소득": "예금이나 채권 등에서 발생하는 이자 수익입니다.",
  "배당소득": "주식을 보유함으로써 회사로부터 받는 수익입니다.",
  "순 양도소득": "주식·부동산 등을 매도할 때 발생하는 매매 차익입니다.",
  "한계세율": "소득이 조금 더 늘어날 때 그 늘어난 부분에 적용되는 세율입니다.",
};
function buildOrderedTerms(sections: ReportSectionToggles, mode: ReportMode) {
  if (mode !== "easy") return [];
  const ordered = ["세후 수익률", "MDD", "샤프 비율", "소르티노 비율", "변동성", "베타"];
  if (sections.taxIncome) ordered.push("금융소득종합과세", "이자소득", "배당소득", "순 양도소득", "한계세율");
  return ordered.filter(t => GLOSSARY[t]).map((term, i) => ({ term, desc: GLOSSARY[term], marker: `※${i + 1}` }));
}
function makeMarkerTracker(terms: { term: string; desc: string; marker: string }[]) {
  const used = new Set<string>();
  const usedList: { term: string; desc: string; marker: string }[] = [];
  function withMarker(text: string): string {
    if (!terms.length) return text;
    const matched = terms.find(t => text.includes(t.term) && !used.has(t.term));
    if (!matched) return text;
    used.add(matched.term); usedList.push(matched);
    return text + matched.marker;
  }
  return { withMarker, getUsedTerms: () => usedList };
}
const NAVY = "#1428A0"; const BLUE = "#3457B2"; const GOLD = "#B8975A";
const GRAY = "#64748B"; const LIGHT = "#F1F5F9"; const BLACK = "#1E293B";
const RED = "#DC2626"; const AMBER = "#D97706"; const GREENC = "#0F766E"; const BLUE_DOWN = "#2563EB";
const BORDER = "#E2E8F0";
const ASSET_CLASS_COLOR_MAP: Record<string, string> = {
  국내주식: NAVY, 해외주식: "#3457B2", 국내채권: "#7C93D6", 해외채권: "#0F766E",
  금: GOLD, 리츠: "#8C8C8C", 현금: "#94A3B8", 달러: "#6B8CD6", 암호화폐: "#A9B4E3",
};
const DONUT_FALLBACK = ["#1428A0", "#3457B2", "#7C93D6", "#0F766E", GOLD, "#94A3B8"];
function getAssetColor(cls: string, idx: number) {
  return ASSET_CLASS_COLOR_MAP[cls] ?? DONUT_FALLBACK[idx % DONUT_FALLBACK.length];
}
function makeStyles(easy: boolean) {
  const fs = (n: number) => n * 1.35;
  return StyleSheet.create({
    page: { fontFamily: "Pretendard", fontSize: fs(9), color: BLACK, paddingTop: easy ? 30 : 26, paddingBottom: easy ? 48 : 42, paddingHorizontal: easy ? 34 : 30, lineHeight: easy ? 1.65 : 1.45 },
    topBar: { height: 8, backgroundColor: NAVY, marginTop: easy ? -30 : -26, marginHorizontal: easy ? -34 : -30, marginBottom: 20 },
    logoRow: { marginBottom: 18, paddingTop: 4 },
    wordmarkMain: { fontSize: fs(15), fontWeight: "bold", color: NAVY, letterSpacing: 0.5 },
    wordmarkSub: { fontSize: fs(8), fontWeight: "bold", color: NAVY, letterSpacing: 3, marginTop: 1 },
    bannerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
    bannerTitle: { fontSize: fs(16), fontWeight: "bold", color: NAVY, lineHeight: 1.2 },
    bannerSub: { fontSize: fs(7), color: GRAY, marginTop: 2, letterSpacing: 1, textTransform: "uppercase" },
    bannerInfoRight: { alignItems: "flex-end" },
    bannerInfoName: { fontSize: fs(10), fontWeight: "bold", color: BLACK },
    bannerInfoDate: { fontSize: fs(7.5), color: GRAY, marginTop: 2 },
    bannerHr: { borderBottomWidth: 1.5, borderBottomColor: GOLD, marginBottom: 12 },
    bannerDesc: { fontSize: fs(7.5), color: GRAY, lineHeight: 1.6, marginBottom: 4 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", marginTop: 18, marginBottom: 4 },
    sectionNum: { fontSize: fs(7.5), fontWeight: "bold", color: "#FFFFFF", width: easy ? 18 : 15 },
    sectionTitle: { fontSize: fs(12), fontWeight: "bold", color: NAVY, letterSpacing: 0 },
    sectionHr: { borderBottomWidth: 1, borderBottomColor: BORDER, marginTop: 7, marginBottom: 10 },
    twoCol: { flexDirection: "row", gap: 14 },
    col: { flex: 1 },
    colLabel: { fontSize: fs(8.5), fontWeight: "bold", color: NAVY, paddingBottom: 4, marginBottom: 8, borderBottomWidth: 1.5, borderBottomColor: GOLD },
    colLabelNew: { fontSize: fs(8.5), fontWeight: "bold", color: GOLD, paddingBottom: 4, marginBottom: 8, borderBottomWidth: 1.5, borderBottomColor: GOLD },
    colNew: { flex: 1 },
    insightBox: { backgroundColor: LIGHT, borderRadius: 3, padding: 8, marginBottom: 10 },
    insightText: { fontSize: fs(7.8), color: BLACK, lineHeight: 1.6 },
    aiCommentBox: { borderRadius: 4, padding: 10, marginTop: 10, marginBottom: 4, borderWidth: 1, borderColor: GOLD, backgroundColor: "#FFFDF5" },
    aiCommentLabel: { fontSize: fs(7), fontWeight: "bold", color: GOLD, marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" },
    aiCommentText: { fontSize: fs(8), color: BLACK, lineHeight: 1.7 },
    consultationBox: { borderRadius: 4, padding: 10, marginTop: 6, marginBottom: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: LIGHT },
    consultationTitle: { fontSize: fs(8.5), fontWeight: "bold", color: NAVY, marginBottom: 4, paddingBottom: 3, borderBottomWidth: 0.5, borderBottomColor: BORDER },
    consultationText: { fontSize: fs(7.8), color: BLACK, lineHeight: 1.7 },
    consultationSpacer: { marginBottom: 8 },
    consultationPbComment: { fontSize: fs(7.5), color: GOLD, marginTop: 5 },
    consultationApprovedAt: { fontSize: fs(7), color: GRAY, marginTop: 4, marginBottom: 8, textAlign: "right" },
    deltaIntro: { fontSize: fs(7.5), color: GRAY, marginBottom: 8 },
    deltaRow: { flexDirection: "row", gap: 8 },
    deltaCard: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 9 },
    deltaLabel: { fontSize: fs(7), color: GRAY, marginBottom: 4 },
    deltaCompareRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 5 },
    deltaSmall: { fontSize: fs(7.5), color: GRAY, textDecoration: "line-through" },
    deltaArrow: { fontSize: fs(7), color: GRAY, marginHorizontal: 4 },
    deltaBig: { fontSize: fs(11.5), fontWeight: "bold", color: NAVY, letterSpacing: -0.2 },
    deltaChange: { fontSize: fs(7.5), fontWeight: "bold", marginTop: 3 },
    miniBarTrack: { height: 4, backgroundColor: LIGHT, borderRadius: 2, marginBottom: 2 },
    miniBarFillOld: { height: 4, backgroundColor: "#CBD5E1", borderRadius: 2 },
    miniBarFillNew: { height: 4, backgroundColor: NAVY, borderRadius: 2 },
    barLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
    barTrack: { height: easy ? 7 : 5, backgroundColor: LIGHT, borderRadius: 2.5 },
    barFill: { height: easy ? 7 : 5, backgroundColor: BLUE, borderRadius: 2.5 },
    recRow: { flexDirection: "row", marginBottom: 9, paddingBottom: 7, borderBottomWidth: 0.5, borderBottomColor: BORDER, alignItems: "flex-start" },
    recLabel: { fontSize: fs(7.8), fontWeight: "bold" },
    recDetail: { fontSize: fs(7.3), color: GRAY, lineHeight: 1.5, marginTop: 1 },
    recComment: { fontSize: fs(7), color: GREENC, lineHeight: 1.5, marginTop: 2 },
    table: { borderWidth: 1, borderColor: BORDER, borderRadius: 3, overflow: "hidden" },
    tableRowHeader: { flexDirection: "row", backgroundColor: NAVY },
    tableRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: BORDER },
    tableRowAlt: { flexDirection: "row", borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: LIGHT },
    th: { flex: 1, fontSize: fs(7), fontWeight: "bold", color: "#FFFFFF", padding: 4 },
    td: { flex: 1, fontSize: fs(7), padding: 4, color: BLACK },
    paragraph: { fontSize: fs(8.3), color: BLACK, marginBottom: 6, lineHeight: 1.55 },
    small: { fontSize: fs(7.5), color: GRAY },
    footer: { position: "absolute", bottom: 20, left: easy ? 34 : 30, right: easy ? 34 : 30, flexDirection: "row", justifyContent: "space-between", fontSize: fs(7), color: GRAY, borderTopWidth: 1, borderTopColor: GOLD, paddingTop: 6 },
    glossaryBox: { marginTop: 16, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10 },
    glossaryTitle: { fontSize: fs(8), fontWeight: "bold", color: NAVY, marginBottom: 6 },
    glossaryRow: { flexDirection: "row", marginBottom: 4 },
    glossaryMarker: { fontSize: fs(7.5), fontWeight: "bold", color: NAVY, width: 28 },
    glossaryTerm: { fontSize: fs(7.5), fontWeight: "bold", color: BLACK, marginRight: 4 },
    glossaryDesc: { fontSize: fs(7.5), color: GRAY, flex: 1, lineHeight: 1.5 },
  });
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}
function fmtPctSigned(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "-";
  const v = n * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%p`;
}
function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || isNaN(n)) return "-";
  return n.toFixed(digits);
}
function fmtWon(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "-";
  const eok = Math.floor(Math.abs(n) / 1e8);
  const man = Math.round((Math.abs(n) % 1e8) / 1e4);
  const sign = n < 0 ? "-" : "";
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${sign}${eok}억원`;
  return `${sign}${man.toLocaleString()}만원`;
}
const STRESS_LABELS = [
  { key: "scenario1", period: "연준 양적긴축 쇼크 (2018)" },
  { key: "scenario3", period: "팬데믹 블랙스완 쇼크 (2020)" },
  { key: "scenario2", period: "러-우 원자재 공급망 위기 (2022)" },
];
function PdfHealthRadar({
  items,
  badge,
}: {
  items: { key: string; label: string; score: number }[];
  badge?: string;
}) {
  const gradeColor = badge === "Sell" ? "#DC2626" : badge === "Hold" ? "#0F766E" : "#D97706";
  const cx = 100;
  const cy = 95;
  const maxR = 70;
  const n = items.length;
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointFor = (i: number, ratio: number) => {
    const a = angleFor(i);
    return { x: cx + Math.cos(a) * maxR * ratio, y: cy + Math.sin(a) * maxR * ratio };
  };
  const dataPoints = items.map((it, i) => pointFor(i, Math.max(it.score, 0.05) / 2));
  const dataPolygon = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const gridRings = [0.33, 0.66, 1].map((ratio) =>
    items.map((_, i) => pointFor(i, ratio)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
  );
  return (
    <Svg width="200" height="210" viewBox="0 0 200 210">
      {gridRings.map((poly, i) => (
        <Polygon key={i} points={poly} stroke="#CBD5E1" strokeWidth={0.6} fill="none" />
      ))}
      {items.map((_, i) => {
        const p = pointFor(i, 1);
        return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#CBD5E1" strokeWidth={0.6} />;
      })}
      <Polygon points={dataPolygon} stroke={gradeColor} strokeWidth={1.4} fill={gradeColor} fillOpacity={0.22} />
      {items.map((it, i) => {
        const labelPos = pointFor(i, 1.28);
        return (
          <Text
            key={it.key}
            x={labelPos.x}
            y={labelPos.y}
            style={{ fontSize: 6.5, fontFamily: "Pretendard", fill: "#475569", fontWeight: "bold" }}
            textAnchor="middle"
          >
            {it.label}
          </Text>
        );
      })}
    </Svg>
  );
}
function SectionHeader({ num, title, styles }: { num: string; title: string; styles: ReturnType<typeof makeStyles> }) {
  const sz = (styles.sectionNum as AnyResult).width ?? 15;
  return (
    <View wrap={false} minPresenceAhead={70}>
      <View style={styles.sectionHeaderRow}>
        <View style={{ width: sz, height: sz, borderRadius: sz / 2, backgroundColor: NAVY, marginRight: 7, alignItems: "center", justifyContent: "center", paddingTop: 1.5 }}>
          <Text style={{ fontSize: (styles.sectionNum as AnyResult).fontSize * 0.85, fontWeight: "bold", color: "#FFFFFF" }}>{num}</Text>
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionHr} />
    </View>
  );
}
function DeltaCard({ label, leftDisplay, rightDisplay, deltaText, isGood, leftRaw, rightRaw, cap, styles, invertArrow }: {
  label: string; leftDisplay: string; rightDisplay: string; deltaText: string; isGood: boolean | null;
  leftRaw: number | null; rightRaw: number | null; cap: number; styles: ReturnType<typeof makeStyles>; invertArrow?: boolean;
}) {
  const lW = leftRaw != null ? Math.max(2, Math.min(100, (Math.abs(leftRaw) / cap) * 100)) : 0;
  const rW = rightRaw != null ? Math.max(2, Math.min(100, (Math.abs(rightRaw) / cap) * 100)) : 0;
  return (
    <View style={styles.deltaCard} wrap={false}>
      <Text style={styles.deltaLabel}>{label}</Text>
      <View style={styles.deltaCompareRow}>
        <Text style={styles.deltaSmall}>{leftDisplay}</Text>
        <Text style={styles.deltaArrow}>→</Text>
        <Text style={styles.deltaBig}>{rightDisplay}</Text>
      </View>
      <View style={styles.miniBarTrack}><View style={[styles.miniBarFillOld, { width: `${lW}%` }]} /></View>
      <View style={styles.miniBarTrack}><View style={[styles.miniBarFillNew, { width: `${rW}%` }]} /></View>
      {isGood !== null && (
        <Text style={[styles.deltaChange, { color: isGood ? RED : BLUE_DOWN }]}>
          {invertArrow ? (isGood ? "▼" : "▲") : (isGood ? "▲" : "▼")} {deltaText}
        </Text>
      )}
    </View>
  );
}
function buildOverviewInsight(rd: number | null, md: number | null): string | null {
  if (rd == null || md == null) return null;
  const ru = rd > 0.0005; const mu = md > 0.0005;
  if (ru && !mu) return "기대수익률 개선과 동시에 최대낙폭(MDD)도 축소되어, 위험 대비 효율이 함께 개선된 리밸런싱입니다.";
  if (ru && mu) return "기대수익률은 개선되었으나 최대낙폭(MDD)도 함께 확대되어, 수익성과 안정성 사이의 트레이드오프가 발생했습니다.";
  if (!ru && mu) return "기대수익률이 낮아지고 최대낙폭(MDD)도 확대되어, 신규 포트폴리오의 리스크 요인에 대한 추가 검토가 필요합니다.";
  return "기대수익률은 낮아졌지만 최대낙폭(MDD)이 축소되어, 안정성을 우선한 조정으로 해석됩니다.";
}
function OverviewDeltaPanel({ left, right, styles, withMarker }: {
  left: PortfolioSide | null; right: PortfolioSide | null;
  styles: ReturnType<typeof makeStyles>; withMarker: (t: string) => string;
}) {
  if (!left || !right) return null;
  const lR = left.afterTaxReturn ?? left.quantResult?.performance?.afterTaxExpectedReturn;
  const rR = right.afterTaxReturn ?? right.quantResult?.performance?.afterTaxExpectedReturn;
  const lM = Math.abs(left.quantResult?.risk?.mdd ?? 0);
  const rM = Math.abs(right.quantResult?.risk?.mdd ?? 0);
  const lS = left.quantResult?.performance?.sharpeRatio;
  const rS = right.quantResult?.performance?.sharpeRatio;
  const rd = lR != null && rR != null ? rR - lR : null;
  const md = lM != null && rM != null ? rM - lM : null;
  const sd = lS != null && rS != null ? rS - lS : null;
  const insight = buildOverviewInsight(rd, md);
  return (
    <View>
      <Text style={styles.deltaIntro}>기존 포트폴리오 대비 신규 제안 포트폴리오의 핵심 변화입니다. (분석 시점 기준 시뮬레이션 수치이며 향후 실제 수익을 보장하지 않습니다)</Text>
      {insight && <View style={styles.insightBox}><Text style={styles.insightText}>{insight}</Text></View>}
      <View style={styles.deltaRow}>
        <DeltaCard label={withMarker("세후 수익률")} leftDisplay={fmtPct(lR)} rightDisplay={fmtPct(rR)} deltaText={rd != null ? fmtPctSigned(rd) : "-"} isGood={rd != null ? rd >= 0 : null} leftRaw={lR ?? null} rightRaw={rR ?? null} cap={0.3} styles={styles} />
        <DeltaCard label={withMarker("최대 낙폭(MDD)")} leftDisplay={fmtPct(lM)} rightDisplay={fmtPct(rM)} deltaText={md != null ? fmtPctSigned(md) : "-"} isGood={md != null ? md <= 0 : null} leftRaw={lM} rightRaw={rM} cap={0.6} styles={styles} invertArrow />
        <DeltaCard label={withMarker("샤프 비율")} leftDisplay={fmtNum(lS)} rightDisplay={fmtNum(rS)} deltaText={sd != null ? `${sd >= 0 ? "+" : ""}${sd.toFixed(2)}` : "-"} isGood={sd != null ? sd >= 0 : null} leftRaw={lS ?? null} rightRaw={rS ?? null} cap={3} styles={styles} />
      </View>
    </View>
  );
}
function MetricBars({ quantResult, afterTaxReturn, withMarker, styles }: {
  quantResult: AnyResult; afterTaxReturn?: number | null;
  withMarker: (t: string) => string; styles: ReturnType<typeof makeStyles>;
}) {
  if (!quantResult) return <Text style={styles.small}>데이터 없음</Text>;
  const items = [
    { label: "세후 수익률", raw: afterTaxReturn ?? quantResult.performance?.afterTaxExpectedReturn, pct: true, cap: 0.3 },
    { label: "샤프 비율", raw: quantResult.performance?.sharpeRatio, pct: false, cap: 3 },
    { label: "소르티노 비율", raw: quantResult.performance?.sortinoRatio, pct: false, cap: 4 },
    { label: "최대 낙폭(MDD)", raw: Math.abs(quantResult.risk?.mdd ?? 0), pct: true, cap: 0.6 },
    { label: "포트폴리오 변동성", raw: quantResult.risk?.volatility, pct: true, cap: 0.8 },
    { label: "시장 베타", raw: quantResult.sensitivity?.beta, pct: false, cap: 2 },
  ];
  return (
    <View>
      {items.map((it) => {
        const val = it.raw ?? 0;
        const w = Math.max(2, Math.min(100, (val / it.cap) * 100));
        return (
          <View key={it.label} style={{ marginBottom: 7 }} wrap={false}>
            <View style={styles.barLabelRow}>
              <Text style={{ fontSize: (styles.small as AnyResult).fontSize, color: GRAY }}>{withMarker(it.label)}</Text>
              <Text style={{ fontSize: (styles.colLabel as AnyResult).fontSize, fontWeight: "bold", color: NAVY, letterSpacing: -0.2, minWidth: 46, textAlign: "right" }}>{it.pct ? fmtPct(val) : fmtNum(val)}</Text>
            </View>
            <View style={styles.barTrack}><View style={[styles.barFill, { width: `${w}%` }]} /></View>
          </View>
        );
      })}
    </View>
  );
}
function aggregateAssetClass(assets: AnyResult[] | undefined) {
  const map = new Map<string, number>(); let total = 0;
  (assets || []).forEach((a) => {
    const cls = a.asset_class || a.productType || "기타";
    const base = a.current_price && a.amount ? a.current_price * a.amount : 0;
    const val = a.current_value != null ? a.current_value : base;
    map.set(cls, (map.get(cls) || 0) + val); total += val;
  });
  return Array.from(map.entries())
    .map(([cls, val]) => ({ cls, val, pct: total > 0 ? val / total : 0 }))
    .sort((a, b) => b.val - a.val).slice(0, 7);
}
function DonutChart({ assets, styles }: { assets: AnyResult[] | undefined; styles: ReturnType<typeof makeStyles> }) {
  const data = aggregateAssetClass(assets);
  if (!data.length) return <Text style={styles.small}>데이터 없음</Text>;
  const size = 84; const sw = 13; const r = size / 2 - sw / 2 - 2;
  const cx = size / 2; const cy = size / 2; const circ = 2 * Math.PI * r;
  const gap = data.length > 1 ? 1.5 : 0; let cum = 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }} wrap={false}>
      <View style={{ width: size, height: size, position: "relative" }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle cx={cx} cy={cy} r={r - sw / 2 + 1} fill="#FFFFFF" />
          {data.map((d, i) => {
            const raw = d.pct * circ;
            const seg = Math.min(Math.max(raw - gap, 0.6), circ - 0.6);
            const gp = Math.max(circ - seg, 0.6);
            const sa = cum * 360; cum += d.pct;
            return <Circle key={d.cls} cx={cx} cy={cy} r={r} fill="none" stroke={getAssetColor(d.cls, i)} strokeWidth={sw} strokeDasharray={`${seg} ${gp}`} transform={`rotate(${sa - 90}, ${cx}, ${cy})`} />;
          })}
        </Svg>
        <View style={{ position: "absolute", top: 0, left: 0, width: size, height: size, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 10, fontWeight: "bold", color: NAVY }}>{data.length}개</Text>
          <Text style={{ fontSize: 5.5, color: GRAY }}>자산군</Text>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {data.map((d, i) => (
          <View key={d.cls} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: getAssetColor(d.cls, i), marginRight: 4 }} />
            <Text style={{ fontSize: 7, color: BLACK }}>{d.cls} · {fmtPct(d.pct)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
function buildDivInsight(la: AnyResult[] | undefined, ra: AnyResult[] | undefined): string {
  const lc = aggregateAssetClass(la).length; const rc = aggregateAssetClass(ra).length;
  if (rc > lc) return `자산군 수가 ${lc}개에서 ${rc}개로 늘어나며 분산투자 효과가 강화되었습니다.`;
  if (rc < lc) return `자산군 수가 ${lc}개에서 ${rc}개로 줄어들어, 집중도 변화에 대한 관찰이 필요합니다.`;
  return `자산군 수는 ${lc}개로 동일하게 유지되었습니다.`;
}
type HealthItem = { key: string; label: string; score: number; detail: string };
const RISK_COMMENTS: Record<string, string> = {
  "단일 종목 집중도": "특정 종목 집중은 단기 수익 기회가 될 수 있으며, 분산 편입을 병행하면 리스크를 효과적으로 관리할 수 있습니다.",
  "단일 섹터 집중도": "섹터 집중도가 높으나, 해당 섹터의 성장성이 유효한 구간에서는 수익 극대화에 유리할 수 있습니다.",
  "변동성": "변동성이 높으나 장기 보유 시 변동성은 수익 기회로 전환될 수 있으며, 방어 자산 편입으로 완화 가능합니다.",
  "최대낙폭": "최대 낙폭은 과거 최악 시나리오 기준으로, 실제 운용 환경에서는 분산 효과로 손실 폭이 축소될 수 있습니다.",
  "분산도": "분산 효과 개선을 위해 자산군 추가 편입을 검토해 드릴 수 있습니다.",
  "샤프": "샤프 비율 개선을 위한 포트폴리오 재편을 담당 PB와 함께 검토해 드립니다.",
  "세금": "세후 수익 구조 최적화를 위한 절세 전략을 별도로 안내해 드립니다.",
};
function getRiskComment(label: string): string {
  const matched = Object.entries(RISK_COMMENTS).find(([k]) => label.includes(k));
  return matched ? matched[1] : "담당 PB와 상담을 통해 포트폴리오 조정 방안을 검토해 드립니다.";
}
function cleanDetail(text: string | undefined): string {
  if (!text) return "";
  return text.trim();
}
function PBRecommendationPair({ left, right, styles }: {
  left: PortfolioSide | null; right: PortfolioSide | null; styles: ReturnType<typeof makeStyles>;
}) {
  const getBadge = (score: number) => {
    if (score === 0) return { label: "위험", color: RED };
    if (score === 1) return { label: "주의", color: AMBER };
    return { label: "양호", color: GREENC };
  };
  const getAllItems = (side: PortfolioSide | null): HealthItem[] => {
    if (!side?.healthResult) return [];
    return ((side.healthResult.items ?? []) as HealthItem[])
      .sort((a, b) => a.score - b.score).slice(0, 7);
  };
  const leftItems = getAllItems(left);
  const rightItems = getAllItems(right);
  const leftKeys = leftItems.map(it => it.key);
  const rightSorted = [
    ...rightItems.filter(it => leftKeys.includes(it.key)).sort((a, b) => leftKeys.indexOf(a.key) - leftKeys.indexOf(b.key)),
    ...rightItems.filter(it => !leftKeys.includes(it.key)),
  ];
  const renderItems = (items: HealthItem[]) => {
    if (!items.length) return <Text style={styles.small}>항목 없음</Text>;
    return (
      <View>
        {items.map((it, i) => {
          const badge = getBadge(it.score);
          return (
            <View key={it.key ?? i} style={styles.recRow} wrap={false}>
              <View style={{
                width: 32, height: 15,
                backgroundColor: badge.color,
                borderRadius: 3,
                marginRight: 6,
                marginTop: 1,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
              }}>
               <Text style={{ fontSize: 6.5, fontWeight: "bold", color: "#FFFFFF", lineHeight: 1 }}>{badge.label}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.recLabel, { color: badge.color }]}>{it.label}</Text>
                {it.detail ? <Text style={styles.recDetail}>{cleanDetail(it.detail)}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  };
  const riskItems = rightSorted.filter(it => it.score === 0 || it.score === 1);
  return (
    <View>
      <View style={styles.twoCol}>
        {left?.healthResult && (
          <View style={styles.col}>
            <Text style={styles.colLabel}>{left.label}</Text>
            {renderItems(leftItems)}
          </View>
        )}
        {right?.healthResult && (
          <View style={styles.colNew}>
            <Text style={styles.colLabelNew}>{right.label}</Text>
            {renderItems(rightSorted)}
          </View>
        )}
      </View>
      {right?.healthResult && riskItems.length > 0 && (
        <View style={{ marginTop: 10, padding: 8, borderRadius: 3, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0" }} wrap={false}>
          <Text style={{ fontSize: 6.5, fontWeight: "bold", color: GREENC, marginBottom: 4 }}>신규 포트폴리오 리스크 관리 코멘트</Text>
          {riskItems.map((it, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 3 }}>
              <Text style={{ fontSize: 6.5, fontWeight: "bold", color: GREENC, width: 70, flexShrink: 0 }}>{it.label}</Text>
              <Text style={{ fontSize: 6.5, color: BLACK, flex: 1, lineHeight: 1.5 }}>{getRiskComment(it.label)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
function StressSection({ stressResult, styles }: { stressResult: AnyResult; styles: ReturnType<typeof makeStyles> }) {
  if (!stressResult) return <Text style={styles.small}>데이터 없음</Text>;
  return (
    <View>
      {STRESS_LABELS.map(({ key, period }) => {
        const sc = stressResult[key]; if (!sc) return null;
        const dm = new Map<string, { name: string; shock: number; contribution: number }>();
        if (Array.isArray(sc.details)) {
          for (const d of sc.details) {
            const p = dm.get(d.name);
            if (p) { p.shock = (p.shock ?? 0) + (d.shock ?? d.contribution ?? 0); p.contribution = (p.contribution ?? 0) + (d.contribution ?? 0); }
            else dm.set(d.name, { ...d });
          }
        }
        const top = Array.from(dm.values()).sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0)).slice(0, 3);
        return (
          <View key={key} style={{ marginBottom: 8 }} wrap={false}>
            <Text style={{ fontSize: (styles.small as AnyResult).fontSize, fontWeight: "bold", color: BLACK }}>{period}</Text>
            <Text style={{ fontSize: (styles.colLabel as AnyResult).fontSize, fontWeight: "bold", color: sc.lossRate < 0 ? RED : GREENC }}>
              시뮬레이션 기준 {sc.lossRate < 0 ? "하락폭" : "상승폭"} 약 {fmtPct(Math.abs(sc.lossRate))} 수준 ({fmtWon(sc.lossAmount)})
            </Text>
            {top.length > 0 && (
              <View style={{ marginTop: 2 }}>
                {top.map((d, idx) => (
                  <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 6.5, color: GRAY }}>· {d.name ?? "-"}</Text>
                    <Text style={{ fontSize: 6.5, color: (d.contribution ?? 0) < 0 ? RED : GREENC }}>{fmtPct(d.contribution ?? 0)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
      {Array.isArray(stressResult.riskTypes) && stressResult.riskTypes.length > 0 && (
        <Text style={styles.small}>주요 리스크 유형: {stressResult.riskTypes.join(", ")}</Text>
      )}
    </View>
  );
}
function TaxIncomeSection({ taxSummary, marginalTaxRate, withMarker, styles }: {
  taxSummary: AnyResult; marginalTaxRate?: number;
  withMarker: (t: string) => string; styles: ReturnType<typeof makeStyles>;
}) {
  if (!taxSummary) return <Text style={styles.small}>데이터 없음</Text>;
  const items = [
    { label: "총 금융소득", value: fmtWon(taxSummary.totalFinancialIncome) },
    { label: "이자소득", value: fmtWon(taxSummary.interestIncome) },
    { label: "배당소득", value: fmtWon(taxSummary.dividendIncome) },
    { label: "순 양도소득", value: fmtWon(taxSummary.netCapitalGains) },
    { label: "최종 결정세액", value: fmtWon(taxSummary.finalTax) },
  ];
  if (marginalTaxRate != null) items.push({ label: "적용 한계세율(소득세)", value: `${(marginalTaxRate * 100).toFixed(0)}%` });
  const over = (taxSummary.totalFinancialIncome ?? 0) > 20_000_000;
  return (
    <View>
      <Text style={{ fontSize: (styles.small as AnyResult).fontSize, color: GRAY, marginBottom: 6 }}>
        {withMarker("금융소득종합과세")} 현황
      </Text>
      {over && <Text style={[styles.paragraph, { color: RED, fontWeight: "bold" }]}>총 금융소득이 2천만원을 초과해 고객입니다.</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
        {items.map((it) => (
          <View key={it.label} style={{ width: "47.5%", borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 6 }} wrap={false}>
            <Text style={{ fontSize: (styles.small as AnyResult).fontSize, color: GRAY, marginBottom: 2 }}>{withMarker(it.label)}</Text>
            <Text style={{ fontSize: (styles.deltaBig as AnyResult).fontSize * 0.9, fontWeight: "bold", color: NAVY }}>{it.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
function HoldingsTable({ assets, styles }: { assets: AnyResult[]; styles: ReturnType<typeof makeStyles> }) {
  if (!assets || assets.length === 0) return <Text style={styles.small}>보유 종목 없음</Text>;
  const total = assets.reduce((s, a) => {
    const b = a.current_price && a.amount ? a.current_price * a.amount : 0;
    return s + (a.current_value != null ? a.current_value : b);
  }, 0);
  return (
    <View style={styles.table}>
      <View style={styles.tableRowHeader} fixed>
        <Text style={[styles.th, { flex: 2 }]}>종목명</Text>
        <Text style={styles.th}>자산군</Text>
        <Text style={styles.th}>수량</Text>
        <Text style={styles.th}>매입가</Text>
        <Text style={styles.th}>현재가</Text>
        <Text style={styles.th}>손익률</Text>
        <Text style={styles.th}>비중</Text>
      </View>
      {assets.slice(0, 25).map((a, i) => {
        const b = a.current_price && a.amount ? a.current_price * a.amount : 0;
        const v = a.current_value != null ? a.current_value : b;
        const w = total > 0 ? v / total : 0;
        const rp = a.buy_price && a.current_price ? (a.current_price - a.buy_price) / a.buy_price : null;
        return (
          <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt} wrap={false}>
            <Text style={[styles.td, { flex: 2 }]}>{a.name ?? "-"}</Text>
            <Text style={styles.td}>{a.asset_class ?? "-"}</Text>
            <Text style={styles.td}>{a.amount?.toLocaleString?.() ?? "-"}</Text>
            <Text style={styles.td}>{a.buy_price?.toLocaleString?.() ?? "-"}</Text>
            <Text style={styles.td}>{a.current_price?.toLocaleString?.() ?? "-"}</Text>
            <Text style={[styles.td, { color: rp != null ? (rp >= 0 ? RED : BLUE) : BLACK, fontWeight: "bold" }]}>
              {rp != null ? `${rp >= 0 ? "+" : ""}${(rp * 100).toFixed(1)}%` : "-"}
            </Text>
            <Text style={styles.td}>{fmtPct(w)}</Text>
          </View>
        );
      })}
    </View>
  );
}
function GlossarySection({ terms, styles }: { terms: { term: string; desc: string; marker: string }[]; styles: ReturnType<typeof makeStyles> }) {
  if (!terms.length) return null;
  return (
    <View style={styles.glossaryBox} wrap={false}>
      <Text style={styles.glossaryTitle}>※ 용어 설명</Text>
      {terms.map((t) => (
        <View key={t.term} style={styles.glossaryRow}>
          <Text style={styles.glossaryMarker}>{t.marker}</Text>
          <Text style={styles.glossaryTerm}>{t.term}</Text>
          <Text style={styles.glossaryDesc}>{t.desc}</Text>
        </View>
      ))}
    </View>
  );
}
function PageFooter({ customerName, styles }: { customerName: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{customerName} 고객 포트폴리오 제안서</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}
export function PortfolioReportPdf({
  customerName, pbName, reportDate, sections, left, right,
  leftTaxSummary, rightTaxSummary, marginalTaxRate, aiComment, mode = "normal",
  consultationProposal,
}: PortfolioReportProps) {
  const easy = mode === "easy";
  const styles = makeStyles(easy);
  const terms = buildOrderedTerms(sections, mode);
  const { withMarker, getUsedTerms } = makeMarkerTracker(terms);
  const displayPbName = "김일조";
  const reportTitle = "포트폴리오 제안서";
  let secCount = 0;
  const nextNum = () => String(++secCount).padStart(2, "0");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topBar} />
        <View style={styles.logoRow}>
          <Text style={styles.wordmarkMain}>SAMSUNG</Text>
          <Text style={styles.wordmarkSub}>SECURITIES</Text>
        </View>
        <View style={styles.bannerRow}>
          <View>
            <Text style={styles.bannerTitle}>{reportTitle}</Text>
            <Text style={styles.bannerSub}>PRIVATE BANKING ADVISORY REPORT</Text>
          </View>
          <View style={styles.bannerInfoRight}>
            <Text style={styles.bannerInfoName}>{customerName} 고객님 ㅣ 담당PB: {displayPbName}</Text>
            <Text style={styles.bannerInfoDate}>{reportDate}</Text>
          </View>
        </View>
        <View style={styles.bannerHr} />
        <Text style={styles.bannerDesc}>
          본 제안서는 고객님의 투자 성향 분석 및 포트폴리오 진단 결과를 바탕으로 작성되었습니다.
          {right ? " 현재 포트폴리오와 신규 제안 포트폴리오를 비교 분석한 내용을 담고 있습니다." : ""}
          {easy ? " ※ 표시 용어는 문서 하단 '용어 설명'을 참고해 주세요." : ""}
          {" "}투자에 따른 손익은 투자자 본인에게 귀속되며, 본 자료는 투자 참고용으로만 활용하시기 바랍니다.
        </Text>
        {right && (
          <>
            <SectionHeader num={nextNum()} title="한눈에 보기" styles={styles} />
            <OverviewDeltaPanel left={left} right={right} styles={styles} withMarker={withMarker} />
          </>
        )}
        <SectionHeader num={nextNum()} title="핵심 지표 요약" styles={styles} />
        <View style={[styles.twoCol, { alignItems: "flex-start" }]}>
          <View style={[styles.col, { borderRightWidth: 1, borderRightColor: BORDER, paddingRight: 10, minHeight: easy ? 240 : 190 }]}>
            <Text style={styles.colLabel}>{left?.label ?? "현재 포트폴리오"}</Text>
            <MetricBars quantResult={left?.quantResult} afterTaxReturn={left?.afterTaxReturn} withMarker={withMarker} styles={styles} />
          </View>
          {right && (
            <View style={[styles.colNew, { paddingLeft: 10 }]}>
              <Text style={styles.colLabelNew}>{right.label}</Text>
              <MetricBars quantResult={right.quantResult} afterTaxReturn={right.afterTaxReturn} withMarker={withMarker} styles={styles} />
            </View>
          )}
        </View>
        <Text style={{ fontSize: (styles.small as AnyResult).fontSize, color: GRAY, marginTop: 4, marginBottom: 6 }}>
          * 세후 수익률은 배당·이자소득 세후 기준, 매입가 대비 현재가로 산출됩니다.
        </Text>
        {aiComment && (
          <View style={styles.aiCommentBox} wrap={false}>
            <Text style={styles.aiCommentLabel}>▪ PB 코멘트</Text>
            <Text style={styles.aiCommentText}>{aiComment}</Text>
          </View>
        )}
        {(left?.healthResult?.items || right?.healthResult?.items) && (
          <View wrap={false}>
            <SectionHeader num={nextNum()} title="포트폴리오 건강 진단 비교" styles={styles} />
            <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 10 }}>
              {left?.healthResult?.items && (
                <View style={{ alignItems: "center" }}>
                  <Text style={{ fontSize: 8, fontWeight: "bold", color: NAVY, marginBottom: 4 }}>기존 포트폴리오</Text>
                  <PdfHealthRadar items={left.healthResult.items} badge={left.healthResult.badge} />
                </View>
              )}
              {right?.healthResult?.items && (
                <View style={{ alignItems: "center" }}>
                  <Text style={{ fontSize: 8, fontWeight: "bold", color: NAVY, marginBottom: 4 }}>신규 포트폴리오</Text>
                  <PdfHealthRadar items={right.healthResult.items} badge={right.healthResult.badge} />
                </View>
              )}
            </View>
          </View>
        )}
        {consultationProposal && (
          <>
            <View wrap={false}>
              <SectionHeader num={nextNum()} title="AI 종합 상담 제안" styles={styles} />
              <View style={styles.consultationBox}>
                <Text style={styles.consultationTitle}>{consultationProposal.consultationBackground.title}</Text>
                <Text style={styles.consultationText}>{consultationProposal.consultationBackground.content}</Text>
                {consultationProposal.consultationBackground.pbComment && (
                  <Text style={styles.consultationPbComment}>PB 코멘트: {consultationProposal.consultationBackground.pbComment}</Text>
                )}
              </View>
            </View>
            {(["aiRationale", "existingPortfolioDiagnosis", "newPortfolioRationale"] as const).map((key) => (
              <View key={key} style={styles.consultationBox} wrap={false}>
                <Text style={styles.consultationTitle}>{consultationProposal[key].title}</Text>
                <Text style={styles.consultationText}>{consultationProposal[key].content}</Text>
                {consultationProposal[key].pbComment && (
                  <Text style={styles.consultationPbComment}>PB 코멘트: {consultationProposal[key].pbComment}</Text>
                )}
              </View>
            ))}
            {consultationProposal.approvedAt && (
              <Text style={styles.consultationApprovedAt}>PB 검토 및 승인 완료: {consultationProposal.approvedAt}</Text>
            )}
          </>
        )}
        <SectionHeader num={nextNum()} title="자산군별 비중 분포" styles={styles} />
        {right && <View style={styles.insightBox}><Text style={styles.insightText}>{buildDivInsight(left?.enrichedAssets, right.enrichedAssets)}</Text></View>}
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.colLabel}>{left?.label ?? "현재 포트폴리오"}</Text>
            <DonutChart assets={left?.enrichedAssets} styles={styles} />
          </View>
          {right && (
            <View style={styles.colNew}>
              <Text style={styles.colLabelNew}>{right.label}</Text>
              <DonutChart assets={right.enrichedAssets} styles={styles} />
            </View>
          )}
        </View>
        {sections.health && (left?.healthResult || right?.healthResult) && (
          <>
            <SectionHeader num={nextNum()} title="PB 권고사항" styles={styles} />
            <PBRecommendationPair left={left} right={right} styles={styles} />
          </>
        )}
        {sections.stress && (left?.stressResult || right?.stressResult) && (
          <>
            <SectionHeader num={nextNum()} title="스트레스 테스트 — 3대 위기 시나리오" styles={styles} />
            <Text style={{ fontSize: (styles.small as AnyResult).fontSize, color: GRAY, marginBottom: 8 }}>
              ※ 아래 수치는 과거 유사 위기 상황을 가정한 시뮬레이션 결과이며, 실제 투자 손익 및 향후 수익을 보장하지 않습니다.
            </Text>
            <Text style={{ fontSize: (styles.small as AnyResult).fontSize, color: GRAY, marginBottom: 8 }}>
              ※ 시나리오별 하락폭은 해당 시기 실제 시장 데이터를 현재 포트폴리오 구성 비중에 적용하여 산출한 값입니다.
            </Text>
            <View style={styles.twoCol}>
              {left?.stressResult && <View style={styles.col}><Text style={styles.colLabel}>{left.label}</Text><StressSection stressResult={left.stressResult} styles={styles} /></View>}
              {right?.stressResult && <View style={styles.colNew}><Text style={styles.colLabelNew}>{right.label}</Text><StressSection stressResult={right.stressResult} styles={styles} /></View>}
            </View>
          </>
        )}
        {sections.taxIncome && (leftTaxSummary || rightTaxSummary) && (
          <>
            <SectionHeader num={nextNum()} title="금융소득종합과세 분석" styles={styles} />
            <View style={styles.twoCol}>
              {leftTaxSummary && <View style={styles.col}><Text style={styles.colLabel}>{left?.label ?? "현재"}</Text><TaxIncomeSection taxSummary={leftTaxSummary} marginalTaxRate={marginalTaxRate} withMarker={withMarker} styles={styles} /></View>}
              {rightTaxSummary && <View style={styles.colNew}><Text style={styles.colLabelNew}>{right?.label ?? "신규"}</Text><TaxIncomeSection taxSummary={rightTaxSummary} marginalTaxRate={marginalTaxRate} withMarker={withMarker} styles={styles} /></View>}
            </View>
          </>
        )}
        {sections.holdings && (left?.enrichedAssets?.length || right?.enrichedAssets?.length) && (
          <>
            <SectionHeader num={nextNum()} title="보유 종목 상세" styles={styles} />
            {left?.enrichedAssets && left.enrichedAssets.length > 0 && (
              <><Text style={styles.colLabel}>{left.label}</Text><HoldingsTable assets={left.enrichedAssets} styles={styles} /></>
            )}
            {right?.enrichedAssets && right.enrichedAssets.length > 0 && (
              <View style={[styles.colNew, { marginTop: 12 }]}>
                <Text style={styles.colLabelNew}>{right.label}</Text>
                <HoldingsTable assets={right.enrichedAssets} styles={styles} />
              </View>
            )}
          </>
        )}
        {easy && <GlossarySection terms={getUsedTerms()} styles={styles} />}
        <PageFooter customerName={customerName} styles={styles} />
      </Page>
    </Document>
  );
}