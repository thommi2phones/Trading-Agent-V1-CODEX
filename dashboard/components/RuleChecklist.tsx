"use client";

import { useState } from "react";

/**
 * Trading Rule Framework v1.0 — Pre-trade checklist.
 *
 * REQUIRED items must be completed to unlock order submission.
 * OPTIONAL items add confluence but don't gate the submit button.
 */

export interface ChecklistState {
  allPassed: boolean;
  checked: Record<string, boolean>;
  /** Selected pattern type from the dropdown (required) */
  patternType: string;
}

/* ── Pattern types from the framework ───────────────────────── */
const PATTERN_TYPES = [
  "Flag",
  "Pennant",
  "Channel (Ascending)",
  "Channel (Descending)",
  "Trendline Break",
  "Head & Shoulders",
  "Inverse Head & Shoulders",
  "Cup & Handle",
  "Range Breakout",
  "EMA Structure",
  "Symmetrical Triangle",
  "Ascending Triangle",
  "Descending Triangle",
  "Falling Wedge",
  "Ascending Wedge",
  "Descending Wedge",
  "Parabolic Support",
  "Double Top",
  "Double Bottom",
] as const;

/* ── Rule definitions ───────────────────────────────────────── */
interface RuleItem {
  id: string;
  category: string;
  label: string;
  description: string;
  required: boolean;
  /** Special type — "dropdown" renders a select instead of checkbox */
  type?: "checkbox" | "dropdown";
}

const RULES: RuleItem[] = [
  // ── Structure (Required) ──────────────────────────────────
  {
    id: "pattern_defined",
    category: "Structure",
    label: "Pattern defined",
    description:
      "Select the pattern type identified on the chart — flags, pennants, channels, wedges, H&S, cup & handle, trendline breaks, range breakout, or EMA structure",
    required: true,
    type: "dropdown",
  },
  {
    id: "breakout_retest",
    category: "Structure",
    label: "Breakout → Retest → Confirmation",
    description:
      "Entry is NOT on first impulse. Breakout level identified, retest occurred, bounce continuation confirmed",
    required: true,
  },
  // ── Structure (Optional) ──────────────────────────────────
  {
    id: "htf_alignment",
    category: "Structure",
    label: "Higher timeframe alignment",
    description:
      "1H + 4H aligned. Daily structure confirms direction. Trade aligns with higher timeframe trend",
    required: false,
  },
  // ── Fibonacci (Optional) ──────────────────────────────────
  {
    id: "fib_confluence",
    category: "Fibonacci",
    label: "Fibonacci confluence present",
    description:
      "Yellow or Green Fib level aligns with pattern boundary or breakout level. 0.618 / golden pocket (0.618–0.65) checked",
    required: false,
  },
  // ── Indicators (Optional) ─────────────────────────────────
  {
    id: "indicator_alignment",
    category: "Indicators",
    label: "Indicator alignment (MACD / RSI / TTM)",
    description:
      "At least one of: MACD crossover direction aligns, RSI trend supports, TTM Squeeze state/fire confirms. Indicators confirm — not trigger",
    required: false,
  },
  {
    id: "ema_crossover",
    category: "Indicators",
    label: "EMA crossover confirmed",
    description:
      "EMA crossover aligns with trade direction. Short-term EMA crossed above/below long-term EMA confirming momentum shift",
    required: false,
  },
  // ── Levels (Required) ─────────────────────────────────────
  {
    id: "tp_defined",
    category: "Levels",
    label: "Take profit levels defined",
    description:
      "Orange rays placed. Multi-target scaling planned: TP1 (50%), TP2 (50% of remaining), TP3 (runner or close). TPs defined BEFORE entry",
    required: true,
  },
  {
    id: "stop_defined",
    category: "Levels",
    label: "Stop loss / invalidation defined",
    description:
      "Red ray placed at structure break, pattern invalidation, or key Fib loss. No trade without predefined stop",
    required: true,
  },
];

const CATEGORIES = [...new Set(RULES.map((r) => r.category))];

interface Props {
  onChange: (state: ChecklistState) => void;
}

export default function RuleChecklist({ onChange }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(RULES.map((r) => [r.id, false]))
  );
  const [patternType, setPatternType] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const requiredRules = RULES.filter((r) => r.required);
  const optionalRules = RULES.filter((r) => !r.required);

  const requiredPassed = requiredRules.every((r) => {
    if (r.type === "dropdown") return patternType !== "";
    return checked[r.id];
  });

  const totalChecked =
    Object.values(checked).filter(Boolean).length + (patternType ? 1 : 0);
  const totalRules = RULES.length;
  const requiredCount = requiredRules.length;
  const requiredChecked = requiredRules.filter((r) => {
    if (r.type === "dropdown") return patternType !== "";
    return checked[r.id];
  }).length;
  const progressPct = (totalChecked / totalRules) * 100;

  const emitChange = (
    nextChecked: Record<string, boolean>,
    nextPattern: string
  ) => {
    const allReqPassed = requiredRules.every((r) => {
      if (r.type === "dropdown") return nextPattern !== "";
      return nextChecked[r.id];
    });
    onChange({
      allPassed: allReqPassed,
      checked: nextChecked,
      patternType: nextPattern,
    });
  };

  const toggle = (id: string) => {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    emitChange(next, patternType);
  };

  const handlePatternChange = (value: string) => {
    setPatternType(value);
    emitChange(checked, value);
  };

  const resetAll = () => {
    const next = Object.fromEntries(RULES.map((r) => [r.id, false]));
    setChecked(next);
    setPatternType("");
    onChange({ allPassed: false, checked: next, patternType: "" });
  };

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl overflow-hidden">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setCollapsed(!collapsed); }}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-tv-border/20 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
              requiredPassed
                ? "bg-tv-green/20 text-tv-green"
                : "bg-tv-orange/20 text-tv-orange"
            }`}
          >
            {requiredChecked}/{requiredCount}
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold">Pre-Trade Checklist</h3>
            <p className="text-xs text-tv-text-dim">
              {requiredChecked}/{requiredCount} required
              {totalChecked > requiredChecked &&
                ` · ${totalChecked - requiredChecked} optional`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {requiredPassed && (
            <span className="text-xs font-medium text-tv-green bg-tv-green/10 px-2 py-0.5 rounded">
              CLEAR TO TRADE
            </span>
          )}
          <svg
            className={`w-4 h-4 text-tv-text-dim transition-transform ${
              collapsed ? "" : "rotate-180"
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
            />
          </svg>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-tv-bg">
        <div
          className={`h-full transition-all duration-300 ${
            requiredPassed ? "bg-tv-green" : "bg-tv-orange"
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Checklist body */}
      {!collapsed && (
        <div className="px-5 py-3 space-y-4">
          {CATEGORIES.map((cat) => {
            const catRules = RULES.filter((r) => r.category === cat);
            const hasRequired = catRules.some((r) => r.required);
            const hasOptional = catRules.some((r) => !r.required);

            return (
              <div key={cat}>
                <h4 className="text-xs font-medium text-tv-blue uppercase tracking-wider mb-2">
                  {cat}
                </h4>
                <div className="space-y-1">
                  {catRules.map((rule) => {
                    /* ── Dropdown rule (pattern selector) ── */
                    if (rule.type === "dropdown") {
                      const filled = patternType !== "";
                      return (
                        <div
                          key={rule.id}
                          className={`flex items-start gap-3 p-2 rounded-lg transition-colors ${
                            filled ? "bg-tv-green/5" : ""
                          }`}
                        >
                          <div className="pt-0.5">
                            <div
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                filled
                                  ? "bg-tv-green border-tv-green"
                                  : "border-tv-border"
                              }`}
                            >
                              {filled && (
                                <svg
                                  className="w-3 h-3 text-white"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={3}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="m4.5 12.75 6 6 9-13.5"
                                  />
                                </svg>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className={`text-sm font-medium ${
                                  filled
                                    ? "text-tv-green"
                                    : "text-tv-text"
                                }`}
                              >
                                {rule.label}
                              </span>
                              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-tv-orange/15 text-tv-orange">
                                Required
                              </span>
                            </div>
                            <select
                              value={patternType}
                              onChange={(e) =>
                                handlePatternChange(e.target.value)
                              }
                              className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-1.5 text-sm text-tv-text focus:outline-none focus:border-tv-blue mb-1"
                            >
                              <option value="">Select pattern type…</option>
                              {PATTERN_TYPES.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                            <div className="text-xs text-tv-text-dim leading-relaxed">
                              {rule.description}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    /* ── Standard checkbox rule ── */
                    return (
                      <label
                        key={rule.id}
                        className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                          checked[rule.id]
                            ? "bg-tv-green/5"
                            : "hover:bg-tv-border/20"
                        }`}
                      >
                        <div className="pt-0.5">
                          <input
                            type="checkbox"
                            checked={checked[rule.id]}
                            onChange={() => toggle(rule.id)}
                            className="sr-only"
                          />
                          <div
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              checked[rule.id]
                                ? "bg-tv-green border-tv-green"
                                : rule.required
                                ? "border-tv-border"
                                : "border-tv-border/60"
                            }`}
                          >
                            {checked[rule.id] && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m4.5 12.75 6 6 9-13.5"
                                />
                              </svg>
                            )}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-medium ${
                                checked[rule.id]
                                  ? "text-tv-green line-through opacity-70"
                                  : rule.required
                                  ? "text-tv-text"
                                  : "text-tv-text/70"
                              }`}
                            >
                              {rule.label}
                            </span>
                            {rule.required ? (
                              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-tv-orange/15 text-tv-orange">
                                Required
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-tv-border/30 text-tv-text-dim">
                                Optional
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-tv-text-dim mt-0.5 leading-relaxed">
                            {rule.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Reset button */}
          <div className="flex justify-end pt-2 border-t border-tv-border">
            <button
              onClick={resetAll}
              className="text-xs text-tv-text-dim hover:text-tv-text transition-colors"
            >
              Reset checklist
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
