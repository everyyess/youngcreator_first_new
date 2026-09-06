"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { FinancialIncomeSummary } from "../tab1/FinancialIncomeGauge";
import {
  Sparkles, ShieldCheck, TrendingUp, Landmark, PiggyBank,
  FileText, BarChart3, AlertCircle,
  CheckCircle2, X, Info, BadgeCheck, AlertTriangle, AlertOctagon, Newspaper
} from "lucide-react";
import { useCustomerContext, loadTaxSummaries, type PortfolioAsset } from "../CustomerContext";
import { usePortfolioResult, HoldingsCardGrid, makeAssetKey, isProductHolding, PRODUCT_TICKER_PREFIX, BOND_TICKER_PREFIX } from "../PortfolioResultComponents";
import { useCustomerView } from "../CustomerViewContext";
import { parseLiquidityEntries, type LiquidityKind } from "../liquidityFields";
import {
  createProductRebalancingRecord,
  upsertRebalancingHistory,
} from "../rebalancingHistoryUtils";

type BucketType = "자본증식" | "인컴창출" | "위험헷지" | "유동성" | "절세";
type TaxType = "국내주식형" | "해외주식형" | "채권형" | "비과세연금" | "분리과세" | "소득공제";
type ProductType = "펀드" | "랩어카운트" | "보험" | "채권" | "ETF";

interface Product {
  id: string; name: string; type: ProductType; riskGrade: number;
  return1Y: number | null; return3Y: number | null; bucket: BucketType;
  isInstantRedeem: boolean; taxType: TaxType;
  minInvest?: string; fee?: string; desc: string;
  isHighIncomeOnly?: boolean;
  aum?: string; manager?: string; inception?: string; stars?: number;
  strategy?: string; taxBenefit?: string;
  topHoldings?: string[];
  returnNote?: string; // 수익률 미산출·미공시 사유 (return1Y·return3Y가 null일 때 표시)
  bondRef?: Bond; // 개별 채권을 상품 카드로 변환했을 때만 존재 — 신용등급·만기·수익률 등 채권 고유 상세정보 보관
  taxBucketExceptionReason?: string; // 절세 버킷인데 taxType이 절세 전용이 아닐 때만 필수 — validateTaxBucketExceptions 참고
}


// 리밸런싱 히스토리용 상품 카테고리
// 펀드·랩은 투자지역이 아니라 운용사 국적 기준으로 구분한다.
const FOREIGN_MANAGER_KEYWORDS = [
  "루미스세일즈",
  "피델리티",
  "블랙록",
  "제이피모건",
  "JP모건",
  "골드만삭스",
  "모건스탠리",
  "프랭클린템플턴",
  "템플턴",
  "슈로더",
  "베어링",
  "얼라이언스번스틴",
  "뱅가드",
  "핌코",
  "PIMCO",
];

function historyProductCategory(
  product: Product,
  fallbackCategory: string,
): string {
  if (product.type !== "펀드" && product.type !== "랩어카운트") {
    return fallbackCategory;
  }

  const manager = (product.manager ?? "").trim();

  const isForeignManager = FOREIGN_MANAGER_KEYWORDS.some((keyword) =>
    manager.toLowerCase().includes(keyword.toLowerCase()),
  );

  const region = isForeignManager ? "해외" : "국내";

  return product.type === "랩어카운트"
    ? `${region}랩`
    : `${region}펀드`;
}

interface Client {
  riskAppetite: number; targetReturn: number; investmentPeriod: number;
  liquidityRatio: number; isTaxTarget: boolean; isHighIncomeWorker: boolean; age: number;
  monthlyIncome: number; investableAssets: number;
  lumpSumTimepoint: number;
  liquidityNeeds: LiquidityNeed[];
  taxExcessAmount: number;
  hasTab4TaxData: boolean;
  isTaxAlertFromTab1: boolean;
}

type LiquidityNeed = {
  kind: LiquidityKind;
  priority: 1 | 2 | 3;
  amount: number;
  timing: string;
};

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
  f13: "/docs/fund-bluechip.pdf",
  f14: "/docs/fund-kosdaq-venture.pdf",
};

const PRODUCTS: Product[] = [
  { id:"r1", name:"플레인바닐라 매크로 온앤오프", type:"랩어카운트", riskGrade:1, return1Y:15.99, return3Y:34.16, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"3천만원", fee:"연 1.5%", desc:"미국 ETF 투자, 경기 국면별 주식/채권 비중 전환", manager:"플레인바닐라", strategy:"미국 ETF를 중심으로 경기 국면을 판단해 주식과 채권 비중을 동적으로 조절하는 매크로 전략입니다. 경기 확장기에는 주식 비중을 높이고, 수축기에는 채권으로 방어합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 대상에서 제외됩니다. 종소세 대상 고객의 세 부담을 효과적으로 줄일 수 있습니다.", topHoldings:["미국 주식 ETF","미국 채권 ETF","글로벌 매크로 자산"] },
  { id:"r2", name:"루미스세일즈 미국 올캡 그로스", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"미국 성장주 장기 투자", manager:"루미스세일즈", strategy:"미국 전 시가총액에 걸쳐 성장 잠재력이 높은 기업을 발굴해 장기 보유합니다. 시장 벤치마크를 추종하지 않는 액티브 운용 방식으로, 운용사의 독립적 판단을 중시합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["미국 대형성장주","미국 중소형성장주"] },
  { id:"r3", name:"삼성자산 4차산업 혁신주", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"글로벌 4차산업/IT 핵심 기업 집중 투자", manager:"삼성자산운용", strategy:"AI, 반도체, 클라우드 등 4차산업 혁신을 이끄는 글로벌 핵심 기업에 집중 투자합니다. 기술 패권 경쟁에서 수혜를 받는 기업을 선별해 성장성을 극대화합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["글로벌 IT 대형주","테크 혁신 기업"] },
  { id:"r4", name:"피델리티 미국 테크", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"글로벌 기술 혁신 기업 집중 투자", manager:"피델리티", strategy:"미국과 글로벌 기술 혁신 기업을 중심으로 액티브 운용합니다. 피델리티의 글로벌 리서치 역량을 바탕으로 기술 섹터 내 선도 기업을 선별합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["미국 빅테크 주식","글로벌 반도체/소프트웨어"] },
  { id:"r5", name:"플레인바닐라 테크차이나", type:"랩어카운트", riskGrade:1, return1Y:0, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"5천만원", fee:"연 1.5%", desc:"중국 테크 테마 주식 및 ETF", manager:"플레인바닐라", strategy:"중국 기술주와 관련 ETF로 구성된 포트폴리오입니다. 중국 빅테크 규제 완화와 AI 산업 성장 수혜를 목표로 합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["중국 빅테크","홍콩 테크 ETF"] },
  { id:"r6", name:"파인 밸류웨이", type:"랩어카운트", riskGrade:2, return1Y:149.82, return3Y:182.58, bucket:"자본증식", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"연 2.6%", desc:"Bottom-up 가치투자 장기 성과 추구", manager:"파인자산운용", strategy:"국내 저평가 우량주를 발굴해 장기 보유하는 Bottom-up 가치투자 전략입니다. 시장 흐름보다 개별 기업의 내재가치에 집중해 안정적인 장기 성과를 추구합니다.", taxBenefit:"국내주식 매매차익은 비과세 적용됩니다. 배당소득은 15.4% 원천징수되며, 종소세 대상 고객에게 절세 효과가 있습니다.", topHoldings:["국내 가치주","대형 우량주"] },
  { id:"r7", name:"체슬리 다크호스", type:"랩어카운트", riskGrade:2, return1Y:149.82, return3Y:182.58, bucket:"자본증식", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"연 2.6%", desc:"Top-down 내재가치 분석 섹터 발굴", manager:"체슬리투자자문", strategy:"거시경제 분석을 바탕으로 유망 섹터를 먼저 선별한 후, 그 안에서 내재가치 대비 저평가된 기업을 발굴합니다. Top-down 접근으로 섹터 흐름과 개별 종목 모두를 고려합니다.", taxBenefit:"국내주식 매매차익은 비과세 적용됩니다. 종소세 대상 고객에게 금융소득 절감 효과가 있습니다.", topHoldings:["주도 섹터 대형주","성장 유망주"] },
  { id:"r8", name:"삼성 증금 MMW", type:"랩어카운트", riskGrade:6, return1Y:1.75, return3Y:9.81, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", minInvest:"100만원", fee:"연 0.05%", desc:"AAA 증권금융 예수금 투자, 매일 수익 정산", manager:"삼성증권", strategy:"AAA 등급 증권금융 예수금에 투자하며 매일 수익을 정산합니다. 원금 손실 위험이 극히 낮고 즉시 출금이 가능해 단기 여유 자금 운용에 최적화된 상품입니다.", taxBenefit:"이자소득에 15.4% 원천징수가 적용됩니다. 금융소득으로 합산되나 금액이 작아 종소세 부담이 낮습니다.", topHoldings:["증권금융 예수금","초단기 채권"] },
  { id:"f1", name:"삼성글로벌반도체증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:1, return1Y:203.79, return3Y:343.90, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"AI·반도체 밸류체인 집중 투자", aum:"914.06억", manager:"삼성자산운용", inception:"2011-09", stars:5, strategy:"TSMC, NVIDIA, ASML 등 글로벌 반도체 밸류체인 전반에 집중 투자합니다. 환헤지를 적용하지 않아(UH) 달러 강세 시 추가 수익도 기대할 수 있습니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 해외펀드 특성상 금융소득에 합산되며, 종소세 대상 고객은 유의가 필요합니다.", topHoldings:["SK하이닉스","NVIDIA CORP","APPLIED MATERIALS INC","MICRON TECHNOLOGY INC","BROADCOM INC"] },
  { id:"f2", name:"삼성글로벌휴머노이드로봇증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:2, return1Y:67.52, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"휴머노이드 로봇·AI 글로벌 기업 투자", aum:"1,287억", manager:"삼성자산운용", inception:"2025-02", strategy:"테슬라, 엔비디아 등 휴머노이드 로봇 밸류체인 전반에 투자합니다. 2025년 설정된 신생 펀드로 로봇 산업 초기 성장 수혜를 목표로 합니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 신생 펀드 특성상 3년 수익률 데이터가 아직 없습니다.", topHoldings:["TESLA INC","로보티즈","UBTECH ROBOTICS CORP","MDA Space Ltd","레인보우로보틱스"] },
  { id:"f3", name:"삼성미국S&P500인덱스증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:3, return1Y:35.14, return3Y:95.62, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"미국 S&P500 지수 추종, 안정적 장기 성장", aum:"1,397억", manager:"삼성자산운용", inception:"2016-03", strategy:"미국 S&P500 지수를 추종하는 패시브 펀드입니다. 미국 대형주 500개에 분산 투자해 안정적인 장기 성장을 추구합니다. 환헤지 미적용으로 달러 자산 효과도 있습니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 금융소득으로 합산되며, 장기 보유 시 복리 효과가 극대화됩니다.", topHoldings:["NVIDIA CORP","APPLE INC","iShares Core S&P 500 ETF","MICROSOFT CORP","AMAZON.COM INC"] },
  { id:"f4", name:"삼성글로벌액티브TDF2050증권UH[주식혼합]-A", type:"펀드", riskGrade:3, return1Y:39.92, return3Y:87.05, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"2050 은퇴 목표 자동 리밸런싱", aum:"2,110억", manager:"삼성자산운용", inception:"2019-02", stars:5, strategy:"2050년 은퇴를 목표로 설계된 TDF입니다. 현재는 주식 비중이 높고, 은퇴 시점이 가까워질수록 채권 비중이 자동으로 높아집니다. 별도 리밸런싱 없이 생애주기에 맞게 운용됩니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 장기 운용 특성상 복리 효과가 크며, 은퇴 설계 목적에 최적화되어 있습니다.", topHoldings:["KODEX200액티브","KODEX 미국S&P500(H)","KODEX미국AI전력핵심인프라","VANGUARD INFO TECH ETF","ROUNDHILL GEN AI & TECH FLYER"] },
  { id:"f5", name:"삼성밸류라이프플랜65증권전환형자투자신탁[주식]-A", type:"펀드", riskGrade:3, return1Y:149.82, return3Y:182.58, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", desc:"국내 우량주 장기 가치투자, 은퇴 설계형", aum:"8.91억", manager:"삼성자산운용", inception:"2002-11", stars:4, strategy:"국내 우량주에 장기 투자하는 은퇴 설계형 펀드입니다. 65세 은퇴를 목표로 안정적인 가치주 중심으로 운용되며, 국내 대형 우량주의 배당과 성장을 동시에 추구합니다.", taxBenefit:"국내주식 매매차익은 비과세 적용됩니다. 배당소득은 15.4% 원천징수이며, 종소세 대상 고객에게 절세 효과가 있습니다.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","LG에너지솔루션","현대차"] },
  { id:"f6", name:"삼성달러표시단기채권증권자투자신탁UH[채권]-A", type:"펀드", riskGrade:4, return1Y:15.99, return3Y:34.16, bucket:"위험헷지", isInstantRedeem:true, taxType:"채권형", desc:"달러 단기채권, 환율 헷지 + 금리 방어", aum:"916억", manager:"삼성자산운용", inception:"2016-01", stars:4, strategy:"달러 표시 단기채권에 투자합니다. 환헤지를 적용하지 않아 달러 강세 시 환차익도 기대할 수 있습니다. 주식시장 하락 시 방어 역할과 동시에 달러 분산 효과를 제공합니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 채권 이자수익이 금융소득에 합산되며, 달러 환차익은 별도 과세됩니다.", topHoldings:["HYUELE 5 1/2 01/16/27","HYUCAP 5 1/4 01/22/28","POHANG 4 7/8 01/23/27","T3 3/4 04/30/27","HYUSEC 2 1/8 11/01/26"] },
  { id:"f7", name:"삼성밸류라이프플랜35증권전환형자투자신탁[채권혼합]-A", type:"펀드", riskGrade:4, return1Y:21.78, return3Y:32.49, bucket:"위험헷지", isInstantRedeem:true, taxType:"해외주식형", desc:"채권 65% 혼합, 주식 하락 시 완충", aum:"4.81억", manager:"삼성자산운용", inception:"2002-11", strategy:"채권 65%, 주식 35%로 구성된 혼합형 펀드입니다. 주식 하락기에 채권이 완충 역할을 하며 포트폴리오 전체의 변동성을 낮춥니다. 안정성과 수익성의 균형을 추구합니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 채권 비중이 높아 금융소득 발생 규모가 상대적으로 낮습니다.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","LG에너지솔루션","현대차"] },
  { id:"f9", name:"삼성배당플러스30증권자투자신탁Ⅱ[채권혼합]-A", type:"펀드", riskGrade:5, return1Y:35.05, return3Y:45.67, bucket:"인컴창출", isInstantRedeem:true, taxType:"국내주식형", desc:"채권 70% + 배당주 30%, 낮은위험 수익형", aum:"18.78억", manager:"삼성자산운용", inception:"2005-01", stars:4, strategy:"채권 70%에 배당주 30%를 혼합한 안정형 펀드입니다. 낮은 변동성으로 안정적인 수익을 추구하며, 배당주에서 정기적인 인컴도 기대할 수 있습니다. 즉시환매가 가능해 유동성도 확보됩니다.", taxBenefit:"국내주식 매매차익은 비과세이며, 채권 이자소득과 배당소득은 15.4% 원천징수됩니다.", topHoldings:["삼성전자","SK하이닉스","삼성전자우","현대차","SK스퀘어"] },
  { id:"f10", name:"삼성코리아초단기우량채권증권자투자신탁[채권]-C", type:"펀드", riskGrade:6, return1Y:1.75, return3Y:9.81, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", desc:"AAA 단기채권, 즉시환매 가능 안전 주차", aum:"1,116억", manager:"삼성자산운용", inception:"2016-05", strategy:"국내 AAA 등급 초단기 우량채권에만 투자합니다. 원금 손실 위험이 극히 낮고 즉시환매가 가능해 단기 여유 자금 주차에 최적입니다. 예금보다 높은 유동성을 제공합니다.", taxBenefit:"이자소득에 15.4% 원천징수가 적용됩니다. 단기 운용 특성상 금융소득 발생 규모가 제한적입니다.", topHoldings:["한국전력 1448","국민은행 4411","하나금융지주 69-1","기업은행 2508","우리금융지주 15-1"] },
  { id:"f13", name:"삼성우량주장기증권자투자신탁[주식]-A", type:"펀드", riskGrade:2, return1Y:210.92, return3Y:258.76, bucket:"자본증식", isInstantRedeem:false, taxType:"국내주식형", desc:"국내 주식 매매차익 비과세, 종소세 절감", aum:"163억", manager:"삼성자산운용", stars:4, strategy:"삼성전자, SK하이닉스 등 국내 대형 우량주에 장기 투자합니다. 국내주식 매매차익 비과세 특성을 활용해 금융소득을 줄이면서 동시에 성장 수익도 추구합니다.", taxBenefit:"국내주식 매매차익이 비과세되어 금융소득에 합산되지 않습니다. 종소세 대상 고객이 금융소득을 줄이면서 수익을 추구할 수 있는 핵심 절세 상품입니다.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","현대차","LG에너지솔루션"] },
  { id:"f14", name:"삼성코스닥벤처플러스증권투자신탁[주식]-A", type:"펀드", riskGrade:1, return1Y:32.09, return3Y:25.31, bucket:"절세", isInstantRedeem:false, taxType:"소득공제", desc:"투자금 10% 소득공제 최대 300만원 (조특법 16조)", aum:"19.36억", manager:"삼성액티브자산운용", inception:"2018-04", isHighIncomeOnly:true, strategy:"코스닥 벤처기업의 신주, IPO, CB, BW에 투자합니다. 3년 보유 조건이 있으며, 벤처 생태계 성장 수혜를 기대할 수 있습니다. 2028년까지 세제 혜택이 연장되어 있습니다.", taxBenefit:"조세특례제한법 16조에 따라 투자금의 10%를 소득공제(최대 300만원)받을 수 있습니다. 근로소득·사업소득이 있는 고소득자에게 직접적인 세금 환급 효과가 있습니다.", topHoldings:["로킷헬스케어","액트로","알지노믹스","노타","큐리오시스"] },

  // ── 2026년 8월 삼성증권 TOP PICK 상품 (PB교육용 자료 기준, '26.7.24) ──────────
  { id:"n1", name:"다올 멀티엔진컬렉션(사모재간접)", type:"펀드", riskGrade:1, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A클래스) 선취 1.2%, 판매보수 0.45% + 성과보수(피투자펀드 이익금의 20%)", desc:"멀티 엔진 전략 기반 사모재간접 공모펀드", manager:"다올자산운용", inception:"2026-07", strategy:"CORE(절대수익·하방방어)·CORE+(안정성+초과수익)·SECTOR(산업/성장테마)·BUFFER(유동성관리) 4개 엔진으로 역할을 분산한 멀티 전략 사모재간접 펀드입니다. 상승·횡보·하락 구간별로 역할이 다른 전략군을 배치해 수익률뿐 아니라 변동성·MDD·회복력·상관관계까지 종합 반영합니다. 당사 단독 판매 상품이며, 공모펀드 규모 4,000억원 도달 시 소프트클로징 예정입니다.", taxBenefit:"국내상장주식 매매차익은 비과세, 이자/배당수익과 해외주식 매매차익은 과세됩니다.", returnNote:"2026년 7월 23일 설정(당사 단독 판매)으로 운용 개시 후 한 달 남짓 경과했습니다. 평가사는 통상 설정 후 3개월이 지나야 수익률을 산출하므로, 경과기간 부족으로 성과가 미산출된 상태입니다." },
  { id:"n2", name:"디에스 Maestro", type:"펀드", riskGrade:2, return1Y:127.04, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A클래스) 선취 1.0%, 판매보수 0.60%", desc:"비상장~상장~PE 투자까지 아우르는 국내 성장주 펀드", aum:"4,283억('26.7.24 기준)", manager:"디에스자산운용", inception:"2023-07", strategy:"작지만 빠른 변화가 일어나는 비상장부터 상장 기업, 성숙기에 접어든 기업의 PE 투자까지 폭넓게 아우릅니다. 산업 내 경쟁력 높은 기업, 구조적 매출 성장 산업, 신성장 산업 내 종목을 발굴해 중장기 수익성과 단기 모멘텀을 함께 추구합니다. 기존 주도 섹터를 무리하게 추격하기보다 보수적 운용 기조를 유지하며, 화장품·바이오·방산·우주 등 소외됐던 섹터 중 실적·모멘텀이 양호한 기업으로 관심을 확대할 계획입니다.", taxBenefit:"국내상장주식 매매차익은 비과세, 이자/배당소득은 과세됩니다.", topHoldings:["삼성전자","SK하이닉스","NH투자증권PB(DS자산)","SOL AI반도체TOP2플러스","삼성전기"] },
  { id:"n3", name:"임팩트 랩(자문: 토러스)", type:"랩어카운트", riskGrade:2, return1Y:156.5, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"[A형] 후취 연 2.6% · [B형] 선취 1.0%+후취 연 1.8% · [성과보수형] 후취 연 1.0%+성과보수", desc:"실적 반등·bottom-out 종목 편입, 성장 업종 집중투자 랩", aum:"3,084억", manager:"삼성증권(자문: 토러스자산운용)", inception:"2023-04", strategy:"실적 반등이 가시화될 종목과 bottom-out하는 종목을 편입합니다. 성장하는 업종과 종목에 집중 투자하며 업종장세에 두각을 나타내는 랩서비스로, 단위형으로만 제공되던 토러스의 임팩트 포트폴리오가 개방형으로 출시되어 체인지형에 비해 장기투자에 적합합니다. 한국 증시의 밸류업을 예상하며 추가적인 어닝이 기대되어 섹터/종목별 차별화 장세가 극대화될 전망으로, AI가 촉발한 전력수요 증가·글로벌 빅테크 생존경쟁·주주환원 정책 모멘텀·낙폭과대주·이벤트드리븐 등 다양한 Long-side 전략을 구사합니다.", taxBenefit:"랩의 국내주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", topHoldings:["삼성전자","SK하이닉스","삼성전자우","CJ","삼성물산"] },
  { id:"n4", name:"트렌드리더스 랩(자문: 보고)", type:"랩어카운트", riskGrade:2, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"[A형] 후취 연 2.6% · [B형] 선취 1.0%+후취 연 1.8% · [성과보수형] 후취 연 1.0%+성과보수", desc:"반도체 TOP2 중심 + 차기 주도주 편입 국내주식 랩", aum:"1,459억", manager:"삼성증권(자문: 보고펀드자산운용)", inception:"2025-10", strategy:"국내 주식은 물론 헤지펀드·해외사모대출·해외부동산 등 다양한 운용 전략을 보유한 사모 운용사인 보고펀드자산운용이 자문하는 국내주식 개방형 랩서비스입니다. 매크로환경과 산업구조 변화를 바탕으로 주도 섹터를 선별해 시가총액 상위 종목 중심으로 투자합니다. 반도체 실적이 강해 '반도체=주도주' 구도는 쉽게 바뀌기 어렵다고 보고 여전히 반도체 TOP2 중심으로 투자하되, 최근 반도체 소부장·바이오 관련주 등 차기 주도주도 편입해 운용 중입니다. 동일 전략 사모펀드(약 50종목)와 달리 약 15종목 내외로 3~5개 주도 섹터 내 핵심 중대형 종목에 집중 투자합니다(종목별 5~20% 비중).", taxBenefit:"랩의 국내주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", returnNote:"2025년 10월 27일 운용 개시로 1년 수익률 데이터가 아직 산출되지 않았습니다. ('26.7.24 기준 6개월 47.0%, YTD 60.9%, 누적 74.1%)", topHoldings:["삼성전자","SK하이닉스","알테오젠","후성","심텍"] },
  { id:"n5", name:"라이징스타 랩(자문: 우리)", type:"랩어카운트", riskGrade:2, return1Y:168.6, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"[A형] 후취 연 2.6% · [B형] 선취 1.0%+후취 연 1.8% · [성과보수형] 후취 연 1.0%+성과보수", desc:"대형주+중소형주 혼합, KOSPI 초과수익 추구 랩", aum:"1,063억", manager:"삼성증권(자문: 우리자산운용)", inception:"2024-03", strategy:"시장을 주도하는 섹터를 선별해 시가총액 대형주와 중소형주를 혼합 운용하는 전략으로, 시장 상황에 따라 대형주/중소형주 비중을 유연하게 조절합니다. 대형주는 업종 내 1등 기업 투자를 기본으로 KOSPI 상승률을 초과하는 포트폴리오 구성을 목표로 하며, 중소형주는 Bottom-up 기반의 개별종목 선택과 집중 투자로 알파 수익을 추구합니다. 반도체 대형 주도장세 종료 시 코스피 시총 2~3위 섹터 및 코스닥 등으로 수급 확산을 예상하며, 대형 성장주와 중소형 가치주 스타일을 혼합한 바벨 전략을 계획하고 있습니다.", taxBenefit:"랩의 국내주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", topHoldings:["삼성전자","SK하이닉스","KB금융","삼성에스디에스","신한지주"] },
  { id:"n6", name:"글로벌그로스 랩(자문: 토러스)", type:"랩어카운트", riskGrade:1, return1Y:90.2, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"[A형] 후취 연 2.6% · [B형] 선취 1.0%+후취 연 1.8%", desc:"미국 상장 대표 성장주 압축투자 해외주식 랩", aum:"3,034억", manager:"삼성증권(자문: 토러스자산운용)", inception:"2022-01", strategy:"토러스 자산운용에서 종목 자문을 받아 미국 상장 대표 성장주에 투자하는 해외주식 랩 서비스입니다. AI, 패러다임 전환 등 시대적 흐름에 맞춰 독점적 지배력을 갖췄거나 구조적 확장이 가능한 기업에 집중하며, 단순 매수 후 보유에 그치지 않고 시장 변동성에 대응해 리스크 관리를 수행합니다. 과거처럼 AI 관련 종목이 일제히 상승하는 국면이 아니라 수익화에 성공한 기업만 선별적으로 상승 중이라 보고, 반도체 부문에 주목하되 향후 AI를 실질적으로 수익화한 플랫폼 기업에 주목할 계획이며, 하반기 미국 시장의 폭이 넓어질 것으로 예상해 소프트웨어·헬스케어·금융 등 소외됐던 영역에서도 종목을 발굴할 예정입니다.", taxBenefit:"랩의 해외주식 매매차익(환차익 포함) 및 이자/배당소득은 과세됩니다.", topHoldings:["마이크론 테크놀로지","마이크로소프트","메타","스파이어 테라퓨틱스","샌디스크"] },
  { id:"n7", name:"미국 리치투게더 랩(자문: 에셋플러스)", type:"랩어카운트", riskGrade:1, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"[A형] 후취 연 2.6% · [B형] 선취 1.0%+후취 연 1.8%", desc:"에셋플러스 글로벌 플래그십 펀드 내 미국주식 압축투자 랩", aum:"730억", manager:"삼성증권(자문: 에셋플러스자산운용)", inception:"2026-01", strategy:"장기간 우수한 성과를 지속해온 에셋플러스의 글로벌 주식형 플래그십 펀드 내 미국 주식 포지션을 당사 해외주식 자문형 랩을 통해 압축 투자합니다. 반도체·데이터센터 인프라 등 글로벌 혁신기업과 일상에서 쉽게 접할 수 있는 고부가 소비재 1등 기업을 선별 투자하며, AI 관련 구조적 경쟁력을 보유한 기업 및 변화하는 매크로 환경에 능동적으로 대처하는 혁신 기업에 집중합니다. 2026년은 트럼프 2기 경제정책 수혜가 기대되는 자율주행·AI 하드웨어/소프트웨어 등 미래 혁신산업과 에너지·국방·사이버안보 등 공공 소비 영역에 투자를 주력할 예정이며, 변동성 확대 국면에 대응해 AI 하드웨어·인프라 공급망 비중을 단기적으로 축소하고 에너지·K자형 미국 소비구조·고소득층 소비 연계 산업으로 비중을 일부 재배치했습니다.", taxBenefit:"랩의 해외주식 매매차익(환차익 포함) 및 이자/배당소득은 과세됩니다.", returnNote:"2026년 1월 26일 운용 개시로 1년 수익률 데이터가 아직 산출되지 않았습니다. ('26.7.24 기준 3개월 17.4%, 누적 34.6%)", topHoldings:["마이크론 테크놀로지","어플라이드 머티어리얼즈","테크닙FMC","엔비디아","TSMC ADR"] },
  { id:"n8", name:"미국 퀀텀그로스 랩(자문: 씨스퀘어)", type:"랩어카운트", riskGrade:1, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"[A형] 후취 연 2.6% · [B형] 선취 1.0%+후취 연 1.8%", desc:"미국 장기성장 20종목 내외 압축투자 랩", aum:"276억", manager:"삼성증권(자문: 씨스퀘어자산운용)", inception:"2026-01", strategy:"미국 주식시장에서 장기 성장이 기대되는 종목 20개 내외로 압축 투자하는 전략입니다. 커버리지가 존재하는 200여개 유니버스를 기반으로 AI 밸류체인·반도체·광통신·에너지 등에 집중 투자합니다. 자문사는 향후 미국 시장이 AI 밸류체인의 병목이 해소되는 과정에서 장기 구조적 성장 사이클에 진입한다고 판단하며, 미 중간선거 이전까지 재정정책 중심 유동성 공급과 반도체 등 특정 섹터 지원 모멘텀이 유효하다고 봅니다. 상반기 IT 하드웨어 섹터 주도의 강한 상승 이후 6월 말부터 일부 차익실현, 바이오텍 섹터 내 종목 선별 투자를 예정하고 있습니다.", taxBenefit:"랩의 해외주식 매매차익(환차익 포함) 및 이자/배당소득은 과세됩니다.", returnNote:"2026년 1월 12일 운용 개시로 1년 수익률 데이터가 아직 산출되지 않았습니다. ('26.7.24 기준 6개월 19.0%, 누적 21.4%)", topHoldings:["마이크론 테크놀로지","샌디스크","AMD","메타","마벨 테크놀로지 그룹"] },
  { id:"n10", name:"AB 월지급 미국 인컴", type:"펀드", riskGrade:4, return1Y:1.01, return3Y:null, bucket:"인컴창출", isInstantRedeem:true, taxType:"채권형", minInvest:"없음", fee:"(A클래스) 선취 0.75%, 판매보수 0.5%", desc:"미국 국채+고수익채권 신용 바벨전략, 월 분배형", manager:"AB자산운용", inception:"2020-08", strategy:"미국 국채 등을 통해 안정성을 추구하는 동시에 고수익 채권 등을 통해 수익성 강화를 추구하는 신용 바벨 전략입니다. 글로벌 채권 투자에 따른 피투자펀드의 기준통화(미달러화) 환율 변동 위험 축소를 추구하는 환헤지 전략을 병행하며, AB자산운용의 분배클래스 운용 노하우를 바탕으로 분배금 변동의 최소화를 추구합니다. 채권의 두 가지 주요 위험인 듀레이션과 크레딧 간 균형을 유지하는 동시에 매력적인 인컴을 제공하는 포트폴리오를 구축하며(하이일드·이머징마켓 인컴 강화, 정부채-하이일드 익스포저 분산), 25년 이상 원칙을 지켜온 포트폴리오입니다. 예상분배금(세전)은 1,000좌당 3.86원 수준(연 6.00%)입니다.", taxBenefit:"채권 매매차익, 이자/배당소득이 과세됩니다." },
  { id:"n11", name:"신한 MAN 글로벌 투자등급 채권 월배당", type:"펀드", riskGrade:3, return1Y:4.05, return3Y:null, bucket:"인컴창출", isInstantRedeem:true, taxType:"채권형", minInvest:"없음", fee:"(A클래스) 선취 0.8%, 판매보수 0.60%", desc:"글로벌 투자등급 회사채 70~80% 투자, 월 분배형", manager:"신한자산운용(피투자펀드 운용사: MAN그룹)", inception:"2023-04", strategy:"글로벌 투자등급 회사채에 70~80% 투자하고, 주로 BB- 이상의 하이일드에 선별 투자합니다. 피투자펀드 운용사인 MAN 그룹은 런던거래소 상장 200년 역사의 종합운용사로 운용자산 USD 213.9Bil(약 KRW 300조원) 규모이며, 8.7년간 경쟁 펀드 대비 평균 연 6.9% 초과 성과를 달성한 알파 매니저 Jonathan Golan이 이끕니다. 지역별로는 미국 투자등급 선호를 유지하는 가운데 유럽 및 일부 신흥국 우량 크레딧에서도 선별적 투자 기회를 모색하며, 획일적인 금리 방향성보다 국가별·섹터별 차별화된 접근으로 대응할 계획입니다. 예상분배금(세전)은 1,000좌당 5.00원 수준(연 6.12%)입니다.", taxBenefit:"채권 매매차익, 이자/배당소득이 과세됩니다." },
  { id:"n12", name:"KB 내일드림 초단기채(舊 KB 머니마켓 액티브)", type:"펀드", riskGrade:5, return1Y:null, return3Y:null, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", fee:"(A클래스) 선취 0.10%, 보수 0.07%", desc:"AA-이상 우량자산, 평균만기 150일 이내 초단기 펀드", aum:"13,935억원('26.7.24 기준)", manager:"KB자산운용", inception:"2023-08", strategy:"채권 AA- 이상, CP/단기사채 A2- 이상 우량 자산에 투자합니다. 평균 만기 최대 150일 수준 이내 초단기 포트폴리오로 낮은 변동성을 추구하며, 익일 설정/익일환매·7영업일 유동성 규제 적용 등 MMF에 준하는 환금성을 제공합니다. 우량 단기채권, CD, CP, 정기예금 등 금리 민감도가 낮은 초단기 자산에 투자해 금리 리스크를 최소화하며, 일반 채권형보다 하루 빠른 익영업일 환매로 단기 자금 운용에 활용 가능합니다.", taxBenefit:"채권 매매차익, 이자/배당소득이 과세됩니다.", returnNote:"'26.7.24 기준 1개월 0.28%, 3개월 0.71%, 6개월 1.42%, YTD 1.65%, 누적(설정 2023.8~) 10.35% — 1년 수익률 수치는 자료에서 확인되지 않았습니다. 최소가입금액도 자료에서 확인되지 않아 비워뒀습니다." },
  { id:"n13", name:"대신 내일출금 단기채", type:"펀드", riskGrade:5, return1Y:null, return3Y:null, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", fee:"(A클래스) 선취 0.20%, 판매보수 0.15%", desc:"평균 듀레이션 6개월 내외 익일출금 단기채 펀드", aum:"1,185억원('26.7.24 기준)", manager:"대신자산운용", inception:"2025-05", strategy:"환매주기는 짧고(익일 출금), 초단기채 대비 높은 수익을 추구합니다. 평균 듀레이션 6개월 내외 및 단기 시장금리 예측을 통해 안정적인 수익을 추구하며, 금리 하락 시 시가평가 적용을 통한 자본이득도 추구합니다. 8월 금리 인상 가능성을 완전히 배제하지 않고 운용할 계획이며, 듀레이션은 0.25년 내외의 보수적인 수준을 유지하면서 기준금리 인상 기대가 상당 부분 반영된 우량 크레딧 자산 중심으로 캐리 수익을 확보하는 전략을 지속할 계획입니다.", taxBenefit:"채권 매매차익, 이자/배당소득이 과세됩니다.", returnNote:"'26.7.24 기준 1개월 0.27%, 3개월 0.73%, 6개월 1.42%, YTD 1.70%, 누적(설정 2025.5~) 3.28% — 1년 수익률 수치는 자료에서 확인되지 않았습니다. 최소가입금액도 자료에서 확인되지 않아 비워뒀습니다." },
  { id:"n14", name:"삼성 달러표시 초단기채권(USD)", type:"펀드", riskGrade:5, return1Y:null, return3Y:null, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", fee:"(C클래스) 선취 없음, 보수 0.30%", desc:"KP물·한미 단기채 등에 투자하는 달러표시 초단기채권", aum:"732억원('26.7.24 기준)", manager:"삼성자산운용", inception:"2025-09", strategy:"'미국달러(USD)'로 '초단기 채권형 자산'에 투자하는 환금성 우수한 안정형 펀드입니다. 짧은 설정/환매 주기로 투자자에게 우수한 환금성을 제공하며, 우량 등급을 가진 초단기 채권형 자산에 투자해 안정적 운용을 추구합니다. 기존 달러(USD) 상품 대비 차별화된 높은 수익률 및 투자 편의성 제공을 목표로 합니다. 다만 달러표시 상품이라 원화 환산 시 환율 변동에 따라 원금이 달라질 수 있어, 설정/환매가 빠르다는 점만으로는 '원금 그대로 꺼내 쓸 수 있는가'라는 유동성의 정의를 완전히 충족하지 못합니다.", taxBenefit:"채권 매매차익, 이자/배당소득이 과세됩니다.", returnNote:"'26.7.24 기준(연환산) 1개월 3.52%, 3개월 3.95%, 6개월 3.72%, YTD 3.82%, 누적 3.97% — 1년 수익률 수치는 자료에서 확인되지 않았습니다. 최소가입금액도 자료에서 확인되지 않아 비워뒀습니다." },

  // ── 2026년 8월 삼성증권 펀드 라인업 (PB교육용 자료 기준, '26.7.24) ──────────
  { id:"m1", name:"타임폴리오 위드타임(사모재간접)", type:"펀드", riskGrade:3, return1Y:39.34, return3Y:null, bucket:"위험헷지", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A클래스) 선취 1.0%, 판매보수 0.60% + 성과보수(피투자펀드 이익금의 20%)", desc:"롱숏 전략 기반 사모재간접 공모펀드 — 시장상황과 무관한 절대수익 추구", aum:"10,967억원('26.7.24 기준)", manager:"타임폴리오자산운용", inception:"2019-09", strategy:"'잃지 않는 투자'를 목표로 절대수익을 추구하는 타임폴리오자산운용의 Flagship 펀드인 타임폴리오 The Time 시리즈에 투자하여 그 성과를 추구하는 공모펀드입니다. 지수 변동성 확대 국면에서도 하방리스크를 철저히 통제하며 안정적인 수익을 누적해 나가는 데 최선을 다할 계획입니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 그 외 소득은 과세됩니다.", topHoldings:["TIMEFOLIO ABSOLUTE RETURN FEEDER FUND"] },
  { id:"m2", name:"유진 더블유 스마트픽(사모재간접)", type:"펀드", riskGrade:1, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(S클래스) 선취 1.2%, 판매보수 0.44%", desc:"8개 사모펀드+2개 공모펀드 재간접 멀티전략 펀드", manager:"유진자산운용", inception:"2026-03", strategy:"더블유자산운용의 사모펀드를 재간접으로 편입한 공모펀드(8개 사모펀드+2개 공모펀드)입니다. 유동성 관리 차원에서 공모펀드 규모 약 1,300억원 도달 시 소프트클로징 예정이며, 더블유자산운용의 다양한 전략을 다양성과 집중도를 고려해 균형있게 분산 편입합니다. 소액가입금액으로 매입이 어려운 사모펀드를 공모펀드에 담아 소액으로 다양한 사모펀드에 간접 분산투자할 수 있으며, 더블유자산운용의 발굴 능력과 유진자산운용의 리스크 관리 체계로 고수익을 도모하고, 사모펀드 성과보수를 공모펀드 기준가격에 합리적으로 반영하는 산정 프로세스를 마련했습니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", returnNote:"2026년 3월 26일 설정으로 운용 개시 후 경과 기간이 짧아 수익률이 아직 산출되지 않았습니다. 사모펀드 재간접 구조로, 개별 피투자펀드별 목표수익률(성과보수 기준 12~20%)만 제시돼 있습니다." },
  { id:"m3", name:"빌리언폴드 Billion Beat -ZB", type:"펀드", riskGrade:1, return1Y:20.0, return3Y:44.1, bucket:"위험헷지", isInstantRedeem:true, taxType:"국내주식형", minInvest:"5억원", fee:"(A클래스) 선취 1.0%, 판매보수 0.60% + 성과보수(운용성과의 20%, High Water Mark)", desc:"마켓뉴트럴 롱/숏 전략, 시장상황과 무관한 절대수익 추구", inception:"2018-01", strategy:"마켓뉴트럴(Market Neutral) 롱/숏 전략을 기본으로 시장상황과 관계없이 절대수익을 추구합니다. 한번에 높은 수익보다 장기적으로 수익률을 꾸준히 쌓아 나가는 것을 목표로 하며, Multi-Manager 운용시스템과 독자적 시스템(BBAS, Billionfold Book Allocation System)으로 철저한 리스크 관리 및 변동성 제한을 추구합니다. 5년 이상 지속되어온 마켓뉴트럴 펀드로 5~8% 수준의 철저한 변동성 관리하에 시장에 대응하고 있으며, 고금리장기화 및 구조적 인플레이션, 컬리 피로감 등에 따른 베타수익 기대약화로 마켓뉴트럴 전략의 헤지펀드 수요 확대에 대응합니다.", taxBenefit:"국내상장주식 양도차익은 비과세이며, 해외상장주식 매매·배당 등 그 외 자산은 과세됩니다.", returnNote:"자료상 '상품정보'란에는 설정일이 2026년 8월 14일로 표기돼 있으나, 운용성과 차트 각주에는 '설정일(2018.01.15) 이후'로 표기돼 있어 두 날짜가 일치하지 않습니다 — 확인 후 정정이 필요합니다." },
  { id:"m4", name:"더제이 파트너롱숏 플러스 제4호", type:"펀드", riskGrade:1, return1Y:148.8, return3Y:266.1, bucket:"위험헷지", isInstantRedeem:true, taxType:"국내주식형", minInvest:"3억원", fee:"(A클래스) 선취 1.0%, 판매보수 0.5% + 성과보수(운용성과의 10%, High Water Mark)", desc:"국내 상장주식 롱숏 + 채권형ETF 활용 절대수익 추구", manager:"더제이자산운용", inception:"2016-11", strategy:"국내 상장주식 대상 펀더멘탈 분석 기반 롱숏을 주전략으로 하며, 채권 및 채권형ETF(약 30% 수준), 이벤트드리븐(IPO, M&A, 분할 등)을 보조전략으로 활용해 추가수익을 추구합니다. 시황에 따른 탄력적인 Long/Short 포지션 비중 조절로 시장 변동성 속에서도 절대수익을 추구하며, 섹터매니저(Sector Manager) 운용체제로 체계적인 종목선정 및 적절한 레버리지를 활용합니다. 대표포트매니저가 직접 운용하며 일관된 투자철학으로 책임감 있는 운용을 기대할 수 있고, 산업의 구조적 성장·정책수혜·PER/PBR 리레이팅 등이 기대되는 국내주식·상장ETF와 국공채·특수채·우량회사채 등에 투자합니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 해외상장주식/파생상품 매매차익, 배당 등 그 외 자산은 과세됩니다.", returnNote:"자료상 '상품정보'란에는 설정일이 2026년 3월 28일로 표기돼 있으나, 운용성과 차트 각주에는 '설정일(2016.11.24) 이후'로 표기돼 있어 두 날짜가 일치하지 않습니다 — 확인 후 정정이 필요합니다." },
  { id:"m5", name:"NH-Amundi 필승코리아", type:"펀드", riskGrade:2, return1Y:180.69, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A2클래스) 선취 1.0%, 판매보수 0.18%", desc:"기술 혁신·지속가능 국내 부품·소재·장비업체 집중투자", aum:"27,856억원('26.7.24 기준)", manager:"NH-Amundi자산운용", inception:"2019-09", strategy:"기술 혁신성과 지속가능한 사업모델을 가진 부품, 소재, 장비업체 및 글로벌 경쟁력을 갖춘 기업에 투자합니다. 대외 환경 변화에 따른 기업 역량을 지속적으로 발굴하는 Core, 각 업종 내 글로벌 경쟁력과 펀더멘탈이 견조한 기업에 투자하여 알파를 추구하는 Satellite 전략을 병행합니다. 4차 산업혁명의 핵심인 소재·부품·장비 산업에 대한 정부의 장기적 지원 및 투자 확대, 제조업 지형변화를 견인할 국내 기업에 선별 투자하며, 최근 반도체 중심의 회복세를 보이나 단기 변동성은 지속될 것으로 전망해 AI-반도체 중심의 Core 포트폴리오를 유지하는 한편 Satellite 포트폴리오를 탄력적으로 운용하며 리스크 관리에 집중할 계획입니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","LG디스플레이","이수페타시스"] },
  { id:"m6", name:"한국투자 삼성전자&하이닉스 플러스(주식)", type:"펀드", riskGrade:2, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A클래스) 선취 1.0%, 판매보수 0.51%", desc:"삼성전자·SK하이닉스 TOP2 집중투자(각 최대 25%)", aum:"879억원('26.7.24 기준)", manager:"한국투자신탁운용", inception:"2026-05", strategy:"구조적 성장이 기대되는 반도체 TOP2 중심으로 투자합니다(삼성전자, SK하이닉스 각각 최대 비중 25%). 동일 종목 편입한도 예외 적용을 위해 5% 이하 종목을 10개 이상 편입해 50% 이상 투자하며, 빠른 기술 변화에 부합하는 기업들의 자발적 성장, 기술 트렌드 및 경쟁력에 중점을 두고 종목을 선별합니다. 최근 주가 조정으로 반도체 대형주 중심의 국내 증시 가격 매력이 오히려 높아졌다고 판단하며, 실적 추정치가 단기간에 크게 조정될 가능성은 제한적이라는 점을 고려할 때 주가의 하방 경직성은 높을 것으로 판단합니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", returnNote:"2026년 5월 7일 설정으로 운용 개시 후 경과 기간이 짧아 1년 수익률이 아직 산출되지 않았습니다. ('26.7.24 기준 1개월 3.10%, YTD 40.75%)", topHoldings:["삼성전자","SK하이닉스","현대모비스","삼성물산","LS"] },
  { id:"m7", name:"타임폴리오 탑픽 EMP[주식]", type:"펀드", riskGrade:2, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", fee:"(A클래스) 선취 1.0%, 판매보수 0.60%", desc:"글로벌 상장ETF 활용 국가·섹터·스타일·테마 초분산 EMP펀드", aum:"145억원('26.7.24 기준)", manager:"타임폴리오자산운용", inception:"2026-04", strategy:"글로벌 상장 ETF를 활용해 국가, 섹터, 스타일, 테마 등 다양한 초분산 포트폴리오를 구성합니다. 시장 전체를 사는 것이 아니라 성장 기회가 있는 곳으로 이동하는 유연한 배분 전략을 구사하며, 최근 반도체 및 AI 수익률 관련 편차가 나타나고 있으나 여전히 산업의 구조적 성장 기대가 살아있다고 판단해, 현재 비중을 유지하며 새로운 주도 테마 등장 시 즉각적으로 대응할 계획입니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 해외상장주식 매매차익·배당소득은 과세됩니다.", returnNote:"2026년 4월 6일 설정으로 운용 개시 후 경과 기간이 짧아 1년 수익률이 아직 산출되지 않았습니다. ('26.7.24 기준 C클래스, 1개월 -15.81%, 누적 0.60%)", topHoldings:["TIME 자이언AI테크액티브","TIME 코리아밸류업액티브","TIME 미국나스닥100액티브","TIME 코스닥액티브"] },
  { id:"m8", name:"한국밸류 10년투자 중소형(주식)", type:"펀드", riskGrade:2, return1Y:189.65, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A클래스) 선취 1.0%, 판매보수 0.70%", desc:"내재가치 대비 저평가된 중소형 가치주 장기투자", aum:"515억원('26.7.24 기준)", manager:"한국투자밸류자산운용", inception:"2013-12", strategy:"장기 가치투자 철학을 기반으로 내재가치 대비 저평가된 중소형 가치주를 발굴하여 시장상황에 흔들리지 않고, 주가가 내재가치에 수렴할 때까지 장기 투자해 꾸준히 쌓아올리는 수익을 추구합니다. 단순히 밸류에이션이 낮은 종목이 아니라 장기 이익성장성과 경쟁력이 확인되고도 저평가된 우량 기업에 집중 투자하며, 손실회피를 최우선으로 추구합니다. 2026년 하반기는 시장 변동성이 큰 구간이 될 것으로 전망하나, 단기적인 조정과는 별개로 큰 흐름은 여전히 AI CAPEX 투자 사이클로 이어질 전망입니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", topHoldings:["삼성전자","SK하이닉스","삼성전기","SK스퀘어","한화에어로스페이스"] },
  { id:"m9", name:"한화 K제조핵심 PLUS", type:"펀드", riskGrade:2, return1Y:null, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A클래스) 선취 1.0%, 판매보수 0.63%", desc:"AI인프라·반도체·전력기기·조선·방산·로봇 등 제조업 핵심그룹 집중투자", aum:"1,468억원('26.7.24 기준)", manager:"한화자산운용", inception:"2026-03", strategy:"글로벌 산업환경 변화와 공급망 재편 흐름을 반영해 AI인프라·반도체·전력기기·조선·방산·로봇 등 주요 제조업 분야에서 경쟁력을 보유한 국내 기업에 선별 투자합니다. 구조적 성장의 중심이 되는 핵심그룹(70%)에 장기 투자하고, 새롭게 부각되는 성장그룹(30%)에 중단기 투자하는 포트폴리오를 구성합니다. 반도체 고점론과 수급 불안정으로 KOSPI가 급격히 하락한 국면이지만, AI 관련 투자는 지속될 것이라는 기존 관점을 유지하며 당분간 반도체 및 전력인프라 등 AI하드웨어 부문 비중을 높게 유지할 계획입니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", returnNote:"2026년 3월 22일 설정으로 운용 개시 후 경과 기간이 짧아 1년 수익률이 아직 산출되지 않았습니다. ('26.7.24 기준 1개월 -19.35%)", topHoldings:["삼성전자","SK하이닉스","LS","LS ELECTRIC","한화에어로스페이스"] },
  { id:"m10", name:"한국투자 다시성장코리아 1호(주식)", type:"펀드", riskGrade:2, return1Y:171.65, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"없음", fee:"(A클래스) 선취 1.0%, 판매보수 0.50%", desc:"시장의 선택(주도주) 중심 투자, 초과성과 추구", aum:"4,255억원('26.7.24 기준)", manager:"한국투자신탁운용", inception:"2017-08", strategy:"주도주 중심 투자로 초과 성과를 추구합니다. 주도주는 시장대비 초과성과를 낸 종목으로, 매니저의 개인적 판단이 아닌 시장의 선택에 의해 결정합니다. 성장산업과 주도주의 교집합에 투자해 수익률을 극대화하며, 성장성 없이 저평가된 유형은 투자대상에서 제외하고 종목별 손절매를 통해 절대 손실 규모를 제한합니다. 당분간 반도체 비중을 높게 유지할 계획이며, 그간 부진했던 전력기기·방산·조선·원전·ESS 섹터에서도 Bottom-up 관점의 종목별 투자기회를 찾아보고자 합니다.", taxBenefit:"국내상장주식 매매차익은 비과세이며, 이자/배당소득은 과세됩니다.", topHoldings:["삼성전자","SK하이닉스","브이엠","LG에너지솔루션","삼성바이오로직스"] },
  { id:"m11", name:"라이프 Engagement 1호", type:"펀드", riskGrade:2, return1Y:141.1, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"국내주식형", minInvest:"3억원", fee:"(A클래스) 선취 1.0%, 판매보수 0.40% + 성과보수(운용성과의 15%, High Water Mark)", desc:"주주협력주의(Engagement) 전략으로 저평가 자산 재평가 추구", manager:"라이프자산운용", inception:"2023-09", strategy:"국내 상장기업 중 ESG 개선을 통한 기업가치 향상 가능성이 있는 저평가 기업을 선별 투자합니다. 주주협력주의(Engagement) 전략으로 저평가된 자산의 재평가를 통해 수익을 추구하며, 가치투자와 책임투자를 기반으로 장기적 관점에서 재무지표·비즈니스 모델·경영진 철학·사회적 요구 등을 종합적으로 고려해 종목을 선정합니다. 전통적 저평가 기업 선정 및 지분확보 → 기업체질개선·시장 인식변화를 위한 솔루션 제안 → 기업가치 상승 순으로 이어지며, 시장 평균대비 활발히 거래되는 종목 중 약 20~40개를 선별 투자합니다.", taxBenefit:"국내상장주식/장내파생상품 매매차익은 비과세이며, 해외상장주식 매매차익·배당 등 그 외 자산은 과세됩니다." },
];

// ── 버킷 배정 원칙 ────────────────────────────────────────────────────────
// (2026-09 개정) 예전엔 위험등급 범위를 버킷의 "입장 자격"으로 써서, 위험등급이
// 그 범위를 벗어나면 무조건 위반으로 잡는 가드레일이 있었다. 그런데 버킷은 "고객
// 자금의 용도"(성장/인컴/방어/유동성/절세)이고 위험등급은 그 용도 안에서 어떤 상품을
// 고를지의 기준일 뿐이라, 순서가 뒤집힌 규칙이었다 — 안정적인 배당형 펀드(예: f9)가
// "위험등급이 너무 낮다"는 이유로 인컴창출에서 튕겨나가는 등 실제 상품 성격과 반대
// 방향으로 작동하는 사례가 쌓여 예외 처리가 계속 늘어났다. 그래서 위험등급 기반의
// 버킷 "게이트"는 완전히 제거했다. 버킷은 오직 상품의 실제 전략·수익 성격(전략
// 설명에 배당·이자·인컴이 명시돼 있는지, 성장/집중투자인지, 하락 방어형인지, 즉시
// 현금화 가능한지, 세제혜택이 상품 고유의 것인지)만으로 정한다. 위험등급은 버킷
// 배정과 무관하게 모든 카드·모달에 그대로 표시되고, calcScore의 stabilityScore
// 항목을 통해 "같은 버킷 안에서 어떤 상품이 고객 위험성향에 더 맞는지" 점수에는
// 계속 반영된다 — 즉 위험등급은 버킷을 정하는 기준이 아니라 버킷 안에서 상품
// 우선순위를 정하는 기준으로 위치가 바뀐 것이다.

// ── 절세 버킷 배정 무결성 규칙 ─────────────────────────────────────────────
// 절세 버킷은 원래 "비과세연금/분리과세/소득공제"처럼 세제혜택 자체가 상품의 핵심인
// taxType 전용 칸이다. 그런데 "국내주식형/해외주식형/채권형"은 자본증식·인컴창출·유동성
// 등 다른 버킷에도 널리 쓰이는 범용 taxType이라, 이런 taxType을 가진 상품이 절세에
// 들어가려면 "왜 같은 taxType의 다른 상품들과 달리 이 상품만 절세인지"가 코드에
// 명시적으로 남아 있어야 한다(예: f13 — 같은 국내주식형·2등급 랩·펀드 13개는 전부
// 자본증식/인컴창출인데 f13만 절세다). 이 사유가 비어 있으면 나중에 똑같은 taxType의
// 다른 상품이 절세에 잘못 추가되거나, f13이 왜 절세인지 아무도 설명 못 하는 상황을 막는다.
const TAX_BUCKET_EXEMPT_TYPES: TaxType[] = ["비과세연금", "분리과세", "소득공제"];

function validateTaxBucketExceptions(products: Product[]): string[] {
  const violations: string[] = [];
  for (const p of products) {
    if (p.bucket !== "절세") continue;
    if (TAX_BUCKET_EXEMPT_TYPES.includes(p.taxType)) continue; // 절세 전용 taxType — 예외 사유 불필요
    if (!p.taxBucketExceptionReason) {
      violations.push(`[${p.id}] ${p.name} — taxType "${p.taxType}"은 절세 전용이 아닌데 taxBucketExceptionReason이 없습니다.`);
    }
  }
  return violations;
}

const TAX_BUCKET_EXCEPTION_VIOLATIONS = validateTaxBucketExceptions(PRODUCTS);
if (TAX_BUCKET_EXCEPTION_VIOLATIONS.length > 0) {
  console.error(
    `[tab5] 절세 버킷 예외 사유 누락 ${TAX_BUCKET_EXCEPTION_VIOLATIONS.length}건:\n` +
    TAX_BUCKET_EXCEPTION_VIOLATIONS.map((v) => `  - ${v}`).join("\n")
  );
}

// ── 펀드 버킷 배정 — 판단 근거를 남겨둔 항목들 ──────────────────────────────
// (2026-09 위험등급 게이트 제거 이후 재정리)
// - f5(삼성밸류라이프플랜65, 자본증식으로 재배정): 처음엔 상품 설명의 "국내 대형 우량주의
//   배당과 성장을 동시에 추구합니다"라는 문구 때문에 인컴창출에 남겨뒀었다. 그러나 이 문구엔
//   배당수익률·배당주 편입비중 같은 숫자가 전혀 없어 m8·m11(가치주 언어만 있고 배당 언급 없음)과
//   실질적으로 다르지 않다는 지적을 받고 재검토했다. 웹 리서치로도 이 펀드가 실제 분배형(정기
//   분배금 지급)인지 확인되는 자료를 찾지 못했다 — 오히려 삼성자산운용의 "밸류라이프플랜" 계열엔
//   별도의 "안정형(채권)" 자매펀드가 있어, "65"는 배당 특화가 아니라 주식형 내에서의 위험도 등급을
//   가리키는 것으로 보인다. "은퇴 설계형"도 안정 지향 판매 문구일 뿐 현금흐름 근거는 아니다.
//   확인되지 않는 배당 근거를 이유로 인컴창출에 남겨두는 것보다, m8·m11과 같은 논리(배당 언급이
//   구체적 수치 없이 서술적으로만 있으면 자본증식)로 통일하는 게 맞다고 판단해 옮겼다. 위험등급이
//   3등급으로 m8·m11(2등급)보다 한 단계 낮은 건 사실이지만, 위험등급은 버킷 배정 기준이 아니므로
//   이동 여부와는 무관하다.
// - f3(삼성미국S&P500인덱스, 자본증식): S&P500을 그대로 추종하는 패시브 펀드로, 배당·이자
//   서사도 방어 서사도 없는 순수 성장추종 상품이다. 위험등급이 3등급이라 예전 게이트
//   기준으로는 자본증식에 못 들어갔지만, 게이트를 없앤 지금은 전략 성격 그대로 자본증식으로
//   재배정했다.
// - f4(삼성글로벌액티브TDF2050, 자본증식): 상품 설명에 "현재는 주식 비중이 높고, 은퇴
//   시점이 가까워질수록 채권 비중이 자동으로 높아진다"고 명시돼 있다. 지금 이 상품에
//   들어가는 고객 돈은 사실상 글로벌 주식형이라, "은퇴 목적"이라는 이름에 끌려 인컴창출에
//   뒀던 걸 자본증식으로 재배정했다.
// - f13(삼성우량주장기, 자본증식): "국내주식 매매차익 비과세"는 국내주식형 펀드 전체의
//   공통 속성이라 이 상품만의 절세 근거로는 약하다. 상품 설명도 "성장 수익도 추구"라고
//   명시돼 있어 자본증식으로 재배정했다. 절세 버킷(펀드)엔 소득공제라는 상품 고유의
//   세제혜택이 있는 f14만 남는다.
// - n1(다올 멀티엔진컬렉션, 자본증식): CORE(하방방어)·BUFFER(유동성관리) 등 방어적 엔진이
//   섞인 복합전략이지만, 전체 목적이 "여러 엔진을 조합한 수익 추구"라 자본증식 유지가 무리는 아님.
// - m1·m3·m4(위험헷지): 전부 "시장상황과 무관한 절대수익" 롱숏/마켓뉴트럴 전략으로 서술이
//   거의 동일하다. 위험등급은 다르지만(m1=3등급, m3·m4=1등급 — 1등급은 사모재간접 구조
//   특유의 복잡성·환금성 리스크 때문이지 전략 자체의 변동성이 아니다) 위험등급 게이트가
//   없어졌으니 셋 다 같은 위험헷지로 묶었다.
// - f9(삼성배당플러스30)·n10(AB 월지급 미국 인컴)은 위험등급이 낮다는 이유로 각각
//   유동성·위험헷지에 있었으나, 상품명·설명 모두 배당·월분배 인컴 상품임을 명시하고 있어
//   인컴창출로 재배정했다. 위험등급이 낮은 건 상품이 저위험이기 때문이지 버킷이 잘못된
//   게 아니다.

// ── 채권 상품 (버킷 매칭 엔진과 분리) ────────────────────────────────────────
// 개별 채권은 신용등급(AA+, BBB- 등)만 주어지고 앱의 위험등급(1~6)이 매겨져 있지 않다.
// 업계 표준 신용등급→위험등급 환산표는 삼성증권 자체 기준과 한 등급 정도 차이가 날 수 있어
// (실제 값은 상품 제안서·전산 화면 기준), 여기서는 위험등급을 계산·부여하지 않고
// 신용등급·만기·수익률 원자료만 그대로 표시한다. 고객 성향 기반 버킷 배분에도 편입하지 않는다.
type BondMarket = "국내" | "해외";

interface Bond {
  id: string; name: string; market: BondMarket;
  creditRating: string; maturity: string;
  yieldPretax: number | null;   // 개인 원천징수세전(%) — PB교육용 라인업 자료 기준 항목
  yieldMaxTax: number | null;   // 개인 최고세율 적용시(%) — PB교육용 라인업 자료 기준 항목
  yieldCorporate: number | null; // 법인세전(%)
  yieldRangeText?: string;      // 개별 수치 대신 범위로만 제공되는 경우(예: 단기사채)
  note?: string;
  // 전산 조회 화면 기준 항목(국민주택채권·국고채) — 위 개인세전/최고세율 항목 대신 이쪽을 쓴다
  tradeYield?: number;          // 매매단가(매매금리) — 조회 시점 시장 호가수익률
  bankConvertedYield?: number;  // 은행환산세전수익률
  couponRate?: number;          // 표면이율(%)
  riskGrade: number;             // 전산 위험등급(1~6) — 계산이 아니라 전산 화면에 찍힌 값 그대로. 카드 기본 표시는 이 값 기준.
  quoteDate?: string;           // 조회기준일시
  // 버킷 편입용 필드 — 아직 미배정(optional). 값이 채워진 채권만 버킷 매칭 엔진에 편입한다.
  bucket?: BucketType;          // 유동성/인컴창출/절세 3개만 사용 예정(위험헷지·자본증식 제외 합의)
  isInstantRedeem?: boolean;    // 유동성 버킷의 liquidityScore 계산에 필요
  taxType?: TaxType;            // 절세 버킷의 taxScore 계산에 필요 — "채권형"을 표면이율로 세분화하기 전까지는 잠정값
  isSubordinated?: boolean;     // 신종자본증권/영구채 여부 — 위험등급이 신용등급만으로 안 잡히는 구조적 리스크가 있어 카드에 "별도 확인 필요"로 표시
  // ── 이자소득세 계산용 필드 (세무 로직 전용 — 위 필드들은 화면 표시·버킷 매칭용) ──
  issuerCountry?: "한국" | "미국" | "브라질";  // 발행국 — market(국내/해외)과 다른 개념. 브라질 국채는 market:"해외"지만
                                              // 세율은 미국채와 다름(조세조약상 이자 비과세)이라 반드시 구분해야 함.
  couponType?: "이표채" | "복리채" | "할인채"; // 없으면 이표채로 간주(대부분의 이표부 채권 기본값)
  isPerpetual?: boolean;        // 신종자본증권(영구채) — 이자소득세 계산 범위 제외(콜옵션 미행사 시 만기가 불확정이라
                                // 일반 이표채 공식으로 세전/세후를 단정할 수 없음). isSubordinated와 별개로 명시.
  maturityDate?: string;        // ISO(YYYY-MM-DD) — BONDS_WITH_MATURITY에서 name/maturity 문자열로부터 파생, 직접 입력 안 함
}

const CATALOG_ASOF_DATE = "2026-07-24"; // 해외채권·국내 크레딧/단기채 라인업 공통 기준일(각 섹션 주석 참고)
                                         // — quoteDate가 없는 항목의 잔존만기(년/개월) 파싱 기준일로 사용

// 채권의 만기일(ISO)을 최대한 실제 데이터에서 파생시킨다(임의 추정 금지):
// 1순위 maturity 문자열에 박힌 절대날짜(YYYY-MM-DD, 예: "4년 11개월(2031-08-31)")
// 2순위 종목명에 박힌 MM/DD/YY(예: "T 1.125 10/31/26", "BNTNF 10 01/01/27")
// 3순위 "N년 M개월" 형태의 잔존기간을 기준일(quoteDate 우선, 없으면 CATALOG_ASOF_DATE)에 더해 근사
function deriveMaturityDate(b: Bond): string | undefined {
  const absInMaturity = b.maturity.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (absInMaturity) return absInMaturity;
  const nameDate = b.name.match(/(\d{2})\/(\d{2})\/(\d{2})(?:\D|$)/);
  if (nameDate) {
    const [, mm, dd, yy] = nameDate;
    return `${2000 + parseInt(yy, 10)}-${mm}-${dd}`;
  }
  const yearMatch = b.maturity.match(/(\d+(?:\.\d+)?)\s*년/);
  const monthMatch = b.maturity.match(/(\d+)\s*개월/);
  const years = yearMatch ? parseFloat(yearMatch[1]) : 0;
  const months = monthMatch ? parseInt(monthMatch[1], 10) : 0;
  if (!years && !months) return undefined;
  const base = new Date(b.quoteDate ?? CATALOG_ASOF_DATE);
  base.setMonth(base.getMonth() + Math.round(years * 12 + months));
  return base.toISOString().slice(0, 10);
}

const BONDS_RAW: Bond[] = [
  // 해외채권 라인업 ('26.7.24 기준)
  { id:"b1", name:"미국국채 T 1.125 10/31/26", market:"해외", creditRating:"AA+", maturity:"3개월", riskGrade:3, bucket:"유동성", couponRate:1.125, issuerCountry:"미국", yieldPretax:3.55, yieldMaxTax:5.15, yieldCorporate:3.15, note:"달러(USD) 표시 채권이라 즉시 현금화는 가능하지만, 원화 환산 시 환율 변동에 따라 원금이 달라집니다 — '원금 그대로 꺼내 쓸 수 있는가'라는 유동성의 정의를 엄밀히는 완전히 충족하지 못합니다." },
  { id:"b2", name:"미국국채 T 0.5 04/30/27", market:"해외", creditRating:"AA+", maturity:"9개월", riskGrade:3, bucket:"유동성", couponRate:0.5, issuerCountry:"미국", yieldPretax:4.35, yieldMaxTax:6.95, yieldCorporate:3.75, note:"달러(USD) 표시 채권이라 즉시 현금화는 가능하지만, 원화 환산 시 환율 변동에 따라 원금이 달라집니다 — '원금 그대로 꺼내 쓸 수 있는가'라는 유동성의 정의를 엄밀히는 완전히 충족하지 못합니다." },
  { id:"b3", name:"미국국채 T 0.375 09/30/27", market:"해외", creditRating:"AA+", maturity:"1.2년", riskGrade:3, bucket:"유동성", couponRate:0.375, issuerCountry:"미국", yieldPretax:4.50, yieldMaxTax:7.30, yieldCorporate:3.90, note:"달러(USD) 표시 채권이라 즉시 현금화는 가능하지만, 원화 환산 시 환율 변동에 따라 원금이 달라집니다 — '원금 그대로 꺼내 쓸 수 있는가'라는 유동성의 정의를 엄밀히는 완전히 충족하지 못합니다." },
  { id:"b4", name:"미국국채 T 1.125 08/15/40", market:"해외", creditRating:"AA+", maturity:"14.1년", riskGrade:3, bucket:"절세", couponRate:1.125, issuerCountry:"미국", yieldPretax:6.85, yieldMaxTax:10.30, yieldCorporate:6.05, note:"잔존만기가 14.1년으로 길어, 국민주택채권 등 원화 저쿠폰물보다 금리(듀레이션) 리스크가 절세 효과에 비해 크게 작용할 수 있습니다 — 금리가 오르면 가격 손실이 절세로 아낀 금액을 넘어설 수 있습니다. 달러(USD) 표시라 환위험도 함께 있습니다." },
  { id:"b5", name:"알파벳 GOOGL 0.8 08/15/27", market:"해외", creditRating:"AA+(안정적)", maturity:"1.0년", riskGrade:3, bucket:"유동성", couponRate:0.8, issuerCountry:"미국", yieldPretax:4.10, yieldMaxTax:6.35, yieldCorporate:3.60, note:"달러(USD) 표시 채권이라 즉시 현금화는 가능하지만, 원화 환산 시 환율 변동에 따라 원금이 달라집니다 — '원금 그대로 꺼내 쓸 수 있는가'라는 유동성의 정의를 엄밀히는 완전히 충족하지 못합니다." },
  { id:"b6", name:"우리은행 WOORIB 6.375 PERP", market:"해외", creditRating:"BBB-(안정적)", maturity:"3.0년콜(영구채)", riskGrade:2, bucket:"인컴창출", isSubordinated:true, isPerpetual:true, couponRate:6.375, issuerCountry:"미국", yieldPretax:4.25, yieldMaxTax:3.00, yieldCorporate:4.55, note:"신종자본증권(영구채) — 콜옵션 미행사·이자지급유예·후순위 변제 리스크가 있어 신용등급과 별개로 위험도가 높게 평가될 수 있습니다." },
  { id:"b8", name:"브라질국채 BLTN 0 01/01/32(할인채)", market:"해외", creditRating:"BB", maturity:"5.4년", riskGrade:1, bucket:"절세", couponRate:0, couponType:"할인채", issuerCountry:"브라질", yieldPretax:22.75, yieldMaxTax:38.15, yieldCorporate:19.25, note:"실질은 헤알화(BRL) 환베팅에 가깝습니다 — 환율 변동폭이 세제 혜택보다 손익에 훨씬 크게 작용합니다. 표면금리 0%(제로쿠폰)라 수익 전부가 만기 상환차익(비과세)에서 나온다는 절세 논리는 있지만, BB등급·중개 제한 종목이라 절세 칸 안에서도 원화 저쿠폰물(국민주택채권 등) 다음의 바깥쪽 선택지로 두세요." },
  { id:"b9", name:"브라질국채 BNTNF 10 01/01/27(이표채)", market:"해외", creditRating:"BB", maturity:"5개월", riskGrade:1, bucket:"인컴창출", couponRate:10, couponType:"이표채", issuerCountry:"브라질", yieldPretax:14.30, yieldMaxTax:23.95, yieldCorporate:12.10, note:"표면금리 10%대 이표채로 이자가 꾸준히 들어오며, 한·브라질 조세협약상 이자소득이 비과세입니다(절세 성격도 겸함). 잔존만기만 보면 5개월로 유동성 조건에 가깝지만, 헤알화(BRL) 환위험과 브라질 국가위험 때문에 '원금 그대로 꺼내 쓸 수 있는가'를 충족하지 못해 유동성에서 제외했습니다. BB등급·중개 제한 종목이라, 인컴 칸 안에서도 국채→우량회사채→신종자본증권 다음의 가장 바깥쪽 선택지로 두세요." },
  // 국내채권 라인업(크레딧/단기채, '26.7.24 기준)
  { id:"b11", name:"한국투자캐피탈", market:"국내", creditRating:"A(안정적)", maturity:"0.9년", riskGrade:4, bucket:"유동성", issuerCountry:"한국", yieldPretax:4.87, yieldMaxTax:5.49, yieldCorporate:4.74 },
  { id:"b12", name:"메리츠캐피탈", market:"국내", creditRating:"A+(안정적)", maturity:"1.9년", riskGrade:4, bucket:"인컴창출", issuerCountry:"한국", yieldPretax:4.73, yieldMaxTax:4.61, yieldCorporate:4.76 },
  { id:"b13", name:"종근당홀딩스", market:"국내", creditRating:"A+(안정적)", maturity:"1.9년", riskGrade:4, bucket:"인컴창출", issuerCountry:"한국", yieldPretax:4.43, yieldMaxTax:4.35, yieldCorporate:4.45 },
  { id:"b14", name:"한국전력", market:"국내", creditRating:"AAA(안정적)", maturity:"3.3년", riskGrade:5, bucket:"인컴창출", issuerCountry:"한국", yieldPretax:4.82, yieldMaxTax:6.73, yieldCorporate:4.39, note:"절세 → 인컴창출 재분류. 기존 절세 배정 근거는 \"세전수익률(4.82%)보다 최고세율적용(과세형 등가) 수익률(6.73%)이 높다\"는 것 하나였는데, 이 비교는 표면금리가 낮은지와 무관하게 이자소득에 세금이 붙는 채권이면 구조적으로 항상 성립합니다 — 세후로 환산했을 때 같은 실수령액을 내려면 일반과세 채권은 더 높은 표면금리가 필요하기 때문입니다. 즉 \"저쿠폰이라 상환차익(비과세) 비중이 크다\"는 절세 버킷의 핵심 조건을 증명하는 지표가 아닙니다. 이 채권 자체의 정확한 표면이율(couponRate)은 데이터에 없어 직접 확인은 못 했지만, 비슷한 시기(2026년) 같은 AAA등급 국내 발행사인 KB금융지주가 실제로 발행한 회사채(3년물 4.092%, 5년물 4.264%, 한국신용평가·한국기업평가·NICE신용평가 3사 공동 AAA — 디지털데일리 2026.05.22 보도)를 참고하면, 이 신용등급·시장 구간의 회사채 표면금리는 4%대가 일반적입니다. 저쿠폰(국민주택채권 1.000%, 국고채 1.5~2.375%처럼 표면금리 자체가 낮은 채권)과는 성격이 다를 가능성이 커, 표면금리 수준의 정기 이자소득이 주된 수익원이라고 보고 인컴창출로 재분류했습니다." },
  { id:"b15", name:"KB금융지주", market:"국내", creditRating:"AAA(안정적)", maturity:"3.9년", riskGrade:5, bucket:"인컴창출", issuerCountry:"한국", yieldPretax:4.96, yieldMaxTax:7.11, yieldCorporate:4.48, note:"절세 → 인컴창출 재분류. 기존 절세 배정 근거는 \"세전수익률(4.96%)보다 최고세율적용(과세형 등가) 수익률(7.11%)이 높다\"는 것 하나였는데, 이 비교는 표면금리가 낮은지와 무관하게 이자소득에 세금이 붙는 채권이면 구조적으로 항상 성립합니다 — 세후로 환산했을 때 같은 실수령액을 내려면 일반과세 채권은 더 높은 표면금리가 필요하기 때문입니다. 즉 \"저쿠폰이라 상환차익(비과세) 비중이 크다\"는 절세 버킷의 핵심 조건을 증명하는 지표가 아닙니다. 이 채권 자체의 정확한 표면이율(couponRate)은 데이터에 없어 직접 확인은 못 했지만, 잔존만기(3.9년)와 가장 가까운 시기(2026년 5월)에 발행사 본인이 직접 발행한 실제 회사채가 3년물 표면금리 4.092%, 5년물 4.264%(한국신용평가·한국기업평가·NICE신용평가 3사 공동 AAA — 디지털데일리 2026.05.22 보도)로 확인됩니다. 이 채권은 발행 회차가 정확히 일치하진 않지만(3.9년 잔존은 두 회차 사이) 같은 발행사·같은 시기 기준이라 가장 근접한 참고치이며, 저쿠폰(국민주택채권 1.000%, 국고채 1.5~2.375%)과는 확연히 다른 4%대 표면금리 구간으로 보입니다. 표면금리 수준의 정기 이자소득이 주된 수익원이라고 보고 인컴창출로 재분류했습니다." },
  { id:"b16", name:"기업은행 신종자본증권", market:"국내", creditRating:"AA(안정적)", maturity:"1.6년콜(신종자본증권)", riskGrade:2, bucket:"인컴창출", isSubordinated:true, isPerpetual:true, issuerCountry:"한국", yieldPretax:3.64, yieldMaxTax:3.08, yieldCorporate:3.76, note:"신종자본증권 — 콜옵션 미행사·이자지급유예·후순위 변제 리스크가 있어 신용등급과 별개로 위험도가 높게 평가될 수 있습니다." },
  { id:"b17", name:"신한은행 신종자본증권", market:"국내", creditRating:"AA-(안정적)", maturity:"3.5년콜(신종자본증권)", riskGrade:2, bucket:"인컴창출", isSubordinated:true, isPerpetual:true, issuerCountry:"한국", yieldPretax:4.32, yieldMaxTax:5.10, yieldCorporate:4.14, note:"신종자본증권 — 콜옵션 미행사·이자지급유예·후순위 변제 리스크가 있어 신용등급과 별개로 위험도가 높게 평가될 수 있습니다." },
  { id:"b18", name:"iM금융지주 신종자본증권", market:"국내", creditRating:"AA-(안정적)", maturity:"4.1년콜(신종자본증권)", riskGrade:2, bucket:"인컴창출", isSubordinated:true, isPerpetual:true, issuerCountry:"한국", yieldPretax:4.55, yieldMaxTax:5.24, yieldCorporate:4.39, note:"신종자본증권 — 콜옵션 미행사·이자지급유예·후순위 변제 리스크가 있어 신용등급과 별개로 위험도가 높게 평가될 수 있습니다." },
  { id:"b19", name:"하나금융지주 신종자본증권", market:"국내", creditRating:"AA-(안정적)", maturity:"4.8년콜(신종자본증권)", riskGrade:2, bucket:"인컴창출", isSubordinated:true, isPerpetual:true, issuerCountry:"한국", yieldPretax:4.31, yieldMaxTax:4.05, yieldCorporate:4.36, note:"신종자본증권 — 콜옵션 미행사·이자지급유예·후순위 변제 리스크가 있어 신용등급과 별개로 위험도가 높게 평가될 수 있습니다." },
  { id:"b20", name:"DB손해보험 신종자본증권", market:"국내", creditRating:"AA(안정적)", maturity:"4.8년콜(신종자본증권)", riskGrade:2, bucket:"인컴창출", isSubordinated:true, isPerpetual:true, issuerCountry:"한국", yieldPretax:4.70, yieldMaxTax:4.37, yieldCorporate:4.76, note:"신종자본증권 — 콜옵션 미행사·이자지급유예·후순위 변제 리스크가 있어 신용등급과 별개로 위험도가 높게 평가될 수 있습니다." },
  // 국민주택채권 4종 (전산 조회 기준, 조회일 2026-09-01) — 국민주택채권 1종은 만기 일시상환형 복리채
  { id:"b22", name:"국민주택1종26-08", market:"국내", creditRating:"국공채", maturity:"4년 11개월(2031-08-31)", riskGrade:6, bucket:"절세", issuerCountry:"한국", couponType:"복리채", yieldPretax:null, yieldMaxTax:null, yieldCorporate:4.501, tradeYield:4.145, bankConvertedYield:5.104, couponRate:1.000, quoteDate:"2026-09-01" },
  { id:"b23", name:"국민주택1종26-07", market:"국내", creditRating:"국공채", maturity:"4년 10개월(2031-07-31)", riskGrade:6, bucket:"절세", issuerCountry:"한국", couponType:"복리채", yieldPretax:null, yieldMaxTax:null, yieldCorporate:4.460, tradeYield:4.116, bankConvertedYield:5.057, couponRate:1.000, quoteDate:"2026-09-01" },
  { id:"b24", name:"국민주택1종26-04", market:"국내", creditRating:"국공채", maturity:"4년 7개월(2031-04-30)", riskGrade:6, bucket:"절세", issuerCountry:"한국", couponType:"복리채", yieldPretax:null, yieldMaxTax:null, yieldCorporate:4.351, tradeYield:4.038, bankConvertedYield:4.931, couponRate:1.000, quoteDate:"2026-09-01" },
  { id:"b25", name:"국민주택1종26-03", market:"국내", creditRating:"국공채", maturity:"4년 6개월(2031-03-31)", riskGrade:6, bucket:"절세", issuerCountry:"한국", couponType:"복리채", yieldPretax:null, yieldMaxTax:null, yieldCorporate:4.313, tradeYield:4.012, bankConvertedYield:4.886, couponRate:1.000, quoteDate:"2026-09-01" },
  // 국고채 4종 (전산 조회 기준, 조회일 2026-09-01)
  { id:"b26", name:"국고01500-5003(20-2)", market:"국내", creditRating:"국공채", maturity:"23년 6개월(2050-03-10)", riskGrade:5, bucket:"절세", issuerCountry:"한국", yieldPretax:null, yieldMaxTax:null, yieldCorporate:5.725, tradeYield:4.452, bankConvertedYield:6.296, couponRate:1.500, quoteDate:"2026-09-01", note:"금리 하락(또는 최소 횡보) 전망을 전제로 한 픽입니다 — 잔존만기가 23년 6개월로 매우 길어 금리(듀레이션) 리스크가 절세 효과보다 손익에 훨씬 크게 작용합니다. 금리가 1%p만 올라도 가격 손실이 절세로 아낀 금액을 넘어설 수 있습니다. 다른 국고채·국민주택채권(6등급)과 달리 위험등급이 한 단계 높은 5등급으로 찍혀 있는 것도 이 때문입니다." },
  { id:"b28", name:"국고02250-2709(25-6)", market:"국내", creditRating:"국공채", maturity:"1년(2027-09-10)", riskGrade:6, bucket:"유동성", issuerCountry:"한국", yieldPretax:null, yieldMaxTax:null, yieldCorporate:3.435, tradeYield:3.456, bankConvertedYield:3.650, couponRate:2.250, quoteDate:"2026-09-01" },
  { id:"b29", name:"국고02375-2712(17-7)", market:"국내", creditRating:"국공채", maturity:"1년 3개월(2027-12-10)", riskGrade:6, bucket:"유동성", issuerCountry:"한국", yieldPretax:null, yieldMaxTax:null, yieldCorporate:3.460, tradeYield:3.458, bankConvertedYield:3.654, couponRate:2.375, quoteDate:"2026-09-01" },
  { id:"b30", name:"주택금융공사MBS2016-23(1-6)", market:"국내", creditRating:"AAA", maturity:"2개월(2026-11-04)", riskGrade:5, bucket:"유동성", issuerCountry:"한국", yieldPretax:null, yieldMaxTax:null, yieldCorporate:3.061, tradeYield:3.062, bankConvertedYield:3.243, couponRate:2.080, quoteDate:"2026-09-03" },
];

// 최종 export — 이자소득세 계산에 필요한 maturityDate를 위 데이터로부터 파생시켜 붙인다.
const BONDS: Bond[] = BONDS_RAW.map((b) => ({ ...b, maturityDate: deriveMaturityDate(b) }));

// 채권 수익률 원자료 요약 문구 — 카드/모달에서 공용으로 사용
function bondYieldSummary(b: Bond): string {
  if (b.yieldRangeText) return b.yieldRangeText;
  if (b.bankConvertedYield != null) {
    return `법인세전 ${b.yieldCorporate}% · 은행환산세전 ${b.bankConvertedYield}% · 표면이율 ${b.couponRate}%${b.quoteDate ? ` · 조회 ${b.quoteDate}` : ""}`;
  }
  return `개인 최고세율 적용시 ${b.yieldMaxTax}% · 법인세전 ${b.yieldCorporate}%`;
}

// ── 채권 → 상품 카드 변환 (버킷별 매칭 상품 섹션에 함께 편입) ──────────────────
// 버킷이 배정된 채권만 변환한다. 개별 채권은 return1Y/3Y 데이터가 없어 blended 수익률은
// 0으로 처리되는데, calcScore의 min/max 정규화 기준 배열(ALL_ITEMS)에는 이미 blended가
// 0인 상품(r5 등)이 있어 정규화 결과에 영향을 주지 않는다. 위험등급·버킷·즉시환매여부(불가)·
// 세제유형(채권형)만 실제 값이며, 신용등급·만기·수익률 등 채권 고유 정보는 bondRef에 원본 그대로 보관해
// 카드/모달에서 그대로 표시한다(직접 계산·가공하지 않음).
const BOND_PRODUCTS: Product[] = BONDS
  .filter((b): b is Bond & { bucket: BucketType } => !!b.bucket)
  .map((b) => ({
    id: b.id,
    name: b.name,
    type: "채권" as ProductType,
    riskGrade: b.riskGrade,
    return1Y: null,
    return3Y: null,
    bucket: b.bucket,
    isInstantRedeem: false,
    taxType: "채권형" as TaxType,
    desc: `${b.creditRating} · 만기 ${b.maturity}`,
    bondRef: b,
  }));

const ALL_ITEMS: Product[] = [...PRODUCTS, ...BOND_PRODUCTS];

const GENERIC_HOLDINGS = new Set([
  "미국 주식 ETF","미국 채권 ETF","글로벌 매크로 자산","미국 대형성장주","미국 중소형성장주",
  "글로벌 IT 대형주","테크 혁신 기업","미국 빅테크 주식","글로벌 반도체/소프트웨어",
  "중국 빅테크","홍콩 테크 ETF","국내 가치주","대형 우량주","주도 섹터 대형주","성장 유망주",
  "증권금융 예수금","초단기 채권","공시이율 연동 계정","채권형 운용 자산",
]);
function isRealHolding(h: string): boolean { return !GENERIC_HOLDINGS.has(h); }

function parseSingleAmount(text: string): number {
  if (!text) return 0;
  const t = text.replace(/,/g, "").replace(/\s/g, "");
  const matches = Array.from(t.matchAll(/(\d+(?:\.\d+)?)(억|천만|백만|만원|만)?/g));
  if (!matches.length) return 0;
  const total = matches.reduce((sum, m) => {
    const n = parseFloat(m[1]);
    if (m[2] === "억") return sum + n * 1e8;
    if (m[2] === "천만") return sum + n * 1e7;
    if (m[2] === "백만") return sum + n * 1e6;
    if (m[2] === "만원" || m[2] === "만") return sum + n * 1e4;
    return sum + n;
  }, 0);
  return total;
}

function parseAmount(text: string): number {
  if (!text) return 0;
  const parts = text.split(/\s*(?:~|～|〜)\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const left = parseSingleAmount(parts[0]);
    const right = parseSingleAmount(parts[1]);
    if (left > 0 && right > 0) return (left + right) / 2;
  }
  return parseSingleAmount(text);
}

function parseRegularPeriodMonths(text: string): number {
  const t = text.replace(/\s+/g, "").replace(/마다$/, "");
  if (!t) return 0;
  if (/^(매월|월|1개월)$/.test(t)) return 1;
  if (/^(격월|2개월)$/.test(t)) return 2;
  if (/^(분기|3개월)$/.test(t)) return 3;
  if (/^(반기|6개월)$/.test(t)) return 6;
  if (/^(매년|연|1년|12개월)$/.test(t)) return 12;
  const month = t.match(/^(\d+(?:\.\d+)?)개월$/);
  if (month) return parseFloat(month[1]);
  const year = t.match(/^(\d+(?:\.\d+)?)년$/);
  if (year) return parseFloat(year[1]) * 12;
  return 0;
}

function parseFutureMonths(text: string): number {
  const t = text.replace(/\s+/g, "").replace(/(?:뒤|후|이내)$/, "");
  if (!t) return 0;
  const range = t.match(/^(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)(개월|년)$/);
  if (range) {
    const midpoint = (parseFloat(range[1]) + parseFloat(range[2])) / 2;
    return range[3] === "년" ? midpoint * 12 : midpoint;
  }
  const month = t.match(/^(\d+(?:\.\d+)?)개월$/);
  if (month) return parseFloat(month[1]);
  const year = t.match(/^(\d+(?:\.\d+)?)년$/);
  if (year) return parseFloat(year[1]) * 12;
  return 0;
}

function calcLiquidityNeedScore(need: LiquidityNeed, c: Client): number | null {
  if (need.amount <= 0) return null;
  if (need.kind === "regular") {
    const months = parseRegularPeriodMonths(need.timing);
    if (months <= 0 || c.monthlyIncome <= 0) return null;
    return (need.amount / months / c.monthlyIncome) * 100;
  }
  if (need.kind === "lumpSum") {
    const months = parseFutureMonths(need.timing);
    if (months <= 0 || c.investableAssets <= 0) return null;
    const years = months / 12;
    const base = years <= 1 ? 80 : years <= 3 ? 60 : years <= 5 ? 40 : 20;
    const weight = years <= 1 ? 1.0 : years <= 3 ? 0.8 : years <= 5 ? 0.5 : 0.2;
    return base + (need.amount / c.investableAssets) * 100 * weight * 0.5;
  }
  if (c.investableAssets <= 0) return null;
  return 50 + (need.amount / c.investableAssets) * 50;
}

function calcLiquidityPriorityScore(c: Client) {
  const priorityWeights: Record<1 | 2 | 3, number> = { 1: 0.5, 2: 0.3, 3: 0.2 };
  const scored = ([1, 2, 3] as const)
    .map((priority) => {
      const need = c.liquidityNeeds.find((item) => item.priority === priority);
      if (!need) return null;
      const score = calcLiquidityNeedScore(need, c);
      if (score == null || score <= 0) return null;
      return { priority, score: Math.min(100, score), weight: priorityWeights[priority] };
    })
    .filter((item): item is { priority: 1 | 2 | 3; score: number; weight: number } => item !== null);
  const weightSum = scored.reduce((sum, item) => sum + item.weight, 0);
  if (weightSum <= 0) return 1;
  return Math.max(scored.reduce((sum, item) => sum + item.score * (item.weight / weightSum), 0), 1);
}

function collectLiquidityNeeds(rrttllu: {
  regularCashflowNeed: string;
  lumpSumPlan: string;
  emergencyReservePlan: string;
}): LiquidityNeed[] {
  const entries = [
    ...parseLiquidityEntries(rrttllu.regularCashflowNeed, "regular").map((entry) => ({ entry, kind: "regular" as const })),
    ...parseLiquidityEntries(rrttllu.lumpSumPlan, "lumpSum").map((entry) => ({ entry, kind: "lumpSum" as const })),
    ...parseLiquidityEntries(rrttllu.emergencyReservePlan, "emergency").map((entry) => ({ entry, kind: "emergency" as const })),
  ];
  return entries
    .map(({ entry, kind }) => {
      const priority = Number(entry.priority);
      if (priority !== 1 && priority !== 2 && priority !== 3) return null;
      return {
        kind,
        priority,
        amount: parseAmount(entry.amount),
        timing: entry.timing,
      };
    })
    .filter((item): item is LiquidityNeed => item !== null);
}

function representativeLumpSumYears(needs: LiquidityNeed[]) {
  const rankedLump = needs
    .filter((need) => need.kind === "lumpSum")
    .sort((a, b) => a.priority - b.priority)[0];
  const months = rankedLump ? parseFutureMonths(rankedLump.timing) : 0;
  return months > 0 ? months / 12 : 5;
}

function getBlended(p: Product) {
  if (p.return1Y == null) return p.return3Y ?? 0;
  return p.return3Y !== null ? p.return1Y * 0.7 + p.return3Y * 0.3 : p.return1Y;
}

function calcWeights(c: Client) {
  const uG = Math.max(c.targetReturn * (6 - c.riskAppetite) + c.investmentPeriod * 2, 1);
  const uI = Math.max((c.age / 100) * 50 + (6 - c.riskAppetite) * 5, 1);
  const uH = Math.max(c.riskAppetite * 15, 1);
  const uT = c.taxExcessAmount > 50_000_000 ? 200
    : c.taxExcessAmount > 0 ? 150
    : c.isTaxAlertFromTab1 ? 120
    : c.isTaxTarget ? 100 : 50;
    const uL = Math.min(calcLiquidityPriorityScore(c), uG * 0.8);
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
  if (c.taxExcessAmount > 50_000_000) {
    // 종소세 고초과 구간 — 절세 상품 쏠림을 강하게, 비절세 상품은 더 강한 페널티
    if (p.taxType==="비과세연금"||p.taxType==="분리과세") taxScore=100;
    else if (p.taxType==="국내주식형") taxScore=65;
    else if (p.taxType==="소득공제") taxScore=c.isHighIncomeWorker?85:15;
    else taxScore=5;
  } else if (c.taxExcessAmount > 0) {
    // 종소세 저초과 구간 — 절세 효과는 있되 완만하게 반영
    if (p.taxType==="비과세연금"||p.taxType==="분리과세") taxScore=85;
    else if (p.taxType==="국내주식형") taxScore=70;
    else if (p.taxType==="소득공제") taxScore=c.isHighIncomeWorker?75:30;
    else taxScore=25;
  }
  // taxExcessAmount === 0 (비대상)인 경우 taxScore=50 그대로 유지 — 세금이 상품 선택에 영향 없음
  const base = w.G*returnScore + w.I*(returnScore*0.5+stabilityScore*0.5) + w.H*stabilityScore + w.L*liquidityScore + w.T*taxScore;
  return base*0.9 + (p.bucket===w.topBucket?10:0);
}

const RISK_LEVEL_MAP: Record<number,number> = {1:1,2:2,3:3,4:4,5:4,6:5};
const RISK_LABELS: Record<number,string> = {1:"초고위험",2:"고위험",3:"중위험",4:"저위험",5:"초저위험"};
const GRADE_LABELS: Record<number,string> = {1:"매우높은",2:"높은",3:"다소높은",4:"보통",5:"낮은",6:"매우낮은"};

function isUnsuitable(p: Product, c: Client): boolean {
  return RISK_LEVEL_MAP[p.riskGrade] < c.riskAppetite;
}

function countGoodReasons(p: Product, c: Client, w: ReturnType<typeof calcWeights>): number {
  let count = 0;
  if (RISK_LEVEL_MAP[p.riskGrade] <= c.riskAppetite) count++;
  if (p.bucket === w.topBucket) count++;
  if (c.isTaxTarget && (p.taxType==="비과세연금"||p.taxType==="분리과세"||p.taxType==="국내주식형")) count++;
  if (!p.isInstantRedeem && c.investmentPeriod >= 3) count++;
  if (p.isInstantRedeem && w.L > 0.2) count++;
  return count;
}

// 버킷 × 상품 × 고객 RRTTLLU 교차 메리트 동적 도출
function getBucketMerit(p: Product, c: Client, w: ReturnType<typeof calcWeights>): { label: string; desc: string } | null {
  const blended = getBlended(p);

  switch (p.bucket) {
    case "자본증식": {
      const gap = blended - c.targetReturn;
      if (blended === 0) return null;
      if (gap > 0) {
        return {
          label: "목표 수익률 초과 달성 기대",
          desc: `고객 목표수익률 ${c.targetReturn}%를 ${gap.toFixed(1)}%p 상회하는 통합 수익률(${blended.toFixed(1)}%)을 기록했습니다. 자본증식 버킷(${(w.G*100).toFixed(1)}%) 배분 목적인 적극적 성장을 직접 충족합니다.`,
        };
      } else {
        return {
          label: "자본증식 버킷 보완재로 활용",
          desc: `통합 수익률(${blended.toFixed(1)}%)이 목표수익률(${c.targetReturn}%)에 다소 미치지 못하나, 포트폴리오 분산 측면에서 자본증식 버킷의 변동성을 낮추는 보완 역할을 합니다.`,
        };
      }
    }

    case "인컴창출": {
      const isRetirementAge = c.age >= 50;
      const isStabilityOriented = c.riskAppetite >= 3;
      if (isRetirementAge && isStabilityOriented) {
        return {
          label: "은퇴 준비 구간 인컴 수익 확보",
          desc: `${c.age}세 안정 지향 고객의 인컴창출 수요(버킷 비중 ${(w.I*100).toFixed(1)}%)에 부합합니다. 배당·이자 수익 기반의 정기 현금흐름으로 은퇴 후 생활비 충당을 지원합니다.`,
        };
      } else if (isRetirementAge) {
        return {
          label: "고령 고객 인컴 기반 구축",
          desc: `${c.age}세 고객의 자산 안정화 구간에서 배당·이자 수익으로 정기적 인컴을 확보합니다. 성장성과 안정성을 동시에 추구하는 균형 전략입니다.`,
        };
      } else {
        return {
          label: "장기 인컴 기반 선제 확보",
          desc: `현재 ${c.age}세 기준, 인컴창출 버킷(${(w.I*100).toFixed(1)}%)을 선제적으로 구축해 향후 안정적 현금흐름의 기반을 마련합니다.`,
        };
      }
    }

    case "위험헷지": {
      if (p.id === "f6") {
        return {
          label: "달러 자산 분산 + 금리 방어",
          desc: `달러 표시 단기채권으로 원화 자산 집중 리스크를 분산합니다. 달러 강세 시 환차익이 추가되며, 위험헷지 버킷(${(w.H*100).toFixed(1)}%) 배분 목적인 하락 방어를 실현합니다.`,
        };
      } else if (p.id === "f7") {
        return {
          label: "채권 혼합 — 포트폴리오 변동성 완충",
          desc: `채권 65% 비중으로 주식 하락기 포트폴리오 전체 변동성을 낮춥니다. ${c.riskAppetite >= 3 ? "안정 지향 성향에 맞는" : "공격적 포트폴리오를 보완하는"} 방어 자산으로 위험헷지 버킷(${(w.H*100).toFixed(1)}%)을 충실히 담당합니다.`,
        };
      } else if (p.id === "m1" || p.id === "m3" || p.id === "m4") {
        return {
          label: "마켓뉴트럴 — 시장 방향과 무관한 하방 통제",
          desc: `롱숏·마켓뉴트럴 전략으로 시장 상황과 무관하게 하방리스크를 통제합니다. 채권이 아니라 주식 롱숏으로 방어하는 구조라 다른 위험헷지 상품(달러채권 등)과 상관관계가 낮아, 위험헷지 버킷(${(w.H*100).toFixed(1)}%) 안에서도 분산 효과를 더할 수 있습니다.`,
        };
      } else {
        return {
          label: "채권형 자산 — 포트폴리오 변동성 완충",
          desc: `채권 중심 자산으로 주식 하락기 포트폴리오 전체 변동성을 낮춥니다. ${c.riskAppetite >= 3 ? "안정 지향 성향에 맞는" : "공격적 포트폴리오를 보완하는"} 방어 자산으로 위험헷지 버킷(${(w.H*100).toFixed(1)}%)을 충실히 담당합니다.`,
        };
      }
    }

    case "유동성": {
      if (c.lumpSumTimepoint <= 1) {
        return {
          label: "1년 이내 목돈 수요 즉시 대응",
          desc: `1년 이내 목돈 사용 계획이 있는 고객에게 즉시환매 구조가 핵심입니다. 시장 상황과 무관하게 필요 시 즉시 출금 가능해 유동성 버킷(${(w.L*100).toFixed(1)}%) 목적을 완전히 충족합니다.`,
        };
      } else if (c.lumpSumTimepoint <= 3) {
        return {
          label: "단기 자금 수요 대응 + 수익 병행",
          desc: `${c.lumpSumTimepoint}년 내 자금 사용 계획을 고려해, 즉시환매로 유동성을 확보하면서 동시에 수익도 추구합니다. 유동성 버킷(${(w.L*100).toFixed(1)}%) 배분 목적에 적합합니다.`,
        };
      } else {
        return {
          label: "비상 유동성 버퍼 + 안정 수익",
          desc: `비상금 및 현금흐름 수요(버킷 비중 ${(w.L*100).toFixed(1)}%)를 위한 즉시 출금 가능 안전 자산입니다. 자금 묶임 없이 포트폴리오 유동성을 항상 확보합니다.`,
        };
      }
    }

    case "절세": {
      if (!c.isTaxTarget) {
        if (p.taxType === "국내주식형") {
          return {
            label: "국내주식 비과세 — 과세소득 선제 관리",
            desc: `현재 종소세 비대상이나, 국내주식 매매차익 비과세로 금융소득 누적을 억제합니다. 향후 금융소득이 2천만원을 초과할 경우를 대비한 선제적 절세 구조를 구축합니다.`,
          };
        }
        return null;
      }
      switch (p.taxType) {
        case "비과세연금":
          return {
            label: "종소세 완전 차단 — 최우선 절세 수단",
            desc: `금융소득종합과세 대상 고객에게 10년 유지 시 보험차익이 완전 비과세됩니다. 절세 버킷(${(w.T*100).toFixed(1)}%) 배분액의 금융소득 합산을 원천 차단해 종소세 세율(최고 49.5%) 적용을 피합니다.`,
          };
        case "분리과세":
          return {
            label: "2억 한도 분리과세 — 종합과세 직접 차단",
            desc: `매입액 2억원 한도로 15.4% 분리과세가 적용됩니다. 금융소득종합과세에 합산되지 않아 종소세 세율(최고 49.5%) 적용을 직접 차단하는 절세 버킷(${(w.T*100).toFixed(1)}%)의 핵심 수단입니다.`,
          };
        case "국내주식형":
          return {
            label: "국내주식 비과세로 과세소득 규모 절감",
            desc: `국내주식 매매차익이 비과세되어 금융소득 합산액을 줄입니다. 종소세 대상 고객의 과세 금융소득 규모를 낮춰 종합과세 구간을 하향 조정하는 간접 절세 효과가 있습니다.`,
          };
        case "소득공제":
          return {
            label: "투자금 10% 소득공제 — 세금 직접 환급",
            desc: `투자금의 10%(최대 300만원)를 소득공제받아 근로·사업소득세가 직접 환급됩니다. 금융소득 절세 외 소득세도 동시에 절감하는 이중 절세 효과로 절세 버킷(${(w.T*100).toFixed(1)}%)을 최대 활용합니다.`,
          };
        default:
          return null;
      }
    }

    default:
      return null;
  }
}

type FitReason = { label: string; desc: string; type: "good"|"caution"|"bad" };
type UpsideItem = { label: string; desc: string };

function analyzeProductFit(p: Product, c: Client, w: ReturnType<typeof calcWeights>, sameBucketCount: number, effectiveAmtOverride?: number): {
  unsuitable: boolean;
  reasons: FitReason[];
  upsides: UpsideItem[];
  bucketAmt: number;
  perProductAmt: number;
  minInvestOk: boolean;
} {
  const unsuitable = isUnsuitable(p, c);
  const reasons: FitReason[] = [];
  const upsides: UpsideItem[] = [];
  const productRiskAppetite = RISK_LEVEL_MAP[p.riskGrade] ?? 3;
  const clientLabel = RISK_LABELS[c.riskAppetite] ?? "중위험";
  const productGradeLabel = GRADE_LABELS[p.riskGrade] ?? "보통";
  const riskGradeMap: Record<number,string> = {1:"매우높은위험",2:"높은위험",3:"다소높은위험",4:"보통위험",5:"낮은위험",6:"매우낮은위험"};

  if (unsuitable) {
    reasons.push({ label:"위험성향 불일치", desc:`${GRADE_LABELS[p.riskGrade]}위험 수준의 상품으로 고객의 투자성향(${clientLabel}) Risk 허용 범위를 벗어납니다.`, type:"bad" });
    if (!p.isInstantRedeem && c.investmentPeriod < 3) {
      reasons.push({ label:"환매 조건 주의", desc:`즉시환매가 불가한 상품입니다. 고객의 투자기간(${c.investmentPeriod}년) 내 자금이 필요할 경우 출금이 어려울 수 있습니다.`, type:"bad" });
    }
    if (c.isTaxTarget && p.taxType==="해외주식형") {
      reasons.push({ label:"절세 효과 제한", desc:"종소세 대상 고객에게 해외주식형 펀드의 배당소득세(15.4%)는 금융소득 합산 부담을 높일 수 있습니다.", type:"caution" });
    }
    const blended = getBlended(p);
    if (blended > 0 && p.return1Y != null) {
      upsides.push({ label:"높은 수익 잠재력", desc:`1년 수익률 +${p.return1Y}%${p.return3Y?`, 3년 수익률 +${p.return3Y}%`:""}로 공격적 성장을 추구합니다. 위험을 감수하는 만큼 장기 관점에서 포트폴리오 수익률을 끌어올리는 역할을 기대할 수 있습니다.` });
    }
    if (p.bucket === w.topBucket) {
      upsides.push({ label:"핵심 버킷 보완", desc:`고객의 최우선 배분 버킷(${w.topBucket})에 속해 있어, 위험을 인지하고 편입할 경우 포트폴리오 전략 방향과 일치합니다.` });
    }
    if (p.taxType==="해외주식형") {
      upsides.push({ label:"해외주식 분류과세", desc:"해외주식 매매차익에 22% 분류과세가 적용되어, 금융소득종합과세 합산 없이 별도 과세됩니다." });
    }
    if (p.type === "랩어카운트") {
      upsides.push({ label:"전문 운용사 액티브 관리", desc:"전문 운용사가 직접 종목을 선별·편입·편출하여 시장 상황에 능동적으로 대응합니다. 개별 주식 직접 투자 대비 분산 효과도 있습니다." });
    }
  } else {
    if (productRiskAppetite <= c.riskAppetite) {
      reasons.push({ label:"위험성향 적합", desc:`${productGradeLabel} 위험 상품으로 고객의 투자성향(${clientLabel}) Risk 허용 범위 내에 있습니다.`, type:"good" });
    } else {
      reasons.push({ label:"위험성향 주의", desc:`고객 투자성향(${clientLabel})보다 위험도가 한 단계 높은 상품입니다. 편입 전 충분한 설명과 고객 동의가 필요합니다.`, type:"caution" });
    }
    if (p.bucket === w.topBucket) {
      reasons.push({ label:"핵심 버킷 충족", desc:`고객의 최우선 배분 버킷(${w.topBucket})과 일치합니다. 포트폴리오 핵심 자산으로 편입이 적합합니다.`, type:"good" });
    }
    if (c.isTaxTarget && (p.taxType==="비과세연금"||p.taxType==="분리과세")) {
      reasons.push({ label:"종소세 절감 — 최우선 절세 효과", desc:`금융소득종합과세 대상 고객에게 ${p.taxType} 상품으로 금융소득 합산을 직접 차단합니다.`, type:"good" });
    } else if (c.isTaxTarget && p.taxType==="국내주식형") {
      reasons.push({ label:"국내주식 비과세 혜택", desc:"국내주식 매매차익 비과세로 금융소득 규모를 줄여 종소세 부담을 완화합니다.", type:"good" });
    } else if (c.isTaxTarget && p.taxType==="소득공제") {
      reasons.push({ label:"소득공제 혜택", desc:"투자금 10% 소득공제(최대 300만원)로 근로소득세 직접 환급 효과가 있습니다.", type:"good" });
    } else if (c.isTaxTarget && p.taxType==="해외주식형") {
      reasons.push({ label:"절세 효과 제한적", desc:"해외주식형 펀드는 배당소득세 15.4%가 적용되어 종소세 대상 고객의 금융소득 합산 부담이 있습니다.", type:"caution" });
    }
    if (!p.isInstantRedeem && c.investmentPeriod >= 3) {
      reasons.push({ label:"장기 투자 적합", desc:`투자기간 ${c.investmentPeriod}년으로 즉시환매 불가 상품의 보유 조건에 충분히 부합합니다.`, type:"good" });
    } else if (!p.isInstantRedeem && c.investmentPeriod < 3) {
      reasons.push({ label:"환매 조건 주의", desc:`즉시환매가 불가한 상품입니다. 투자기간(${c.investmentPeriod}년) 내 자금이 필요할 경우 출금이 어려울 수 있습니다.`, type:"caution" });
    } else if (p.isInstantRedeem && w.L > 0.2) {
      reasons.push({ label:"유동성 수요 대응", desc:`즉시환매 가능 상품으로 고객의 유동성 수요(버킷 비중 ${(w.L*100).toFixed(0)}%)에 효과적으로 대응합니다.`, type:"good" });
    }

    // 버킷 × 상품 × 고객 RRTTLLU 교차 메리트
    const merit = getBucketMerit(p, c, w);
    if (merit) reasons.push({ label: merit.label, desc: merit.desc, type: "good" });
  }

  const bucketW = p.bucket==="자본증식"?w.G:p.bucket==="인컴창출"?w.I:p.bucket==="위험헷지"?w.H:p.bucket==="유동성"?w.L:w.T;
  const bucketAmt = c.investableAssets * bucketW;
  // effectiveAmtOverride: PB가 이 상품 편입 금액을 직접 수정했으면(고정) 그 값을 그대로 씀 — 없으면 기존처럼 버킷 총액 ÷ 동일 버킷 상품 수(균등분배)
  const perProductAmt = effectiveAmtOverride ?? (sameBucketCount > 0 ? bucketAmt / sameBucketCount : bucketAmt);
  const minInvestOk = !p.minInvest || perProductAmt >= parseAmount(p.minInvest);

  return { unsuitable, reasons, upsides, bucketAmt, perProductAmt, minInvestOk };
}

// 버킷 내 상품별 편입 금액 계산 — PB가 특정 상품 금액을 직접 고정(pin)하면 그 금액 그대로 쓰고,
// 나머지(고정 안 한) 상품들은 "버킷 총액 − 고정된 금액 합"을 남은 상품 수로 균등분배한다.
// (버킷 비중·총액은 그대로 유지 — 상품 개수로 무조건 나누기만 안 하는 게 목적)
function computeBucketAmounts(bucketAmt: number, productsInBucket: Product[], pins: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  const pinned = productsInBucket.filter((p) => pins[p.id] != null);
  const unpinned = productsInBucket.filter((p) => pins[p.id] == null);
  let sumPinned = 0;
  for (const p of pinned) { result[p.id] = pins[p.id]; sumPinned += pins[p.id]; }
  const remaining = bucketAmt - sumPinned;
  const perUnpinned = unpinned.length > 0 ? remaining / unpinned.length : 0;
  for (const p of unpinned) result[p.id] = perUnpinned;
  return result;
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
function buildTaxAlertMessage(hasTab4Data: boolean, excessAmount: number, fallbackText: string): string {
  // TAB4 정밀 데이터가 없으면 정확한 초과액을 알 수 없으므로 TAB1 원문 텍스트로 안전하게 폴백
  if (!hasTab4Data) return fallbackText;
  if (excessAmount > 50_000_000) {
    return `금융소득종합과세 기준(2천만원)을 ${fmtWon(excessAmount)} 초과했습니다. 초과 폭이 커 절세 비중이 크게 확대 적용됩니다.`;
  }
  return `금융소득종합과세 기준(2천만원)을 ${fmtWon(excessAmount)} 초과했습니다. 절세 상품을 우선 검토해주세요.`;
}
function hasRrttllu(f: { rrttllu: { returnObjective: string; timeHorizon: string; riskAttitude: string } }): boolean {
  return !!(f.rrttllu.returnObjective||f.rrttllu.timeHorizon||f.rrttllu.riskAttitude);
}

// 참고: 현재 라인업의 랩어카운트(14개)에는 위험헷지·인컴창출·절세에 해당하는 상품이
// 하나도 없다(전부 자본증식·유동성 둘로만 분류돼 있다). 분류 오류가 아니라 그런 성격의
// 랩 상품(방어형·월분배형·절세특화형) 자체가 지금 라인업에 없어서다 — 위험헷지·인컴창출·
// 절세 비중이 큰 고객에게는 랩 옵션이 추천되지 않고 펀드만 추천된다는 뜻이니, 실제로
// 그런 랩 상품이 있는지는 상품 라인업 쪽에서 별도로 확인이 필요하다.
// (r6·r7은 처음엔 "가치주"라는 이유로 인컴창출에 있었으나, 배당·이자 근거가 전략 설명에
// 전혀 없어 자본증식으로 재배정했다 — 판단 기준은 전략의 성격이며, 수익률 수치는 분류
// 근거로 쓰지 않는다.)
const BUCKET_CFG: Record<BucketType, { color: string; bg: string; border: string; icon: React.ReactNode; barColor: string; desc: string }> = {
  "자본증식": { color:"text-blue-700",   bg:"bg-blue-50",   border:"border-blue-200",   icon:<TrendingUp size={14}/>,  barColor:"#3B82F6", desc:"성장 자산 중심 — 랩어카운트, 해외주식형 펀드" },
  "인컴창출": { color:"text-amber-700",  bg:"bg-amber-50",  border:"border-amber-200",  icon:<Landmark size={14}/>,    barColor:"#F59E0B", desc:"배당·이자 수익 중심 — 혼합형 펀드, 채권 이표" },
  "위험헷지": { color:"text-emerald-700",bg:"bg-emerald-50",border:"border-emerald-200",icon:<ShieldCheck size={14}/>, barColor:"#10B981", desc:"하락 방어 — 달러채권, 금 ETF, 채권혼합 펀드" },
  "유동성":   { color:"text-purple-700", bg:"bg-purple-50", border:"border-purple-200", icon:<PiggyBank size={14}/>,   barColor:"#8B5CF6", desc:"즉시 현금화 — MMW 랩, 단기채권 펀드" },
  "절세":     { color:"text-rose-700",   bg:"bg-rose-50",   border:"border-rose-200",   icon:<Sparkles size={14}/>,    barColor:"#F43F5E", desc:"세제 혜택 — 연금보험, 분리과세채권, 국내주식형" },
};
const BUCKETS: BucketType[] = ["자본증식","인컴창출","위험헷지","유동성","절세"];
const PRODUCT_TYPE_ORDER: ProductType[] = ["랩어카운트","펀드","채권","ETF","보험"];

// ── 채널별 Top-Picks ① : WM — Core Top-Picks (PB교육용 자료, 월별) ───────────────
// 매월 나오는 자료에서 이 대시보드 라인업에 실제로 있는 상품만 매핑한다. 같은 상품이
// 여러 달 연속으로 추천되면 카드에 배지가 여러 개 나란히 붙는다(예: n1은 8·9월 모두 포함).
interface TopPickMonth { label: string; ids: Set<string>; }
const TOP_PICK_MONTHS: TopPickMonth[] = [
  {
    label: "8월 TOP PICK",
    // 라인업에 없어서 제외: 유경PSG 히든 챔피언, (자문형)Stay Ahead RQFII 중국주식,
    // (종목지정형)중국주식 RQFII, 우리금융지주 신종자본증권(콜 5.0년, 8월中 발행예정),
    // 신한금융조건부(상)16(신종-영구-5콜, 콜 3.2년, 8월中 발행예정 — 라인업의 b17 신한은행
    // 신종자본증권(3.5년콜)과는 발행사 표기·콜잔존이 달라 동일 종목으로 보지 않았다),
    // T 1.25 05/15/50, T 0.75 01/31/28.
    // 국고04250-3606(26-6, 잔존 9.9년)은 이전에 버킷 배정 불가로 라인업에서 제외했던 종목이라
    // 이번에도 매핑하지 않았다 — 다시 편입할지는 별도 확인 필요.
    ids: new Set<string>([
      "n1",  // 다올 멀티엔진 컬렉션 (사모재간접)
      "n5",  // 우리 라이징 스타
      "n4",  // 보고 트렌드 리더스
      "r2",  // 루미스세일즈 미국 All Cap Growth
      "n8",  // 씨스퀘어 미국 퀀텀그로스
      "n7",  // 에셋플러스 미국 리치투게더
      "b26", // 국고01500-5003(20-2) (잔존 23.6년)
      "b23", // 국민주택1종26-07 (잔존 5.0년)
      "b6",  // WOORIB 6.375 PERP (콜잔존 3.0년, 우리은행KP신종)
      "b20", // DB손보신종자본증권4 (콜 4.9년) — 라인업 b20(콜 4.8년)과 0.1년 차이, 조회 시점 차이로 판단해 매핑
    ]),
  },
  {
    label: "9월 TOP PICK",
    // 라인업에 없어서 제외: 유경PSG 히든 챔피언, (자문형)Stay Ahead RQFII 중국주식,
    // (종목지정형)중국주식 RQFII, 교보생명 신종자본증권, 한화생명신종자본증권8,
    // T 1.25 05/15/50, T 0.75 01/31/28, SPCX 5.35 07/15/31.
    // 주의: 자료의 "KB금융지주 신종자본증권(콜 5.0년, 8/31 발행예정)"은 라인업의 b15
    // "KB금융지주"(일반 회사채, 만기 3.9년)와 다른 종목이므로 표시하지 않는다.
    // 주택금융공사MBS2016-23(1-6)은 전산 조회 화면(2026-09-03 기준)을 그대로 b30으로 라인업에 추가하고 매핑했다.
    ids: new Set<string>([
      "n1",  // 다올 멀티엔진 컬렉션 (사모재간접)
      "n5",  // 우리 라이징 스타
      "n4",  // 보고 트렌드 리더스
      "r2",  // 루미스세일즈 미국 All Cap Growth
      "n8",  // 씨스퀘어 미국 퀀텀그로스
      "n7",  // 에셋플러스 미국 리치투게더
      "b22", // 국민주택1종26-08 (잔존 5.0년)
      "b28", // 국고02250-2709(25-6) (잔존 1.1년)
      "b30", // 주택금융공사MBS2016-23(1-6) (잔존 2개월)
    ]),
  },
];
function getTopPickLabels(id: string): string[] {
  return TOP_PICK_MONTHS.filter((m) => m.ids.has(id)).map((m) => m.label);
}

// ── 영업 솔루션 요약 (삼성증권 리서치센터 자료) ────────────────────────────
// 원문은 줄글 리포트라 PB가 상담 중 훑어보기 어려워, 시장 진단·리밸런싱 전략별로
// 재구성했다. 각 포인트는 "핵심 한 줄(lead) + 부연 설명(detail)"로 나눠 한눈에
// 스캔되게 했다. 문장은 원문을 요약·재배열한 것이며 수치·고유명사는 원문 그대로다.
interface SalesSolutionPoint {
  lead: string;
  detail: string;
}
interface SalesSolutionStrategy {
  icon: React.ReactNode;
  title: string;
  points: SalesSolutionPoint[];
  tags: string[];
}
interface SalesSolutionMonth {
  month: string;
  concept: string;
  conceptKo: string;
  diagnosis: string[];
  strategies: SalesSolutionStrategy[];
}
const SALES_SOLUTIONS: SalesSolutionMonth[] = [
  {
    month: "8월",
    concept: "High-Vol Regime",
    conceptKo: "변동성을 상수로 받아들이고, 대응하고, 활용해야 하는 국면",
    diagnosis: [
      "KOSPI가 고점 대비 -30% 이상 하락 — 작년 하반기 역대급 상승장 이후 역대급 하락장",
      "핵심 이슈는 AI — 성장 기대와 미래 불확실성이 동시에 존재 (메타 이슈, 하이퍼스케일러 FCF 마이너스 전환)",
      "AI 사이클이 아직 초기 단계라 명확한 청사진이 없는 한 관련 변동성은 당분간 불가피",
    ],
    strategies: [
      {
        icon: <TrendingUp size={16} />,
        title: "쏠림 완화",
        points: [
          { lead: "반도체 비중 과다 고객 → 비중 일부 축소", detail: "기대수익이 커도 지금은 변동성도 가장 큰 자산 — 반등장을 활용해 줄일 시점" },
          { lead: "보완재는 국내 배당주보다 미국 하이퍼스케일러", detail: "한국 반도체와 상관관계가 낮고, AI 밸류체인 전반에서 이익 안정성 확보" },
          { lead: "반도체 비중 과소 고객 → 급락을 기회로 비중 확대", detail: "주가 급락 국면을 활용해 반도체 업종 비중을 점차 늘려야 함" },
          { lead: "핵심은 '균형'", detail: "비중이 너무 높아도, 너무 낮아도 쏠림 — 지금은 쏠림을 완화할 시점" },
        ],
        tags: ["미국 하이퍼스케일러", "국내 금융·배당주(보완재)"],
      },
      {
        icon: <ShieldCheck size={16} />,
        title: "변동성 Buy",
        points: [
          { lead: "롱숏 펀드, 지금이 적기", detail: "순노출도(Net Exposure)가 0에 가까울수록 변동성 장세에서 유리 — 상승장의 약점이 지금은 강점" },
          { lead: "우수 롱숏 펀드, 추가 설정 본격화", detail: "사모펀드 계좌 수 이슈는 있지만, 지금이 적극 활용할 시점" },
          { lead: "ELS 쿠폰, 20~30%대까지 상승", detail: "변동성이 커질수록 쿠폰도 오르고 하락배리어는 낮아져 안정성도 함께 보강" },
          { lead: "종소세 대상이어도 세전 기대수익률이 이를 상쇄", detail: "ISA 활용 시 과세이연·절세 효과까지 함께 안내" },
        ],
        tags: ["롱숏(사모재간접) 펀드", "지수형 ELS", "ISA 절세"],
      },
    ],
  },
  {
    month: "9월",
    concept: "Bumpy Recovery",
    conceptKo: "회복은 이어지되 평탄하지 않은(Bumpy) 국면 — 눈높이를 낮추고 자리를 지켜야 함",
    diagnosis: [
      "투자 난이도가 역대급인 이유는 변동성 크기가 아니라 '주가와 경기의 괴리' — 반도체 가격·수출 호조에도 7월 낙폭은 코로나 때보다 컸음",
      "경제 지표를 신뢰한다면 지금은 회복(Recovery) 국면 — 미국 하이퍼스케일러 실적, 한국 반도체 주주환원책이 안정의 근거",
      "다만 고금리 부담과 AI의 실물경제 편입에 필요한 시간을 고려하면 회복 과정은 V자가 아닌 U자·나이키형으로 평탄하지 않을 전망",
    ],
    strategies: [
      {
        icon: <TrendingUp size={16} />,
        title: "반도체 Big2 쏠림 완화 → 하이퍼스케일러 & 내수·금융",
        points: [
          { lead: "Big2 비중 과다 고객 → 기대수익 일부 희생하고 분산", detail: "포트폴리오 전체 변동성 관리가 우선" },
          { lead: "대안 ① 미국 하이퍼스케일러", detail: "한국 반도체와 상관관계 낮음" },
          { lead: "대안 ② 한국 금융·내수 소비 섹터", detail: "금리차 확대로 마진 개선 중, 경기 반영도 양호" },
          { lead: "랩도 동일 전략", detail: "고베타(반도체 비중 高) 랩 → 저베타(금융·내수) 랩 또는 미국 주식형 랩으로 리밸런싱" },
          { lead: "롱숏 펀드는 마켓뉴트럴 성격에 주목", detail: "Net Exposure가 작은 펀드 위주로" },
        ],
        tags: ["미국 하이퍼스케일러", "저베타(금융·내수) 랩", "마켓뉴트럴 롱숏 펀드"],
      },
      {
        icon: <Sparkles size={16} />,
        title: "장기 국채 손실 커버 → 지수형 ELS·미국채",
        points: [
          { lead: "장기 국채, 듀레이션 축소만으론 부족", detail: "두 자리 수 손실 + 금리 하락 반전 가능성도 낮음" },
          { lead: "대안 ① 지수형 ELS", detail: "상품 조건이 개선돼 리밸런싱 매력 충분" },
          { lead: "대안 ② 미국채", detail: "원/달러 1,400원 하회로 진입장벽 완화, 금리·환율 양쪽에서 자본차익 가능" },
          { lead: "쏠림 완화가 목적이면 기대수익 희생은 감수할 가치", detail: "포트폴리오의 중장기 성과 개선이 궁극적 목표" },
        ],
        tags: ["지수형 ELS", "미국채"],
      },
    ],
  },
];
const ASSET_CLASS_TO_BUCKET: Record<string,BucketType> = {
  "해외주식":"자본증식","국내주식":"인컴창출",
  "채권":"위험헷지","금":"위험헷지","달러":"위험헷지",
  "리츠":"유동성","현금":"유동성",
};
const RISK_GRADE_LABEL: Record<number,string> = {1:"매우높은위험",2:"높은위험",3:"다소높은위험",4:"보통위험",5:"낮은위험",6:"매우낮은위험"};

function ProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const cfg = BUCKET_CFG[product.bucket];
  const docUrl = PRODUCT_DOCS[product.id];
  const bond = product.bondRef;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={e=>e.stopPropagation()}>
        <div className={`px-6 py-5 ${cfg.bg} border-b ${cfg.border}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${cfg.bg} ${cfg.border} ${cfg.color}`}>{cfg.icon}{product.bucket}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{product.type}</span>
                {bond && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{bond.market}</span>}
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
          {bond ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-400">신용등급</p>
                <p className="mt-1 text-sm font-black text-navy">{bond.creditRating}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-400">만기</p>
                <p className="mt-1 text-sm font-black text-navy">{bond.maturity}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-400">세전수익률</p>
                <p className="mt-1 text-sm font-black text-navy">{(bond.tradeYield ?? bond.yieldPretax) != null ? `${bond.tradeYield ?? bond.yieldPretax}%` : "-"}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-400">위험등급</p>
                <p className="mt-1 text-sm font-black text-navy">{product.riskGrade}등급</p>
                <p className="text-[10px] text-slate-400">{RISK_GRADE_LABEL[product.riskGrade]}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-400">1년 수익률</p>
                <p className={`mt-1 text-sm font-black ${product.return1Y!=null&&product.return1Y>0?"text-blue-700":"text-slate-400"}`}>{product.return1Y!=null&&product.return1Y>0?`+${product.return1Y}%`:"-"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-400">3년 수익률</p>
                <p className={`mt-1 text-sm font-black ${product.return3Y!==null&&product.return3Y>0?"text-blue-700":"text-slate-400"}`}>{product.return3Y?`+${product.return3Y}%`:"-"}</p>
              </div>
            </div>
          )}
          {bond && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">세전수익률(원자료 기준): {bondYieldSummary(bond)}</p>
          )}
          {bond?.note && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0"/><span>{bond.note}</span>
            </p>
          )}
          {bond && (
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
              <p className="mb-2 text-xs font-bold text-rose-800">세금 정보</p>
              <p className="text-xs leading-5 text-rose-900">표면이자(이자소득)는 15.4% 원천징수되며, 다른 이자·배당소득과 합산해 연 2천만원을 초과하면 초과분이 금융소득종합과세 대상이 됩니다. 매매차익(중도 매도·만기 상환차익)은 국내·해외 채권 구분 없이 비과세입니다.</p>
            </div>
          )}
          {product.returnNote && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">{product.returnNote}</p>
          )}
          <div className="space-y-2">
            {product.aum && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">총 운용규모</span><span className="text-xs font-bold text-navy">{product.aum}</span></div>}
            {product.inception && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">설정일</span><span className="text-xs font-bold text-navy">{product.inception}</span></div>}
            {product.minInvest && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">최소 가입금액</span><span className="text-xs font-bold text-navy">{product.minInvest}</span></div>}
            {product.fee && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">수수료</span><span className="text-xs font-bold text-navy">{product.fee}</span></div>}
            {bond && (
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5">
                <span className="text-xs font-semibold text-slate-500">위험등급</span>
                <span className={`text-xs font-bold ${bond.isSubordinated ? "text-amber-600" : "text-navy"}`}>
                  {bond.isSubordinated ? "별도 확인 필요" : `${bond.riskGrade}등급 (${RISK_GRADE_LABEL[bond.riskGrade]})`}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5"><span className="text-xs font-semibold text-slate-500">즉시환매</span><span className={`text-xs font-bold ${product.isInstantRedeem?"text-emerald-700":"text-slate-400"}`}>{product.isInstantRedeem?"가능":"불가"}</span></div>
          </div>
          {product.topHoldings&&product.topHoldings.filter(isRealHolding).length>0&&(
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-bold text-slate-500">💡 상위 편입 종목 (Top 5)</p>
              <div className="flex flex-wrap gap-1.5">
                {product.topHoldings.filter(isRealHolding).map((h,i)=>(
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

export default function Tab5Page() {
  const { formData, riskResult, warnings, financialCompletion, rrttlluCompletion, selectedCustomerProfile, internalJsonPayload, productSelectedIds: selectedIds, setProductSelectedIds: setSelectedIdsRaw, portfolioAssets, analysisResult, rebalancingSellAssets, rebalancingBuyAssets, setRebalancingSellAssets, selectedCustomer, sharedUiState, updateSharedUiState } = useCustomerContext();
  const { isCustomerView } = useCustomerView();
  const portfolioData = usePortfolioResult();
  const rrttlluReady = hasRrttllu(formData);
  const [modalProduct, setModalProduct] = useState<Product|null>(null);
  const [salesSolutionOpen, setSalesSolutionOpen] = useState(false);
  const [salesSolutionMonth, setSalesSolutionMonth] = useState<string>(SALES_SOLUTIONS[SALES_SOLUTIONS.length - 1].month);
  const [activeEffectId, setActiveEffectId] = useState<string|null>(null);
  const [unsuitableWarning, setUnsuitableWarning] = useState<Product|null>(null);
  const [minInvestBlocked, setMinInvestBlocked] = useState<{ product: Product; perProductAmt: number; requiredAmt: number; blockedBy: Product | null } | null>(null);
  // 버킷 내 상품별 편입 금액 수동 고정(pin) — productId → PB가 직접 지정한 금액(원). 없으면 버킷 균등분배.
  const [pinnedAmounts, setPinnedAmounts] = useState<Record<string, number>>({});
  const [amountEditError, setAmountEditError] = useState<{ product: Product; message: string } | null>(null);
  // 상품을 새로 담기 전, 얼마 담을지 먼저 입력받는 단계(주식 리밸런싱 탭의 매수 모달과 같은 흐름)
  const [pendingAdd, setPendingAdd] = useState<Product | null>(null);
  const [pendingAddAmountStr, setPendingAddAmountStr] = useState("");
  const [newSummary, setNewSummary] = useState<FinancialIncomeSummary | null>(null);
  // 버킷별 매칭 상품 카드 — 상품유형(랩어카운트/펀드/채권 등) 별로 따로 볼 수 있게 하는 필터(버킷별로 독립)
  const [bucketItemFilter, setBucketItemFilter] = useState<Partial<Record<BucketType, ProductType|"all">>>({});

  const syncedTab5Ui = sharedUiState.tab5;

  useEffect(() => {
    if (!isCustomerView || !syncedTab5Ui) return;
    setActiveEffectId(syncedTab5Ui.activeEffectId ?? null);
    setModalProduct(ALL_ITEMS.find((product) => product.id === syncedTab5Ui.modalProductId) ?? null);
    setUnsuitableWarning(ALL_ITEMS.find((product) => product.id === syncedTab5Ui.unsuitableWarningProductId) ?? null);
    setPinnedAmounts(syncedTab5Ui.pinnedAmounts ?? {});
  }, [isCustomerView, syncedTab5Ui]);

  // PB 화면(고객 미러링 아님): 고객 전환 시 저장돼 있던 pinnedAmounts를 딱 1번만 복원.
  // (isCustomerView 미러링 effect처럼 syncedTab5Ui가 바뀔 때마다 계속 덮어쓰면, PB가 방금 입력한
  //  값이 저장 요청 왕복 사이에 되돌아와 충돌할 수 있어 — 고객이 바뀔 때만 복원한다.)
  const pinnedRestoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (isCustomerView || !selectedCustomer) return;
    if (pinnedRestoredForRef.current === selectedCustomer) return;
    if (!syncedTab5Ui) return; // 아직 로드 전 — 로드되면 다시 실행됨(syncedTab5Ui deps)
    pinnedRestoredForRef.current = selectedCustomer;
    setPinnedAmounts(syncedTab5Ui.pinnedAmounts ?? {});
  }, [isCustomerView, selectedCustomer, syncedTab5Ui]);

  useEffect(() => {
    if (isCustomerView) return;
    updateSharedUiState({
      tab5: {
        modalProductId: modalProduct?.id ?? null,
        activeEffectId,
        unsuitableWarningProductId: unsuitableWarning?.id ?? null,
        pinnedAmounts,
      },
    });
  }, [isCustomerView, modalProduct, activeEffectId, unsuitableWarning, pinnedAmounts, updateSharedUiState]);

useEffect(() => {
  if (!selectedCustomer) return;
  loadTaxSummaries(selectedCustomer).then(({ newSummary }) => {
    setNewSummary((newSummary as FinancialIncomeSummary | null) ?? null);
  });
}, [selectedCustomer]);

const client: Client = useMemo(() => {
  if (!rrttlluReady) return {
    riskAppetite:3, targetReturn:8, investmentPeriod:3, liquidityRatio:0.2,
    isTaxTarget:false, isHighIncomeWorker:false, age:50,
    monthlyIncome:0, investableAssets:0,
    lumpSumTimepoint:5,
    liquidityNeeds: [],
    taxExcessAmount: 0,
    hasTab4TaxData: false,
    isTaxAlertFromTab1: false,
  };
  const hasTab4TaxData = newSummary != null;
  const taxExcessAmount = Math.max(0, (newSummary?.totalFinancialIncome ?? 0) - 20_000_000);
  const isTaxAlertFromTab1 = internalJsonPayload.rrttllu.tax.financial_income_tax_alert?.includes("초과") ?? false;
    // TAB4 데이터가 있으면 정밀 계산, 없으면 TAB1 설문 판단으로 안전하게 폴백
    const isTaxTarget = hasTab4TaxData
      ? taxExcessAmount > 0
      : internalJsonPayload.rrttllu.tax.financial_income_tax_alert?.includes("초과") ?? false;
    const age = parseInt(selectedCustomerProfile.age||"50");
    const fa = parseFloat(formData.financial.financialAssets.replace(/[^0-9.]/g,""))||0;
    const ta = parseFloat(formData.financial.totalAssets.replace(/[^0-9.]/g,""))||0;
    const annualIncome = parseAmount(formData.financial.annualFixedIncome);
    const monthlyIncome = annualIncome / 12;
    const investableAssets = parseAmount(formData.financial.investableAssets);

// TAB2·TAB3 리밸런싱 반영 추가투자자금 (헤더와 동일 로직)
const baseOperatingAssets = portfolioAssets.reduce((s, a) => {
  if (a.current_value && a.current_value > 0) return s + a.current_value;
  if (a.amount_type === "value") return s + (a.amount ?? 0);
  return s + (a.amount ?? 0) * (a.current_price ?? 0);
}, 0);
const { confirmedOperatingAssetsAfterSell, confirmedOperatingAssetsAfterBuy } = formData.headerAssetSummary;
const additionalInvestmentAmount = (() => {
  if (confirmedOperatingAssetsAfterSell == null) return investableAssets;
  const additionalAfterSell = investableAssets + (baseOperatingAssets - confirmedOperatingAssetsAfterSell);
  if (confirmedOperatingAssetsAfterBuy == null) return additionalAfterSell;
  return additionalAfterSell - (confirmedOperatingAssetsAfterBuy - confirmedOperatingAssetsAfterSell);
})();
    const liquidityNeeds = collectLiquidityNeeds(formData.rrttllu);
    return {
      riskAppetite: riskLevelToAppetite(riskResult.level),
      targetReturn: returnObjectiveToPercent(formData.rrttllu.returnObjective),
      investmentPeriod: timeHorizonToYears(formData.rrttllu.timeHorizon),
      liquidityRatio: fa&&ta ? Math.min(fa/ta,1) : 0.2,
      isTaxTarget, isHighIncomeWorker:false,
      age: isNaN(age)?50:age,
      monthlyIncome, investableAssets: additionalInvestmentAmount,
      lumpSumTimepoint: representativeLumpSumYears(liquidityNeeds),
      liquidityNeeds,
      taxExcessAmount,
      hasTab4TaxData,
      isTaxAlertFromTab1,
    };
  }, [formData,riskResult,selectedCustomerProfile,internalJsonPayload,rrttlluReady,newSummary]);

  const weights = useMemo(() => rrttlluReady ? calcWeights(client) : null, [client,rrttlluReady]);

  // ExistingPortfolioTab·BuySimulatorTab과 동일한 한계세율 근사식 (총자산 구간 기준) — 신규 세금 점검 계산에 사용
  const tMarginal = useMemo(() => {
    const total = parseFloat(formData.financial.totalAssets.replace(/[^0-9.]/g, "")) || 0;
    if (total >= 5e9) return 0.45;
    if (total >= 3e9) return 0.40;
    if (total >= 1.2e9) return 0.35;
    return 0.38;
  }, [formData.financial.totalAssets]);

  // 신규 포트폴리오(주식+상품+채권 전체) 세금 요약 계산·저장은 이제 Tab3Page에서 rebalancingSellAssets
  // 변경을 실시간 감지해 자동 처리한다("리밸런싱 확정" 버튼 제거 — 탭3-1/tab3/page.tsx 주석 참고).

  const bucketAllProducts = useMemo(() => {
    if (!weights) return null;
    const scored = ALL_ITEMS
      .filter(p => !(p.isHighIncomeOnly&&!client.isHighIncomeWorker))
      .map(p => ({ ...p, score: Math.round(calcScore(p,client,weights,ALL_ITEMS)*10)/10 }));
    const result: Partial<Record<BucketType,typeof scored>> = {};
    for (const bucket of BUCKETS) {
      const list = scored
        .filter(p => p.bucket === bucket)
        .sort((a, b) => {
          const aUnsuitable = isUnsuitable(a, client);
          const bUnsuitable = isUnsuitable(b, client);
          if (aUnsuitable !== bUnsuitable) return aUnsuitable ? 1 : -1;
          const goodDiff = countGoodReasons(b, client, weights) - countGoodReasons(a, client, weights);
          if (goodDiff !== 0) return goodDiff;
          return b.score - a.score;
        });
      result[bucket] = list.length > 0 ? list : ALL_ITEMS
        .filter(p => p.bucket === bucket && !(p.isHighIncomeOnly&&!client.isHighIncomeWorker))
        .map(p => ({...p, score: Math.round(calcScore(p,client,weights,ALL_ITEMS)*10)/10}));
    }
    return result;
  }, [client,weights]);

  const getBucketWeight = (b: BucketType) => {
    if (!weights) return 0;
    return b==="자본증식"?weights.G:b==="인컴창출"?weights.I:b==="위험헷지"?weights.H:b==="유동성"?weights.L:weights.T;
  };

  // ── 보유 자산 표시 ────────────────────────────────────────────────────────
  // 탭3-2에서는 "이 탭에서 담은 상품·채권"만 보여준다. rebalancingSellAssets에는 탭3-1의
  // 주식 리밸런싱 보유분까지 함께 들어있지만, 그건 탭3-1 소관이라 여기서는 화면에서 걸러낸다.
  // (TAB4의 신규 포트폴리오는 rebalancingSellAssets 전체를 그대로 쓰므로 주식+상품이 합산된다 —
  //  즉 여기서 거르는 건 표시 범위일 뿐, 실제 포트폴리오 데이터는 건드리지 않는다.)
  const baseAssets = useMemo<PortfolioAsset[]>(() => {
    const enriched = (analysisResult?.enrichedAssets ?? []) as PortfolioAsset[];
    const priceMap = new Map(enriched.map((a) => [makeAssetKey(a), a]));
    return rebalancingSellAssets
      .filter((a) => a.name && isProductHolding(a))
      .map((a) => {
        if (a.amount_type === "value") return a; // 상품(펀드·랩어카운트·채권)은 시세 재계산 불필요
        const e = priceMap.get(makeAssetKey(a));
        const cp = Number(e?.current_price ?? a.current_price);
        return { ...a, current_price: cp > 0 ? cp : a.current_price, current_value: a.amount > 0 && cp > 0 ? a.amount * cp : 0 };
      });
  }, [analysisResult, rebalancingSellAssets]);

  // 선택된 상품 → 보유 자산(rebalancingSellAssets)에 반영. 상품은 실시간 가격이 없어
  // amount_type "value"로 편입하며, 버킷 배분액 ÷ 같은 버킷 내 선택 상품 수로 투자금액을 나눈다.
  // client.investableAssets는 rebalancingSellAssets(→formData.headerAssetSummary)에서 역산되므로
  // 그대로 deps에 넣으면 "선택 반영 → investableAssets 변경 → 재반영 → ..." 무한루프가 생긴다.
  // ref로 최신값만 읽고, 재실행은 selectedIds(사용자의 실제 선택 행위)에만 반응하도록 끊는다.
  const weightsRef = useRef(weights);
  weightsRef.current = weights;
  const investableAssetsRef = useRef(client.investableAssets);
  investableAssetsRef.current = client.investableAssets;
  const rebalancingSellAssetsRef = useRef(rebalancingSellAssets);
  rebalancingSellAssetsRef.current = rebalancingSellAssets;


  useEffect(() => {
    const w = weightsRef.current;
    if (!w) return;
    const bucketWeight = (b: BucketType) => b==="자본증식"?w.G:b==="인컴창출"?w.I:b==="위험헷지"?w.H:b==="유동성"?w.L:w.T;
    const selected = ALL_ITEMS.filter((p) => selectedIds.includes(p.id));

    // 버킷별로 상품 금액 계산 — pinnedAmounts에 고정된 상품은 그 금액 그대로, 나머지는 "버킷 총액 − 고정분"을 균등분배
    const byBucket = new Map<BucketType, Product[]>();
    for (const p of selected) {
      const list = byBucket.get(p.bucket) ?? [];
      list.push(p);
      byBucket.set(p.bucket, list);
    }
    const amountById = new Map<string, number>();
    for (const [bucket, products] of byBucket) {
      const bucketAmt = investableAssetsRef.current * bucketWeight(bucket);
      const amounts = computeBucketAmounts(bucketAmt, products, pinnedAmounts);
      for (const p of products) amountById.set(p.id, Math.round(amounts[p.id] ?? 0));
    }

    const productAssets: PortfolioAsset[] = selected.map((p) => {
      const perProductAmt = amountById.get(p.id) ?? 0;
      if (p.bondRef) {
        const isForeign = p.bondRef.market === "해외";
        return {
          name: p.name,
          ticker: `${BOND_TICKER_PREFIX}${p.id}`,
          asset_class: isForeign ? "해외채권" : "국내채권",
          productType: isForeign ? "해외채권" : "국내채권",
          theme: "기타",
          country: p.bondRef.issuerCountry ?? (isForeign ? "미국" : "한국"),
          // amount_type "value"일 때 세금 계산 로직(calcFinancialIncomeSummary)은 buy_price를 액면금액(faceValue)
          // 근사값으로 읽는다 — 이 앱은 채권을 액면가 근처 배분금액으로 다루므로 매수단가≈액면가로 취급.
          buy_price: perProductAmt,
          bond_yield: p.bondRef.couponRate ?? null,
          amount: perProductAmt,
          amount_type: "value" as const,
          is_hedged: false,
          needs_review: false,
          current_value: perProductAmt,
          // 채권 이자소득세 계산 전용 필드(액면×표면금리 기반 STEP0~5 로직 — 배당 계산과는 별개 경로)
          issuerCountry: p.bondRef.issuerCountry,
          couponType: p.bondRef.couponType,
          isPerpetual: p.bondRef.isPerpetual,
          maturityDate: p.bondRef.maturityDate,
        };
      }
      const isForeign = p.taxType === "해외주식형";
      const isBond = p.taxType === "채권형";
      return {
        name: p.name,
        ticker: `${PRODUCT_TICKER_PREFIX}${p.id}`,
        asset_class: isBond ? (isForeign ? "해외채권" : "국내채권") : isForeign ? "해외주식" : "국내주식",
        productType: p.type,
        theme: "기타",
        country: isForeign ? "미국" : "한국",
        buy_price: null,
        amount: perProductAmt,
        amount_type: "value" as const,
        is_hedged: false,
        needs_review: false,
        current_value: perProductAmt,
      };
    });

    const prev = rebalancingSellAssetsRef.current;
    const nonProduct = prev.filter((a) => !a.ticker?.startsWith(PRODUCT_TICKER_PREFIX) && !a.ticker?.startsWith(BOND_TICKER_PREFIX));
    if (productAssets.length === 0 && nonProduct.length === prev.length) return; // 변경 없음 — 불필요한 갱신 방지
    setRebalancingSellAssets([...nonProduct, ...productAssets]);
    // selectedIds는 참조가 매 렌더 바뀔 수 있어(빈 배열 리터럴 등) 배열 자체가 아닌
    // 내용물(join)을 deps로 사용 — 그래야 실제 선택이 바뀔 때만 재실행된다.
    // pinnedAmounts는 setPinnedAmounts에서 항상 새 객체로 교체하므로 참조 비교로 재실행 여부 판단이 안전함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(","), pinnedAmounts]);

  // 최소가입금액 미달 상품은 어떤 경로로도 포트폴리오에 담기지 않도록, 실제 추가는 전부 이 함수를 거친다.
  // (경고만 하고 통과시키는 게 아니라 실제로 차단한다 — "그래도 진행" 옵션이 있는 성향 부적합과는 다름)
  // investableAssets가 아직 입력 안 된 상태(perProductAmt===0)는 "미달"이 아니라 "데이터 없음"이라 막지 않는다.
  // 반환값: 실제로 담겼으면 true, 최소가입금액 미달로 막혔으면 false.
  const tryAddProduct = (p: Product): boolean => {
    if (weights) {
      const bucketW = getBucketWeight(p.bucket);
      const bucketAmt = client.investableAssets * bucketW;
      const sameBucketSelected = ALL_ITEMS.filter((x) => selectedIds.includes(x.id) && x.bucket === p.bucket);
      // pinnedAmounts 반영: 이미 고정된 상품은 그 금액 그대로 두고, 새로 담는 이 상품 포함 나머지(미고정)만 잔여분을 균등분배
      const amounts = computeBucketAmounts(bucketAmt, [...sameBucketSelected, p], pinnedAmounts);
      const perProductAmt = amounts[p.id] ?? 0;
      if (perProductAmt > 0) {
        if (p.minInvest && perProductAmt < parseAmount(p.minInvest)) {
          setMinInvestBlocked({ product: p, perProductAmt, requiredAmt: parseAmount(p.minInvest), blockedBy: null });
          return false;
        }
        // 이 상품을 추가하면 버킷 인원이 늘어 이미 선택된 상품(미고정) 중 하나가 자기 최소가입금액 밑으로 떨어지는지도 확인
        const breaks = sameBucketSelected.find((x) => x.minInvest && (amounts[x.id] ?? 0) < parseAmount(x.minInvest));
        if (breaks) {
          setMinInvestBlocked({ product: p, perProductAmt, requiredAmt: parseAmount(breaks.minInvest!), blockedBy: breaks });
          return false;
        }
      }
    }
    setSelectedIdsRaw([...selectedIds, p.id]);
    setActiveEffectId(p.id);
    return true;
  };

  // 상품 편입 금액을 PB가 직접 고정(pin). 버킷 총액을 넘거나, 이 상품(또는 같은 버킷의 다른 미고정 상품)의
  // 최소가입금액을 밑돌게 되면 차단한다. 성공하면 true.
  const trySetProductAmount = (p: Product, newAmt: number): boolean => {
    if (!weights || !Number.isFinite(newAmt) || newAmt < 0) return false;
    const bucketW = getBucketWeight(p.bucket);
    const bucketAmt = client.investableAssets * bucketW;
    const bucketProducts = ALL_ITEMS.filter((x) => selectedIds.includes(x.id) && x.bucket === p.bucket);
    const others = bucketProducts.filter((x) => x.id !== p.id);
    const othersPinned = others.filter((x) => pinnedAmounts[x.id] != null);
    const othersUnpinned = others.filter((x) => pinnedAmounts[x.id] == null);
    const sumOthersPinned = othersPinned.reduce((s, x) => s + (pinnedAmounts[x.id] ?? 0), 0);
    const remaining = bucketAmt - sumOthersPinned - newAmt;

    if (remaining < -1) { // 부동소수점 오차 허용 오차 1원
      setAmountEditError({ product: p, message: `버킷 총액(${fmtWon(bucketAmt)})을 초과합니다.` });
      return false;
    }
    if (p.minInvest && newAmt < parseAmount(p.minInvest)) {
      setAmountEditError({ product: p, message: `최소 가입금액(${p.minInvest}) 미달입니다.` });
      return false;
    }
    if (othersUnpinned.length > 0) {
      const perRemaining = Math.max(0, remaining) / othersUnpinned.length;
      const breaks = othersUnpinned.find((x) => x.minInvest && perRemaining < parseAmount(x.minInvest));
      if (breaks) {
        setAmountEditError({ product: p, message: `이 금액으로 설정하면 같은 버킷의 '${breaks.name}'이(가) 최소 가입금액(${breaks.minInvest}) 밑으로 떨어집니다.` });
        return false;
      }
    }
    setAmountEditError(null);
    setPinnedAmounts((prev) => ({ ...prev, [p.id]: newAmt }));
    return true;
  };

  // 고정 해제 → 다시 버킷 균등분배로 되돌림
  const resetProductAmount = (productId: string) => {
    setPinnedAmounts((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setAmountEditError(null);
  };

  // 상품을 새로 담을 때 "얼마 담을지" 먼저 입력받는 단계 — 주식 리밸런싱 탭의 매수 모달과 같은 느낌.
  // 자동분배 기준 금액을 기본값으로 채워주고, 최대 한도(=버킷 잔여 배분 가능액)를 같이 보여준다.
  const openPendingAdd = (p: Product) => {
    if (!weights) { tryAddProduct(p); return; } // 투자가능자산 계산 전이면 예전처럼 바로 담기 시도(실패 시 자체 처리됨)
    const bucketAmt = client.investableAssets * getBucketWeight(p.bucket);
    const bucketProducts = ALL_ITEMS.filter((x) => selectedIds.includes(x.id) && x.bucket === p.bucket);
    const amounts = computeBucketAmounts(bucketAmt, [...bucketProducts, p], pinnedAmounts);
    setPendingAdd(p);
    setPendingAddAmountStr(String(Math.round(amounts[p.id] ?? 0)));
  };

  // 잔여 배분 가능액(=최대 한도) — 같은 버킷에 이미 담긴 상품들의 현재 금액(고정이든 자동분배든)을 뺀 나머지
  const pendingAddMaxLimit = (p: Product): number => {
    const bucketAmt = client.investableAssets * getBucketWeight(p.bucket);
    const bucketProducts = ALL_ITEMS.filter((x) => selectedIds.includes(x.id) && x.bucket === p.bucket);
    const currentAmounts = computeBucketAmounts(bucketAmt, bucketProducts, pinnedAmounts);
    const sumOthers = bucketProducts.reduce((s, x) => s + (currentAmounts[x.id] ?? 0), 0);
    return Math.max(0, bucketAmt - sumOthers);
  };

  const confirmPendingAdd = () => {
    if (!pendingAdd) return;
    const p = pendingAdd;
    const bucketAmt = client.investableAssets * getBucketWeight(p.bucket);
    const bucketProducts = ALL_ITEMS.filter((x) => selectedIds.includes(x.id) && x.bucket === p.bucket);
    const defaultAmt = Math.round(computeBucketAmounts(bucketAmt, [...bucketProducts, p], pinnedAmounts)[p.id] ?? 0);
    const typedAmt = parseInt(pendingAddAmountStr.replace(/[^0-9]/g, ""), 10) || 0;

    const added = tryAddProduct(p); // 기존 최소가입금액 하드블록 그대로 재사용(자동분배 기준으로 우선 검증)
    if (!added) { setPendingAdd(null); return; } // 실패 시 minInvestBlocked 모달이 대신 뜸
    if (typedAmt !== defaultAmt) {
      const ok = trySetProductAmount(p, typedAmt);
      if (!ok) return; // 초과·미달 — 상품은 이미 자동분배 금액으로 담긴 상태로 유지, 이 모달은 열어두고 에러 표시
    }
    setPendingAdd(null);
  };

  const handleSelect = (p: Product) => {
    if (selectedIds.includes(p.id)) {
      if (isCustomerView) return;
      setSelectedIdsRaw(selectedIds.filter(x=>x!==p.id));
      resetProductAmount(p.id);
      return;
    }
    if (isUnsuitable(p, client)) {
      setUnsuitableWarning(p);
      return;
    }
    openPendingAdd(p);
  };

  // 보유 자산 카드의 "매도" — 상품·채권 모두 버킷 카드의 선택(체크) 해제로 통일 처리. 그 외(탭3-1 매수 종목)는 여기서 관리하지 않음
  const handleRemoveHolding = (assetKey: string) => {
    if (isCustomerView) return;
    const asset = baseAssets.find((a) => makeAssetKey(a) === assetKey);
    if (!asset?.ticker) return;
    if (asset.ticker.startsWith(PRODUCT_TICKER_PREFIX)) {
      const id = asset.ticker.slice(PRODUCT_TICKER_PREFIX.length);
      setSelectedIdsRaw(selectedIds.filter((x) => x !== id));
      resetProductAmount(id);
      return;
    }
    if (asset.ticker.startsWith(BOND_TICKER_PREFIX)) {
      const id = asset.ticker.slice(BOND_TICKER_PREFIX.length);
      setSelectedIdsRaw(selectedIds.filter((x) => x !== id));
      resetProductAmount(id);
    }
  };

  const confirmUnsuitable = () => {
    if (!unsuitableWarning) return;
    const product = unsuitableWarning;
    setUnsuitableWarning(null);
    openPendingAdd(product);
  };

  const selectedProducts = ALL_ITEMS.filter(p=>selectedIds.includes(p.id));
  const customerName = selectedCustomerProfile.name||selectedCustomerProfile.fallbackName||"고객";

  // "리밸런싱 확정" 버튼 제거 — 상품/채권 편입은 이미 선택 즉시(pendingAdd 확정 시점) rebalancingSellAssets에
  // 반영되고, 세금 계산은 Tab3Page의 실시간 재분석이 자동 처리한다. 이 화면에 남은 건 "떠날 때 리밸런싱
  // 히스토리를 체크포인트로 기록"하는 것뿐 — 언마운트(다른 내부 탭 이동) 시점에 기록한다.
  const selectedProductsRef = useRef(selectedProducts);
  selectedProductsRef.current = selectedProducts;
  const clientRef = useRef(client);
  clientRef.current = client;
  const rebalancingBuyAssetsRef = useRef(rebalancingBuyAssets);
  rebalancingBuyAssetsRef.current = rebalancingBuyAssets;
  const portfolioAssetsRef = useRef(portfolioAssets);
  portfolioAssetsRef.current = portfolioAssets;
  const selectedCustomerRef = useRef(selectedCustomer);
  selectedCustomerRef.current = selectedCustomer;
  const sharedUiStateRef = useRef(sharedUiState);
  sharedUiStateRef.current = sharedUiState;
  const updateSharedUiStateRef = useRef(updateSharedUiState);
  updateSharedUiStateRef.current = updateSharedUiState;

  useEffect(() => {
    return () => {
      const products = selectedProductsRef.current;
      if (products.length === 0) return;
      const c = clientRef.current;

      const productsForHistory = products.map((product) => {
        const sameBucketCount = products.filter((item) => item.bucket === product.bucket).length || 1;
        const amountKrw = (c.investableAssets * getBucketWeight(product.bucket)) / sameBucketCount;

        const historyCategory = (() => {
          if (product.type === "채권") {
            if (product.bondRef?.market === "국내") return "국내채권";
            if (product.bondRef?.market === "해외") return "해외채권";
            return "채권";
          }
          if (product.type === "펀드" || product.type === "랩어카운트") {
            const prefix = product.taxType === "국내주식형" ? "국내" : product.taxType === "해외주식형" ? "해외" : "";
            if (!prefix) return product.type;
            return product.type === "랩어카운트" ? `${prefix}랩` : `${prefix}펀드`;
          }
          if (product.type === "ETF") {
            if (product.taxType === "국내주식형") return "국내ETF";
            if (product.taxType === "해외주식형") return "해외ETF";
          }
          return product.type;
        })();

        return { id: product.id, category: historyCategory, name: product.name, ticker: "", amountKrw };
      });

      const normalizedProductsForHistory = productsForHistory.map((item, index) => ({
        ...item,
        category: historyProductCategory(products[index], item.category),
      }));

      const historyRecord = createProductRebalancingRecord({
        customerId: selectedCustomerRef.current,
        baseAssets: rebalancingBuyAssetsRef.current.length > 0 ? rebalancingBuyAssetsRef.current : portfolioAssetsRef.current,
        products: normalizedProductsForHistory,
      });

      updateSharedUiStateRef.current({
        tab3: {
          rebalancingHistory: upsertRebalancingHistory(
            sharedUiStateRef.current.tab3?.rebalancingHistory ?? [],
            historyRecord,
          ),
        },
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {modalProduct && <ProductModal product={modalProduct} onClose={()=>setModalProduct(null)}/>}
      {salesSolutionOpen && (() => {
        const activeMonth = SALES_SOLUTIONS.find((m) => m.month === salesSolutionMonth) ?? SALES_SOLUTIONS[SALES_SOLUTIONS.length - 1];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setSalesSolutionOpen(false)}>
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-samsung/10 text-samsung"><Newspaper size={18}/></div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">삼성증권 리서치센터</p>
                    <h3 className="text-base font-bold text-navy">영업 솔루션</h3>
                  </div>
                </div>
                <button type="button" onClick={() => setSalesSolutionOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                  <X size={16}/>
                </button>
              </div>

              <div className="flex gap-2 border-b border-slate-100 px-6 pt-3">
                {SALES_SOLUTIONS.map((m) => (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => setSalesSolutionMonth(m.month)}
                    className={`rounded-t-lg px-4 py-2.5 text-sm font-bold transition ${m.month === activeMonth.month ? "border border-b-0 border-slate-200 bg-white text-samsung" : "text-slate-400 hover:text-slate-600"}`}
                  >
                    {m.month} 영업 솔루션
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="mb-5 rounded-xl border border-samsung/25 bg-samsung/[0.07] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-samsung/80">{activeMonth.month} 금융시장 콘셉트</p>
                  <p className="mt-1 text-lg font-black text-samsung">{activeMonth.concept}</p>
                  <p className="mt-1 text-sm text-slate-700">{activeMonth.conceptKo}</p>
                  <div className="mt-3.5 space-y-2">
                    {activeMonth.diagnosis.map((d, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-sm leading-6 text-slate-700">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-samsung"/>
                        <span>{d}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  {activeMonth.strategies.map((strat, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 p-4">
                      <div className="mb-3 flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-samsung/10 text-samsung">{strat.icon}</div>
                        <p className="text-base font-bold text-navy">전략 {i + 1} · {strat.title}</p>
                      </div>
                      <ul className="mb-3.5 space-y-3">
                        {strat.points.map((pt, j) => (
                          <li key={j} className="flex items-start gap-2.5">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-samsung"/>
                            <div>
                              <p className="text-sm font-bold leading-5 text-navy">{pt.lead}</p>
                              <p className="mt-0.5 text-xs leading-5 text-slate-500">{pt.detail}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap gap-1.5">
                        {strat.tags.map((tag) => (
                          <span key={tag} className="rounded-full border border-samsung/20 bg-samsung/[0.06] px-2.5 py-1 text-xs font-bold text-samsung">{tag}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 bg-slate-50 px-6 py-3">
                <p className="text-[11px] text-slate-400">자료: 삼성증권 리서치센터 · 실제 상담 시 원문 자료를 함께 확인하세요</p>
              </div>
            </div>
          </div>
        );
      })()}

      {unsuitableWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="px-6 py-5 bg-red-50 border-b border-red-100">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
                  <AlertOctagon size={20} className="text-red-600"/>
                </div>
                <div>
                  <p className="text-xs font-bold text-red-500 uppercase tracking-wide">성향 부적합 상품</p>
                  <h3 className="text-base font-bold text-navy mt-0.5">{unsuitableWarning.name}</h3>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <p className="text-sm font-bold text-red-800 mb-1">위험성향 불일치</p>
                <p className="text-xs leading-5 text-red-700">
                {GRADE_LABELS[unsuitableWarning.riskGrade]}위험 수준의 상품으로 고객의 투자성향({RISK_LABELS[client.riskAppetite]}) Risk 허용 범위를 벗어납니다.
                </p>
              </div>
              <p className="text-sm font-semibold text-slate-600 leading-6">고객에게 충분한 설명과 동의를 받은 후 진행하시겠습니까?</p>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={()=>setUnsuitableWarning(null)}
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 transition">
                  뒤로가기
                </button>
                <button type="button" onClick={confirmUnsuitable}
                  className="min-h-11 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition">
                  확인 후 진행
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {minInvestBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={()=>setMinInvestBlocked(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e)=>e.stopPropagation()}>
            <div className="px-6 py-5 bg-amber-50 border-b border-amber-100">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                  <AlertTriangle size={20} className="text-amber-600"/>
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-600 uppercase tracking-wide">최소 가입금액 미달</p>
                  <h3 className="text-base font-bold text-navy mt-0.5">{minInvestBlocked.product.name}</h3>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {minInvestBlocked.blockedBy ? (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-bold text-amber-800 mb-1">이미 담긴 상품이 최소가입금액 밑으로 떨어집니다</p>
                  <p className="text-xs leading-5 text-amber-700">
                    이 상품을 추가하면 같은 버킷({minInvestBlocked.product.bucket}) 배분액을 더 많은 상품이 나눠 갖게 되어, 이미 선택된 <b>{minInvestBlocked.blockedBy.name}</b>의 편입 권고 금액이 최소 가입금액({minInvestBlocked.blockedBy.minInvest}) 밑으로 떨어집니다.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-bold text-amber-800 mb-1">편입 권고 금액이 최소 가입금액에 못 미칩니다</p>
                  <p className="text-xs leading-5 text-amber-700">
                    현재 버킷 배분 기준 편입 권고 금액은 <b>{fmtWon(minInvestBlocked.perProductAmt)}</b>인데, 이 상품의 최소 가입금액은 <b>{minInvestBlocked.product.minInvest}</b>({fmtWon(minInvestBlocked.requiredAmt)})입니다.
                  </p>
                </div>
              )}
              <p className="text-sm font-semibold text-slate-600 leading-6">투자가능자산을 늘리거나, 같은 버킷 내 다른 선택 상품 수를 줄여 1개당 배분액을 키운 뒤 다시 담아주세요. 최소가입금액 미달 상품은 포트폴리오에 담을 수 없습니다.</p>
              <button type="button" onClick={()=>setMinInvestBlocked(null)}
                className="min-h-11 w-full rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 transition">
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAdd && (() => {
        const p = pendingAdd;
        const maxLimit = pendingAddMaxLimit(p);
        const err = amountEditError && amountEditError.product.id === p.id ? amountEditError.message : null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setPendingAdd(null)}>
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 py-5 bg-blue-50 border-b border-blue-100">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                    <Landmark size={20} className="text-samsung"/>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-samsung uppercase tracking-wide">{p.bucket} 버킷 · 편입 금액 입력</p>
                    <h3 className="text-base font-bold text-navy mt-0.5">{p.name}</h3>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5">
                  <span className="text-xs font-semibold text-slate-500">최대 한도(버킷 잔여 배분 가능액)</span>
                  <span className="text-sm font-bold text-navy">{fmtWon(maxLimit)}</span>
                </div>
                {p.minInvest && (
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5">
                    <span className="text-xs font-semibold text-slate-500">최소 가입금액</span>
                    <span className="text-sm font-bold text-navy">{p.minInvest}</span>
                  </div>
                )}
                <div>
                  <p className="mb-1.5 text-xs font-bold text-slate-600">편입 금액</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={pendingAddAmountStr}
                      onChange={(e) => setPendingAddAmountStr(e.target.value.replace(/[^0-9]/g, ""))}
                      className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-right text-lg font-black text-samsung focus:border-samsung focus:outline-none"
                    />
                    <span className="text-sm font-bold text-slate-400">원</span>
                  </div>
                  <button type="button" onClick={() => openPendingAdd(p)}
                    className="mt-1.5 text-[11px] font-semibold text-slate-400 underline hover:text-slate-600">
                    자동분배 금액으로
                  </button>
                </div>
                {err && <p className="text-xs font-semibold text-red-500">{err}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setPendingAdd(null)}
                    className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 transition">
                    취소
                  </button>
                  <button type="button" onClick={confirmPendingAdd}
                    className="min-h-11 rounded-xl bg-samsung px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 transition">
                    담기
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {!rrttlluReady && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertCircle size={18} className="shrink-0 text-amber-600"/>
          <div>
            <p className="text-sm font-bold text-amber-800">TAB1 성향 분석 후 이용 가능합니다</p>
            <p className="mt-0.5 text-xs text-amber-700">고객 성향 분석을 완료하면 맞춤 상품 추천이 시작됩니다.</p>
          </div>
        </div>
      )}

      <HoldingsCardGrid
        baseAssets={baseAssets}
        portfolioAssets={portfolioAssets}
        isCustomerView={isCustomerView}
        onSell={handleRemoveHolding}
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-samsung"><BarChart3 size={18}/></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">성향 기반 배분</p>
            <h2 className="text-lg font-bold text-navy">{customerName}님 맞춤 자산 배분 가이드</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">* 투자가능자산 기준으로 산출된 배분 가이드입니다</p>
          </div>
        </div>
        {rrttlluReady&&weights ? (
          <div className="space-y-3">
            {BUCKETS.map(bucket=>{
              const w = getBucketWeight(bucket);
              const cfg = BUCKET_CFG[bucket];
              const amt = client.investableAssets * w;
              return (
                <div key={bucket}>
                  <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                    <span className={`flex items-center gap-1 ${cfg.color}`}>{cfg.icon}{bucket}</span>
                    <div className="flex items-center gap-2">
                      {amt>0&&<span className="text-slate-400">{fmtWon(amt)}</span>}
                      <span className="font-bold text-navy">{(w*100).toFixed(1)}%</span>
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
            <AlertCircle size={24} className="text-slate-300"/>
            <p className="text-sm font-semibold text-slate-400">TAB1에서 RRTTLLU를<br/>입력해주세요</p>
          </div>
        )}
        {rrttlluReady&&client.isTaxTarget&&(
          <div className="mt-5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
            <p className="text-xs font-bold text-orange-700">⚠️ 금융소득종합과세 대상 고객</p>
            <p className="mt-1 text-xs font-semibold text-orange-800">
              {buildTaxAlertMessage(client.hasTab4TaxData, client.taxExcessAmount, internalJsonPayload.rrttllu.tax.financial_income_tax_alert)}
            </p>
            <p className="mt-1 text-xs text-orange-600">절세 버킷 {(weights!.T*100).toFixed(1)}% 적용 — 연금보험·분리과세채권 우선 추천</p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-samsung"><BarChart3 size={18}/></div>
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">버킷별 매칭 상품</p>
            <h2 className="text-lg font-bold text-navy">삼성증권 추천 상품</h2>
            <p className="mt-0.5 text-xs text-slate-400">성향 적합 상품이 우선 표시됩니다. 카드를 클릭해 상세 정보를 확인하고 체크박스로 선택하세요</p>
          </div>
          <button
            type="button"
            onClick={()=>setSalesSolutionOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-samsung/30 bg-samsung/5 px-3 py-2 text-xs font-bold text-samsung transition hover:bg-samsung/10"
          >
            <Newspaper size={14}/>영업 솔루션 읽기
          </button>
        </div>
        {!rrttlluReady ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
            <p className="text-sm text-slate-400">성향 분석 완료 후 맞춤 상품이 표시됩니다</p>
          </div>
        ) : (
          <div className="space-y-4">
            {BUCKETS.map(bucket=>{
              const cfg = BUCKET_CFG[bucket];
              const allProds = bucketAllProducts?.[bucket]??[];
              const bw = getBucketWeight(bucket);
              const bucketAmt = client.investableAssets * bw;
              const presentTypes = PRODUCT_TYPE_ORDER.filter(t=>allProds.some(p=>p.type===t));
              const itemFilter = bucketItemFilter[bucket] ?? "all";
              const shownProds = itemFilter==="all" ? allProds : allProds.filter(p=>p.type===itemFilter);
              return (
                <div key={bucket} className={`rounded-xl border p-5 ${cfg.border} ${cfg.bg}`}>
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${cfg.border} bg-white ${cfg.color}`}>{cfg.icon}</span>
                      <div>
                        <span className={`text-sm font-bold ${cfg.color}`}>{bucket}</span>
                        <p className="text-xs text-slate-400">총 {allProds.length}개</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-black ${cfg.color}`}>{(bw*100).toFixed(1)}%</p>
                      {bucketAmt>0&&<p className="text-xs text-slate-400">{fmtWon(bucketAmt)}</p>}
                    </div>
                  </div>
                  {allProds.length>0 && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      <button type="button"
                        onClick={()=>setBucketItemFilter(prev=>({...prev,[bucket]:"all"}))}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition ${itemFilter==="all"?`${cfg.bg} ${cfg.border} ${cfg.color}`:"border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                        전체 {allProds.length}
                      </button>
                      {presentTypes.map(t=>(
                        <button key={t} type="button"
                          onClick={()=>setBucketItemFilter(prev=>({...prev,[bucket]:t}))}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition ${itemFilter===t?`${cfg.bg} ${cfg.border} ${cfg.color}`:"border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                          {t} {allProds.filter(p=>p.type===t).length}
                        </button>
                      ))}
                    </div>
                  )}
                  {shownProds.length>0 ? (
                    <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-1 pt-2.5 sm:grid-cols-2">
                      {shownProds.map(p=>{
                        const sel = selectedIds.includes(p.id);
                        const unsuitable = isUnsuitable(p, client);
                        const bond = p.bondRef;
                        const topPickLabels = getTopPickLabels(p.id);
                        return (
                          <div key={p.id}
                            className={`relative rounded-xl border-2 bg-white p-4 cursor-pointer transition-all ${sel?"border-samsung shadow-md":unsuitable?"border-red-200 hover:border-red-300 opacity-75":"border-slate-200 hover:border-slate-300 hover:shadow-sm"}`}
                            onClick={()=>setModalProduct(p)}>
                            {topPickLabels.length > 0 && (
                              <div className="absolute left-3 -top-2.5 z-10 flex gap-1">
                                {topPickLabels.map((label) => (
                                  <span key={label} className="rounded bg-samsung px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm ring-1 ring-white">
                                    {label}
                                  </span>
                                ))}
                              </div>
                            )}
                            {unsuitable && (
                              <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-red-100 border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-600">
                                <AlertTriangle size={9}/>성향 부적합
                              </span>
                            )}
                            <button type="button"
                              onClick={e=>{e.stopPropagation();handleSelect(p);}}
                              disabled={isCustomerView && sel}
                              className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${sel?"border-samsung bg-samsung text-white":unsuitable?"border-red-300 bg-white hover:border-red-400":"border-slate-300 bg-white hover:border-samsung"} ${isCustomerView&&sel?"cursor-not-allowed opacity-50":""}`}>
                              {sel&&<CheckCircle2 size={14}/>}
                            </button>
                            <div className={`mb-2 flex items-center gap-1.5 pr-8 ${unsuitable?"mt-5":""}`}>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{p.type}</span>
                              {bond && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">{bond.market}</span>}
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">점수 {p.score}</span>
                            </div>
                            <p className="mb-1 text-sm font-bold leading-5 text-navy pr-2">{p.name}</p>
                            <p className="mb-3 text-xs leading-5 text-slate-500">{p.desc}</p>
                            {p.minInvest&&<p className="mb-2 text-xs text-slate-400">최소 {p.minInvest} · {p.fee}</p>}
                            <div className="mb-3 grid grid-cols-3 gap-1.5 text-center text-xs">
                              {bond ? (
                                <>
                                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">신용등급</p><p className="font-bold text-navy">{bond.creditRating}</p></div>
                                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">만기</p><p className="font-bold text-navy">{bond.maturity}</p></div>
                                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">세전수익률</p><p className="font-bold text-navy">{(bond.tradeYield ?? bond.yieldPretax) != null ? `${bond.tradeYield ?? bond.yieldPretax}%` : "-"}</p></div>
                                </>
                              ) : (
                                <>
                                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">위험</p><p className="font-bold text-navy">{p.riskGrade}등급</p></div>
                                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">1년</p><p className="font-bold text-navy">{p.return1Y!=null&&p.return1Y>0?`${p.return1Y}%`:"-"}</p></div>
                                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-slate-400">3년</p><p className="font-bold text-navy">{p.return3Y?`${p.return3Y}%`:"-"}</p></div>
                                </>
                              )}
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
            <button type="button" onClick={()=>{if(!isCustomerView){setSelectedIdsRaw([]);setActiveEffectId(null);}}} disabled={isCustomerView} className="text-xs font-bold text-slate-400 hover:text-red-500 transition disabled:cursor-not-allowed disabled:opacity-40">전체 해제</button>
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
                        <div className="flex items-center gap-2 min-w-0">
                          {isUnsuitable(p,client)&&<AlertTriangle size={12} className="shrink-0 text-red-500"/>}
                          <p className="text-xs font-semibold text-navy truncate">{p.name}</p>
                        </div>
                        <button type="button" onClick={()=>{if(!isCustomerView)handleSelect(p);}} disabled={isCustomerView} className="shrink-0 text-slate-300 hover:text-red-400 transition disabled:cursor-not-allowed disabled:opacity-40"><X size={14}/></button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {selectedProducts.length>0 && rrttlluReady && weights && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-samsung text-white"><Sparkles size={18}/></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-normal text-slate-500">RRTTLLU 맞춤 분석</p>
              <h2 className="text-lg font-bold text-navy">{customerName}님 상품 편입 효과 분석</h2>
              <p className="mt-0.5 text-xs text-slate-400">선택하신 상품이 {customerName}님 성향에 어떤 효과를 제공하는지 분석합니다</p>
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {selectedProducts.map(p=>{
              const cfg = BUCKET_CFG[p.bucket];
              const isActive = (activeEffectId??selectedProducts[0]?.id)===p.id;
              const unsuitable = isUnsuitable(p, client);
              return (
                <button key={p.id} type="button"
                  onClick={()=>setActiveEffectId(p.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition ${isActive?`${cfg.bg} ${cfg.border} ${cfg.color}`:"border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"}`}>
                  {unsuitable ? <AlertTriangle size={12} className="text-red-500"/> : cfg.icon}
                  <span className="max-w-[120px] truncate">{p.name}</span>
                </button>
              );
            })}
          </div>

          {(() => {
            const p = selectedProducts.find(x=>x.id===(activeEffectId??selectedProducts[0]?.id)) ?? selectedProducts[0];
            if (!p || !weights) return null;
            const sameBucketProducts = selectedProducts.filter(x=>x.bucket===p.bucket);
            const sameBucketCount = sameBucketProducts.length;
            const bucketWForAmt = getBucketWeight(p.bucket);
            const bucketAmtForAmt = client.investableAssets * bucketWForAmt;
            const bucketAmounts = computeBucketAmounts(bucketAmtForAmt, sameBucketProducts, pinnedAmounts);
            const isPinned = pinnedAmounts[p.id] != null;
            const roundedAmt = bucketAmounts[p.id] != null ? Math.round(bucketAmounts[p.id]) : undefined;
            const { unsuitable, reasons, upsides, bucketAmt, perProductAmt, minInvestOk } = analyzeProductFit(p, client, weights, sameBucketCount, roundedAmt);
            const cfg = BUCKET_CFG[p.bucket];
            const bw = getBucketWeight(p.bucket);
            const realHoldings = (p.topHoldings??[]).filter(isRealHolding);

            return (
              <div className="space-y-4">
                <div className={`rounded-xl border p-4 ${unsuitable?"bg-red-50 border-red-200":cfg.bg+" "+cfg.border}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${cfg.bg} ${cfg.border} ${cfg.color}`}>{cfg.icon}{p.bucket}</span>
                        <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{p.type}</span>
                        {unsuitable&&<span className="flex items-center gap-1 rounded-full bg-red-100 border border-red-200 px-2.5 py-0.5 text-xs font-bold text-red-600"><AlertOctagon size={10}/>성향 부적합 — 고객 동의 편입</span>}
                      </div>
                      <p className="text-sm font-bold text-navy">{p.name}</p>
                      {p.manager && <p className="text-xs text-slate-500 mt-0.5">운용사: {p.manager}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-400">RRTTLLU 점수</p>
                      <p className={`text-xl font-black ${unsuitable?"text-red-500":"text-samsung"}`}>{Math.round(calcScore(p,client,weights,ALL_ITEMS)*10)/10}</p>
                    </div>
                  </div>
                </div>

                <div className={`rounded-xl border p-4 ${unsuitable?"border-red-100 bg-red-50":"border-slate-100 bg-slate-50"}`}>
                  <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                    {unsuitable
                      ? `${customerName} 고객님께 해당 상품이 부적합한 이유`
                      : `${customerName} 고객님께 해당 상품이 적합한 이유`}
                  </p>
                  <div className="space-y-2">
                    {reasons.map((r,i)=>(
                      <div key={i} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                        r.type==="good"?"border-emerald-100 bg-white":
                        r.type==="bad"?"border-red-100 bg-white":
                        "border-amber-100 bg-amber-50"}`}>
                        {r.type==="good"
                          ? <BadgeCheck size={15} className="shrink-0 text-emerald-600 mt-0.5"/>
                          : r.type==="bad"
                          ? <AlertOctagon size={15} className="shrink-0 text-red-500 mt-0.5"/>
                          : <AlertTriangle size={15} className="shrink-0 text-amber-500 mt-0.5"/>}
                        <div>
                          <p className={`text-xs font-bold ${r.type==="good"?"text-emerald-800":r.type==="bad"?"text-red-800":"text-amber-800"}`}>{r.label}</p>
                          <p className="text-xs text-slate-600 mt-0.5 leading-5">{r.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {unsuitable && upsides.length>0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp size={14} className="text-blue-600"/>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-600">위험 감수 시 기대할 수 있는 효과</p>
                    </div>
                    <div className="space-y-2">
                      {upsides.map((u,i)=>(
                        <div key={i} className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
                          <BadgeCheck size={15} className="shrink-0 text-blue-600 mt-0.5"/>
                          <div>
                            <p className="text-xs font-bold text-blue-800">{u.label}</p>
                            <p className="text-xs text-slate-600 mt-0.5 leading-5">{u.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="mb-3 text-xs font-bold text-slate-600 uppercase tracking-wide">편입 권고 금액</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
                      <p className="text-xs text-slate-400 mb-1">{p.bucket} 버킷 배분 비중</p>
                      <p className="text-lg font-black text-navy">{(bw*100).toFixed(1)}%</p>
                      {sameBucketCount>1&&<p className="text-[10px] text-slate-400 mt-0.5">동일 버킷 {sameBucketCount}개 선택</p>}
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
                      <p className="text-xs text-slate-400 mb-1">이 상품 편입 금액{isPinned ? " (직접 지정)" : ""}</p>
                      <p className={`text-lg font-black ${perProductAmt>0?"text-samsung":"text-slate-300"}`}>
                        {perProductAmt>0?fmtWon(perProductAmt):"투자금액 미입력"}
                      </p>
                      {sameBucketCount>1&&perProductAmt>0&&(
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {isPinned ? "직접 지정한 금액" : `버킷 총액 ${fmtWon(bucketAmt)} 중 균등분배`}
                        </p>
                      )}
                    </div>
                  </div>
                  {p.minInvest && perProductAmt > 0 && (
                    <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${minInvestOk?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"}`}>
                      {minInvestOk
                        ? <><BadgeCheck size={13}/> 최소 가입금액({p.minInvest}) 충족</>
                        : <><AlertTriangle size={13}/> 최소 가입금액({p.minInvest}) 미달 — 버킷 비중 조정 필요</>}
                    </div>
                  )}
                </div>

                {p.strategy && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <p className="mb-2 text-xs font-bold text-blue-800 uppercase tracking-wide">운용 전략</p>
                    <p className="text-xs leading-6 text-blue-900">{p.strategy}</p>
                  </div>
                )}

                {p.taxBenefit && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
                    <p className="mb-2 text-xs font-bold text-rose-800 uppercase tracking-wide">세금 효과</p>
                    <p className="text-xs leading-6 text-rose-900">{p.taxBenefit}</p>
                  </div>
                )}

                {realHoldings.length>0&&(
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="mb-2 text-xs font-bold text-slate-600 uppercase tracking-wide">상위 편입 종목</p>
                    <div className="flex flex-wrap gap-1.5">
                      {realHoldings.map((h,i)=>(
                        <span key={i} className="bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded-md text-xs font-medium shadow-sm">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      )}
      {!isCustomerView && (
        <div className="flex items-center justify-end gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-emerald-600 shadow-soft">
          <BadgeCheck size={14} />
          담는 즉시 실시간 반영 — TAB4에 자동 동기화됩니다
        </div>
      )}
    </>
  );
}
