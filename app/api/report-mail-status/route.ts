import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase 서버 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const pbId = request.nextUrl.searchParams.get("pbId")?.trim() || "";

    let query = supabase
      .from("market_report_mail_sends")
      .select("report_type, report_date, sent_at, success_count, failed_count, skipped_count")
      .in("report_type", ["us", "kr"])
      .order("sent_at", { ascending: false });

    if (pbId) {
      query = query.eq("pb_id", pbId);
    } else {
      query = query.is("pb_id", null);
    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = data ?? [];

    return NextResponse.json({
      ok: true,
      sends: {
        us: rows.find((row) => row.report_type === "us") ?? null,
        kr: rows.find((row) => row.report_type === "kr") ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "메일 전송 상태 조회 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase 서버 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const payload = await request.json();

    const reportType =
      payload.reportType === "us" || payload.reportType === "kr"
        ? payload.reportType
        : null;

    if (!reportType) {
      return NextResponse.json(
        { error: "reportType은 us 또는 kr이어야 합니다." },
        { status: 400 },
      );
    }

    const pbId =
      typeof payload.pbId === "string" && payload.pbId.trim()
        ? payload.pbId.trim()
        : null;

    const reportDate = typeof payload.reportDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.reportDate)
      ? payload.reportDate
      : null;

    if (!reportDate) {
      return NextResponse.json({ error: "reportDate는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    }

    const insertPayload = {
      pb_id: pbId,
      report_type: reportType,
      report_date: reportDate,
      success_count: Number(payload.successCount) || 0,
      failed_count: Number(payload.failedCount) || 0,
      skipped_count: Number(payload.skippedCount) || 0,
    };

    const { data, error } = await supabase
      .from("market_report_mail_sends")
      .insert(insertPayload)
      .select("report_type, report_date, sent_at, success_count, failed_count, skipped_count")
      .single();

    if (error) {
      console.error("[report-mail-status] POST Supabase insert failed", { error, insertPayload });
      return NextResponse.json({
        error: "\uBA54\uC77C \uC804\uC1A1 \uC0C1\uD0DC \uC800\uC7A5 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
        detail: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true, send: data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "메일 전송 상태 저장 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
