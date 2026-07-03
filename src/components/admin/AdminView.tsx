// src/components/admin/AdminView.tsx
//
// 【設計意図】
// 管理画面。OKR/KR・Task Force・PJ・メンバーの4セクションを管理する。
// 全員が編集可（管理者権限なし）。
// 変更はSupabaseに即時反映（AppDataContext経由）。

import { useState, useMemo, useEffect, useCallback } from "react";
import { fetchAiUsageLogs } from "../../lib/supabase/store";
import { supabase } from "../../lib/supabase/client";
import type { AiUsageLog } from "../../lib/supabase/store";
import { useAppStore, selectScopedTasks, selectScopedProjects } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  Group, Member, Objective, KeyResult, TaskForce, ToDo, Project, Milestone, Task,
  Quarter, MemberTag,
} from "../../lib/localData/types";
import { effectiveTfQuarter } from "../../lib/okr/tfQuarter";
import { currentQuarter } from "../../lib/date";
import { getErrorMessage, formatErrorForUser } from "../../lib/errorMessage";
import { KEYS, active } from "../../lib/localData/localStore";
import { HelpButton } from "../guide/HelpButton";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog, alertDialog } from "../../lib/dialog";
import { v4 as uuidv4 } from "uuid";
import { TodoDecomposeModal } from "./TodoDecomposeModal";
import { CustomSelect } from "../common/CustomSelect";
import { MilestoneAddForm } from "../milestone/MilestoneAddForm";
import { MilestoneEditModal } from "../milestone/MilestoneEditModal";

type AdminTab = "okr" | "tf" | "pj" | "members" | "tags" | "ai_usage" | "groups";

interface Props { currentUser: Member; }

// ===== ルートコンポーネント =====

export function AdminView({ currentUser }: Props) {
  // 管理者ガード：グループ内にis_admin=trueのアクティブメンバーが1人以上いる場合、
  // 現在ユーザーがis_admin=trueでないとアクセスを拒否する。
  // 誰もis_adminでない場合はブートストラップモードとして全員アクセス可。
  // 全社スーパー管理者（is_super_admin）は所属部署のis_admin状態によらず常にアクセス可。
  const allMembers = useAppStore(s => s.members);
  const activeAdmins = useMemo(() => active(allMembers).filter(m => m.is_admin === true), [allMembers]);
  const hasAnyAdmin = activeAdmins.length > 0;
  const isCurrentUserAdmin = currentUser.is_admin === true;
  const isCurrentUserSuperAdmin = currentUser.is_super_admin === true;
  const canAccessAdmin = isCurrentUserAdmin || isCurrentUserSuperAdmin;
  if (hasAnyAdmin && !canAccessAdmin) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%",
        flexDirection: "column", gap: "12px",
      }}>
        <div style={{
          fontSize: "14px", color: "var(--color-text-secondary)",
          textAlign: "center", lineHeight: 2,
        }}>
          🔒 管理者のみアクセスできます
        </div>
      </div>
    );
  }
  const krs      = useAppStore(s => s.keyResults);
  const pjs      = useAppStore(selectScopedProjects);
  const krCount  = active(krs).length;
  const pjCount  = active(pjs).length;

  // 初期タブ：未設定が大きい領域を優先（KR 0件 → OKR、PJ 0件 → PJ、それ以外は前回タブ）
  const validTabs: AdminTab[] = ["okr", "tf", "pj", "members", "tags", "ai_usage", "groups"];
  const [tab, setTab] = useState<AdminTab>(() => {
    const saved = localStorage.getItem(KEYS.ADMIN_LAST_TAB) as AdminTab | null;
    if (krCount === 0) return "okr";
    if (pjCount === 0) return "pj";
    return (saved && validTabs.includes(saved)) ? saved : "pj";
  });
  const [fontSizeLevel, setFontSizeLevel] = useState<0 | 1 | 2>(
    () => Math.min(2, Math.max(0, parseInt(localStorage.getItem(KEYS.ADMIN_FONT_SIZE) ?? "1", 10))) as 0 | 1 | 2
  );
  const zoomLevels = [0.85, 1, 1.15] as const;

  const [isDirty, setIsDirty] = useState(false);

  const changeTab = async (t: AdminTab) => {
    if (isDirty && t !== tab) {
      const ok = await confirmDialog(
        "保存されていない変更があります。\nタブを切り替えると変更は失われます。このまま移動しますか？"
      );
      if (!ok) return;
    }
    setIsDirty(false);
    setTab(t);
    localStorage.setItem(KEYS.ADMIN_LAST_TAB, t);
  };
  const changeFontSize = (level: 0 | 1 | 2) => {
    setFontSizeLevel(level);
    localStorage.setItem(KEYS.ADMIN_FONT_SIZE, String(level));
  };

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "pj",       label: "プロジェクト" },
    { key: "tf",       label: "Task Force" },
    { key: "okr",      label: "Objective / KR" },
    { key: "ai_usage", label: "AI使用量" },
    { key: "members",  label: "メンバー" },
    { key: "tags",     label: "メンバータグ" },
    { key: "groups",   label: "グループ" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ヘッダー */}
      <div style={{
        padding: "10px 20px 0",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-primary)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
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
          {/* フォントサイズ切り替え */}
          <div style={{
            display: "flex", border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)", overflow: "hidden",
          }}>
            {([0, 1, 2] as const).map((level) => (
              <button
                key={level}
                onClick={() => changeFontSize(level)}
                title={["小さく", "標準", "大きく"][level]}
                style={{
                  padding: "2px 7px", fontSize: "10px", border: "none", cursor: "pointer",
                  background: fontSizeLevel === level ? "var(--color-bg-info)" : "transparent",
                  color: fontSizeLevel === level ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                  borderRight: level < 2 ? "1px solid var(--color-border-primary)" : "none",
                }}
              >
                {["小", "中", "大"][level]}
              </button>
            ))}
          </div>
        </div>
        {/* タブ */}
        <div style={{ display: "flex", gap: "0" }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { void changeTab(t.key); }}
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
        {/* 初見向け：次の推奨ステップ */}
        {(krCount === 0 || pjCount === 0) && (
          <div style={{
            margin: "6px 0 -1px", padding: "5px 10px",
            background: "var(--color-bg-info)",
            border: "1px solid var(--color-border-info)",
            borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
            fontSize: "10px", color: "var(--color-text-info)", lineHeight: 1.5,
          }}>
            {krCount === 0
              ? "💡 まず「Objective / KR」タブで今期の目標と KR（成果指標）を3〜5本登録しましょう。"
              : "💡 続いて「プロジェクト」タブで KR を実現する手段（PJ）を登録します。"}
          </div>
        )}
      </div>

      {/* コンテンツ */}
      <div style={{
        flex: 1,
        overflow: tab === "tf" ? "hidden" : "auto",
        padding: tab === "tf" ? "18px 20px 0" : "18px 20px",
        zoom: zoomLevels[fontSizeLevel],
        display: "flex", flexDirection: "column", minHeight: 0,
      }}>
        {tab === "okr"      && <OKRSection currentUser={currentUser} onDirtyChange={setIsDirty} />}
        {tab === "tf"       && <TFSection currentUser={currentUser} onDirtyChange={setIsDirty} />}
        {tab === "pj"       && <PJSection currentUser={currentUser} onDirtyChange={setIsDirty} />}
        {tab === "members"  && <MembersSection currentUser={currentUser} onDirtyChange={setIsDirty} />}
        {tab === "tags"     && <TagsSection currentUser={currentUser} onDirtyChange={setIsDirty} />}
        {tab === "ai_usage" && <AIUsageSection />}
        {tab === "groups"   && <GroupsSection currentUser={currentUser} onDirtyChange={setIsDirty} />}
      </div>
    </div>
  );
}

// ===================================================
// セクション①：Objective / KR
// ===================================================

function OKRSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void }) {
  const ctxObj          = useAppStore(s => s.objective);
  const rawKrs          = useAppStore(s => s.keyResults);
  const saveObjective   = useAppStore(s => s.saveObjective);
  const saveKeyResult   = useAppStore(s => s.saveKeyResult);
  const deleteKeyResult = useAppStore(s => s.deleteKeyResult);
  const krs = useMemo(() => active(rawKrs), [rawKrs]);

  const [editingKrId, setEditingKrId] = useState<string | null>(null);
  const [newKrTitle, setNewKrTitle] = useState("");
  const [objTitle, setObjTitle] = useState(ctxObj?.title ?? "");
  const [objPurpose, setObjPurpose] = useState(ctxObj?.purpose ?? "");
  const [objBackground, setObjBackground] = useState(ctxObj?.background ?? "");
  const [saved, setSaved] = useState(false);
  const [objEdited, setObjEdited] = useState(false);

  // OKRフォームの変更を親に通知
  useEffect(() => {
    onDirtyChange(objEdited || editingKrId !== null || newKrTitle.trim() !== "");
  }, [objEdited, editingKrId, newKrTitle, onDirtyChange]);

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
      setObjEdited(false);
    } catch (e) {
      const msg = getErrorMessage(e);
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
      const msg = getErrorMessage(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const updateKr = async (id: string, title: string) => {
    const existing = krs.find(k => k.id === id);
    if (!existing) return;
    try {
      await saveKeyResult({ ...existing, title, updated_by: currentUser.id });
    } catch (e) {
      const msg = getErrorMessage(e);
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
          onChange={e => { setObjTitle(e.target.value); setObjEdited(true); }}
          minRows={3}
          maxLength={500}
          style={{ ...inputStyle, width: "100%", marginBottom: "10px" }}
          placeholder="Objectiveのタイトルを入力"
        />
        <FieldLabel>Purpose（何を達成するか）</FieldLabel>
        <AutoTextarea
          value={objPurpose}
          onChange={e => { setObjPurpose(e.target.value); setObjEdited(true); }}
          minRows={2}
          maxLength={1000}
          style={{ ...inputStyle, width: "100%", marginBottom: "10px" }}
          placeholder="このObjectiveで達成したいことを入力（例：〇〇により△△の状態にする）"
        />
        <FieldLabel>設計の意図や背景</FieldLabel>
        <AutoTextarea
          value={objBackground}
          onChange={e => { setObjBackground(e.target.value); setObjEdited(true); }}
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
    </div>
  );
}

// ===================================================
// セクション②：Task Force（クォーター別設定）
// ===================================================
// クォーターを選択し、通期KRごとにTFを割り当てる。
// 割り当て済みTFにはToDoパネルが展開でき、大タスクを直接追加できる。

function TFSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void }) {
  const ctxObj                      = useAppStore(s => s.objective);
  const rawTfs                      = useAppStore(s => s.taskForces);
  const rawKrs                      = useAppStore(s => s.keyResults);
  const rawMembers                  = useAppStore(s => s.members);
  const rawTodos                    = useAppStore(s => s.todos);
  const rawTasks                    = useAppStore(selectScopedTasks);
  const saveTaskForce               = useAppStore(s => s.saveTaskForce);
  const deleteTaskForce             = useAppStore(s => s.deleteTaskForce);
  const saveToDo                    = useAppStore(s => s.saveToDo);
  const deleteToDo                  = useAppStore(s => s.deleteToDo);
  const saveTask                    = useAppStore(s => s.saveTask);

  const isMobile = useIsMobile();
  const tfs     = useMemo(() => active(rawTfs), [rawTfs]);
  const krs     = useMemo(() => active(rawKrs), [rawKrs]);
  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const todos   = useMemo(() => active(rawTodos), [rawTodos]);
  const allTasks = useMemo(() => active(rawTasks), [rawTasks]);

  // 現在の日付から今のQを求める（1Q=1-3月 / 2Q=4-6月 / 3Q=7-9月 / 4Q=10-12月）
  // 判定ロジックは lib/date.ts の currentQuarter() に一元化済み。
  const currentQ = useMemo<Quarter>(() => currentQuarter(), []);

  // クォーター選択（初期値を現在のQに設定）
  const [selectedQuarter, setSelectedQuarter] = useState<Quarter>(currentQ);

  // TF編集フォーム（既存TF）
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ kr_id: "", tf_number: "", name: "", description: "", background: "", leader_member_id: "" });

  // KRごとのTF新規作成インラインフォーム
  const [newTfFormKrId, setNewTfFormKrId] = useState<string | null>(null);
  const [newTfForm, setNewTfForm] = useState({ tf_number: "", name: "", description: "", background: "", leader_member_id: "" });

  // 未保存変更を親に通知
  useEffect(() => {
    onDirtyChange(editId !== null || newTfFormKrId !== null);
  }, [editId, newTfFormKrId, onDirtyChange]);

  const handleUnlinkTf = async (_krId: string, tfId: string) => {
    if (!await confirmDialog("このTFのクォーター割り当てを解除しますか？（TF自体は削除されません。未割当のTFは現在のクォーターに表示されます）")) return;
    try {
      // 新モデル：QKTFではなく TaskForce.quarter を未設定に戻す（未割当＝effectiveTfQuarterで今期扱い）
      const existing = tfs.find(t => t.id === tfId);
      if (!existing) return;
      await saveTaskForce({ ...existing, quarter: undefined, updated_by: currentUser.id });
    } catch (e) {
      const msg = getErrorMessage(e);
      await alertDialog(`解除に失敗しました。\n${msg}`);
    }
  };

  const handleMoveTf = async (_krId: string, tfId: string, targetQuarter: Quarter) => {
    if (!await confirmDialog(`このTFを ${targetQuarter} に移動しますか？\n現在の ${selectedQuarter} からは外れます。`)) return;
    try {
      // 新モデル：QKTFではなく TaskForce.quarter 列を更新する（単一の真実）
      const existing = tfs.find(t => t.id === tfId);
      if (!existing) return;
      await saveTaskForce({ ...existing, quarter: targetQuarter, updated_by: currentUser.id });
    } catch (e) {
      const msg = getErrorMessage(e);
      await alertDialog(`移動に失敗しました。\n${msg}`);
    }
  };

  // 新規TF作成してリンク
  const openNewTfForm = (krId: string) => {
    setNewTfFormKrId(krId);
    setNewTfForm({ tf_number: "", name: "", description: "", background: "", leader_member_id: "" });
  };

  const handleCreateAndLinkTf = async (krId: string) => {
    if (!newTfForm.name.trim()) return;
    const now = new Date().toISOString();
    // 新モデル：選択中のクォーターを TaskForce.quarter にセット（QKTFは使わない）
    const newTf: TaskForce = {
      id: uuidv4(),
      kr_id: krId,
      tf_number: newTfForm.tf_number.trim(),
      quarter: selectedQuarter,
      name: newTfForm.name.trim(),
      description: newTfForm.description.trim() || undefined,
      background: newTfForm.background.trim() || undefined,
      leader_member_id: newTfForm.leader_member_id,
      is_deleted: false,
      created_at: now, updated_at: now, updated_by: currentUser.id,
    };
    try {
      await saveTaskForce(newTf);
      setNewTfFormKrId(null);
    } catch (e) {
      const msg = getErrorMessage(e);
      await alertDialog(`TFの作成に失敗しました。\n${msg}`);
    }
  };

  // 既存TFの編集・削除
  const openEdit = (tf: TaskForce) => {
    setEditId(tf.id);
    setForm({ kr_id: tf.kr_id, tf_number: tf.tf_number, name: tf.name, description: tf.description ?? "", background: tf.background ?? "", leader_member_id: tf.leader_member_id });
  };

  const saveTfEdit = async () => {
    if (!form.name.trim()) return;
    try {
      const existing = tfs.find(t => t.id === editId);
      if (existing) await saveTaskForce({ ...existing, ...form, description: form.description || undefined, background: form.background || undefined, updated_by: currentUser.id });
      setEditId(null);
    } catch (e) {
      const msg = getErrorMessage(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const deleteTF = async (id: string) => {
    if (!await confirmDialog("このTask Forceを完全に削除しますか？")) return;
    await deleteTaskForce(id, currentUser.id);
    setEditId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* クォーター選択タブ */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
        {(["1Q", "2Q", "3Q", "4Q"] as Quarter[]).map(q => (
          <button
            key={q}
            onClick={() => { setSelectedQuarter(q); setEditId(null); setNewTfFormKrId(null); }}
            style={{
              padding: "6px 18px", fontSize: "13px", fontWeight: selectedQuarter === q ? "600" : "400",
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

      {/* Objective未設定時の警告 */}
      {!ctxObj?.id && (
        <div style={{ fontSize: "11px", color: "var(--color-text-warning)", padding: "10px 12px", background: "var(--color-bg-warning)", border: "1px solid var(--color-border-warning)", borderRadius: "var(--radius-md)", marginBottom: "16px" }}>
          先に「Objective / KR」タブで通期Objectiveを保存してください
        </div>
      )}

      {/* KR なし */}
      {krs.length === 0 && ctxObj?.id && (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "6px 0" }}>
          KRがまだありません。先に「Objective / KR」タブでKRを追加してください。
        </div>
      )}

      {/* KR × TF × ToDo — 2カラムグリッド（列ごとに独立スクロール） */}
      <div style={{
        flex: 1, minHeight: 0,
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        gridTemplateRows: "1fr",
        gap: "16px 24px",
        overflow: "hidden",
        paddingBottom: "18px",
      }}>
        {krs.map((kr, i) => {
          const sortByTfNumber = (a: typeof tfs[0], b: typeof tfs[0]) => {
            const na = parseInt(a.tf_number, 10);
            const nb = parseInt(b.tf_number, 10);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            if (!isNaN(na)) return -1;
            if (!isNaN(nb)) return 1;
            return a.tf_number.localeCompare(b.tf_number);
          };
          // 選択クォーターに属するTFのみ（tf.quarter基準・未設定legacyは今期扱い）。QKTF経由はやめる。
          const linkedTfs = tfs
            .filter(t => t.kr_id === kr.id && effectiveTfQuarter(t) === selectedQuarter)
            .sort(sortByTfNumber);
          return (
            <div key={kr.id} style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
              {/* KRヘッダー（固定） */}
              <div style={{
                flexShrink: 0,
                fontSize: "11px", fontWeight: "500", color: "var(--color-text-info)",
                marginBottom: "8px", display: "flex", alignItems: "center", gap: "5px",
                padding: "6px 10px", background: "var(--color-bg-info-soft, var(--color-bg-secondary))",
                borderRadius: "var(--radius-md)", border: "1px solid var(--color-border-info)",
              }}>
                <span style={{
                  background: "var(--color-bg-info)", padding: "1px 7px", borderRadius: "3px",
                  border: "1px solid var(--color-border-info)", flexShrink: 0,
                }}>KR{i + 1}</span>
                <span style={{ color: "var(--color-text-secondary)", fontWeight: "400", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kr.title}</span>
              </div>

              {/* TFリスト（スクロール） */}
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {linkedTfs.length === 0 && (
                  <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", paddingLeft: "4px", marginBottom: "6px" }}>
                    TFがまだ割り当てられていません
                  </div>
                )}

                {/* 割り当て済みTF（ToDoパネル付き） */}
                {linkedTfs.map(tf => (
                  <TFRow key={tf.id} tf={tf} members={members}
                    todos={todos.filter(t => t.tf_id === tf.id)}
                    tasks={allTasks} saveTask={saveTask}
                    currentUser={currentUser}
                    onEdit={() => openEdit(tf)}
                    onDelete={() => { void handleUnlinkTf(kr.id, tf.id); }}
                    onSaveToDo={saveToDo} onDeleteToDo={deleteToDo}
                    isEditing={editId === tf.id}
                    editForm={form}
                    setEditForm={setForm}
                    onSaveEdit={() => { void saveTfEdit(); }}
                    onCancelEdit={() => setEditId(null)}
                    onDeleteTF={() => { void deleteTF(editId!); }}
                    currentQuarter={selectedQuarter}
                    onMoveTo={(targetQ) => { void handleMoveTf(kr.id, tf.id, targetQ); }}
                  />
                ))}
              </div>

              {/* TF追加コントロール（固定下部） */}
              <div style={{ flexShrink: 0 }}>
                {ctxObj?.id && newTfFormKrId !== kr.id && (
                  <div style={{ marginTop: "6px" }}>
                    <button
                      onClick={() => openNewTfForm(kr.id)}
                      style={{ fontSize: "10px", padding: "3px 10px", border: "1px dashed var(--color-border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", background: "transparent", color: "var(--color-text-secondary)" }}
                    >＋ 新規TFを作成</button>
                  </div>
                )}

                {/* 新規TF作成インラインフォーム */}
                {newTfFormKrId === kr.id && (
                  <div style={{ marginTop: "8px", padding: "12px 14px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "10px" }}>新しいTask Forceを作成してリンク</div>
                    <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                      <div style={{ flex: "0 0 76px" }}>
                        <FieldLabel>番号</FieldLabel>
                        <CustomSelect value={newTfForm.tf_number} onChange={value => setNewTfForm(f => ({...f, tf_number: value}))}
                          options={[
                            { value: "", label: "－" },
                            ...[1,2,3,4,5,6,7,8,9].map(n => ({ value: String(n), label: `TF ${n}` })),
                          ]} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <FieldLabel>TF名 *</FieldLabel>
                        <input value={newTfForm.name} onChange={e => setNewTfForm(f => ({...f, name: e.target.value}))}
                          placeholder="例：市場調査TF" maxLength={100} style={{ ...inputStyle, fontSize: "11px" }} />
                      </div>
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <FieldLabel>リーダー</FieldLabel>
                      <CustomSelect value={newTfForm.leader_member_id} onChange={value => setNewTfForm(f => ({...f, leader_member_id: value}))}
                        options={[
                          { value: "", label: "（なし）" },
                          ...members.map(m => ({ value: m.id, label: m.display_name })),
                        ]}
                        searchable searchPlaceholder="メンバーで検索..." />
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <FieldLabel>詳細・目的（任意）</FieldLabel>
                      <textarea value={newTfForm.description} onChange={e => setNewTfForm(f => ({...f, description: e.target.value}))}
                        placeholder="このTask Forceの目的・活動内容（任意）" maxLength={500} rows={2}
                        style={{ ...inputStyle, fontSize: "11px", resize: "vertical", lineHeight: 1.5 }} />
                    </div>
                    <div style={{ marginBottom: "10px" }}>
                      <FieldLabel>設定した意図・背景（任意）</FieldLabel>
                      <textarea value={newTfForm.background} onChange={e => setNewTfForm(f => ({...f, background: e.target.value}))}
                        placeholder="なぜこのTFを設定するか、背景・経緯（任意）" maxLength={1000} rows={2}
                        style={{ ...inputStyle, fontSize: "11px", resize: "vertical", lineHeight: 1.5 }} />
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

function TFRow({ tf, members, todos, tasks, saveTask, currentUser, onEdit, onDelete, onSaveToDo, onDeleteToDo,
  isEditing, editForm, setEditForm, onSaveEdit, onCancelEdit, onDeleteTF, currentQuarter, onMoveTo }: {
  tf: TaskForce; members: Member[];
  todos: ToDo[]; tasks: import("../../lib/localData/types").Task[];
  saveTask: (task: import("../../lib/localData/types").Task) => Promise<void>;
  currentUser: Member;
  onEdit: () => void; onDelete: () => void;
  onSaveToDo: (todo: ToDo) => Promise<void>;
  onDeleteToDo: (id: string, deletedBy: string) => Promise<void>;
  isEditing: boolean;
  editForm: { kr_id: string; tf_number: string; name: string; description: string; background: string; leader_member_id: string };
  setEditForm: React.Dispatch<React.SetStateAction<{ kr_id: string; tf_number: string; name: string; description: string; background: string; leader_member_id: string }>>;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDeleteTF: () => void;
  currentQuarter: Quarter;
  onMoveTo: (targetQuarter: Quarter) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const isMobile = useIsMobile();
  const leader = members.find(m => m.id === tf.leader_member_id);

  // TF番号バッジ表示（数字のみなら "TF n" 形式、旧フォーマットはそのまま）
  const tfNumLabel = tf.tf_number
    ? (/^\d+$/.test(tf.tf_number) ? `TF ${tf.tf_number}` : tf.tf_number)
    : null;

  // アクションボタン群（デスクトップ・モバイル共通）
  // アクションボタン 2×2グリッド（上段: ToDo / Q移動、下段: 編集 / 解除）
  const actionButtons = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", flexShrink: 0 }}>
      {/* 上段左: ToDo */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          fontSize: "10px", padding: "3px 6px", whiteSpace: "nowrap",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)", cursor: "pointer",
          background: expanded ? "var(--color-bg-info)" : "var(--color-bg-secondary)",
          color: expanded ? "var(--color-text-info)" : "var(--color-text-tertiary)",
          textAlign: "center",
        }}
      >
        ToDo{todos.length > 0 ? ` (${todos.length})` : ""} {expanded ? "▴" : "▾"}
      </button>

      {/* 上段右: Q移動 */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowMoveMenu(v => !v)}
          style={{
            width: "100%", fontSize: "10px", padding: "3px 6px",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)", cursor: "pointer",
            background: showMoveMenu ? "var(--color-bg-secondary)" : "transparent",
            color: "var(--color-text-tertiary)", textAlign: "center",
          }}
        >Q移動</button>
        {showMoveMenu && (
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            overflow: "hidden",
            minWidth: "90px",
          }}>
            {(["1Q","2Q","3Q","4Q"] as Quarter[])
              .filter(q => q !== currentQuarter)
              .map(q => (
                <button
                  key={q}
                  onClick={() => { setShowMoveMenu(false); onMoveTo(q); }}
                  style={{
                    display: "block", width: "100%",
                    padding: "7px 12px", fontSize: "11px", textAlign: "left",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--color-text-primary)",
                    borderBottom: q !== "4Q" ? "1px solid var(--color-border-primary)" : "none",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-secondary)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {q} へ
                </button>
              ))
            }
          </div>
        )}
      </div>

      {/* 下段左: 編集 */}
      <button
        onClick={onEdit}
        style={{
          fontSize: "10px", padding: "3px 6px",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)", cursor: "pointer",
          background: "transparent", color: "var(--color-text-secondary)",
          textAlign: "center",
        }}
      >編集</button>

      {/* 下段右: 解除 */}
      <button
        onClick={onDelete}
        style={{
          fontSize: "10px", padding: "3px 6px",
          border: "1px solid var(--color-border-danger)",
          borderRadius: "var(--radius-md)", cursor: "pointer",
          background: "transparent", color: "var(--color-text-danger)",
          textAlign: "center",
        }}
      >解除</button>
    </div>
  );

  return (
    <div style={{
      marginBottom: "6px",
      border: isEditing ? "2px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      transition: "border-color 0.15s",
    }}>
      {/* カード本体 */}
      <div style={{
        padding: "8px 10px",
        background: isEditing ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
      }}>
        {/* 情報行（常時表示） */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {tfNumLabel && (
            <span style={{
              fontSize: "10px", padding: "2px 8px", borderRadius: "var(--radius-full)",
              background: "var(--color-brand-light)", color: "var(--color-text-purple)",
              border: "1px solid var(--color-brand-border)", flexShrink: 0, fontWeight: "600",
            }}>{tfNumLabel}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)", lineHeight: 1.4 }}>{tf.name}</div>
            {tf.description && (
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px", lineHeight: 1.4 }}>
                {tf.description}
              </div>
            )}
            {tf.background && (
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px", lineHeight: 1.4, fontStyle: "italic" }}>
                📌 {tf.background}
              </div>
            )}
          </div>
          {leader && <Avatar member={leader} size={20} />}
          {/* デスクトップ：アクションボタンをインライン表示 */}
          {!isMobile && !isEditing && actionButtons}
          {isEditing && (
            <span style={{ fontSize: "10px", color: "var(--color-text-purple)", fontWeight: "600", flexShrink: 0, background: "var(--color-brand-light)", padding: "2px 8px", borderRadius: "var(--radius-full)", border: "1px solid var(--color-brand-border)" }}>編集中</span>
          )}
        </div>

        {/* モバイル：アクションボタンを2段目に配置 */}
        {isMobile && !isEditing && (
          <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--color-border-primary)" }}>
            {actionButtons}
          </div>
        )}
      </div>

      {/* インライン編集フォーム */}
      {isEditing && (
        <div style={{ padding: "12px 14px", borderTop: "2px solid var(--color-brand)", background: "var(--color-bg-secondary)" }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "80px 1fr", gap: "8px", marginBottom: "8px" }}>
            <div>
              <FieldLabel>番号</FieldLabel>
              <CustomSelect value={editForm.tf_number} onChange={value => setEditForm(f => ({...f, tf_number: value}))}
                options={[
                  { value: "", label: "－" },
                  ...[1,2,3,4,5,6,7,8,9].map(n => ({ value: String(n), label: `TF ${n}` })),
                ]} />
            </div>
            <div>
              <FieldLabel>TF名 *</FieldLabel>
              <input value={editForm.name} onChange={e => setEditForm(f => ({...f, name: e.target.value}))}
                placeholder="例：市場調査TF" maxLength={100} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: "8px" }}>
            <FieldLabel>リーダー</FieldLabel>
            <CustomSelect value={editForm.leader_member_id} onChange={value => setEditForm(f => ({...f, leader_member_id: value}))}
              options={[
                { value: "", label: "（なし）" },
                ...members.map(m => ({ value: m.id, label: m.display_name })),
              ]}
              searchable searchPlaceholder="メンバーで検索..." />
          </div>
          <div style={{ marginBottom: "8px" }}>
            <FieldLabel>詳細・目的（任意）</FieldLabel>
            <textarea value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))}
              placeholder="このTask Forceの目的・活動内容（任意）" maxLength={500} rows={2}
              style={{ ...inputStyle, lineHeight: 1.5 }} />
          </div>
          <div style={{ marginBottom: "10px" }}>
            <FieldLabel>設定した意図・背景（任意）</FieldLabel>
            <textarea value={editForm.background} onChange={e => setEditForm(f => ({...f, background: e.target.value}))}
              placeholder="なぜこのTFを設定したか、背景・経緯・意図（任意）" maxLength={1000} rows={2}
              style={{ ...inputStyle, lineHeight: 1.5 }} />
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={onSaveEdit} style={primaryBtnStyle}>保存</button>
            <button onClick={onCancelEdit} style={ghostBtnStyle}>キャンセル</button>
            <button
              onClick={onDeleteTF}
              style={{ ...ghostBtnStyle, marginLeft: "auto", color: "var(--color-text-danger)", borderColor: "var(--color-border-danger)" }}
            >TFを削除</button>
          </div>
        </div>
      )}

      {/* ToDoパネル（展開時・編集中は非表示） */}
      {expanded && !isEditing && (
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
  const [form, setForm] = useState({ name: "", title: "", due_date: "", memo: "" });
  const [addingTaskForTodoId, setAddingTaskForTodoId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ name: "", assignee_member_id: "", due_date: "" });
  const [expandedTodoId, setExpandedTodoId] = useState<string | null>(null);
  const [decomposeTodoId, setDecomposeTodoId] = useState<string | null>(null);

  const openAdd = () => {
    setEditId("new");
    setForm({ name: "", title: "", due_date: "", memo: "" });
  };

  const openEdit = (todo: ToDo) => {
    setEditId(todo.id);
    setForm({ name: todo.name ?? "", title: todo.title, due_date: todo.due_date ?? "", memo: todo.memo });
  };

  const save = async () => {
    if (!form.title.trim() && !form.name.trim()) return;
    const now = new Date().toISOString();
    const isNew = editId === "new";
    const existing = !isNew ? todos.find(t => t.id === editId) : undefined;
    const todo: ToDo = {
      id: isNew ? uuidv4() : editId!,
      tf_id: tfId,
      name: form.name.trim() || undefined,
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
    setTaskForm({ name: "", assignee_member_id: "", due_date: "" });
  };

  const saveNewTask = async () => {
    if (!taskForm.name.trim() || !addingTaskForTodoId) return;
    const now = new Date().toISOString();
    const newTask: import("../../lib/localData/types").Task = {
      id: uuidv4(),
      name: taskForm.name.trim(),
      project_id: null,
      todo_ids: addingTaskForTodoId ? [addingTaskForTodoId] : [],
      assignee_member_ids: taskForm.assignee_member_id ? [taskForm.assignee_member_id] : [],
      assignee_member_id: taskForm.assignee_member_id,
      status: "todo",
      priority: null,
      start_date: null,
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
                  {todo.name && (
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "2px" }}>
                      {todo.name}
                    </div>
                  )}
                  {todo.title && (
                    <div style={{ fontSize: "12px", color: todo.name ? "var(--color-text-secondary)" : "var(--color-text-primary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {todo.title}
                    </div>
                  )}
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
                    const todoTasks = tasks.filter(t => (t.todo_ids ?? []).includes(todo.id));
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
                  <IconBtn onClick={() => setDecomposeTodoId(todo.id)} title="AIでタスクを自動分解">🤖</IconBtn>
                  <IconBtn onClick={() => openEdit(todo)}>✏</IconBtn>
                  <IconBtn danger onClick={() => deleteTodo(todo.id)}>✕</IconBtn>
                </div>
              </div>

              {/* タスク一覧（展開時） */}
              {expandedTodoId === todo.id && (() => {
                const todoTasks = tasks.filter(t => (t.todo_ids ?? []).includes(todo.id));
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
                        <CustomSelect value={taskForm.assignee_member_id} onChange={value => setTaskForm(f => ({ ...f, assignee_member_id: value }))}
                          options={[
                            { value: "", label: "（なし）" },
                            ...members.map(m => ({ value: m.id, label: m.short_name })),
                          ]}
                          searchable searchPlaceholder="メンバーで検索..."
                          style={{ flex: "0 0 auto", minWidth: "120px" }} />
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

      {/* AIタスク自動分解モーダル */}
      {decomposeTodoId && (() => {
        const todo = todos.find(t => t.id === decomposeTodoId);
        if (!todo) return null;
        return (
          <TodoDecomposeModal
            todo={todo}
            tfId={tfId}
            currentUser={currentUser}
            saveTask={saveTask}
            onClose={() => setDecomposeTodoId(null)}
          />
        );
      })()}
    </div>
  );
}

// ===== ToDoフォーム =====

function ToDoForm({
  form, setForm, onSave, onCancel,
}: {
  form: { name: string; title: string; due_date: string; memo: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; title: string; due_date: string; memo: string }>>;
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
      <FieldLabel>タイトル（任意）</FieldLabel>
      <input
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="例：評価指標の策定"
        maxLength={100}
        style={{ ...inputStyle, width: "100%", marginBottom: "8px" }}
      />
      <FieldLabel>ToDo内容</FieldLabel>
      <AutoTextarea
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        placeholder="例：TF2の定量目標達成の基準となる評価指標を策定し、チームで合意する"
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

function PJSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void }) {
  const rawProjects             = useAppStore(selectScopedProjects);
  const rawMembers              = useAppStore(s => s.members);
  const saveProject             = useAppStore(s => s.saveProject);
  const deleteProject           = useAppStore(s => s.deleteProject);
  const rawMilestones           = useAppStore(s => s.milestones);
  const saveMilestone           = useAppStore(s => s.saveMilestone);
  const deleteMilestone         = useAppStore(s => s.deleteMilestone);
  const rawTaskForces           = useAppStore(s => s.taskForces);
  const rawKeyResults           = useAppStore(s => s.keyResults);
  const rawProjectTaskForces    = useAppStore(s => s.projectTaskForces);
  const addProjectTaskForce     = useAppStore(s => s.addProjectTaskForce);
  const removeProjectTaskForce  = useAppStore(s => s.removeProjectTaskForce);
  const isMobile = useIsMobile();
  const projects   = useMemo(() => active(rawProjects), [rawProjects]);
  const members    = useMemo(() => active(rawMembers), [rawMembers]);
  const milestones = useMemo(() => (rawMilestones ?? []).filter((ms: Milestone) => !ms.is_deleted), [rawMilestones]);
  const taskForces = useMemo(() => active(rawTaskForces), [rawTaskForces]);
  const keyResults = useMemo(() => active(rawKeyResults), [rawKeyResults]);

  // マイルストーン管理：開閉のみ（フォーム状態は子コンポーネントが管理）
  const [msOpenPjId, setMsOpenPjId] = useState<string | null>(null);
  const [editingMs, setEditingMs] = useState<Milestone | null>(null);

  const removeMilestone = async (id: string) => {
    if (!await confirmDialog("このマイルストーンを削除しますか？")) return;
    await deleteMilestone(id, currentUser.id);
  };

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", purpose: "", contribution_memo: "",
    owner_member_ids: [] as string[],
    member_ids: [] as string[],
    status: "active" as Project["status"],
    color_tag: "#7F77DD", start_date: "", end_date: "",
    tf_ids: [] as string[],
  });

  // 未保存変更を親に通知
  useEffect(() => {
    onDirtyChange(editId !== null);
  }, [editId, onDirtyChange]);

  const openAdd = () => {
    setEditId("new");
    setForm({
      name: "", purpose: "", contribution_memo: "",
      owner_member_ids: members[0] ? [members[0].id] : [],
      member_ids: [],
      status: "active", color_tag: "#7F77DD",
      start_date: new Date().toISOString().split("T")[0],
      end_date: `${new Date().getFullYear()}-12-31`,
      tf_ids: [],
    });
  };

  const openEdit = (pj: Project) => {
    setEditId(pj.id);
    setForm({
      name: pj.name, purpose: pj.purpose,
      contribution_memo: pj.contribution_memo,
      owner_member_ids: pj.owner_member_ids?.length ? pj.owner_member_ids : (pj.owner_member_id ? [pj.owner_member_id] : []),
      member_ids: pj.member_ids ?? [],
      status: pj.status,
      color_tag: pj.color_tag, start_date: pj.start_date, end_date: pj.end_date,
      tf_ids: rawProjectTaskForces.filter(p => p.project_id === pj.id).map(p => p.tf_id),
    });
  };

  const save = async () => {
    if (!form.name.trim() || !form.purpose.trim()) return;
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      await alertDialog("開始日は終了日より前に設定してください。");
      return;
    }
    const owner_member_id = form.owner_member_ids[0] ?? "";
    if (!owner_member_id) {
      await alertDialog("担当者を1名以上選択してください。");
      return;
    }
    const now = new Date().toISOString();
    try {
      // form の tf_ids は project_task_forces への差分適用用。Project entity 自身には含めない
      const { tf_ids, ...projectFields } = form;
      const projectId = editId === "new" ? uuidv4() : editId!;
      if (editId === "new") {
        await saveProject({ id: projectId, ...projectFields, owner_member_id, is_deleted: false, created_at: now, updated_at: now, updated_by: currentUser.id });
      } else {
        const existing = projects.find(p => p.id === editId);
        if (existing) await saveProject({ ...existing, ...projectFields, owner_member_id, updated_by: currentUser.id });
      }
      // TF 紐付けの差分適用
      const before = new Set(rawProjectTaskForces.filter(p => p.project_id === projectId).map(p => p.tf_id));
      const after  = new Set(tf_ids);
      const toAdd    = [...after].filter(id => !before.has(id));
      const toRemove = [...before].filter(id => !after.has(id));
      await Promise.all([
        ...toAdd.map(tfId => addProjectTaskForce({ project_id: projectId, tf_id: tfId })),
        ...toRemove.map(tfId => removeProjectTaskForce(projectId, tfId)),
      ]);
      setEditId(null);
    } catch (e) {
      const msg = getErrorMessage(e);
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
        const linkedTfCount = rawProjectTaskForces.filter(p => p.project_id === pj.id).length;
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
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px", flexWrap: "wrap" }}>
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
                {linkedTfCount > 0 && (
                  <span title={`紐づくTF: ${linkedTfCount}件`} style={{
                    fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                    background: "var(--color-bg-info)", color: "var(--color-text-info)",
                  }}>
                    TF×{linkedTfCount}
                  </span>
                )}
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
              <div style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "4px" }}>
                ◆ マイルストーン
              </div>
              {/* 説明（1行に圧縮。詳細はガイドへ） */}
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", lineHeight: 1.5, marginBottom: "8px" }}>
                PJの節目（例：β版リリース）の日付マーカー。ガントに <span style={{ color: "#f59e0b" }}>◆</span> で表示されます。
              </div>
              {/* 既存一覧 */}
              {milestones.filter(ms => ms.project_id === pj.id).length === 0 ? (
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
                  まだ登録されていません。下のフォームから節目を追加できます（例：「6/30 β版リリース」）。
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                  {milestones.filter(ms => ms.project_id === pj.id).sort((a, b) => a.date.localeCompare(b.date)).map(ms => (
                    <div key={ms.id}
                      onClick={() => setEditingMs(ms)}
                      title="クリックして編集（メモ・詳細）"
                      style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        padding: "4px 8px",
                        background: "var(--color-bg-primary)",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                      }}>
                      <span style={{ fontSize: "11px", color: "#f59e0b", flexShrink: 0 }}>◆</span>
                      <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", flexShrink: 0 }}>{ms.date}</span>
                      <span style={{ fontSize: "11px", color: "var(--color-text-primary)", flex: 1 }}>{ms.name}{ms.description ? " 📝" : ""}</span>
                      <IconBtn danger onClick={(e) => { e?.stopPropagation?.(); removeMilestone(ms.id); }}>✕</IconBtn>
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

      {/* マイルストーン編集モーダル（一覧の行クリックで開く） */}
      {editingMs && (
        <MilestoneEditModal
          milestone={editingMs}
          currentUser={currentUser}
          project={projects.find(p => p.id === editingMs.project_id) ?? null}
          onClose={() => setEditingMs(null)}
        />
      )}

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
                <CustomSelect
                  value=""
                  onChange={id => {
                    if (id && !form.owner_member_ids.includes(id))
                      setForm(f => ({ ...f, owner_member_ids: [...f.owner_member_ids, id] }));
                  }}
                  options={[
                    { value: "", label: "＋ オーナーを追加" },
                    ...members.filter(m => !form.owner_member_ids.includes(m.id)).map(m => ({ value: m.id, label: m.display_name })),
                  ]}
                  searchable searchPlaceholder="メンバーで検索..."
                />
              </div>
              <div>
                <FieldLabel>ステータス</FieldLabel>
                <CustomSelect value={form.status} onChange={value => setForm(f => ({...f, status: value as Project["status"]}))}
                  options={[
                    { value: "active", label: "進行中" },
                    { value: "completed", label: "完了" },
                    { value: "archived", label: "アーカイブ" },
                  ]} />
              </div>
              <div>
                <FieldLabel>カラー</FieldLabel>
                <input type="color" value={form.color_tag}
                  onChange={e => setForm(f => ({...f, color_tag: e.target.value}))}
                  style={{ ...inputStyle, padding: "2px", height: "32px", cursor: "pointer" }} />
              </div>
            </div>

            {/* メンバー（オーナーとは別の関与者） */}
            <div>
              <FieldLabel>メンバー（オーナー以外の関与者・任意）</FieldLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
                {form.member_ids.map(id => {
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
                      <button onClick={() => setForm(f => ({ ...f, member_ids: f.member_ids.filter(i => i !== id) }))}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "0", lineHeight: 1, color: "var(--color-text-tertiary)" }}>×</button>
                    </span>
                  );
                })}
              </div>
              <CustomSelect
                value=""
                onChange={id => {
                  if (id && !form.member_ids.includes(id))
                    setForm(f => ({ ...f, member_ids: [...f.member_ids, id] }));
                }}
                options={[
                  { value: "", label: "＋ メンバーを追加" },
                  ...members.filter(m => !form.member_ids.includes(m.id) && !form.owner_member_ids.includes(m.id)).map(m => ({ value: m.id, label: m.display_name })),
                ]}
                searchable searchPlaceholder="メンバーで検索..."
              />
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

            {/* 紐づける TF（KR グループ別チェックボックス） */}
            <div>
              <FieldLabel>紐づける TF（任意・KR との連携）</FieldLabel>
              {keyResults.length === 0 ? (
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "4px 0" }}>
                  KR がまだ登録されていません。「Objective / KR」タブで KR を作ると、配下の TF をここで紐づけられます。
                </div>
              ) : (
                <div style={{
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  padding: "8px 10px",
                  background: "var(--color-bg-primary)",
                  maxHeight: "240px", overflowY: "auto",
                  display: "flex", flexDirection: "column", gap: "8px",
                }}>
                  {keyResults.map((kr, krIdx) => {
                    const krTfs = taskForces
                      .filter(tf => tf.kr_id === kr.id)
                      .slice()
                      .sort((a, b) => (a.tf_number ?? "").localeCompare(b.tf_number ?? ""));
                    if (krTfs.length === 0) return null;
                    return (
                      <div key={kr.id}>
                        <div style={{
                          fontSize: "10px", color: "var(--color-text-tertiary)",
                          fontWeight: 600, marginBottom: "3px",
                        }}>
                          KR{krIdx + 1}：{kr.title}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px", paddingLeft: "8px" }}>
                          {krTfs.map(tf => {
                            const checked = form.tf_ids.includes(tf.id);
                            return (
                              <label key={tf.id} style={{
                                display: "flex", alignItems: "center", gap: "6px",
                                fontSize: "11px", color: "var(--color-text-primary)",
                                cursor: "pointer", padding: "2px 0",
                              }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => setForm(f => ({
                                    ...f,
                                    tf_ids: e.target.checked
                                      ? [...f.tf_ids, tf.id]
                                      : f.tf_ids.filter(id => id !== tf.id),
                                  }))}
                                  style={{ accentColor: "var(--color-brand)", flexShrink: 0 }}
                                />
                                <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                                  TF{krIdx + 1}-{tf.tf_number || "?"}
                                </span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {tf.name}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {taskForces.length === 0 && (
                    <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                      TF が登録されていません。「Task Force」タブで先に TF を作ってください。
                    </div>
                  )}
                </div>
              )}
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

function MembersSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void }) {
  const rawMembers   = useAppStore(s => s.members);
  const rawGroups    = useAppStore(s => s.groups);
  const saveMember   = useAppStore(s => s.saveMember);
  const deleteMember = useAppStore(s => s.deleteMember);
  const isMobile = useIsMobile();
  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const groups  = useMemo(() => rawGroups.filter(g => !g.is_deleted), [rawGroups]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    display_name: "", short_name: "", teams_account: "", email: "",
    color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)",
    group_id: "" as string,
    is_admin: false,
    is_super_admin: false,
  });

  // 未保存変更を親に通知
  useEffect(() => {
    onDirtyChange(editId !== null);
  }, [editId, onDirtyChange]);

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
    setForm({ display_name: "", short_name: "", teams_account: "", email: "", color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)", group_id: groups[0]?.id ?? "", is_admin: false, is_super_admin: false });
  };

  const openEdit = (m: Member) => {
    setEditId(m.id);
    setForm({ display_name: m.display_name, short_name: m.short_name, teams_account: m.teams_account, email: m.email ?? "", color_bg: m.color_bg, color_text: m.color_text, group_id: m.group_id ?? "", is_admin: m.is_admin ?? false, is_super_admin: m.is_super_admin ?? false });
  };

  const save = async () => {
    if (!form.display_name.trim()) return;
    // イニシャル自動生成
    const initials = form.display_name.replace(/[\s　]+/g, "").slice(0, 2).toUpperCase();
    const shortName = form.short_name.trim() || form.display_name.split(/[\s　]/)[0];

    const now = new Date().toISOString();
    try {
      const emailVal = form.email.trim() || null;
      const groupIdVal = form.group_id || null;
      // 自分自身の is_admin を外せない保護：自分を編集中かつ is_admin を false にしようとした場合、
      // グループ内に他の管理者が1人以上いる場合のみ許可する。
      const targetIsCurrentUser = editId === currentUser.id;
      const otherAdmins = members.filter(m => m.id !== editId && m.is_admin === true);
      const isAdminVal = (targetIsCurrentUser && !form.is_admin && otherAdmins.length === 0)
        ? true  // 最後の管理者なので外させない
        : form.is_admin;
      // 自分自身の is_super_admin を外せない保護（全社スーパー管理者版・同じロジック）
      const otherSuperAdmins = members.filter(m => m.id !== editId && m.is_super_admin === true);
      const isSuperAdminVal = (targetIsCurrentUser && !form.is_super_admin && otherSuperAdmins.length === 0 && currentUser.is_super_admin === true)
        ? true  // 最後の全社スーパー管理者なので外させない
        : form.is_super_admin;

      if (editId === "new") {
        await saveMember({
          id: uuidv4(), initials,
          display_name: form.display_name.trim(),
          short_name: shortName,
          teams_account: form.teams_account,
          email: emailVal,
          group_id: groupIdVal,
          color_bg: form.color_bg, color_text: form.color_text,
          is_admin: isAdminVal,
          is_super_admin: isSuperAdminVal,
          is_deleted: false,
          created_at: now, updated_at: now, updated_by: currentUser.id,
        });
      } else {
        const existing = members.find(m => m.id === editId);
        if (existing) await saveMember({ ...existing, ...form, email: emailVal, group_id: groupIdVal, short_name: shortName, initials, is_admin: isAdminVal, is_super_admin: isSuperAdminVal, updated_by: currentUser.id });
      }
      setEditId(null);
    } catch (e) {
      const msg = getErrorMessage(e);
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
                {m.is_admin && (
                  <span style={{ fontSize: "9px", marginLeft: "6px", color: "#fff", background: "var(--color-brand)", padding: "1px 6px", borderRadius: "3px" }}>
                    管理者
                  </span>
                )}
                {m.is_super_admin && (
                  <span style={{ fontSize: "9px", marginLeft: "6px", color: "#fff", background: "#7c3aed", padding: "1px 6px", borderRadius: "3px" }}>
                    全社スーパー管理者
                  </span>
                )}
              </div>
              {groups.length > 1 && (
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                  {groups.find(g => g.id === m.group_id)?.name ?? "（部署未設定）"}
                </div>
              )}
              {m.email && (
                <div style={{ fontSize: "10px", color: "var(--color-brand)" }}>{m.email}</div>
              )}
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
              <FieldLabel>ログイン用メールアドレス（任意）</FieldLabel>
              <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                placeholder="例：y.yamamoto@amita-net.co.jp" style={inputStyle} />
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                設定するとログイン後にこのメンバーが自動選択されます
              </div>
            </div>
            {groups.length > 0 && (
              <div>
                <FieldLabel>グループ（任意）</FieldLabel>
                <CustomSelect
                  value={form.group_id}
                  onChange={v => setForm(f => ({ ...f, group_id: v }))}
                  options={[
                    { value: "", label: "（未設定）" },
                    ...groups.map(g => ({ value: g.id, label: g.name })),
                  ]}
                />
              </div>
            )}
            {/* 管理者権限 */}
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.is_admin}
                  onChange={e => setForm(f => ({ ...f, is_admin: e.target.checked }))}
                  disabled={
                    // 自分自身の管理者権限を外せない（他に管理者がいない場合）
                    editId === currentUser.id && form.is_admin
                      && members.filter(m => m.id !== editId && m.is_admin === true).length === 0
                  }
                  style={{ width: 14, height: 14, accentColor: "var(--color-brand)", cursor: "pointer" }}
                />
                <span style={{ fontSize: "11px", color: "var(--color-text-primary)" }}>管理者権限</span>
                <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                  （管理者が1人以上いる場合、非管理者は管理画面にアクセスできません）
                </span>
              </label>
            </div>
            {/* 全社スーパー管理者（自分がスーパー管理者、またはまだ誰もスーパー管理者になっていない場合のみ表示） */}
            {(currentUser.is_super_admin === true || members.every(m => m.is_super_admin !== true)) && (
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.is_super_admin}
                    onChange={e => setForm(f => ({ ...f, is_super_admin: e.target.checked }))}
                    disabled={
                      // 自分自身の全社スーパー管理者権限を外せない（他にスーパー管理者がいない場合）
                      editId === currentUser.id && form.is_super_admin
                        && members.filter(m => m.id !== editId && m.is_super_admin === true).length === 0
                    }
                    style={{ width: 14, height: 14, accentColor: "#7c3aed", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "11px", color: "var(--color-text-primary)" }}>全社スーパー管理者</span>
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                    （部署をまたいで全部署を横断管理できます。新規部署の作成もこの権限が必要です）
                  </span>
                </label>
              </div>
            )}
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
// セクション⑥：グループ（マルチテナント管理）
// ===================================================

function GroupsSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void }) {
  const rawGroups   = useAppStore(s => s.groups);
  const rawMembers  = useAppStore(s => s.members);
  const saveGroup   = useAppStore(s => s.saveGroup);
  const saveMember  = useAppStore(s => s.saveMember);
  const deleteGroup = useAppStore(s => s.deleteGroup);
  const groups  = useMemo(() => rawGroups.filter(g => !g.is_deleted), [rawGroups]);
  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const isSuperAdmin = currentUser.is_super_admin === true;

  // super-admin は全部署、部署管理者は自分の所属部署のみ改名・削除可能
  // （groups_update_admin RLSと同じ条件。合致しない場合は編集/削除アイコンを出さず、
  //  RLSエラーで詰まる無駄なクリックを避ける）
  const canManage = (g: Group) => isSuperAdmin || (currentUser.is_admin === true && g.id === currentUser.group_id);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", firstMemberName: "", firstMemberShortName: "", firstMemberEmail: "", teamsWebhookUrl: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [templateDownloading, setTemplateDownloading] = useState(false);

  useEffect(() => {
    onDirtyChange(editId !== null);
  }, [editId, onDirtyChange]);

  // Power Automateフローのテンプレート（.zip）をダウンロードする。
  // ログイン必須のSupabase Storage（admin-templatesバケット）から取得する
  // （Viteのpublic/直下だと未ログインでも取得できる公開URLになってしまうため避けた）。
  const downloadTemplate = async () => {
    setTemplateDownloading(true);
    setError(null);
    try {
      const { data, error: dlError } = await supabase.storage
        .from("admin-templates")
        .download("teams-webhook-flow-template.zip");
      if (dlError) throw dlError;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "teams-webhook-flow-template.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(formatErrorForUser("テンプレートのダウンロードに失敗しました", e));
    } finally {
      setTemplateDownloading(false);
    }
  };

  const openAdd = () => {
    setEditId("new");
    setForm({ name: "", firstMemberName: "", firstMemberShortName: "", firstMemberEmail: "", teamsWebhookUrl: "" });
    setError(null);
  };

  const openEdit = (g: Group) => {
    setEditId(g.id);
    setForm({ name: g.name, firstMemberName: "", firstMemberShortName: "", firstMemberEmail: "", teamsWebhookUrl: g.teams_webhook_url ?? "" });
    setError(null);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const now = new Date().toISOString();
    try {
      if (editId === "new") {
        const newGroupId = `grp-${Date.now()}`;
        await saveGroup({
          id: newGroupId,
          name: form.name.trim(),
          teams_webhook_url: form.teamsWebhookUrl.trim() || null,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          updated_by: currentUser.id,
        });
        // 最初のメンバー（この部署の管理者）を作成。
        // group_id は saveMember の自動注入（自分の所属部署）に頼らず、
        // 新しく作った部署のIDを必ず明示的に渡す。
        if (form.firstMemberName.trim()) {
          const initials = form.firstMemberName.replace(/[\s　]+/g, "").slice(0, 2).toUpperCase();
          const shortName = form.firstMemberShortName.trim() || form.firstMemberName.trim().split(/[\s　]/)[0];
          await saveMember({
            id: uuidv4(),
            display_name: form.firstMemberName.trim(),
            short_name: shortName,
            initials,
            teams_account: "",
            email: form.firstMemberEmail.trim() || null,
            group_id: newGroupId,
            is_admin: true,
            color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)",
            is_deleted: false,
            created_at: now, updated_at: now, updated_by: currentUser.id,
          });
        }
      } else {
        const existing = groups.find(g => g.id === editId);
        if (existing) {
          await saveGroup({
            ...existing,
            name: form.name.trim(),
            teams_webhook_url: form.teamsWebhookUrl.trim() || null,
            updated_by: currentUser.id,
          });
        }
      }
      setEditId(null);
    } catch (e) {
      setError(formatErrorForUser("保存に失敗しました", e));
    }
  };

  const handleDelete = async (g: Group) => {
    const memberCount = members.filter(m => m.group_id === g.id).length;
    if (memberCount > 0 && !isSuperAdmin) {
      await alertDialog(`このグループには ${memberCount} 名のメンバーがいます。\nメンバーのグループ変更後に削除してください。`);
      return;
    }
    const confirmMsg = memberCount > 0
      ? `グループ「${g.name}」には ${memberCount} 名のメンバーがいますが、全社スーパー管理者として強制削除しますか？`
      : `グループ「${g.name}」を削除しますか？`;
    if (!await confirmDialog(confirmMsg)) return;
    try {
      await deleteGroup(g.id, currentUser.id);
    } catch (e) {
      setError(formatErrorForUser("削除に失敗しました", e));
    }
  };

  return (
    <div style={{ maxWidth: "560px" }}>
      <SectionHeader title="グループ管理" action={
        isSuperAdmin
          ? <button onClick={openAdd} style={primaryBtnStyle}>＋ 部署を追加</button>
          : undefined
      } />
      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "10px" }}>
        グループ（部署）単位でデータが隔離されます（マルチテナント）。メンバーは1グループに属します。
        {!isSuperAdmin && "新規部署の作成は全社スーパー管理者のみ行えます。"}
      </div>

      {error && (
        <div style={{ fontSize: "11px", color: "var(--color-text-danger)", marginBottom: "8px" }}>
          {error}
        </div>
      )}

      {isSuperAdmin && (
        <div style={{ marginBottom: "16px" }}>
          <SectionHeader title="全部署の概要" />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {groups.map(g => {
              const groupMembers = members.filter(m => m.group_id === g.id);
              const adminCount = groupMembers.filter(m => m.is_admin === true).length;
              return (
                <div key={g.id} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "6px 12px", fontSize: "11px",
                  background: "var(--color-bg-secondary)", borderRadius: "var(--radius-sm)",
                }}>
                  <span style={{ color: "var(--color-text-primary)" }}>{g.name}</span>
                  <span style={{ color: "var(--color-text-tertiary)" }}>
                    メンバー {groupMembers.length}名・管理者 {adminCount}名
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "14px" }}>
        {groups.map(g => {
          const memberCount = members.filter(m => m.group_id === g.id).length;
          return (
            <div key={g.id} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "8px 12px",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)" }}>
                  {g.name}
                </div>
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                  メンバー {memberCount}名 / ID: {g.id}
                </div>
              </div>
              {canManage(g) && (
                <>
                  <IconBtn onClick={() => openEdit(g)}>✏</IconBtn>
                  <IconBtn danger onClick={() => { void handleDelete(g); }}>✕</IconBtn>
                </>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
            グループがありません。「＋ 部署を追加」から作成してください。
          </div>
        )}
      </div>

      {editId && (
        <div style={{
          padding: "14px", background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "500", marginBottom: "10px", color: "var(--color-text-primary)" }}>
            {editId === "new" ? "部署を追加" : "グループを編集"}
          </div>
          <div>
            <FieldLabel>グループ名 *</FieldLabel>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="例：EGG、営業部、開発チーム"
              maxLength={50}
              style={inputStyle}
            />
          </div>
          <div style={{ marginTop: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <FieldLabel>Teams Webhook URL（任意）</FieldLabel>
              <HelpButton modeKey="admin.groups-webhook" title="Teams通知チャンネルの設定方法を開く" />
            </div>
            <input
              value={form.teamsWebhookUrl}
              onChange={e => setForm(f => ({ ...f, teamsWebhookUrl: e.target.value }))}
              placeholder="https://..."
              style={inputStyle}
            />
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
              週次の期限通知（毎週月曜）をこの部署専用のTeamsチャンネルへ送る場合に設定します。
              未設定の場合は全社共通のチャンネルにフォールバックします。
            </div>
            <button
              type="button"
              onClick={() => { void downloadTemplate(); }}
              disabled={templateDownloading}
              style={{
                marginTop: "8px", display: "flex", alignItems: "center", gap: "5px",
                padding: "5px 10px", fontSize: "11px", fontWeight: 500,
                border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)",
                cursor: templateDownloading ? "default" : "pointer",
                opacity: templateDownloading ? 0.6 : 1,
              }}
            >
              ⬇ {templateDownloading ? "ダウンロード中…" : "Power Automate用テンプレートをダウンロード"}
            </button>
          </div>
          {editId === "new" && (
            <div style={{ marginTop: "10px" }}>
              <div style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "6px" }}>
                最初のメンバー（この部署の管理者・任意）
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input
                  value={form.firstMemberName}
                  onChange={e => setForm(f => ({ ...f, firstMemberName: e.target.value }))}
                  placeholder="氏名（例：田中 一郎）"
                  maxLength={50}
                  style={inputStyle}
                />
                <input
                  value={form.firstMemberShortName}
                  onChange={e => setForm(f => ({ ...f, firstMemberShortName: e.target.value }))}
                  placeholder="短縮名（未入力で姓を使用）"
                  style={inputStyle}
                />
                <input
                  type="email"
                  value={form.firstMemberEmail}
                  onChange={e => setForm(f => ({ ...f, firstMemberEmail: e.target.value }))}
                  placeholder="ログイン用メールアドレス"
                  style={inputStyle}
                />
              </div>
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                入力すると、この部署の最初の管理者として作成されます（後からメンバータブでも追加可）。
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={() => { void save(); }} disabled={!form.name.trim()} style={{
              ...primaryBtnStyle,
              opacity: form.name.trim() ? 1 : 0.4,
              cursor: form.name.trim() ? "pointer" : "not-allowed",
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
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={minRows}
      style={style}
    />
  );
}

function IconBtn({ children, onClick, title, danger }: {
  children: React.ReactNode; onClick: (e?: React.MouseEvent) => void; title?: string; danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={(e) => onClick(e)} title={title}
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

// ===================================================
// セクション⑤：メンバータグ（Phase Tag-1）
// ===================================================

function TagsSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void }) {
  const memberTags         = useAppStore(s => s.memberTags);
  const memberTagMembers   = useAppStore(s => s.memberTagMembers);
  const allMembers         = useAppStore(s => s.members);
  const saveMemberTag      = useAppStore(s => s.saveMemberTag);
  const deleteMemberTag    = useAppStore(s => s.deleteMemberTag);

  const activeTags    = useMemo(() => active(memberTags), [memberTags]);
  const activeMembers = useMemo(() => active(allMembers), [allMembers]);

  // タグごとのメンバーIDマップ
  const tagMembersMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const link of memberTagMembers) {
      if (!m.has(link.tag_id)) m.set(link.tag_id, []);
      m.get(link.tag_id)!.push(link.member_id);
    }
    return m;
  }, [memberTagMembers]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreating = editingId === "__new__";
  const isDirty = editingId !== null;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const startNew = () => {
    setEditingId("__new__");
    setDraftName("");
    setDraftDesc("");
    setDraftMemberIds([]);
    setError(null);
  };

  const startEdit = (tag: MemberTag) => {
    setEditingId(tag.id);
    setDraftName(tag.name);
    setDraftDesc(tag.description);
    setDraftMemberIds(tagMembersMap.get(tag.id) ?? []);
    setError(null);
  };

  const cancel = () => {
    setEditingId(null);
    setError(null);
  };

  const toggleMember = (memberId: string) => {
    setDraftMemberIds(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId],
    );
  };

  const handleSave = async () => {
    if (!draftName.trim()) {
      setError("タグ名を入力してください");
      return;
    }
    setError(null);
    const now = new Date().toISOString();
    const tag: MemberTag = isCreating
      ? {
          id: uuidv4(),
          name: draftName.trim(),
          description: draftDesc.trim(),
          kind: "static",
          source_id: null,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          updated_by: currentUser.id,
        }
      : {
          ...(activeTags.find(t => t.id === editingId)!),
          name: draftName.trim(),
          description: draftDesc.trim(),
          updated_by: currentUser.id,
        };
    try {
      await saveMemberTag(tag, draftMemberIds);
      setEditingId(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(formatErrorForUser("タグ保存に失敗しました", e));
    }
  };

  const handleDelete = async (tag: MemberTag) => {
    const memberCount = tagMembersMap.get(tag.id)?.length ?? 0;
    const ok = await confirmDialog(
      `タグ「${tag.name}」を削除しますか？\n${memberCount}名のメンバー紐付けは残ります（タグ自体が論理削除されます）。`,
    );
    if (!ok) return;
    try {
      await deleteMemberTag(tag.id, currentUser.id);
    } catch (e) {
      setError(formatErrorForUser("タグ削除に失敗しました", e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)" }}>
          メンバータグ（{activeTags.length}件）
        </div>
        <div style={{ flex: 1 }} />
        {saved && (
          <span style={{ fontSize: "11px", color: "var(--color-text-success)" }}>保存しました</span>
        )}
        {!isDirty && (
          <button
            onClick={startNew}
            style={{
              padding: "6px 12px", fontSize: "12px", fontWeight: "500",
              background: "var(--color-brand)", color: "#fff",
              border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >＋ タグを追加</button>
        )}
      </div>

      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        メンバーをグループ化するタグ。「請求書PJ」「広報チーム」「全員」のようなまとまりを定義し、
        将来のフェーズでタスクの担当者として一括指定できるようになります（現在は定義のみ可能）。
      </div>

      {error && (
        <div style={{
          fontSize: "12px", color: "var(--color-text-danger)",
          background: "var(--color-bg-danger)",
          padding: "8px 12px", borderRadius: "var(--radius-md)",
        }}>{error}</div>
      )}

      {/* 新規作成 / 編集フォーム */}
      {editingId !== null && (
        <div style={{
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)", padding: "14px 16px",
          display: "flex", flexDirection: "column", gap: "10px",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>
            {isCreating ? "新しいタグを追加" : "タグを編集"}
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "4px" }}>
              タグ名
            </label>
            <input
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              placeholder="例：請求書PJ / 広報チーム / 全員"
              style={{
                width: "100%", padding: "7px 10px", fontSize: "12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "4px" }}>
              説明（任意）
            </label>
            <input
              type="text"
              value={draftDesc}
              onChange={e => setDraftDesc(e.target.value)}
              placeholder="このタグの用途・対象範囲"
              style={{
                width: "100%", padding: "7px 10px", fontSize: "12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>
              メンバー（{draftMemberIds.length}名選択中）
            </label>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "6px",
              maxHeight: "260px", overflow: "auto",
              padding: "8px", border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)",
            }}>
              {activeMembers.map(m => {
                const checked = draftMemberIds.includes(m.id);
                return (
                  <label
                    key={m.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      fontSize: "12px", cursor: "pointer",
                      padding: "4px 6px", borderRadius: "var(--radius-sm)",
                      background: checked ? "var(--color-brand-light)" : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMember(m.id)}
                    />
                    <span>{m.short_name}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
              <button
                type="button"
                onClick={() => setDraftMemberIds(activeMembers.map(m => m.id))}
                style={{
                  fontSize: "11px", padding: "4px 8px",
                  background: "transparent",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-text-secondary)", cursor: "pointer",
                }}
              >全員選択</button>
              <button
                type="button"
                onClick={() => setDraftMemberIds([])}
                style={{
                  fontSize: "11px", padding: "4px 8px",
                  background: "transparent",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-text-secondary)", cursor: "pointer",
                }}
              >全解除</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button
              onClick={cancel}
              style={{
                padding: "7px 14px", fontSize: "12px",
                background: "transparent",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                color: "var(--color-text-secondary)", cursor: "pointer",
              }}
            >キャンセル</button>
            <button
              onClick={handleSave}
              style={{
                padding: "7px 16px", fontSize: "12px", fontWeight: "500",
                background: "var(--color-brand)", color: "#fff",
                border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
              }}
            >{isCreating ? "追加する" : "保存する"}</button>
          </div>
        </div>
      )}

      {/* 既存タグリスト */}
      {activeTags.length === 0 && editingId === null ? (
        <div style={{
          fontSize: "12px", color: "var(--color-text-tertiary)",
          padding: "20px", textAlign: "center",
          border: "1px dashed var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
        }}>
          まだタグがありません。「＋ タグを追加」から作成してください。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {activeTags.map(tag => {
            const ids = tagMembersMap.get(tag.id) ?? [];
            const tagMembers = activeMembers.filter(m => ids.includes(m.id));
            const isEditing = editingId === tag.id;
            if (isEditing) return null; // 編集中は上のフォームに移動済
            return (
              <div
                key={tag.id}
                style={{
                  background: "var(--color-bg-primary)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                  display: "flex", alignItems: "center", gap: "10px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-primary)" }}>
                    {tag.name}
                    <span style={{
                      marginLeft: "8px", fontSize: "10px",
                      color: "var(--color-text-tertiary)",
                      background: "var(--color-bg-secondary)",
                      padding: "1px 6px", borderRadius: "99px",
                    }}>{ids.length}名</span>
                  </div>
                  {tag.description && (
                    <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                      {tag.description}
                    </div>
                  )}
                  {tagMembers.length > 0 && (
                    <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                      {tagMembers.map(m => m.short_name).join(" / ")}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => startEdit(tag)}
                  disabled={isDirty}
                  style={{
                    fontSize: "11px", padding: "5px 10px",
                    background: "transparent",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-text-secondary)",
                    cursor: isDirty ? "not-allowed" : "pointer",
                    opacity: isDirty ? 0.5 : 1,
                  }}
                >編集</button>
                <button
                  onClick={() => handleDelete(tag)}
                  disabled={isDirty}
                  style={{
                    fontSize: "11px", padding: "5px 10px",
                    background: "transparent",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-text-danger)",
                    cursor: isDirty ? "not-allowed" : "pointer",
                    opacity: isDirty ? 0.5 : 1,
                  }}
                >削除</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AIUsageSection() {
  const members = useAppStore(s => s.members);

  const [logs, setLogs] = useState<AiUsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ログを取得して state に反映する。silent=true のときは全画面ローディングを出さない（自動更新用）。
  const reload = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const data = await fetchAiUsageLogs();
      setLogs(data);
      setLastUpdated(new Date());
      setFetchError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setFetchError(`AI使用量ログの取得に失敗しました: ${msg}`);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  // 初回取得（loading 表示あり）
  useEffect(() => {
    void reload(false);
  }, [reload]);

  // 自動更新：マウント中は 30 秒ごとに silent reload。unmount で clear。
  useEffect(() => {
    const id = setInterval(() => { void reload(true); }, 30_000);
    return () => clearInterval(id);
  }, [reload]);

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

  // メンバー別内訳（今月）：最新月（=monthlyData 先頭）or 現在の YYYY-MM のログを member_id で集計。
  const memberBreakdown = useMemo(() => {
    // monthlyData は月降順ソート済み。先頭が最新月。無ければ現在の YYYY-MM。
    const targetMonth = monthlyData[0]?.month ?? new Date().toISOString().slice(0, 7);
    const monthLogs = logs.filter(l => (l.called_at ?? "").slice(0, 7) === targetMonth);
    const map = new Map<string, { count: number; input: number; output: number }>();
    for (const log of monthLogs) {
      const key = log.member_id ?? "";
      const cur = map.get(key) ?? { count: 0, input: 0, output: 0 };
      cur.count  += 1;
      cur.input  += log.input_tokens;
      cur.output += log.output_tokens;
      map.set(key, cur);
    }
    const rows = Array.from(map.entries())
      .map(([memberId, agg]) => {
        const m = members.find(mm => mm.id === memberId);
        const name = m?.display_name || m?.short_name
          || (memberId ? `不明（${memberId.slice(0, 8)}）` : "不明");
        return { memberId, name, ...agg };
      })
      .sort((a, b) => b.count - a.count);
    return { targetMonth, rows };
  }, [logs, monthlyData, members]);

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
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

  // 初回読み込み中のみ全画面ローディング（自動更新では出さない）
  if (loading) return <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", padding: "20px" }}>読み込み中...</div>;
  // 初回取得自体が失敗してデータが無い場合は全面エラー表示
  if (fetchError && logs.length === 0) return (
    <div style={{
      fontSize: "12px", color: "var(--color-text-danger)",
      background: "var(--color-bg-danger)",
      border: "1px solid var(--color-border-danger)",
      borderRadius: "var(--radius-md)",
      padding: "12px 14px", margin: "12px 0",
    }}>
      ⚠ {fetchError}
    </div>
  );

  const lastUpdatedLabel = lastUpdated
    ? `最終更新 ${String(lastUpdated.getHours()).padStart(2, "0")}:${String(lastUpdated.getMinutes()).padStart(2, "0")}`
    : null;

  return (
    <div style={{ maxWidth: "620px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
        <div style={{ flex: 1 }}>
          <SectionHeader title="AI使用量" />
        </div>
        {lastUpdatedLabel && (
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
            {refreshing ? "更新中…" : lastUpdatedLabel}
          </span>
        )}
        <button
          onClick={() => { void reload(true); }}
          disabled={refreshing}
          title="最新の使用量を再取得"
          style={{
            ...ghostBtnStyle, fontSize: "11px", padding: "4px 10px", flexShrink: 0,
            opacity: refreshing ? 0.6 : 1, cursor: refreshing ? "default" : "pointer",
          }}
        >
          🔄 更新
        </button>
      </div>
      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "2px" }}>
        アプリ全体（全メンバーの合計）の使用量です。約30秒ごとに自動更新します。
      </div>
      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
        料金目安：入力 $3/100万トークン・出力 $15/100万トークン（1ドル=150円換算）
      </div>

      {/* 自動更新中に発生したエラーは控えめなバナーで通知（既存データは保持） */}
      {fetchError && logs.length > 0 && (
        <div style={{
          fontSize: "11px", color: "var(--color-text-danger)",
          background: "var(--color-bg-danger)",
          border: "1px solid var(--color-border-danger)",
          borderRadius: "var(--radius-md)",
          padding: "8px 12px", marginBottom: "12px",
        }}>
          ⚠ {fetchError}
        </div>
      )}

      {/* メンバー別内訳（今月） */}
      <MemberUsageBreakdown breakdown={memberBreakdown} rowStyle={rowStyle} headerStyle={headerStyle} />

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

// メンバー別内訳（今月）。今月分が無ければ「今月の利用はまだありません」を表示。
function MemberUsageBreakdown({
  breakdown, rowStyle, headerStyle,
}: {
  breakdown: { targetMonth: string; rows: { memberId: string; name: string; count: number; input: number; output: number }[] };
  rowStyle: React.CSSProperties;
  headerStyle: React.CSSProperties;
}) {
  const { targetMonth, rows } = breakdown;
  const [y, m] = targetMonth.split("-");
  const monthLabel = y && m ? `${y}年${parseInt(m)}月` : "今月";

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ fontSize: "11px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "6px" }}>
        メンバー別内訳（{monthLabel}）
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>今月の利用はまだありません。</div>
      ) : (
        <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
          <div style={headerStyle}>
            <span>メンバー</span>
            <span style={{ textAlign: "right" }}>回数</span>
            <span style={{ textAlign: "right" }}>入力tok</span>
            <span style={{ textAlign: "right" }}>出力tok</span>
            <span style={{ textAlign: "right" }}>費用目安</span>
          </div>
          {rows.map(r => (
            <div key={r.memberId || "unknown"} style={{ ...rowStyle, color: "var(--color-text-secondary)", borderTop: "1px solid var(--color-border-primary)" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
              <span style={{ textAlign: "right" }}>{r.count}回</span>
              <span style={{ textAlign: "right" }}>{r.input.toLocaleString()}</span>
              <span style={{ textAlign: "right" }}>{r.output.toLocaleString()}</span>
              <span style={{ textAlign: "right", color: "var(--color-text-info)", fontWeight: "600" }}>¥{Math.round(calcCostJpy(r.input, r.output))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
