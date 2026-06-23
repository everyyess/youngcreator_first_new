import { NextRequest, NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/geminiServerEnv";

const cache = new Map<string, { summary: string; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1시간

// ── 타입 ─────────────────────────────────────────────────────────────────────

type DocSection = {
  dcmNo: string;
  eleId: string;
  offset: string;
  length: string;
  dtd: string;
  label: string;
};

// ── 목차 파싱: dsaf001/main.do → viewDoc / JS TOC 양쪽에서 섹션 추출 ─────────

async function parseDocSections(
  rcpNo: string
): Promise<{ default: DocSection; financial: DocSection | null; business: DocSection | null; change: DocSection | null; person: DocSection | null }> {
  const res = await fetch(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://dart.fss.or.kr",
    },
  });
  const html = await res.text();

  // ── 1. 기본 섹션: 실제 literal viewDoc 호출 (rcpNo가 숫자로 박힌 것)
  //    예: viewDoc("20260515002287","11386485","1","888","4521","dart4.xsd","")
  const firstVdRe = new RegExp(
    `viewDoc\\(\\s*["']${rcpNo}["']\\s*,\\s*["'](\\d+)["']\\s*,\\s*["'](\\d+)["']\\s*,\\s*["'](\\d+)["']\\s*,\\s*["'](\\d+)["']\\s*,\\s*["']([^"']+)["']`
  );
  const firstVd = html.match(firstVdRe);
  const defaultSection: DocSection = firstVd
    ? { dcmNo: firstVd[1], eleId: firstVd[2], offset: firstVd[3], length: firstVd[4], dtd: firstVd[5], label: "기본" }
    : { dcmNo: "", eleId: "0", offset: "0", length: "0", dtd: "dart4.xsd", label: "" };

  const baseDtd = defaultSection.dtd || "dart4.xsd";

  // ── 2. 재무 섹션: DART 목차는 JavaScript 객체로 정의됨
  //    예: node3['text']="2-2. 연결 포괄손익계산서"; node3['eleId']="21"; ...
  //    또는 JSON 형태: {"text":"포괄손익계산서","eleId":"21",...}
  let financialSection: DocSection | null = null;
  const FINANCIAL_KW = ["포괄손익계산서", "손익계산서"];

  for (const kw of FINANCIAL_KW) {
    const kwIdx = html.indexOf(kw);
    if (kwIdx === -1) continue;

    // 키워드 전후 컨텍스트 (최대 2000자)
    const ctx = html.slice(Math.max(0, kwIdx - 400), kwIdx + 1600);

    // JS 객체 방식: node['prop'] = "value"
    const pick = (prop: string) =>
      ctx.match(new RegExp(`\\[['"]${prop}['"]\\]\\s*=\\s*["'](\\d+)["']`))?.[1] ??
      // JSON 방식: "prop":"value" or 'prop':'value'
      ctx.match(new RegExp(`["']${prop}["']\\s*[=:]\\s*["'](\\d+)["']`))?.[1];

    const dcmNo = pick("dcmNo") ?? defaultSection.dcmNo;
    const eleId = pick("eleId");
    const offset = pick("offset");
    const length = pick("length");

    if (eleId && offset && length) {
      financialSection = { dcmNo, eleId, offset, length, dtd: baseDtd, label: kw };
      console.log(
        `[dart-summary] 재무 섹션 발견: "${kw}" eleId=${eleId} offset=${offset} length=${length}`
      );
      break;
    }
  }

  // ── 3. 사업 섹션: "II. 사업의 내용" (사업의 개요 / 매출 및 수주상황 등)
  // 우선순위: 자식 노드(실제 내용 보유) → 부모 노드 순
  // 컨텍스트를 키워드 이후만 탐색 → 이전 노드의 eleId를 잘못 잡는 버그 방지
  let businessSection: DocSection | null = null;
  const BUSINESS_KW = [
    "사업의 개요",        // 자식 노드 1 (가장 확실한 내용 있음)
    "매출 및 수주상황",   // 자식 노드 4
    "사업의 내용",        // 부모 노드 (eleId 없을 수 있음)
    "매출및수주",         // 표기 변형
  ];

  for (const kw of BUSINESS_KW) {
    const kwIdx = html.indexOf(kw);
    if (kwIdx === -1) continue;

    // 키워드 이후만 탐색 (이전 노드의 eleId가 잡히는 오탐 방지)
    const ctx = html.slice(kwIdx, kwIdx + 1400);

    const pickB = (prop: string) =>
      ctx.match(new RegExp(`\\[['"]${prop}['"]\\]\\s*=\\s*["'](\\d+)["']`))?.[1] ??
      ctx.match(new RegExp(`["']${prop}["']\\s*[=:]\\s*["'](\\d+)["']`))?.[1];

    const dcmNo = pickB("dcmNo") ?? defaultSection.dcmNo;
    const eleId = pickB("eleId");
    const offset = pickB("offset");
    const length = pickB("length");

    console.log(`[dart-summary] 사업 섹션 탐색: "${kw}" → eleId=${eleId ?? "없음"} offset=${offset ?? "없음"} length=${length ?? "없음"}`);

    if (eleId && offset && length) {
      businessSection = { dcmNo, eleId, offset, length, dtd: baseDtd, label: kw };
      console.log(`[dart-summary] 사업 섹션 확정: "${kw}" eleId=${eleId} offset=${offset} length=${length}`);
      break;
    }
  }

  // ── 4. 변동사유 섹션: 지분공시의 "5. 변동[변경]사유"
  let changeSection: DocSection | null = null;
  const CHANGE_KW = ["변동[변경]사유", "변동ㆍ변경사유", "변동사유"];

  for (const kw of CHANGE_KW) {
    const kwIdx = html.indexOf(kw);
    if (kwIdx === -1) continue;

    // 키워드 이후만 탐색 (이전 노드 오탐 방지)
    const ctx = html.slice(kwIdx, kwIdx + 1400);

    const pickC = (prop: string) =>
      ctx.match(new RegExp(`\\[['"]${prop}['"]\\]\\s*=\\s*["'](\\d+)["']`))?.[1] ??
      ctx.match(new RegExp(`["']${prop}["']\\s*[=:]\\s*["'](\\d+)["']`))?.[1];

    const dcmNo = pickC("dcmNo") ?? defaultSection.dcmNo;
    const eleId = pickC("eleId");
    const offset = pickC("offset");
    const length = pickC("length");

    console.log(`[dart-summary] 변동사유 섹션 탐색: "${kw}" → eleId=${eleId ?? "없음"}`);

    if (eleId && offset && length) {
      changeSection = { dcmNo, eleId, offset, length, dtd: baseDtd, label: kw };
      console.log(`[dart-summary] 변동사유 섹션 확정: eleId=${eleId} offset=${offset} length=${length}`);
      break;
    }
  }

  // ── 5. 인적 정보 섹션: 내부자거래 공시의 "2. 보고자에 관한 사항"
  let personSection: DocSection | null = null;
  const PERSON_KW = ["보고자에 관한 사항", "보고자에관한사항"];

  for (const kw of PERSON_KW) {
    const kwIdx = html.indexOf(kw);
    if (kwIdx === -1) continue;

    const ctx = html.slice(kwIdx, kwIdx + 1400);

    const pickP = (prop: string) =>
      ctx.match(new RegExp(`\\[['"]${prop}['"]\\]\\s*=\\s*["'](\\d+)["']`))?.[1] ??
      ctx.match(new RegExp(`["']${prop}["']\\s*[=:]\\s*["'](\\d+)["']`))?.[1];

    const dcmNo = pickP("dcmNo") ?? defaultSection.dcmNo;
    const eleId = pickP("eleId");
    const offset = pickP("offset");
    const length = pickP("length");

    console.log(`[dart-summary] 인적정보 섹션 탐색: "${kw}" → eleId=${eleId ?? "없음"}`);

    if (eleId && offset && length) {
      personSection = { dcmNo, eleId, offset, length, dtd: baseDtd, label: kw };
      console.log(`[dart-summary] 인적정보 섹션 확정: eleId=${eleId} offset=${offset} length=${length}`);
      break;
    }
  }

  return { default: defaultSection, financial: financialSection, business: businessSection, change: changeSection, person: personSection };
}

// ── DART 문서 원문 → 텍스트 ─────────────────────────────────────────────────

async function fetchSectionText(rcpNo: string, section: DocSection): Promise<string> {
  const url =
    `https://dart.fss.or.kr/report/viewer.do` +
    `?rcpNo=${rcpNo}` +
    `&dcmNo=${section.dcmNo}` +
    `&eleId=${section.eleId}` +
    `&offset=${section.offset}` +
    `&length=${section.length}` +
    `&dtd=${section.dtd}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`,
    },
  });

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const ct = res.headers.get("content-type") ?? "";
  const isEucKr =
    ct.toLowerCase().includes("euc-kr") || ct.toLowerCase().includes("ks_c_5601");

  let html: string;
  try {
    html = new TextDecoder(isEucKr ? "euc-kr" : "utf-8", { fatal: false }).decode(bytes);
  } catch {
    const peek = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
    const enc =
      (peek.match(/charset[=\s'"]+([^'"\s;>]{2,20})/i) ?? [])[1]?.toLowerCase() ?? "utf-8";
    html = new TextDecoder(enc.includes("euc") ? "euc-kr" : "utf-8", {
      fatal: false,
    }).decode(bytes);
  }

  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z#\d]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const rcpNo = (req.nextUrl.searchParams.get("rcpNo") ?? "").trim();
  if (!/^\d{14}$/.test(rcpNo)) {
    return NextResponse.json(
      { error: "유효한 rcpNo가 필요합니다 (14자리 숫자)" },
      { status: 400 }
    );
  }

  const title = (req.nextUrl.searchParams.get("title") ?? "").trim();
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  const isEarnings = ["사업보고서", "분기보고서", "반기보고서", "잠정실적"].some((kw) =>
    title.includes(kw)
  );
  // 내부자거래: 임원·주요주주 특정증권등 소유상황보고서 (D002)
  const isInsider = title.includes("특정증권") ||
    (title.includes("소유상황보고서") && !title.includes("대량보유"));
  // 지분 공시: 주식등의 대량보유상황보고서 (D001)
  const isStake = !isInsider && title.includes("대량보유상황보고서");
  // 수주 공시: 단일판매·공급계약체결
  const isContract = title.includes("단일판매") || title.includes("공급계약") || title.includes("수주");

  const disclosureType = isEarnings ? "earnings" : isStake ? "stake" : isInsider ? "insider" : isContract ? "contract" : "generic";
  const cacheKey = `dart-summary:${rcpNo}:${disclosureType}`;
  if (!refresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return NextResponse.json({ summary: hit.summary, cached: true });
    }
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API key가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  try {
    // 1. 목차 파싱 → 섹션 정보 추출
    const sections = await parseDocSections(rcpNo);
    console.log(
      `[dart-summary] rcpNo=${rcpNo} isEarnings=${isEarnings} ` +
        `financialSection=${sections.financial?.label ?? "없음"}`
    );

    if (!sections.default.dcmNo && !sections.financial?.dcmNo) {
      return NextResponse.json({ error: "공시 문서를 찾을 수 없습니다." }, { status: 404 });
    }

    let docText: string;

    if (isEarnings && sections.financial) {
      // 2a. 실적 공시: 포괄손익계산서 섹션
      const financialText = await fetchSectionText(rcpNo, sections.financial);
      docText = financialText.slice(0, 30000);
      console.log(`[dart-summary] 재무 섹션 텍스트 ${docText.length}자 추출`);
    } else if (isEarnings && !sections.financial) {
      // 2b. 재무 섹션 미발견: 기본 섹션에서 재무 키워드 탐색
      const fullText = await fetchSectionText(rcpNo, sections.default);
      const kwIdx = ["포괄손익계산서", "손익계산서", "매출액"].reduce((best, kw) => {
        const idx = fullText.indexOf(kw);
        return idx > -1 && (best === -1 || idx < best) ? idx : best;
      }, -1);
      docText = kwIdx > -1
        ? fullText.slice(Math.max(0, kwIdx - 500), kwIdx + 15000)
        : fullText.slice(0, 15000);
    } else {
      // 2c. 비실적 공시: 기본 섹션 12,000자
      const fullText = await fetchSectionText(rcpNo, sections.default);
      docText = fullText.slice(0, 12000);
    }

    if (docText.length < 30) {
      return NextResponse.json({ error: "공시 내용을 불러올 수 없습니다." }, { status: 500 });
    }

    // 2d. 사업의 내용 섹션 별도 fetch (실적 공시)
    let businessDocText = "";
    if (isEarnings && sections.business) {
      try {
        const bText = await fetchSectionText(rcpNo, sections.business);
        businessDocText = bText.slice(0, 8000);
        console.log(
          `[dart-summary] 사업 섹션 "${sections.business.label}" ${businessDocText.length}자 추출` +
          ` | 앞 100자: ${businessDocText.slice(0, 100).replace(/\s+/g, " ")}`
        );
      } catch (e) {
        console.warn("[dart-summary] 사업 섹션 fetch 실패:", e instanceof Error ? e.message : e);
      }
    } else if (isEarnings) {
      console.log("[dart-summary] 사업 섹션 미발견 — 사업 현황 섹션 생략");
    }

    // 2e. 변동[변경]사유 섹션 별도 fetch (지분 공시)
    let changeDocText = "";
    if (isStake && sections.change) {
      try {
        const cText = await fetchSectionText(rcpNo, sections.change);
        changeDocText = cText.slice(0, 5000);
        console.log(`[dart-summary] 변동사유 섹션 ${changeDocText.length}자 추출 | 앞 100자: ${changeDocText.slice(0, 100).replace(/\s+/g, " ")}`);
      } catch (e) {
        console.warn("[dart-summary] 변동사유 섹션 fetch 실패:", e instanceof Error ? e.message : e);
      }
    } else if (isStake) {
      console.log("[dart-summary] 변동사유 섹션 미발견 — 변동 사유 섹션 생략");
    }

    // 2f. 보고자에 관한 사항 섹션 별도 fetch (내부자거래 공시)
    let personDocText = "";
    if (isInsider && sections.person) {
      try {
        const pText = await fetchSectionText(rcpNo, sections.person);
        personDocText = pText.slice(0, 4000);
        console.log(`[dart-summary] 인적정보 섹션 ${personDocText.length}자 추출 | 앞 100자: ${personDocText.slice(0, 100).replace(/\s+/g, " ")}`);
      } catch (e) {
        console.warn("[dart-summary] 인적정보 섹션 fetch 실패:", e instanceof Error ? e.message : e);
      }
    } else if (isInsider) {
      console.log("[dart-summary] 인적정보 섹션 미발견 — 인적 정보 섹션 생략");
    }

    // 3. Gemini 프롬프트 구성
    const earningsNumericSection = `**📊 주요 수치 (전기 대비 변화)**
- 매출액: [당기 금액] (전기 대비 [+/-X%])
- 영업이익: [당기 금액] (전기 대비 [+/-X%])
- 당기순이익: [당기 금액] (전기 대비 [+/-X%])
- 영업이익률: [당기 X%] (전기 [X%])
※ 원문 수치를 그대로 사용하고 증감률을 직접 계산하세요. 수치가 없으면 "원문에서 확인 불가"로 표기하세요.`;

    // 내부자거래용 "실행 일정" (📅)
    const insiderScheduleSection = `**📅 실행 일정**
- 보고의무 발생일: (원문 그대로)
- 보고서 작성 기준일: (원문 그대로)
- 기타 주요 일정: (있는 경우만)`;

    // 수주 공시용 "계약 상세" (📋)
    const contractDetailSection = `**📋 계약 상세**
- 계약 금액: (원문 그대로, 매출액 대비 % 포함)
- 계약 기간: 시작일 ~ 종료일
- 계약(수주)일자: (체결일)
- 주요 계약조건: (대금지급 방법, 선급금 여부 등, 있는 경우)`;

    // 수주 공시용 "계약 상대" (🤝) — 별도 fetch 불필요, docText에 포함됨
    const contractPartySection = `
**🤝 계약 상대**
- 계약상대: (회사명, 지역 또는 특징)
- 회사와의 관계: (있는 경우, 없으면 생략)
- 판매·공급지역: (원문 그대로)
※ 원문에 명시된 내용만 기재하세요.`;

    const genericNumericSection = `**📊 주요 수치**
- (금액, 비율, 날짜 등 중요 수치. 없으면 "해당 없음")`;

    // 실적 공시 — 사업의 내용 섹션
    const earningsBusinessSection = businessDocText
      ? `
**🏢 사업 현황 (II. 사업의 내용)**
- 사업의 개요: 주요 사업 성격과 특징
- 주요 제품·서비스 및 매출 구성
- 수주 동향 또는 전기 대비 주목할 변화 (있는 경우)
※ [사업의 내용] 원문에 명시된 내용만 작성하고, 없으면 해당 항목은 생략하세요.`
      : "";

    // 지분 공시 — 변동[변경]사유 섹션
    const stakeChangeSection = changeDocText
      ? `
**📋 변동 사유**
- 변동방법: (원문 그대로 기재)
- 변동사유: (원문 그대로 기재)
- 변경사유: (계약 변경 등 원문에 명시된 경우만 기재, 없으면 생략)
※ [변동사유] 원문 내용을 그대로 옮겨 작성하세요. 없는 항목은 생략하세요.`
      : "";

    // 내부자거래 — 인적 정보 섹션
    const insiderPersonSection = personDocText
      ? `
**👤 인적 정보 (보고자에 관한 사항)**
- 보고자 성명 및 구분 (개인/법인, 국내/국외)
- 발행회사와의 관계: 직위명, 임원 등기 여부, 선임일
- 주요주주 여부 (해당하는 경우)
※ [보고자에 관한 사항] 원문에 명시된 내용만 기재하고, 연락처·주소·이메일 등 개인정보는 생략하세요.`
      : "";

    // 공시 종류에 따른 컨텍스트 라벨
    const docLabel = isEarnings
      ? "포괄손익계산서 원문"
      : isStake ? "지분 공시 원문"
      : isInsider ? "내부자거래 공시 원문"
      : isContract ? "수주 공시 원문"
      : "공시 원문";

    // 공시 종류에 따른 2번 섹션 선택
    const numericOrScheduleSection = isEarnings
      ? earningsNumericSection
      : isInsider
      ? insiderScheduleSection
      : isContract
      ? contractDetailSection
      : genericNumericSection;

    const prompt = `당신은 PB(프라이빗 뱅커)를 위한 DART 공시 요약 어시스턴트입니다.
아래 DART 전자공시 원문을 읽고, 고객 상담에 즉시 활용할 수 있도록 핵심만 요약해주세요.

출력 형식 (마크다운, 아래 순서 준수):
**📌 핵심 내용**
- (2~3줄 이내로 공시의 핵심을 서술)

${numericOrScheduleSection}
${isEarnings ? earningsBusinessSection : ""}
${isStake ? stakeChangeSection : ""}
${isInsider ? insiderPersonSection : ""}
${isContract ? contractPartySection : ""}

**💡 투자 시사점**
- (투자자 관점에서 주목해야 할 사항 2~3가지)

---
[${docLabel}]
${docText}
${businessDocText ? `\n[II. 사업의 내용 원문]\n${businessDocText}` : ""}
${changeDocText ? `\n[변동사유 원문]\n${changeDocText}` : ""}
${personDocText ? `\n[보고자에 관한 사항 원문]\n${personDocText}` : ""}
---
위 형식에 따라 한국어로 간결하게 요약하세요. 불필요한 서론 없이 바로 요약을 시작하세요.`;

    // 4. Gemini 호출 (429·404 시 다음 모델로 자동 폴백)
    // 우선순위: 성능 ↘ / 남은 한도 ↗ 순
    // (Google AI Studio 무료 한도 기준 — 2026-06)
    const GEMINI_MODELS = [
      "gemini-3.1-flash-lite",   // 1순위: RPD 500 ★ 한도 가장 넉넉
      "gemini-1.5-flash",        // 2순위: 구세대, 별도 한도 풀
      "gemini-2.5-flash-lite",   // 3순위: RPD 20
      "gemini-2.5-flash",        // 4순위: RPD 20
    ] as const;

    type GeminiResp = {
      candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    };

    let summary = "";
    let usedModel = "";
    let lastError = "";

    for (const model of GEMINI_MODELS) {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 },
          }),
        }
      );

      // 429 = 한도 초과 / 404 = 해당 API 버전에서 미지원 → 다음 모델 시도
      if (geminiRes.status === 429) {
        lastError = `${model} 한도 초과(429)`;
        console.warn(`[dart-summary] ${model} 429 한도 초과, 다음 모델로 폴백`);
        const retryAfter = geminiRes.headers.get("retry-after");
        if (retryAfter) console.log(`[dart-summary] retry-after: ${retryAfter}s`);
        continue;
      }

      if (geminiRes.status === 404) {
        lastError = `${model} 미지원(404)`;
        console.warn(`[dart-summary] ${model} 404 미지원, 다음 모델로 폴백`);
        continue;
      }

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        lastError = `${model} 오류 ${geminiRes.status}: ${errText.slice(0, 200)}`;
        console.warn(`[dart-summary] ${model} 실패:`, lastError);
        continue;
      }

      const result = (await geminiRes.json()) as GeminiResp;
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) {
        lastError = `${model}: 응답에 요약 없음`;
        continue;
      }

      summary = text;
      usedModel = model;
      console.log(`[dart-summary] ${model} 요약 성공`);
      break;
    }

    if (!summary) {
      throw new Error(`모든 Gemini 모델 실패. 마지막 오류: ${lastError}`);
    }

    cache.set(cacheKey, { summary, ts: Date.now() });
    return NextResponse.json({ summary, rcpNo, model: usedModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dart-summary]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
