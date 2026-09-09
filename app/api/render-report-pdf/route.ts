import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function buildPdfHtml(bodyHtml: string, styles: string) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    /* Pretendard 임베드 — TAB4 제안서 PDF(app/maintab/tab4/PortfolioReportPdf.tsx)가 Font.register()로
       쓰는 것과 동일한 CDN 소스(jsdelivr fonts-archive)를 그대로 재사용한다. 이 라우트는 react-pdf가
       아니라 Puppeteer로 HTML을 그려서 PDF로 인쇄하는 방식이라 폰트 "등록"이 아니라 @font-face로
       선언해야 하고, 아래 POST 핸들러의 document.fonts.ready 대기가 실제 다운로드·임베드를 보장한다.
       전엔 폰트를 전혀 지정하지 않아 로컬(Windows 시스템 한글 폰트)에선 우연히 정상 출력됐지만, Vercel의
       서버리스 Chromium(@sparticuz/chromium)엔 한글 폰트가 아예 없어 텍스트가 깨졌다(2026-09 발견·수정).
       글자 크기·레이아웃은 건드리지 않고 폰트 소스만 추가한다. */
    @font-face {
      font-family: "Pretendard";
      src: url("https://cdn.jsdelivr.net/gh/fonts-archive/Pretendard/Pretendard-Regular.otf") format("opentype");
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: "Pretendard";
      src: url("https://cdn.jsdelivr.net/gh/fonts-archive/Pretendard/Pretendard-Bold.otf") format("opentype");
      font-weight: bold;
      font-style: normal;
    }
    ${styles}
    /* 캡처된 페이지 CSS(위 styles 변수) 뒤에 둬서, 혹시 거기 섞여 있을 다른 font-family 지정보다
       항상 우선하도록 한다 — 이 라우트가 그리는 PDF의 폰트는 언제나 Pretendard여야 한다. */
    html, body, #market-report-pdf {
      font-family: "Pretendard", sans-serif;
    }
    @page { size: A4; margin: 64.19px 106.98px; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    #market-report-pdf {
      width: 100% !important;
      height: auto !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      box-shadow: none !important;
      overflow: visible !important;
    }
    #market-report-pdf > * {
      padding: 0 !important;
      break-inside: auto;
    }
    /* PDF-only adjustment: portfolio table body cells only. */
    #market-report-pdf .portfolio-performance-pdf table tbody td,
    #market-report-pdf .portfolio-performance-pdf table tbody td * {
      font-size: 10pt !important;
      line-height: 1.35 !important;
    }
    #market-report-pdf table {
      break-inside: auto;
      margin-bottom: 8px !important;
    }
    #market-report-pdf table tbody tr {
      break-inside: avoid;
    }
    #market-report-pdf .portfolio-performance-pdf {
      display: block !important;
    }
    #market-report-pdf .portfolio-performance-pdf > section {
      display: block !important;
      margin-bottom: 12px !important;
    }
    #market-report-pdf .portfolio-health-radar-pdf {
      break-inside: avoid;
      page-break-inside: avoid;
      display: block !important;
      margin-top: 12px !important;
    }
    #market-report-pdf svg {
      overflow: visible !important;
    }
    #market-report-pdf .grid,
    #market-report-pdf section,
    #market-report-pdf .recharts-responsive-container,
    #market-report-pdf .recharts-wrapper,
    #market-report-pdf .recharts-surface {
      min-width: 0 !important;
      max-width: 100% !important;
    }
    #market-report-pdf .recharts-responsive-container,
    #market-report-pdf .recharts-wrapper,
    #market-report-pdf .recharts-surface {
      width: 100% !important;
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const payload = await request.json();
    const html = typeof payload?.html === "string" ? payload.html : "";
    const styles = typeof payload?.styles === "string" ? payload.styles : "";

    if (!html.trim()) {
      return NextResponse.json({ error: "PDF로 변환할 HTML이 없습니다." }, { status: 400 });
    }

    const executablePath =
      process.env.NODE_ENV === "production"
        ? await chromium.executablePath()
        : process.env.CHROME_EXECUTABLE_PATH ||
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

    browser = await puppeteer.launch({
      args: process.env.NODE_ENV === "production" ? chromium.args : ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setContent(buildPdfHtml(html, styles), { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.dispatchEvent(new Event("resize"));
      await Promise.all(Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })));
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 레이더 차트 크롭·중앙정렬 — 세션 내내 이 부분을 "더 정확한 중앙정렬"로 여러 번 고쳐봤는데
    // (getBoundingClientRect 기반 자리 이어받기, Puppeteer elementHandle.screenshot(), getBBox 기반
    // 비대칭 크롭 등) 전부 다운로드한 실제 PDF에서 차트가 더 심하게 잘리거나 안 보이는 결과였다.
    // "정중앙은 완벽하지 않아도 됐으니 최소한 전체가 보이기라도 했던" 세션 시작 시점의 원래 로직으로
    // 되돌린다(2026-09) — 조상 요소 너비를 강제한 뒤 viewBox를 기하학적 중심 기준으로 크롭해서
    // canvas로 래스터화하는 방식. 이 부분은 더 이상 손대지 않는다.
    await page.evaluate(() => {
      document.querySelectorAll<SVGElement>("#market-report-pdf .recharts-surface").forEach((svg) => {
        const container = svg.closest(".recharts-responsive-container") as HTMLElement | null;
        const wrapper = svg.closest(".recharts-wrapper") as HTMLElement | null;
        const chartSection = svg.closest(".portfolio-health-radar-pdf") as HTMLElement | null;
        const chartFrame = container?.parentElement?.parentElement as HTMLElement | null;
        const chartFrameStyle = chartFrame ? getComputedStyle(chartFrame) : null;
        const chartPadding = chartFrameStyle ? parseFloat(chartFrameStyle.paddingLeft) + parseFloat(chartFrameStyle.paddingRight) : 0;
        const chartWidth = Math.max(0, (chartFrame?.clientWidth || chartSection?.clientWidth || document.body.clientWidth || 794) - chartPadding);
        if (container) {
          container.style.setProperty("width", `${chartWidth}px`, "important");
          container.style.setProperty("max-width", `${chartWidth}px`, "important");
        }
        const containerWidth = chartWidth;
        const containerHeight = container?.clientHeight || 255;
        const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
        if (!containerWidth || !containerHeight || viewBox.length !== 4 || viewBox.some(Number.isNaN)) return;
        if (wrapper) {
          wrapper.style.width = `${containerWidth}px`;
          wrapper.style.maxWidth = `${containerWidth}px`;
        }
        svg.setAttribute("width", String(containerWidth));
        svg.setAttribute("height", String(containerHeight));
        const [, viewY, viewWidth, viewHeight] = viewBox;
        if (viewWidth > containerWidth * 2) {
          const center = viewBox[0] + viewWidth / 2;
          const cropWidth = Math.max(280, Math.min(320, viewHeight * 1.25));
          svg.setAttribute("viewBox", `${center - cropWidth / 2} ${viewY} ${cropWidth} ${viewHeight}`);
        }
      });
    });
    await page.evaluate(async () => {
      const svgs = Array.from(document.querySelectorAll<SVGElement>("#market-report-pdf .recharts-surface"));
      for (const svg of svgs) {
        const wrapper = svg.closest(".recharts-wrapper") as HTMLElement | null;
        const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
        if (viewBox.length !== 4 || viewBox.some(Number.isNaN)) continue;
        const [, viewY, viewWidth, viewHeight] = viewBox;
        const width = Math.max(280, Math.min(320, Math.ceil(viewHeight * 1.25)));
        const height = Math.max(1, Math.ceil(viewHeight));
        const visualCenter = viewBox[0] + viewWidth / 2;
        const cropViewBox = `${visualCenter - width / 2} ${viewY} ${width} ${height}`;
        const svgClone = svg.cloneNode(true) as SVGElement;
        svgClone.setAttribute("width", String(width));
        svgClone.setAttribute("height", String(height));
        svgClone.setAttribute("viewBox", cropViewBox);
        svgClone.setAttribute("style", `display:block;width:${width}px;height:${height}px;overflow:visible`);
        const serialized = new XMLSerializer().serializeToString(svgClone);
        const image = new Image();
        const encodedSvg = btoa(unescape(encodeURIComponent(serialized)));
        image.src = "data:image/svg+xml;base64," + encodedSvg;
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("PDF radar conversion failed.")); });
        const canvas = document.createElement("canvas");
        canvas.width = width * 2; canvas.height = height * 2;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF radar canvas unavailable.");
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const replacement = document.createElement("img");
        replacement.src = canvas.toDataURL("image/jpeg", 0.95);
        replacement.alt = "포트폴리오 위험·분산 진단 레이더 차트";
        replacement.style.display = "block";
        replacement.style.width = `${width}px`;
        replacement.style.height = `${height}px`;
        replacement.style.maxWidth = "none";
        replacement.style.position = "relative";
        replacement.style.left = "auto";
        replacement.style.top = "auto";
        replacement.style.transform = "none";
        replacement.style.margin = "0 auto";
        if (wrapper) {
          wrapper.style.display = "flex"; wrapper.style.position = "relative"; wrapper.style.justifyContent = "center"; wrapper.style.alignItems = "flex-start"; wrapper.style.width = "100%"; wrapper.style.height = `${height}px`;
        }
        await new Promise<void>((resolve) => { if (replacement.complete) { resolve(); return; } replacement.addEventListener("load", () => resolve(), { once: true }); replacement.addEventListener("error", () => resolve(), { once: true }); });
        svg.replaceWith(replacement);
      }
    });
    await page.evaluate(() => {
      document.querySelectorAll<HTMLImageElement>("#market-report-pdf .portfolio-health-radar-pdf img[alt=\"포트폴리오 위험·분산 진단 레이더 차트\"]").forEach((radar) => {
        const wrapper = radar.closest<HTMLElement>(".recharts-wrapper");
        const container = radar.closest<HTMLElement>(".recharts-responsive-container");
        const chartSection = radar.closest<HTMLElement>(".portfolio-health-radar-pdf");
        const chartFrame = container?.parentElement?.parentElement as HTMLElement | null;
        const chartFrameStyle = chartFrame ? getComputedStyle(chartFrame) : null;
        const chartPadding = chartFrameStyle ? parseFloat(chartFrameStyle.paddingLeft) + parseFloat(chartFrameStyle.paddingRight) : 0;
        if (!wrapper || !container) return;
        const width = Math.max(0, (chartFrame?.clientWidth || chartSection?.getBoundingClientRect().width || container.getBoundingClientRect().width || document.body.clientWidth) - chartPadding);
        wrapper.style.setProperty("width", `${width}px`, "important");
        wrapper.style.setProperty("max-width", `${width}px`, "important");
        wrapper.style.height = `${radar.getBoundingClientRect().height}px`;
        wrapper.style.position = "relative"; wrapper.style.display = "flex"; wrapper.style.justifyContent = "center"; wrapper.style.alignItems = "flex-start";
        radar.style.position = "relative"; radar.style.left = "auto"; radar.style.transform = "none"; radar.style.margin = "0 auto";
      });
    });
    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=market-report.pdf",

        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "PDF 생성에 실패했습니다.",
    }, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }
}
