import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const executableCandidates = [
  process.env.CHROME_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const executablePath = executableCandidates.find((candidate) => fs.existsSync(candidate));

if (!executablePath) {
  throw new Error("Chrome 또는 Edge 실행 파일을 찾을 수 없습니다.");
}

async function clickButton(page, label) {
  const buttons = await page.$$("button");
  for (const button of buttons) {
    const text = await button.evaluate((element) => element.textContent?.trim() ?? "");
    if (text === label || text.endsWith(label)) {
      await button.click();
      return;
    }
  }
  throw new Error(`버튼을 찾을 수 없습니다: ${label}`);
}

async function isActiveButton(page, label) {
  return page.evaluate((targetLabel) => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => element.textContent?.trim() === targetLabel);
    return Boolean(button?.className.includes("text-white"));
  }, label);
}

async function activeInnerLabel(page) {
  return page.evaluate(() => {
    const labels = ["리밸런싱(주식)", "리밸런싱(상품)", "리밸런싱 히스토리"];
    return labels.find((label) => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((element) => element.textContent?.trim() === label);
      return button?.className.includes("text-white");
    }) ?? null;
  });
}

async function topLevelLabels(page) {
  return page.evaluate(() => {
    const nav = document.querySelector("nav[data-consultation-lock-exempt='true']");
    return Array.from(nav?.querySelectorAll("button") ?? [])
      .map((button) => button.textContent?.replace(/^\d+/, "").trim() ?? "")
      .filter(Boolean);
  });
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const pbPage = await browser.newPage();
  const customerPage = await browser.newPage();
  const customerMutations = [];

  customerPage.on("request", (request) => {
    const method = request.method();
    const url = request.url();
    const isSupabaseRestMutation = /\.supabase\.co\/rest\/v1\//.test(url)
      && !["GET", "HEAD", "OPTIONS"].includes(method);
    if (isSupabaseRestMutation) {
      customerMutations.push({ method, url });
    }
  });

  await Promise.all([
    pbPage.goto(`${baseUrl}/consultation/tab3`, { waitUntil: "domcontentloaded" }),
    customerPage.goto(`${baseUrl}/customer-maintab/tab3`, { waitUntil: "domcontentloaded" }),
  ]);
  await Promise.all([
    pbPage.waitForSelector("nav[data-consultation-lock-exempt='true']"),
    customerPage.waitForSelector("nav[data-consultation-lock-exempt='true']"),
  ]);

  assert.deepEqual(await topLevelLabels(customerPage), [
    "고객 성향 분석",
    "기존 포트폴리오 분석",
    "신규 포트폴리오 생성",
    "포트폴리오 비교",
  ]);
  // PB 자체의 비동기 Supabase 복원이 끝난 뒤 현재 활성 탭을 기준선으로 삼는다.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const pbBaseline = await activeInnerLabel(pbPage);
  assert.ok(pbBaseline, "PB의 활성 TAB3 내부 탭을 확인할 수 없습니다.");
  const customerTarget = ["리밸런싱(주식)", "리밸런싱(상품)", "리밸런싱 히스토리"]
    .find((label) => label !== pbBaseline);
  assert.ok(customerTarget);
  customerMutations.length = 0;

  await clickButton(customerPage, customerTarget);
  await customerPage.waitForFunction((targetLabel) => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => element.textContent?.trim() === targetLabel);
    return button?.className.includes("text-white");
  }, {}, customerTarget);
  await new Promise((resolve) => setTimeout(resolve, 800));

  assert.equal(await activeInnerLabel(pbPage), pbBaseline);
  assert.equal(new URL(pbPage.url()).pathname, "/consultation/tab3");
  assert.deepEqual(customerMutations, []);

  await clickButton(customerPage, "포트폴리오 비교");
  await customerPage.waitForFunction(() => location.pathname === "/customer-maintab/tab4");
  assert.equal(new URL(pbPage.url()).pathname, "/consultation/tab3");
  assert.deepEqual(customerMutations, []);

  const legacyPage = await browser.newPage();
  await legacyPage.goto(`${baseUrl}/customer-maintab/tab5`, { waitUntil: "domcontentloaded" });
  await legacyPage.waitForFunction(() => location.pathname === "/customer-maintab/tab3");
  assert.equal(new URL(legacyPage.url()).searchParams.get("innerTab"), "product-rebalancing");
  assert.equal(await isActiveButton(legacyPage, "리밸런싱(상품)"), true);

  console.log("PASS: 고객 상담실은 신형 4탭 구조입니다.");
  console.log("PASS: 고객 내부/상위 탭 조작은 PB 화면과 URL을 변경하지 않습니다.");
  console.log("PASS: 고객 탭 조작 중 PB 공유 테이블 쓰기 요청이 발생하지 않았습니다.");
  console.log("PASS: 구버전 customer tab5 경로는 신형 tab3 상품 탭으로 이동합니다.");
} finally {
  await browser.close();
}
