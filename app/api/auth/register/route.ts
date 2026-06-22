import { createClient } from "@supabase/supabase-js";

type RegisterProfile = {
  role?: "pb" | "customer";
  name?: string;
  email?: string;
  employee_id?: string;
  user_id?: string;
  customer_id?: string;
  birth_date?: string;
  pb_employee_id?: string;
};

type RegisterPayload = {
  profile?: RegisterProfile;
  password?: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, message }, { status });
}

function toAuthEmail(value: string, fallbackSeed: string) {
  const raw = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  const safe = encodeURIComponent(raw || fallbackSeed || `demo-${Date.now()}`).replace(/%/g, "_").toLowerCase();
  return `${safe}@demo.local`;
}

function normalizeMessage(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("email rate limit")) return "인증 메일을 보내지 않는 데모 가입 방식으로 처리 중입니다. 잠시 후 다시 시도해 주세요.";
  if (lower.includes("already registered") || lower.includes("already been registered")) return "이미 등록된 계정입니다.";
  return message;
}

function isAlreadyRegistered(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("already registered") || lower.includes("already been registered");
}

type AuthUserListClient = {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: Array<{ id: string; email?: string | null }> };
        error: Error | null;
      }>;
    };
  };
};

async function findAuthUserByEmail(admin: AuthUserListClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

export async function POST(request: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonError("회원가입을 위해 SUPABASE_SERVICE_ROLE_KEY 서버 환경변수가 필요합니다.", 501);
  }

  const payload = await request.json().catch(() => null) as RegisterPayload | null;
  const profile = payload?.profile;
  const password = payload?.password ?? "";

  if (!profile || (profile.role !== "pb" && profile.role !== "customer") || !profile.name?.trim() || password.length < 6) {
    return jsonError("입력값을 확인해주세요.");
  }

  if (profile.role === "pb" && !profile.employee_id?.trim()) return jsonError("PB 사번을 입력해주세요.");
  if (profile.role === "customer" && (!profile.user_id?.trim() || !profile.customer_id?.trim())) return jsonError("고객 ID를 확인해주세요.");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const idColumn = profile.role === "pb" ? "employee_id" : "user_id";
  const idValue = profile.role === "pb" ? profile.employee_id?.trim() : profile.user_id?.trim();
  const { data: existingProfile, error: existingProfileError } = await admin
    .from("auth_profiles")
    .select("id")
    .eq("role", profile.role)
    .eq(idColumn, idValue)
    .maybeSingle();

  if (existingProfileError) return jsonError(existingProfileError.message, 500);
  if ((existingProfile as { id?: string } | null)?.id) return jsonError("이미 등록된 계정입니다.", 409);

  const authEmail = toAuthEmail(profile.email ?? "", `${profile.role}-${idValue}`);
  const userMetadata = {
    role: profile.role,
    name: profile.name.trim(),
    employee_id: profile.employee_id?.trim(),
    user_id: profile.user_id?.trim(),
    customer_id: profile.customer_id?.trim(),
    birth_date: profile.birth_date?.trim(),
  };

  let authUserId = "";
  let createdAuthUser = false;
  const { data, error } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (error) {
    if (!isAlreadyRegistered(error.message)) return jsonError(normalizeMessage(error.message), 500);
    const orphanUser = await findAuthUserByEmail(admin, authEmail);
    if (!orphanUser?.id) return jsonError(normalizeMessage(error.message), 409);
    const { data: orphanProfile, error: orphanProfileError } = await admin
      .from("auth_profiles")
      .select("id")
      .eq("id", orphanUser.id)
      .maybeSingle();
    if (orphanProfileError) return jsonError(orphanProfileError.message, 500);
    if ((orphanProfile as { id?: string } | null)?.id) return jsonError(normalizeMessage(error.message), 409);
    authUserId = orphanUser.id;
    const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (updateError) return jsonError(updateError.message, 500);
  } else {
    authUserId = data.user?.id ?? "";
    createdAuthUser = true;
  }

  const { error: insertError } = await admin.from("auth_profiles").insert({
    id: authUserId,
    role: profile.role,
    name: profile.name.trim(),
    email: profile.email?.trim() ?? "",
    employee_id: profile.employee_id?.trim(),
    user_id: profile.user_id?.trim(),
    customer_id: profile.customer_id?.trim(),
    birth_date: profile.birth_date?.trim(),
    pb_employee_id: profile.pb_employee_id?.trim(),
    updated_at: new Date().toISOString(),
  });

  if (insertError) {
    if (createdAuthUser && authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    if (insertError.code === "23505") return jsonError("?대? ?깅줉??怨꾩젙?낅땲??", 409);
    return jsonError(insertError.message, 500);
  }
  return Response.json({ ok: true });
}
