// src/components/admin/AdminView.tsx
//
// 【設計意図】
// 管理画面。OKR/KR・Task Force・PJ・メンバーの4セクションを管理する。
// 全員が編集可（管理者権限なし）。
// 変更はSupabaseに即時反映（AppDataContext経由）。

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { fetchAiUsageLogs } from "../../lib/supabase/store";
import type { AiUsageLog } from "../../lib/supabase/store";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  Member, Objective, KeyResult, TaskForce, ToDo, Project, Milestone,
  QuarterlyObjective, Quarter,
} from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog, alertDialog } from "../../lib/dialog";
import { v4 as uuidv4 } from "uuid";

type AdminTab = "okr" | "tf" | "pj" | "members" | "ai_usage";

interface Props { currentUser: Member; }

// ===== ルートコンポーネント =====

export function AdminView({ currentUser }: Props) {
  const ADMIN_TAB_KEY = "admin_last_tab";
  const [tab, setTab] = useState<AdminTab>(
    () => (localStorage.getItem(ADMIN_TAB_KEY) as AdminTab | null) ?? "pj"
  );

  const changeTab = (t: AdminTab) => {
    setTab(t);
    localStorage.setItem(ADMIN_TAB_KEY, t);
  };

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "pj",       label: "プロジェクト" },
    { key: "members",  label: "メンバー" },
    { key: "tf",       label: "Task Force" },
    { key: "okr",      label: "Objective / KR" },
    { key: "ai_usage", label: "AI使用量" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ヘッダー */}
      <div style={{
        padding: "10px 20px 0",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-primary)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
            管理
          </div>
          <span style={{
            fontSize: "10px", padding: "2px 8px",
            background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
            border: "1px solid var(--color-border-warning)", borderRadius: "99px",
          }}>
            全員が編集できます
          </span>
        </div>
        {/* タブ */}
        <div style={{ display: "flex", gap: "0" }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => changeTab(t.key)}
              style={{
                padding: "6px 14px", fontSize: "12px",
                fontWeight: tab === t.key ? "500" : "400",
                color: tab === t.key ? "var(--color-text-purple)" : "var(--color-text-secondary)",
                background: "transparent", border: "none", cursor: "pointer",
                borderBottom: tab === t.key
                  ? "2px solid var(--color-brand)"
                  : "2px solid transparent",
                transition: "color 0.1s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
        {tab === "okr"      && <OKRSection currentUser={currentUser} />}
        {tab === "tf"       && <TFSection currentUser={currentUser} />}
        {tab === "pj"       && <PJSection currentUser={currentUser} />}
        {tab === "members"  && <MembersSection currentUser={currentUser} />}
        {tab === "ai_usage" && <AIUsageSection />}
      </div>
    </div>
  );
}

// ===================================================
// セクション①：Objective / KR
// ===================================================

function OKRSection({ currentUser }: { currentUser: Member }) {
  const {
    objective: ctxObj, keyResults: rawKrs, saveObjective, saveKeyResult, deleteKeyResult,
    quarterlyObjectives: rawQObjs,
    saveQuarterlyObjective, deleteQuarterlyObjective,
  } = useAppData();
  const krs = useMemo(() => rawKrs.filter(k => !k.is_deleted), [rawKrs]);

  const [editingKrId, setEditingKrId] = useState<string | null>(null);
  const [newKrTitle, setNewKrTitle] = useState("");
  const [objTitle, setObjTitle] = useState(ctxObj?.title ?? "");
  const [objPurpose, setObjPurpose] = useState(ctxObj?.purpose ?? "");
  const [objBackground, setObjBackground] = useState(ctxObj?.background ?? "");
  const [saved, setSaved] = useState(false);
  const [selectedQuarter, setSelectedQuarter] = useState<Quarter>("1Q");

  // ctxObj がロード後に反映
  useEffect(() => {
    if (ctxObj?.title)      setObjTitle(t => t || ctxObj.title);
    if (ctxObj?.purpose)    setObjPurpose(p => p || (ctxObj.purpose ?? ""));
    if (ctxObj?.background) setObjBackground(b => b || (ctxObj.background ?? ""));
  }, [ctxObj]);

  const flashSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const saveObj = async () => {
    const now = new Date().toISOString();
    const updated: Objective = {
      id: ctxObj?.id ?? uuidv4(),
      title: objTitle,
      purpose: objPurpose,
      background: objBackground,
      period: ctxObj?.period ?? "2026年度",
      is_current: true,
      created_at: ctxObj?.created_at ?? now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    try {
      await saveObjective(updated);
      flashSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e != null && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const addKr = async () => {
    if (!newKrTitle.trim()) return;
    const now = new Date().toISOString();
    const kr: KeyResult = {
      id: uuidv4(),
      objective_id: ctxObj?.id ?? "",
      title: newKrTitle.trim(),
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    try {
      await saveKeyResult(kr);
      setNewKrTitle("");
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e != null && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const updateKr = async (id: string, title: string) => {
    const existing = krs.find(k => k.id === id);
    if (!existing) return;
    try {
      await saveKeyResult({ ...existing, title, updated_at: new Date().toISOString(), updated_by: currentUser.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e != null && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
    setEditingKrId(null);
  };

  const deleteKr = async (id: string) => {
    if (!await confirmDialog("このKRを削除しますか？")) return;
    await deleteKeyResult(id, currentUser.id);
  };

  return (
    <div style={{ maxWidth: "680px" }}>
      <SectionHeader title="Objective" badge={ctxObj?.period ?? "2026年度"} />

      {/* Objective編集 */}
      <div style={{ marginBottom: "20px" }}>
        <FieldLabel>Objective（O）タイトル</FieldLabel>
        <AutoTextarea
          value={objTitle}
          onChange={e => setObjTitle(e.target.value)}
          minRows={3}
          maxLength={500}
          style={{ ...inputStyle, width: "100%", marginBottom: "10px" }}
          placeholder="Objectiveのタイトルを入力"
        />
        <FieldLabel>Purpose（何を達成するか）</FieldLabel>
        <AutoTextarea
          value={objPurpose}
          onChange={e => setObjPurpose(e.target.value)}
          minRows={2}
          maxLength={1000}
          style={{ ...inputStyle, width: "100%", marginBottom: "10px" }}
          placeholder="このObjectiveで達成したいことを入力（例：〇〇により△△の状態にする）"
        />
        <FieldLabel>設計の意図や背景</FieldLabel>
        <AutoTextarea
          value={objBackground}
          onChange={e => setObjBackground(e.target.value)}
          minRows={3}
          maxLength={2000}
          style={{ ...inputStyle, width: "100%", marginBottom: "10px" }}
          placeholder="なぜこのObjectiveを設定したか、背景・経緯・意図を入力"
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={saveObj}
            style={{
              ...primaryBtnStyle,
              background: saved ? "var(--color-bg-success)" : undefined,
              color: saved ? "var(--color-text-success)" : undefined,
              border: saved ? "1px solid var(--color-border-success)" : undefined,
              minWidth: "64px",
            }}
          >
            {saved ? "✓ 保存" : "保存"}
          </button>
        </div>
      </div>

      {/* KR一覧 */}
      <SectionHeader title="Key Results" />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
        {krs.map((kr, i) => (
          <div key={kr.id} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <div style={{
              width: "22px", height: "22px", borderRadius: "var(--radius-sm)",
              background: "var(--color-bg-info)", color: "var(--color-text-info)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", fontWeight: "600", flexShrink: 0, marginTop: "6px",
            }}>
              {i + 1}
            </div>
            {editingKrId === kr.id ? (
              <EditInline
                value={kr.title}
                onSave={v => updateKr(kr.id, v)}
                onCancel={() => setEditingKrId(null)}
              />
            ) : (
              <div style={{
                flex: 1, padding: "6px 10px",
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)", fontSize: "12px",
                color: "var(--color-text-primary)", lineHeight: 1.5,
              }}>
                {kr.title}
              </div>
            )}
            <div style={{ display: "flex", gap: "4px", flexShrink: 0, marginTop: "4px" }}>
              <IconBtn title="編集" onClick={() => setEditingKrId(kr.id)}>✏</IconBtn>
              <IconBtn title="削除" danger onClick={() => deleteKr(kr.id)}>✕</IconBtn>
            </div>
          </div>
        ))}
      </div>

      {/* KR追加 */}
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={newKrTitle}
          onChange={e => setNewKrTitle(e.target.value)}
          placeholder="新しいKRを入力して追加"
          maxLength={200}
          style={{ ...inputStyle, flex: 1 }}
          onKeyDown={e => { if (e.key === "Enter") addKr(); }}
        />
        <button onClick={addKr} style={primaryBtnStyle}>＋ 追加</button>
      </div>

      {/* 四半期OKR */}
      <div style={{ marginTop: "32px", borderTop: "1px solid var(--color-border-primary)", paddingTop: "20px" }}>
        <SectionHeader title="四半期 OKR" />
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "14px" }}>
          通期Objectiveを達成するための各クォーターの目標と成果指標を設定します。
        </div>

        {/* クォーター選択タブ */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
          {(["1Q", "2Q", "3Q", "4Q"] as Quarter[]).map(q => (
            <button
              key={q}
              onClick={() => setSelectedQuarter(q)}
              style={{
                padding: "5px 14px", fontSize: "11px", fontWeight: selectedQuarter === q ? "600" : "400",
                border: "1px solid",
                borderColor: selectedQuarter === q ? "var(--color-brand)" : "var(--color-border-primary)",
                borderRadius: "var(--radius-md)", cursor: "pointer",
                background: selectedQuarter === q ? "var(--color-bg-info)" : "var(--color-bg-secondary)",
                color: selectedQuarter === q ? "var(--color-text-info)" : "var(--color-text-secondary)",
                transition: "all 0.1s",
              }}
            >
              {q}
            </button>
          ))}
        </div>

        <QuarterlyOKRPanel
          quarter={selectedQuarter}
          objectiveId={ctxObj?.id ?? ""}
          allQObjs={rawQObjs}
          allKrs={krs}
          currentUser={currentUser}
          onSaveQObj={saveQuarterlyObjective}
          onDeleteQObj={deleteQuarterlyObjective}
        />
      </div>
    </div>
  );
}

// ===================================================
// 四半期OKRパネル（OKRSectionの子）
// ===================================================

// 四半期ごとに「通期KRに対してどのTFを割り当てるか」を管理するパネル。
// KR自体は通期（年間）固定で編集不可。変わるのはTF割り当てのみ。
interface QuarterlyOKRPanelProps {
  quarter: Quarter;
  objectiveId: string;
  allQObjs: QuarterlyObjective[];
  allKrs: KeyResult[];
  currentUser: Member;
  onSaveQObj:   (q: QuarterlyObjective) => Promise<void>;
  onDeleteQObj: (id: string, deletedBy: string) => Promise<void>;
}

function QuarterlyOKRPanel({
  quarter, objectiveId, allQObjs, allKrs, currentUser,
  onSaveQObj, onDeleteQObj,
}: QuarterlyOKRPanelProps) {
  const { taskForces: rawTfs, members: rawMembers, quarterlyKrTaskForces, addQuarterlyKrTaskForce, removeQuarterlyKrTaskForce, saveTaskForce } = useAppData();
  const allTfs = useMemo(() => rawTfs.filter(t => !t.is_deleted), [rawTfs]);
  const allMembers = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);

  // 該当クォーターの QuarterlyObjective（削除済み除く）
  const qObj = useMemo(
    () => allQObjs.find(q => q.quarter === quarter && q.objective_id === objectiveId && !q.is_deleted) ?? null,
    [allQObjs, quarter, objectiveId]
  );

  // QuarterlyObjectiveのタイトル編集
  const [qObjTitle, setQObjTitle] = useState(qObj?.title ?? "");
  const [qObjSaved, setQObjSaved] = useState(false);

  // KRごとのTF新規作成フォーム表示状態: key = kr.id
  const [newTfFormKrId, setNewTfFormKrId] = useState<string | null>(null);
  const [newTfForm, setNewTfForm] = useState({ tf_number: "", name: "", description: "", leader_member_id: "" });

  useEffect(() => {
    setQObjTitle(qObj?.title ?? "");
  }, [qObj]);

  const flashQObjSaved = () => { setQObjSaved(true); setTimeout(() => setQObjSaved(false), 1500); };

  // qObjが未作成の場合は自動生成して保存する
  const ensureQObj = async (): Promise<QuarterlyObjective> => {
    if (qObj) return qObj;
    const now = new Date().toISOString();
    const newQObj: QuarterlyObjective = {
      id: uuidv4(),
      objective_id: objectiveId,
      quarter,
      title: "",
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    await onSaveQObj(newQObj);
    return newQObj;
  };

  const saveQObjTitle = async () => {
    const now = new Date().toISOString();
    let target = qObj;
    if (!target) {
      target = await ensureQObj();
    }
    await onSaveQObj({ ...target, title: qObjTitle, updated_at: now, updated_by: currentUser.id });
    flashQObjSaved();
  };

  const deleteQObj = async () => {
    if (!qObj) return;
    if (!await confirmDialog(`${quarter}のQuarterlyObjectiveを削除しますか？TF割り当ても解除されます。`)) return;
    await onDeleteQObj(qObj.id, currentUser.id);
  };

  // TF割り当て操作
  const handleAddTf = async (krId: string, tfId: string) => {
    const target = await ensureQObj();
    await addQuarterlyKrTaskForce({ quarterly_objective_id: target.id, kr_id: krId, tf_id: tfId });
  };

  const handleRemoveTf = async (krId: string, tfId: string) => {
    if (!qObj) return;
    await removeQuarterlyKrTaskForce(qObj.id, krId, tfId);
  };

  // KRに直接TFを新規作成して即リンク
  const openNewTfForm = (krId: string) => {
    setNewTfFormKrId(krId);
    setNewTfForm({ tf_number: "", name: "", description: "", leader_member_id: allMembers[0]?.id ?? "" });
  };

  const handleCreateAndLinkTf = async (krId: string) => {
    if (!newTfForm.name.trim()) return;
    const now = new Date().toISOString();
    const newTf = {
      id: uuidv4(),
      kr_id: krId,
      tf_number: newTfForm.tf_number.trim(),
      name: newTfForm.name.trim(),
      description: newTfForm.description.trim() || undefined,
      leader_member_id: newTfForm.leader_member_id,
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    try {
      await saveTaskForce(newTf);
      await handleAddTf(krId, newTf.id);
      setNewTfFormKrId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e != null && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      await alertDialog(`TFの作成に失敗しました。\n${msg}`);
    }
  };

  return (
    <div>
      {/* クォーター目標タイトル */}
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", letterSpacing: "0.05em", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
          {quarter} QUARTERLY OBJECTIVE
          {qObj && (
            <button
              onClick={deleteQObj}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "10px", color: "var(--color-text-tertiary)", padding: "0 4px" }}
              title="このクォーターのObjectiveを削除"
            >
              ✕ 削除
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            value={qObjTitle}
            onChange={e => setQObjTitle(e.target.value)}
            placeholder={`${quarter}の目標タイトル（任意）`}
            maxLength={200}
            style={{ ...inputStyle, flex: 1 }}
            disabled={!objectiveId}
            onKeyDown={e => { if (e.key === "Enter") { void saveQObjTitle(); } }}
          />
          <button onClick={() => { void saveQObjTitle(); }} disabled={!objectiveId} style={primaryBtnStyle}>
            {qObjSaved ? "✓ 保存" : "保存"}
          </button>
        </div>
      </div>

      {/* 通期KR × TF割り当て */}
      <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", letterSpacing: "0.05em", marginBottom: "8px" }}>
        KR ごとの Task Force 割り当て（{quarter}）
      </div>
      {!objectiveId && (
        <div style={{ fontSize: "10px", color: "var(--color-text-warning)", marginBottom: "8px" }}>
          先に通期Objectiveを保存してください
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {allKrs.length === 0 && (
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "6px 0" }}>
            通期KRがまだありません。先にKRを追加してください。
          </div>
        )}
        {allKrs.map((kr, i) => {
          const linkedTfIds = qObj
            ? quarterlyKrTaskForces
                .filter(q => q.quarterly_objective_id === qObj.id && q.kr_id === kr.id)
                .map(q => q.tf_id)
            : [];
          const linkedTfs = allTfs.filter(t => linkedTfIds.includes(t.id));
          const unlinkableTfs = allTfs.filter(t => !linkedTfIds.includes(t.id));

          return (
            <div key={kr.id} style={{
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}>
              {/* KRヘッダー（読み取り専用） */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "8px 10px", background: "var(--color-bg-primary)" }}>
                <div style={{
                  width: "22px", height: "22px", borderRadius: "var(--radius-sm)",
                  background: "var(--color-bg-info)", color: "var(--color-text-info)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "10px", fontWeight: "600", flexShrink: 0, marginTop: "2px",
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, fontSize: "12px", color: "var(--color-text-primary)", lineHeight: 1.5, paddingTop: "2px" }}>
                  {kr.title}
                </div>
              </div>

              {/* TF割り当てエリア */}
              <div style={{
                padding: "8px 10px 8px 40px",
                background: "var(--color-bg-secondary)",
                borderTop: "1px solid var(--color-border-primary)",
              }}>
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "6px", fontWeight: "500" }}>
                  {quarter} 担当 Task Force
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                  {linkedTfs.map(tf => (
                    <span key={tf.id} style={{
                      display: "inline-flex", alignItems: "center", gap: "4px",
                      fontSize: "10px", padding: "2px 8px",
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "99px", color: "var(--color-text-secondary)",
                    }}>
                      {tf.tf_number ? `${tf.tf_number} ` : ""}{tf.name}
                      <button
                        onClick={() => { void handleRemoveTf(kr.id, tf.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "0", color: "var(--color-text-tertiary)", fontSize: "10px", lineHeight: 1 }}
                      >×</button>
                    </span>
                  ))}
                  {linkedTfs.length === 0 && (
                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>なし</span>
                  )}
                </div>
                {objectiveId && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                    {unlinkableTfs.length > 0 && (
                      <select
                        defaultValue=""
                        onChange={e => {
                          if (!e.target.value) return;
                          void handleAddTf(kr.id, e.target.value);
                          e.target.value = "";
                        }}
                        style={{ ...inputStyle, fontSize: "11px", padding: "3px 6px" }}
                      >
                        <option value="">既存TFを追加...</option>
                        {unlinkableTfs.map(tf => (
                          <option key={tf.id} value={tf.id}>
                            {tf.tf_number ? `${tf.tf_number} ` : ""}{tf.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {newTfFormKrId !== kr.id && (
                      <button
                        onClick={() => openNewTfForm(kr.id)}
                        style={{ fontSize: "10px", padding: "3px 10px", border: "1px dashed var(--color-border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", background: "transparent", color: "var(--color-text-secondary)" }}
                      >＋ 新規TFを作成</button>
                    )}
                  </div>
                )}

                {/* 新規TF作成インラインフォーム */}
                {newTfFormKrId === kr.id && (
                  <div style={{ marginTop: "8px", padding: "10px", background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "8px" }}>新しいTask Forceを作成してリンク</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "6px", marginBottom: "6px" }}>
                      <div>
                        <FieldLabel>TF番号</FieldLabel>
                        <input value={newTfForm.tf_number} onChange={e => setNewTfForm(f => ({...f, tf_number: e.target.value}))}
                          placeholder="例：TF①-KR1" maxLength={20} style={{ ...inputStyle, fontSize: "11px" }} />
                      </div>
                      <div>
                        <FieldLabel>TF名 *</FieldLabel>
                        <input value={newTfForm.name} onChange={e => setNewTfForm(f => ({...f, name: e.target.value}))}
                          placeholder="例：市場調査TF" maxLength={100} style={{ ...inputStyle, fontSize: "11px" }}
                          onKeyDown={e => { if (e.key === "Enter") { void handleCreateAndLinkTf(kr.id); } }} />
                      </div>
                    </div>
                    <div style={{ marginBottom: "6px" }}>
                      <FieldLabel>詳細・目的（任意）</FieldLabel>
                      <textarea value={newTfForm.description} onChange={e => setNewTfForm(f => ({...f, description: e.target.value}))}
                        placeholder="このTask Forceの目的・活動内容（任意）" maxLength={500} rows={2}
                        style={{ ...inputStyle, fontSize: "11px", resize: "vertical", lineHeight: 1.5 }} />
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <FieldLabel>リーダー</FieldLabel>
                      <select value={newTfForm.leader_member_id} onChange={e => setNewTfForm(f => ({...f, leader_member_id: e.target.value}))} style={{ ...inputStyle, fontSize: "11px" }}>
                        {allMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => { void handleCreateAndLinkTf(kr.id); }} style={primaryBtnStyle}>作成してリンク</button>
                      <button onClick={() => setNewTfFormKrId(null)} style={ghostBtnStyle}>キャンセル</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===================================================
// セクション②：Task Force
// ===================================================

function TFSection({ currentUser }: { currentUser: Member }) {
  const {
    taskForces: rawTfs, keyResults: rawKrs, members: rawMembers,
    todos: rawTodos, tasks: rawTasks,
    saveTaskForce, deleteTaskForce,
    saveToDo, deleteToDo, saveTask,
  } = useAppData();
  const allTasks = useMemo(() => rawTasks.filter(t => !t.is_deleted), [rawTasks]);
  const isMobile = useIsMobile();
  const tfs     = useMemo(() => rawTfs.filter(t => !t.is_deleted), [rawTfs]);
  const krs     = useMemo(() => rawKrs.filter(k => !k.is_deleted), [rawKrs]);
  const members = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);
  const todos   = useMemo(() => rawTodos.filter(t => !t.is_deleted), [rawTodos]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ kr_id: "", tf_number: "", name: "", description: "", leader_member_id: "" });

  const openAdd = () => {
    setEditId("new");
    setForm({ kr_id: krs[0]?.id ?? "", tf_number: "", name: "", description: "", leader_member_id: members[0]?.id ?? "" });
  };

  const openEdit = (tf: TaskForce) => {
    setEditId(tf.id);
    setForm({ kr_id: tf.kr_id, tf_number: tf.tf_number, name: tf.name, description: tf.description ?? "", leader_member_id: tf.leader_member_id });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const now = new Date().toISOString();
    try {
      if (editId === "new") {
        await saveTaskForce({ id: uuidv4(), ...form, description: form.description || undefined, is_deleted: false, created_at: now, updated_at: now, updated_by: currentUser.id });
      } else {
        const existing = tfs.find(t => t.id === editId);
        if (existing) await saveTaskForce({ ...existing, ...form, description: form.description || undefined, updated_at: now, updated_by: currentUser.id });
      }
      setEditId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e != null && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const deleteTF = async (id: string) => {
    if (!await confirmDialog("このTask Forceを削除しますか？紐づくPJの関連は解除されます。")) return;
    await deleteTaskForce(id, currentUser.id);
  };

  // KRごとにグループ表示
  const grouped = krs.map((kr, idx) => ({
    kr, idx,
    items: tfs.filter(t => t.kr_id === kr.id),
  }));
  const orphans = tfs.filter(t => !krs.find(k => k.id === t.kr_id));

  return (
    <div style={{ maxWidth: "680px" }}>
      <SectionHeader title="Task Force" action={
        <button onClick={openAdd} style={primaryBtnStyle}>＋ 追加</button>
      } />

      {grouped.map(({ kr, idx, items }) => (
        <div key={kr.id} style={{ marginBottom: "16px" }}>
          <div style={{
            fontSize: "11px", fontWeight: "500", color: "var(--color-text-info)",
            marginBottom: "6px", display: "flex", alignItems: "center", gap: "5px",
          }}>
            <span style={{
              background: "var(--color-bg-info)", padding: "1px 6px",
              borderRadius: "3px", border: "1px solid var(--color-border-info)",
            }}>KR{idx + 1}</span>
            <span style={{ color: "var(--color-text-secondary)", fontWeight: "400" }}>
              {kr.title.slice(0, 40)}
            </span>
          </div>
          {items.length === 0 && (
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", paddingLeft: "12px" }}>
              TFなし
            </div>
          )}
          {items.map(tf => (
            <TFRow key={tf.id} tf={tf} members={members}
              todos={todos.filter(t => t.tf_id === tf.id)}
              tasks={allTasks} saveTask={saveTask}
              currentUser={currentUser}
              onEdit={() => openEdit(tf)} onDelete={() => deleteTF(tf.id)}
              onSaveToDo={saveToDo} onDeleteToDo={deleteToDo}
            />
          ))}
        </div>
      ))}
      {orphans.map(tf => (
        <TFRow key={tf.id} tf={tf} members={members}
          todos={todos.filter(t => t.tf_id === tf.id)}
          tasks={allTasks} saveTask={saveTask}
          currentUser={currentUser}
          onEdit={() => openEdit(tf)} onDelete={() => deleteTF(tf.id)}
          onSaveToDo={saveToDo} onDeleteToDo={deleteToDo}
        />
      ))}

      {/* 追加・編集フォーム */}
      {editId && (
        <div style={{
          marginTop: "12px", padding: "14px",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "500", marginBottom: "10px", color: "var(--color-text-primary)" }}>
            {editId === "new" ? "Task Forceを追加" : "Task Forceを編集"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
            <div>
              <FieldLabel>紐づくKR</FieldLabel>
              <select value={form.kr_id} onChange={e => setForm(f => ({...f, kr_id: e.target.value}))} style={inputStyle}>
                {krs.map((k, i) => <option key={k.id} value={k.id}>KR{i+1}: {k.title.slice(0,24)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>TF番号</FieldLabel>
              <input value={form.tf_number} onChange={e => setForm(f => ({...f, tf_number: e.target.value}))}
                placeholder="例：TF①-KR1" maxLength={20} style={inputStyle} />
            </div>
            <div>
              <FieldLabel>TF名 *</FieldLabel>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                placeholder="例：市場調査TF" maxLength={100} style={inputStyle} />
            </div>
            <div>
              <FieldLabel>リーダー</FieldLabel>
              <select value={form.leader_member_id} onChange={e => setForm(f => ({...f, leader_member_id: e.target.value}))} style={inputStyle}>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: "8px" }}>
            <FieldLabel>詳細・目的（任意）</FieldLabel>
            <textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
              placeholder="このTask Forceの目的・活動内容を記入（任意）" maxLength={500} rows={3}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={save} style={primaryBtnStyle}>保存</button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TFRow({ tf, members, todos, tasks, saveTask, currentUser, onEdit, onDelete, onSaveToDo, onDeleteToDo }: {
  tf: TaskForce; members: Member[];
  todos: ToDo[]; tasks: import("../../lib/localData/types").Task[];
  saveTask: (task: import("../../lib/localData/types").Task) => Promise<void>;
  currentUser: Member;
  onEdit: () => void; onDelete: () => void;
  onSaveToDo: (todo: ToDo) => Promise<void>;
  onDeleteToDo: (id: string, deletedBy: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const leader = members.find(m => m.id === tf.leader_member_id);
  return (
    <div style={{
      marginBottom: "4px",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
    }}>
      {/* ヘッダー行 */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "7px 10px",
        background: "var(--color-bg-primary)",
      }}>
        <span style={{
          fontSize: "10px", padding: "1px 7px", borderRadius: "3px",
          background: "var(--color-brand-light)", color: "var(--color-text-purple)",
          border: "1px solid var(--color-brand-border)", flexShrink: 0,
        }}>{tf.tf_number}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "var(--color-text-primary)" }}>{tf.name}</div>
          {tf.description && (
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
              {tf.description}
            </div>
          )}
        </div>
        {leader && <Avatar member={leader} size={18} />}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            fontSize: "10px", padding: "2px 8px",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)", cursor: "pointer",
            background: expanded ? "var(--color-bg-info)" : "transparent",
            color: expanded ? "var(--color-text-info)" : "var(--color-text-tertiary)",
            flexShrink: 0,
          }}
        >
          ToDo {todos.length}件 {expanded ? "▴" : "▾"}
        </button>
        <IconBtn onClick={onEdit}>✏</IconBtn>
        <IconBtn danger onClick={onDelete}>✕</IconBtn>
      </div>

      {/* ToDoパネル（展開時） */}
      {expanded && (
        <ToDoPanel
          tfId={tf.id}
          todos={todos}
          tasks={tasks}
          members={members}
          saveTask={saveTask}
          currentUser={currentUser}
          onSave={onSaveToDo}
          onDelete={onDeleteToDo}
        />
      )}
    </div>
  );
}

// ===== ToDoパネル =====

function ToDoPanel({ tfId, todos, tasks, members, saveTask, currentUser, onSave, onDelete }: {
  tfId: string; todos: ToDo[];
  tasks: import("../../lib/localData/types").Task[];
  members: Member[];
  saveTask: (task: import("../../lib/localData/types").Task) => Promise<void>;
  currentUser: Member;
  onSave: (todo: ToDo) => Promise<void>;
  onDelete: (id: string, deletedBy: string) => Promise<void>;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", due_date: "", memo: "" });
  const [addingTaskForTodoId, setAddingTaskForTodoId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ name: "", assignee_member_id: "", due_date: "" });
  const [expandedTodoId, setExpandedTodoId] = useState<string | null>(null);

  const openAdd = () => {
    setEditId("new");
    setForm({ title: "", due_date: "", memo: "" });
  };

  const openEdit = (todo: ToDo) => {
    setEditId(todo.id);
    setForm({ title: todo.title, due_date: todo.due_date ?? "", memo: todo.memo });
  };

  const save = async () => {
    if (!form.title.trim()) return;
    const now = new Date().toISOString();
    const isNew = editId === "new";
    const existing = !isNew ? todos.find(t => t.id === editId) : undefined;
    const todo: ToDo = {
      id: isNew ? uuidv4() : editId!,
      tf_id: tfId,
      title: form.title.trim(),
      due_date: form.due_date || null,
      memo: form.memo,
      is_deleted: false,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    await onSave(todo);
    setEditId(null);
  };

  const deleteTodo = async (id: string) => {
    if (!await confirmDialog("このToDoを削除しますか？")) return;
    await onDelete(id, currentUser.id);
  };

  const openAddTask = (todoId: string) => {
    setAddingTaskForTodoId(todoId);
    setTaskForm({ name: "", assignee_member_id: members[0]?.id ?? "", due_date: "" });
  };

  const saveNewTask = async () => {
    if (!taskForm.name.trim() || !addingTaskForTodoId) return;
    const now = new Date().toISOString();
    const newTask: import("../../lib/localData/types").Task = {
      id: uuidv4(),
      name: taskForm.name.trim(),
      project_id: null,
      todo_id: addingTaskForTodoId,
      assignee_member_id: taskForm.assignee_member_id,
      status: "todo",
      priority: null,
      due_date: taskForm.due_date || null,
      estimated_hours: null,
      comment: "",
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    await saveTask(newTask);
    setAddingTaskForTodoId(null);
  };

  const toggleTodoTasks = (todoId: string) => {
    setExpandedTodoId(prev => prev === todoId ? null : todoId);
  };

  return (
    <div style={{
      padding: "10px 12px 10px 14px",
      background: "var(--color-bg-secondary)",
      borderTop: "1px solid var(--color-border-primary)",
    }}>
      <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", marginBottom: "8px", letterSpacing: "0.05em" }}>
        ToDo
      </div>

      {/* ToDo一覧 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
        {todos.map((todo, i) => (
          editId === todo.id ? (
            <ToDoForm key={todo.id} form={form} setForm={setForm} onSave={save} onCancel={() => setEditId(null)} />
          ) : (
            <div key={todo.id} style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}>
              {/* ToDoヘッダー */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "8px 10px" }}>
                <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px", flexShrink: 0, minWidth: "14px" }}>{i + 1}.</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", color: "var(--color-text-primary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {todo.title}
                  </div>
                  {(todo.due_date || todo.memo) && (
                    <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px", display: "flex", gap: "8px" }}>
                      {todo.due_date && <span>期日: {todo.due_date}</span>}
                      {todo.memo && <span style={{ flex: 1 }}>{todo.memo}</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "4px", flexShrink: 0, alignItems: "center" }}>
                  {/* タスク数バッジ（クリックでタスク一覧toggle） */}
                  {(() => {
                    const todoTasks = tasks.filter(t => t.todo_id === todo.id);
                    const done = todoTasks.filter(t => t.status === "done").length;
                    return (
                      <button onClick={() => toggleTodoTasks(todo.id)} style={{
                        fontSize: "9px", padding: "1px 7px", borderRadius: "var(--radius-full)",
                        background: expandedTodoId === todo.id ? "var(--color-bg-info)" : "var(--color-bg-secondary)",
                        color: expandedTodoId === todo.id ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                        border: `1px solid ${expandedTodoId === todo.id ? "var(--color-border-info)" : "var(--color-border-primary)"}`,
                        cursor: "pointer",
                      }}>
                        タスク {done}/{todoTasks.length}
                      </button>
                    );
                  })()}
                  <IconBtn onClick={() => openEdit(todo)}>✏</IconBtn>
                  <IconBtn danger onClick={() => deleteTodo(todo.id)}>✕</IconBtn>
                </div>
              </div>

              {/* タスク一覧（展開時） */}
              {expandedTodoId === todo.id && (() => {
                const todoTasks = tasks.filter(t => t.todo_id === todo.id);
                return (
                  <div style={{ borderTop: "1px solid var(--color-border-primary)", background: "var(--color-bg-secondary)", padding: "8px 10px" }}>
                    {todoTasks.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "6px" }}>
                        {todoTasks.map(task => {
                          const m = members.find(mb => mb.id === task.assignee_member_id);
                          const statusColors = { todo: "var(--color-text-tertiary)", in_progress: "var(--color-text-info)", done: "var(--color-text-success)" };
                          const statusLabels = { todo: "未着手", in_progress: "進行中", done: "完了" };
                          return (
                            <div key={task.id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px", background: "var(--color-bg-primary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-primary)" }}>
                              <span style={{ fontSize: "9px", color: statusColors[task.status], fontWeight: "500", flexShrink: 0 }}>{statusLabels[task.status]}</span>
                              <span style={{ fontSize: "11px", color: "var(--color-text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</span>
                              {m && <Avatar member={m} size={14} />}
                              {task.due_date && <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>{task.due_date.slice(5).replace("-", "/")}</span>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "6px" }}>タスクなし</div>
                    )}

                    {/* タスク追加フォーム */}
                    {addingTaskForTodoId === todo.id ? (
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <input
                          autoFocus
                          value={taskForm.name}
                          onChange={e => setTaskForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="タスク名"
                          onKeyDown={e => { if (e.key === "Enter") saveNewTask(); if (e.key === "Escape") setAddingTaskForTodoId(null); }}
                          style={{ ...inputStyle, flex: "1 1 180px", fontSize: "11px", padding: "4px 8px" }}
                        />
                        <select value={taskForm.assignee_member_id} onChange={e => setTaskForm(f => ({ ...f, assignee_member_id: e.target.value }))} style={{ ...inputStyle, flex: "0 0 auto", fontSize: "11px", padding: "4px 8px" }}>
                          {members.map(m => <option key={m.id} value={m.id}>{m.short_name}</option>)}
                        </select>
                        <input type="date" value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} style={{ ...inputStyle, flex: "0 0 auto", fontSize: "11px", padding: "4px 8px" }} />
                        <button onClick={saveNewTask} style={{ ...primaryBtnStyle, fontSize: "11px", padding: "4px 10px" }}>追加</button>
                        <button onClick={() => setAddingTaskForTodoId(null)} style={{ ...ghostBtnStyle, fontSize: "11px", padding: "4px 10px" }}>×</button>
                      </div>
                    ) : (
                      <button onClick={() => openAddTask(todo.id)} style={{ ...ghostBtnStyle, fontSize: "11px" }}>＋ タスクを追加</button>
                    )}
                  </div>
                );
              })()}
            </div>
          )
        ))}
        {todos.length === 0 && editId !== "new" && (
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
            まだToDoがありません
          </div>
        )}
      </div>

      {/* 追加フォーム or 追加ボタン */}
      {editId === "new" ? (
        <ToDoForm form={form} setForm={setForm} onSave={save} onCancel={() => setEditId(null)} />
      ) : (
        <button onClick={openAdd} style={{ ...ghostBtnStyle, fontSize: "11px" }}>＋ ToDoを追加</button>
      )}
    </div>
  );
}

// ===== ToDoフォーム =====

function ToDoForm({
  form, setForm, onSave, onCancel,
}: {
  form: { title: string; due_date: string; memo: string };
  setForm: React.Dispatch<React.SetStateAction<{ title: string; due_date: string; memo: string }>>;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      padding: "10px 12px",
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-info)",
      borderRadius: "var(--radius-md)",
    }}>
      <FieldLabel>ToDo内容 *</FieldLabel>
      <AutoTextarea
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        placeholder="例：TF2の定量目標達成の基準となる評価指標の策定"
        minRows={2}
        style={{ ...inputStyle, width: "100%", marginBottom: "8px" }}
      />
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>期日（任意）</FieldLabel>
          <input
            type="date"
            value={form.due_date}
            onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 2 }}>
          <FieldLabel>備考（任意）</FieldLabel>
          <input
            value={form.memo}
            onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
            placeholder="補足メモ"
            maxLength={200}
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onSave} style={primaryBtnStyle}>保存</button>
        <button onClick={onCancel} style={ghostBtnStyle}>キャンセル</button>
      </div>
    </div>
  );
}

// ===================================================
// セクション③：プロジェクト
// ===================================================

function PJSection({ currentUser }: { currentUser: Member }) {
  const { projects: rawProjects, members: rawMembers, saveProject, deleteProject, milestones: rawMilestones, saveMilestone, deleteMilestone } = useAppData();
  const isMobile = useIsMobile();
  const projects   = useMemo(() => rawProjects.filter(p => !p.is_deleted), [rawProjects]);
  const members    = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);
  const milestones = useMemo(() => (rawMilestones ?? []).filter((ms: Milestone) => !ms.is_deleted), [rawMilestones]);

  // マイルストーン管理：開閉のみ（フォーム状態は子コンポーネントが管理）
  const [msOpenPjId, setMsOpenPjId] = useState<string | null>(null);

  const removeMilestone = async (id: string) => {
    if (!await confirmDialog("このマイルストーンを削除しますか？")) return;
    await deleteMilestone(id, currentUser.id);
  };

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", purpose: "", contribution_memo: "",
    owner_member_ids: [] as string[], status: "active" as Project["status"],
    color_tag: "#7F77DD", start_date: "", end_date: "",
  });

  const openAdd = () => {
    setEditId("new");
    setForm({
      name: "", purpose: "", contribution_memo: "",
      owner_member_ids: members[0] ? [members[0].id] : [],
      status: "active", color_tag: "#7F77DD",
      start_date: new Date().toISOString().split("T")[0],
      end_date: `${new Date().getFullYear()}-12-31`,
    });
  };

  const openEdit = (pj: Project) => {
    setEditId(pj.id);
    setForm({
      name: pj.name, purpose: pj.purpose,
      contribution_memo: pj.contribution_memo,
      owner_member_ids: pj.owner_member_ids?.length ? pj.owner_member_ids : (pj.owner_member_id ? [pj.owner_member_id] : []),
      status: pj.status,
      color_tag: pj.color_tag, start_date: pj.start_date, end_date: pj.end_date,
    });
  };

  const save = async () => {
    if (!form.name.trim() || !form.purpose.trim()) return;
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      await alertDialog("開始日は終了日より前に設定してください。");
      return;
    }
    const now = new Date().toISOString();
    // owner_member_id は先頭のオーナーで後方互換を保つ
    const owner_member_id = form.owner_member_ids[0] ?? "";
    try {
      if (editId === "new") {
        await saveProject({ id: uuidv4(), ...form, owner_member_id, is_deleted: false, created_at: now, updated_at: now, updated_by: currentUser.id });
      } else {
        const existing = projects.find(p => p.id === editId);
        if (existing) await saveProject({ ...existing, ...form, owner_member_id, updated_at: now, updated_by: currentUser.id });
      }
      setEditId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e != null && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const deletePJ = async (id: string) => {
    if (!await confirmDialog("このプロジェクトを削除しますか？紐づくタスクも一緒に削除されます。")) return;
    await deleteProject(id, currentUser.id);
  };

  const STATUS_LABELS: Record<Project["status"], string> = {
    active: "進行中", completed: "完了", archived: "アーカイブ",
  };

  return (
    <div style={{ maxWidth: "720px" }}>
      <SectionHeader title="プロジェクト一覧" action={
        <button onClick={openAdd} style={primaryBtnStyle}>＋ 追加</button>
      } />

      {projects.map(pj => {
        const owners = (pj.owner_member_ids?.length ? pj.owner_member_ids : (pj.owner_member_id ? [pj.owner_member_id] : []))
          .map(id => members.find(m => m.id === id))
          .filter((m): m is Member => !!m);
        return (
          <div key={pj.id} style={{ marginBottom: "6px" }}>
          <div style={{
            display: "flex", alignItems: "flex-start", gap: "10px",
            padding: "10px 12px",
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
          }}>
            <div style={{
              width: "6px", height: "36px", borderRadius: "3px",
              background: pj.color_tag, flexShrink: 0, marginTop: "2px",
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)" }}>
                  {pj.name}
                </span>
                <span style={{
                  fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                  background: pj.status === "active" ? "var(--color-bg-success)" : "var(--color-bg-tertiary)",
                  color: pj.status === "active" ? "var(--color-text-success)" : "var(--color-text-tertiary)",
                }}>
                  {STATUS_LABELS[pj.status]}
                </span>
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                {pj.purpose.slice(0, 60)}{pj.purpose.length > 60 ? "…" : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
              {owners.map(m => <Avatar key={m.id} member={m} size={20} />)}
            </div>
            <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
              <IconBtn onClick={() => setMsOpenPjId(msOpenPjId === pj.id ? null : pj.id)}>◆</IconBtn>
              <IconBtn onClick={() => openEdit(pj)}>✏</IconBtn>
              <IconBtn danger onClick={() => deletePJ(pj.id)}>✕</IconBtn>
            </div>
          </div>

          {/* マイルストーンパネル */}
          {msOpenPjId === pj.id && (
            <div style={{
              marginTop: "6px", padding: "10px 12px",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
            }}>
              <div style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "8px" }}>
                ◆ マイルストーン
              </div>
              {/* 既存一覧 */}
              {milestones.filter(ms => ms.project_id === pj.id).length === 0 ? (
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
                  まだありません
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                  {milestones.filter(ms => ms.project_id === pj.id).sort((a, b) => a.date.localeCompare(b.date)).map(ms => (
                    <div key={ms.id} style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      padding: "4px 8px",
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-sm)",
                    }}>
                      <span style={{ fontSize: "11px", color: "#f59e0b", flexShrink: 0 }}>◆</span>
                      <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", flexShrink: 0 }}>{ms.date}</span>
                      <span style={{ fontSize: "11px", color: "var(--color-text-primary)", flex: 1 }}>{ms.name}</span>
                      <IconBtn danger onClick={() => removeMilestone(ms.id)}>✕</IconBtn>
                    </div>
                  ))}
                </div>
              )}
              {/* 追加フォーム（PJごとに独立した状態） */}
              <MilestoneAddForm
                pjId={pj.id}
                currentUserId={currentUser.id}
                onAdd={saveMilestone}
              />
            </div>
          )}
          </div>
        );
      })}

      {/* 追加・編集フォーム */}
      {editId && (
        <div style={{
          marginTop: "12px", padding: "16px",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "500", marginBottom: "12px", color: "var(--color-text-primary)" }}>
            {editId === "new" ? "プロジェクトを追加" : "プロジェクトを編集"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <FieldLabel>PJ名 *</FieldLabel>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                placeholder="例：AI動画生成の効率化" maxLength={100} style={inputStyle} />
            </div>
            <div>
              <FieldLabel>目的 * （何のためのPJか1行で）</FieldLabel>
              <input value={form.purpose} onChange={e => setForm(f => ({...f, purpose: e.target.value}))}
                placeholder="例：動画生成AIを活用し全員が動画を作れる体制を構築する" maxLength={200} style={inputStyle} />
            </div>
            <div>
              <FieldLabel>貢献メモ（KRとの関連）</FieldLabel>
              <textarea value={form.contribution_memo} onChange={e => setForm(f => ({...f, contribution_memo: e.target.value}))}
                placeholder="例：KR②のインバウンドマーケティング目標達成に貢献" rows={2}
                maxLength={500}
                style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <div>
                <FieldLabel>オーナー</FieldLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
                  {form.owner_member_ids.map(id => {
                    const m = members.find(m => m.id === id);
                    if (!m) return null;
                    return (
                      <span key={id} style={{
                        display: "inline-flex", alignItems: "center", gap: "4px",
                        fontSize: "11px", padding: "2px 8px",
                        background: "var(--color-bg-tertiary)",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "var(--radius-full)",
                      }}>
                        {m.short_name}
                        <button onClick={() => setForm(f => ({ ...f, owner_member_ids: f.owner_member_ids.filter(i => i !== id) }))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0", lineHeight: 1, color: "var(--color-text-tertiary)" }}>×</button>
                      </span>
                    );
                  })}
                </div>
                <select
                  value=""
                  onChange={e => {
                    const id = e.target.value;
                    if (id && !form.owner_member_ids.includes(id))
                      setForm(f => ({ ...f, owner_member_ids: [...f.owner_member_ids, id] }));
                  }}
                  style={inputStyle}
                >
                  <option value="">＋ オーナーを追加</option>
                  {members.filter(m => !form.owner_member_ids.includes(m.id)).map(m => (
                    <option key={m.id} value={m.id}>{m.display_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>ステータス</FieldLabel>
                <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value as Project["status"]}))} style={inputStyle}>
                  <option value="active">進行中</option>
                  <option value="completed">完了</option>
                  <option value="archived">アーカイブ</option>
                </select>
              </div>
              <div>
                <FieldLabel>カラー</FieldLabel>
                <input type="color" value={form.color_tag}
                  onChange={e => setForm(f => ({...f, color_tag: e.target.value}))}
                  style={{ ...inputStyle, padding: "2px", height: "32px", cursor: "pointer" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
              <div>
                <FieldLabel>開始日</FieldLabel>
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({...f, start_date: e.target.value}))} style={inputStyle} />
              </div>
              <div>
                <FieldLabel>終了日</FieldLabel>
                <input type="date" value={form.end_date} onChange={e => setForm(f => ({...f, end_date: e.target.value}))} style={inputStyle} />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={save} style={primaryBtnStyle}
              disabled={!form.name.trim() || !form.purpose.trim()}>
              保存
            </button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================================================
// セクション④：メンバー
// ===================================================

function MembersSection({ currentUser }: { currentUser: Member }) {
  const { members: rawMembers, saveMember, deleteMember } = useAppData();
  const isMobile = useIsMobile();
  const members = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    display_name: "", short_name: "", teams_account: "",
    color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)",
  });

  const COLORS = [
    { bg: "var(--avatar-1-bg)", text: "var(--avatar-1-text)" },
    { bg: "var(--avatar-2-bg)", text: "var(--avatar-2-text)" },
    { bg: "var(--avatar-3-bg)", text: "var(--avatar-3-text)" },
    { bg: "var(--avatar-0-bg)", text: "var(--avatar-0-text)" },
    { bg: "var(--avatar-5-bg)", text: "var(--avatar-5-text)" },
    { bg: "var(--avatar-7-bg)", text: "var(--avatar-7-text)" },
  ];

  const openAdd = () => {
    setEditId("new");
    setForm({ display_name: "", short_name: "", teams_account: "", color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)" });
  };

  const openEdit = (m: Member) => {
    setEditId(m.id);
    setForm({ display_name: m.display_name, short_name: m.short_name, teams_account: m.teams_account, color_bg: m.color_bg, color_text: m.color_text });
  };

  const save = async () => {
    if (!form.display_name.trim()) return;
    // イニシャル自動生成
    const initials = form.display_name.replace(/[\s　]+/g, "").slice(0, 2).toUpperCase();
    const shortName = form.short_name.trim() || form.display_name.split(/[\s　]/)[0];

    const now = new Date().toISOString();
    try {
      if (editId === "new") {
        await saveMember({
          id: uuidv4(), initials,
          display_name: form.display_name.trim(),
          short_name: shortName,
          teams_account: form.teams_account,
          color_bg: form.color_bg, color_text: form.color_text,
          is_deleted: false,
          created_at: now, updated_at: now, updated_by: currentUser.id,
        });
      } else {
        const existing = members.find(m => m.id === editId);
        if (existing) await saveMember({ ...existing, ...form, short_name: shortName, initials, updated_at: now, updated_by: currentUser.id });
      }
      setEditId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : (e != null && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
        : String(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const handleDeleteMember = async (id: string) => {
    if (id === currentUser.id) { await alertDialog("自分自身は削除できません。"); return; }
    if (!await confirmDialog("このメンバーを削除しますか？担当タスクは「未担当」になります。")) return;
    await deleteMember(id, currentUser.id);
  };

  return (
    <div style={{ maxWidth: "560px" }}>
      <SectionHeader title="メンバーマスタ" action={
        <button onClick={openAdd} style={primaryBtnStyle}>＋ 追加</button>
      } />

      <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "14px" }}>
        {members.map(m => (
          <div key={m.id} style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: "8px 12px",
            background: "var(--color-bg-primary)",
            border: `1px solid ${m.id === currentUser.id ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
            borderRadius: "var(--radius-md)",
          }}>
            <Avatar member={m} size={28} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)" }}>
                {m.display_name}
                {m.id === currentUser.id && (
                  <span style={{ fontSize: "9px", marginLeft: "6px", color: "var(--color-text-purple)", background: "var(--color-brand-light)", padding: "1px 6px", borderRadius: "3px" }}>
                    あなた
                  </span>
                )}
              </div>
              {m.teams_account && (
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{m.teams_account}</div>
              )}
            </div>
            <IconBtn onClick={() => openEdit(m)}>✏</IconBtn>
            <IconBtn danger onClick={() => handleDeleteMember(m.id)}>✕</IconBtn>
          </div>
        ))}
      </div>

      {/* 追加・編集フォーム */}
      {editId && (
        <div style={{
          padding: "14px", background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "500", marginBottom: "10px", color: "var(--color-text-primary)" }}>
            {editId === "new" ? "メンバーを追加" : "メンバーを編集"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
              <div>
                <FieldLabel>氏名 * （イニシャルは自動生成）</FieldLabel>
                <input value={form.display_name} onChange={e => setForm(f => ({...f, display_name: e.target.value}))}
                  placeholder="例：田中 一郎" maxLength={50} style={inputStyle} />
              </div>
              <div>
                <FieldLabel>短縮名（省略可）</FieldLabel>
                <input value={form.short_name} onChange={e => setForm(f => ({...f, short_name: e.target.value}))}
                  placeholder="例：田中（未入力で姓を使用）" style={inputStyle} />
              </div>
            </div>
            <div>
              <FieldLabel>Teamsアカウント（任意）</FieldLabel>
              <input value={form.teams_account} onChange={e => setForm(f => ({...f, teams_account: e.target.value}))}
                placeholder="例：y.yamamoto@amita-net.co.jp" style={inputStyle} />
            </div>
            <div>
              <FieldLabel>アバターカラー</FieldLabel>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {COLORS.map(c => (
                  <button
                    key={c.bg}
                    onClick={() => setForm(f => ({...f, color_bg: c.bg, color_text: c.text}))}
                    style={{
                      width: "28px", height: "28px", borderRadius: "50%",
                      background: c.bg, border: form.color_bg === c.bg
                        ? `2px solid ${c.text}` : "2px solid transparent",
                      cursor: "pointer",
                      boxShadow: form.color_bg === c.bg ? "0 0 0 2px white inset" : "none",
                    }}
                  />
                ))}
              </div>
              {/* プレビュー */}
              <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{
                  width: "28px", height: "28px", borderRadius: "50%",
                  background: form.color_bg, color: form.color_text,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "11px", fontWeight: "600",
                }}>
                  {form.display_name.replace(/[\s　]+/g,"").slice(0,2).toUpperCase() || "??"}
                </div>
                <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {form.display_name || "氏名を入力してください"}
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={save} disabled={!form.display_name.trim()} style={{
              ...primaryBtnStyle,
              opacity: form.display_name.trim() ? 1 : 0.4,
              cursor: form.display_name.trim() ? "pointer" : "not-allowed",
            }}>保存</button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================================================
// 共通UI部品
// ===================================================

function SectionHeader({ title, badge, action }: {
  title: string; badge?: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
      <span style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-primary)" }}>{title}</span>
      {badge && (
        <span style={{
          fontSize: "10px", padding: "1px 7px", borderRadius: "99px",
          background: "var(--color-bg-success)", color: "var(--color-text-success)",
          border: "1px solid var(--color-border-success)",
        }}>{badge}</span>
      )}
      {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "3px" }}>
      {children}
    </div>
  );
}

/** テキスト量に応じて高さが自動伸縮するtextarea */
function AutoTextarea({ value, onChange, placeholder, maxLength, minRows = 2, style }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  maxLength?: number;
  minRows?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = ref.current.scrollHeight + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={minRows}
      style={{ ...style, resize: "none", overflow: "hidden" }}
    />
  );
}

function IconBtn({ children, onClick, title, danger }: {
  children: React.ReactNode; onClick: () => void; title?: string; danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "24px", height: "24px", borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border-primary)",
        background: danger && hover ? "var(--color-bg-danger)" : hover ? "var(--color-bg-secondary)" : "transparent",
        color: danger && hover ? "var(--color-text-danger)" : "var(--color-text-secondary)",
        fontSize: "11px", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.1s, color 0.1s",
      }}
    >
      {children}
    </button>
  );
}

function EditInline({ value, onSave, onCancel }: {
  value: string; onSave: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  return (
    <div style={{ display: "flex", gap: "6px", flex: 1 }}>
      <input value={v} onChange={e => setV(e.target.value)}
        style={{ ...inputStyle, flex: 1 }}
        autoFocus
        onKeyDown={e => {
          if (e.key === "Enter") onSave(v);
          if (e.key === "Escape") onCancel();
        }}
      />
      <button onClick={() => onSave(v)} style={primaryBtnStyle}>保存</button>
      <button onClick={onCancel} style={ghostBtnStyle}>✕</button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 9px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg-primary)",
  outline: "none",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", fontSize: "11px", fontWeight: "500",
  background: "var(--color-bg-info)", color: "var(--color-text-info)",
  border: "1px solid var(--color-border-info)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
};
const ghostBtnStyle: React.CSSProperties = {
  padding: "5px 12px", fontSize: "11px",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
  background: "transparent",
};

// ===== MilestoneAddForm =====
// PJごとに独立したフォーム状態を持つことでPJ間の入力混在を防ぐ

// 週文字列（"2026-W13"）をその週の月曜日の日付に変換する
function weekToDate(weekStr: string): string {
  const [yearStr, weekPart] = weekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekPart, 10);
  // 1月4日は常にW1に含まれる
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  return monday.toISOString().split("T")[0];
}

// 日付文字列から週の月曜〜日曜の範囲ラベルを生成する（例: "3/23〜3/29"）
function weekRangeLabel(dateStr: string): string {
  const mon = new Date(dateStr);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${mon.getMonth() + 1}/${mon.getDate()}〜${sun.getMonth() + 1}/${sun.getDate()}`;
}

interface MilestoneAddFormProps {
  pjId: string;
  currentUserId: string;
  onAdd: (ms: import("../../lib/localData/types").Milestone) => Promise<void>;
}

function MilestoneAddForm({ pjId, currentUserId, onAdd }: MilestoneAddFormProps) {
  const [dateMode, setDateMode] = useState<"date" | "week">("date");
  const [dateVal, setDateVal]     = useState("");
  const [weekVal, setWeekVal]     = useState("");
  const [name, setName]           = useState("");
  const [description, setDescription] = useState("");

  const resolvedDate = dateMode === "date" ? dateVal : (weekVal ? weekToDate(weekVal) : "");
  const canSubmit = name.trim() !== "" && resolvedDate !== "";

  const handleAdd = async () => {
    if (!canSubmit) return;
    const now = new Date().toISOString();
    await onAdd({
      id: crypto.randomUUID(),
      project_id: pjId,
      name: name.trim(),
      date: resolvedDate,
      description: description.trim() || undefined,
      is_deleted: false,
      created_at: now, updated_at: now, updated_by: currentUserId,
    });
    setDateVal(""); setWeekVal(""); setName(""); setDescription("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {/* 日付モード切り替え */}
      <div style={{ display: "flex", gap: "4px" }}>
        {(["date", "week"] as const).map(mode => (
          <button key={mode} onClick={() => setDateMode(mode)} style={{
            padding: "2px 10px", fontSize: "10px",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-primary)",
            cursor: "pointer",
            background: dateMode === mode ? "var(--color-bg-info)" : "transparent",
            color: dateMode === mode ? "var(--color-text-info)" : "var(--color-text-tertiary)",
            fontWeight: dateMode === mode ? "500" : "400",
          }}>
            {mode === "date" ? "日付" : "週"}
          </button>
        ))}
      </div>

      {/* 日付 or 週 入力 */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        {dateMode === "date" ? (
          <input type="date" value={dateVal}
            onChange={e => setDateVal(e.target.value)}
            style={{ ...inputStyle, width: "140px", flexShrink: 0 }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <input type="week" value={weekVal}
              onChange={e => setWeekVal(e.target.value)}
              style={{ ...inputStyle, width: "160px", flexShrink: 0 }}
            />
            {weekVal && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                月曜起点：{weekRangeLabel(weekToDate(weekVal))}
              </span>
            )}
          </div>
        )}
        <input
          value={name} placeholder="マイルストーン名 *"
          maxLength={60}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          style={{ ...inputStyle, flex: 1, minWidth: "120px" }}
        />
      </div>

      {/* 説明（任意） */}
      <textarea
        value={description} placeholder="説明（任意）"
        maxLength={200} rows={2}
        onChange={e => setDescription(e.target.value)}
        style={{ ...inputStyle, resize: "vertical" }}
      />

      <div>
        <button onClick={handleAdd} disabled={!canSubmit} style={primaryBtnStyle}>
          追加
        </button>
      </div>
    </div>
  );
}

// ===== AI使用量セクション =====

const INPUT_COST_PER_TOKEN  = 3 / 1_000_000;   // $3/1Mトークン
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;  // $15/1Mトークン
const JPY_PER_USD = 150;

function calcCostJpy(input: number, output: number): number {
  return (input * INPUT_COST_PER_TOKEN + output * OUTPUT_COST_PER_TOKEN) * JPY_PER_USD;
}

function getWeekOfMonth(dateStr: string): number {
  const d = new Date(dateStr);
  return Math.ceil(d.getDate() / 7);
}

function AIUsageSection() {
  const [logs, setLogs] = useState<AiUsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchAiUsageLogs()
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 月ごとに集計
  const monthlyData = useMemo(() => {
    const map = new Map<string, AiUsageLog[]>();
    for (const log of logs) {
      const month = (log.called_at ?? "").slice(0, 7); // YYYY-MM
      if (!map.has(month)) map.set(month, []);
      map.get(month)!.push(log);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, entries]) => {
        const totalInput  = entries.reduce((s, l) => s + l.input_tokens,  0);
        const totalOutput = entries.reduce((s, l) => s + l.output_tokens, 0);
        // 週ごとに集計
        const weekMap = new Map<number, AiUsageLog[]>();
        for (const log of entries) {
          const w = getWeekOfMonth(log.called_at ?? "");
          if (!weekMap.has(w)) weekMap.set(w, []);
          weekMap.get(w)!.push(log);
        }
        const weeks = Array.from(weekMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([week, wLogs]) => ({
            week,
            count: wLogs.length,
            input:  wLogs.reduce((s, l) => s + l.input_tokens,  0),
            output: wLogs.reduce((s, l) => s + l.output_tokens, 0),
          }));
        return { month, count: entries.length, input: totalInput, output: totalOutput, weeks };
      });
  }, [logs]);

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      next.has(month) ? next.delete(month) : next.add(month);
      return next;
    });
  };

  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 60px 90px 90px 80px",
    gap: "8px",
    alignItems: "center",
    fontSize: "11px",
    padding: "7px 10px",
  };

  const headerStyle: React.CSSProperties = {
    ...rowStyle,
    fontSize: "10px",
    color: "var(--color-text-tertiary)",
    borderBottom: "1px solid var(--color-border-primary)",
    padding: "4px 10px 6px",
  };

  if (loading) return <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", padding: "20px" }}>読み込み中...</div>;

  return (
    <div style={{ maxWidth: "620px" }}>
      <SectionHeader title="AI使用量" />
      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
        料金目安：入力 $3/100万トークン・出力 $15/100万トークン（1ドル=150円換算）
      </div>

      {monthlyData.length === 0 && (
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>まだデータがありません。</div>
      )}

      {monthlyData.map(({ month, count, input, output, weeks }) => {
        const isOpen = expandedMonths.has(month);
        const [y, m] = month.split("-");
        const label = `${y}年${parseInt(m)}月`;
        const cost = calcCostJpy(input, output);
        return (
          <div key={month} style={{ marginBottom: "6px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            {/* 月ヘッダー行 */}
            <button
              onClick={() => toggleMonth(month)}
              style={{ width: "100%", background: "var(--color-bg-secondary)", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
            >
              <div style={{ ...rowStyle, fontWeight: "500", color: "var(--color-text-primary)" }}>
                <span>{isOpen ? "▼" : "▶"} {label}</span>
                <span style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>{count}回</span>
                <span style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>{input.toLocaleString()}</span>
                <span style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>{output.toLocaleString()}</span>
                <span style={{ textAlign: "right", color: "var(--color-text-info)", fontWeight: "600" }}>¥{Math.round(cost)}</span>
              </div>
            </button>

            {/* 週別展開 */}
            {isOpen && (
              <div style={{ background: "var(--color-bg-primary)" }}>
                <div style={headerStyle}>
                  <span>週</span>
                  <span style={{ textAlign: "right" }}>回数</span>
                  <span style={{ textAlign: "right" }}>入力tok</span>
                  <span style={{ textAlign: "right" }}>出力tok</span>
                  <span style={{ textAlign: "right" }}>費用目安</span>
                </div>
                {weeks.map(({ week, count: wc, input: wi, output: wo }) => (
                  <div key={week} style={{ ...rowStyle, color: "var(--color-text-secondary)", borderTop: "1px solid var(--color-border-primary)" }}>
                    <span style={{ paddingLeft: "12px" }}>第{week}週</span>
                    <span style={{ textAlign: "right" }}>{wc}回</span>
                    <span style={{ textAlign: "right" }}>{wi.toLocaleString()}</span>
                    <span style={{ textAlign: "right" }}>{wo.toLocaleString()}</span>
                    <span style={{ textAlign: "right" }}>¥{Math.round(calcCostJpy(wi, wo))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
