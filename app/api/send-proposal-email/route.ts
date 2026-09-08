import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const customerId = typeof payload.customerId === "string" ? payload.customerId.trim() : "";
    const pdfBase64 = typeof payload.pdfBase64 === "string" ? payload.pdfBase64.trim() : "";
    const fileName = typeof payload.fileName === "string" && payload.fileName.trim() ? payload.fileName.trim() : "proposal.pdf";
    const subject = typeof payload.subject === "string" && payload.subject.trim() ? payload.subject.trim() : "[\\uC0BC\\uC131\\uC99D\\uAD8C] \\uACE0\\uAC1D\\uB2D8 \\uC81C\\uC548\\uC11C";

    if (!customerId) return NextResponse.json({ error: "\\uACE0\\uAC1D ID\\uAC00 \\uC5C6\\uC2B5\\uB2C8\\uB2E4." }, { status: 400 });
    if (!pdfBase64) return NextResponse.json({ error: "\\uCCA8\\uBD80\\uD560 PDF\\uAC00 \\uC5C6\\uC2B5\\uC5C6\uB2C8\uB2E4\\uB2E4." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ error: "Supabase \\uC11C\\uBC84 \\uD658\\uACBD\\uBCC0\\uC218\\uAC00 \\uC124\\uC815\\uB418\\uC9C0 \\uC54A\\uC558\\uC2B5\\uB2C8\\uB2E4." }, { status: 500 });
    const brevoApiKey = process.env.BREVO_API_KEY?.trim();
    if (!brevoApiKey) return NextResponse.json({ error: "BREVO_API_KEY\\uAC00 \\uC124\\uC815\\uB418\\uC9C0 \\uC54A\\uC558\\uC2B5\\uB2C8\\uB2E4." }, { status: 500 });

    const { data: customer, error: customerError } = await supabase
      .from("auth_profiles")
      .select("customer_id, name, email")
      .eq("customer_id", customerId)
      .eq("role", "customer")
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return NextResponse.json({ error: "\\uACE0\\uAC1D\\uC744 \\uCC3E\\uC744 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4." }, { status: 404 });
    if (!customer.email) return NextResponse.json({ error: (customer.name ?? "\\uD574\\uB2F9 \\uACE0\\uAC1D") + "\\uC758 \\uC774\\uBA54\\uC77C\\uC774 \\uC5C6\\uC2B5\\uB2C8\\uB2E4." }, { status: 400 });

    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    if (!pdfBuffer.length) return NextResponse.json({ error: "\\uC62C\\uBC14\\uB978 PDF\\uD30C\\uC77C\\uC774 \\uC544\\uB2D9\\uB2C8\\uB2E4." }, { status: 400 });

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "api-key": brevoApiKey, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Sodapop", email: "everyyess@gmail.com" },
        to: [{ email: customer.email, name: customer.name ?? "\\uACE0\\uAC1D" }],
        subject,
        htmlContent: "<div style=\"font-family:Arial,sans-serif;line-height:1.7;color:#222;\"><p>" + (customer.name ?? "\\uACE0\\uAC1D") + " \\uACE0\\uAC1D\\uB2D8, \\uC548\\uB155\\uD558\\uC138\\uC694.</p><p>\\uC81C\\uC548\\uC11C PDF\\uB97C \\uCCA8\\uBD80\\uD574 \\uB4DC\\uB9BD\\uB2C8\\uB2E4.</p></div>",
        attachment: [{ name: fileName, content: pdfBuffer.toString("base64") }],
      }),
    });
    const raw = await response.text();
    let result: Record<string, unknown> = {};
    try { result = JSON.parse(raw) as Record<string, unknown>; } catch { result = { raw: raw.slice(0, 1000) }; }
    if (!response.ok) {
      console.error("[send-proposal-email] Brevo failed", { customerId, status: response.status, statusText: response.statusText, response: result });
      return NextResponse.json({ error: typeof result.message === "string" ? result.message : "\\uC81C\\uC548\\uC11C \\uBA54\\uC77C \\uC804\\uC1A1\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.", providerStatus: response.status }, { status: response.status === 429 ? 429 : 500 });
    }
    return NextResponse.json({ ok: true, customerId: customer.customer_id, customerName: customer.name, email: customer.email, messageId: result.messageId ?? null, pdfSize: pdfBuffer.length });
  } catch (error) {
    console.error("[send-proposal-email] error", { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, cause: error instanceof Error ? error.cause : undefined });
    return NextResponse.json({ error: error instanceof Error ? error.message : "\\uC81C\\uC548\\uC11C \\uBA54\\uC77C \\uC804\\uC1A1 \\uC911 \\uC624\\uB958\\uAC00 \\uBC1C\\uC0DD\\uD588\\uC2B5\\uB2C8\\uB2E4." }, { status: 500 });
  }
}