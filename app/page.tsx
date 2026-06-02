"use client";

import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  ClipboardList,
  LockKeyhole,
  PieChart,
  ShieldCheck,
  Sparkles,
  WalletCards
} from "lucide-react";
import { useMemo, useState } from "react";

type FinancialInfo = {
  totalAssets: string;
  financialAssets: string;
  realEstate: string;
  debt: string;
  annualFixedIncome: string;
  monthlyFixedExpense: string;
};

type RrttlluInfo = {
  returnObjective: string;
  investmentExperience: string[];
  knowledgeLevel: string;
  derivativesExperience: string;
  financialAssetRatio: string;
  investmentAssetRatio: string;
  riskAttitude: string;
  lossResponse: string;
  timeHorizon: string;
  expectedInterestIncome: string;
  expectedDividendIncome: string;
  giftingPlan: string;
  globalTaxImportance: string;
  recentGlobalTaxSubject: string;
  foreignStockTaxImportance: string;
  regularCashflowNeed: string;
  lumpSumPlan: string;
  legalConstraints: string[];
  legalConstraintOther: string;
  preferredAssets: string;
  avoidedAssets: string;
  holdingOrDisposalPlan: string;
};

type RiskLevel = "초저위험" | "저위험" | "중위험" | "고위험" | "초고위험";

type RiskResult = {
  score: number;
  level: RiskLevel;
  answers: {
    investment_experience: string[];
    investment_knowledge: string;
    derivatives_experience: string;
    financial_assets_ratio: string;
    investment_assets_ratio: string;
    risk_attitude: string;
    loss_response: string;
  };
  interpretation: string;
};

type StructuredJsonPayload = {
  basic_financial_info: {
    asset_summary: string | null;
    annual_fixed_income: string | null;
    monthly_fixed_expense: string | null;
  };
  rrttllu: {
    return: {
      objective: string | null;
    };
    risk: {
      score: number;
      level: RiskLevel;
      answers: {
        investment_experience: string[] | null;
        investment_knowledge: string | null;
        derivatives_experience: string | null;
        financial_assets_ratio: string | null;
        investment_assets_ratio: string | null;
        risk_attitude: string | null;
        loss_response: string | null;
      };
      interpretation: string;
    };
    time_horizon: {
      investment_period: string | null;
    };
    tax: {
      expected_interest_income: string | null;
      expected_dividend_income: string | null;
      gift_plan: string | null;
      financial_income_tax_importance: string | null;
      financial_income_tax_history: string | null;
      foreign_stock_capital_gains_tax_importance: string | null;
      financial_income_tax_alert: string;
    };
    liquidity: {
      cashflow_need: string | null;
      large_cash_need: string | null;
    };
    legal: {
      constraints: string[] | null;
      other_detail: string | null;
    };
    unique_circumstances: {
      preferred_assets: {
        raw_input: string | null;
        portfolio_rule: {
          type: "soft_constraint";
          description: string;
          min_weight_hint: "10%";
        };
      };
      avoided_assets: {
        raw_input: string | null;
        portfolio_rule: {
          type: "hard_constraint";
          description: string;
          max_weight: "0%";
        };
      };
      existing_asset_plan: string | null;
    };
    warnings: string[];
  };
};

type ChangeEntry = {
  label: string;
  before: string;
  after: string;
  changedAt: number;
};

type AppState = {
  financial: FinancialInfo;
  rrttllu: RrttlluInfo;
};

const initialState: AppState = {
  financial: {
    totalAssets: "",
    financialAssets: "",
    realEstate: "",
    debt: "",
    annualFixedIncome: "",
    monthlyFixedExpense: ""
  },
  rrttllu: {
    returnObjective: "",
    investmentExperience: [],
    knowledgeLevel: "",
    derivativesExperience: "",
    financialAssetRatio: "",
    investmentAssetRatio: "",
    riskAttitude: "",
    lossResponse: "",
    timeHorizon: "",
    expectedInterestIncome: "",
    expectedDividendIncome: "",
    giftingPlan: "",
    globalTaxImportance: "",
    recentGlobalTaxSubject: "",
    foreignStockTaxImportance: "",
    regularCashflowNeed: "",
    lumpSumPlan: "",
    legalConstraints: [],
    legalConstraintOther: "",
    preferredAssets: "",
    avoidedAssets: "",
    holdingOrDisposalPlan: ""
  }
};

const noneExperience = "금융상품에 투자해 본 경험 없음";
const noLegalConstraint = "없음";

const returnOptions = [
  "적극적 수익 추구",
  "시장수익률 수준의 수익 추구",
  "예금, 채권이자 수준의 안정적 수익 추구",
  "원금 보존 투자"
];

const riskExperienceOptions = [
  "ELW, 선물옵션, 주식신용거래, 파생상품 펀드",
  "주식, 주식형펀드, 원금비보장ELS, 고위험회사채",
  "혼합형펀드, 원금부분보장ELS, 일반 회사채",
  "은행 예/적금, 채권형펀드, 원금지급형ELB, 금융채",
  noneExperience
];

const fieldGroups = {
  knowledge: [
    "금융상품을 잘 이해하며 스스로 의사결정 가능",
    "금융상품을 이해하며 설명 듣고 의사결정 가능",
    "서로 다른 금융상품을 구별할 수 있음",
    "금융상품에 대해 전혀 모름"
  ],
  derivatives: ["3년 이상", "2년 이상", "1년 이상", "1년 미만", "없음"],
  financialAssetRatio: ["10% 미만", "10~25% 미만", "25~50% 미만", "50~75% 미만", "75% 이상"],
  investmentAssetRatio: ["10% 미만", "10~20% 미만", "20~30% 미만", "30~40% 미만", "40% 이상"],
  riskAttitude: [
    "고수익의 기회를 위해 큰 폭의 손실 가능성도 받아들일 수 있음",
    "수익을 기대할 수 있다면 일정 수준의 손실을 수용할 수 있음",
    "일부 손실은 감수할 수 있으나, 전체적인 안정성이 중요",
    "원금 보전을 최우선으로 하며 손실 가능성을 원하지 않음"
  ],
  lossResponse: ["신규 자금 추가 투자", "관망", "일부 환매", "전액 환매 또는 계약 해지"],
  timeHorizon: ["5년 이상", "3~5년", "2~3년", "1~2년", "1년 미만"],
  giftingPlan: ["없음", "검토 중", "있음"],
  taxImportance: ["아니오", "보통", "매우 중요"],
  recentTax: ["예", "아니오", "모름"],
  legal: [noLegalConstraint, "임직원 매매 제한", "기타"]
};

const tenPointScale = [10, 8, 5, 3, 0];
const knowledgeScale = [10, 6, 3, 0];
const riskAttitudeScale = [25, 18, 10, 0];

const riskInterpretations: Record<RiskLevel, string> = {
  초저위험: "원금 보전을 가장 중요하게 생각하며, 손실 가능성이 낮은 상품을 선호합니다.",
  저위험: "안정성을 중시하되, 제한적인 범위 내에서 수익을 추구합니다.",
  중위험: "일정 수준의 손실을 감수하며, 균형 잡힌 수익을 추구합니다.",
  고위험: "원금 손실 가능성을 감수하더라도, 적극적인 수익을 추구합니다.",
  초고위험: "높은 변동성과 손실 가능성을 감수하고, 고수익 기회를 적극적으로 추구합니다."
};

export default function Home() {
  const [formData, setFormData] = useState<AppState>(initialState);
  const [summaryRequested, setSummaryRequested] = useState(false);
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const [confirmedRiskResult, setConfirmedRiskResult] = useState<RiskResult | null>(null);
  const [lastAnalysisSnapshot, setLastAnalysisSnapshot] = useState<StructuredJsonPayload | null>(null);
  const [changeHistory, setChangeHistory] = useState<ChangeEntry[]>([]);

  const riskResult = useMemo(() => calculateRiskResult(formData.rrttllu), [formData.rrttllu]);

  const financialCompletion = useMemo(() => completion(Object.values(formData.financial)), [formData.financial]);

  const rrttlluCompletion = useMemo(() => {
    const r = formData.rrttllu;
    return completion([
      r.returnObjective,
      r.investmentExperience.length ? "selected" : "",
      r.knowledgeLevel,
      r.derivativesExperience,
      r.financialAssetRatio,
      r.investmentAssetRatio,
      r.riskAttitude,
      r.lossResponse,
      r.timeHorizon,
      r.expectedInterestIncome,
      r.expectedDividendIncome,
      r.giftingPlan,
      r.globalTaxImportance,
      r.recentGlobalTaxSubject,
      r.foreignStockTaxImportance,
      r.regularCashflowNeed,
      r.lumpSumPlan,
      r.legalConstraints.length ? "selected" : "",
      r.preferredAssets,
      r.avoidedAssets,
      r.holdingOrDisposalPlan
    ]);
  }, [formData.rrttllu]);

  const internalJsonPayload = useMemo(
    () => buildStructuredJsonPayload(formData, confirmedRiskResult ?? riskResult),
    [confirmedRiskResult, formData, riskResult]
  );

  const warnings = internalJsonPayload.rrttllu.warnings;

  const setFinancial = (key: keyof FinancialInfo, value: string) => {
    setFormData((prev) => ({
      ...prev,
      financial: { ...prev.financial, [key]: value }
    }));
  };

  const setRrttllu = (key: keyof RrttlluInfo, value: string) => {
    setFormData((prev) => ({
      ...prev,
      rrttllu: { ...prev.rrttllu, [key]: value }
    }));
  };

  const toggleInvestmentExperience = (option: string) => {
    setFormData((prev) => {
      const current = prev.rrttllu.investmentExperience;
      const next =
        option === noneExperience
          ? current.includes(option)
            ? []
            : [option]
          : current.includes(option)
            ? current.filter((item) => item !== option)
            : [...current.filter((item) => item !== noneExperience), option];

      return { ...prev, rrttllu: { ...prev.rrttllu, investmentExperience: next } };
    });
  };

  const toggleLegalConstraint = (option: string) => {
    setFormData((prev) => {
      const current = prev.rrttllu.legalConstraints;
      const next =
        option === noLegalConstraint
          ? current.includes(option)
            ? []
            : [option]
          : current.includes(option)
            ? current.filter((item) => item !== option)
            : [...current.filter((item) => item !== noLegalConstraint), option];

      return {
        ...prev,
        rrttllu: {
          ...prev.rrttllu,
          legalConstraints: next,
          legalConstraintOther: next.includes("기타") ? prev.rrttllu.legalConstraintOther : ""
        }
      };
    });
  };

  const analyzeRrttllu = () => {
    const latestPayload = buildStructuredJsonPayload(formData, riskResult);
    const changes = lastAnalysisSnapshot ? diffAnalysisPayload(lastAnalysisSnapshot, latestPayload) : [];

    setAnalysisRequested(true);
    setConfirmedRiskResult(riskResult);
    setLastAnalysisSnapshot(latestPayload);
    setChangeHistory(changes);
  };

  return (
    <main className="min-h-screen px-5 py-6 text-ink lg:px-8">
      <section className="mx-auto flex max-w-[1680px] flex-col gap-5">
        <header className="rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-soft">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold text-samsung">Samsung Securities PB Advisory</p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal text-navy md:text-3xl">
                VVIP 고객 지능형 입력부
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                상담 중 확보한 재무 정보와 RRTTLLU 항목을 내부 JSON 상태로 정리하는 입력 화면입니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="기본 정보" value={`${financialCompletion}%`} />
              <Metric label="RRTTLLU" value={`${rrttlluCompletion}%`} />
              <Metric label="Risk 점수" value={`${riskResult.score}/100`} />
              <Metric label="경고" value={`${warnings.length}개`} strong />
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(430px,0.82fr)]">
          <section className="space-y-5">
            <Panel
              icon={<WalletCards size={18} />}
              eyebrow="기본 재무 정보"
              title="고객 재무 현황"
              note="※ 금액은 원화(KRW) 기준으로 입력해주세요."
            >
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="총 자산" value={formData.financial.totalAssets} placeholder="예. 20억 원" onChange={(value) => setFinancial("totalAssets", value)} />
                <TextField label="금융자산" value={formData.financial.financialAssets} placeholder="예. 8억 원" onChange={(value) => setFinancial("financialAssets", value)} />
                <TextField label="부동산" value={formData.financial.realEstate} placeholder="예. 15억 원" onChange={(value) => setFinancial("realEstate", value)} />
                <TextField label="부채" value={formData.financial.debt} placeholder="예. 3억 원" onChange={(value) => setFinancial("debt", value)} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="(가구 기준) 연 고정소득" value={formData.financial.annualFixedIncome} placeholder="예. 3억 원~5억 원" onChange={(value) => setFinancial("annualFixedIncome", value)} />
                <TextField label="(가구 기준) 월 고정지출" value={formData.financial.monthlyFixedExpense} placeholder="예. 500만 원~1,000만 원" onChange={(value) => setFinancial("monthlyFixedExpense", value)} />
              </div>
            </Panel>

            <Panel icon={<BarChart3 size={18} />} eyebrow="RRTTLLU" title="① Return 목표 수익률">
              <ChoiceGroup label="투자 목적은 무엇인가요?" options={returnOptions} value={formData.rrttllu.returnObjective} onChange={(value) => setRrttllu("returnObjective", value)} />
            </Panel>

            <Panel icon={<ShieldCheck size={18} />} eyebrow="RRTTLLU" title="② Risk 위험 허용도">
              <MultiChoiceGroup label="투자 경험이 있는 금융상품을 모두 선택해주세요." options={riskExperienceOptions} values={formData.rrttllu.investmentExperience} onToggle={toggleInvestmentExperience} />
              <ChoiceGroup label="투자 지식 수준은 어느 정도인가요?" options={fieldGroups.knowledge} value={formData.rrttllu.knowledgeLevel} onChange={(value) => setRrttllu("knowledgeLevel", value)} />
              <ChoiceGroup label="파생상품 투자 경험이 있으신가요?" description="파생상품: 파생상품, 원금비보장형 파생결합 증권, 파생상품펀드, 레버리지/인버스 ETF 등" options={fieldGroups.derivatives} value={formData.rrttllu.derivativesExperience} onChange={(value) => setRrttllu("derivativesExperience", value)} />
              <div className="grid gap-4 lg:grid-cols-2">
                <ChoiceGroup label="총 자산 중 금융자산의 비중" options={fieldGroups.financialAssetRatio} value={formData.rrttllu.financialAssetRatio} onChange={(value) => setRrttllu("financialAssetRatio", value)} />
                <ChoiceGroup label="금융자산 중 투자자산의 비중" options={fieldGroups.investmentAssetRatio} value={formData.rrttllu.investmentAssetRatio} onChange={(value) => setRrttllu("investmentAssetRatio", value)} />
              </div>
              <ChoiceGroup label="기대이익 및 기대손실 등을 고려한 위험에 대한 태도" options={fieldGroups.riskAttitude} value={formData.rrttllu.riskAttitude} onChange={(value) => setRrttllu("riskAttitude", value)} />
              <ChoiceGroup label="단기적으로 손실이 초과 발생할 때 대응" options={fieldGroups.lossResponse} value={formData.rrttllu.lossResponse} onChange={(value) => setRrttllu("lossResponse", value)} />
            </Panel>

            <Panel icon={<ClipboardList size={18} />} eyebrow="RRTTLLU" title="③ Time Horizon 투자 기간">
              <ChoiceGroup label="투자 가능한 기간을 선택해 주세요." description="Time Horizon은 점수화하지 않고 선택값 그대로 내부 JSON에 저장됩니다." options={fieldGroups.timeHorizon} value={formData.rrttllu.timeHorizon} onChange={(value) => setRrttllu("timeHorizon", value)} />
            </Panel>

            <Panel icon={<PieChart size={18} />} eyebrow="RRTTLLU" title="④ Tax 세금 요인">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="올해 예상 이자소득" value={formData.rrttllu.expectedInterestIncome} placeholder="예. 1,000만 원~2,000만 원" onChange={(value) => setRrttllu("expectedInterestIncome", value)} />
                <TextField label="올해 예상 배당소득" value={formData.rrttllu.expectedDividendIncome} placeholder="예. 1,000만 원 미만" onChange={(value) => setRrttllu("expectedDividendIncome", value)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChoiceGroup label="자녀/가족 사전증여 계획" options={fieldGroups.giftingPlan} value={formData.rrttllu.giftingPlan} onChange={(value) => setRrttllu("giftingPlan", value)} />
                <ChoiceGroup label="금융소득종합과세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.globalTaxImportance} onChange={(value) => setRrttllu("globalTaxImportance", value)} />
                <ChoiceGroup label="최근 3년 내 금융소득종합과세 대상 여부" options={fieldGroups.recentTax} value={formData.rrttllu.recentGlobalTaxSubject} onChange={(value) => setRrttllu("recentGlobalTaxSubject", value)} />
                <ChoiceGroup label="해외주식 양도소득세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.foreignStockTaxImportance} onChange={(value) => setRrttllu("foreignStockTaxImportance", value)} />
              </div>
            </Panel>

            <Panel icon={<WalletCards size={18} />} eyebrow="RRTTLLU" title="⑤ Liquidity 유동성 필요 시기">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="향후 정기적인 현금흐름 필요" value={formData.rrttllu.regularCashflowNeed} placeholder="예. 20년간 월 생활비 500만 원" onChange={(value) => setRrttllu("regularCashflowNeed", value)} />
                <TextField label="향후 목돈 사용 계획" value={formData.rrttllu.lumpSumPlan} placeholder="예. 5년 후 자녀 유학비 1억원" onChange={(value) => setRrttllu("lumpSumPlan", value)} />
              </div>
            </Panel>

            <Panel icon={<LockKeyhole size={18} />} eyebrow="RRTTLLU" title="⑥ Legal 법적 규제">
              <MultiChoiceGroup label="투자 의사결정에 영향을 줄 수 있는 법적/제도적 제약" options={fieldGroups.legal} values={formData.rrttllu.legalConstraints} onToggle={toggleLegalConstraint} />
              {formData.rrttllu.legalConstraints.includes("기타") ? (
                <TextField label="기타 제약 직접 입력" value={formData.rrttllu.legalConstraintOther} placeholder="예. 내부 투자심의 승인 필요" onChange={(value) => setRrttllu("legalConstraintOther", value)} />
              ) : null}
            </Panel>

            <Panel icon={<Sparkles size={18} />} eyebrow="RRTTLLU" title="⑦ Unique Circumstances 고객 고유 상황">
              <div className="grid gap-3 md:grid-cols-2">
                <TextAreaField label="선호하는 자산" value={formData.rrttllu.preferredAssets} placeholder="예. 미국 배당주 ETF, 은퇴 후 안정적 현금흐름" onChange={(value) => setRrttllu("preferredAssets", value)} />
                <TextAreaField label="피하고 싶은 자산" value={formData.rrttllu.avoidedAssets} placeholder="예. 가상자산, 가치 평가가 어려움" onChange={(value) => setRrttllu("avoidedAssets", value)} />
              </div>
              <TextAreaField label="계속 보유하거나 향후 처분할 계획" value={formData.rrttllu.holdingOrDisposalPlan} placeholder="예. 삼성전자 10억 원은 계속 보유, 1년 내 임대용 부동산 매각, 해외주식 차익이 커서 올해 일부만 매도 등" onChange={(value) => setRrttllu("holdingOrDisposalPlan", value)} />
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                선호 자산은 추천 시 우선 고려하고, 비선호 자산은 추천 후보에서 제외하거나 최대 비중 0% 제한 조건으로 저장됩니다.
              </div>
            </Panel>
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-48px)] xl:overflow-auto xl:pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <button className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-navy px-4 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-[#102a4e]" onClick={() => setSummaryRequested(true)}>
                <BadgeCheck size={17} />
                기본 재무 정보 요약하기
              </button>
              <button className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-samsung px-4 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-[#1b35bd]" onClick={analyzeRrttllu}>
                <BarChart3 size={17} />
                {analysisRequested ? "재분석" : "RRTTLLU 분석하기"}
              </button>
            </div>

            <ResultCard icon={<WalletCards size={18} />} title="기본 재무 정보 요약 카드" accent="blue">
              <ResultGrid
                rows={[
                  ["총 자산", formData.financial.totalAssets || "입력 대기"],
                  ["금융자산", formData.financial.financialAssets || "입력 대기"],
                  ["부동산", formData.financial.realEstate || "입력 대기"],
                  ["부채", formData.financial.debt || "입력 대기"]
                ]}
              />
              <p className="mt-3 text-sm text-slate-600">
                {summaryRequested ? "입력값 기준 요약 준비가 완료되었습니다." : "요약 버튼을 누르면 현재 입력 상태를 기준으로 상담용 요약을 갱신합니다."}
              </p>
            </ResultCard>

            <ResultCard icon={<ClipboardList size={18} />} title="RRTTLLU 분석 결과 카드" accent="green">
              <div className="grid gap-2 text-sm">
                <Highlight label="Return" value={formData.rrttllu.returnObjective || "미선택"} />
                <Highlight label="Risk 핵심 태도" value={formData.rrttllu.riskAttitude || "미선택"} />
                <Highlight label="Time Horizon" value={formData.rrttllu.timeHorizon || "미선택"} />
                <Highlight label="Unique 제약" value={formData.rrttllu.preferredAssets || "선호 자산 입력 대기"} />
              </div>
              <p className="mt-3 text-sm text-slate-600">
                {analysisRequested ? "RRTTLLU 상태와 최종 Risk 결과가 내부 JSON 입력값으로 저장되었습니다." : "분석 버튼을 누르면 현재 Risk 결과를 내부 JSON에 확정 저장합니다."}
              </p>
            </ResultCard>

            <ResultCard icon={<ShieldCheck size={18} />} title="Risk 점수 및 위험등급 카드" accent="gold">
              <div className="grid gap-3">
                <div className="rounded-lg bg-amber-50 p-4 ring-1 ring-amber-100">
                  <p className="text-sm font-semibold text-amber-800">위험점수</p>
                  <p className="mt-1 text-3xl font-bold text-navy">{riskResult.score}/100</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-500">위험등급</p>
                  <p className={`mt-1 text-2xl font-bold ${riskLevelColor(riskResult.level)}`}>{riskResult.level}</p>
                </div>
                <p className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold leading-6 text-slate-700">
                  {riskResult.interpretation}
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  {confirmedRiskResult ? `내부 JSON 확정 저장: ${confirmedRiskResult.score}/100, ${confirmedRiskResult.level}` : "선택 즉시 실시간 반영 중"}
                </p>
              </div>
            </ResultCard>

            <ResultCard icon={<ClipboardList size={18} />} title="변경 이력 카드" accent="blue">
              {changeHistory.length ? (
                <div className="grid gap-2">
                  {changeHistory.map((change) => (
                    <div key={`${change.changedAt}-${change.label}`} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                      <p className="text-sm font-bold leading-6 text-samsung">
                        {change.label}: {change.before} → {change.after}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">변경된 정보가 없습니다.</p>
              )}
            </ResultCard>

            <ResultCard icon={<AlertTriangle size={18} />} title="Tax 분석 알림 카드" accent="red">
              <ResultGrid
                rows={[
                  ["이자소득", formData.rrttllu.expectedInterestIncome || "입력 대기"],
                  ["배당소득", formData.rrttllu.expectedDividendIncome || "입력 대기"],
                  ["종합과세 절감", formData.rrttllu.globalTaxImportance || "미선택"],
                  ["해외주식 절감", formData.rrttllu.foreignStockTaxImportance || "미선택"]
                ]}
              />
              <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-800">
                {internalJsonPayload.rrttllu.tax.financial_income_tax_alert}
              </p>
            </ResultCard>

            <ResultCard icon={<AlertTriangle size={18} />} title="누락 정보 경고 카드" accent="orange">
              {warnings.length ? (
                <div className="space-y-3">
                  <p className="rounded-lg bg-orange-50 px-4 py-3 text-sm font-bold leading-6 text-orange-800">
                    정보가 입력되지 않아 분석 정확도가 낮을 수 있습니다.
                  </p>
                  <div className="grid gap-2">
                    {warnings.map((warning) => (
                      <p key={warning} className="rounded-lg border border-orange-100 bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700">
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">필수 정보가 충분히 입력되었습니다.</p>
              )}
            </ResultCard>

            <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-semibold leading-6 text-slate-600 shadow-soft">
              민감 정보는 필수 입력이 아니며, 제공이 어려운 경우 대략적인 범위만 입력하셔도 됩니다. 단, 정보가 부족한 항목이 있는 경우 분석 정확도가 낮을 수 있습니다.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}

function diffAnalysisPayload(previous: StructuredJsonPayload, latest: StructuredJsonPayload): ChangeEntry[] {
  const now = Date.now();
  const previousFields = Object.fromEntries(
    flattenComparablePayload(previous).map((field) => [field.key, field.value])
  ) as Record<string, string>;
  const latestFields = flattenComparablePayload(latest);

  return latestFields
    .filter((field) => previousFields[field.key] !== field.value)
    .map((field, index) => ({
      label: field.label,
      before: previousFields[field.key] ?? "미입력",
      after: field.value,
      changedAt: now - index
    }))
    .sort((a, b) => b.changedAt - a.changedAt);
}

function flattenComparablePayload(payload: StructuredJsonPayload) {
  const comparableFields = [
    ["asset_summary", "자산 요약", payload.basic_financial_info.asset_summary],
    ["annual_fixed_income", "연 고정소득", payload.basic_financial_info.annual_fixed_income],
    ["monthly_fixed_expense", "월 고정지출", payload.basic_financial_info.monthly_fixed_expense],
    ["return_objective", "투자 목적", payload.rrttllu.return.objective],
    ["risk_score", "Risk 점수", `${payload.rrttllu.risk.score}점`],
    ["risk_level", "위험등급", payload.rrttllu.risk.level],
    ["investment_experience", "투자 경험", payload.rrttllu.risk.answers.investment_experience],
    ["investment_knowledge", "투자 지식", payload.rrttllu.risk.answers.investment_knowledge],
    ["derivatives_experience", "파생상품 투자 경험", payload.rrttllu.risk.answers.derivatives_experience],
    ["financial_assets_ratio", "금융자산 비중", payload.rrttllu.risk.answers.financial_assets_ratio],
    ["investment_assets_ratio", "투자자산 비중", payload.rrttllu.risk.answers.investment_assets_ratio],
    ["risk_attitude", "위험에 대한 태도", payload.rrttllu.risk.answers.risk_attitude],
    ["loss_response", "단기 손실 대응", payload.rrttllu.risk.answers.loss_response],
    ["investment_period", "투자 기간", payload.rrttllu.time_horizon.investment_period],
    ["expected_interest_income", "예상 이자소득", payload.rrttllu.tax.expected_interest_income],
    ["expected_dividend_income", "예상 배당소득", payload.rrttllu.tax.expected_dividend_income],
    ["gift_plan", "사전증여 계획", payload.rrttllu.tax.gift_plan],
    ["financial_income_tax_importance", "금융소득종합과세 절감 중요도", payload.rrttllu.tax.financial_income_tax_importance],
    ["financial_income_tax_history", "금융소득종합과세 이력", payload.rrttllu.tax.financial_income_tax_history],
    ["foreign_stock_tax_importance", "해외주식 양도소득세 절감 중요도", payload.rrttllu.tax.foreign_stock_capital_gains_tax_importance],
    ["financial_income_tax_alert", "Tax 분석 알림", payload.rrttllu.tax.financial_income_tax_alert],
    ["cashflow_need", "정기 현금흐름 필요", payload.rrttllu.liquidity.cashflow_need],
    ["large_cash_need", "목돈 사용 계획", payload.rrttllu.liquidity.large_cash_need],
    ["legal_constraints", "법적/제도적 제약", payload.rrttllu.legal.constraints],
    ["legal_other_detail", "기타 법적 제약 상세", payload.rrttllu.legal.other_detail],
    ["preferred_assets", "선호 자산", payload.rrttllu.unique_circumstances.preferred_assets.raw_input],
    ["avoided_assets", "비선호 자산", payload.rrttllu.unique_circumstances.avoided_assets.raw_input],
    ["existing_asset_plan", "기존 자산 보유/처분 계획", payload.rrttllu.unique_circumstances.existing_asset_plan]
  ] as const;

  return comparableFields.map(([key, label, value]) => ({
    key,
    label,
    value: comparableValue(value)
  }));
}

function comparableValue(value: string | string[] | null) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "미입력";
  return value ?? "미입력";
}

function buildStructuredJsonPayload(formData: AppState, riskResult: RiskResult): StructuredJsonPayload {
  const financial = formData.financial;
  const rrttllu = formData.rrttllu;
  const warnings: string[] = [];

  const totalAssets = nullableText(financial.totalAssets);
  const financialAssets = nullableText(financial.financialAssets);
  const realEstate = nullableText(financial.realEstate);
  const debt = nullableText(financial.debt);
  const assetSummaryParts = [
    totalAssets ? `총 자산 ${totalAssets}` : null,
    financialAssets ? `금융자산 ${financialAssets}` : null,
    realEstate ? `부동산 ${realEstate}` : null,
    debt ? `부채 ${debt}` : null
  ].filter(Boolean);
  const assetSummary = assetSummaryParts.length ? assetSummaryParts.join(", ") : null;

  const annualFixedIncome = nullableText(financial.annualFixedIncome);
  const monthlyFixedExpense = nullableText(financial.monthlyFixedExpense);
  const expectedInterestIncome = nullableText(rrttllu.expectedInterestIncome);
  const expectedDividendIncome = nullableText(rrttllu.expectedDividendIncome);
  const interestAmount = parseKrwAmount(expectedInterestIncome);
  const dividendAmount = parseKrwAmount(expectedDividendIncome);
  const taxAlert = financialIncomeTaxAlert(interestAmount, dividendAmount);

  const riskAnswers = {
    investment_experience: nullableArray(rrttllu.investmentExperience),
    investment_knowledge: nullableText(rrttllu.knowledgeLevel),
    derivatives_experience: nullableText(rrttllu.derivativesExperience),
    financial_assets_ratio: nullableText(rrttllu.financialAssetRatio),
    investment_assets_ratio: nullableText(rrttllu.investmentAssetRatio),
    risk_attitude: nullableText(rrttllu.riskAttitude),
    loss_response: nullableText(rrttllu.lossResponse)
  };

  if (!assetSummary || !annualFixedIncome || !monthlyFixedExpense) {
    warnings.push("기본 재무 정보가 부족하여 전체 자산 구조 분석 정확도가 낮을 수 있습니다.");
  }
  if (!nullableText(rrttllu.returnObjective)) {
    warnings.push("투자 목적 정보가 부족하여 기대수익률(Return) 분석 정확도가 낮을 수 있습니다.");
  }
  if (Object.values(riskAnswers).some((value) => value === null)) {
    warnings.push("Risk 문항 일부가 누락되어 위험등급 산출 정확도가 낮을 수 있습니다.");
  }
  if (!nullableText(rrttllu.timeHorizon)) {
    warnings.push("투자 기간 정보가 부족하여 Time Horizon 분석 정확도가 낮을 수 있습니다.");
  }
  if (
    !expectedInterestIncome ||
    !expectedDividendIncome ||
    interestAmount === null ||
    dividendAmount === null ||
    !nullableText(rrttllu.giftingPlan) ||
    !nullableText(rrttllu.globalTaxImportance) ||
    !nullableText(rrttllu.recentGlobalTaxSubject) ||
    !nullableText(rrttllu.foreignStockTaxImportance)
  ) {
    warnings.push("이자소득, 배당소득 또는 절세 관련 정보가 부족하여 Tax 분석 정확도가 낮을 수 있습니다.");
  }
  if (!nullableText(rrttllu.regularCashflowNeed) || !nullableText(rrttllu.lumpSumPlan)) {
    warnings.push("현금흐름 니즈 또는 목돈 사용 계획 정보가 부족하여 Liquidity 분석 정확도가 낮을 수 있습니다.");
  }
  if (!rrttllu.legalConstraints.length) {
    warnings.push("투자 관련 법적/제도적 제약 정보가 부족하여 Legal 분석 정확도가 낮을 수 있습니다.");
  }
  if (rrttllu.legalConstraints.includes("기타") && !nullableText(rrttllu.legalConstraintOther)) {
    warnings.push("기타 법적 제약을 선택했으나 상세 내용이 입력되지 않았습니다.");
  }
  if (!nullableText(rrttllu.preferredAssets) || !nullableText(rrttllu.avoidedAssets) || !nullableText(rrttllu.holdingOrDisposalPlan)) {
    warnings.push("선호 자산, 비선호 자산 또는 기존 자산 운용 계획 정보가 부족하여 고객 맞춤형 포트폴리오 설계 정확도가 낮을 수 있습니다.");
  }

  return {
    basic_financial_info: {
      asset_summary: assetSummary,
      annual_fixed_income: annualFixedIncome,
      monthly_fixed_expense: monthlyFixedExpense
    },
    rrttllu: {
      return: {
        objective: nullableText(rrttllu.returnObjective)
      },
      risk: {
        score: riskResult.score,
        level: riskResult.level,
        answers: riskAnswers,
        interpretation: riskResult.interpretation
      },
      time_horizon: {
        investment_period: nullableText(rrttllu.timeHorizon)
      },
      tax: {
        expected_interest_income: expectedInterestIncome,
        expected_dividend_income: expectedDividendIncome,
        gift_plan: nullableText(rrttllu.giftingPlan),
        financial_income_tax_importance: nullableText(rrttllu.globalTaxImportance),
        financial_income_tax_history: nullableText(rrttllu.recentGlobalTaxSubject),
        foreign_stock_capital_gains_tax_importance: nullableText(rrttllu.foreignStockTaxImportance),
        financial_income_tax_alert: taxAlert
      },
      liquidity: {
        cashflow_need: nullableText(rrttllu.regularCashflowNeed),
        large_cash_need: nullableText(rrttllu.lumpSumPlan)
      },
      legal: {
        constraints: nullableArray(rrttllu.legalConstraints),
        other_detail: nullableText(rrttllu.legalConstraintOther)
      },
      unique_circumstances: {
        preferred_assets: {
          raw_input: nullableText(rrttllu.preferredAssets),
          portfolio_rule: {
            type: "soft_constraint",
            description: "고객이 선호하는 자산군은 포트폴리오 추천 시 우선 고려한다.",
            min_weight_hint: "10%"
          }
        },
        avoided_assets: {
          raw_input: nullableText(rrttllu.avoidedAssets),
          portfolio_rule: {
            type: "hard_constraint",
            description: "고객이 피하고 싶은 자산군은 포트폴리오 추천 후보에서 제외한다.",
            max_weight: "0%"
          }
        },
        existing_asset_plan: nullableText(rrttllu.holdingOrDisposalPlan)
      },
      warnings: uniqueWarnings(warnings)
    }
  };
}

function calculateRiskResult(rrttllu: RrttlluInfo): RiskResult {
  const score =
    maxSelectedScore(rrttllu.investmentExperience, riskExperienceOptions, tenPointScale) +
    selectedScore(rrttllu.knowledgeLevel, fieldGroups.knowledge, knowledgeScale) +
    selectedScore(rrttllu.derivativesExperience, fieldGroups.derivatives, tenPointScale) +
    selectedScore(rrttllu.financialAssetRatio, fieldGroups.financialAssetRatio, tenPointScale) +
    selectedScore(rrttllu.investmentAssetRatio, fieldGroups.investmentAssetRatio, tenPointScale) +
    selectedScore(rrttllu.riskAttitude, fieldGroups.riskAttitude, riskAttitudeScale) +
    selectedScore(rrttllu.lossResponse, fieldGroups.lossResponse, riskAttitudeScale);

  const level = riskLevel(score);

  return {
    score,
    level,
    answers: {
      investment_experience: rrttllu.investmentExperience,
      investment_knowledge: rrttllu.knowledgeLevel,
      derivatives_experience: rrttllu.derivativesExperience,
      financial_assets_ratio: rrttllu.financialAssetRatio,
      investment_assets_ratio: rrttllu.investmentAssetRatio,
      risk_attitude: rrttllu.riskAttitude,
      loss_response: rrttllu.lossResponse
    },
    interpretation: riskInterpretations[level]
  };
}

function selectedScore(value: string, options: string[], scores: number[]) {
  const index = options.indexOf(value);
  return index >= 0 ? scores[index] : 0;
}

function maxSelectedScore(values: string[], options: string[], scores: number[]) {
  if (!values.length) return 0;
  return Math.max(...values.map((value) => selectedScore(value, options, scores)));
}

function riskLevel(score: number): RiskLevel {
  if (score <= 20) return "초저위험";
  if (score <= 40) return "저위험";
  if (score <= 60) return "중위험";
  if (score <= 80) return "고위험";
  return "초고위험";
}

function riskLevelColor(level: RiskLevel) {
  const colors: Record<RiskLevel, string> = {
    초저위험: "text-emerald-700",
    저위험: "text-teal-700",
    중위험: "text-gold",
    고위험: "text-orange-700",
    초고위험: "text-red-700"
  };
  return colors[level];
}

function nullableText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s+/g, "");
  const nullExpressions = [
    "모름",
    "잘모르겠음",
    "말하기어려움",
    "비공개",
    "정확히모름",
    "정확한금액은말하기어렵습니다",
    "답변하고싶지않음"
  ];
  return nullExpressions.includes(normalized) ? null : trimmed;
}

function nullableArray(values: string[]) {
  return values.length ? values : null;
}

function uniqueWarnings(warnings: string[]) {
  return Array.from(new Set(warnings));
}

function financialIncomeTaxAlert(interestAmount: number | null, dividendAmount: number | null) {
  if (interestAmount === null || dividendAmount === null) {
    return "이자소득 또는 배당소득 정보가 부족하여 금융소득종합과세 여부를 판단하기 어렵습니다.";
  }

  const total = interestAmount + dividendAmount;
  if (total > 20_000_000) {
    return "올해 예상 이자소득과 배당소득 합계가 2,000만 원을 초과하여 금융소득종합과세 대상이 될 가능성이 높습니다.";
  }

  return "올해 예상 이자소득과 배당소득 합계가 2,000만 원 이하로, 금융소득종합과세 가능성은 상대적으로 낮습니다.";
}

function parseKrwAmount(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").replace(/\s+/g, "");
  const rangeParts = normalized
    .split(/~|∼|〜|-/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (rangeParts.length > 1) {
    const parsed = rangeParts.map(parseSingleKrwAmount);
    if (parsed.some((amount) => amount === null)) return null;
    const amounts = parsed as number[];
    return Math.round(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length);
  }

  return parseSingleKrwAmount(normalized);
}

function parseSingleKrwAmount(value: string): number | null {
  const cleaned = value.replace(/원|이하|미만|이상|초과|약|대략|정도/g, "");
  if (!cleaned) return null;

  let total = 0;
  let consumed = cleaned;
  const eokMatch = cleaned.match(/(\d+(?:\.\d+)?)억/);
  const manMatch = cleaned.match(/(\d+(?:\.\d+)?)만/);

  if (eokMatch) {
    total += Number(eokMatch[1]) * 100_000_000;
    consumed = consumed.replace(eokMatch[0], "");
  }
  if (manMatch) {
    total += Number(manMatch[1]) * 10_000;
    consumed = consumed.replace(manMatch[0], "");
  }
  if (total > 0) return Math.round(total);

  const numericOnly = consumed.match(/^\d+(?:\.\d+)?$/);
  if (numericOnly) return Math.round(Number(numericOnly[0]));

  return null;
}

function completion(values: string[]) {
  const completed = values.filter((value) => value.trim().length > 0).length;
  return Math.round((completed / values.length) * 100);
}

function Panel({ icon, eyebrow, title, note, children }: { icon: React.ReactNode; eyebrow: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-samsung">{icon}</div>
        <div>
          <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold text-navy">{title}</h2>
          {note ? <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">{note}</p> : null}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <textarea className="min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ChoiceGroup({ label, description, options, value, onChange }: { label: string; description?: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="text-sm font-bold text-slate-700">{label}</p>
      {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onChange(option)} className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold leading-5 transition ${value === option ? "border-samsung bg-blue-50 text-samsung shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiChoiceGroup({ label, options, values, onToggle }: { label: string; options: string[]; values: string[]; onToggle: (value: string) => void }) {
  return (
    <div>
      <p className="text-sm font-bold text-slate-700">{label}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {options.map((option) => {
          const selected = values.includes(option);
          return (
            <button key={option} type="button" onClick={() => onToggle(option)} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold leading-5 transition ${selected ? "border-mint bg-emerald-50 text-mint shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-mint bg-mint text-white" : "border-slate-300 bg-white"}`}>
                {selected ? <BadgeCheck size={14} /> : null}
              </span>
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultCard({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: "blue" | "green" | "gold" | "red" | "orange" | "slate"; children: React.ReactNode }) {
  const accentMap = {
    blue: "text-samsung bg-blue-50",
    green: "text-mint bg-emerald-50",
    gold: "text-gold bg-amber-50",
    red: "text-red-700 bg-red-50",
    orange: "text-orange-700 bg-orange-50",
    slate: "text-slate-700 bg-slate-100"
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentMap[accent]}`}>{icon}</div>
        <h3 className="text-base font-bold text-navy">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function ResultGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-sm font-semibold text-slate-500">{label}</span>
          <span className="text-right text-sm font-bold text-navy">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold leading-5 text-navy">{value}</p>
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${strong ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${strong ? "text-orange-700" : "text-navy"}`}>{value}</p>
    </div>
  );
}
