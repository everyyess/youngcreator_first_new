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

// ── 반대 방향: 상담실 탭 자동저장이 홈의 세션 변경을 되돌리던 문제 ──────────────
// 상담실 탭은 PB 모드에서 realtime을 구독하지 않아, 열려 있는 동안 홈이 바꾼 세션을 모른다.

/** 상담실 탭 자동저장 payload — 탭이 열린 시점의 세션 목록(s1 진행 중)만 알고 있다 */
function staleConsultationPayload() {
  return {
    appState: { smartInputNote: "상담실에서 새로 쓴 메모", consultationSessions: [SESSION] },
    analysis: { riskResult: { score: 3 } },
  };
}

test("상담실 자동저장은 홈이 추가·종료한 세션을 되돌리지 않는다", async () => {
  const homeFinished = { ...SESSION, status: "completed", updatedAt: "2026-09-10T12:00:00.000Z" };
  const homeAdded = { ...SESSION, id: "s2", updatedAt: "2026-09-10T12:30:00.000Z" };
  const client = fakeClient(rowWithGuide({ consultationSessions: [homeFinished, homeAdded] }));
  const ctx = loadCustomerContext(client);

  const result = await ctx.saveCustomerDataWithLatestSessions("c1", staleConsultationPayload(), []);

  assert.equal(result.ok, true);
  const saved = client.writes[0].data;
  const byId = Object.fromEntries(Array.from(saved.appState.consultationSessions, (s) => [s.id, s.status]));
  assert.equal(byId.s1, "completed", "홈에서 종료한 상담이 진행 중으로 되돌아가면 안 된다");
  assert.equal(byId.s2, "active", "홈에서 새로 만든 상담이 사라지면 안 된다");
  assert.equal(saved.appState.smartInputNote, "상담실에서 새로 쓴 메모", "상담실의 다른 입력은 그대로 저장되어야 한다");
  assert.equal(saved.analysis.riskResult.score, 3, "analysis도 그대로 저장되어야 한다");
});

test("홈에서 삭제한 세션을 상담실 자동저장이 되살리지 않는다", async () => {
  const client = fakeClient(rowWithGuide({ consultationSessions: [] }));
  const ctx = loadCustomerContext(client);

  await ctx.saveCustomerDataWithLatestSessions("c1", staleConsultationPayload(), []);

  assert.equal(client.writes[0].data.appState.consultationSessions.length, 0);
});

test("상담실이 직접 한 세션 변경(상담 종료)은 최신 목록 위에 적용된다", async () => {
  const homeAdded = { ...SESSION, id: "s2", updatedAt: "2026-09-10T12:30:00.000Z" };
  const client = fakeClient(rowWithGuide({ consultationSessions: [SESSION, homeAdded] }));
  const ctx = loadCustomerContext(client);

  const finish = (list) => list.map((s) => (s.id === "s1" ? { ...s, status: "completed" } : s));
  const result = await ctx.saveCustomerDataWithLatestSessions("c1", staleConsultationPayload(), [finish]);

  const byId = Object.fromEntries(Array.from(client.writes[0].data.appState.consultationSessions, (s) => [s.id, s.status]));
  assert.equal(byId.s1, "completed", "상담실에서 종료한 상담은 저장되어야 한다");
  assert.equal(byId.s2, "active", "그 사이 홈에서 만든 상담도 남아야 한다");
  assert.equal(Array.from(result.sessions, (s) => s.id).join(","), "s1,s2", "화면 동기화용 최신 목록을 돌려준다");
});

test("AppState 그대로인 payload도 세션 목록만 최신값으로 바꿔 저장한다", async () => {
  const homeAdded = { ...SESSION, id: "s2" };
  const client = fakeClient(rowWithGuide({ consultationSessions: [SESSION, homeAdded] }));
  const ctx = loadCustomerContext(client);

  await ctx.saveCustomerDataWithLatestSessions("c1", { smartInputNote: "flat", consultationSessions: [SESSION] }, []);

  const saved = client.writes[0].data;
  assert.equal(saved.appState, undefined, "래핑하지 않은 형태를 유지해야 한다");
  assert.equal(saved.smartInputNote, "flat");
  assert.equal(saved.consultationSessions.length, 2);
});

test("상담실 탭(MainTabShell)도 AppState 전체를 직접 저장하지 않는다", () => {
  const source = readFileSync(resolve(__dirname, "..", "app/maintab/MainTabShell.tsx"), "utf8");
  assert.ok(!/saveCustomerDataJsonOnly\s*\(/.test(source),
    "MainTabShell이 saveCustomerDataJsonOnly로 세션 목록까지 통째로 저장하고 있다 — saveCustomerDataWithLatestSessions를 써야 한다");
});

test("홈·분석실은 AppState 전체를 직접 저장하지 않는다 (옛 사본 덮어쓰기 재발 방지)", () => {
  for (const file of ["app/home/page.tsx", "app/analysis/AnalysisPageClient.tsx"]) {
    const source = readFileSync(resolve(__dirname, "..", file), "utf8");
    assert.ok(!/saveCustomerDataJsonOnly\s*\(/.test(source),
      `${file}가 saveCustomerDataJsonOnly로 AppState 전체를 저장하고 있다 — updateConsultationSessionsOnly를 써야 한다`);
  }
});
