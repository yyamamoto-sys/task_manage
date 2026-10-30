// 先行タスク1件分の「種類（FS/SS/FF/SF）」と「ずらし日数」の編集欄（v3.197）。
// タスク編集モーダルとサイドパネルで共用する。変更は即時反映（先行タスクの付け外しと同じ線引き）。
// ずらし日数は暦日の整数・負はリード（先行の終了／開始より前から始められる）。入力中は文字列で持ち、
// フォーカスを外す／Enter で確定する（途中の「-」だけの状態を壊さないため）。

import { useEffect, useState } from "react";
import type { TaskDependency } from "../../lib/localData/types";
import { DEP_TYPES, DEP_TYPE_LABELS, depTypeOf, lagOf, normalizeLag, type DepType } from "../../lib/dependencies/depType";

interface Props {
  dep: TaskDependency;
  onChange: (terms: { depType: DepType; lagDays: number }) => void;
}

const controlStyle: React.CSSProperties = {
  fontSize: "11px", padding: "2px 4px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-sm, 4px)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
};

export function DependencyTermsEditor({ dep, onChange }: Props) {
  const type = depTypeOf(dep);
  const lag = lagOf(dep);
  const [lagText, setLagText] = useState(String(lag));
  useEffect(() => { setLagText(String(lag)); }, [lag]);

  const commitLag = () => {
    const next = normalizeLag(lagText);
    setLagText(String(next));
    if (next !== lag) onChange({ depType: type, lagDays: next });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
      <select
        value={type}
        aria-label="依存の種類"
        title="先行と後続のどの端どうしを結ぶか（終了→開始が一般的）"
        onChange={e => onChange({ depType: e.target.value as DepType, lagDays: lag })}
        style={controlStyle}
      >
        {DEP_TYPES.map(t => <option key={t} value={t}>{DEP_TYPE_LABELS[t]}</option>)}
      </select>
      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>ずらし</span>
      <input
        type="number" step={1} value={lagText}
        aria-label="ずらし日数（負の値＝前倒し）"
        title="ずらし日数（暦日）。負の値＝先行の完了／開始より前から始められる"
        onChange={e => setLagText(e.target.value)}
        onBlur={commitLag}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitLag(); } }}
        style={{ ...controlStyle, width: "52px" }}
      />
      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>日</span>
    </span>
  );
}
