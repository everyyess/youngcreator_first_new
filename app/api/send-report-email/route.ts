import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function buildPdfHtml(bodyHtml: string, styles: string) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />

  <style>
    ${styles}

    

    @page { size: A4; margin: 64.19px 106.98px; }
    html,
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    #market-report-pdf { width: 100% !important; height: auto !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; box-shadow: none !important; overflow: visible !important; }

    

    #market-report-pdf { width: 100% !important; height: auto !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; box-shadow: none !important; overflow: visible !important; }

    #market-report-pdf > * { padding: 0 !important; break-inside: auto; }
  </style>
</head>

<body>
  ${bodyHtml}
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const brevoApiKey = process.env.BREVO_API_KEY?.trim();

    if (!brevoApiKey) {
      return NextResponse.json(
        { error: "BREVO_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const payload = await request.json();

    const customerId =
      typeof payload.customerId === "string"
        ? payload.customerId.trim()
        : "";

    const subject =
      typeof payload.subject === "string" && payload.subject.trim()
        ? payload.subject.trim()
        : "오늘의 시황 보고서";

    const fileName =
      typeof payload.fileName === "string" && payload.fileName.trim()
        ? payload.fileName.trim()
        : "market-report.pdf";

    const html =
      typeof payload.html === "string"
        ? payload.html
        : "";

    const styles =
      typeof payload.styles === "string"
        ? payload.styles
        : "";

    if (!customerId) {
      return NextResponse.json(
        { error: "customerId가 없습니다." },
        { status: 400 },
      );
    }

    if (!html.trim()) {
      return NextResponse.json(
        { error: "PDF로 변환할 HTML이 없습니다." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase 서버 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const { data: customer, error: customerError } = await supabase
      .from("auth_profiles")
      .select("customer_id, name, email")
      .eq("customer_id", customerId)
      .eq("role", "customer")
      .maybeSingle();

    if (customerError) {
      throw customerError;
    }

    if (!customer) {
      return NextResponse.json(
        { error: "고객을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (!customer.email) {
      return NextResponse.json(
        { error: `${customer.name ?? "해당 고객"}의 이메일이 없습니다.` },
        { status: 400 },
      );
    }

    const executablePath =
      process.env.NODE_ENV === "production"
        ? await chromium.executablePath()
        : process.env.CHROME_EXECUTABLE_PATH ||
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

    browser = await puppeteer.launch({
      args:
        process.env.NODE_ENV === "production"
          ? chromium.args
          : ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    });

    const pdfHtml = buildPdfHtml(html, styles);

    await page.setContent(pdfHtml, {
      waitUntil: "load",
    });

    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      },
    });

    const pdfBuffer = Buffer.from(pdfBytes);
    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: "Sodapop",
          email: "everyyess@gmail.com",
        },
        to: [
          {
            email: customer.email,
            name: customer.name ?? "고객",
          },
        ],
        subject,
        htmlContent: `
          <div style="font-family:Arial,sans-serif;line-height:1.7;color:#222;">
            <p>${customer.name ?? "고객"} 고객님, 안녕하세요.</p>
            <p>오늘의 시황 보고서를 보내드립니다.</p>
            <p>첨부된 PDF를 확인해 주세요.</p>
          </div>
        `,
        attachment: [
          {
            name: fileName,
            content: pdfBuffer.toString("base64"),
          },
        ],
      }),
    });

    const brevoResult = await brevoResponse.json().catch(() => ({}));

    if (!brevoResponse.ok) {
      return NextResponse.json(
        {
          error:
            typeof brevoResult?.message === "string"
              ? brevoResult.message
              : "메일 전송에 실패했습니다.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      customerId: customer.customer_id,
      customerName: customer.name,
      email: customer.email,
      messageId: brevoResult?.messageId ?? null,
      pdfSize: pdfBuffer.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "PDF 생성 또는 메일 전송 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}