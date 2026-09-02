import { headers } from "next/headers";

export function getGeminiApiKeyList(): string[] {
  const keysEnv = process.env.GEMINI_API_KEYS;
  if (keysEnv) {
    return keysEnv.split(",").map((k) => k.trim()).filter(Boolean);
  }
  const fallback = process.env.GEMINI_API_KEY?.trim() || process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  return fallback ? [fallback] : [];
}

export function getGeminiApiKey(): string | null {
  return getGeminiApiKeyList()[0] ?? null;
}

export async function getOrderedGeminiApiKeys(preferredIndex?: number): Promise<string[]> {
  const keys = getGeminiApiKeyList();
  if (keys.length === 0) return [];

  let index = preferredIndex;
  if (index === undefined) {
    try {
      const headersList = await headers();
      const val = headersList.get("x-gemini-key-index");
      if (val !== null) {
        index = parseInt(val, 10);
      }
    } catch {
      // Not in a request context (e.g. background scheduler)
    }
  }


  if (index !== undefined && !isNaN(index) && index >= 0 && index < keys.length) {
    const result = [keys[index]];
    for (let i = 0; i < keys.length; i++) {
      if (i !== index) {
        result.push(keys[i]);
      }
    }
    return result;
  }

  // Load balancing: start from a random index but include all keys
  const startIndex = Math.floor(Math.random() * keys.length);
  const result: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    result.push(keys[(startIndex + i) % keys.length]);
  }
  return result;
}
