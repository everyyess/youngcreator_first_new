"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import type { ReportMetricChart } from "@/Engine/Research-Engine/types";

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
type EvidenceTone = "fact" | "quote" | "judgment";

function PdfInlineLabel({ label, tone }: { label: string; tone: EvidenceTone }) {
  return (
    <span aria-hidden="true" className={`pdf-inline-label pdf-inline-label-${tone}`}>
      {label}
    </span>
  );
}

function StaticBadge({ label, tone }: { label: string; tone: "blue" | "amber" }) {
  const cls = tone === "blue" ? "bg-indigo-100 text-[#2f2f9d]" : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold mx-0.5 align-middle ${cls}`}>
      {label}
    </span>
  );
}

// 각주 없는 태그의 호버 표시 — 문장에 점선 밑줄, 마우스 오버 시 태그 툴팁 (TAB4 스타일, 클릭 없음)
function HoverTag({
  label,
  tone,
  children,
  important = false,
}: {
  label: string;
  tone: EvidenceTone;
  children: React.ReactNode;
  important?: boolean;
}) {
  const underline =
    tone === "fact" ? "border-indigo-400/50 group-hover:bg-indigo-50"
      : tone === "quote" ? "border-amber-400 group-hover:bg-amber-50"
        : "border-sky-400 group-hover:bg-sky-100";
  const tip = tone === "fact" ? "bg-[#2f2f9d]" : tone === "quote" ? "bg-amber-500" : "bg-sky-600";
  const printRef = tone === "fact" ? "legend:fact" : tone === "quote" ? "legend:quote" : "legend:judgment";
  return (
    <span
      className="group relative mr-1 inline"
      data-pdf-note-refs={printRef}
      data-pdf-note-kind={tone}
    >
      <span className={`tag-underline rounded-sm border-b border-dashed transition-colors duration-150 ${tone !== "fact" ? "evidence-underline" : ""} ${important ? "important-evidence font-extrabold" : ""} ${underline}`}>
        {children}
      </span>
      <PdfInlineLabel label={`[${label}]`} tone={tone} />
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
          className="mx-0.5 inline-flex items-center font-black text-[#2f2f9d] transition-colors duration-150 hover:text-[#24247c] hover:underline cursor-pointer"
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
        const isImportantEvidence = (isQuote || isJudgment) && /\*\*[^*]+\*\*/.test(displayText);

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
            <HoverTag
              key={idx}
              label={isFact ? "팩트" : "인용"}
              tone={isFact ? "fact" : "quote"}
              important={isImportantEvidence}
            >
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

        const printRefs = isJudgment
          ? `judgment:${judgmentNum}`
          : citedIds.map((id) => `source:${id.slice(1)}`).join(",");
        const printLabel = isJudgment
          ? `[판단 ${judgmentNum}]`
          : `[${isFact ? "팩트" : "인용"} ${citedIds.join(", ")}]`;

        return (
          <span
            key={idx}
            onClick={handleClick}
            className="group relative mr-1 inline cursor-pointer"
            data-pdf-note-refs={printRefs}
            data-pdf-note-kind={isFact ? "fact" : isQuote ? "quote" : "judgment"}
          >
            <span className={`tag-underline rounded-sm border-b border-dashed transition-colors duration-150 ${isQuote || isJudgment ? "evidence-underline" : ""} ${isImportantEvidence ? "important-evidence font-extrabold" : ""} ${isFact ? "border-indigo-400/50 group-hover:bg-indigo-50"
                : isQuote ? "border-amber-400 group-hover:bg-amber-50"
                  : "border-sky-400 group-hover:bg-sky-100"
              }`}>
              {renderedText}
            </span>
            <PdfInlineLabel
              label={printLabel}
              tone={isFact ? "fact" : isQuote ? "quote" : "judgment"}
            />
            <span className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md px-3 py-1 text-center text-[11px] font-black leading-snug text-white shadow-md group-hover:block ${isFact ? "bg-[#2f2f9d]" : isQuote ? "bg-amber-500" : "bg-sky-600"
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
    <div className="bg-[#2f2f9d] text-white px-8 py-7">
      <div>
        <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-200 uppercase mb-2">
          {kicker}
        </p>
        <h1 className="text-2xl font-black tracking-tight leading-none">{date}</h1>
        <p className="text-xs text-indigo-100 mt-2 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
}

function SummaryBlock({ text }: { text: string }) {
  return (
    <div className="mx-6 mt-6 overflow-visible rounded-xl bg-indigo-50 border border-indigo-100 px-6 py-5.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-indigo-500 mb-2">
        한 줄 평
      </p>
      <p className="overflow-visible pb-0.5 text-[17px] font-normal text-indigo-900 leading-[1.75]">
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
      <h3 className="text-[15px] font-black text-[#2f2f9d]">{text}</h3>
    </div>
  );
}

function IssueBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="mx-6 mt-5">
      <div className="border-l-4 border-[#2f2f9d] pl-4 mb-2.5">
        <h3 className="text-[17px] font-black text-[#2f2f9d] leading-snug">
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
                className="bg-[#2f2f9d] text-white text-xs font-bold px-4 py-3 text-left whitespace-nowrap"
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
      <span className="mr-1.5 font-black text-[#2f2f9d]">#{id}</span>{text}
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
    <div className="mx-6 mt-8 mb-2.5 border-l-4 border-[#2f2f9d] pl-4">
      <h3 className="text-[17px] font-black text-[#2f2f9d] leading-snug">{text}</h3>
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

function MetricChartGrid({ charts }: { charts: ReportMetricChart[] }) {
  return (
    <div className="mx-6 mt-6" data-pdf-block="content">
      <div className="mb-3 flex items-end justify-between border-b border-slate-200 pb-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Economic Indicators</p>
          <h3 className="text-[15px] font-black text-[#2f2f9d]">핵심 지표 그래프</h3>
        </div>
        <span className="text-[10px] font-semibold text-slate-400">FRED · ECOS 실제 관측치</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {charts.map((chart) => {
          const width = 520;
          const height = 230;
          const plotLeft = 70;
          const plotRight = width - 18;
          const plotTop = 38;
          const plotBottom = height - 52;
          const values = chart.points.map((point) => point.value);
          const min = Math.min(...values);
          const max = Math.max(...values);
          const rawSpan = max - min;
          const domainPadding = rawSpan > 0 ? rawSpan * 0.12 : Math.max(Math.abs(max) * 0.05, 1);
          const domainMin = min - domainPadding;
          const domainMax = max + domainPadding;
          const span = domainMax - domainMin;
          const decimals = Math.abs(span) < 1 ? 3 : Math.abs(span) < 20 ? 2 : 1;
          const formatValue = (value: number) => value.toLocaleString("ko-KR", {
            maximumFractionDigits: decimals,
          });
          const coords = chart.points.map((point, index) => {
            const x = plotLeft + (index / Math.max(chart.points.length - 1, 1)) * (plotRight - plotLeft);
            const y = plotBottom - ((point.value - domainMin) / span) * (plotBottom - plotTop);
            return { ...point, x, y };
          });
          const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
            y: plotTop + ratio * (plotBottom - plotTop),
            value: domainMax - ratio * span,
          }));
          const parsedDates = chart.points.map((point) => Date.parse(point.date));
          const validDates = parsedDates.filter(Number.isFinite);
          const dateSpanMs = validDates.length >= 2
            ? Math.max(...validDates) - Math.min(...validDates)
            : 0;
          const dateSpanYears = dateSpanMs / (1_000 * 60 * 60 * 24 * 365.25);
          const formatDateTick = (date: string) => {
            const match = date.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
            if (!match) return date;
            if (dateSpanYears >= 4) return match[1];
            if (dateSpanYears >= 1) return match[1] + "." + match[2];
            return match[2] + (match[3] ? "." + match[3] : "월");
          };
          const targetTickCount = chart.points.length <= 5
            ? chart.points.length
            : dateSpanYears >= 4 ? 4 : 5;
          const xTickIndexes = Array.from(new Set(
            Array.from({ length: targetTickCount }, (_, index) => Math.round(
              index * (chart.points.length - 1) / Math.max(targetTickCount - 1, 1),
            )),
          ));
          const lastIndex = chart.points.length - 1;
          const maxIndex = values.indexOf(max);
          const minIndex = values.indexOf(min);
          let largestMoveIndex = lastIndex;
          let largestMove = -1;
          for (let index = 1; index < values.length; index += 1) {
            const move = Math.abs(values[index] - values[index - 1]);
            if (move > largestMove) {
              largestMove = move;
              largestMoveIndex = index;
            }
          }
          // 최신·최고·최저·급변점을 먼저 확보한 뒤 모든 관측점을 후보에 넣는다.
          // 실제 텍스트 사각형이 겹칠 때만 생략하고 위/아래 위치를 바꿔 최대한 많은 값을 표시한다.
          const labelCandidates = Array.from(new Set([
            lastIndex, maxIndex, minIndex, largestMoveIndex, 0,
            ...chart.points.map((_, index) => index),
          ]));
          const labelPlacements = new Map<number, { x: number; y: number; rect: { left: number; right: number; top: number; bottom: number } }>();
          for (const index of labelCandidates) {
            const point = coords[index];
            const label = formatValue(point.value);
            const labelWidth = Math.max(24, label.length * 6.2);
            // 양 끝 관측치는 레이블 중심을 그래프 안쪽으로 이동해 잘리지 않게 한다.
            const labelX = Math.min(
              plotRight - labelWidth / 2 - 3,
              Math.max(plotLeft + labelWidth / 2 + 3, point.x),
            );
            const yCandidates = point.y < plotTop + 26
              ? [point.y + 17, point.y - 10]
              : [point.y - 10, point.y + 17];
            for (const y of yCandidates) {
              const rect = {
                left: labelX - labelWidth / 2 - 3,
                right: labelX + labelWidth / 2 + 3,
                top: y - 10,
                bottom: y + 3,
              };
              if (rect.left < plotLeft || rect.right > plotRight || rect.top < plotTop - 4 || rect.bottom > plotBottom - 2) continue;
              const collides = Array.from(labelPlacements.values()).some((placed) =>
                rect.left < placed.rect.right && rect.right > placed.rect.left &&
                rect.top < placed.rect.bottom && rect.bottom > placed.rect.top,
              );
              if (!collides) {
                labelPlacements.set(index, { x: labelX, y, rect });
                break;
              }
            }
          }
          const latest = chart.points[chart.points.length - 1];
          return (
            <div key={chart.source + chart.title} className="overflow-visible rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 break-words pb-0.5 text-[11px] font-black leading-[1.45] text-slate-700">{chart.title}</p>
                <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-black text-[#2f2f9d]">{chart.source}</span>
              </div>
              <p className="mb-1 text-[10px] font-bold text-slate-400">
                최근 {formatValue(latest.value)} {chart.unit}
              </p>
              <svg viewBox={"0 0 " + width + " " + height} className="h-48 w-full" role="img" aria-label={chart.title + " 시계열 그래프"}>
                <title>{chart.title + " — 날짜별 " + (chart.unit || "관측값")}</title>
                {yTicks.map((tick, index) => (
                  <g key={index}>
                    <line x1={plotLeft} y1={tick.y} x2={plotRight} y2={tick.y} stroke="#D9DCF7" strokeWidth="1" />
                    <text x={plotLeft - 8} y={tick.y + 3} textAnchor="end" fontSize="9" fill="#64748B">
                      {formatValue(tick.value)}
                    </text>
                  </g>
                ))}
                <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} stroke="#94A3B8" strokeWidth="1.2" />
                <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke="#94A3B8" strokeWidth="1.2" />
                <polyline
                  fill="none"
                  stroke="#2f2f9d"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={coords.map((point) => `${point.x},${point.y}`).join(" ")}
                />
                {coords.map((point, index) => (
                  <g key={point.date}>
                    <circle cx={point.x} cy={point.y} r={index === coords.length - 1 ? 4 : 3} fill="#2f2f9d">
                      <title>{point.date + ": " + formatValue(point.value) + " " + chart.unit}</title>
                    </circle>
                    {labelPlacements.has(index) && (
                      <text
                        x={labelPlacements.get(index)!.x}
                        y={labelPlacements.get(index)!.y}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="700"
                        fill="#1E3A8A"
                        stroke="white"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {formatValue(point.value)}
                      </text>
                    )}
                  </g>
                ))}
                {xTickIndexes.map((index) => {
                  const point = coords[index];
                  return (
                    <g key={point.date}>
                      <line x1={point.x} y1={plotBottom} x2={point.x} y2={plotBottom + 4} stroke="#94A3B8" strokeWidth="1" />
                      <text x={point.x} y={plotBottom + 16} textAnchor="middle" fontSize="9" fill="#64748B">{formatDateTick(point.date)}</text>
                    </g>
                  );
                })}
                <text x={(plotLeft + plotRight) / 2} y={height - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#475569">
                  날짜
                </text>
                <text
                  x={plotLeft}
                  y="15"
                  textAnchor="start"
                  fontSize="10"
                  fontWeight="700"
                  fill="#475569"
                >
                  {chart.unit ? "관측값 (" + chart.unit + ")" : "관측값"}
                </text>
              </svg>
            </div>
          );
        })}
      </div>
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
  metricCharts = [],
}: {
  report: string;
  kicker?: string;
  subtitle?: string;
  pdfFilePrefix?: string;
  /** 팝업(단독 오버레이)으로 띄울 때 툴바에 닫기 버튼을 노출한다 */
  onClose?: () => void;
  /** 제공 시 본문의 "종목명(티커)" 표기가 클릭 가능한 링크가 된다 */
  onStockClick?: (name: string, ticker: string) => void;
  metricCharts?: ReportMetricChart[];
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
  const pdfReferenceStart = blocks.findIndex((block) =>
    (block.kind === "h2" || block.kind === "heading") && /^(?:판단\s*근거|출처)$/.test(block.text.trim()),
  );

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

      // ── 섹션·페이지별 주석 인식 페이지네이션 ───────────────────────────────
      // 화면에서는 호버로 확인하는 팩트·인용·판단 정보를 출력물에서는 문장 뒤 표식과
      // 해당 표식이 실제 등장한 페이지 하단의 주석으로 옮긴다. 같은 근거가 여러 페이지에
      // 등장하면 각 페이지에 반복하고, 근거 표식이 없는 페이지에는 주석 영역을 만들지 않는다.
      const container = reportRef.current;
      const containerRect = container.getBoundingClientRect();
      const blockRects = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-block]"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          // 글자의 안티앨리어싱 픽셀이 페이지 절단선에 닿지 않도록 블록 하단에 안전 여백을 둔다.
          return {
            kind: el.dataset.pdfBlock,
            top: r.top - containerRect.top,
            bottom: r.bottom - containerRect.top + 6,
            visibleHeight: r.height,
          };
        })
        // PDF에서 숨긴 출처·판단 근거 블록은 rect가 0이다. 안전 여백을 더하기 전의
        // 실제 높이로 걸러야 페이지 끝이 음수 좌표로 계산되지 않는다.
        .filter((rect) => rect.visibleHeight > 1);
      const markerElements = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-note-refs]"));
      const sourceToneByRef = new Map<string, Set<EvidenceTone>>();
      for (const el of markerElements) {
        const tone = el.dataset.pdfNoteKind as EvidenceTone | undefined;
        if (!tone) continue;
        for (const ref of (el.dataset.pdfNoteRefs ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
          if (!ref.startsWith("source:")) continue;
          const tones = sourceToneByRef.get(ref) ?? new Set<EvidenceTone>();
          tones.add(tone);
          sourceToneByRef.set(ref, tones);
        }
      }
      const markerDomRects = markerElements
        .flatMap((el) => {
          const refs = (el.dataset.pdfNoteRefs ?? "").split(",").map((value) => value.trim()).filter(Boolean);
          return Array.from(el.getClientRects()).map((rect) => ({
            refs,
            top: rect.top - containerRect.top,
            bottom: rect.bottom - containerRect.top,
          }));
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
      const firstPageHpx = (pdfH / pdfW) * canvas.width;
      const continuationTopMm = 14;
      const continuationPageHpx = ((pdfH - continuationTopMm) / pdfW) * canvas.width;

      type PdfNote = { key: string; label: string; text: string; tone: EvidenceTone };
      const noteCatalog = new Map<string, PdfNote>([
        ["legend:fact", { key: "legend:fact", label: "[팩트]", text: "정량 데이터 또는 원천자료로 확인된 사실입니다.", tone: "fact" }],
        ["legend:quote", { key: "legend:quote", label: "[인용]", text: "뉴스·리포트 등 외부 자료의 주장이나 견해입니다.", tone: "quote" }],
        ["legend:judgment", { key: "legend:judgment", label: "[판단]", text: "보고서가 수집 근거를 종합해 도출한 해석입니다.", tone: "judgment" }],
      ]);
      for (const block of blocks) {
        if (block.kind === "source") {
          noteCatalog.set(`source:${block.id}`, {
            key: `source:${block.id}`,
            label: `[#${block.id}]`,
            text: `출처 · ${block.text}`,
            tone: sourceToneByRef.get(`source:${block.id}`)?.has("quote") ? "quote" : "fact",
          });
        } else if (block.kind === "judgment") {
          noteCatalog.set(`judgment:${block.num}`, {
            key: `judgment:${block.num}`,
            label: `[판단 ${block.num}]`,
            text: `판단 근거 · ${block.text}`,
            tone: "judgment",
          });
        }
      }

      const markerRects = markerDomRects.map((rect) => ({
        refs: rect.refs,
        top: rect.top * ratio,
        bottom: rect.bottom * ratio,
      }));
      const notesForRange = (start: number, end: number) => {
        const keys = new Set<string>();
        for (const marker of markerRects) {
          if (marker.bottom <= start || marker.top >= end) continue;
          marker.refs.forEach((ref) => keys.add(ref));
        }
        return Array.from(keys).map((key) => noteCatalog.get(key)).filter((note): note is PdfNote => !!note);
      };

      const measureContext = document.createElement("canvas").getContext("2d");
      if (!measureContext) throw new Error("PDF 주석 측정용 캔버스를 만들 수 없습니다.");
      const noteFontSize = 18;
      const noteLineHeight = 25;
      const noteSidePadding = 46;
      const noteTextWidth = canvas.width - noteSidePadding * 2;
      type PdfNoteLine = { label: string | null; text: string; tone: EvidenceTone };
      const wrapNote = (note: PdfNote) => {
        measureContext.font = `${noteFontSize}px Pretendard, sans-serif`;
        const labelWidth = measureContext.measureText(note.label).width + 10;
        const words = note.text.split(/\s+/);
        const lines: PdfNoteLine[] = [];
        let line = "";
        let firstLine = true;
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          const availableWidth = firstLine ? noteTextWidth - labelWidth : noteTextWidth - 20;
          if (line && measureContext.measureText(candidate).width > availableWidth) {
            lines.push({ label: firstLine ? note.label : null, text: line, tone: note.tone });
            firstLine = false;
            line = word;
          } else {
            line = candidate;
          }
        }
        if (line) lines.push({ label: firstLine ? note.label : null, text: line, tone: note.tone });
        return lines;
      };
      const noteLayout = (notes: PdfNote[]) => {
        if (!notes.length) return { height: 0, lines: [] as PdfNoteLine[] };
        const lines = notes.flatMap(wrapNote);
        return { height: 54 + lines.length * noteLineHeight, lines };
      };

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
        s.bottom - s.top <= continuationPageHpx ? [{ top: s.top, bottom: s.bottom }] : s.blocks,
      );
      const contentBottom = units.length ? Math.min(canvas.height, units[units.length - 1].bottom) : canvas.height;

      // 각 페이지의 주석 높이를 먼저 확보한 뒤 본문을 배치한다. 주석이 늘어나면 해당 페이지의
      // 본문 용량을 줄여 다음 섹션을 다음 페이지로 넘기므로 본문과 주석이 겹치지 않는다.
      type PdfPage = { start: number; end: number; pageHeight: number; notes: PdfNote[] };
      const pages: PdfPage[] = [];
      let pageStart = 0;
      let unitIndex = 0;
      while (pageStart < contentBottom - 1) {
        while (unitIndex < units.length && units[unitIndex].bottom <= pageStart + 1) unitIndex += 1;
        const pageHeight = pages.length === 0 ? firstPageHpx : continuationPageHpx;
        let acceptedEnd = pageStart;
        let nextUnitIndex = unitIndex;

        for (let index = unitIndex; index < units.length; index += 1) {
          const candidateEnd = units[index].bottom;
          const candidateNotes = notesForRange(pageStart, candidateEnd);
          const availableHeight = pageHeight - noteLayout(candidateNotes).height;
          if (candidateEnd - pageStart > availableHeight) break;
          acceptedEnd = candidateEnd;
          nextUnitIndex = index + 1;
        }

        if (acceptedEnd > pageStart) {
          if (nextUnitIndex >= units.length) {
            const tailNotes = notesForRange(pageStart, contentBottom);
            if (contentBottom - pageStart <= pageHeight - noteLayout(tailNotes).height) {
              acceptedEnd = contentBottom;
            }
          }
          pages.push({
            start: pageStart,
            end: acceptedEnd,
            pageHeight,
            notes: notesForRange(pageStart, acceptedEnd),
          });
          pageStart = nextUnitIndex < units.length ? units[nextUnitIndex].top : acceptedEnd;
          unitIndex = nextUnitIndex;
          continue;
        }

        // 한 블록 자체가 한 페이지보다 긴 예외: 주석 높이를 반복 반영해 안전한 지점에서 분할한다.
        let hardEnd = Math.min(contentBottom, pageStart + pageHeight);
        for (let iteration = 0; iteration < 4; iteration += 1) {
          const hardNotes = notesForRange(pageStart, hardEnd);
          const availableHeight = Math.max(pageHeight - noteLayout(hardNotes).height, pageHeight * 0.4);
          hardEnd = Math.min(contentBottom, pageStart + availableHeight);
        }
        if (hardEnd <= pageStart + 1) throw new Error("PDF 페이지를 분할할 공간이 부족합니다.");
        pages.push({
          start: pageStart,
          end: hardEnd,
          pageHeight,
          notes: notesForRange(pageStart, hardEnd),
        });
        pageStart = hardEnd;
      }

      const drawNotes = (ctx: CanvasRenderingContext2D, page: PdfPage) => {
        const layout = noteLayout(page.notes);
        if (!layout.height) return;
        const top = page.pageHeight - layout.height;
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, top, canvas.width, layout.height);
        ctx.strokeStyle = "#444444";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(noteSidePadding, top + 8);
        ctx.lineTo(canvas.width - noteSidePadding, top + 8);
        ctx.stroke();
        ctx.fillStyle = "#1e3a8a";
        ctx.font = `800 19px Pretendard, sans-serif`;
        ctx.fillText("주석 - 문장 분류 및 근거", noteSidePadding, top + 32);
        const noteColors: Record<EvidenceTone, string> = {
          fact: "#4338ca",
          quote: "#b45309",
          judgment: "#0369a1",
        };
        let y = top + 55;
        for (const line of layout.lines) {
          let textX = noteSidePadding + 20;
          if (line.label) {
            ctx.font = `800 ${noteFontSize}px Pretendard, sans-serif`;
            ctx.fillStyle = noteColors[line.tone];
            ctx.fillText(line.label, noteSidePadding, y);
            textX = noteSidePadding + ctx.measureText(line.label).width + 10;
          }
          ctx.font = `${noteFontSize}px Pretendard, sans-serif`;
          ctx.fillStyle = "#111111";
          ctx.fillText(line.text, textX, y);
          y += noteLineHeight;
        }
        ctx.restore();
      };

      pages.forEach((page, i) => {
        const sliceH = Math.min(page.pageHeight - noteLayout(page.notes).height, page.end - page.start);
        const topMarginMm = i === 0 ? 0 : continuationTopMm;
        if (sliceH <= 0) return;
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = Math.ceil(page.pageHeight);
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, page.start, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        drawNotes(ctx, page);
        if (i > 0) pdf.addPage();
        pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, topMarginMm, pdfW, (page.pageHeight * pdfW) / canvas.width);
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
      {/* 인쇄 시 사이드바·헤더 숨김 처리 + PDF 캡처/인쇄 시 주석 표식을 일관된 크기로 표시 */}
      <style>{`
        .pdf-inline-label { display: none; }
        .tag-underline.evidence-underline {
          border-bottom-color: transparent !important;
          text-decoration-line: underline;
          text-decoration-thickness: 1.25px;
          text-underline-offset: 4px;
          text-decoration-skip-ink: auto;
        }
        .tag-underline.important-evidence { font-weight: 800 !important; }
        .pdf-export .tag-underline { border-bottom-color: transparent !important; }
        .pdf-export .tag-underline.important-evidence {
          border-bottom-color: transparent !important;
        }
        .pdf-export .pdf-reference-block { display: none !important; }
        .pdf-export .pdf-inline-label {
          display: inline;
          margin-left: 4px;
          color: #334155;
          font-size: 8px;
          font-weight: 800;
          line-height: inherit;
          vertical-align: baseline;
          white-space: nowrap;
        }
        .pdf-export .pdf-inline-label-fact { color: #4338ca; }
        .pdf-export .pdf-inline-label-quote { color: #b45309; }
        .pdf-export .pdf-inline-label-judgment { color: #0369a1; }
        @media print {
          .sidebar-dark,
          nav.sidebar-dark { display: none !important; }
          section[class*="z-50"] { display: none !important; }
          .print-toolbar { display: none !important; }
          .tag-underline { border-bottom-color: transparent !important; }
          .tag-underline.important-evidence {
            border-bottom-color: transparent !important;
          }
          @page { size: A4; margin: 10mm; }
          body { background: white !important; }
          body, .report-container { print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
          .report-container { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
        }
      `}</style>

      <div className="mt-4">
        {/* 툴바 — 인쇄 시 자동 숨김 */}
        <div className="print-toolbar print:hidden flex items-center justify-end gap-2 mb-3">
          <button
            onClick={handleCopy}
            className="rounded border border-indigo-100 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-indigo-50 transition"
          >
            {copied ? "✓ 복사 완료" : "Markdown 복사"}
          </button>
          <button
            onClick={handlePdf}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg bg-[#2f2f9d] px-4 py-1.5 text-[11px] font-bold text-white shadow hover:bg-[#24247c] disabled:opacity-60 transition"
          >
            <Printer size={13} />
            {exporting ? "출력 중..." : "PDF 다운로드"}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="닫기"
              className="flex items-center justify-center rounded-lg border border-indigo-100 bg-white p-1.5 text-slate-500 hover:bg-indigo-50 transition"
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

          {metricCharts.length > 0 && <MetricChartGrid charts={metricCharts} />}

          <div className="pb-10">
            {blocks.map((block, i) => {
              // data-pdf-block: PDF 페이지네이션 단위 마커 — "heading"에서 새 섹션이 시작되고,
              // 섹션이 페이지 경계에 걸리면 통째로 다음 페이지로 밀어낸다 (handlePdf 참고)
              const isHeading = block.kind === "h2" || block.kind === "heading";
              const isReference =
                block.kind === "source" || block.kind === "judgment" ||
                (pdfReferenceStart >= 0 && i >= pdfReferenceStart);
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
                <div
                  key={i}
                  data-pdf-block={isHeading ? "heading" : "content"}
                  className={isReference ? "pdf-reference-block" : undefined}
                >
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
            <p className="text-[10px] text-slate-400">{dateStr}</p>
          </div>
        </div>
      </div>
    </StockClickContext.Provider>
  );
}
