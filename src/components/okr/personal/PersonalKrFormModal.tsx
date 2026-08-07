// src/components/okr/personal/PersonalKrFormModal.tsx
//
// 【設計意図】
// 個人四半期KRの追加・編集モーダル。Phase 1はKintone取込が無いため、この画面が唯一の
// 登録手段（docs/dev/okr-redesign-plan.md §8）。CLAUDE.md Section 21の契約（modalStyles.ts）
// に従い、箱にmaxHeightを持たせて画面の上下を突き抜けないようにする。
//
// グループKR・TFのピッカーは表示中の部署（currentGroupId）で絞る（v3.02の既存の流儀。
// QuickAddTaskModal.tsx/TaskEditModal.tsx と同じ deptScope.ts を使う）。

import { useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  KeyResult, Objective, PersonalKr, PersonalKrKind, TaskForce, Quarter,
} from "../../../lib/localData/types";
import { keyResultsInGroup, taskForcesInGroup, DEFAULT_OKR_GROUP_ID } from "../../../lib/okr/deptScope";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../../common/modalStyles";
import { CustomSelect } from "../../common/CustomSelect";
import { sumWeightPct, isWeightTotalWarning } from "../../../lib/personalOkr/weightCheck";
import { formatErrorForUser } from "../../../lib/errorMessage";

const KR_KIND_OPTIONS: { value: PersonalKrKind; label: string }[] = [
  { value: "group_kr", label: "グループKR紐づけ" },
  { value: "general", label: "全般" },
  { value: "company_common", label: "全社共通" },
  { value: "om_common", label: "OM共通" },
  { value: "agm_common", label: "AGM共通" },
  { value: "leader_common", label: "リーダー共通" },
];

const QUARTER_OPTIONS: { value: Quarter; label: string }[] = [
  { value: "1Q", label: "1Q（1〜3月）" },
  { value: "2Q", label: "2Q（4〜6月）" },
  { value: "3Q", label: "3Q（7〜9月）" },
  { value: "4Q", label: "4Q（10〜12月）" },
];

const labelStyle: React.CSSProperties = { fontSize: "11px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px", display: "block" };
const fieldWrapStyle: React.CSSProperties = { marginBottom: "14px" };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: "12.5px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", boxSizing: "border-box",
  fontFamily: "inherit",
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: "vertical", minHeight: "56px", lineHeight: 1.6 };

interface Props {
  mode: "create" | "edit";
  initial: PersonalKr | null;
  /** 保存後にdisplay_orderを自動割当するための既存件数（create時のみ使用） */
  existingKrsInPeriod: PersonalKr[];
  currentUserId: string;
  currentGroupId: string | null;
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  objectives: Objective[];
  defaultFiscalYear: number;
  defaultQuarter: Quarter;
  onSave: (kr: PersonalKr) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function PersonalKrFormModal({
  mode, initial, existingKrsInPeriod, currentUserId, currentGroupId,
  keyResults, taskForces, objectives, defaultFiscalYear, defaultQuarter,
  onSave, onDelete, onClose,
}: Props) {
  const [fiscalYear, setFiscalYear] = useState(initial?.fiscal_year ?? defaultFiscalYear);
  const [quarter, setQuarter] = useState<Quarter>(initial?.quarter ?? defaultQuarter);
  const [krKind, setKrKind] = useState<PersonalKrKind>(initial?.kr_kind ?? "group_kr");
  const [keyResultId, setKeyResultId] = useState(initial?.key_result_id ?? "");
  const [taskForceId, setTaskForceId] = useState(initial?.task_force_id ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [weightPct, setWeightPct] = useState(String(initial?.weight_pct ?? 0));
  const [category, setCategory] = useState(initial?.category ?? "");
  const [activity, setActivity] = useState(initial?.activity ?? "");
  const [strengthRole, setStrengthRole] = useState(initial?.strength_role ?? "");
  const [weaknessRole, setWeaknessRole] = useState(initial?.weakness_role ?? "");
  const [criteria, setCriteria] = useState(initial?.criteria ?? "");
  const [supplement, setSupplement] = useState(initial?.supplement ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const krsInGroup = useMemo(
    () => keyResultsInGroup(keyResults, objectives, currentGroupId),
    [keyResults, objectives, currentGroupId],
  );
  const tfsForSelectedKr = useMemo(() => {
    if (!keyResultId) return [];
    return taskForcesInGroup(taskForces, keyResults, objectives, currentGroupId)
      .filter(tf => tf.kr_id === keyResultId);
  }, [taskForces, keyResults, objectives, currentGroupId, keyResultId]);

  const weightPreviewTotal = useMemo(() => {
    const others = existingKrsInPeriod.filter(k => k.id !== initial?.id);
    return sumWeightPct([...others, { weight_pct: Number(weightPct) || 0 }]);
  }, [existingKrsInPeriod, initial?.id, weightPct]);

  const handleSave = async () => {
    if (!label.trim()) { setError("KR名（タブに出す名前）を入力してください"); return; }
    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    const kr: PersonalKr = {
      id: initial?.id ?? uuidv4(),
      member_id: currentUserId,
      group_id: currentGroupId ?? initial?.group_id ?? DEFAULT_OKR_GROUP_ID,
      fiscal_year: fiscalYear,
      quarter,
      kr_kind: krKind,
      key_result_id: krKind === "group_kr" ? (keyResultId || null) : null,
      task_force_id: krKind === "group_kr" ? (taskForceId || null) : null,
      label: label.trim(),
      weight_pct: Number(weightPct) || 0,
      category: category || null,
      activity: activity || null,
      strength_role: strengthRole || null,
      weakness_role: weaknessRole || null,
      criteria: criteria || null,
      supplement: supplement || null,
      display_order: initial?.display_order ?? existingKrsInPeriod.length,
      is_deleted: false,
      created_at: initial?.created_at ?? now,
      updated_by: currentUserId,
    };
    try {
      await onSave(kr);
      onClose();
    } catch (e) {
      setError(formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError(formatErrorForUser("削除に失敗しました", e));
      setDeleting(false);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={modalOverlayStyle(320)} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        style={{ ...modalBoxStyle("min(560px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
              {mode === "create" ? "個人KRを追加" : "個人KRを編集"}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              Kintone「個人OKR設定フォーム」の個人KRをそのまま登録します。編集はここで、評価の確定はKintone側です。
            </div>
          </div>
          <button onClick={onClose} aria-label="閉じる" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "16px 18px" }}>
          {error && (
            <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)", marginBottom: "14px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ ...fieldWrapStyle, flex: 1 }}>
              <div style={labelStyle}>会計年度</div>
              <input type="number" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value) || fiscalYear)} style={inputStyle} />
            </div>
            <div style={{ ...fieldWrapStyle, flex: 1 }}>
              <div style={labelStyle}>四半期</div>
              <CustomSelect value={quarter} onChange={v => setQuarter(v as Quarter)} options={QUARTER_OPTIONS} />
            </div>
          </div>

          <div style={fieldWrapStyle}>
            <div style={labelStyle}>KR種別</div>
            <CustomSelect value={krKind} onChange={v => setKrKind(v as PersonalKrKind)} options={KR_KIND_OPTIONS} />
          </div>

          {krKind === "group_kr" && (
            <div style={{ display: "flex", gap: "10px" }}>
              <div style={{ ...fieldWrapStyle, flex: 1 }}>
                <div style={labelStyle}>グループKR（表示中の部署のみ）</div>
                <CustomSelect
                  value={keyResultId}
                  onChange={v => { setKeyResultId(v); setTaskForceId(""); }}
                  options={[{ value: "", label: "（未選択）" }, ...krsInGroup.map(kr => ({ value: kr.id, label: kr.title }))]}
                  searchable
                />
              </div>
              <div style={{ ...fieldWrapStyle, flex: 1 }}>
                <div style={labelStyle}>TF（任意）</div>
                <CustomSelect
                  value={taskForceId}
                  onChange={setTaskForceId}
                  options={[{ value: "", label: "（未選択）" }, ...tfsForSelectedKr.map(tf => ({ value: tf.id, label: `TF${tf.tf_number} ${tf.name}` }))]}
                  disabled={!keyResultId}
                />
              </div>
            </div>
          )}

          <div style={fieldWrapStyle}>
            <div style={labelStyle}>KR名（タブに出す短い名前）</div>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="例：エース（AAS）" style={inputStyle} />
          </div>

          <div style={fieldWrapStyle}>
            <div style={labelStyle}>ウェイト（%）</div>
            <input type="number" value={weightPct} onChange={e => setWeightPct(e.target.value)} style={{ ...inputStyle, width: "120px" }} />
            {isWeightTotalWarning(weightPreviewTotal) && (
              <div style={{ fontSize: "11px", color: "var(--color-text-warning)", marginTop: "6px" }}>
                ⚠ このKRを含めた{fiscalYear}年{quarter}のウェイト合計は{weightPreviewTotal}%です（100%でなくても保存できます。Kintoneが正本のためここでは警告のみです）。
              </div>
            )}
          </div>

          <details style={{ marginTop: "6px" }}>
            <summary style={{ cursor: "pointer", fontSize: "11.5px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              このKRの内容（Kintone個人OKR設定フォームの欄）
            </summary>
            <div style={{ marginTop: "10px" }}>
              <div style={fieldWrapStyle}>
                <div style={labelStyle}>●対象業務カテゴリ</div>
                <textarea value={category} onChange={e => setCategory(e.target.value)} style={textareaStyle} />
              </div>
              <div style={fieldWrapStyle}>
                <div style={labelStyle}>●実施内容</div>
                <textarea value={activity} onChange={e => setActivity(e.target.value)} style={textareaStyle} />
              </div>
              <div style={fieldWrapStyle}>
                <div style={labelStyle}>●得意領域の強化：（役割）</div>
                <textarea value={strengthRole} onChange={e => setStrengthRole(e.target.value)} style={textareaStyle} />
              </div>
              <div style={fieldWrapStyle}>
                <div style={labelStyle}>●苦手領域の克服：（役割）</div>
                <textarea value={weaknessRole} onChange={e => setWeaknessRole(e.target.value)} style={textareaStyle} />
              </div>
              <div style={fieldWrapStyle}>
                <div style={labelStyle}>●達成基準</div>
                <textarea value={criteria} onChange={e => setCriteria(e.target.value)} style={textareaStyle} />
              </div>
              <div style={fieldWrapStyle}>
                <div style={labelStyle}>●補足（心持ちの変化・目指す存在）</div>
                <textarea value={supplement} onChange={e => setSupplement(e.target.value)} style={textareaStyle} />
              </div>
            </div>
          </details>
        </div>

        <div style={{ ...MODAL_FOOTER_STYLE, padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px" }}>
          {mode === "edit" && onDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting || saving}
              style={{ padding: "8px 14px", fontSize: "12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-danger)", cursor: "pointer" }}
            >{deleting ? "削除中…" : "削除"}</button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} disabled={saving || deleting} style={{ padding: "8px 14px", fontSize: "12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}>キャンセル</button>
          <button onClick={handleSave} disabled={saving || deleting} style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 700, background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
