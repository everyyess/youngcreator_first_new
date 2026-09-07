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
    ${styles}
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
    #market-report-pdf .portfolio-health-radar-pdf {
      break-inside: avoid;
      page-break-inside: avoid;
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
    await page.evaluate(() => {
      document.querySelectorAll<SVGElement>("#market-report-pdf .recharts-surface").forEach((svg) => {
        const container = svg.closest(".recharts-responsive-container") as HTMLElement | null;
        const wrapper = svg.closest(".recharts-wrapper") as HTMLElement | null;
        const chartSection = svg.closest(".portfolio-health-radar-pdf") as HTMLElement | null;
        const chartWidth = chartSection?.clientWidth || document.body.clientWidth || 794;
        if (container) {
          container.style.width = `${chartWidth}px`;
          container.style.maxWidth = `${chartWidth}px`;
        }
        const containerWidth = container?.clientWidth || chartWidth;
        const containerHeight = container?.clientHeight || 255;
        const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
        if (!containerWidth || !containerHeight || viewBox.length !== 4 || viewBox.some(Number.isNaN)) return;

        if (wrapper) {
          wrapper.style.width = `${containerWidth}px`;
          wrapper.style.maxWidth = `${containerWidth}px`;
        }
        svg.setAttribute("width", String(containerWidth));
        svg.setAttribute("height", String(containerHeight));

        // Recharts can retain a huge width when ResponsiveContainer is cloned into print HTML.
        // Keep the chart's center and height, but crop only the invalid horizontal coordinate range.
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
        const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
        if (viewBox.length !== 4 || viewBox.some(Number.isNaN)) continue;

        const [, viewY, viewWidth, viewHeight] = viewBox;
        const width = Math.max(280, Math.min(320, Math.ceil(viewHeight * 1.25)));
        const height = Math.max(1, Math.ceil(viewHeight));
        const center = viewBox[0] + viewWidth / 2;
        const cropViewBox = `${center - width / 2} ${viewY} ${width} ${height}`;
        const svgClone = svg.cloneNode(true) as SVGElement;
        svgClone.setAttribute("width", String(width));
        svgClone.setAttribute("height", String(height));
        svgClone.setAttribute("viewBox", cropViewBox);
        svgClone.setAttribute("style", `display:block;width:${width}px;height:${height}px;overflow:visible`);
        const serialized = new XMLSerializer().serializeToString(svgClone);
        const image = new Image();
        const encodedSvg = btoa(unescape(encodeURIComponent(serialized)));
        image.src = "data:image/svg+xml;base64," + encodedSvg;
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("PDF 레이더 차트 변환에 실패했습니다."));
        });
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF 레이더 차트 캔버스를 만들 수 없습니다.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const replacement = document.createElement("img");
        replacement.src = canvas.toDataURL("image/jpeg", 0.95);
        replacement.alt = "포트폴리오 위험·분산 진단 레이더 차트";
        replacement.style.display = "block";
        replacement.style.width = `${width}px`;
        replacement.style.height = `${height}px`;
        replacement.style.maxWidth = "none";
        replacement.style.flex = "0 0 auto";
        replacement.style.margin = "0 auto";
        await new Promise<void>((resolve) => {
          if (replacement.complete) {
            resolve();
            return;
          }
          replacement.addEventListener("load", () => resolve(), { once: true });
          replacement.addEventListener("error", () => resolve(), { once: true });
        });
        svg.replaceWith(replacement);
      }
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
