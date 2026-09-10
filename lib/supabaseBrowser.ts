"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  var __youngcreatorSupabaseClient: SupabaseClient | undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
// Supabase 신규 프로젝트는 anon key 대신 "publishable" key 이름을 기본으로 준다.
// 서버 라우트(lib/supabaseInsightDb, api/auth/insight-session)는 이미 두 이름을 모두
// 받는데 브라우저 클라이언트만 ANON_KEY 하나만 봐서, Vercel에 PUBLISHABLE_KEY만
// 설정돼 있으면 authSupabase가 null이 되고 통합 인사이트 세션이 통째로 막혔다.
const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();

if (typeof window !== "undefined" && (!url || !key)) {
  // 빌드 시 인라인되는 NEXT_PUBLIC_* 값이 비어 있으면 로그인·통합 인사이트가 전부 실패한다.
  // 배포 후 환경변수를 추가했다면 재배포(재빌드)가 필요하다는 신호.
  console.error(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY(또는 PUBLISHABLE_KEY)가 비어 있습니다. " +
      "Vercel 환경변수를 확인하고 재배포하세요.",
  );
}

export const browserSupabase = url && key
  ? (globalThis.__youngcreatorSupabaseClient ??= createClient(url, key))
  : null;
