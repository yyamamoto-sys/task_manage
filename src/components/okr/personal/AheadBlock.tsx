// src/components/okr/personal/AheadBlock.tsx
//
// 【設計意図】
// 個人OKRビュー「これから」ブロック（Phase 3前半・docs/dev/okr-redesign-plan.md §5-1・§7・§8）。
// ここに置くのは機械計算（ゼロトークン・即時描画）だけ。AIが必要な部分（見立て・捨てる候補・
// 原因の推定）はPhase 3後半で実装するため、今回は控えめなプレースホルダのみを出す
// （モックの .ahead-lead / .trade に相当する位置。偽の内容を出さない）。
//
// 解析状態は「器」だけを用意する：今回はAI呼び出しが無いため「解析中」「解析済み」の動的な
// 状態は表示せず、押せない再解析ボタンも置かない（未実装の空ボタンを出さない方針）。
//
// バンドは3値を混ぜない（§6）。表示は band_override（決定）があればそれ、無ければ
// band_target（狙い）。「✦ AI判定」バッジは常に無効状態のプレースホルダとして位置だけ空ける。
// band_override 自体はここで人が選んで保存できる（クリックで即保存・toggleで解除）。

import { useState } from "react";
import type { PersonalKrBand } from "../../../lib/localData/types";
import type { AheadFacts } from "../../../lib/personalOkr/aheadCompute";
import type { LinkedTaskStatusSummary } from "../../../lib/personalOkr/aheadTaskStats";
import { resolveBandDisplay } from "../../../lib/personalOkr/bandDisplay";
import { BAND_VALUES, BAND_LABELS, isBandDisabled } from "../../../lib/personalOkr/bandOptions";
import { formatErrorForUser } from "../../../lib/errorMessage";

const sectionHeadStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "9px", margin: "20px 0 9px",
  fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
};
const ruleStyle: React.CSSProperties = { flex: 1, height: "1px", background: "var(--color-border-primary)" };

interface Props {
  facts: AheadFacts;
  taskStats: LinkedTaskStatusSummary;
  targetAndEvidenceSet: boolean;
  bandTarget: PersonalKrBand | null;
  bandOverride: PersonalKrBand | null;
  editable: boolean;
  onSetOverride: (value: PersonalKrBand | null) => Promise<void>;
}

export function AheadBlock({ facts, taskStats, targetAndEvidenceSet, bandTarget, bandOverride, editable, onSetOverride }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const display = resolveBandDisplay(bandOverride, bandTarget);
  const hasTaskAlerts = taskStats.delayedCount > 0 || taskStats.stagnantCount > 0 || taskStats.blockedCount > 0;

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
    <div style={{ marginTop: "20px" }}>
      <div style={sectionHeadStyle}>
        <span>これから</span>
        <span style={ruleStyle} />
        {/* 解析状態の「器」だけ用意する。今回はAI呼び出しが無いため動的な状態・再解析ボタンは出さない */}
        <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
          AI解析：未実施（次の更新で追加予定）
        </span>
      </div>

      <div style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        {/* バンド表示（override優先・無ければtarget） */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", padding: "15px 17px", background: "var(--color-brand-light)" }}>
          <span style={{ fontFamily: "var(--font-serif, inherit)", fontSize: "27px", fontWeight: 600, lineHeight: 1, color: "var(--color-brand)" }}>
            {display.value ?? "―"}
            {display.value != null && <small style={{ fontSize: "12px", marginLeft: "2px" }}>%</small>}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {display.source === "override" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-full)", background: "var(--color-brand-light)", color: "var(--color-brand)", border: "1px solid var(--color-brand-border)" }}>
                  ● 自分で決定
                </span>
              )}
              {display.source === "target" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)", border: "1px solid var(--color-border-primary)" }}>
                  🎯 Kintoneの狙い
                </span>
              )}
              {/* AI判定バッジは空き枠（Phase 3後半でband_aiが入ったら差し替える）。今は常に無効表示 */}
              <span title="AIによる見通し判定はPhase 3後半で実装予定です" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-secondary)", opacity: 0.6 }}>
                ✦ AI判定（未実装）
              </span>
            </div>
            <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>
              「狙い」「見通し（AI）」「決定」は別の値です。決定を入れると以後この値を表示します。
            </span>
          </div>
        </div>

        {/* 機械計算の事実（AIを使わない） */}
        <div style={{ padding: "13px 17px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "12.5px", color: "var(--color-text-primary)" }}>
          <div>残り{facts.weeksRemaining}週・月末まで{facts.daysUntilMonthEnd}日</div>
          <div>週の自己評価：◯{facts.ratingCounts.o} ／ △{facts.ratingCounts.t} ／ ✕{facts.ratingCounts.x}</div>
          {facts.unratedWeekLabels.length > 0 && (
            <div style={{ color: "var(--color-text-tertiary)" }}>評価待ちの週：{facts.unratedWeekLabels.join("・")}</div>
          )}
          <div style={facts.remainingUnsetGoalCount > 0 ? { color: "var(--color-text-warning)" } : undefined}>
            {facts.remainingUnsetGoalWeekLabels.length > 0
              ? `${facts.remainingUnsetGoalWeekLabels.join("・")}の目標状態が未設定です`
              : "残り週の目標状態はすべて設定済みです"}
          </div>
          <div>当月末の達成目標：{targetAndEvidenceSet ? "設定済み" : "未設定"}</div>
          {hasTaskAlerts && (
            <div style={{ color: "var(--color-text-warning)" }}>
              紐づくタスク：遅延{taskStats.delayedCount}件・停滞{taskStats.stagnantCount}件・先行待ち{taskStats.blockedCount}件
            </div>
          )}
        </div>

        {/* AIが書く部分の空き枠（今回は控えめなプレースホルダのみ・偽の内容を出さない） */}
        <div style={{ margin: "0 17px 15px", padding: "10px 13px", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", border: "1px dashed var(--color-border-secondary)", fontSize: "11.5px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          AIによる見立ては次の更新で入ります。
        </div>

        {/* band_override：人が決める（任意） */}
        <div style={{ margin: "0 17px 16px" }}>
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
      </div>
    </div>
  );
}
