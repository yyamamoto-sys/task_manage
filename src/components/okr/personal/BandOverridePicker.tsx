// src/components/okr/personal/BandOverridePicker.tsx
//
// 【設計意図】
// 達成度バンドの「決定」（band_override）UI。元々AheadBlock.tsx（当月のみ表示）の中に
// あったが、過去月でもバンドを決定できないと振り返りが完結しないため（CLAUDE.md Section 24・
// 2026-08-26）、共通コンポーネントへ切り出してAheadBlock（当月）とMonthReviewBlock（過去月）
// の両方から使えるようにした。ロジック（handlePick・保存中/エラー表示）は元の実装のまま。

import { useState } from "react";
import type { PersonalKrBand } from "../../../lib/localData/types";
import { BAND_VALUES, BAND_LABELS, isBandDisabled } from "../../../lib/personalOkr/bandOptions";
import { formatErrorForUser } from "../../../lib/errorMessage";

interface Props {
  bandOverride: PersonalKrBand | null;
  editable: boolean;
  onSetOverride: (value: PersonalKrBand | null) => Promise<void>;
}

export function BandOverridePicker({ bandOverride, editable, onSetOverride }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = async (value: PersonalKrBand) => {
    setError(null);
    setSaving(true);
    try {
      await onSetOverride(bandOverride === value ? null : value);
    } catch (e) {
      setError(formatErrorForUser("バンドの決定の保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "5px" }}>
        バンドを決定する（任意）
      </div>
      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
        {BAND_VALUES.map(b => {
          const disabled = isBandDisabled(b) || !editable || saving;
          const on = bandOverride === b;
          return (
            <button
              key={b}
              onClick={() => handlePick(b)}
              disabled={disabled}
              title={BAND_LABELS[b]}
              style={{
                fontFamily: "inherit", fontSize: "10.5px", padding: "3px 9px", borderRadius: "var(--radius-sm)",
                border: `1px solid ${on ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
                background: on ? "var(--color-brand-light)" : "var(--color-bg-tertiary)",
                color: on ? "var(--color-brand)" : "var(--color-text-tertiary)",
                fontWeight: on ? 700 : 400,
                textDecoration: isBandDisabled(b) ? "line-through" : "none",
                opacity: isBandDisabled(b) ? 0.45 : 1,
                cursor: disabled ? "default" : "pointer",
              }}
            >{b} {BAND_LABELS[b]}</button>
          );
        })}
      </div>
      {error && <div style={{ fontSize: "11px", color: "var(--color-text-danger)", marginTop: "6px" }}>{error}</div>}
    </div>
  );
}
