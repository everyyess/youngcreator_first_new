import { createClient } from "@supabase/supabase-js";

type ChangePasswordPayload = {
  role?: "pb" | "customer";
  identifier?: string;
  name?: string;
  password?: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonError("비밀번호 변경을 위해 SUPABASE_SERVICE_ROLE_KEY 서버 환경변수가 필요합니다.", 501);
  }

  const payload = await request.json().catch(() => null) as ChangePasswordPayload | null;
  const role = payload?.role;
  const identifier = payload?.identifier?.trim();
  const name = payload?.name?.trim();
  const password = payload?.password ?? "";

  if ((role !== "pb" && role !== "customer") || !identifier || !name || password.length < 6) {
    return jsonError("입력값을 확인해주세요.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const idColumn = role === "pb" ? "employee_id" : "user_id";
  const { data: profile, error: profileError } = await admin
    .from("auth_profiles")
    .select("id,name")
    .eq("role", role)
    .eq(idColumn, identifier)
    .eq("name", name)
    .maybeSingle();

  if (profileError) return jsonError(profileError.message, 500);
  const userId = (profile as { id?: string } | null)?.id;
  if (!userId) return jsonError("계정 정보를 찾을 수 없습니다.", 404);

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return jsonError(error.message, 500);

  return Response.json({ ok: true });
}
