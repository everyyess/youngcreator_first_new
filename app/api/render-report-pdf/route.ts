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
    #market-report-pdf .grid,
    #market-report-pdf section {
      min-width: 0 !important;
      max-width: 100% !important;
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
