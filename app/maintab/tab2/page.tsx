"use client";

<<<<<<< HEAD
import { BarChart3, Sparkles } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import { Panel, TextField, TextAreaField, ResultCard, ResultGrid, Metric } from "../ui";

export default function Tab3Page() {
  const { formData, riskResult, warnings, setRrttllu, financialCompletion, rrttlluCompletion } = useCustomerContext();

  return (
    <>
      <header className="rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-soft">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-semibold text-samsung">Samsung Securities PB Advisory</p>
            <h1 className="mt-1 text-2xl font-bold tracking-normal text-navy md:text-3xl">신규 포트폴리오 생성</h1>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="기본 정보" value={`${financialCompletion}%`} />
            <Metric label="RRTTLLU" value={`${rrttlluCompletion}%`} />
            <Metric label="Risk 점수" value={`${riskResult.score}/100`} />
            <Metric label="경고" value={`${warnings.length}개`} strong />
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <section className="space-y-5">
          <Panel icon={<Sparkles size={18} />} eyebrow="신규 포트폴리오 생성" title="추천 조건 입력">
            <TextAreaField label="우선 고려할 자산" value={formData.rrttllu.preferredAssets} placeholder="예. 미국 배당주 ETF, 월지급식 채권형 상품" onChange={(v) => setRrttllu("preferredAssets", v)} />
            <TextAreaField label="추천 후보에서 제외할 자산" value={formData.rrttllu.avoidedAssets} placeholder="예. 가상자산, 가치 평가가 어려운 비상장 자산" onChange={(v) => setRrttllu("avoidedAssets", v)} />
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="정기 현금흐름 필요" value={formData.rrttllu.regularCashflowNeed} placeholder="예. 월 500만 원" onChange={(v) => setRrttllu("regularCashflowNeed", v)} />
              <TextField label="목돈 사용 계획" value={formData.rrttllu.lumpSumPlan} placeholder="예. 5년 후 1억 원" onChange={(v) => setRrttllu("lumpSumPlan", v)} />
              <TextField label="비상예비자금 확보 계획" value={formData.rrttllu.emergencyReservePlan} placeholder="예. 의료비 등 비상 상황 대비 1억 원" onChange={(v) => setRrttllu("emergencyReservePlan", v)} />
            </div>
          </Panel>
        </section>

        <aside className="space-y-5">
          <ResultCard icon={<BarChart3 size={18} />} title="신규 포트폴리오 생성 기준" accent="blue">
            <ResultGrid rows={[["목표 수익률", formData.rrttllu.returnObjective || "미선택"], ["위험등급", riskResult.level], ["투자 기간", formData.rrttllu.timeHorizon || "미선택"], ["금융자산", formData.financial.financialAssets || "입력 대기"]]} />
            <p className="mt-3 rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">선호 자산은 우선 고려 조건으로, 비선호 자산은 제외 조건으로 고객 성향 분석 JSON에 함께 저장됩니다.</p>
          </ResultCard>
        </aside>
      </div>
    </>
=======
export default function Tab2Page() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center shadow-soft">
      <p className="text-lg font-bold text-navy">해당 영역은 추후 작업 예정입니다.</p>
    </section>
>>>>>>> team/main
  );
}
