const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");

function loadTs(path, mocks = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "..", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error("Unexpected dependency: " + name);
    },
    Date, Intl, URL, URLSearchParams, AbortSignal, TextDecoder, console,
    ...globals,
  }, { filename: path });
  return exports;
}

const filter = loadTs("lib/economicNewsFilter.ts");
const positive = [
  "한국은행 기준금리 인하 결정",
  "소비자물가 상승률 둔화",
  "반도체 수출 증가로 경상수지 흑자 확대",
  "여행업계 매출 증가에도 영업이익 감소",
  "패션기업 실적 개선, 해외 시장 점유율 확대",
  "외식 물가 상승에 소비 위축",
  "부동산 대출 규제 강화, 집값 하락",
  "농가 탄소배출권 시장규모 확대",
  "신생 로봇 기업 대규모 수주",
  "전기차 공장 양산 시작",
  "제약사 임상 승인으로 기술이전 기대",
  "대기업 일자리 확대 논의",
  "자동차 업체 해고 계획 발표",
  "구글 광고 사업 분할 소송 결론",
  "엔비디아, 스타트업 20억달러 인수",
  "금융상품 절세 전략과 상속세 개편",
  "스타트업 IPO 준비 본격화",
  "소상공인 폐업 늘어…임대료 부담",
  "유통기업 가격 인하로 판매량 증가",
  "기부금 세액공제 확대 추진",
  "국제유가 급등으로 운송비 부담",
  "주가 상승에 펀드 수익률 개선",
  "은행 신탁으로 상속 자산 관리",
  "탄소배출권 매입 확대",
  "전력망 투자, 재원 마련 논의",
  "공공기관 통합으로 규모의 경제 달성",
  "20조원 투입…대기업이 해외 경쟁사를 인수한 이유",
];
const negative = [
  "[부고] 반도체기업 대표 부친상",
  "[인사] 금융투자회사 임원 명단",
  "AI로 집 안 조명 켜는 방법",
  "유명 배우가 추천한 맛집",
  "술 마신 다음 날 해장 비결",
  "아이돌 열애 인정",
  "유명인이 선택한 200만원 선물세트",
  "대기업 회장 학교에 10억원 쾌척",
  "금융그룹 봉사활동 진행",
  "반도체기업 창립 기념 해커톤",
  "카페 팝업 방문객 줄 섰다",
  "건강한 다이어트 레시피",
  "축구 국가대표 결승 진출",
  "경제신문 추천 주말 여행지",
  "배송기사가 차량 화재 진압",
  "신제품 출시…한정판 사러 오세요",
  "공유가 추천한 여행지",
  "공주가 사랑한 디저트",
  "추적자 드라마 주연 배우 공개",
  "초등학생, 학교에서 상장 받았다",
  "테크기업 새 AI 모델 공개",
  "기업명과 30억원만 나온 소식",
];
for (const title of positive) test("경제 기사 유지: " + title, () => {
  assert.equal(filter.isEconomicNews({ title }), true);
});
for (const title of negative) test("비경제 기사 제외: " + title, () => {
  assert.equal(filter.isEconomicNews({ title }), false);
});

test("불명확한 제목은 경제적 요약 근거로 보완한다", () => {
  assert.equal(filter.isEconomicNews({
    title: "사장님들이 떠나는 이유", description: "<p>임대료 상승으로 폐업이 늘었다.</p>",
  }), true);
});
test("부고/홍보 기사의 기업 소개는 통과 근거로 쓰지 않는다", () => {
  for (const title of ["[부고] 기업 대표 모친상", "기업 창립 기념 봉사활동"]) {
    assert.equal(filter.isEconomicNews({ title, description: "이 회사의 매출과 영업이익이 증가했다." }), false);
  }
});
test("숫자 엔티티와 CDATA/HTML 요약을 정규화한다", () => {
  const text = filter.rssNewsText("<item><description><![CDATA[<p>&#44552;&#47532; 인하</p>]]></description></item>", "description");
  assert.equal(text, "금리 인하");
  assert.equal(filter.isEconomicNews({ title: "&#44552;&#47532; 인하" }), true);
  assert.equal(filter.rssNewsText("<content:encoded><![CDATA[환율 급등]]></content:encoded>", "content:encoded"), "환율 급등");
});
test("기사 근거가 없으면 차단하고 스크립트의 키워드는 무시한다", () => {
  assert.equal(filter.isEconomicNews({ title: "" }), false);
  assert.equal(filter.isEconomicNews({ title: "주말 나들이", description: "<script>const keyword='금리';</script>" }), false);
});

const fixture = "<rss><channel>" + [
  ...Array.from({ length: 12 }, (_, i) => ({ title: "아이돌 결혼식 소식 " + i, id: i })),
  ...Array.from({ length: 10 }, (_, i) => ({ title: "반도체 영업이익 증가 " + i, id: i + 20 })),
].map(({title, id}) => '<item><title><![CDATA[' + title + ']]></title><link>https://www.hankyung.com/article/' + id + '</link><pubDate>Fri, 04 Sep 2026 00:00:00 GMT</pubDate></item>').join("") + "</channel></rss>";
const filterMock = { "@/lib/economicNewsFilter": filter };
const xmlResponse = { ok: true, text: async () => fixture };

test("홈 RSS는 필터 적용 후 최대 8건을 채운다", async () => {
  const home = loadTs("lib/newsData.ts", filterMock, { fetch: async () => xmlResponse });
  const rows = await home.fetchHankyungNews("economy");
  assert.equal(rows.length, 8);
  assert.ok(rows.every(row => row.title.startsWith("반도체")));
});
test("rss2json 대체 경로도 동일한 필터를 사용한다", async () => {
  const home = loadTs("lib/newsData.ts", filterMock, { fetch: async url => String(url).includes("rss2json")
    ? { ok: true, json: async () => ({ status: "ok", items: [
      { title: "유명인이 고른 맛집", link: "https://www.hankyung.com/article/1", categories: ["경제"] },
      { title: "여행업계 매출 증가", link: "https://www.hankyung.com/article/2", categories: ["여행"], pubDate: "2026-09-04T00:00:00Z" },
    ] }) } : { ok: false } });
  const rows = await home.fetchHankyungNews("economy");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "여행업계 매출 증가");
});
test("HTML 대체 경로에서 인기 연예 기사가 재유입되지 않는다", async () => {
  const home = loadTs("lib/newsData.ts", filterMock, { fetch: async url => url.endsWith("/economy")
    ? { ok: true, text: async () => '<a href="/article/1">아이돌 열애 소식</a><a href="/article/2">금리 인하 결정</a>' }
    : { ok: false } });
  const rows = await home.fetchHankyungNews("economy");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "금리 인하 결정");
});
test("한경 목록 API의 경제 피드에도 필터를 적용한다", async () => {
  const route = loadTs("app/api/hankyung-articles/route.ts", {
    ...filterMock,
    "next/server": { NextResponse: { json: data => data } },
    "@/lib/supabaseInsightDb": { getInsightSupabase: () => ({}) },
    "@/lib/safeRemoteFetch": { safeRemoteFetch: async () => xmlResponse },
  });
  const result = await route.GET({ nextUrl: new URL("https://localhost/api/hankyung-articles?category=economy") });
  assert.equal(result.articles.economy.length, 10);
  assert.ok(result.articles.economy.every(row => row.title.startsWith("반도체")));
});
test("통합 인사이트는 필터링·중복 제거된 뉴스만 반환한다", async () => {
  const live = loadTs("lib/liveInsightSources.ts", {
    ...filterMock,
    "@/lib/safeRemoteFetch": { safeRemoteFetch: async url =>
      url.includes("hankyung.com") ? xmlResponse : { ok: false } },
  });
  const result = await live.loadLiveInsightSources();
  assert.equal(result.news.length, 10);
  assert.ok(result.news.every(row => row.title.startsWith("반도체")));
});
test("필터 결과가 0건이어도 비경제 기사로 대체하지 않는다", async () => {
  const home = loadTs("lib/newsData.ts", filterMock, { fetch: async () => ({
    ok: true,
    text: async () => '<rss><item><title>아이돌 열애</title><link>https://www.hankyung.com/article/1</link></item></rss>',
    json: async () => ({ status: "ok", items: [{ title: "아이돌 열애", link: "https://www.hankyung.com/article/1" }] }),
  }) });
  assert.equal((await home.fetchHankyungNews("economy")).length, 0);
});
