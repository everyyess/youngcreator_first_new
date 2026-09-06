import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const cookieName = "youngcreator-sb-access-token";

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  const { accessToken } = await req.json() as { accessToken?: string };
  if (!url || !key || !accessToken) return NextResponse.json({ ok: false }, { status: 400 });
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return NextResponse.json({ ok: false }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, accessToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 3600 });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
