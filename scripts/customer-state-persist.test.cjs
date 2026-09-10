const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");

/**
 * 재접속 시 AI 상담 가이드·음성 대화록이 사라지던 문제의 회귀 테스트.
 *
 * 원인: 홈·분석실이 자기가 열린 시점의 AppState 사본을 들고 있다가, 상담 세션 하나를
 * 바꾸면서 그 사본 전체를 DB에 저장했다. 상담실은 새 탭에서 열리므로 그 사이 상담실이
 * 저장한 가이드·대화록이 옛 사본(빈 값)으로 덮였다.
 */

function loadCustomerContext(fakeClient) {
  const exports = {};
  const path = "app/maintab/CustomerContext.tsx";
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "..", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mocks = {
    react: { createContext: () => ({}), useContext: () => ({}) },
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: {} },
    "@supabase/supabase-js": {},
    "@/lib/supabaseBrowser": { browserSupabase: fakeClient },
    "./liquidityFields": { formatLiquiditySummary: () => "" },
  };
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error("Unexpected dependency: " + name);
    },
    Date, Intl, URL, console, JSON, Math, Number, String, Array, Object, Set, Map, Promise, Boolean, RegExp, Error,
    window: undefined,
  }, { filename: path });
  return exports;
}

/** customers 테이블 한 행만 가진 가짜 Supabase 클라이언트 — 저장 요청을 기록한다 */
function fakeClient(row) {
  const writes = [];
  return {
    writes,
    from() {
      return {
        select() {
          return { eq() { return { limit: async () => ({ data: [row], error: null }) }; } };
        },
        update(payload) {
          writes.push(payload);
          return { eq() { return { select: async () => ({ data: [{ id: row.id }], error: null }) }; } };
        },
      };
    },
  };
}

const GUIDE = {
  conflicts: { lines: [{ text: "상충 정보" }] },
  followUps: { lines: [{ text: "추가 확인" }], checkpoints: [] },
  explanation: { lines: [{ text: "설명 방식" }] },
};
const TRANSCRIPT = [{ speaker: "PB", text: "안녕하세요" }, { speaker: "고객", text: "네" }];
const SESSION = { id: "s1", customerId: "c1", date: "2026-09-10", status: "active", updatedAt: "2026-09-10T10:00:00.000Z" };

/** 상담실(새 탭)이 가이드·대화록을 저장한 뒤의 DB 행 */
function rowWithGuide(extra = {}) {
  return {
    id: "c1",
    profile: { id: "c1", name: "테스트" },
    data: {
      smartInputNote: "상담 메모",
      smartTranscript: TRANSCRIPT,
      aiAdvisoryGuide: GUIDE,
      aiGuidePayloadSignature: "SIG-123",
      aiGuideGeneratedAt: "2026-09-10T11:00:00.000Z",
      consultationSessions: [SESSION],
      ...extra,
    },
  };
}

test("세션만 갱신해도 상담실이 저장한 AI 상담 가이드·음성 대화록은 그대로 남는다", async () => {
  const client = fakeClient(rowWithGuide());
  const ctx = loadCustomerContext(client);

  // 홈이 "상담 종료"로 세션 상태만 바꾼다 (홈 사본에는 가이드가 없던 상황)
  const result = await ctx.updateConsultationSessionsOnly("c1", (latest) =>
    latest.consultationSessions.map((s) => (s.id === "s1" ? { ...s, status: "completed" } : s)));

  assert.equal(result.ok, true);
  assert.equal(client.writes.length, 1);
  const saved = client.writes[0].data;
  assert.equal(saved.consultationSessions[0].status, "completed", "세션 변경은 반영되어야 한다");
  assert.ok(saved.aiAdvisoryGuide, "AI 상담 가이드가 지워지면 안 된다");
  assert.equal(saved.aiAdvisoryGuide.conflicts.lines[0].text, "상충 정보");
  assert.equal(saved.smartTranscript.length, 2, "음성 대화록이 지워지면 안 된다");
  assert.equal(saved.aiGuidePayloadSignature, "SIG-123", "서명이 남아야 재생성 시 캐시가 적중한다");
  assert.equal(saved.smartInputNote, "상담 메모");
});

test("상담실이 쓴 { appState, analysis } 형태면 그 형태와 analysis를 보존한다", async () => {
  const wrapped = rowWithGuide();
  const appState = wrapped.data;
  wrapped.data = { appState, analysis: { riskResult: { score: 7 } } };
  const client = fakeClient(wrapped);
  const ctx = loadCustomerContext(client);

  await ctx.updateConsultationSessionsOnly("c1", (latest) => latest.consultationSessions);

  const saved = client.writes[0].data;
  assert.ok(saved.appState, "래핑 형태가 유지되어야 한다");
  assert.equal(saved.analysis.riskResult.score, 7, "analysis가 보존되어야 한다");
  assert.ok(saved.appState.aiAdvisoryGuide, "래핑 안의 가이드도 보존되어야 한다");
  assert.equal(saved.appState.smartTranscript.length, 2);
});

test("세션 목록도 최신 목록을 기준으로 계산해 다른 탭이 추가한 세션을 지우지 않는다", async () => {
  const other = { ...SESSION, id: "s2", updatedAt: "2026-09-10T12:00:00.000Z" };
  const client = fakeClient(rowWithGuide({ consultationSessions: [SESSION, other] }));
  const ctx = loadCustomerContext(client);

  // 홈 사본은 s1만 알고 있지만, update는 최신 상태를 받아 계산한다
  await ctx.updateConsultationSessionsOnly("c1", (latest) =>
    latest.consultationSessions.map((s) => (s.id === "s1" ? { ...s, status: "completed" } : s)));

  const ids = Array.from(client.writes[0].data.consultationSessions, (s) => s.id).sort().join(",");
  assert.equal(ids, "s1,s2", "다른 탭에서 생긴 세션 s2가 남아 있어야 한다");
});

test("홈·분석실은 AppState 전체를 직접 저장하지 않는다 (옛 사본 덮어쓰기 재발 방지)", () => {
  for (const file of ["app/home/page.tsx", "app/analysis/AnalysisPageClient.tsx"]) {
    const source = readFileSync(resolve(__dirname, "..", file), "utf8");
    assert.ok(!/saveCustomerDataJsonOnly\s*\(/.test(source),
      `${file}가 saveCustomerDataJsonOnly로 AppState 전체를 저장하고 있다 — updateConsultationSessionsOnly를 써야 한다`);
  }
});
