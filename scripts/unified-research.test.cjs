const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");

function loadTs(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "..", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error("Unexpected dependency: " + name);
    },
    Date, Intl, URL, console, AbortSignal,
    fetch: mocks.__fetch ?? globalThis.fetch,
  }, { filename: path });
  return exports;
}
function fixture({ rows = [], dbError = null, liveNews = [], liveReports = [], remoteFetch } = {}) {
  const jobs = new Map();
  let liveCalls = 0;
  const debateCalls = [];
  const jobStore = {
    createJob(request) {
      const job = {
        id: "test-job", request, status: "running", stage: "collecting",
        stageHistory: ["collecting"], dbStates: Object.fromEntries(request.databases.map(id => [id, "running"])),
        percent: 1, stageLabel: "작업 준비 중", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        finishedAt: null, result: null, error: null, modelUsage: {},
        hitl: { completedStep: 0, awaitingStep: null, awaitingApproval: false, agentUpdates: [] },
      };
      jobs.set(job.id, job); return job;
    },
    getJob: id => jobs.get(id) ?? null,
    updateJob(id, patch) { Object.assign(jobs.get(id), patch, { updatedAt: new Date().toISOString() }); },
  };
  const types = loadTs("Engine/Research-Engine/types.ts");
  const normalizer = loadTs("Engine/Research-Engine/result.ts");
  const service = loadTs("Engine/Research-Engine/humanApprovalPipeline.ts", {
    "@supabase/supabase-js": {},
    "./jobStore": jobStore,
    "./types": types,
    "./result": normalizer,
    "@/lib/tagRules": { extractMappedTags: text => ({
      topics: text.includes("반도체") ? ["반도체"] : [],
      companies: [], macro: [],
    }) },
    "@/lib/liveInsightSources": { loadLiveInsightSources: async () => {
      liveCalls += 1; return { news: liveNews, reports: liveReports };
    } },
    "@/lib/supabaseInsightDb": { formatSupabaseError: error => error.message ?? String(error) },
    "@/app/api/sector-scanner/sectorMaster": { sectorsForMarket: market => market === "domestic" ? [{
      id: "semiconductor", name: "반도체", symbols: [
        { symbol: "005930.KS", name: "삼성전자" },
        { symbol: "000660.KS", name: "SK하이닉스" },
      ],
    }] : [] },
    "./humanDebate": { runHumanDebate: async (...args) => {
      debateCalls.push(args);
      return ({
      debate: {
        frame: "stock-theme", proOpening: "강세 입론 #1", conOpening: "약세 입론 #1",
        proRebuttal: "강세 반박 #1", conRebuttal: "약세 반박 #1",
        verdict: "팽팽함", rationale: "양측 근거가 균형적입니다.",
        watchpoints: "후속 지표를 확인합니다.", confidence: "중간",
      },
      modelUsage: { "test-debate-model": 5 },
    }); } },
    "./researchReport": { generateResearchReport: async result => ({
      markdown: "# " + result.keyword + " 통합 리서치\n\n테스트 보고서",
      mode: "ai",
      model: "test-model",
    }) },
    __fetch: remoteFetch,
  });
  const db = { from() { return {
    select() { return this; }, order() { return this; },
    async limit() { return { data: rows, error: dbError }; },
  }; } };
  return { service, db, jobs, getLiveCalls: () => liveCalls, getDebateCalls: () => debateCalls };
}
const request = { keyword: "반도체", databases: ["news"], method: "report", keywordType: "theme" };

test("STEP 1만 실행한 뒤 STEP 2 PB 승인을 기다린다", async () => {
  const { service, db, jobs, getLiveCalls } = fixture({ rows: [
    { title: "반도체 실적 개선", notes: "영업이익 증가", url: "https://example.com/1", published_date: "2026-09-04" },
  ] });
  const outcome = await service.startHumanResearch(db, request);
  assert.equal(outcome.status, 201);
  const job = jobs.get(outcome.job.id);
  assert.equal(job.status, "awaiting_approval");
  assert.equal(job.hitl.completedStep, 1);
  assert.equal(job.hitl.awaitingStep, 2);
  assert.equal(job.result.storedCards.length, 1);
  assert.equal(job.result.report, null);
  assert.equal(getLiveCalls(), 0);
  assert.ok(job.hitl.agentUpdates[0].summary.includes("PB"));
});

test("PB 승인마다 정확히 다음 STEP 하나만 실행한다", async () => {
  const { service, db, jobs } = fixture({ rows: [{ title: "반도체 실적 개선", url: "https://example.com/1" }] });
  await service.startHumanResearch(db, request);
  for (const step of [2, 3, 4]) {
    const outcome = await service.approveHumanResearch("test-job", step);
    assert.equal(outcome.status, 200);
    assert.equal(jobs.get("test-job").hitl.completedStep, step);
    assert.equal(jobs.get("test-job").hitl.awaitingStep, step + 1);
    assert.equal(jobs.get("test-job").status, "awaiting_approval");
  }
  assert.equal(jobs.get("test-job").result.report, null);
  await service.approveHumanResearch("test-job", 5);
  const job = jobs.get("test-job");
  assert.equal(job.status, "done");
  assert.equal(job.hitl.completedStep, 5);
  assert.equal(job.hitl.awaitingStep, null);
  assert.ok(job.result.report.includes("반도체 통합 리서치"));
  assert.ok(job.hitl.agentUpdates.some(message => message.agent.includes("보고서")));
});

test("중복·순서가 다른 승인은 거부한다", async () => {
  const { service, db } = fixture({ rows: [{ title: "반도체 실적 개선" }] });
  await service.startHumanResearch(db, request);
  assert.equal((await service.approveHumanResearch("test-job", 3)).status, 409);
  assert.equal((await service.approveHumanResearch("test-job", 2)).status, 200);
  assert.equal((await service.approveHumanResearch("test-job", 2)).status, 409);
});

test("STEP 4 승인 시 공개 출처로 Gemini 찬반토론을 실행하고 PB에게 결과를 전달한다", async () => {
  const { service, db, jobs, getDebateCalls } = fixture({ rows: [{
    title: "반도체 업황 회복", notes: "메모리 가격이 개선됐다.",
    customer_private_note: "외부 전송 금지", url: "https://example.com/public", published_date: "2026-09-05",
  }] });
  await service.startHumanResearch(db, request);
  for (const step of [2, 3, 4]) await service.approveHumanResearch("test-job", step);
  const job = jobs.get("test-job");
  assert.equal(getDebateCalls().length, 1);
  assert.equal(job.result.debate.verdict, "팽팽함");
  assert.equal(job.modelUsage["test-debate-model"], 5);
  assert.ok(job.hitl.agentUpdates.some(message =>
    message.agent === "찬반토론 AI 에이전트" && message.status === "completed" && /종합 판정 1건/.test(message.summary)
  ));
  const sentCards = getDebateCalls()[0][3];
  assert.match(sentCards[0].evidence, /메모리 가격이 개선됐다/);
  assert.doesNotMatch(JSON.stringify(sentCards), /외부 전송 금지/);
});

test("실시간 보강 에이전트는 저장 뉴스가 있으면 STEP 4 승인 전에는 실행하지 않는다", async () => {
  const { service, db, jobs, getLiveCalls } = fixture({
    rows: [{ title: "반도체 기존 저장 자료", url: "https://example.com/stored", published_date: "2026-09-01" }],
    liveNews: [
    { title: "반도체 투자 확대", summary: "AI 서버 투자로 메모리 수요가 늘었다.", url: "https://example.com/live", publishedDate: "2026-09-05" },
  ] });
  await service.startHumanResearch(db, request);
  await service.approveHumanResearch("test-job", 2);
  await service.approveHumanResearch("test-job", 3);
  assert.equal(getLiveCalls(), 0);
  await service.approveHumanResearch("test-job", 4);
  assert.equal(getLiveCalls(), 1);
  assert.equal(jobs.get("test-job").result.liveCards.length, 1);
  assert.equal(jobs.get("test-job").result.supplemented, true);
  assert.match(jobs.get("test-job").result.liveCards[0].evidence, /메모리 수요/);
  assert.match(jobs.get("test-job").result.liveCards[0].evidence, /\[#2\]/);
});

test("저장 근거가 없어도 PB가 정보 공백을 확인하고 보강 단계를 승인할 수 있다", async () => {
  const { service, db, jobs } = fixture();
  await service.startHumanResearch(db, request);
  await service.approveHumanResearch("test-job", 2);
  await service.approveHumanResearch("test-job", 3);
  assert.equal(jobs.get("test-job").result.integrated.gaps.length, 1);
  assert.equal(jobs.get("test-job").hitl.awaitingStep, 4);
});

test("저장 리포트가 없으면 실시간 리포트를 STEP 1 에이전트 근거로 사용한다", async () => {
  const { service, db, jobs } = fixture({ liveReports: [{
    title: "금리 상승에 따른 퀄리티 스타일 부각",
    summary: "국채 금리 상승 구간에서 퀄리티 주식의 상대 강도를 분석했다.",
    meta: "키움증권 · 투자정보",
    url: "https://example.com/report",
    publishedDate: "2026-09-03",
  }] });
  await service.startHumanResearch(db, {
    keyword: "금리", databases: ["report"], method: "report", keywordType: "macro",
  });
  const job = jobs.get("test-job");
  assert.equal(job.dbStates.report, "done");
  assert.equal(job.result.storedCards[0].itemCount, 1);
  assert.match(job.result.storedCards[0].evidence, /퀄리티 주식/);
  assert.ok(job.hitl.agentUpdates.some(message => message.agent === "리포트 에이전트" && message.status === "completed"));
});

test("저장 뉴스가 없으면 경제 관련 실시간 뉴스를 STEP 1 근거로 사용한다", async () => {
  const { service, db, jobs } = fixture({ liveNews: [{
    title: "반도체 수출 증가와 설비투자 회복",
    summary: "메모리 가격과 수출 지표가 동반 개선됐다.",
    meta: "한국경제 · 경제",
    url: "https://example.com/news-live",
    publishedDate: "2026-09-05",
  }] });
  await service.startHumanResearch(db, request);
  const job = jobs.get("test-job");
  assert.equal(job.dbStates.news, "done");
  assert.equal(job.result.storedCards[0].itemCount, 1);
  assert.match(job.result.storedCards[0].evidence, /설비투자 회복/);
});

test("correlation·peer 에이전트가 기존 분석 API 결과를 STEP 1 근거로 사용한다", async () => {
  const remoteFetch = async (url) => {
    const href = String(url);
    if (href.includes("etf-correlation-domestic-html")) return {
      ok: true, status: 200, async json() { return {
        period: {
          start: "2026-03-01", end: "2026-09-05",
          optimal: ["005930.KS", "000660.KS"], opt_avg_corr: 0.42, global_avg: 0.61,
          capped_weights: { "005930.KS": 0.55, "000660.KS": 0.45 },
        },
        sectorMap: { "005930.KS": "반도체", "000660.KS": "반도체" },
      }; },
    };
    if (href.includes("/api/peer-analysis")) return {
      ok: true, status: 200, async json() { return {
        sectorName: "반도체", asOf: "2026-09-05T00:00:00.000Z",
        peers: [
          { symbol: "005930.KS", name: "삼성전자", per: 18.2, pbr: 1.5, roe: 9.1, operatingMargin: 12.3, revenueGrowthYoY: 8.4, epsGrowthFwd: 10.2 },
          { symbol: "000660.KS", name: "SK하이닉스", per: 11.4, pbr: 2.1, roe: 18.7, operatingMargin: 28.5, revenueGrowthYoY: 25.2, epsGrowthFwd: 31.4 },
        ],
      }; },
    };
    throw new Error("unexpected URL " + href);
  };
  const { service, db, jobs } = fixture({ remoteFetch });
  await service.startHumanResearch(db, {
    keyword: "반도체", databases: ["correlation", "peer"], method: "report", keywordType: "theme",
    baseUrl: "http://localhost:3000",
  });
  const job = jobs.get("test-job");
  assert.equal(job.dbStates.correlation, "done");
  assert.equal(job.dbStates.peer, "done");
  assert.equal(job.result.storedCards.find(card => card.databaseId === "correlation").itemCount, 1);
  assert.equal(job.result.storedCards.find(card => card.databaseId === "peer").itemCount, 2);
  assert.match(job.result.storedCards.map(card => card.evidence).join("\n"), /조합 평균 상관계수 0\.420/);
  assert.match(job.result.storedCards.map(card => card.evidence).join("\n"), /SK하이닉스/);
});

test("FRED·ECOS 에이전트가 실제 지표 시리즈를 STEP 1과 후속 분석에 전달한다", async () => {
  const remoteFetch = async (url) => {
    const href = String(url);
    if (href.includes("/api/market/fred")) return {
      ok: true, status: 200, async json() { return { data: {
        FEDFUNDS: { title: "미국 기준금리", unit: "%", observations: [
          { date: "2026-08-01", value: "4.25" }, { date: "2026-07-01", value: "4.25" },
        ] },
      } }; },
    };
    if (href.includes("/api/market/ecos")) return {
      ok: true, status: 200, async json() { return { indicators: [{
        label: "기준금리", unit: "%", cycle: "M", observations: [
          { time: "202608", value: "2.50" }, { time: "202607", value: "2.50" },
        ],
      }] }; },
    };
    throw new Error("unexpected URL " + href);
  };
  const { service, db, jobs } = fixture({ remoteFetch });
  await service.startHumanResearch(db, {
    keyword: "금리", databases: ["fred", "ecos"], method: "report", keywordType: "macro",
    baseUrl: "http://localhost:3000",
  });
  const job = jobs.get("test-job");
  assert.equal(job.dbStates.fred, "done");
  assert.equal(job.dbStates.ecos, "done");
  assert.equal(job.result.sources.length, 2);
  assert.match(job.result.storedCards.map(card => card.evidence).join("\n"), /4\.25%/);
  assert.match(job.result.storedCards.map(card => card.evidence).join("\n"), /2\.50%/);

  await service.approveHumanResearch("test-job", 2);
  const step2 = job.hitl.agentUpdates.filter(message => message.step === 2);
  assert.ok(step2.every(message => /근거 2건/.test(message.summary)));

  for (const step of [3, 4, 5]) await service.approveHumanResearch("test-job", step);
  assert.equal(job.result.metricCharts.length, 2);
  assert.deepEqual(Array.from(job.result.metricCharts[0].points, point => point.date), ["2026-07-01", "2026-08-01"]);
  assert.equal(job.result.metricCharts[0].source, "FRED");
  assert.equal(job.result.metricCharts[1].source, "ECOS");
});

test("각 DB 에이전트의 완료·오류·건너뜀 정보가 PB에게 전달된다", async () => {
  const { service, db, jobs } = fixture({ dbError: { message: "database unavailable" } });
  await service.startHumanResearch(db, {
    keyword: "반도체", databases: ["news", "technical"], method: "report",
  });
  const updates = jobs.get("test-job").hitl.agentUpdates;
  assert.equal(updates.length, 2);
  assert.ok(updates.some(message => message.status === "error"));
  assert.ok(updates.some(message => message.status === "skipped"));
});

test("제거된 DB만 선택하거나 잘못된 요청은 작업을 만들지 않는다", async () => {
  const { service, db, jobs } = fixture();
  for (const input of [null, [], {}, { keyword: "반도체", databases: ["youtube"] }]) {
    assert.equal((await service.startHumanResearch(db, input)).status, 400);
  }
  assert.equal(jobs.size, 0);
});

test("이전 작업에는 안전한 기본 승인 상태를 제공한다", () => {
  const { service } = fixture();
  const serialized = service.serializeResearchJob({
    id: "legacy", status: "done", result: { keyword: "반도체" },
  });
  assert.equal(serialized.hitl.completedStep, 5);
  assert.equal(serialized.result.storedCards.length, 0);
});

function reportFixture() {
  return {
    keyword: "금리", keywordType: "macro", method: "report",
    databases: ["news"], supplemented: true, debate: null, report: null, score: null,
    skipped: [], timings: {}, generatedAt: "",
    sources: [
      { id: "#1", database: "news", phase: "live", title: "미국 금리 경로 재평가", url: "https://example.com/1", date: "2026-09-05" },
      { id: "#2", database: "news", phase: "live", title: "고용 지표와 채권 금리", url: "https://example.com/2", date: "2026-09-04" },
      { id: "#3", database: "report", phase: "live", title: "금리와 환율의 딜레마", url: "https://example.com/3", date: "2026-09-03" },
    ],
    storedCards: [],
    liveCards: [{
      databaseId: "news", databaseLabel: "뉴스", phase: "live",
      conclusion: "금리 경로를 둘러싼 불확실성이 커졌습니다.",
      evidence: "- [#1] **미국 금리 경로 재평가** (2026-09-05)\n  물가와 고용 신호가 엇갈렸습니다.\n- [#2] **고용 지표와 채권 금리** (2026-09-04)\n  채권시장이 정책 기대를 재반영했습니다.",
      citedSources: ["#1", "#2"], asOfDate: "2026-09-05", confidence: "중간", itemCount: 2,
    }],
    integrated: {
      summary: "금리 관련 근거를 통합했습니다.", tagAnalysis: "국채, 고용, 환율",
      timeSeries: "2026-09 3건", trend: "정책 기대 변화가 핵심입니다.",
      conflicts: [], gaps: [], old: [], needsSupplement: false,
    },
  };
}

test("AI 장애 폴백 보고서도 빈 제목 목록이 아니라 모든 매크로 분석 섹션을 제공한다", async () => {
  const reportModule = loadTs("Engine/Research-Engine/researchReport.ts", {
    "@/lib/geminiModels": { DEEP_MODELS: ["test-model"] },
    "@/lib/geminiRunner": { fetchGeminiWithFallback: async () => { throw new Error("offline"); } },
    "./types": {},
  });
  const generated = await reportModule.generateResearchReport(reportFixture());
  assert.equal(generated.mode, "fallback");
  assert.ok(generated.markdown.length > 1500);
  for (const heading of ["지표 현황과 배경", "전개 시계열", "자산군·섹터별 파급 경로", "우호적·비우호적 시나리오", "PB 체크포인트", "판단 근거", "출처"]) {
    assert.ok(generated.markdown.includes(heading), heading);
  }
  assert.match(generated.markdown, /\[인용\]\[#1\]/);
  assert.match(generated.markdown, /물가와 고용 신호가 엇갈렸습니다/);
  assert.doesNotMatch(generated.markdown, /제목 기반 자료/);
});

test("완전한 AI 보고서는 출처 서지를 붙여 그대로 채택한다", async () => {
  const sections = `**세 줄 요약**
· 금리 경로가 재평가되고 있습니다. [인용][#1]
· 고용과 채권시장의 반응을 함께 봐야 합니다. [인용][#2]
· 환율 파급을 점검해야 합니다. [인용][#3]

**1. 지표 현황과 배경**
정책 기대와 시장금리의 차이를 분석합니다. [판단(1)]

**2. 전개 시계열**
최근 자료는 시장 기대가 바뀌는 과정을 보여줍니다. [인용][#1][#2]

**3. 자산군·섹터별 파급 경로**
채권, 성장주, 환율의 반응 경로를 구분합니다. [판단(2)]

**4. 우호적·비우호적 시나리오**
물가 안정과 경기 둔화를 각각 조건부로 점검합니다. [판단(3)]

**5. PB 체크포인트**
1. 정책 발언과 시장 가격의 괴리를 확인합니다. [판단(4)]

**판단 근거**
[판단(1)]: 정책 기대와 시장 가격은 시차를 두고 반영될 수 있습니다.
[판단(2)]: 자산별 듀레이션과 환 노출이 다릅니다.
[판단(3)]: 같은 금리 하락이라도 원인에 따라 자산 반응이 다릅니다.
[판단(4)]: 기대의 괴리는 변동성의 원인이 됩니다.

${"근거를 연결한 상세 분석 문장입니다. [인용][#1] ".repeat(45)}`;
  const reportModule = loadTs("Engine/Research-Engine/researchReport.ts", {
    "@/lib/geminiModels": { DEEP_MODELS: ["test-model"] },
    "@/lib/geminiRunner": { fetchGeminiWithFallback: async () => ({
      model: "test-model",
      res: { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: sections }] } }] }; } },
    }) },
    "./types": {},
  });
  const generated = await reportModule.generateResearchReport(reportFixture());
  assert.equal(generated.mode, "ai");
  assert.equal(generated.model, "test-model");
  assert.match(generated.markdown, /\[#1\]: \[2026-09-05 · 뉴스 · 실시간\]/);
});

test("의미는 같은 변형 목차와 묶음 각주를 가진 AI 보고서도 채택한다", async () => {
  const sections = `**핵심 요약**
· 금리 경로가 재평가되고 있습니다. [인용][#1, #2]
· 환율 파급을 확인해야 합니다. [인용][#3]
· 고객 포트폴리오의 금리 민감도를 점검합니다. [판단(1)]

**1. 금리 현황 및 정책 배경**
시장금리와 정책 기대의 차이가 커지고 있습니다. [인용][#1]

**2. 최근 흐름과 전개**
고용 발표 뒤 채권시장 기대가 이동했습니다. [인용][#2]

**3. 주요 자산군 파급 효과**
채권과 성장주의 할인율 민감도를 구분합니다. [판단(2)]

**4. 상방 및 하방 시나리오**
물가와 경기 조합에 따라 두 경로를 점검합니다. [판단(3)]

**5. 모니터링 항목**
정책 발언, 장단기 금리, 환율을 확인합니다. [판단(4)]

**판단 근거**
[판단(1)]: 고객별 듀레이션이 다릅니다.
[판단(2)]: 자산별 할인율 민감도가 다릅니다.
[판단(3)]: 금리 변화의 원인에 따라 반응이 달라집니다.
[판단(4)]: 정책과 가격의 괴리는 변동성을 높입니다.

${"자료를 연결하여 국면과 조건부 파급 경로를 상세히 설명합니다. [인용][#1] ".repeat(28)}`;
  const reportModule = loadTs("Engine/Research-Engine/researchReport.ts", {
    "@/lib/geminiModels": { DEEP_MODELS: ["test-model"] },
    "@/lib/geminiRunner": { fetchGeminiWithFallback: async () => ({
      model: "test-model",
      res: { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: sections }] } }] }; } },
    }) },
    "./types": {},
  });
  const generated = await reportModule.generateResearchReport(reportFixture());
  assert.equal(generated.mode, "ai");
  assert.match(generated.markdown, /\[인용\]\[#1\]\[#2\]/);
});
