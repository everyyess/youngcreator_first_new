import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (!isIP(normalized)) return true;
  if (normalized.includes(":")) return false;
  const [a,b] = normalized.split(".").map(Number);
  return a===10 || a===127 || a===0 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || a>=224;
}

export async function assertSafeRemoteUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("HTTP(S) 주소만 허용됩니다.");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("로컬 네트워크 주소는 허용되지 않습니다.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("사설망 또는 예약 주소는 허용되지 않습니다.");
  return url;
}

export async function safeRemoteFetch(value: string, init: RequestInit = {}, redirects = 3): Promise<Response> {
  let current = await assertSafeRemoteUrl(value);
  for (let count=0;count<=redirects;count+=1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    current = await assertSafeRemoteUrl(new URL(location,current).toString());
  }
  throw new Error("리디렉션 횟수가 너무 많습니다.");
}
