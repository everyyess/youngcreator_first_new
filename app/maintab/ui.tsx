"use client";

import { Children, useEffect, useRef, useState, type CSSProperties } from "react";
import { BadgeCheck } from "lucide-react";

export function questionLabel(label: string) {
  return label.startsWith("Q. ") ? label : `Q. ${label}`;
}

function optionGridClass(count: number) {
  if (count <= 3) return "sm:grid-cols-2 lg:grid-cols-3";
  if (count === 4) return "sm:grid-cols-2";
  return "sm:grid-cols-2 xl:grid-cols-3";
}

const optionButtonClass =
  "min-h-12 rounded-lg border px-4 py-3 text-left text-[15px] font-semibold leading-6 transition";
const optionIdleClass = "border-gray-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50";
const optionSelectedClass = "border-blue-700 bg-blue-100 text-blue-800 font-semibold shadow-sm";
const checkerBlue = { bg: "#e2f2ff", border: "#b9dcff" };
const checkerGray = { bg: "#f8fafc", border: "#d7dde8" };

export function CheckerboardGrid({
  children,
  className,
  startIndex = 0,
  invert = false,
  itemClassName,
}: {
  children: React.ReactNode;
  className: string;
  startIndex?: number;
  invert?: boolean;
  itemClassName?: string | ((index: number) => string);
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const node = gridRef.current;
    if (!node) return;

    const updateColumnCount = () => {
      const gridItems = Array.from(node.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      const firstItem = gridItems[0];
      if (!firstItem) {
        setColumnCount(1);
        return;
      }
      const firstTop = Math.round(firstItem.getBoundingClientRect().top);
      const nextCount = gridItems.filter((child) => Math.abs(Math.round(child.getBoundingClientRect().top) - firstTop) <= 2).length;
      setColumnCount(Math.max(1, nextCount));
    };

    updateColumnCount();
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(node);
    window.addEventListener("resize", updateColumnCount);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateColumnCount);
    };
  }, []);

  return (
    <div ref={gridRef} className={className}>
      {Children.map(children, (child, index) => {
        const adjustedIndex = startIndex + index;
        const row = Math.floor(adjustedIndex / columnCount);
        const col = adjustedIndex % columnCount;
        const color = (row + col + (invert ? 1 : 0)) % 2 === 0 ? checkerBlue : checkerGray;
        const style = {
          "--question-card-bg": color.bg,
          "--question-card-border": color.border,
        } as CSSProperties;

        const itemClass = typeof itemClassName === "function" ? itemClassName(index) : itemClassName;
        return <div className={itemClass} style={style}>{child}</div>;
      })}
    </div>
  );
}

export function Panel({ icon, eyebrow, title, note, children }: { icon: React.ReactNode; eyebrow: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-samsung">{icon}</div>
        <div>
          <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold text-navy">{title}</h2>
          {note ? <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">{note}</p> : null}
        </div>
      </div>
      <div className="question-stack space-y-3.5">{children}</div>
    </section>
  );
}

export function TextField({ label, value, placeholder, onChange, compact = false, tone }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; compact?: boolean; tone?: "blue" | "gray" }) {
  return (
    <label className={`question-card ${tone ? `question-card-${tone}` : ""} block rounded-lg border border-slate-200 ${compact ? "p-3" : "p-4"}`}>
      <span className={`mb-2 block font-bold leading-6 text-slate-800 ${compact ? "whitespace-nowrap text-sm" : "text-[15px]"}`}>{questionLabel(label)}</span>
      <input className={`${compact ? "h-11" : "h-12"} w-full rounded-lg border border-slate-200 bg-white px-3 text-[15px] text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function TextAreaField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="question-card block rounded-lg border border-slate-200 p-4">
      <span className="mb-2 block text-[15px] font-bold leading-6 text-slate-800">{questionLabel(label)}</span>
      <textarea className="min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-[15px] leading-6 text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function IncomeWithNoneField({ label, value, placeholder, noneSelected, onChange, onToggleNone }: { label: string; value: string; placeholder: string; noneSelected: boolean; onChange: (value: string) => void; onToggleNone: () => void }) {
  return (
    <div className="question-card rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-700">{questionLabel(label)}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(110px,1fr)]">
        <textarea className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung disabled:bg-slate-100 disabled:text-slate-400 sm:min-h-12" value={value} placeholder={placeholder} disabled={noneSelected} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={onToggleNone} className={`min-h-12 rounded-lg border px-4 py-2 text-sm font-bold transition ${noneSelected ? "border-samsung bg-blue-50 text-samsung" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>없음</button>
      </div>
    </div>
  );
}

export function ExpectedReturnField({ value, unknownSelected, onChange, onToggleUnknown }: { value: string; unknownSelected: boolean; onChange: (value: string) => void; onToggleUnknown: () => void }) {
  return (
    <div className="question-card rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-700">{questionLabel("기대수익률")}</p>
      <div className="mt-3 grid gap-2">
        <input className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung disabled:bg-slate-100 disabled:text-slate-400" value={value} placeholder="예. 15%" disabled={unknownSelected} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={onToggleUnknown} className={`min-h-12 rounded-lg border px-3 py-2 text-sm font-bold transition ${unknownSelected ? "border-samsung bg-blue-50 text-samsung" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>구체적인 수치는 모름</button>
      </div>
    </div>
  );
}

export function ChoiceGroup({ label, description, options, value, onChange, tone, cardClassName }: { label: string; description?: string; options: string[]; value: string; onChange: (value: string) => void; tone?: "blue" | "gray"; cardClassName?: string }) {
  return (
    <div className={`question-card ${tone ? `question-card-${tone}` : ""} ${cardClassName ?? ""} rounded-lg border border-slate-200 p-4`}>
      <p className="text-[15px] font-bold leading-6 text-slate-800">{questionLabel(label)}</p>
      {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
      <div className={`mt-3 grid max-w-5xl gap-2.5 ${optionGridClass(options.length)}`}>
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onChange(option)} className={`${optionButtonClass} ${value === option ? optionSelectedClass : optionIdleClass}`}>{option}</button>
        ))}
      </div>
    </div>
  );
}

export function MultiChoiceGroup({ label, options, values, onToggle }: { label: string; options: string[]; values: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="question-card rounded-lg border border-slate-200 p-4">
      <p className="text-[15px] font-bold leading-6 text-slate-800">{questionLabel(label)}</p>
      <div className={`mt-3 grid max-w-5xl gap-2.5 ${optionGridClass(options.length)}`}>
        {options.map((option) => {
          const selected = values.includes(option);
          return (
            <button key={option} type="button" onClick={() => onToggle(option)} className={`flex min-h-12 items-center gap-3 rounded-lg border px-4 py-3 text-left text-[15px] font-semibold leading-6 transition ${selected ? optionSelectedClass : optionIdleClass}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-samsung bg-samsung text-white" : "border-slate-300 bg-white"}`}>{selected ? <BadgeCheck size={14} /> : null}</span>
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ResultCard({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: "blue" | "green" | "gold" | "red" | "orange" | "slate"; children: React.ReactNode }) {
  const accentMap = { blue: "text-samsung bg-blue-50", green: "text-mint bg-emerald-50", gold: "text-gold bg-amber-50", red: "text-red-700 bg-red-50", orange: "text-orange-700 bg-orange-50", slate: "text-slate-700 bg-slate-100" };
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentMap[accent]}`}>{icon}</div>
        <h3 className="text-base font-bold text-navy">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function ResultGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-sm font-semibold text-slate-500">{label}</span>
          <span className="text-right text-sm font-bold text-navy">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold leading-5 text-navy">{value}</p>
    </div>
  );
}

export function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 sm:block sm:px-4 sm:py-3 ${strong ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className={`text-sm font-bold sm:mt-1 sm:text-xl ${strong ? "text-orange-700" : "text-navy"}`}>{value}</p>
    </div>
  );
}

export function LiquiditySummary({ summary }: { summary: { requiredDisplay: string; investableDisplay: string } }) {
  return (
    <div className="grid gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
      <p className="text-sm font-bold leading-6 text-blue-900">필요 자금(정기적 현금흐름, 목돈 사용 자금, 비상예비자금): {summary.requiredDisplay}</p>
      <p className="text-sm font-bold leading-6 text-blue-900">투자 가능 자산(당장 사용 계획이 없는 자산): {summary.investableDisplay}</p>
    </div>
  );
}
