"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import {
  customerAuthStore,
  pbAuthStore,
  requestPasswordChange,
  type AuthRole,
} from "../authStore";

type ModalMode = "login" | "signup" | "find" | "change";

const inputClass = "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-400";

export default function Hero() {
  const [role, setRole] = useState<AuthRole | null>(null);

  return (
    <>
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-4 py-12 text-center sm:px-6 sm:py-20">
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 85% 65% at 8% 0%, rgba(99,102,241,0.11) 0%, transparent 55%), radial-gradient(ellipse 65% 65% at 98% 100%, rgba(59,130,246,0.18) 0%, transparent 55%), radial-gradient(ellipse 45% 40% at 80% 92%, rgba(139,92,246,0.10) 0%, transparent 50%)",
          }}
        />
        <div className="relative z-10 flex max-w-4xl flex-col items-center">
          <div className="mb-14 inline-flex items-center rounded-full border border-zinc-200 bg-white/60 px-3 py-1 text-sm font-medium text-zinc-800 backdrop-blur-sm">
            <span className="mr-2 flex h-2 w-2 rounded-full bg-blue-600" />
            Samsung Securities × VVIP
          </div>
          <h1 className="mb-9 text-4xl font-black leading-tight text-zinc-900 sm:text-5xl md:text-6xl lg:text-7xl">
            자산 상담의 새로운 기준
            <br />
            <span className="mt-5 block bg-gradient-to-br from-blue-600 to-indigo-600 bg-clip-text text-transparent sm:mt-7">
              PB Advisor Hub
            </span>
          </h1>
          <p className="mb-12 max-w-3xl px-4 text-base leading-relaxed text-zinc-600 sm:text-lg md:text-xl">
            세금 최적화·상품 매칭을 실시간으로.
            <br />
            고객과의 모든 접점에서 한발 앞선 인사이트를 제공합니다.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setRole("pb")}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-blue-600 px-8 text-lg font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
            >
              PB 로그인 <ArrowRight size={20} />
            </button>
            <button
              type="button"
              onClick={() => setRole("customer")}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-blue-200 bg-white px-8 text-lg font-extrabold text-blue-700 shadow-lg shadow-blue-900/5 transition hover:bg-blue-50"
            >
              고객 로그인 <ArrowRight size={20} />
            </button>
          </div>
        </div>
      </div>
      {role ? <LoginModal role={role} onClose={() => setRole(null)} /> : null}
    </>
  );
}

function LoginModal({ role, onClose }: { role: AuthRole; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<ModalMode>("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    employeeId: "",
    email: "",
    password: "",
    passwordConfirm: "",
    birthDate: "",
    userId: "",
  });

  const title = role === "pb" ? "PB 로그인" : "고객 로그인";
  const identifierLabel = role === "pb" ? "사번" : "ID";

  const update = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const resetNotice = () => {
    setError("");
    setMessage("");
  };

  const run = async (task: () => Promise<void>) => {
    resetNotice();
    setBusy(true);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = () => run(async () => {
    if (role === "pb") {
      await pbAuthStore.login(form.employeeId.trim(), form.password);
      router.push("/home");
    } else {
      await customerAuthStore.login(form.userId.trim(), form.password);
      router.push("/customer-home");
    }
  });

  const handleSignup = () => run(async () => {
    if (form.password.length < 6 || form.password !== form.passwordConfirm) {
      throw new Error("비밀번호는 6자리 이상이며 두 입력값이 같아야 합니다.");
    }
    if (role === "pb") {
      await pbAuthStore.register(form.name.trim(), form.employeeId.trim(), form.email.trim(), form.password);
      setMessage("PB 계정이 생성되었습니다. 사번과 비밀번호로 로그인해주세요.");
    } else {
      await customerAuthStore.register(form.name.trim(), form.birthDate.trim(), form.email.trim(), form.userId.trim(), form.password);
      setMessage("고객 계정이 생성되었습니다. ID와 비밀번호로 로그인해주세요.");
    }
    setMode("login");
  });

  const handleFind = () => run(async () => {
    const found = role === "pb"
      ? await pbAuthStore.findEmployeeId(form.name.trim(), form.email.trim())
      : await customerAuthStore.findUserId(form.name.trim(), form.email.trim());
    setMessage(found ? `${identifierLabel}: ${found}` : "일치하는 계정을 찾을 수 없습니다.");
  });

  const handleChangePassword = () => run(async () => {
    if (form.password.length < 6 || form.password !== form.passwordConfirm) {
      throw new Error("새 비밀번호는 6자리 이상이며 두 입력값이 같아야 합니다.");
    }
    await requestPasswordChange(role, role === "pb" ? form.employeeId.trim() : form.userId.trim(), form.name.trim(), form.password);
    setMessage("비밀번호가 변경되었습니다.");
    setMode("login");
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-extrabold text-blue-600">{role === "pb" ? "PB 전용" : "고객 전용"}</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
          {[
            ["login", "로그인"],
            ["signup", "회원가입"],
            ["find", `${identifierLabel} 찾기`],
            ["change", "PW 변경"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => { resetNotice(); setMode(id as ModalMode); }}
              className={`rounded-lg px-2 py-2 text-xs font-extrabold transition ${mode === id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3">
          {mode !== "login" ? (
            <input className={inputClass} placeholder="성명" value={form.name} onChange={(e) => update("name", e.target.value)} />
          ) : null}
          {role === "pb" ? (
            (mode === "login" || mode === "signup" || mode === "change") ? (
              <input className={inputClass} placeholder="사번" value={form.employeeId} onChange={(e) => update("employeeId", e.target.value)} />
            ) : null
          ) : (
            mode === "signup" ? (
              <input className={inputClass} placeholder="생년월일 6자리" value={form.birthDate} onChange={(e) => update("birthDate", e.target.value.replace(/[^\d]/g, "").slice(0, 6))} />
            ) : (mode === "login" || mode === "change") ? (
              <input className={inputClass} placeholder="ID" value={form.userId} onChange={(e) => update("userId", e.target.value)} />
            ) : null
          )}
          {role === "customer" && mode === "signup" ? (
            <input className={inputClass} placeholder="ID" value={form.userId} onChange={(e) => update("userId", e.target.value)} />
          ) : null}
          {(mode === "signup" || mode === "find") ? (
            <input className={inputClass} placeholder="이메일" value={form.email} onChange={(e) => update("email", e.target.value)} />
          ) : null}
          {(mode === "login" || mode === "signup" || mode === "change") ? (
            <input className={inputClass} type="password" placeholder={mode === "change" ? "새로운 비밀번호" : "비밀번호"} value={form.password} onChange={(e) => update("password", e.target.value)} />
          ) : null}
          {(mode === "signup" || mode === "change") ? (
            <input className={inputClass} type="password" placeholder="한 번 더 입력해주세요" value={form.passwordConfirm} onChange={(e) => update("passwordConfirm", e.target.value)} />
          ) : null}
        </div>

        {error ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-extrabold text-red-700">{error}</p> : null}
        {message ? <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm font-extrabold text-blue-700">{message}</p> : null}

        <button
          type="button"
          disabled={busy}
          onClick={mode === "login" ? handleLogin : mode === "signup" ? handleSignup : mode === "find" ? handleFind : handleChangePassword}
          className="mt-5 h-12 w-full rounded-xl bg-blue-600 text-sm font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "처리 중..." : mode === "login" ? "로그인" : mode === "signup" ? "회원가입" : mode === "find" ? "확인" : "확인"}
        </button>
      </section>
    </div>
  );
}
