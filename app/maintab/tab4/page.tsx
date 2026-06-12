"use client";

import { useMemo, useState } from "react";
import {
  Sparkles, ShieldCheck, TrendingUp, Landmark, PiggyBank,
  FileText, ArrowRight, BarChart3, RefreshCcw, AlertCircle,
  ChevronRight, CheckCircle2, X, Info
} from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import { usePortfolioResult } from "../PortfolioResultComponents";
import { Metric, ResultCard, ResultGrid } from "../ui";

type BucketType = "자본증식" | "인컴창출" | "위험헷지" | "유동성" | "절세";
type TaxType = "국내주식형" | "해외주식형" | "채권형" | "비과세연금" | "분리과세" | "소득공제";
type ProductType = "펀드" | "랩어카운트";

interface Product {
  id: string; name: string; type: ProductType; riskGrade: number;
  return1Y: number; return3Y: number | null; bucket: BucketType;
  isInstantRedeem: boolean; taxType: TaxType;
  minInvest?: string; fee?: string; desc: string;
  isHighIncomeOnly?: boolean;
  aum?: string; manager?: string; inception?: string; stars?: number;
  strategy?: string; taxBenefit?: string;
  topHoldings?: string[];
}

interface Client {
  riskAppetite: number; targetReturn: number; investmentPeriod: number;
  liquidityRatio: number; isTaxTarget: boolean; isHighIncomeWorker: boolean; age: number;
  monthlyIncome: number; monthlyCashflow: number;
  lumpSumAmount: number; lumpSumTimepoint: number;
  emergencyAmount: number; investableAssets: number;
}

const PRODUCT_DOCS: Record<string, string> = {
  r1: "/docs/wrap-plainvanilla-macro.pdf",
  r2: "/docs/wrap-loomis.pdf",
  r3: "/docs/wrap-4th-industry.pdf",
  r4: "/docs/wrap-fidelity-tech.pdf",
  r5: "/docs/wrap-plainvanilla-china.pdf",
  r6: "/docs/wrap-fine-value.pdf",
  r7: "/docs/wrap-chessley.pdf",
  r8: "/docs/wrap-mmw.pdf",
  f1: "/docs/fund-semiconductor.pdf",
  f2: "/docs/fund-humanoid.pdf",
  f3: "/docs/fund-sp500.pdf",
  f4: "/docs/fund-tdf2050.pdf",
  f5: "/docs/fund-valuelife65.pdf",
  f6: "/docs/fund-dollar-bond.pdf",
  f7: "/docs/fund-valuelife35.pdf",
  f9: "/docs/fund-dividend30.pdf",
  f10: "/docs/fund-short-bond.pdf",
  f11: "/docs/fund-pension.pdf",
  f13: "/docs/fund-bluechip.pdf",
  f14: "/docs/fund-kosdaq-venture.pdf",
};

const PRODUCTS: Product[] = [
  { id:"r1", name:"플레인바닐라 매크로 온앤오프", type:"랩어카운트", riskGrade:1, return1Y:15.99, return3Y:34.16, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"3천만원", fee:"연 1.5%", desc:"미국 ETF 투자, 경기 국면별 주식/채권 비중 전환", manager:"플레인바닐라", strategy:"미국 ETF 중심 투자. 경기 국면 판단에 따라 주식/채권 비중을 동적으로 전환하는 매크로 전략.", taxBenefit:"해외주식 매매차익 22% 분류과세 (종소세 비합산)", topHoldings:["미국 주식 ETF","미국 채권 ETF","글로벌 매크로 자산"] },
  { id:"r2", name:"루미스세일즈 미국 올캡 그로스", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"미국 성장주 장기 투자", manager:"루미스세일즈", strategy:"미국 전 시가총액 성장주 장기 보유. 벤치마크 미추종 액티브 운용.", taxBenefit:"해외주식 매매차익 22% 분류과세", topHoldings:["미국 대형성장주","미국 중소형성장주"] },
  { id:"r3", name:"삼성자산 4차산업 혁신주", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"글로벌 4차산업/IT 핵심 기업 집중 투자", manager:"삼성자산운용", strategy:"AI, 반도체, 클라우드 등 4차산업 핵심 기업 집중 투자.", taxBenefit:"해외주식 매매차익 22% 분류과세", topHoldings:["글로벌 IT 대형주","테크 혁신 기업"] },
  { id:"r4", name:"피델리티 미국 테크", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"글로벌 기술 혁신 기업 집중 투자", manager:"피델리티", strategy:"미국 및 글로벌 기술 혁신 기업 중심 액티브 운용.", taxBenefit:"해외주식 매매차익 22% 분류과세", topHoldings:["미국 빅테크 주식","글로벌 반도체/소프트웨어"] },
  { id:"r5", name:"플레인바닐라 테크차이나", type:"랩어카운트", riskGrade:1, return1Y:0, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"5천만원", fee:"연 1.5%", desc:"중국 테크 테마 주식 및 ETF", manager:"플레인바닐라", strategy:"중국 기술주 및 ETF 포트폴리오.", taxBenefit:"해외주식 매매차익 22% 분류과세", topHoldings:["중국 빅테크","홍콩 테크 ETF"] },
  { id:"r6", name:"파인 밸류웨이", type:"랩어카운트", riskGrade:2, return1Y:149.82, return3Y:182.58, bucket:"인컴창출", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"연 2.6%", desc:"Bottom-up 가치투자 장기 성과 추구", manager:"파인자산운용", strategy:"국내 저평가 우량주 발굴. Bottom-up 분석 기반 장기 보유.", taxBenefit:"국내주식 매매차익 비과세", topHoldings:["국내 가치주","대형 우량주"] },
  { id:"r7", name:"체슬리 다크호스", type:"랩어카운트", riskGrade:2, return1Y:149.82, return3Y:182.58, bucket:"인컴창출", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"연 2.6%", desc:"Top-down 내재가치 분석 섹터 발굴", manager:"체슬리투자자문", strategy:"거시경제 Top-down 분석 후 유망 섹터 선별.", taxBenefit:"국내주식 매매차익 비과세", topHoldings:["주도 섹터 대형주","성장 유망주"] },
  { id:"r8", name:"삼성 증금 MMW", type:"랩어카운트", riskGrade:6, return1Y:1.75, return3Y:9.81, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", minInvest:"100만원", fee:"연 0.05%", desc:"AAA 증권금융 예수금 투자, 매일 수익 정산", manager:"삼성증권", strategy:"AAA 등급 증권금융 예수금 운용. 매일 수익 정산.", taxBenefit:"이자소득 15.4% 원천징수", topHoldings:["증권금융 예수금","초단기 채권"] },
  { id:"f1", name:"삼성글로벌반도체증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:1, return1Y:203.79, return3Y:343.90, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"AI·반도체 밸류체인 집중 투자", aum:"914.06억", manager:"삼성자산운용", inception:"2011-09", stars:5, strategy:"TSMC, NVIDIA, ASML 등 글로벌 반도체 밸류체인 집중 투자. 환헤지 미적용(UH).", taxBenefit:"배당소득세 15.4% 과세 (환매 시)", topHoldings:["SK하이닉스","NVIDIA CORP","APPLIED MATERIALS INC","MICRON TECHNOLOGY INC","BROADCOM INC"] },
  { id:"f2", name:"삼성글로벌휴머노이드로봇증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:2, return1Y:67.52, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"휴머노이드 로봇·AI 글로벌 기업 투자", aum:"1,287억", manager:"삼성자산운용", inception:"2025-02", strategy:"보스턴다이내믹스, 테슬라, 엔비디아 등 휴머노이드 로봇 밸류체인 투자.", taxBenefit:"배당소득세 15.4% 과세 (환매 시)", topHoldings:["TESLA INC","로보티즈","UBTECH ROBOTICS CORP","MDA Space Ltd","레인보우로보틱스"] },
  { id:"f3", name:"삼성미국S&P500인덱스증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:3, return1Y:35.14, return3Y:95.62, bucket:"인컴창출", isInstantRedeem:true, taxType:"해외주식형", desc:"미국 S&P500 지수 추종, 안정적 장기 성장", aum:"1,397억", manager:"삼성자산운용", inception:"2016-03", strategy:"미국 S&P500 지수 추종 패시브 펀드. 환헤지 미적용(UH).", taxBenefit:"배당소득세 15.4% 과세 (환매 시)", topHoldings:["NVIDIA CORP","APPLE INC","iShares Core S&P 500 ETF","MICROSOFT CORP","AMAZON.COM INC"] },
  { id:"f4", name:"삼성글로벌액티브TDF2050증권UH[주식혼합]-A", type:"펀드", riskGrade:3, return1Y:39.92, return3Y:87.05, bucket:"인컴창출", isInstantRedeem:true, taxType:"해외주식형", desc:"2050 은퇴 목표 자동 리밸런싱", aum:"2,110억", manager:"삼성자산운용", inception:"2019-02", stars:5, strategy:"2050년 은퇴 목표 TDF. 시간 경과에 따라 채권 비중 자동 증가.", taxBenefit:"배당소득세 15.4% 과세 (환매 시)", topHoldings:["KODEX200액티브","KODEX 미국S&P500(H)","KODEX미국AI전력핵심인프라","VANGUARD INFO TECH ETF","ROUNDHILL GEN AI & TECH FLYER"] },
  { id:"f5", name:"삼성밸류라이프플랜65증권전환형자투자신탁[주식]-A", type:"펀드", riskGrade:3, return1Y:149.82, return3Y:182.58, bucket:"인컴창출", isInstantRedeem:true, taxType:"국내주식형", desc:"국내 우량주 장기 가치투자, 은퇴 설계형", aum:"8.91억", manager:"삼성자산운용", inception:"2002-11", stars:4, strategy:"국내 우량주 중심 장기 가치투자. 65세 은퇴 설계형.", taxBenefit:"국내주식 매매차익 비과세", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","LG에너지솔루션","현대차"] },
  { id:"f6", name:"삼성달러표시단기채권증권자투자신탁UH[채권]-A", type:"펀드", riskGrade:4, return1Y:15.99, return3Y:34.16, bucket:"위험헷지", isInstantRedeem:true, taxType:"채권형", desc:"달러 단기채권, 환율 헷지 + 금리 방어", aum:"916억", manager:"삼성자산운용", inception:"2016-01", stars:4, strategy:"달러 표시 단기채권 투자. 환헤지 미적용으로 달러 강세 시 추가 수익.", taxBenefit:"배당소득세 15.4% 과세 (환매 시)", topHoldings:["HYUELE 5 1/2 01/16/27","HYUCAP 5 1/4 01/22/28","POHANG 4 7/8 01/23/27","T3 3/4 04/30/27","HYUSEC 2 1/8 11/01/26"] },
  { id:"f7", name:"삼성밸류라이프플랜35증권전환형자투자신탁[채권혼합]-A", type:"펀드", riskGrade:4, return1Y:21.78, return3Y:32.49, bucket:"위험헷지", isInstantRedeem:true, taxType:"해외주식형", desc:"채권 65% 혼합, 주식 하락 시 완충", aum:"4.81억", manager:"삼성자산운용", inception:"2002-11", strategy:"채권 65% + 주식 35% 혼합. 주식 하락기 방어력 우수.", taxBenefit:"배당소득세 15.4% 과세 (환매 시)", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","LG에너지솔루션","현대차"] },
  { id:"f8", name:"KODEX 골드선물(H) ETF", type:"펀드", riskGrade:3, return1Y:24.5, return3Y:48.2, bucket:"위험헷지", isInstantRedeem:true, taxType:"해외주식형", desc:"금 선물 추종 ETF, 대체자산 분산 효과", manager:"삼성자산운용", strategy:"S&P GSCI Gold Index 추종. 환헤지 적용(H). 인플레이션 헷지 및 대체자산 역할.", taxBenefit:"배당소득세 15.4% 과세 (환매 시)", topHoldings:["COMEX Gold Futures","USD Cash"] },
  { id:"f9", name:"삼성배당플러스30증권자투자신탁Ⅱ[채권혼합]-A", type:"펀드", riskGrade:5, return1Y:35.05, return3Y:45.67, bucket:"유동성", isInstantRedeem:true, taxType:"국내주식형", desc:"채권 70% + 배당주 30%, 낮은위험 수익형", aum:"18.78억", manager:"삼성자산운용", inception:"2005-01", stars:4, strategy:"채권 70% + 국내 배당주 30% 혼합. 낮은 변동성 안정 수익.", taxBenefit:"국내주식 매매차익 비과세", topHoldings:["삼성전자","SK하이닉스","삼성전자우","현대차","SK스퀘어"] },
  { id:"f10", name:"삼성코리아초단기우량채권증권자투자신탁[채권]-C", type:"펀드", riskGrade:6, return1Y:1.75, return3Y:9.81, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", desc:"AAA 단기채권, 즉시환매 가능 안전 주차", aum:"1,116억", manager:"삼성자산운용", inception:"2016-05", strategy:"국내 AAA 등급 초단기 우량채권. 즉시환매 가능. 단기 여유자금 운용 최적.", taxBenefit:"이자소득 15.4% 원천징수", topHoldings:["한국전력 1448","국민은행 4411","하나금융지주 69-1","기업은행 2508","우리금융지주 15-1"] },
  { id:"f11", name:"삼성 플래티넘행복연금보험", type:"펀드", riskGrade:5, return1Y:2.58, return3Y:null, bucket:"절세", isInstantRedeem:false, taxType:"비과세연금", desc:"10년 유지 시 보험차익 완전 비과세 (소득세법 16조)", manager:"삼성생명(방카슈랑스)", strategy:"공시이율 연동 일시납 연금보험. 5년 유지 시 최저적립액 보증. 장기 유지 시 보너스 적립.", taxBenefit:"소득세법 16조+시행령 25조: 1억 이하 10년 유지 시 보험차익 완전 비과세. 금융소득종합과세 제외.", topHoldings:["공시이율 연동 계정","채권형 운용 자산"] },
  { id:"f12", name:"개인투자용 국채 5년/10년물", type:"펀드", riskGrade:6, return1Y:3.5, return3Y:null, bucket:"절세", isInstantRedeem:false, taxType:"분리과세", desc:"2억 한도 15.4% 분리과세, 종합과세 완전 차단", manager:"기획재정부", strategy:"정부 발행 국채. 만기 보유 시 복리이자+가산금리. 2억 한도.", taxBenefit:"조세특례제한법: 매입액 2억 한도 15.4% 분리과세. 금융소득종합과세 완전 차단.", topHoldings:["대한민국 국채 5년물","대한민국 국채 10년물"] },
  { id:"f13", name:"삼성우량주장기증권자투자신탁[주식]-A", type:"펀드", riskGrade:2, return1Y:210.92, return3Y:258.76, bucket:"절세", isInstantRedeem:false, taxType:"국내주식형", desc:"국내 주식 매매차익 비과세, 종소세 절감", aum:"163억", manager:"삼성자산운용", stars:4, strategy:"국내 우량주 장기 투자. 삼성전자, SK하이닉스 등 대형주 중심.", taxBenefit:"국내주식 매매차익 비과세. 종소세 대상자 절세 효과 극대화.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","현대차","LG에너지솔루션"] },
  { id:"f14", name:"삼성코스닥벤처플러스증권투자신탁[주식]-A", type:"펀드", riskGrade:1, return1Y:32.09, return3Y:25.31, bucket:"절세", isInstantRedeem:false, taxType:"소득공제", desc:"투자금 10% 소득공제 최대 300만원 (조특법 16조)", aum:"19.36억", manager:"삼성액티브자산운용", inception:"2018-04", isHighIncomeOnly:true, strategy:"코스닥 벤처기업 신주, IPO, CB, BW 투자. 3년 보유 조건.", taxBenefit:"조특법 16조: 투자금 10% 소득공제 최대 300만원. 근로/사업소득 고소득자 전용. 2028년까지 연장.", topHoldings:["로킷헬스케어","액트로","알지노믹스","노타","큐리오시스"] },
];

// 텍스트에서 금액 파싱
function parseAmount(text: string): number {
  if (!text) return 0;
  const t = text.replace(/,/g, "").replace(/\s/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(억|천만|백만|만)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2] === "억") return n * 1e8;
  if (m[2] === "천만") return n * 1e7;
  if (m[2] === "백만") return n * 1e6;
  if (m[2] === "만") return n * 1e4;
  return n;
}

// 텍스트에서 시점 파싱 (년 단위)
function parseTimepoint(text: string): number {
  if (!text) return 5;
  if (/즉시|당장|6개월|올해|1년\s*이내/.test(text)) return 0.5;
  if (/1~?2년|1년/.test(text)) return 1.5;
  if (/2~?3년|2년/.test(text)) return 2.5;
  if (/3~?5년|3년|4년/.test(text)) return 4;
  if (/5년\s*이상|5년|10년|장기/.test(text)) return 7;
  return 3;
}

function getBlended(p: Product) {
  return p.return3Y !== null ? p.return1Y * 0.7 + p.return3Y * 0.3 : p.return1Y;
}

function calcWeights(c: Client) {
  const uG = Math.max(c.targetReturn * (6 - c.riskAppetite) + c.investmentPeriod * 2, 1);
  const uI = Math.max((c.age / 100) * 50 + (6 - c.riskAppetite) * 5, 1);
  const uH = Math.max(c.riskAppetite * 15, 1);
  const uT = c.isTaxTarget ? 100 : 5;

  // 정기현금흐름점수 (30%)
  const cashflowRatio = c.monthlyIncome > 0 ? c.monthlyCashflow / c.monthlyIncome : 0.5;
  const cashflowScore = Math.max(cashflowRatio * 100, 1);

  // 목돈점수 (50%)
  const lumpRatio = c.investableAssets > 0 ? c.lumpSumAmount / c.investableAssets : 0;
  const tp = c.lumpSumTimepoint;
  const tpBase = tp <= 1 ? 80 : tp <= 3 ? 60 : tp <= 5 ? 40 : 20;
  const tpWeight = tp <= 1 ? 1.0 : tp <= 3 ? 0.8 : tp <= 5 ? 0.5 : 0.2;
  const lumpScore = Math.max(tpBase + lumpRatio * 100 * tpWeight * 0.5, 1);

  // 비상금점수 (20%)
  const emergencyRatio = c.investableAssets > 0 ? c.emergencyAmount / c.investableAssets : 0;
  const emergencyScore = Math.max(50 + emergencyRatio * 50, 1);

  // 유동성 최종
  const uL = Math.max(cashflowScore * 0.30 + lumpScore * 0.50 + emergencyScore * 0.20, 1);

  const total = uG + uI + uH + uL + uT;
  const arr: { bucket: BucketType; w: number }[] = [
    { bucket:"자본증식", w:uG/total }, { bucket:"인컴창출", w:uI/total },
    { bucket:"위험헷지", w:uH/total }, { bucket:"유동성", w:uL/total }, { bucket:"절세", w:uT/total },
  ];
  return { G:uG/total, I:uI/total, H:uH/total, L:uL/total, T:uT/total, topBucket:arr.reduce((a,b)=>a.w>b.w?a:b).bucket };
}

function calcScore(p: Product, c: Client, w: ReturnType<typeof calcWeights>, all: Product[]) {
  const blended = getBlended(p);
  const allB = all.map(getBlended);
  const maxR = Math.max(...allB); const minR = Math.min(...allB);
  const returnScore = maxR === minR ? 50 : ((blended-minR)/(maxR-minR))*100;
  const stabilityScore = (p.riskGrade-1)*20;
  const liquidityScore = p.isInstantRedeem ? 100 : 10;
  let taxScore = 50;
  if (c.isTaxTarget) {
    if (p.taxType==="비과세연금"||p.taxType==="분리과세") taxScore=100;
    else if (p.taxType==="국내주식형") taxScore=70;
    else if (p.taxType==="소득공제") taxScore=c.isHighIncomeWorker?90:20;
    else taxScore=10;
  }
  const base = w.G*returnScore + w.I*(returnScore*0.5+stabilityScore*0.5) + w.H*stabilityScore + w.L*liquidityScore + w.T*taxScore;
  return base*0.9 + (p.bucket===w.topBucket?10:0);
}

function riskLevelToAppetite(l: string): number {
  return ({"초고위험":1,"고위험":2,"중위험":3,"저위험":4,"초저위험":5} as Record<string,number>)[l]??3;
}
function timeHorizonToYears(h: string): number {
  if (h.includes("5년 이상")) return 7; if (h.includes("3~5년")) return 4;
  if (h.includes("2~3년")) return 2.5; if (h.includes("1~2년")) return 1.5;
  if (h.includes("1년 미만")) return 0.5; return 3;
}
function returnObjectiveToPercent(o: string): number {
  if (o.includes("적극적")) return 15; if (o.includes("시장수익률")) return 8;
  if (o.includes("예금")) return 4; if (o.includes("원금")) return 2; return 8;
}
function fmtWon(n: number): string {
  if (n===0) return "0원";
  const eok = Math.floor(n/1e8);
  const man = Math.round((n-eok*1e8)/1e4);
  if (eok>0&&man>0) return `${eok}억 ${man.toLocaleString()}만원`;
  if (eok>0) return `${eok}억원`;
  return `${Math.round(n/1e4).toLocaleString()}만원`;
}
function hasRrttllu(f: { rrttllu: { returnObjective: string; timeHorizon: string; riskAttitude: string } }): boolean {
  return !!(f.rrttllu.returnObjective||f.rrttllu.timeHorizon||f.rrttllu.riskAttitude);
}

const BUCKET_CFG: Record<BucketType, { color: string; bg: string; border: string; icon: React.ReactNode; barColor: string; desc: string }> = {
  "자본증식": { color:"text-blue-700",   bg:"bg-blue-50",   border:"border-blue-200",   icon:<TrendingUp size={14}/>,  barColor:"#3B82F6", desc:"성장 자산 중심 — 랩어카운트, 해외주식형 펀드" },
  "인컴창출": { color:"text-amber-700",  bg:"bg-amber-50",  border:"border-amber-200",  icon:<Landmark size={14}/>,    barColor:"#F59E0B", desc:"배당·이자 수익 중심 — 가치주 랩, 혼합형 펀드" },
  "위험헷지": { color:"text-emerald-700",bg:"bg-emerald-50",border:"border-emerald-200",icon:<ShieldCheck size={14}/>, barColor:"#10B981", desc:"하락 방어 — 달러채권, 금 ETF, 채권혼합 펀드" },
  "유동성":   { color:"text-purple-700", bg:"bg-purple-50", border:"border-purple-200", icon:<PiggyBank size={14}/>,   barColor:"#8B5CF6", desc:"즉시 현금화 — MMW 랩, 단기채권 펀드" },
  "절세":     { color:"text-rose-700",   bg:"bg-rose-50",   border:"border-rose-200",   icon:<Sparkles size={14}/>,    barColor:"#F43F5E", desc:"세제 혜택 — 연금보험, 분리과세채권, 국내주식형" },
};
const BUCKETS: BucketType[] = ["자본증식","인컴창출","위험헷지","유동성","절세"];
const ASSET_CLASS_TO_BUCKET: Record<string,BucketType> = {
  "해외주식":"자본증식","국내주식":"인컴창출",
  "채권":"위험헷지","금":"위험헷지","달러":"위험헷지",
  "리츠":"유동성","현금":"유동성",
};
const RISK_GRADE_LABEL: Record<number,string> = {1:"매우높은위험",2:"높은위험",3:"다소높은위험",4:"보통위험",5:"낮은위험",6:"매우낮은위험"};

function ProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const cfg = BUCKET_CFG[product.bucket];
  const docUrl = PRODUCT_DOCS[product.id];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={e=>e.stopPropagation()}>
        <div className={`px-6 py-5 ${cfg.bg} border-b ${cfg.border}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${cfg.bg} ${cfg.border} ${cfg.color}`}>{cfg.icon}{product.bucket}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{product.type}</span>
              </div>
              <h3 className="text-base font-bold leading-6 text-navy">{product.name}</h3>
              {product.manager && <p className="mt-1 text-xs text-slate-500">운용사: {product.manager}</p>}
            </div>
            <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-white/60 transition">
              <X size={16} className="text-slate-500"/>
            </button>
          </div>
        </div>
        <div className="overflow-y-auto max-h-[60vh] p-6 space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-400">위험등급</p>
              <p className="mt-1 text-sm font-black text-navy">{product.riskGrade}등급</p>
              <p className="text-[10px] text-slate-400">{RISK_GRADE_LABEL[product.riskGrade]}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-400">1년 수익률</p>
              <p className={`mt-1 text-sm font-black ${product.return1Y>0?"text-blue-700":"text-slate-400"}`}>{product.return1Y>0?`+${product.return1Y}%`:"-"}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-400">3년 수익률</p>
              <p className={`mt-1 text-sm font-black ${product.return3Y!==null&&product.return3Y>0?"text-blue-700":"text-slate-400"}`}>{product.return3Y?`+${product.return3Y}%`:"-"}</p>
            </div>
          </div>
          <div className="space-y-2">
            {product.aum && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">총 운용규모</span><span className="text-xs font-bold text-navy">{product.aum}</span></div>}
            {product.inception && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">설정일</span><span className="text-xs font-bold text-navy">{product.inception}</span></div>}
            {product.minInvest && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">최소 가입금액</span><span className="text-xs font-bold text-navy">{product.minInvest}</span></div>}
            {product.fee && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">수수료</span><span className="text-xs font-bold text-navy">{product.fee}</span></div>}
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">즉시환매</span><span className={`text-xs font-bold ${product.isInstantRedeem?"text-emerald-700":"text-slate-400"}`}>{product.isInstantRedeem?"가능":"불가"}</span></div>
          </div>
          {product.topHoldings&&product.topHoldings.length>0&&(
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-bold text-slate-500">💡 상위 편입 종목 (Top 5)</p>
              <div className="flex flex-wrap gap-1.5">
                {product.topHoldings.map((h,i)=>(
                  <span key={i} className="bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded-md text-xs font-medium shadow-sm">{h}</span>
                ))}
              </div>
            </div>
          )}
          {product.strategy&&<div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="mb-2 text-xs font-bold text-blue-800">운용 전략</p><p className="text-xs leading-5 text-blue-900">{product.strategy}</p></div>}
          {product.taxBenefit&&<div className="rounded-xl border border-rose-100 bg-rose-50 p-4"><p className="mb-2 text-xs font-bold text-rose-800">세금 정보</p><p className="text-xs leading-5 text-rose-900">{product.taxBenefit}</p></div>}
          {docUrl && (
            <a href={docUrl} target="_blank" rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-3 text-sm font-bold text-white hover:bg-navy/90 transition">
              <FileText size={14}/>약관 다운로드
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Tab4Page() {
  const { formData, riskResult, warnings, financialCompletion, rrttlluCompletion, selectedCustomerProfile, internalJsonPayload } = useCustomerContext();
  const portfolioData = usePortfolioResult();
  const rrttlluReady = hasRrttllu(formData);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bucketOffset, setBucketOffset] = useState<Partial<Record<BucketType,number>>>({});
  const [modalProduct, setModalProduct] = useState<Product|null>(null);

  const client: Client = useMemo(() => {
    if (!rrttlluReady) return {
      riskAppetite:3, targetReturn:8, investmentPeriod:3, liquidityRatio:0.2,
      isTaxTarget:false, isHighIncomeWorker:false, age:50,
      monthlyIncome:0, monthlyCashflow:0,
      lumpSumAmount:0, lumpSumTimepoint:5,
      emergencyAmount:0, investableAssets:0,
    };
    const isTaxTarget = internalJsonPayload.rrttllu.tax.financial_income_tax_alert.includes("초과");
    const age = parseInt(selectedCustomerProfile.age||"50");
    const fa = parseFloat(formData.financial.financialAssets.replace(/[^0-9.]/g,""))||0;
    const ta = parseFloat(formData.financial.totalAssets.replace(/[^0-9.]/g,""))||0;
    const annualIncome = parseAmount(formData.financial.annualFixedIncome);
    const monthlyIncome = annualIncome / 12;
    const monthlyCashflow = parseAmount(formData.financial.monthlyFixedExpense);
    const investableAssets = parseAmount(formData.financial.investableAssets);
    const lumpSumAmount = parseAmount(formData.rrttllu.lumpSumPlan);
    const lumpSumTimepoint = parseTimepoint(formData.rrttllu.lumpSumPlan);
    const emergencyAmount = parseAmount(formData.rrttllu.emergencyReservePlan);
    return {
      riskAppetite: riskLevelToAppetite(riskResult.level),
      targetReturn: returnObjectiveToPercent(formData.rrttllu.returnObjective),
      investmentPeriod: timeHorizonToYears(formData.rrttllu.timeHorizon),
      liquidityRatio: fa&&ta ? Math.min(fa/ta,1) : 0.2,
      isTaxTarget, isHighIncomeWorker:false,
      age: isNaN(age)?50:age,
      monthlyIncome, monthlyCashflow,
      lumpSumAmount, lumpSumTimepoint,
      emergencyAmount, investableAssets,
    };
  }, [formData,riskResult,selectedCustomerProfile,internalJsonPayload,rrttlluReady]);

  const weights = useMemo(() => rrttlluReady ? calcWeights(client) : null, [client,rrttlluReady]);

  const existingPortfolio = useMemo(() => {
    if (!portfolioData?.enrichedAssets?.length) return null;
    const total = portfolioData.enrichedAssets.reduce((s,a)=>s+(a.current_value??a.amount??0),0);
    if (!total) return null;
    const map: Partial<Record<BucketType,number>> = {};
    for (const a of portfolioData.enrichedAssets) {
      const bucket = ASSET_CLASS_TO_BUCKET[a.asset_class]??"자본증식";
      map[bucket] = (map[bucket]??0) + (a.current_value??a.amount??0)/total;
    }
    return { weights:map, total };
  }, [portfolioData]);

  const bucketAllProducts = useMemo(() => {
    if (!weights) return null;
    const scored = PRODUCTS
      .filter(p => !(p.isHighIncomeOnly&&!client.isHighIncomeWorker))
      .map(p => ({ ...p, score: Math.round(calcScore(p,client,weights,PRODUCTS)*10)/10 }))
      .sort((a,b) => b.score-a.score);
    const result: Partial<Record<BucketType,typeof scored>> = {};
    for (const bucket of BUCKETS) {
      let list = scored.filter(p=>p.bucket===bucket);
      if (list.length===0) {
        list = PRODUCTS
          .filter(p=>p.bucket===bucket&&!(p.isHighIncomeOnly&&!client.isHighIncomeWorker))
          .sort((a,b)=>b.riskGrade-a.riskGrade)
          .map(p=>({...p, score: Math.round(calcScore(p,client,weights,PRODUCTS)*10)/10}));
      }
      result[bucket] = list;
    }
    return result;
  }, [client,weights]);

  const getBucketWeight = (b: BucketType) => {
    if (!weights) return 0;
    return b==="자본증식"?weights.G:b==="인컴창출"?weights.I:b==="위험헷지"?weights.H:b==="유동성"?weights.L:weights.T;
  };

  const toggleSelect = (id: string) => setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const getOffset = (b: BucketType) => bucketOffset[b]??0;
  const nextOffset = (b: BucketType, total: number) => {
    const cur = getOffset(b);
    setBucketOffset(prev=>({...prev,[b]:cur+2>=total?0:cur+2}));
  };

  const selectedProducts = PRODUCTS.filter(p=>selectedIds.includes(p.id));
  const totalAssetValue = existingPortfolio?.total??0;
  const customerName = selectedCustomerProfile.name||selectedCustomerProfile.fallbackName||"고객";

  return (
    <>
      {modalProduct && <ProductModal product={modalProduct} onClose={()=>setModalProduct(null)}/>}

      {!rrttlluReady && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertCircle size={18} className="shrink-0 text-amber-600"/>
          <div>
            <p className="text-sm font-bold text-amber-800">RRTTLLU 정보가 필요합니다</p>
            <p className="mt-0.5 text-xs text-amber-700">TAB1에서 고객 성향 분석을 완료하면 맞춤 포트폴리오가 생성됩니다.</p>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-samsung"><RefreshCcw size={18}/></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">RRTTLLU 기반 리밸런싱</p>
            <h2 className="text-lg font-bold text-navy">{customerName}님 자산 배분 전환</h2>
            {totalAssetValue>0 && <p className="mt-0.5 text-xs text-slate-400">기존 포트폴리오 총액: <span className="font-bold text-navy">{fmtWon(totalAssetValue)}</span></p>}
          </div>
        </div>
        <div className="grid gap-8 lg:grid-cols-[1fr_40px_1fr]">
          <div>
            <p className="mb-3 text-sm font-bold text-slate-500">기존 포트폴리오</p>
            {existingPortfolio ? (
              <div className="space-y-3">
                {BUCKETS.map(bucket=>{
                  const w = existingPortfolio.weights[bucket]??0;
                  const cfg = BUCKET_CFG[bucket];
                  return (
                    <div key={bucket}>
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                        <span className={`flex items-center gap-1 ${cfg.color}`}>{cfg.icon}{bucket}</span>
                        <div className="flex items-center gap-2">
                          {w>0&&totalAssetValue>0&&<span className="text-slate-400">{fmtWon(totalAssetValue*w)}</span>}
                          <span className={w>0?"font-bold text-navy":"text-slate-300"}>{(w*100).toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{width:`${w*100}%`,backgroundColor:cfg.barColor}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
                <PiggyBank size={24} className="text-slate-300"/>
                <p className="text-sm font-semibold text-slate-400">TAB2에서 자산을 입력하고<br/>분석 실행을 눌러주세요</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-samsung text-white shadow-sm"><ArrowRight size={18}/></div>
          </div>
          <div>
            <p className="mb-3 text-sm font-bold text-samsung">신규 포트폴리오 (RRTTLLU 기반)</p>
            {rrttlluReady&&weights ? (
              <div className="space-y-3">
                {BUCKETS.map(bucket=>{
                  const w = getBucketWeight(bucket);
                  const cfg = BUCKET_CFG[bucket];
                  return (
                    <div key={bucket}>
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                        <span className={`flex items-center gap-1 ${cfg.color}`}>{cfg.icon}{bucket}</span>
                        <div className="flex items-center gap-2">
                          {w>0&&totalAssetValue>0&&<span className="text-slate-400">{fmtWon(totalAssetValue*w)}</span>}
                          <span className="font-bold text-navy">{(w*100).toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{width:`${w*100}%`,backgroundColor:cfg.barColor}}/>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">{cfg.desc}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
                <AlertCircle size={24} className="text-slate-300"/>
                <p className="text-sm font-semibold text-slate-400">TAB1에서 RRTTLLU를<br/>입력해주세요</p>
              </div>
            )}
          </div>
        </div>
        {rrttlluReady&&client.isTaxTarget&&(
          <div className="mt-5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
            <p className="text-xs font-bold text-orange-700">⚠️ 금융소득종합과세 대상 고객</p>
            <p className="mt-1 text-xs font-semibold text-orange-800">{internalJsonPayload.rrttllu.tax.financial_income_tax_alert}</p>
            <p className="mt-1 text-xs text-orange-600">절세 버킷 {(weights!.T*100).toFixed(1)}% 적용 — 연금보험·분리과세채권 우선 추천</p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-samsung"><BarChart3 size={18}/></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">버킷별 매칭 상품</p>
            <h2 className="text-lg font-bold text-navy">삼성증권 추천 상품</h2>
            <p className="mt-0.5 text-xs text-slate-400">카드를 클릭해 상품 상세 정보를 확인하고, 체크박스로 선택하세요</p>
          </div>
        </div>
        {!rrttlluReady ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
            <p className="text-sm text-slate-400">RRTTLLU 입력 후 상품이 추천됩니다</p>
          </div>
        ) : (
          <div className="space-y-4">
            {BUCKETS.map(bucket=>{
              const cfg = BUCKET_CFG[bucket];
              const allProds = bucketAllProducts?.[bucket]??[];
              const offset = getOffset(bucket);
              const shown = allProds.slice(offset, offset+2);
              const bw = getBucketWeight(bucket);
              const bucketAmt = totalAssetValue*bw;
              return (
                <div key={bucket} className={`rounded-xl border p-5 ${cfg.border} ${cfg.bg}`}>
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${cfg.border} bg-white ${cfg.color}`}>{cfg.icon}</span>
                      <div>
                        <span className={`text-sm font-bold ${cfg.color}`}>{bucket}</span>
                        <p className="text-xs text-slate-400">{cfg.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {allProds.length>2&&(
                        <button type="button" onClick={()=>nextOffset(bucket,allProds.length)}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition">
                          <ChevronRight size={12}/>다른 상품
                        </button>
                      )}
                      <div className="text-right">
                        <p className={`text-lg font-black ${cfg.color}`}>{(bw*100).toFixed(1)}%</p>
                        {bucketAmt>0&&<p className="text-xs text-slate-400">{fmtWon(bucketAmt)}</p>}
                      </div>
                    </div>
                  </div>
                  {shown.length>0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {shown.map(p=>{
                        const sel = selectedIds.includes(p.id);
                        return (
                          <div key={p.id}
                            className={`relative rounded-xl border-2 bg-white p-4 cursor-pointer transition-all ${sel?"border-samsung shadow-md":"border-slate-200 hover:border-slate-300 hover:shadow-sm"}`}
                            onClick={()=>setModalProduct(p)}>
                            <button type="button"
                              onClick={e=>{e.stopPropagation();toggleSelect(p.id);}}
                              className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${sel?"border-samsung bg-samsung text-white":"border-slate-300 bg-white hover:border-samsung"}`}>
                              {sel&&<CheckCircle2 size={14}/>}
                            </button>
                            <div className="mb-2 flex items-center gap-1.5 pr-8">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{p.type}</span>
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">점수 {p.score}</span>
                            </div>
                            <p className="mb-1 text-sm font-bold leading-5 text-navy pr-2">{p.name}</p>
                            <p className="mb-3 text-xs leading-5 text-slate-500">{p.desc}</p>
                            {p.minInvest&&<p className="mb-2 text-xs text-slate-400">최소 {p.minInvest} · {p.fee}</p>}
                            <div className="mb-3 grid grid-cols-3 gap-1.5 text-center text-xs">
                              <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">위험</p><p className="font-bold text-navy">{p.riskGrade}등급</p></div>
                              <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">1년</p><p className="font-bold text-navy">{p.return1Y>0?`${p.return1Y}%`:"-"}</p></div>
                              <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">3년</p><p className="font-bold text-navy">{p.return3Y?`${p.return3Y}%`:"-"}</p></div>
                            </div>
                            <div className="flex items-center justify-center gap-1 text-xs text-slate-400">
                              <Info size={11}/><span>클릭하면 상세 정보를 볼 수 있습니다</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">추천 상품이 없습니다.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedProducts.length>0&&(
        <section className="rounded-lg border-2 border-samsung bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-samsung text-white"><CheckCircle2 size={18}/></div>
              <div>
                <p className="text-xs font-bold uppercase tracking-normal text-slate-500">선택된 포트폴리오</p>
                <h2 className="text-lg font-bold text-navy">총 {selectedProducts.length}개 상품 선택됨</h2>
              </div>
            </div>
            <button type="button" onClick={()=>setSelectedIds([])} className="text-xs font-bold text-slate-400 hover:text-slate-600">전체 해제</button>
          </div>
          <div className="space-y-2">
            {BUCKETS.map(bucket=>{
              const prods = selectedProducts.filter(p=>p.bucket===bucket);
              if (!prods.length) return null;
              const cfg = BUCKET_CFG[bucket];
              return (
                <div key={bucket} className={`rounded-lg border p-3 ${cfg.border} ${cfg.bg}`}>
                  <p className={`mb-2 text-xs font-bold ${cfg.color} flex items-center gap-1`}>{cfg.icon}{bucket} ({(getBucketWeight(bucket)*100).toFixed(1)}%)</p>
                  <div className="space-y-1">
                    {prods.map(p=>(
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                        <p className="text-xs font-semibold text-navy truncate">{p.name}</p>
                        <button type="button" onClick={()=>toggleSelect(p.id)} className="shrink-0 text-slate-300 hover:text-red-400 transition"><X size={14}/></button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {rrttlluReady&&(
        <ResultCard icon={<Sparkles size={18}/>} title="포트폴리오 생성 기준" accent="blue">
          <ResultGrid rows={[
            ["위험등급", riskResult.level],
            ["Risk 점수", `${riskResult.score}/100`],
            ["목표 수익률", formData.rrttllu.returnObjective||"-"],
            ["투자 기간", formData.rrttllu.timeHorizon||"-"],
            ["금융자산", formData.financial.financialAssets||"-"],
            ["최고 비중 버킷", weights?.topBucket??"-"],
            ["종소세 대상", client.isTaxTarget?"대상":"비대상"],
          ]}/>
        </ResultCard>
      )}
    </>
  );
}