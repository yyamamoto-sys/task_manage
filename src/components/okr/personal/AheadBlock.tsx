// src/components/okr/personal/AheadBlock.tsx
//
// 【設計意図】
// 個人OKRビュー「これから」ブロック（Phase 3・docs/dev/okr-redesign-plan.md §5-1・§7・§8）。
// 機械計算（ゼロトークン・即時描画）は起動と同時に出す。AIが書く部分（見立て・週ごとの
// 一手・捨てる候補・バンドのAI判定）は明示ボタンを押したときだけ呼ぶ（v3.55・山本さんの
// 決定。以前はKRタブを開くたびに自動発火していたが実用に耐えなかった）——解析中は
// この部分だけをスケルトン表示にし、数字と週の状態は最初から出ている（親コンポーネントが
// 機械計算部分を先に描画し、outlookRow/analyzingを別のstate源から後で差し込む設計）。
//
// 🔴 ボタンは1つ（未解析なら「✦ 見立てを出す」・解析済みなら「再解析」に文言が切り替わる）。
// 同じことをする2つのボタンを並べない。押し先（onReanalyze）はどちらの文言でも同じ
// コールバック——force判定（既存の解析結果があるかどうか）は呼び出し元
// （PersonalKrPanel.tsx の handleRunOutlook）が行う。
//
// バンドは3値を混ぜない（§6）。表示はband_override（決定）> band_ai（見通し）>
// band_target（狙い）の優先順位。🔴 band_overrideが入っていればband_aiの値は表示に
// 使わない（resolveBandDisplayが判定する。band_ai自体は常にAPIから受け取るが、
// この関数を通さない限り画面には出さない）。

import { useState } from "react";
import type { PersonalKrBand, PersonalKrOutlook } from "../../../lib/localData/types";
import type { AheadFacts } from "../../../lib/personalOkr/aheadCompute";
import type { LinkedTaskStatusSummary } from "../../../lib/personalOkr/aheadTaskStats";
import { resolveBandDisplay } from "../../../lib/personalOkr/bandDisplay";
import { BAND_VALUES, BAND_LABELS, isBandDisabled } from "../../../lib/personalOkr/bandOptions";
import { readStoredOutlookPayload } from "../../../lib/ai/personalOkrOutlookExtractor";
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
  /** undefined=DBから未取得（初回のensureOutlookLoaded完了前）／null=解析結果がまだ無い */
  outlookRow: PersonalKrOutlook | null | undefined;
  analyzing: boolean;
  outlookError: string | null;
  /** 文脈（PersonalOkrAiContextInput）が組み立てられているか。falseなら再解析ボタンを無効化する */
  canReanalyze: boolean;
  onReanalyze: () => void;
}

function formatAnalyzedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function AheadBlock({
  facts, taskStats, targetAndEvidenceSet, bandTarget, bandOverride, editable, onSetOverride,
  outlookRow, analyzing, outlookError, canReanalyze, onReanalyze,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bandAi = outlookRow?.band_ai ?? null;
  const display = resolveBandDisplay(bandOverride, bandAi, bandTarget);
  const hasTaskAlerts = taskStats.delayedCount > 0 || taskStats.stagnantCount > 0 || taskStats.blockedCount > 0;
  const outlookPayload = outlookRow ? readStoredOutlookPayload(outlookRow.outlook_json) : null;
  // loading（スケルトン）: 解析中、またはDBの直近結果をまだ一度も取得していない（初回のensureOutlookLoaded完了前）
  const isLoadingOutlook = analyzing || outlookRow === undefined;

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
        <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "10.5px", color: "var(--color-text-tertiary)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
          {analyzing ? (
            <>解析中…</>
          ) : outlookError ? (
            <span style={{ color: "var(--color-text-danger)" }} title={outlookError}>解析に失敗しました</span>
          ) : outlookRow ? (
            <>解析済み（{formatAnalyzedAt(outlookRow.created_at)}）</>
          ) : outlookRow === null ? (
            <>AI解析：未実施（ボタンを押すと実行されます）</>
          ) : (
            <>読み込み中…</>
          )}
          <button
            onClick={onReanalyze}
            disabled={!canReanalyze || analyzing}
            style={{
              fontFamily: "inherit", fontSize: "10px", padding: "2px 9px", borderRadius: "var(--radius-full)",
              border: "1px solid var(--color-border-primary)", background: "transparent",
              color: !canReanalyze || analyzing ? "var(--color-text-tertiary)" : "var(--color-text-secondary)",
              cursor: !canReanalyze || analyzing ? "default" : "pointer", opacity: !canReanalyze || analyzing ? 0.5 : 1,
            }}
          >{outlookRow ? "再解析" : "✦ 見立てを出す"}</button>
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
              {/* 🔴 band_overrideが入っている間はAI判定バッジを出さない（band_aiの値を表示に使わない） */}
              {display.source === "ai" && (
                <span title={outlookRow?.band_ai_reason ?? undefined} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-full)", background: "var(--color-bg-purple, var(--color-brand-light))", color: "var(--color-text-purple, var(--color-brand))", border: "1px solid var(--color-brand-border)" }}>
                  ✦ AI判定
                </span>
              )}
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

        {/* AIが書く部分（解析中はスケルトン。数字と週の状態は既に上で描画済み） */}
        <div style={{ margin: "0 17px 15px" }}>
          {isLoadingOutlook ? (
            <div aria-label="AIによる見立てを解析中" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {[1, 0.85, 0.6].map((w, i) => (
                <div key={i} style={{ height: "10px", width: `${w * 100}%`, borderRadius: "var(--radius-sm)", background: "var(--color-bg-tertiary)", opacity: 0.7 }} />
              ))}
            </div>
          ) : outlookPayload ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-primary)", lineHeight: 1.7 }}>{outlookPayload.lead}</p>
              {outlookPayload.moves.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {outlookPayload.moves.map((move, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: "10px", padding: "8px 10px", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)" }}>
                      <span style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)" }}>{move.week_label}</span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-primary)" }}>
                        <b>{move.action}</b>
                        {move.reason && <span style={{ display: "block", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{move.reason}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {outlookPayload.trade && (
                <div style={{ padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--color-bg-warning)", border: "1px solid var(--color-border-secondary)", fontSize: "12px", color: "var(--color-text-warning)" }}>
                  <b>間に合わせるなら、捨てる候補。</b>{outlookPayload.trade}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "10px 13px", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", border: "1px dashed var(--color-border-secondary)", fontSize: "11.5px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
              {/* 🔴 自動で走るという誤解を与えない。押せば出る、と分かる表示にする（v3.55） */}
              {outlookError ? "AIによる見立ての取得に失敗しました。もう一度「✦ 見立てを出す」をお試しください。" : "上の「✦ 見立てを出す」を押すと、AIが見立てを出します。"}
            </div>
          )}
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
