"use client";

import type { AppState, ConsultationSessionRecord, CustomerId } from "./maintab/CustomerContext";

export type ConsultationStatus = "draft" | "active" | "completed";
export type ConsultationSession = ConsultationSessionRecord & {
  status: ConsultationStatus;
};

export type ActiveConsultation = {
  sessionId: string;
  customerId: CustomerId;
  startedAt: string;
  returnPath: string;
};

export const activeConsultationStorageKey = "samsung-vvip-active-consultation-session-v1";
export const consultationTimerEventName = "samsung-vvip-consultation-timer";
export const maxConsultationSeconds = 2 * 60 * 60;
export const autoEndedMessage =
  "?곷떞 醫낅즺 踰꾪듉???꾨Ⅴ吏 ?딆븘 理쒕? ?쒓컙(2?쒓컙)?쇰줈 湲곕줉?섏뿀?듬땲?? ?ㅼ젣 ?곷떞 ?쒓컙???낅젰?댁＜?몄슂.";

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function currentDateTimeLocal() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createConsultationSession(customerId: CustomerId): ConsultationSession {
  const now = new Date().toISOString();
  return {
    id: createSessionId(),
    customerId,
    title: "",
    date: currentDateTimeLocal(),
    duration: "",
    durationSeconds: 0,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeConsultationSessions(value: unknown, fallbackCustomerId?: CustomerId): ConsultationSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === "object" ? item as Partial<ConsultationSession> : null))
    .filter((item): item is Partial<ConsultationSession> => Boolean(item?.id))
    .map((item) => {
      const status: ConsultationStatus =
        item.status === "active" || item.status === "completed" || item.status === "draft" ? item.status : "draft";
      const customerId = (typeof item.customerId === "string" && item.customerId) || fallbackCustomerId || "";
      return {
        id: String(item.id),
        customerId,
        title: typeof item.title === "string" ? item.title : "",
        date: typeof item.date === "string" ? item.date : todayDate(),
        duration: typeof item.duration === "string" ? item.duration : "",
        durationSeconds: typeof item.durationSeconds === "number" && Number.isFinite(item.durationSeconds) ? item.durationSeconds : 0,
        status,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
        summarySnapshot: item.summarySnapshot,
        autoEnded: Boolean(item.autoEnded),
        autoEndedMessage: typeof item.autoEndedMessage === "string" ? item.autoEndedMessage : "",
      };
    })
    .filter((item) => item.customerId);
}

export function getCustomerSessions(state?: Partial<AppState> | null): ConsultationSession[] {
  return normalizeConsultationSessions(state?.consultationSessions);
}

export function sortSessionsNewest(a: ConsultationSession, b: ConsultationSession) {
  return `${b.date || ""}${b.updatedAt || ""}`.localeCompare(`${a.date || ""}${a.updatedAt || ""}`);
}

export function displaySessionTitle(title: string) {
  return title.trim() || "상담 제목을 입력해주세요.";
}

export function displayKoreanDate(value: string) {
  if (!value) return "날짜 미입력";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function readActiveConsultation(): ActiveConsultation | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(activeConsultationStorageKey) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.sessionId !== "string" || typeof parsed.customerId !== "string" || typeof parsed.startedAt !== "string") return null;
    return {
      sessionId: parsed.sessionId,
      customerId: parsed.customerId,
      startedAt: parsed.startedAt,
      returnPath: typeof parsed.returnPath === "string" ? parsed.returnPath : "/maintab/tab1",
    };
  } catch {
    return null;
  }
}

export function writeActiveConsultation(active: ActiveConsultation | null) {
  if (typeof window === "undefined") return;
  if (active) window.localStorage.setItem(activeConsultationStorageKey, JSON.stringify(active));
  else window.localStorage.removeItem(activeConsultationStorageKey);
  window.dispatchEvent(new Event(consultationTimerEventName));
}

export function getElapsedSeconds(active: ActiveConsultation | null, now = Date.now()) {
  if (!active) return 0;
  const startedAt = new Date(active.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.min(maxConsultationSeconds, Math.floor((now - startedAt) / 1000)));
}

export function formatTimer(seconds: number) {
  const clamped = Math.max(0, Math.min(maxConsultationSeconds, Math.floor(seconds)));
  const h = Math.floor(clamped / 3600).toString().padStart(2, "0");
  const m = Math.floor((clamped % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(clamped % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function formatDurationLabel(seconds: number) {
  const clamped = Math.max(0, Math.min(maxConsultationSeconds, Math.floor(seconds)));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.max(1, Math.round((clamped % 3600) / 60));
  if (hours <= 0) return `${minutes}분`;
  if (minutes <= 0 || minutes === 60) return `${hours + (minutes === 60 ? 1 : 0)}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function finishSession(session: ConsultationSession, seconds: number, autoEnded = false): ConsultationSession {
  const durationSeconds = Math.max(0, Math.min(maxConsultationSeconds, Math.floor(seconds)));
  return {
    ...session,
    status: "completed",
    durationSeconds,
    duration: formatDurationLabel(durationSeconds),
    autoEnded,
    autoEndedMessage: autoEnded ? autoEndedMessage : "",
    updatedAt: new Date().toISOString(),
  };
}

