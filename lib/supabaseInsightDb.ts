import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export type InsightSupabaseFailure = "env" | "session";

export function getInsightSupabaseResult(
  req: NextRequest,
): { client: SupabaseClient } | { client: null; reason: InsightSupabaseFailure } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  // 환경변수 누락과 로그인 세션 누락을 구분해야 배포 담당자가 어디를 고쳐야 할지 알 수 있다.
  if (!url || !key) return { client: null, reason: "env" };
  const token = req.cookies.get("youngcreator-sb-access-token")?.value;
  if (!token) return { client: null, reason: "session" };
  return {
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  };
}

export function getInsightSupabase(req: NextRequest): SupabaseClient | null {
  const result = getInsightSupabaseResult(req);
  return result.client;
}

export function insightDbUnavailable(reason: InsightSupabaseFailure = "session") {
  return {
    error:
      reason === "env"
        ? "서버에 Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)가 없습니다. Vercel 환경변수 설정 후 재배포가 필요합니다."
        : "PB 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.",
  };
}

export function formatSupabaseError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}
