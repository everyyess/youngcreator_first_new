"use client";

import { useMemo, useState, useEffect } from "react";
import type { FinancialIncomeSummary } from "../tab1/FinancialIncomeGauge";
import {
  Sparkles, ShieldCheck, TrendingUp, Landmark, PiggyBank,
  FileText, BarChart3, AlertCircle,
  ChevronRight, CheckCircle2, X, Info, BadgeCheck, AlertTriangle, AlertOctagon
} from "lucide-react";
import { useCustomerContext, loadTaxSummaries } from "../CustomerContext";
import { usePortfolioResult } from "../PortfolioResultComponents";
import { useCustomerView } from "../CustomerViewContext";
import { parseLiquidityEntries, type LiquidityKind } from "../liquidityFields";

type BucketType = "자본증식" | "인컴창출" | "위험헷지" | "유동성" | "절세";
type TaxType = "국내주식형" | "해외주식형" | "채권형" | "비과세연금" | "분리과세" | "소득공제";
type ProductType = "펀드" | "랩어카운트" | "보험" | "채권" | "ETF";

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
  monthlyIncome: number; investableAssets: number;
  lumpSumTimepoint: number;
  liquidityNeeds: LiquidityNeed[];
  taxExcessAmount: number;
  hasTab4TaxData: boolean;
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
  f11: "/docs/fund-pension.pdf",
  f13: "/docs/fund-bluechip.pdf",
  f14: "/docs/fund-kosdaq-venture.pdf",
};

const PRODUCTS: Product[] = [
  { id:"r1", name:"플레인바닐라 매크로 온앤오프", type:"랩어카운트", riskGrade:1, return1Y:15.99, return3Y:34.16, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"3천만원", fee:"연 1.5%", desc:"미국 ETF 투자, 경기 국면별 주식/채권 비중 전환", manager:"플레인바닐라", strategy:"미국 ETF를 중심으로 경기 국면을 판단해 주식과 채권 비중을 동적으로 조절하는 매크로 전략입니다. 경기 확장기에는 주식 비중을 높이고, 수축기에는 채권으로 방어합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 대상에서 제외됩니다. 종소세 대상 고객의 세 부담을 효과적으로 줄일 수 있습니다.", topHoldings:["미국 주식 ETF","미국 채권 ETF","글로벌 매크로 자산"] },
  { id:"r2", name:"루미스세일즈 미국 올캡 그로스", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"미국 성장주 장기 투자", manager:"루미스세일즈", strategy:"미국 전 시가총액에 걸쳐 성장 잠재력이 높은 기업을 발굴해 장기 보유합니다. 시장 벤치마크를 추종하지 않는 액티브 운용 방식으로, 운용사의 독립적 판단을 중시합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["미국 대형성장주","미국 중소형성장주"] },
  { id:"r3", name:"삼성자산 4차산업 혁신주", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"글로벌 4차산업/IT 핵심 기업 집중 투자", manager:"삼성자산운용", strategy:"AI, 반도체, 클라우드 등 4차산업 혁신을 이끄는 글로벌 핵심 기업에 집중 투자합니다. 기술 패권 경쟁에서 수혜를 받는 기업을 선별해 성장성을 극대화합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["글로벌 IT 대형주","테크 혁신 기업"] },
  { id:"r4", name:"피델리티 미국 테크", type:"랩어카운트", riskGrade:1, return1Y:20.37, return3Y:34.39, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"1억원", fee:"연 2.6%", desc:"글로벌 기술 혁신 기업 집중 투자", manager:"피델리티", strategy:"미국과 글로벌 기술 혁신 기업을 중심으로 액티브 운용합니다. 피델리티의 글로벌 리서치 역량을 바탕으로 기술 섹터 내 선도 기업을 선별합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["미국 빅테크 주식","글로벌 반도체/소프트웨어"] },
  { id:"r5", name:"플레인바닐라 테크차이나", type:"랩어카운트", riskGrade:1, return1Y:0, return3Y:null, bucket:"자본증식", isInstantRedeem:false, taxType:"해외주식형", minInvest:"5천만원", fee:"연 1.5%", desc:"중국 테크 테마 주식 및 ETF", manager:"플레인바닐라", strategy:"중국 기술주와 관련 ETF로 구성된 포트폴리오입니다. 중국 빅테크 규제 완화와 AI 산업 성장 수혜를 목표로 합니다.", taxBenefit:"해외주식 매매차익에 22% 분류과세가 적용되어 금융소득종합과세 합산에서 제외됩니다.", topHoldings:["중국 빅테크","홍콩 테크 ETF"] },
  { id:"r6", name:"파인 밸류웨이", type:"랩어카운트", riskGrade:2, return1Y:149.82, return3Y:182.58, bucket:"인컴창출", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"연 2.6%", desc:"Bottom-up 가치투자 장기 성과 추구", manager:"파인자산운용", strategy:"국내 저평가 우량주를 발굴해 장기 보유하는 Bottom-up 가치투자 전략입니다. 시장 흐름보다 개별 기업의 내재가치에 집중해 안정적인 장기 성과를 추구합니다.", taxBenefit:"국내주식 매매차익은 비과세 적용됩니다. 배당소득은 15.4% 원천징수되며, 종소세 대상 고객에게 절세 효과가 있습니다.", topHoldings:["국내 가치주","대형 우량주"] },
  { id:"r7", name:"체슬리 다크호스", type:"랩어카운트", riskGrade:2, return1Y:149.82, return3Y:182.58, bucket:"인컴창출", isInstantRedeem:false, taxType:"국내주식형", minInvest:"5천만원", fee:"연 2.6%", desc:"Top-down 내재가치 분석 섹터 발굴", manager:"체슬리투자자문", strategy:"거시경제 분석을 바탕으로 유망 섹터를 먼저 선별한 후, 그 안에서 내재가치 대비 저평가된 기업을 발굴합니다. Top-down 접근으로 섹터 흐름과 개별 종목 모두를 고려합니다.", taxBenefit:"국내주식 매매차익은 비과세 적용됩니다. 종소세 대상 고객에게 금융소득 절감 효과가 있습니다.", topHoldings:["주도 섹터 대형주","성장 유망주"] },
  { id:"r8", name:"삼성 증금 MMW", type:"랩어카운트", riskGrade:6, return1Y:1.75, return3Y:9.81, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", minInvest:"100만원", fee:"연 0.05%", desc:"AAA 증권금융 예수금 투자, 매일 수익 정산", manager:"삼성증권", strategy:"AAA 등급 증권금융 예수금에 투자하며 매일 수익을 정산합니다. 원금 손실 위험이 극히 낮고 즉시 출금이 가능해 단기 여유 자금 운용에 최적화된 상품입니다.", taxBenefit:"이자소득에 15.4% 원천징수가 적용됩니다. 금융소득으로 합산되나 금액이 작아 종소세 부담이 낮습니다.", topHoldings:["증권금융 예수금","초단기 채권"] },
  { id:"f1", name:"삼성글로벌반도체증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:1, return1Y:203.79, return3Y:343.90, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"AI·반도체 밸류체인 집중 투자", aum:"914.06억", manager:"삼성자산운용", inception:"2011-09", stars:5, strategy:"TSMC, NVIDIA, ASML 등 글로벌 반도체 밸류체인 전반에 집중 투자합니다. 환헤지를 적용하지 않아(UH) 달러 강세 시 추가 수익도 기대할 수 있습니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 해외펀드 특성상 금융소득에 합산되며, 종소세 대상 고객은 유의가 필요합니다.", topHoldings:["SK하이닉스","NVIDIA CORP","APPLIED MATERIALS INC","MICRON TECHNOLOGY INC","BROADCOM INC"] },
  { id:"f2", name:"삼성글로벌휴머노이드로봇증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:2, return1Y:67.52, return3Y:null, bucket:"자본증식", isInstantRedeem:true, taxType:"해외주식형", desc:"휴머노이드 로봇·AI 글로벌 기업 투자", aum:"1,287억", manager:"삼성자산운용", inception:"2025-02", strategy:"테슬라, 엔비디아 등 휴머노이드 로봇 밸류체인 전반에 투자합니다. 2025년 설정된 신생 펀드로 로봇 산업 초기 성장 수혜를 목표로 합니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 신생 펀드 특성상 3년 수익률 데이터가 아직 없습니다.", topHoldings:["TESLA INC","로보티즈","UBTECH ROBOTICS CORP","MDA Space Ltd","레인보우로보틱스"] },
  { id:"f3", name:"삼성미국S&P500인덱스증권자투자신탁UH[주식]-A", type:"펀드", riskGrade:3, return1Y:35.14, return3Y:95.62, bucket:"인컴창출", isInstantRedeem:true, taxType:"해외주식형", desc:"미국 S&P500 지수 추종, 안정적 장기 성장", aum:"1,397억", manager:"삼성자산운용", inception:"2016-03", strategy:"미국 S&P500 지수를 추종하는 패시브 펀드입니다. 미국 대형주 500개에 분산 투자해 안정적인 장기 성장을 추구합니다. 환헤지 미적용으로 달러 자산 효과도 있습니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 금융소득으로 합산되며, 장기 보유 시 복리 효과가 극대화됩니다.", topHoldings:["NVIDIA CORP","APPLE INC","iShares Core S&P 500 ETF","MICROSOFT CORP","AMAZON.COM INC"] },
  { id:"f4", name:"삼성글로벌액티브TDF2050증권UH[주식혼합]-A", type:"펀드", riskGrade:3, return1Y:39.92, return3Y:87.05, bucket:"인컴창출", isInstantRedeem:true, taxType:"해외주식형", desc:"2050 은퇴 목표 자동 리밸런싱", aum:"2,110억", manager:"삼성자산운용", inception:"2019-02", stars:5, strategy:"2050년 은퇴를 목표로 설계된 TDF입니다. 현재는 주식 비중이 높고, 은퇴 시점이 가까워질수록 채권 비중이 자동으로 높아집니다. 별도 리밸런싱 없이 생애주기에 맞게 운용됩니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 장기 운용 특성상 복리 효과가 크며, 은퇴 설계 목적에 최적화되어 있습니다.", topHoldings:["KODEX200액티브","KODEX 미국S&P500(H)","KODEX미국AI전력핵심인프라","VANGUARD INFO TECH ETF","ROUNDHILL GEN AI & TECH FLYER"] },
  { id:"f5", name:"삼성밸류라이프플랜65증권전환형자투자신탁[주식]-A", type:"펀드", riskGrade:3, return1Y:149.82, return3Y:182.58, bucket:"인컴창출", isInstantRedeem:true, taxType:"국내주식형", desc:"국내 우량주 장기 가치투자, 은퇴 설계형", aum:"8.91억", manager:"삼성자산운용", inception:"2002-11", stars:4, strategy:"국내 우량주에 장기 투자하는 은퇴 설계형 펀드입니다. 65세 은퇴를 목표로 안정적인 가치주 중심으로 운용되며, 국내 대형 우량주의 배당과 성장을 동시에 추구합니다.", taxBenefit:"국내주식 매매차익은 비과세 적용됩니다. 배당소득은 15.4% 원천징수이며, 종소세 대상 고객에게 절세 효과가 있습니다.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","LG에너지솔루션","현대차"] },
  { id:"f6", name:"삼성달러표시단기채권증권자투자신탁UH[채권]-A", type:"펀드", riskGrade:4, return1Y:15.99, return3Y:34.16, bucket:"위험헷지", isInstantRedeem:true, taxType:"채권형", desc:"달러 단기채권, 환율 헷지 + 금리 방어", aum:"916억", manager:"삼성자산운용", inception:"2016-01", stars:4, strategy:"달러 표시 단기채권에 투자합니다. 환헤지를 적용하지 않아 달러 강세 시 환차익도 기대할 수 있습니다. 주식시장 하락 시 방어 역할과 동시에 달러 분산 효과를 제공합니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 채권 이자수익이 금융소득에 합산되며, 달러 환차익은 별도 과세됩니다.", topHoldings:["HYUELE 5 1/2 01/16/27","HYUCAP 5 1/4 01/22/28","POHANG 4 7/8 01/23/27","T3 3/4 04/30/27","HYUSEC 2 1/8 11/01/26"] },
  { id:"f7", name:"삼성밸류라이프플랜35증권전환형자투자신탁[채권혼합]-A", type:"펀드", riskGrade:4, return1Y:21.78, return3Y:32.49, bucket:"위험헷지", isInstantRedeem:true, taxType:"해외주식형", desc:"채권 65% 혼합, 주식 하락 시 완충", aum:"4.81억", manager:"삼성자산운용", inception:"2002-11", strategy:"채권 65%, 주식 35%로 구성된 혼합형 펀드입니다. 주식 하락기에 채권이 완충 역할을 하며 포트폴리오 전체의 변동성을 낮춥니다. 안정성과 수익성의 균형을 추구합니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 채권 비중이 높아 금융소득 발생 규모가 상대적으로 낮습니다.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","LG에너지솔루션","현대차"] },
  { id:"f8", name:"KODEX 골드선물(H) ETF", type:"ETF", riskGrade:3, return1Y:24.5, return3Y:48.2, bucket:"위험헷지", isInstantRedeem:true, taxType:"해외주식형", desc:"금 선물 추종 ETF, 대체자산 분산 효과", manager:"삼성자산운용", strategy:"S&P GSCI Gold Index를 추종하며 환헤지(H)가 적용된 금 선물 ETF입니다. 주식과 낮은 상관관계를 가져 포트폴리오 분산 효과가 뛰어나고, 인플레이션 및 지정학적 리스크 헷지에 활용됩니다.", taxBenefit:"환매 시 배당소득세 15.4%가 적용됩니다. 금 ETF 특성상 현물 금과 동일한 세금 구조를 가집니다.", topHoldings:["COMEX Gold Futures","USD Cash"] },
  { id:"f9", name:"삼성배당플러스30증권자투자신탁Ⅱ[채권혼합]-A", type:"펀드", riskGrade:5, return1Y:35.05, return3Y:45.67, bucket:"유동성", isInstantRedeem:true, taxType:"국내주식형", desc:"채권 70% + 배당주 30%, 낮은위험 수익형", aum:"18.78억", manager:"삼성자산운용", inception:"2005-01", stars:4, strategy:"채권 70%에 배당주 30%를 혼합한 안정형 펀드입니다. 낮은 변동성으로 안정적인 수익을 추구하며, 배당주에서 정기적인 인컴도 기대할 수 있습니다. 즉시환매가 가능해 유동성도 확보됩니다.", taxBenefit:"국내주식 매매차익은 비과세이며, 채권 이자소득과 배당소득은 15.4% 원천징수됩니다.", topHoldings:["삼성전자","SK하이닉스","삼성전자우","현대차","SK스퀘어"] },
  { id:"f10", name:"삼성코리아초단기우량채권증권자투자신탁[채권]-C", type:"펀드", riskGrade:6, return1Y:1.75, return3Y:9.81, bucket:"유동성", isInstantRedeem:true, taxType:"채권형", desc:"AAA 단기채권, 즉시환매 가능 안전 주차", aum:"1,116억", manager:"삼성자산운용", inception:"2016-05", strategy:"국내 AAA 등급 초단기 우량채권에만 투자합니다. 원금 손실 위험이 극히 낮고 즉시환매가 가능해 단기 여유 자금 주차에 최적입니다. 예금보다 높은 유동성을 제공합니다.", taxBenefit:"이자소득에 15.4% 원천징수가 적용됩니다. 단기 운용 특성상 금융소득 발생 규모가 제한적입니다.", topHoldings:["한국전력 1448","국민은행 4411","하나금융지주 69-1","기업은행 2508","우리금융지주 15-1"] },
  { id:"f11", name:"삼성 플래티넘행복연금보험", type:"보험", riskGrade:5, return1Y:2.58, return3Y:null, bucket:"절세", isInstantRedeem:false, taxType:"비과세연금", desc:"10년 유지 시 보험차익 완전 비과세 (소득세법 16조)", manager:"삼성생명(방카슈랑스)", strategy:"공시이율에 연동되는 일시납 연금보험입니다. 5년 유지 시 최저적립액이 보증되고, 장기 유지할수록 보너스 이율이 적립됩니다. 안정적인 이율과 비과세 효과를 동시에 누릴 수 있습니다.", taxBenefit:"소득세법 16조에 따라 1억원 이하 10년 유지 시 보험차익이 완전 비과세됩니다. 금융소득종합과세에서 완전히 제외되어 종소세 대상 고객에게 최우선 절세 수단입니다.", topHoldings:["공시이율 연동 계정","채권형 운용 자산"] },
  { id:"f12", name:"개인투자용 국채 5년/10년물", type:"채권", riskGrade:6, return1Y:3.5, return3Y:null, bucket:"절세", isInstantRedeem:false, taxType:"분리과세", desc:"2억 한도 15.4% 분리과세, 종합과세 완전 차단", manager:"기획재정부", strategy:"정부가 발행하는 개인투자용 국채입니다. 만기까지 보유하면 복리이자에 가산금리까지 받을 수 있습니다. 2억원 한도 내에서 원금 손실이 없고 세금도 분리 처리됩니다.", taxBenefit:"조세특례제한법에 따라 매입액 2억원 한도로 15.4% 분리과세가 적용됩니다. 금융소득종합과세에 합산되지 않아 종소세 대상 고객의 세 부담을 직접적으로 차단합니다.", topHoldings:["대한민국 국채 5년물","대한민국 국채 10년물"] },
  { id:"f13", name:"삼성우량주장기증권자투자신탁[주식]-A", type:"펀드", riskGrade:2, return1Y:210.92, return3Y:258.76, bucket:"절세", isInstantRedeem:false, taxType:"국내주식형", desc:"국내 주식 매매차익 비과세, 종소세 절감", aum:"163억", manager:"삼성자산운용", stars:4, strategy:"삼성전자, SK하이닉스 등 국내 대형 우량주에 장기 투자합니다. 국내주식 매매차익 비과세 특성을 활용해 금융소득을 줄이면서 동시에 성장 수익도 추구합니다.", taxBenefit:"국내주식 매매차익이 비과세되어 금융소득에 합산되지 않습니다. 종소세 대상 고객이 금융소득을 줄이면서 수익을 추구할 수 있는 핵심 절세 상품입니다.", topHoldings:["삼성전자","SK하이닉스","SK스퀘어","현대차","LG에너지솔루션"] },
  { id:"f14", name:"삼성코스닥벤처플러스증권투자신탁[주식]-A", type:"펀드", riskGrade:1, return1Y:32.09, return3Y:25.31, bucket:"절세", isInstantRedeem:false, taxType:"소득공제", desc:"투자금 10% 소득공제 최대 300만원 (조특법 16조)", aum:"19.36억", manager:"삼성액티브자산운용", inception:"2018-04", isHighIncomeOnly:true, strategy:"코스닥 벤처기업의 신주, IPO, CB, BW에 투자합니다. 3년 보유 조건이 있으며, 벤처 생태계 성장 수혜를 기대할 수 있습니다. 2028년까지 세제 혜택이 연장되어 있습니다.", taxBenefit:"조세특례제한법 16조에 따라 투자금의 10%를 소득공제(최대 300만원)받을 수 있습니다. 근로소득·사업소득이 있는 고소득자에게 직접적인 세금 환급 효과가 있습니다.", topHoldings:["로킷헬스케어","액트로","알지노믹스","노타","큐리오시스"] },
];

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
  return p.return3Y !== null ? p.return1Y * 0.7 + p.return3Y * 0.3 : p.return1Y;
}

function calcWeights(c: Client) {
  const uG = Math.max(c.targetReturn * (6 - c.riskAppetite) + c.investmentPeriod * 2, 1);
  const uI = Math.max((c.age / 100) * 50 + (6 - c.riskAppetite) * 5, 1);
  const uH = Math.max(c.riskAppetite * 15, 1);
  const uT = c.taxExcessAmount > 50_000_000 ? 150 : c.taxExcessAmount > 0 ? 100 : 5;
  const uL = calcLiquidityPriorityScore(c);
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
      if (p.id === "f8") {
        return {
          label: "금 자산 — 주식 하락기 역상관 방어",
          desc: `금 선물은 주식과 낮은 상관관계를 가져 포트폴리오 하락 시 손실을 완충합니다. ${c.riskAppetite >= 3 ? `위험 회피 성향(${RISK_LABELS[c.riskAppetite]}) 고객에게 변동성 방어 역할이 특히 유효합니다.` : "공격적 포트폴리오의 급락 리스크를 헷지하는 보완재로 활용됩니다."}`,
        };
      } else if (p.id === "f6") {
        return {
          label: "달러 자산 분산 + 금리 방어",
          desc: `달러 표시 단기채권으로 원화 자산 집중 리스크를 분산합니다. 달러 강세 시 환차익이 추가되며, 위험헷지 버킷(${(w.H*100).toFixed(1)}%) 배분 목적인 하락 방어를 실현합니다.`,
        };
      } else {
        return {
          label: "채권 혼합 — 포트폴리오 변동성 완충",
          desc: `채권 65% 비중으로 주식 하락기 포트폴리오 전체 변동성을 낮춥니다. ${c.riskAppetite >= 3 ? "안정 지향 성향에 맞는" : "공격적 포트폴리오를 보완하는"} 방어 자산으로 위험헷지 버킷(${(w.H*100).toFixed(1)}%)을 충실히 담당합니다.`,
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

function analyzeProductFit(p: Product, c: Client, w: ReturnType<typeof calcWeights>, sameBucketCount: number): {
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
    if (blended > 0) {
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
  const perProductAmt = sameBucketCount > 0 ? bucketAmt / sameBucketCount : bucketAmt;
  const minInvestOk = !p.minInvest || perProductAmt >= parseAmount(p.minInvest);

  return { unsuitable, reasons, upsides, bucketAmt, perProductAmt, minInvestOk };
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
  const { formData, riskResult, warnings, financialCompletion, rrttlluCompletion, selectedCustomerProfile, internalJsonPayload, productSelectedIds: selectedIds, setProductSelectedIds: setSelectedIdsRaw, portfolioAssets, finishActiveConsultation, resumeLatestConsultation, activeConsultation, selectedCustomer } = useCustomerContext();
  const { isCustomerView } = useCustomerView();
  const portfolioData = usePortfolioResult();
  const rrttlluReady = hasRrttllu(formData);
  const [bucketOffset, setBucketOffset] = useState<Partial<Record<BucketType,number>>>({});
  const [modalProduct, setModalProduct] = useState<Product|null>(null);
  const [activeEffectId, setActiveEffectId] = useState<string|null>(null);
  const [unsuitableWarning, setUnsuitableWarning] = useState<Product|null>(null);
  const [newSummary, setNewSummary] = useState<FinancialIncomeSummary | null>(null);

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
  };
  const hasTab4TaxData = newSummary != null;
    const taxExcessAmount = Math.max(0, (newSummary?.totalFinancialIncome ?? 0) - 20_000_000);
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
    };
  }, [formData,riskResult,selectedCustomerProfile,internalJsonPayload,rrttlluReady,newSummary]);

  const weights = useMemo(() => rrttlluReady ? calcWeights(client) : null, [client,rrttlluReady]);

  const bucketAllProducts = useMemo(() => {
    if (!weights) return null;
    const scored = PRODUCTS
      .filter(p => !(p.isHighIncomeOnly&&!client.isHighIncomeWorker))
      .map(p => ({ ...p, score: Math.round(calcScore(p,client,weights,PRODUCTS)*10)/10 }));
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
      result[bucket] = list.length > 0 ? list : PRODUCTS
        .filter(p => p.bucket === bucket && !(p.isHighIncomeOnly&&!client.isHighIncomeWorker))
        .map(p => ({...p, score: Math.round(calcScore(p,client,weights,PRODUCTS)*10)/10}));
    }
    return result;
  }, [client,weights]);

  const getBucketWeight = (b: BucketType) => {
    if (!weights) return 0;
    return b==="자본증식"?weights.G:b==="인컴창출"?weights.I:b==="위험헷지"?weights.H:b==="유동성"?weights.L:weights.T;
  };

  const handleSelect = (p: Product) => {
    if (selectedIds.includes(p.id)) {
      setSelectedIdsRaw(selectedIds.filter(x=>x!==p.id));
      return;
    }
    if (isUnsuitable(p, client)) {
      setUnsuitableWarning(p);
      return;
    }
    setSelectedIdsRaw([...selectedIds, p.id]);
    setActiveEffectId(p.id);
  };

  const confirmUnsuitable = () => {
    if (!unsuitableWarning) return;
    setSelectedIdsRaw([...selectedIds, unsuitableWarning.id]);
    setActiveEffectId(unsuitableWarning.id);
    setUnsuitableWarning(null);
  };

  const getOffset = (b: BucketType) => bucketOffset[b]??0;
  const nextOffset = (b: BucketType, total: number) => {
    const cur = getOffset(b);
    setBucketOffset(prev=>({...prev,[b]:cur+2>=total?0:cur+2}));
  };

  const selectedProducts = PRODUCTS.filter(p=>selectedIds.includes(p.id));
  const customerName = selectedCustomerProfile.name||selectedCustomerProfile.fallbackName||"고객";

  return (
    <>
      {modalProduct && <ProductModal product={modalProduct} onClose={()=>setModalProduct(null)}/>}

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

      {!rrttlluReady && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertCircle size={18} className="shrink-0 text-amber-600"/>
          <div>
            <p className="text-sm font-bold text-amber-800">TAB1 성향 분석 후 이용 가능합니다</p>
            <p className="mt-0.5 text-xs text-amber-700">고객 성향 분석을 완료하면 맞춤 상품 추천이 시작됩니다.</p>
          </div>
        </div>
      )}

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
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-samsung"><BarChart3 size={18}/></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">버킷별 매칭 상품</p>
            <h2 className="text-lg font-bold text-navy">삼성증권 추천 상품</h2>
            <p className="mt-0.5 text-xs text-slate-400">성향 적합 상품이 우선 표시됩니다. 카드를 클릭해 상세 정보를 확인하고 체크박스로 선택하세요</p>
          </div>
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
              const offset = getOffset(bucket);
              const shown = allProds.slice(offset, offset+2);
              const bw = getBucketWeight(bucket);
              const bucketAmt = client.investableAssets * bw;
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
                        const unsuitable = isUnsuitable(p, client);
                        return (
                          <div key={p.id}
                            className={`relative rounded-xl border-2 bg-white p-4 cursor-pointer transition-all ${sel?"border-samsung shadow-md":unsuitable?"border-red-200 hover:border-red-300 opacity-75":"border-slate-200 hover:border-slate-300 hover:shadow-sm"}`}
                            onClick={()=>setModalProduct(p)}>
                            {unsuitable && (
                              <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-red-100 border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-600">
                                <AlertTriangle size={9}/>성향 부적합
                              </span>
                            )}
                            <button type="button"
                              onClick={e=>{e.stopPropagation();if(!isCustomerView)handleSelect(p);}}
                              disabled={isCustomerView}
                              className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${sel?"border-samsung bg-samsung text-white":unsuitable?"border-red-300 bg-white hover:border-red-400":"border-slate-300 bg-white hover:border-samsung"} ${isCustomerView?"cursor-not-allowed opacity-50":""}`}>
                              {sel&&<CheckCircle2 size={14}/>}
                            </button>
                            <div className={`mb-2 flex items-center gap-1.5 pr-8 ${unsuitable?"mt-5":""}`}>
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
            const sameBucketCount = selectedProducts.filter(x=>x.bucket===p.bucket).length;
            const { unsuitable, reasons, upsides, bucketAmt, perProductAmt, minInvestOk } = analyzeProductFit(p, client, weights, sameBucketCount);
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
                      <p className={`text-xl font-black ${unsuitable?"text-red-500":"text-samsung"}`}>{Math.round(calcScore(p,client,weights,PRODUCTS)*10)/10}</p>
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
                      <p className="text-xs text-slate-400 mb-1">이 상품 권고 편입 금액</p>
                      <p className={`text-lg font-black ${perProductAmt>0?"text-samsung":"text-slate-300"}`}>
                        {perProductAmt>0?fmtWon(perProductAmt):"투자금액 미입력"}
                      </p>
                      {sameBucketCount>1&&perProductAmt>0&&<p className="text-[10px] text-slate-400 mt-0.5">버킷 총액 {fmtWon(bucketAmt)} ÷ {sameBucketCount}</p>}
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
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => finishActiveConsultation(false)}
          disabled={!activeConsultation}
          className="rounded-xl bg-red-600 px-5 py-3 text-sm font-extrabold text-white shadow-soft transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          상담 종료
        </button>
        <button
          type="button"
          onClick={resumeLatestConsultation}
          disabled={Boolean(activeConsultation)}
          className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-extrabold text-blue-700 shadow-soft transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          상담 재개
        </button>
      </div>
    </>
  );
}
