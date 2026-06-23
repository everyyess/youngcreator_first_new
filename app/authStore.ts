"use client";

import { createClient } from "@supabase/supabase-js";
import { customerStorage, type CustomerProfile } from "./maintab/CustomerContext";

export type AuthRole = "pb" | "customer";

export type AuthProfile = {
  id?: string;
  role: AuthRole;
  name: string;
  email: string;
  employee_id?: string;
  user_id?: string;
  customer_id?: string;
  birth_date?: string;
  pb_employee_id?: string;
  last_login_at?: string;
};

export type PbSession = {
  role: "pb";
  name: string;
  employeeId: string;
  email: string;
  lastLoginAt?: string;
};

export type CustomerSession = {
  role: "customer";
  name: string;
  userId: string;
  email: string;
  customerId: string;
  birthDate: string;
  pbName?: string;
  lastLoginAt?: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const authSupabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const pbSessionKey = "samsung-vvip-pb-session-v2";
const customerSessionKey = "samsung-vvip-customer-session-v2";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeJson(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function toAuthEmail(value: string) {
  const raw = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  const safe = encodeURIComponent(raw || `demo-${Date.now()}`).replace(/%/g, "_").toLowerCase();
  return `${safe}@demo.local`;
}

async function requestAuthRegistration(profile: AuthProfile, password: string) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, password }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(result?.message ?? "계정 생성에 실패했습니다.");
  }
}

function normalizeBirth(value: string) {
  return value.replace(/[^\d]/g, "").slice(0, 8);
}

function profileBirth(profile: CustomerProfile) {
  return normalizeBirth(profile.birth_year ?? profile.birthYear ?? "");
}

function profileName(profile: CustomerProfile) {
  return profile.name?.trim() || profile.fallbackName?.trim() || "";
}

async function upsertAuthProfile(profile: AuthProfile) {
  if (!authSupabase) throw new Error("Supabase is not configured.");
  const payload = {
    ...profile,
    updated_at: new Date().toISOString(),
  };
  const { error } = profile.id
    ? await authSupabase.from("auth_profiles").update(payload).eq("id", profile.id)
    : await authSupabase.from("auth_profiles").insert(payload);
  if (error) throw error;
}

async function selectAuthProfile(filters: Partial<AuthProfile>) {
  if (!authSupabase) throw new Error("Supabase is not configured.");
  let query = authSupabase.from("auth_profiles").select("*").limit(1);
  Object.entries(filters).forEach(([key, value]) => {
    if (value != null && value !== "") query = query.eq(key, value);
  });
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as AuthProfile | null;
}

async function lookupLoginEmail(kind: "pb" | "customer", identifier: string) {
  if (!authSupabase) throw new Error("Supabase is not configured.");
  const fn = kind === "pb" ? "lookup_pb_login_email" : "lookup_customer_login_email";
  const args = kind === "pb" ? { p_employee_id: identifier } : { p_user_id: identifier };
  const { data, error } = await authSupabase.rpc(fn, args);
  if (error) throw error;
  return typeof data === "string" ? data : "";
}

async function lookupPbNameByEmployeeId(employeeId?: string) {
  if (!authSupabase || !employeeId?.trim()) return "";
  const { data, error } = await authSupabase.rpc("lookup_pb_name_by_employee_id", {
    p_employee_id: employeeId.trim(),
  });
  if (error) return "";
  return typeof data === "string" ? data : "";
}

async function findAuthIdentifier(kind: "pb" | "customer", name: string, email: string) {
  if (!authSupabase) throw new Error("Supabase is not configured.");
  const fn = kind === "pb" ? "find_pb_employee_id" : "find_customer_user_id";
  const { data, error } = await authSupabase.rpc(fn, {
    p_name: name.trim(),
    p_email: email.trim(),
  });
  if (error) throw error;
  return typeof data === "string" ? data : "";
}

async function selectCurrentAuthProfile(userId: string) {
  if (!authSupabase) throw new Error("Supabase is not configured.");
  const { data, error } = await authSupabase
    .from("auth_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as AuthProfile | null;
}

export function formatLoginTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export async function findCustomerBySignupInfo(name: string, birthDate: string) {
  const rows = await customerStorage.selectRows();
  const targetName = name.trim();
  const targetBirth = normalizeBirth(birthDate);
  const row = rows?.rows.find((item) => {
    const profile = item.profile as CustomerProfile | undefined;
    const flatName = typeof item.name === "string" ? item.name : "";
    const flatBirth = typeof item.birth_year === "string" ? item.birth_year : "";
    const resolvedName = profile ? profileName(profile) : flatName;
    const resolvedBirth = profile ? profileBirth(profile) : normalizeBirth(flatBirth);
    return resolvedName === targetName && resolvedBirth === targetBirth;
  });
  return {
    customerId: row?.id ?? "",
    pbEmployeeId: row?.pb_employee_id ?? "",
  };
}

export const pbAuthStore = {
  readSession(): PbSession | null {
    return readJson<PbSession | null>(pbSessionKey, null);
  },
  async register(name: string, employeeId: string, email: string, password: string) {
    await requestAuthRegistration({
      role: "pb",
      name,
      email,
      employee_id: employeeId,
    }, password);
  },
  async login(employeeId: string, password: string): Promise<PbSession> {
    if (!authSupabase) throw new Error("Supabase is not configured.");
    const normalizedEmployeeId = employeeId.trim();
    const email = await lookupLoginEmail("pb", normalizedEmployeeId);
    if (!email) throw new Error("등록된 PB 계정을 찾을 수 없습니다.");
    const { data: signInData, error } = await authSupabase.auth.signInWithPassword({ email: toAuthEmail(email), password });
    if (error) throw error;
    const profile = signInData.user?.id ? await selectCurrentAuthProfile(signInData.user.id) : null;
    if (!profile?.email || profile.role !== "pb" || profile.employee_id !== normalizedEmployeeId) throw new Error("등록된 PB 계정을 찾을 수 없습니다.");
    const lastLoginAt = new Date().toISOString();
    await upsertAuthProfile({ ...profile, last_login_at: lastLoginAt });
    const session = { role: "pb" as const, name: profile.name, employeeId: normalizedEmployeeId, email: profile.email, lastLoginAt };
    writeJson(pbSessionKey, session);
    return session;
  },
  async findEmployeeId(name: string, email: string) {
    return findAuthIdentifier("pb", name, email);
  },
  async logout() {
    removeJson(pbSessionKey);
    if (authSupabase) await authSupabase.auth.signOut().catch(() => undefined);
  },
};

export const customerAuthStore = {
  readSession(): CustomerSession | null {
    return readJson<CustomerSession | null>(customerSessionKey, null);
  },
  async register(name: string, birthDate: string, email: string, userId: string, password: string) {
    const signupInfo = await findCustomerBySignupInfo(name, birthDate);
    const customerId = signupInfo.customerId;
    if (!customerId) throw new Error("입력하신 고객 정보를 확인할 수 없습니다. 담당 PB에게 문의해 주세요.");
    const normalizedBirth = normalizeBirth(birthDate);
    const pbSession = readJson<PbSession | null>(pbSessionKey, null);
    await requestAuthRegistration({
      role: "customer",
      name,
      email,
      user_id: userId,
      customer_id: customerId,
      birth_date: normalizedBirth,
      pb_employee_id: signupInfo.pbEmployeeId || pbSession?.employeeId,
    }, password);
  },
  async login(userId: string, password: string): Promise<CustomerSession> {
    if (!authSupabase) throw new Error("Supabase is not configured.");
    const normalizedUserId = userId.trim();
    const email = await lookupLoginEmail("customer", normalizedUserId);
    if (!email) throw new Error("등록된 고객 계정을 찾을 수 없습니다.");
    const { data: signInData, error } = await authSupabase.auth.signInWithPassword({ email: toAuthEmail(email), password });
    if (error) throw error;
    const profile = signInData.user?.id ? await selectCurrentAuthProfile(signInData.user.id) : null;
    if (!profile?.email || !profile.customer_id || profile.role !== "customer" || profile.user_id !== normalizedUserId) throw new Error("등록된 고객 계정을 찾을 수 없습니다.");
    const lastLoginAt = new Date().toISOString();
    await upsertAuthProfile({ ...profile, last_login_at: lastLoginAt });
    const pbName = await lookupPbNameByEmployeeId(profile.pb_employee_id);
    const session = {
      role: "customer" as const,
      name: profile.name,
      userId: normalizedUserId,
      email: profile.email,
      customerId: profile.customer_id,
      birthDate: profile.birth_date ?? "",
      pbName: pbName || profile.pb_employee_id,
      lastLoginAt,
    };
    writeJson(customerSessionKey, session);
    return session;
  },
  async findUserId(name: string, email: string) {
    return findAuthIdentifier("customer", name, email);
  },
  async logout() {
    removeJson(customerSessionKey);
    if (authSupabase) await authSupabase.auth.signOut().catch(() => undefined);
  },
};

export async function requestPasswordChange(role: AuthRole, identifier: string, name: string, password: string) {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, identifier, name, password }),
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) throw new Error(result?.message ?? "비밀번호 변경에 실패했습니다.");
}
