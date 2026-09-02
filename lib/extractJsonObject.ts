/**
 * LLM 응답 텍스트에서 JSON 객체 1개를 안전하게 추출한다.
 *
 * 기존 관례였던 `indexOf("{") ~ lastIndexOf("}")` 슬라이스는 모델이 JSON 뒤에
 * 설명 문장을 덧붙이거나 객체를 두 개 이어 붙이면 "Unexpected non-whitespace
 * character after JSON" 으로 파싱이 실패한다. 여기서는
 *   ① 전체 텍스트 직접 파싱 시도
 *   ② 문자열 리터럴·이스케이프를 인식하는 균형 중괄호 스캔으로 첫 완결 객체 추출
 *   ③ (스캔 실패 시) 기존 first{~last} 슬라이스 폴백
 *   ④ 스키마 유니온 표기(`"높음"|"중간"`)를 모델이 그대로 베낀 경우 첫 값만 남기고 재시도
 *   ⑤ MAX_TOKENS 등으로 중간에서 잘린 JSON을 뒤에서부터 잘라내며 닫아서 복구
 * 순서로 시도한다.
 */
export function extractJsonObject<T = unknown>(text: string): T {
  const stripped = text.replace(/```json|```/g, "").trim();

  let firstError: unknown;
  try {
    return JSON.parse(stripped) as T;
  } catch (e) {
    firstError = e;
  }

  const start = stripped.indexOf("{");
  if (start < 0) throw new Error("응답에서 JSON을 찾지 못했습니다.");

  // ② 균형 중괄호 스캔으로 첫 완결 객체의 끝 위치를 찾는다
  let balancedEnd = -1;
  {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < stripped.length; i++) {
      const ch = stripped[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = inStr; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { balancedEnd = i; break; }
      }
    }
  }

  const candidates: string[] = [];
  if (balancedEnd > start) candidates.push(stripped.slice(start, balancedEnd + 1));
  const lastBrace = stripped.lastIndexOf("}");
  if (lastBrace > start) candidates.push(stripped.slice(start, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 유니온 표기 정리 후 재시도
    }
    try {
      return JSON.parse(collapseSchemaUnions(candidate)) as T;
    } catch {
      // 다음 후보 또는 절단 복구로 진행
    }
  }

  // ⑤ 절단 복구 — 잘린 꼬리를 콤마 단위로 걷어내고 열린 문자열·괄호를 닫는다
  const repaired = repairTruncatedJson(collapseSchemaUnions(stripped.slice(start)));
  if (repaired !== null) {
    console.warn("[extractJsonObject] 절단된 JSON을 복구했습니다 — 끝부분 일부가 유실됐을 수 있습니다.");
    return repaired as T;
  }

  throw firstError instanceof Error ? firstError : new Error(String(firstError));
}

/**
 * 프롬프트 스키마의 `"A"|"B"|"C"` 유니온 표기를 모델이 값으로 그대로 베낀 경우
 * 첫 번째 값만 남긴다. 정상 JSON에는 문자열 밖 `|` 가 올 수 없어 부작용이 없다.
 */
function collapseSchemaUnions(text: string): string {
  return text.replace(/("(?:[^"\\]|\\.)*")(?:\s*\|\s*"(?:[^"\\]|\\.)*")+/g, "$1");
}

/**
 * 중간에서 잘린 JSON 조각을 파싱 가능해질 때까지 마지막 콤마 단위로 잘라내며
 * 열린 문자열/괄호를 닫아 복구한다. 실패하면 null.
 */
function repairTruncatedJson(fragment: string): unknown | null {
  let candidate = fragment;
  for (let attempt = 0; attempt < 40 && candidate.length > 1; attempt++) {
    try {
      return JSON.parse(closeOpenStructures(candidate));
    } catch {
      const cut = candidate.lastIndexOf(",");
      if (cut <= 0) return null;
      candidate = candidate.slice(0, cut);
    }
  }
  return null;
}

/** 조각을 스캔해 열린 문자열을 닫고, 끝의 불완전 토큰을 정리한 뒤 미닫힘 괄호를 닫는다. */
function closeOpenStructures(fragment: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = inStr; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  let out = fragment;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  if (/:\s*$/.test(out)) out += "null"; // 값이 시작되지 않은 키
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return out;
}

