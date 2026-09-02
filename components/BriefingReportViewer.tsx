"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Printer, X } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// BriefingReportViewer — 브리핑형 보고서 공용 뷰어
//
// tab6 OvernightReportViewer에서 승격한 공용 컴포넌트.
//  · TAB6 전날 요약(overnight) / 시황 분석 폴백 / TAB4 매크로 통합 리서치 보고서가 공유한다.
//  · 파란 헤더 + 블록 렌더링 + Markdown 복사 + PDF 다운로드(html2canvas→jsPDF, 실패 시 인쇄 폴백).
//  · 인라인 태그 — TAB4 통합 인사이트와 동일한 문장 호버 스타일:
//    - 각주 없는 [Fact]/[팩트]/[인용]/[추정] → 문장 밑줄 + 호버 툴팁 (클릭 없음)
//    - 각주 달린 [팩트][#n]·[인용][#n]·[판단(n)] → 문장 호버 툴팁 + 클릭 시 하단
//      출처/판단 근거 줄로 스크롤·하이라이트 (TAB4 renderReportWithTags 이식)
//    - overnight처럼 마커가 문장 앞에 오는 형식은 전처리에서 문장 뒤로 옮겨
//      호버 밑줄이 해당 문장을 감싸게 한다
//    - 문장 속 [#n] 각주는 화면에 표시하지 않는다(stripFootnoteRefs) — 호버 툴팁·클릭
//      점프(citedIds)로만 노출. 원문(Markdown 복사·출처 서지)은 그대로 보존
// ─────────────────────────────────────────────────────────────────────────────

type Block =
  | { kind: "summary"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "heading"; text: string }                       // **볼드 단독 줄** 섹션 헤딩 (macro 목차)
  | { kind: "issue"; title: string; lines: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "source"; id: string; text: string }            // 출처 서지 "[#n]: ..."
  | { kind: "judgment"; num: string; text: string }         // 판단 근거 "[판단(n)]: ..."
  | { kind: "para"; lines: string[] };

const SOURCE_LINE_RE = /^\[(#\d+)\]:\s*(.+)$/;
const JUDGMENT_LINE_RE = /^[-*·◦]?\s*\[(?:판단|판판|판)\((\d+)\)\]:\s*(.+)$/;
const BOLD_HEADING_RE = /^\*\*[^*]+\*\*$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;

// 종결부호 위치 보정 — "문장 [팩트][#5]." 처럼 마침표가 태그 뒤에 남은 구버전 표기를
// 문장 끝(태그 앞)으로 옮겨 태그 하이라이트가 마침표까지 감싸도록 한다.
// (InsightDbTab.tsx::normalizeReportPunctuation과 동일 규칙)
function normalizeReportPunctuation(markdown: string): string {
  return markdown
    // 문장 앞에 붙은 마커(overnight factBrief/inferBrief 형식)를 문장 뒤로 이동 —
    // 호버 밑줄이 태그가 아니라 문장 본문을 감싸도록
    .replace(/^(\[(?:Fact|팩트|인용|추정)\])\s*(.+)$/gm, "$2 $1")
    // 태그 앞에 놓인 각주 그룹("... [#3][#5] [Fact]")을 태그 뒤로 재배열 —
    // MARKER_RE가 "[Fact][#3][#5]" 형태의 각주 달린 마커로 인식하게 한다
    .replace(/((?:\[#\d+\][ \t]*)+)(\[(?:Fact|팩트|인용)\])/g, "$2$1")
    .replace(/[ \t]*(\[(?:Fact|팩트|인용)\](?:\s*\[#\d+\])*|\[(?:판단|판판|판)\(?\d+\)?\])[ \t]*([.!?…]+)/g, "$2 $1")
    .replace(/[ \t]+([.!?…,])(?=\s|$)/g, "$1");
}

// ─────────────────────────────────────────────────────────────────────────────
// 마크다운 파서
// ─────────────────────────────────────────────────────────────────────────────

function parseReport(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isSpecialLine = (l: string) =>
    l.startsWith("#") || l.startsWith("|") || BOLD_HEADING_RE.test(l) ||
    SOURCE_LINE_RE.test(l) || JUDGMENT_LINE_RE.test(l) || HR_RE.test(l);

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) { i++; continue; }

    // H1 제목 줄·구분선 스킵
    if (/^# (?!#)/.test(trimmed) || HR_RE.test(trimmed)) { i++; continue; }

    // ## 밤사이 시장 한 줄 평 → 강조 요약 블록 (overnight 전용)
    if (/^## 밤사이/.test(trimmed)) {
      i++;
      const acc: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("#")) {
        const l = lines[i].trim();
        if (l) acc.push(l);
        i++;
      }
      if (acc.length > 0) blocks.push({ kind: "summary", text: acc.join(" ") });
      continue;
    }

    // ## 그 외 H2 섹션 헤더
    if (/^## /.test(trimmed)) {
      blocks.push({ kind: "h2", text: trimmed.slice(3).trim() });
      i++;
      continue;
    }

    // ### H3 이슈 헤더
    if (/^### /.test(trimmed)) {
      const title = trimmed.slice(4).trim();
      i++;
      const acc: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (l.startsWith("#") || l.startsWith("|") || BOLD_HEADING_RE.test(l)) break;
        if (l) acc.push(l);
        i++;
      }
      blocks.push({ kind: "issue", title, lines: acc });
      continue;
    }

    // **볼드 단독 줄** → 섹션 헤딩 (macro/stock/theme 보고서 목차 구조)
    if (BOLD_HEADING_RE.test(trimmed)) {
      blocks.push({ kind: "heading", text: trimmed.slice(2, -2).trim() });
      i++;
      continue;
    }

    // 출처 서지 줄 — "[#94]: [날짜 · DB · 단계] 제목" — 태그 클릭 시 이 줄로 점프
    const srcMatch = SOURCE_LINE_RE.exec(trimmed);
    if (srcMatch) {
      blocks.push({ kind: "source", id: srcMatch[1].slice(1), text: srcMatch[2] });
      i++;
      continue;
    }

    // 판단 근거 줄 — "[판단(1)]: 설명" — 판단 태그 클릭 시 이 줄로 점프
    const judgMatch = JUDGMENT_LINE_RE.exec(trimmed);
    if (judgMatch) {
      blocks.push({ kind: "judgment", num: judgMatch[1], text: judgMatch[2] });
      i++;
      continue;
    }

    // 마크다운 테이블
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const headers = tableLines[0]
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean);
        const rows: string[][] = [];
        for (let j = 1; j < tableLines.length; j++) {
          const isSep = tableLines[j]
            .split("|")
            .every((cell) => cell.trim() === "" || /^[-:]+$/.test(cell.trim()));
          if (isSep) continue;
          const cells = tableLines[j].split("|").map((s) => s.trim()).filter(Boolean);
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) blocks.push({ kind: "table", headers, rows });
      }
      continue;
    }

    // 일반 단락 (빈 줄 또는 특수 줄 전까지)
    const acc: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l) { i++; break; }
      if (isSpecialLine(l)) break;
      acc.push(l);
      i++;
    }
    if (acc.length > 0) blocks.push({ kind: "para", lines: acc });
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// 앵커 하이라이트 — 태그 클릭 시 출처/판단 근거 줄로 스크롤·노랑 하이라이트
// ─────────────────────────────────────────────────────────────────────────────

function clearBriefHighlights() {
  document.querySelectorAll(".brief-anchor-hl").forEach((el) => el.classList.remove("brief-anchor-hl", "bg-yellow-200"));
}

function highlightBriefAnchors(ids: string[]) {
  clearBriefHighlights();
  ids.forEach((id) => document.getElementById(id)?.classList.add("brief-anchor-hl", "bg-yellow-200"));
  document.getElementById(ids[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ─────────────────────────────────────────────────────────────────────────────
// 인라인 렌더러
// ─────────────────────────────────────────────────────────────────────────────

const MARKER_RE = /(\[(?:Fact|팩트|인용)\](?:\s?\[#\d+\])*|\[(?:판단|판판|판)\(?\d+\)?\]|\[추정\])/g;

function StaticBadge({ label, tone }: { label: string; tone: "blue" | "amber" }) {
  const cls = tone === "blue" ? "bg-primary-100 text-primary" : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold mx-0.5 align-middle ${cls}`}>
      {label}
    </span>
  );
}

// 각주 없는 태그의 호버 표시 — 문장에 점선 밑줄, 마우스 오버 시 태그 툴팁 (TAB4 스타일, 클릭 없음)
function HoverTag({ label, tone, children }: { label: string; tone: "fact" | "quote" | "judgment"; children: React.ReactNode }) {
  const underline =
    tone === "fact" ? "border-primary/40 group-hover:bg-primary/10"
      : tone === "quote" ? "border-amber-400 group-hover:bg-amber-50"
        : "border-sky-400 group-hover:bg-sky-100";
  const tip = tone === "fact" ? "bg-primary" : tone === "quote" ? "bg-amber-500" : "bg-sky-600";
  return (
    <span className="group relative mr-1 inline">
      <span className={`tag-underline rounded-sm border-b border-dashed transition-colors duration-150 ${underline}`}>
        {children}
      </span>
      <span className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md px-3 py-1 text-center text-[11px] font-black leading-snug text-white shadow-md group-hover:block ${tip}`}>
        {label}
      </span>
    </span>
  );
}

// "종목명(티커)" 클릭 핸들러 — 제공 시 본문 내 종목 표기가 클릭 가능한 링크가 된다
// (TAB4 renderTextWithStockLinks 이식. prop → context로 내려보내 블록 트리 전체에서 사용)
const StockClickContext = createContext<((name: string, ticker: string) => void) | null>(null);

const STOCK_RE = /([가-힣A-Za-z0-9&]+)\(([0-9]{6}\.(?:KS|KQ)|[A-Z]{2,6})\)/g;

function TextWithStockLinks({ text, bold = false }: { text: string; bold?: boolean }) {
  const onStockClick = useContext(StockClickContext);
  const wrap = (node: React.ReactNode, key: React.Key) =>
    bold ? <strong key={key} className="text-slate-900">{node}</strong> : <span key={key}>{node}</span>;

  if (!onStockClick) return <>{wrap(text, 0)}</>;

  const parts = text.split(STOCK_RE);
  if (parts.length === 1) return <>{wrap(text, 0)}</>;

  const out: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]) out.push(wrap(parts[i], `t-${i}`));
    if (i + 1 < parts.length) {
      const name = parts[i + 1];
      const ticker = parts[i + 2];
      out.push(
        <button
          key={`s-${i}`}
          type="button"
          onClick={() => onStockClick(name, ticker)}
          className="mx-0.5 inline-flex items-center font-black text-primary transition-colors duration-150 hover:text-primary-dark hover:underline cursor-pointer"
        >
          <strong>{name}({ticker})</strong>
        </button>,
      );
    }
  }
  return <>{out}</>;
}

function renderBoldText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, idx) =>
    part.startsWith("**") && part.endsWith("**")
      ? <TextWithStockLinks key={idx} text={part.slice(2, -2)} bold />
      : <TextWithStockLinks key={idx} text={part} />,
  );
}

// 화면 표시용 각주 제거 — 문장 속 [#n] 참조는 호버 툴팁(citedIds)과 클릭 점프로 옮겨졌으므로
// 본문에서는 숨긴다. 출처 서지 줄("[#n]: ...")은 블록 단계에서 별도 파싱되어 영향 없다.
function stripFootnoteRefs(text: string): string {
  return text.replace(/\s*\[#\d+\]/g, "").replace(/[ \t]+([.!?…,])/g, "$1");
}

function InlineText({ text }: { text: string }) {
  const normalized = text
    .replace(/\*\*\[(Fact|팩트|인용|추정)\]\*\*/g, "[$1]");

  const rawSegments = normalized.split(MARKER_RE);
  const segments: Array<{ text: string; marker: string | null }> = [];
  for (let k = 0; k < rawSegments.length; k += 2) {
    const segText = rawSegments[k];
    const marker = rawSegments[k + 1] || null;
    if (!segText && !marker) continue;
    segments.push({ text: segText, marker });
  }

  return (
    <>
      {segments.map((seg, idx) => {
        const displayText = stripFootnoteRefs(seg.text);
        const renderedText = renderBoldText(displayText);
        if (!seg.marker) return <span key={idx}>{renderedText}</span>;

        // [추정] — 문장 호버 태그 (본문이 없는 예외 케이스만 정적 배지 폴백)
        if (seg.marker === "[추정]") {
          if (!displayText.trim()) return <StaticBadge key={idx} label="추정" tone="amber" />;
          return <HoverTag key={idx} label="추정" tone="judgment">{renderedText}</HoverTag>;
        }

        const badgeType = (/\[(Fact|팩트|인용)\]/.exec(seg.marker) ?? ["", ""])[1]
          || (/^\[(?:판단|판판|판)/.test(seg.marker) ? "판단" : "");
        const markerCited = [...seg.marker.matchAll(/\[(#\d+)\]/g)].map((m) => m[1]);
        const judgMatch = /\[(?:판단|판판|판)\(?(\d+)\)?\]/.exec(seg.marker);
        const judgmentNum = judgMatch ? judgMatch[1] : "";

        const isFact = badgeType === "Fact" || badgeType === "팩트";
        const isQuote = badgeType === "인용";
        const isJudgment = badgeType === "판단" && !!judgmentNum;

        // 마커에 각주가 안 붙었어도 문장 본문에 #n 참조가 있으면 각주로 승격 —
        // overnight factBrief처럼 "[Fact] ... #3, #5" 형태도 클릭 → 출처 점프가 되게 한다
        const inlineCited = (isFact || isQuote) && markerCited.length === 0
          ? [...new Set([...seg.text.matchAll(/#(\d+)\b/g)].map((m) => `#${m[1]}`))]
          : [];
        const citedIds = markerCited.length ? markerCited : inlineCited;

        // 각주 없는 [Fact]/[팩트]/[인용] — 문장 호버 태그 (본문이 없으면 정적 배지 폴백)
        if ((isFact || isQuote) && citedIds.length === 0) {
          if (!displayText.trim()) {
            return <StaticBadge key={idx} label={isFact ? "팩트" : "인용"} tone={isFact ? "blue" : "amber"} />;
          }
          return (
            <HoverTag key={idx} label={isFact ? "팩트" : "인용"} tone={isFact ? "fact" : "quote"}>
              {renderedText}
            </HoverTag>
          );
        }

        const citedLabel = citedIds.length > 4
          ? `${citedIds.slice(0, 4).join(", ")} 외 ${citedIds.length - 4}건`
          : citedIds.join(", ");

        const tooltip =
          isFact && citedIds.length ? `팩트 ${citedLabel}`
            : isQuote && citedIds.length ? `인용 ${citedLabel}`
              : isJudgment ? `판단 (${judgmentNum})`
                : "";

        if (!tooltip) return <span key={idx}>{renderedText}</span>;

        const handleClick = () => {
          if (isFact || isQuote) highlightBriefAnchors(citedIds.map((id) => `brief-src-${id.slice(1)}`));
          else highlightBriefAnchors([`brief-judgment-${judgmentNum}`]);
        };

        return (
          <span key={idx} onClick={handleClick} className="group relative mr-1 inline cursor-pointer">
            <span className={`tag-underline rounded-sm border-b border-dashed transition-colors duration-150 ${isFact ? "border-primary/40 group-hover:bg-primary/10"
                : isQuote ? "border-amber-400 group-hover:bg-amber-50"
                  : "border-sky-400 group-hover:bg-sky-100"
              }`}>
              {renderedText}
            </span>
            <span className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md px-3 py-1 text-center text-[11px] font-black leading-snug text-white shadow-md group-hover:block ${isFact ? "bg-primary" : isQuote ? "bg-amber-500" : "bg-sky-600"
              }`}>
              {tooltip}
            </span>
          </span>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 방향 셀 — 한국 HTS 표준 색상
// ─────────────────────────────────────────────────────────────────────────────

function DirectionCell({ text }: { text: string }) {
  const isUp   = /[⬆↑▲🔺]|긍정/.test(text);
  const isDown = /[⬇↓▼🔻]|부정/.test(text);
  if (isUp)   return <span className="text-red-600 font-bold">▲</span>;
  if (isDown) return <span className="text-blue-600 font-bold">▼</span>;
  return <span className="text-gray-500">-</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 블록 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

function ReportHeader({ date, kicker, subtitle }: { date: string; kicker: string; subtitle: string }) {
  return (
    <div className="bg-primary text-white px-8 py-7 flex items-center justify-between">
      <div>
        <p className="text-[10px] font-bold tracking-[0.25em] text-primary-200 uppercase mb-2">
          {kicker}
        </p>
        <h1 className="text-2xl font-black tracking-tight leading-none">{date}</h1>
        <p className="text-xs text-primary-100 mt-2 leading-relaxed">{subtitle}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- html2canvas 캡처 호환용 정적 img */}
        <img
          src="/profile_image.png"
          alt="Hoons_Platform"
          className="w-12 h-12 rounded-full border border-white/20 object-cover"
        />
        <p className="text-[9px] font-bold tracking-[0.2em] text-primary-200 uppercase">Hoons_Platform</p>
      </div>
    </div>
  );
}

function SummaryBlock({ text }: { text: string }) {
  return (
    <div className="mx-6 mt-6 rounded-xl bg-primary-50 border border-primary-100 px-6 py-5">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary-400 mb-2">
        한 줄 평
      </p>
      <p className="text-[17px] font-normal text-primary-600 leading-relaxed">
        <InlineText text={text} />
      </p>
    </div>
  );
}

function H2Block({ text }: { text: string }) {
  return (
    <div className="mx-6 mt-8 mb-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 border-b border-slate-200 pb-1.5">
        {text}
      </p>
    </div>
  );
}

function HeadingBlock({ text }: { text: string }) {
  return (
    <div className="mx-6 mt-8 mb-2 border-b border-slate-200 pb-1.5">
      <h3 className="text-[15px] font-black text-primary">{text}</h3>
    </div>
  );
}

function IssueBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="mx-6 mt-5">
      <div className="border-l-4 border-primary pl-4 mb-2.5">
        <h3 className="text-[17px] font-black text-primary leading-snug">
          {title}
        </h3>
      </div>
      <div className="pl-4 space-y-2">
        {lines.map((line, idx) => (
          <p key={idx} className="text-[17px] text-slate-700 leading-relaxed">
            <InlineText text={line} />
          </p>
        ))}
      </div>
    </div>
  );
}

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const dirIdx = headers.findIndex((h) => /방향|Direction/i.test(h));
  // 자산군 파급 표(자산군/방향/근거 3열) — 이슈마다 반복되므로 table-fixed + 고정 열 폭으로
  // 표들끼리 열 시작 위치를 정렬한다. 그 외 표는 내용에 따라 자동 폭.
  const isImpactTable = headers.length === 3 && dirIdx === 1;
  return (
    <div className="mx-6 mt-5 overflow-x-auto rounded-lg border border-slate-200">
      <table className={`w-full text-sm border-collapse ${isImpactTable ? "table-fixed" : ""}`}>
        {isImpactTable && (
          <colgroup>
            <col className="w-[21%]" />
            <col className="w-[13%]" />
            <col className="w-[66%]" />
          </colgroup>
        )}
        <thead>
          <tr>
            {headers.map((h, idx) => (
              <th
                key={idx}
                className="bg-primary text-white text-xs font-bold px-4 py-3 text-left whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-4 py-2.5 text-[17px] text-slate-700 border-b border-slate-100"
                >
                  {ci === dirIdx
                    ? <DirectionCell text={cell} />
                    : <InlineText text={cell} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceBlock({ id, text }: { id: string; text: string }) {
  return (
    <p
      id={`brief-src-${id}`}
      className="mx-6 my-1 scroll-mt-4 rounded px-1 text-[12px] leading-relaxed text-slate-500 transition-colors duration-300"
    >
      <span className="mr-1.5 font-black text-primary">#{id}</span>{text}
    </p>
  );
}

function JudgmentBlock({ num, text }: { num: string; text: string }) {
  return (
    <p
      id={`brief-judgment-${num}`}
      className="mx-6 my-1 scroll-mt-4 rounded px-1 text-[12px] leading-relaxed text-slate-500 transition-colors duration-300"
    >
      <span className="mr-1.5 font-black text-sky-600">({num})</span>{text}
    </p>
  );
}

// 긴 단락을 문장 단위로 끊어 3문장마다 문단을 나눈다 — 밀도 높은 본문에 여백을 준다.
// 종결부호 뒤 각주 태그([팩트][#n] 등)는 앞 문장에 붙여 함께 묶고,
// 소수점(-0.4%, 332.568pt)은 뒤에 공백이 없어 분리되지 않는다.
function splitIntoSentenceChunks(line: string, size = 3): string[] {
  const sentences = line.split(/(?<=[.!?…]|\])\s+(?!\[)/).filter(Boolean);
  if (sentences.length <= size) return [line];
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += size) {
    chunks.push(sentences.slice(i, i + size).join(" "));
  }
  return chunks;
}

function ParaBlock({ lines }: { lines: string[] }) {
  // 불릿(·, -, ◦)·번호(1. 2. 3.) 마커는 표시하지 않고 줄바꿈만 유지한다 (세 줄 요약·체크포인트 등)
  const paragraphs = lines.flatMap((line) => splitIntoSentenceChunks(line.replace(/^(?:[-·◦]|\d+\.)\s/, "")));
  return (
    <div className="mx-6 mt-3 space-y-3">
      {paragraphs.map((p, idx) => (
        <p key={idx} className="text-[17px] text-slate-700 leading-relaxed">
          <InlineText text={p} />
        </p>
      ))}
    </div>
  );
}

// 관전 포인트 목차 — 이슈 헤더와 동일하게 세로 구분선은 목차 제목에만 단다
function WatchPointHeadingBlock({ text }: { text: string }) {
  return (
    <div className="mx-6 mt-8 mb-2.5 border-l-4 border-primary pl-4">
      <h3 className="text-[17px] font-black text-primary leading-snug">{text}</h3>
    </div>
  );
}

// 관전 포인트 본문 — "항목 · 항목 · 항목" 한 줄을 항목별 줄로 나누되,
// 다른 본문 단락과 동일한 폰트로 표시한다 (항목별 세로 구분선 없음)
function WatchPointBlock({ lines }: { lines: string[] }) {
  const items = lines
    .flatMap((line) => line.replace(/^(?:[-·◦]|\d+\.)\s/, "").split(/\s+[·•]\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="mx-6 pl-4 space-y-2">
      {items.map((item, idx) => (
        <p key={idx} className="text-[17px] text-slate-700 leading-relaxed">
          <InlineText text={item} />
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BriefingReportViewer — 메인 컴포넌트 (export)
// ─────────────────────────────────────────────────────────────────────────────

export function BriefingReportViewer({
  report,
  kicker = "Daily Market Briefing",
  subtitle = "오버나이트 시장 분석 리포트",
  pdfFilePrefix = "Daily_Briefing",
  onClose,
  onStockClick,
}: {
  report: string;
  kicker?: string;
  subtitle?: string;
  pdfFilePrefix?: string;
  /** 팝업(단독 오버레이)으로 띄울 때 툴바에 닫기 버튼을 노출한다 */
  onClose?: () => void;
  /** 제공 시 본문의 "종목명(티커)" 표기가 클릭 가능한 링크가 된다 */
  onStockClick?: (name: string, ticker: string) => void;
}) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const dateStr = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  })
    .format(new Date())
    .replace(/\. /g, ".")
    .replace(/\.$/, "");

  const blocks = parseReport(normalizeReportPunctuation(report));

  const handleCopy = async () => {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePdf = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    // 캡처 전 화면 전용 장식 제거 — 태그 밑줄 숨김(.pdf-export CSS) + 클릭 하이라이트 해제
    clearBriefHighlights();
    reportRef.current.classList.add("pdf-export");
    try {
      const html2canvas = (await import("html2canvas")).default;
      // jsPDF v4 대응: named export와 default export 모두 처리
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jsPDFModule = (await import("jspdf")) as any;
      const JsPDF =
        jsPDFModule.jsPDF ??
        jsPDFModule.default?.jsPDF ??
        jsPDFModule.default;

      // ── 섹션 인식 페이지네이션 ──────────────────────────────────────────────
      // 캔버스를 A4 높이로 기계적으로 자르면 문장·섹션이 페이지 경계에서 잘린다.
      // 캡처 전 각 블록의 위치를 재두고, 목차(heading)~다음 목차 전까지를 한 섹션으로 묶어
      // 섹션이 남은 공간에 안 들어가면 통째로 다음 페이지 상단으로 밀어낸다
      // (이전 페이지 하단은 공란). 섹션 자체가 한 페이지보다 길면 블록 경계에서만 나눈다.
      const container = reportRef.current;
      const containerRect = container.getBoundingClientRect();
      const blockRects = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-block]")).map((el) => {
        const r = el.getBoundingClientRect();
        return { kind: el.dataset.pdfBlock, top: r.top - containerRect.top, bottom: r.bottom - containerRect.top };
      });

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfW: number = pdf.internal.pageSize.getWidth();
      const pdfH: number = pdf.internal.pageSize.getHeight();
      const ratio = canvas.width / containerRect.width;   // DOM px → 캔버스 px
      const pageHpx = (pdfH / pdfW) * canvas.width;       // A4 한 페이지 높이 (캔버스 px)

      // 블록 → 섹션 그루핑 (heading에서 새 섹션 시작)
      type Span = { top: number; bottom: number };
      const sections: Array<Span & { blocks: Span[] }> = [];
      for (const b of blockRects) {
        const span = { top: b.top * ratio, bottom: b.bottom * ratio };
        if (b.kind === "heading" || !sections.length) {
          sections.push({ ...span, blocks: [span] });
        } else {
          const s = sections[sections.length - 1];
          s.bottom = span.bottom;
          s.blocks.push(span);
        }
      }

      // 분할 불가 단위 산출 — 한 페이지에 들어가는 섹션은 통째로, 넘치는 섹션은 블록 단위로
      const units: Span[] = sections.flatMap((s) =>
        s.bottom - s.top <= pageHpx ? [{ top: s.top, bottom: s.bottom }] : s.blocks,
      );

      // 페이지 시작 위치 계산
      const breaks: number[] = [0];
      let pageStart = 0;
      for (const u of units) {
        if (u.bottom - pageStart <= pageHpx) continue;
        if (u.bottom - u.top <= pageHpx) {
          pageStart = u.top;
          breaks.push(pageStart);
        } else {
          // 단일 블록이 한 페이지보다 긴 극단 케이스 — 새 페이지에서 시작 후 강제 분할
          if (u.top > pageStart) { pageStart = u.top; breaks.push(pageStart); }
          while (u.bottom - pageStart > pageHpx) { pageStart += pageHpx; breaks.push(pageStart); }
        }
      }
      // 마지막 단위 이후 꼬리(푸터 등) 잔여 오버플로 처리
      while (canvas.height - pageStart > pageHpx) { pageStart += pageHpx; breaks.push(pageStart); }

      // 페이지별로 캔버스를 잘라 출력 (잘린 지점~다음 페이지 시작 사이는 공란으로 남는다)
      breaks.forEach((startY, i) => {
        const contentEnd = i + 1 < breaks.length ? breaks[i + 1] : canvas.height;
        const sliceH = Math.min(pageHpx, contentEnd - startY);
        if (sliceH <= 0) return;
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = Math.ceil(sliceH);
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, startY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        if (i > 0) pdf.addPage();
        pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, pdfW, (sliceH * pdfW) / canvas.width);
      });

      pdf.save(`${pdfFilePrefix}_${dateStr.replace(/\./g, "")}.pdf`);
    } catch (e) {
      console.warn("PDF export 실패, 인쇄 다이얼로그로 폴백:", e);
      window.print();
    } finally {
      reportRef.current?.classList.remove("pdf-export");
      setExporting(false);
    }
  };

  return (
    <StockClickContext.Provider value={onStockClick ?? null}>
      {/* 인쇄 시 사이드바·헤더 숨김 처리 + PDF 캡처/인쇄 시 화면 전용 장식(태그 밑줄) 숨김 */}
      <style>{`
        .pdf-export .tag-underline { border-bottom-color: transparent !important; }
        @media print {
          .sidebar-dark,
          nav.sidebar-dark { display: none !important; }
          section[class*="z-50"] { display: none !important; }
          .print-toolbar { display: none !important; }
          .tag-underline { border-bottom-color: transparent !important; }
          @page { size: A4; margin: 10mm; }
          body { background: white !important; }
          .report-container { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
        }
      `}</style>

      <div className="mt-4">
        {/* 툴바 — 인쇄 시 자동 숨김 */}
        <div className="print-toolbar print:hidden flex items-center justify-end gap-2 mb-3">
          <button
            onClick={handleCopy}
            className="rounded border border-[#DDE8E5] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#7A9488] hover:bg-[#EBF0EE] transition"
          >
            {copied ? "✓ 복사 완료" : "Markdown 복사"}
          </button>
          <button
            onClick={handlePdf}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-[11px] font-bold text-white shadow hover:bg-primary-light disabled:opacity-60 transition"
          >
            <Printer size={13} />
            {exporting ? "출력 중..." : "PDF 다운로드"}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="닫기"
              className="flex items-center justify-center rounded-lg border border-[#DDE8E5] bg-white p-1.5 text-[#7A9488] hover:bg-[#EBF0EE] transition"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 리포트 본문 — html2canvas 캡처 대상 */}
        <div
          ref={reportRef}
          className="report-container rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm"
        >
          <ReportHeader date={dateStr} kicker={kicker} subtitle={subtitle} />

          <div className="pb-10">
            {blocks.map((block, i) => {
              // data-pdf-block: PDF 페이지네이션 단위 마커 — "heading"에서 새 섹션이 시작되고,
              // 섹션이 페이지 경계에 걸리면 통째로 다음 페이지로 밀어낸다 (handlePdf 참고)
              const isHeading = block.kind === "h2" || block.kind === "heading";
              const rendered = (() => {
                switch (block.kind) {
                  case "summary":  return <SummaryBlock text={block.text} />;
                  case "h2":
                    return /관전\s*포인트/.test(block.text)
                      ? <WatchPointHeadingBlock text={block.text} />
                      : <H2Block text={block.text} />;
                  case "heading":
                    return /관전\s*포인트/.test(block.text)
                      ? <WatchPointHeadingBlock text={block.text} />
                      : <HeadingBlock text={block.text} />;
                  case "issue":    return <IssueBlock title={block.title} lines={block.lines} />;
                  case "table":    return <TableBlock headers={block.headers} rows={block.rows} />;
                  case "source":   return <SourceBlock id={block.id} text={block.text} />;
                  case "judgment": return <JudgmentBlock num={block.num} text={block.text} />;
                  case "para": {
                    // "관전 포인트" 헤더 바로 뒤 단락은 이슈 헤더와 같은 세로 구분선 항목으로 표시
                    const prev = blocks[i - 1];
                    const isWatchPoint =
                      prev != null &&
                      (prev.kind === "h2" || prev.kind === "heading") &&
                      /관전\s*포인트/.test(prev.text);
                    return isWatchPoint
                      ? <WatchPointBlock lines={block.lines} />
                      : <ParaBlock lines={block.lines} />;
                  }
                  default:         return null;
                }
              })();
              if (!rendered) return null;
              return (
                <div key={i} data-pdf-block={isHeading ? "heading" : "content"}>
                  {rendered}
                </div>
              );
            })}
          </div>

          {/* 리포트 하단 */}
          <div className="border-t border-slate-100 bg-slate-50 px-8 py-3 flex items-center justify-between print-toolbar print:hidden">
            <p className="text-[10px] text-slate-400">
              AI 생성 보고서 · 투자 참고용으로만 활용하세요
            </p>
            <p className="text-[10px] text-slate-400">Hoons_Platform · {dateStr}</p>
          </div>
        </div>
      </div>
    </StockClickContext.Provider>
  );
}
