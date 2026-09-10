const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const stripTypes = (code) =>
  ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/**
 * 탭3-2 리밸런싱(삼성증권 투자상품) 편입 가드 회귀 테스트.
 *
 * 버그 1: 투자의향금액(추가 투자 의향)이 매수 확정액에 밀려 음수로 떨어지면
 *   - 헤더에 음수가 표시되고
 *   - tryAddProduct의 `if (perProductAmt > 0)` 가드가 최소편입금액 검증을 통째로 건너뛰어
 *     최소편입금액 미달 상품이 슬그머니 담겼다. 조금만 다시 늘면 또 막혀서
 *     "같은 상품이 됐다 안 됐다" 하는 현상이 있었다.
 *
 * 수정: 투자의향금액은 Math.max(0, …)로 클램프하고, 편입 가드는 perProductAmt가
 * 최소편입금액(없으면 1원) 이상일 때만 통과시킨다 — perProductAmt<=0도 항상 차단.
 */

const SRC = readFileSync(resolve(__dirname, "..", "app/maintab/tab5/page.tsx"), "utf8");
const SHELL = readFileSync(resolve(__dirname, "..", "app/maintab/MainTabShell.tsx"), "utf8");

/** 소스에서 함수 본문 한 덩어리를 중괄호 균형으로 잘라낸다 */
function sliceFn(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start !== -1, `함수를 찾지 못했습니다: ${signature}`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("함수 끝을 찾지 못함");
}

// 실제 소스의 순수 함수 세 개를 타입만 벗겨 그대로 평가해서 쓴다 (복제 아님)
const sandbox = {};
new Function(
  "sandbox",
  stripTypes(
    sliceFn(SRC, "function parseSingleAmount(text") +
      "\n" +
      sliceFn(SRC, "function parseAmount(text") +
      "\n" +
      sliceFn(SRC, "function computeBucketAmounts(bucketAmt") +
      "\nsandbox.parseAmount = parseAmount; sandbox.computeBucketAmounts = computeBucketAmounts;",
  ),
)(sandbox);
const { parseAmount, computeBucketAmounts } = sandbox;

test("소스: 투자의향금액이 음수로 새지 않도록 클램프돼 있다", () => {
  // tab5 additionalInvestmentAmount
  assert.match(SRC, /const additionalInvestmentAmount = Math\.max\(0,\s*\(\(\) =>/,
    "tab5 additionalInvestmentAmount가 Math.max(0, …)로 감싸져 있어야 한다");
  // MainTabShell availableInvestmentFunds
  assert.match(SHELL, /const d = Math\.max\(0,\s*b \+ cashFromSales - buySpent\)/,
    "MainTabShell availableInvestmentFunds(d)가 Math.max(0, …)여야 한다");
});

test("소스: tryAddProduct가 perProductAmt>0 일 때만 검증하는 옛 가드를 더는 쓰지 않는다", () => {
  const fn = sliceFn(SRC, "const tryAddProduct = (p: Product): boolean =>");
  assert.doesNotMatch(fn, /if\s*\(\s*perProductAmt\s*>\s*0\s*\)/,
    "perProductAmt>0 가드가 남아 있으면 투자의향금액이 0/음수일 때 검증이 건너뛰어진다");
  assert.match(fn, /perProductAmt < Math\.max\(requiredAmt, 1\)/,
    "최소편입금액(없으면 1원) 미달이면 차단하는 조건이 있어야 한다");
});

/** 수정된 편입 가드 로직 재현 — computeBucketAmounts는 실제 소스 것을 쓴다.
 *  rawInput: TAB1 '추가 투자 의향 자산' 원본 입력 / computedInvestable: 리밸런싱 반영 후 계산값 */
function isInclusionAllowed({ rawInput, computedInvestable, bucketWeight, minInvest, sameBucketMinInvests = [], pins = {} }) {
  const hasInvestableInput = rawInput > 0;
  if (!hasInvestableInput) return true; // "데이터 없음" — 막지 않음
  const clampedInvestable = Math.max(0, computedInvestable); // 수정: 음수 클램프
  const bucketAmt = clampedInvestable * bucketWeight;
  const products = [
    ...sameBucketMinInvests.map((m, i) => ({ id: `s${i}`, minInvest: m })),
    { id: "new", minInvest },
  ];
  const amounts = computeBucketAmounts(bucketAmt, products, pins);
  const perProductAmt = amounts["new"] ?? 0;
  const requiredAmt = minInvest ? parseAmount(minInvest) : 0;
  if (perProductAmt < Math.max(requiredAmt, 1)) return false;
  const breaks = products.slice(0, -1).some((x) => x.minInvest && (amounts[x.id] ?? 0) < parseAmount(x.minInvest));
  return !breaks;
}

test("동일 상품은 투자의향금액이 줄어들수록 '허용→차단'이 단조로워야 한다 (됐다 안 됐다 금지)", () => {
  // PB가 TAB1에 6억 입력(rawInput). 매수 확정이 늘며 computedInvestable가 8억→-2억으로 변동.
  // 최소편입금액 1억원, 버킷 비중 20% → computedInvestable 5억 이상이어야 편입 권고액이 1억
  const scenario = (computedInvestable) =>
    isInclusionAllowed({ rawInput: 6e8, computedInvestable, bucketWeight: 0.2, minInvest: "1억원" });

  const points = [];
  for (let won = 8e8; won >= -2e8; won -= 2e7) points.push([won, scenario(won)]);

  // 한 번 false가 나온 뒤에는 다시 true가 나오면 안 된다
  let blockedSeen = false;
  for (const [won, allowed] of points) {
    if (!allowed) blockedSeen = true;
    if (blockedSeen) {
      assert.equal(allowed, false, `투자의향금액 ${won}원에서 다시 편입이 허용됨 — 됐다 안 됐다 재발`);
    }
  }
  // 경계 확인: 5억이면 정확히 1억 → 허용, 4.98억이면 미달 → 차단
  assert.equal(scenario(5e8), true, "투자의향금액 5억 → 편입 권고액 1억 = 최소편입금액 → 허용");
  assert.equal(scenario(4.9e8), false, "투자의향금액 4.9억 → 편입 권고액 9800만 < 1억 → 차단");
  // 음수여도 차단 (옛 버그: 여기서 허용됐음)
  assert.equal(scenario(-1e8), false, "투자의향금액 음수 → 차단 (0으로 클램프 후 편입 권고액 0)");
  assert.equal(scenario(0), false, "투자의향금액 0 → 차단");
});

test("최소편입금액 없는 상품도 투자의향금액이 0/음수면 차단된다", () => {
  const noMin = (computedInvestable) =>
    isInclusionAllowed({ rawInput: 3e8, computedInvestable, bucketWeight: 0.25, minInvest: undefined });
  assert.equal(noMin(1e8), true, "computedInvestable 1억 → 편입 권고액 2500만 > 0 → 허용");
  assert.equal(noMin(0), false, "computedInvestable 0 → 배분액 0 → 차단");
  assert.equal(noMin(-5e7), false, "computedInvestable 음수 → 차단");
});

test("TAB1 '추가 투자 의향 자산' 미입력이면 막지 않는다 (데이터 없음)", () => {
  assert.equal(
    isInclusionAllowed({ rawInput: 0, computedInvestable: 0, bucketWeight: 0.2, minInvest: "1억원" }),
    true,
  );
});
