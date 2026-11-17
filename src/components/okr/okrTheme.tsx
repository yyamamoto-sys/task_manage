// OKRモード共通の見た目の部品（Section 91-4）。値そのものは okrTheme.css の --okr-* が正本。
// 地図（map/）と個人OKRの記録（personal/）が同じものを参照する。
import type { CSSProperties } from "react";

/** 地図の .mk-card と同じカード（角丸・薄い影） */
export const OKR_CARD_STYLE: CSSProperties = {
  background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--okr-radius-card)", padding: "14px 16px", boxShadow: "var(--shadow-sm)",
};

/** 節の見出し（className="okr-sec"）の中の横線 */
export const OKR_RULE_STYLE: CSSProperties = { flex: 1, height: "1px", background: "var(--color-border-primary)" };

/** 地図の見出しの印（OKRモードの帯の左端） */
export function OkrLogo() {
  return (
    <svg width={34} height={34} viewBox="-17 -17 34 34" aria-hidden="true">
      <circle r={15} fill="#3b6fd4" opacity={0.15} />
      <circle cx={-6} cy={5} r={4} fill="#e08a00" />
      <circle cx={7} cy={-6} r={4} fill="#1a9a6b" />
      <circle cx={8} cy={8} r={3} fill="#c2338a" />
      <path d="M-6 5 C-2 -4 2 -6 7 -6 M-6 5 C0 9 4 9 8 8" stroke="#3b6fd4" strokeWidth={2} fill="none" strokeLinecap="round" />
    </svg>
  );
}
