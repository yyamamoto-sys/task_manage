// src/components/admin/AdminView.tsx
//
// 【設計意図】
// 管理画面。左ナビ（作業設定／人／組織／レポートの4カテゴリ）配下に
// プロジェクト・Task Force・Objective/KR・メンバー・メンバータグ・グループ／部署・AI使用量の
// 7セクションを持つ。
// アクセス制御：部署管理者（is_admin）または全社スーパー管理者（is_super_admin）のみ編集可。
// ただしグループ内にis_admin=trueのメンバーが1人もいない間はブートストラップモードとして全員アクセス可。
// 変更はSupabaseに即時反映（appStore経由）。

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
import { keyResultsInGroup, taskForcesInGroup, pickCurrentObjectiveForGroup } from "../../lib/okr/deptScope";
import { currentQuarter } from "../../lib/date";
import { getErrorMessage, formatErrorForUser } from "../../lib/errorMessage";
import { KEYS, active } from "../../lib/localData/localStore";
import { HelpButton } from "../guide/HelpButton";
import { GuideOverlay } from "../guide/GuideOverlay";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog, alertDialog } from "../../lib/dialog";
import { v4 as uuidv4 } from "uuid";
import { TodoDecomposeModal } from "./TodoDecomposeModal";
import { QuickAddTaskModal } from "../task/QuickAddTaskModal";
import { CustomSelect } from "../common/CustomSelect";
import { MilestoneAddForm } from "../milestone/MilestoneAddForm";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE } from "../../lib/taskMeta";
import { MilestoneEditModal } from "../milestone/MilestoneEditModal";
import { Card, SummaryTile, SummaryRow } from "../common/Card";
import { DangerZone, DangerAction } from "../common/DangerZone";
import { AdminFormModal } from "./AdminFormModal";
import { OkrImportModal } from "./OkrImportModal";

type AdminTab = "okr" | "tf" | "pj" | "members" | "tags" | "ai_usage" | "groups";

interface Props { currentUser: Member; }

// ===== 部署絞り込み（設定画面ローカル・2026-07-23） =====
//
// 【設計意図】アプリ全体のcurrentGroupId（ログイン時に自分の所属部署から設定・全画面の表示部署）
// とは連動させない、AdminView専用のローカル選択。全社スーパー管理者・複数部署アクセスを持つ
// メンバーが、管理画面上で「今どの部署を見て/編集しているか」を明示的に切り替えられるようにする。
// group_ids（複数部署アクセス・migration 20260722b）が入っていればそれで判定し、
// 未設定（バックフィル漏れ等）の古いデータは group_id（ホーム部署）にフォールバックする。
function memberInGroup(m: Member, groupId: string): boolean {
  if (!groupId) return true;
  if (m.group_ids && m.group_ids.length > 0) return m.group_ids.includes(groupId);
  return m.group_id === groupId;
}
function projectInGroup(p: Project, groupId: string): boolean {
  if (!groupId) return true;
  if (p.group_ids && p.group_ids.length > 0) return p.group_ids.includes(groupId);
  return p.group_id === groupId;
}

// メンバー保存時の 23505（members_email_unique）検知。
// 「兼務は同じメールでメンバーをもう1件作る」という誤った操作の典型的な入口になるため、
// 生のPostgrestエラーではなく「既存メンバーのgroup_idsに部署を足す」という正しい手順を案内する。
function isMemberEmailUniqueViolation(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const obj = e as Record<string, unknown>;
  if (obj.code !== "23505") return false;
  const text = [obj.message, obj.details, obj.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return text.includes("members_email_unique");
}

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
  const isMobile = useIsMobile();
  const krs        = useAppStore(s => s.keyResults);
  // 件数バッジ用は selectedGroupId（設定画面ローカルの部署選択）で絞り込むため、
  // アプリ全体のcurrentGroupId基準のselectScopedProjectsではなく未絞り込みのs.projectsを
  // 素で取得する（PJSectionが実際に表示する一覧と同じ絞り込み関数=projectInGroupを使う）。
  const rawProjects = useAppStore(s => s.projects);
  const rawTfs     = useAppStore(s => s.taskForces);
  const rawObjectives = useAppStore(s => s.objectives);
  const rawGroups  = useAppStore(s => s.groups);
  const rawTags    = useAppStore(s => s.memberTags);
  // タグ本体（member_tags）は部署概念を持たない全社共通マスタのため件数は絞り込まない
  // （TagsSectionのactiveTagsと同じ方針。CLAUDE.md Section 1.6参照）。
  const tagCount    = active(rawTags).length;
  // グループ（部署）数はその部署一覧そのものなので、selectedGroupIdで絞る対象ではない
  // （GroupsSectionのgroups一覧と同じ全社件数）。
  const groupCount  = rawGroups.filter(g => !g.is_deleted).length;

  // 部署絞り込みセレクタ：アクセス可能な部署が2つ以上のときだけ表示する
  // （全社スーパー管理者は全部署、それ以外は自分のgroup_idsに含まれる部署のみ。
  //  1部署しか持たない普通の部署管理者には選択肢が1つしか無く無意味なため出さない）。
  const groupsActive = useMemo(() => rawGroups.filter(g => !g.is_deleted), [rawGroups]);
  const accessibleGroups = useMemo(() => {
    if (isCurrentUserSuperAdmin) return groupsActive;
    const ids = currentUser.group_ids?.length ? currentUser.group_ids
      : (currentUser.group_id ? [currentUser.group_id] : []);
    return groupsActive.filter(g => ids.includes(g.id));
  }, [groupsActive, isCurrentUserSuperAdmin, currentUser.group_ids, currentUser.group_id]);
  const showGroupSelector = accessibleGroups.length >= 2;
  const [selectedGroupId, setSelectedGroupId] = useState<string>(currentUser.group_id ?? "");
  // ホーム部署がアクセス可能一覧に含まれない/未設定の場合のフォールバック（初回ロード時のデータ到着待ち等）
  useEffect(() => {
    if (accessibleGroups.length === 0) return;
    if (!accessibleGroups.some(g => g.id === selectedGroupId)) {
      setSelectedGroupId(accessibleGroups[0].id);
    }
  }, [accessibleGroups, selectedGroupId]);

  // KR/TFの件数は selectedGroupId（設定画面のローカル部署選択）でスコープする
  // （Objective.group_id → KR.objective_id → TF.kr_id と部署を継承。CLAUDE.md Section 1.6参照）。
  // ナビのバッジ数・初期タブ選択・「まだ何も無い」案内が、実際にOKRSection/TFSectionで
  // 表示される件数と一致するようにする。
  const krCount = useMemo(
    () => keyResultsInGroup(active(krs), rawObjectives, selectedGroupId || null).length,
    [krs, rawObjectives, selectedGroupId],
  );
  const tfCount = useMemo(
    () => taskForcesInGroup(active(rawTfs), active(krs), rawObjectives, selectedGroupId || null).length,
    [rawTfs, krs, rawObjectives, selectedGroupId],
  );
  // プロジェクト・メンバーの件数も同じくselectedGroupIdでスコープする
  // （PJSection/MembersSectionが実際に表示する一覧=projectInGroup/memberInGroupと同じ絞り込み）。
  const pjCount = useMemo(
    () => active(rawProjects).filter(p => projectInGroup(p, selectedGroupId)).length,
    [rawProjects, selectedGroupId],
  );
  const memberCount = useMemo(
    () => active(allMembers).filter(m => memberInGroup(m, selectedGroupId)).length,
    [allMembers, selectedGroupId],
  );

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

  // 管理者ガード判定は全フック宣言の後で行う（react-hooks/rules-of-hooks 対応）。
  // メンバーデータは非同期で読み込まれるため、表示中に hasAnyAdmin/canAccessAdmin が
  // 変化してこの early return の有無が切り替わると、以前はフック呼び出し数がずれて
  // Reactがクラッシュし得た（TaskEditModalで過去に修正した画面真っ白と同一パターン）。
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

  // 左ナビ：カテゴリ分け（作業設定 / 人 / 組織 / レポート）
  const categories: { label: string; items: { key: AdminTab; label: string; count?: number }[] }[] = [
    { label: "作業設定", items: [
        { key: "pj",  label: "プロジェクト",     count: pjCount },
        { key: "tf",  label: "Task Force",       count: tfCount },
        { key: "okr", label: "Objective・KR",    count: krCount },
    ] },
    { label: "人", items: [
        { key: "members", label: "メンバー",     count: memberCount },
        { key: "tags",     label: "メンバータグ", count: tagCount },
    ] },
    { label: "組織", items: [
        { key: "groups", label: "グループ・部署", count: groupCount },
    ] },
    { label: "レポート", items: [
        { key: "ai_usage", label: "AI使用量" },
    ] },
  ];
  const currentTabLabel = categories.flatMap(c => c.items).find(it => it.key === tab)?.label ?? "";

  const navButtonStyle = (isActive: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: "8px", width: "100%",
    padding: "7px 8px", marginBottom: "2px", fontSize: "12px", textAlign: "left",
    borderRadius: "var(--radius-md)", border: "none", cursor: "pointer",
    background: isActive ? "var(--color-bg-info)" : "transparent",
    color: isActive ? "var(--color-text-info)" : "var(--color-text-secondary)",
    fontWeight: isActive ? "500" : "400",
    transition: "background 0.1s, color 0.1s",
  });
  const navBadgeStyle = (isActive: boolean): React.CSSProperties => ({
    fontSize: "10px", padding: "1px 6px", borderRadius: "99px", flexShrink: 0,
    background: isActive ? "var(--color-bg-primary)" : "var(--color-bg-secondary)",
    color: isActive ? "var(--color-text-info)" : "var(--color-text-tertiary)",
    border: "1px solid var(--color-border-primary)",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ヘッダー */}
      <div style={{
        padding: "10px 20px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-primary)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
            管理{isMobile && currentTabLabel ? ` ・ ${currentTabLabel}` : ""}
          </div>
          <span style={{
            fontSize: "10px", padding: "2px 8px",
            background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
            border: "1px solid var(--color-border-warning)", borderRadius: "99px",
          }}>
            部署管理者・全社スーパー管理者が編集できます
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

        {/* 部署絞り込みセレクタ（アクセス可能な部署が2つ以上のときだけ表示） */}
        {showGroupSelector && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
              🏢 表示する部署
            </span>
            <div style={{ width: isMobile ? "100%" : "220px" }}>
              <CustomSelect
                value={selectedGroupId}
                onChange={setSelectedGroupId}
                options={accessibleGroups.map(g => ({ value: g.id, label: g.name }))}
              />
            </div>
            {!isMobile && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                この選択は設定画面内だけで有効です（他の画面の表示部署には影響しません）
              </span>
            )}
          </div>
        )}

        {/* モバイル：カテゴリ見出し付きセレクトに畳む */}
        {isMobile && (
          <select
            value={tab}
            onChange={e => { void changeTab(e.target.value as AdminTab); }}
            style={{ ...inputStyle, marginTop: "10px" }}
          >
            {categories.map(cat => (
              <optgroup label={cat.label} key={cat.label}>
                {cat.items.map(it => (
                  <option key={it.key} value={it.key}>
                    {it.label}{it.count != null ? `（${it.count}）` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {/* 初見向け：次の推奨ステップ */}
        {(krCount === 0 || pjCount === 0) && (
          <div style={{
            margin: "10px 0 0", padding: "5px 10px",
            background: "var(--color-bg-info)",
            border: "1px solid var(--color-border-info)",
            borderRadius: "var(--radius-sm)",
            fontSize: "10px", color: "var(--color-text-info)", lineHeight: 1.5,
          }}>
            {krCount === 0
              ? "💡 まず「Objective・KR」で今期の目標と KR（成果指標）を3〜5本登録しましょう。"
              : "💡 続いて「プロジェクト」で KR を実現する手段（PJ）を登録します。"}
          </div>
        )}
      </div>

      {/* 左ナビ＋コンテンツの2カラム（モバイルは左ナビ非表示・上部セレクトのみ） */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {!isMobile && (
          <nav style={{
            width: "188px", flexShrink: 0, overflowY: "auto",
            padding: "14px 10px", borderRight: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-primary)",
          }}>
            {categories.map(cat => (
              <div key={cat.label} style={{ marginBottom: "16px" }}>
                <div style={{
                  fontSize: "10px", fontWeight: "600", letterSpacing: "0.06em",
                  color: "var(--color-text-tertiary)", textTransform: "uppercase",
                  padding: "0 8px 6px",
                }}>
                  {cat.label}
                </div>
                {cat.items.map(it => {
                  const isActive = tab === it.key;
                  return (
                    <button
                      key={it.key}
                      onClick={() => { void changeTab(it.key); }}
                      style={navButtonStyle(isActive)}
                    >
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.label}
                      </span>
                      {it.count != null && (
                        <span style={navBadgeStyle(isActive)}>{it.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        )}

        {/* コンテンツ */}
        <div
          key={tab}
          className="animate-fadeIn"
          style={{
            flex: 1, minWidth: 0,
            overflow: tab === "tf" ? "hidden" : "auto",
            padding: tab === "tf" ? "18px 20px 0" : "18px 20px",
            zoom: zoomLevels[fontSizeLevel],
            display: "flex", flexDirection: "column", minHeight: 0,
          }}
        >
          {tab === "okr"      && <OKRSection key={selectedGroupId} currentUser={currentUser} onDirtyChange={setIsDirty} selectedGroupId={selectedGroupId} />}
          {tab === "tf"       && <TFSection key={selectedGroupId} currentUser={currentUser} onDirtyChange={setIsDirty} selectedGroupId={selectedGroupId} />}
          {tab === "pj"       && <PJSection currentUser={currentUser} onDirtyChange={setIsDirty} selectedGroupId={selectedGroupId} />}
          {tab === "members"  && <MembersSection currentUser={currentUser} onDirtyChange={setIsDirty} selectedGroupId={selectedGroupId} />}
          {tab === "tags"     && <TagsSection currentUser={currentUser} onDirtyChange={setIsDirty} selectedGroupId={selectedGroupId} />}
          {tab === "ai_usage" && <AIUsageSection selectedGroupId={selectedGroupId} />}
          {tab === "groups"   && <GroupsSection currentUser={currentUser} onDirtyChange={setIsDirty} />}
        </div>
      </div>
    </div>
  );
}

// ===================================================
// セクション①：Objective / KR
// ===================================================

function OKRSection({ currentUser, onDirtyChange, selectedGroupId }: {
  currentUser: Member; onDirtyChange: (dirty: boolean) => void; selectedGroupId: string;
}) {
  const rawObjectives   = useAppStore(s => s.objectives);
  const rawKrs          = useAppStore(s => s.keyResults);
  const saveObjective   = useAppStore(s => s.saveObjective);
  const saveKeyResult   = useAppStore(s => s.saveKeyResult);
  const deleteKeyResult = useAppStore(s => s.deleteKeyResult);
  // selectedGroupId（設定画面のローカル部署選択）でスコープする。key={selectedGroupId}で
  // 部署切替のたびに本コンポーネントごと再マウントされるため、下のローカル編集state
  // （objTitle等）が前の部署の内容を引きずることはない。
  const ctxObj = useMemo(
    () => pickCurrentObjectiveForGroup(rawObjectives, selectedGroupId || null),
    [rawObjectives, selectedGroupId],
  );
  const krs = useMemo(
    () => keyResultsInGroup(active(rawKrs), rawObjectives, selectedGroupId || null),
    [rawKrs, rawObjectives, selectedGroupId],
  );

  const [editingKrId, setEditingKrId] = useState<string | null>(null);
  const [krDangerId, setKrDangerId] = useState<string | null>(null);
  const [newKrTitle, setNewKrTitle] = useState("");
  const [objTitle, setObjTitle] = useState(ctxObj?.title ?? "");
  const [objPurpose, setObjPurpose] = useState(ctxObj?.purpose ?? "");
  const [objBackground, setObjBackground] = useState(ctxObj?.background ?? "");
  const [saved, setSaved] = useState(false);
  const [objEdited, setObjEdited] = useState(false);
  const [showImport, setShowImport] = useState(false);

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
      group_id: ctxObj?.group_id ?? selectedGroupId,
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
    setKrDangerId(null);
  };

  return (
    <div style={{ maxWidth: "680px" }}>
      <SummaryRow>
        <SummaryTile label="Objective" value={ctxObj?.period ?? "未設定"} tone="accent" />
        <SummaryTile label="KR数" value={krs.length} tone="info" />
      </SummaryRow>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
        <button
          onClick={() => setShowImport(true)}
          style={{
            padding: "7px 14px", fontSize: "12px", fontWeight: "600",
            background: "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))",
            border: "none", borderRadius: "var(--radius-md)",
            color: "#fff", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "6px",
          }}
        >
          📄 PDFから取込
        </button>
      </div>
      {showImport && (
        <OkrImportModal currentUser={currentUser} targetGroupId={selectedGroupId} onClose={() => setShowImport(false)} />
      )}

      {/* Objective編集 */}
      <Card title="Objective" badge={ctxObj?.period ?? "2026年度"} badgeColor="success" style={{ marginBottom: "20px" }}>
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
      </Card>

      {/* KR一覧 */}
      <Card title="Key Results" badge={`${krs.length}件`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
          {krs.map((kr, i) => (
            <div key={kr.id}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
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
                    background: "var(--color-bg-secondary)",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)", fontSize: "12px",
                    color: "var(--color-text-primary)", lineHeight: 1.5,
                  }}>
                    {kr.title}
                  </div>
                )}
                <div style={{ display: "flex", gap: "4px", flexShrink: 0, marginTop: "4px" }}>
                  <IconBtn title="編集" onClick={() => setEditingKrId(kr.id)}>✏</IconBtn>
                  <IconBtn
                    title="危険な操作（削除）"
                    danger
                    onClick={() => setKrDangerId(id => id === kr.id ? null : kr.id)}
                  >✕</IconBtn>
                </div>
              </div>
              {krDangerId === kr.id && (
                <DangerZone style={{ marginTop: "6px", marginLeft: "30px" }}>
                  <DangerAction
                    label="このKRを削除"
                    description="紐づくTF・ToDo・タスクの表示に影響します。この操作は取り消せません。"
                    onConfirm={() => deleteKr(kr.id)}
                  />
                </DangerZone>
              )}
            </div>
          ))}
          {krs.length === 0 && (
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "4px 0" }}>
              まだKRがありません。下の入力欄から追加してください。
            </div>
          )}
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
          <button onClick={addKr} style={addBtnStyle}>＋ 追加</button>
        </div>
      </Card>
    </div>
  );
}

// ===================================================
// セクション②：Task Force（クォーター別設定）
// ===================================================
// クォーターを選択し、通期KRごとにTFを割り当てる。
// 割り当て済みTFにはToDoパネルが展開でき、大タスクを直接追加できる。

function TFSection({ currentUser, onDirtyChange, selectedGroupId }: {
  currentUser: Member; onDirtyChange: (dirty: boolean) => void; selectedGroupId: string;
}) {
  const rawObjectives               = useAppStore(s => s.objectives);
  const rawTfs                      = useAppStore(s => s.taskForces);
  const rawKrs                      = useAppStore(s => s.keyResults);
  const rawMembers                  = useAppStore(s => s.members);
  const rawTodos                    = useAppStore(s => s.todos);
  const rawTasks                    = useAppStore(selectScopedTasks);
  const rawProjects                 = useAppStore(selectScopedProjects);
  const saveTaskForce               = useAppStore(s => s.saveTaskForce);
  const deleteTaskForce             = useAppStore(s => s.deleteTaskForce);
  const saveToDo                    = useAppStore(s => s.saveToDo);
  const deleteToDo                  = useAppStore(s => s.deleteToDo);
  const saveTask                    = useAppStore(s => s.saveTask);

  const isMobile = useIsMobile();
  // selectedGroupId（設定画面のローカル部署選択）でスコープする。key={selectedGroupId}で
  // 部署切替のたびに本コンポーネントごと再マウントされる。
  const ctxObj = useMemo(
    () => pickCurrentObjectiveForGroup(rawObjectives, selectedGroupId || null),
    [rawObjectives, selectedGroupId],
  );
  const krs = useMemo(
    () => keyResultsInGroup(active(rawKrs), rawObjectives, selectedGroupId || null),
    [rawKrs, rawObjectives, selectedGroupId],
  );
  const tfs = useMemo(
    () => taskForcesInGroup(active(rawTfs), active(rawKrs), rawObjectives, selectedGroupId || null),
    [rawTfs, rawKrs, rawObjectives, selectedGroupId],
  );
  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const todos   = useMemo(() => active(rawTodos), [rawTodos]);
  const allTasks = useMemo(() => active(rawTasks), [rawTasks]);
  const projects = useMemo(() => active(rawProjects), [rawProjects]);

  // 現在の日付から今のQを求める（1Q=1-3月 / 2Q=4-6月 / 3Q=7-9月 / 4Q=10-12月）
  // 判定ロジックは lib/date.ts の currentQuarter() に一元化済み。
  const currentQ = useMemo<Quarter>(() => currentQuarter(), []);

  // クォーター選択（初期値を現在のQに設定）
  const [selectedQuarter, setSelectedQuarter] = useState<Quarter>(currentQ);
  const tfsInSelectedQuarter = useMemo(
    () => tfs.filter(t => effectiveTfQuarter(t) === selectedQuarter).length,
    [tfs, selectedQuarter],
  );

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
      // quarterはundefinedではなくnullで送る（undefinedはJSON.stringifyで消え、更新から
      // 列ごと抜け落ちてDBのquarterが古い値のまま残ってしまうため）
      const existing = tfs.find(t => t.id === tfId);
      if (!existing) return;
      await saveTaskForce({ ...existing, quarter: null, updated_by: currentUser.id });
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
      // 空文字（担当者未選択）はFK違反になるため null に正規化
      leader_member_id: newTfForm.leader_member_id || null,
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
    setForm({ kr_id: tf.kr_id, tf_number: tf.tf_number, name: tf.name, description: tf.description ?? "", background: tf.background ?? "", leader_member_id: tf.leader_member_id ?? "" });
  };

  const saveTfEdit = async () => {
    if (!form.name.trim()) return;
    try {
      // description/backgroundはundefinedではなくnullで送る（undefinedはJSON.stringifyで消え、
      // 更新から列ごと抜け落ちるため、空にして保存してもDBの古い値がそのまま残ってしまう）
      const existing = tfs.find(t => t.id === editId);
      if (existing) await saveTaskForce({ ...existing, ...form, description: form.description || null, background: form.background || null, leader_member_id: form.leader_member_id || null, updated_by: currentUser.id });
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
      <div style={{ flexShrink: 0 }}>
        <SummaryRow>
          <SummaryTile label="TF総数" value={tfs.length} tone="accent" />
          <SummaryTile label={`${selectedQuarter}のTF`} value={tfsInSelectedQuarter} tone="info" />
        </SummaryRow>
      </div>

      {/* クォーター選択タブ */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px", flexShrink: 0 }}>
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
                    projects={projects}
                    currentUser={currentUser}
                    onEdit={() => openEdit(tf)}
                    onDelete={() => { void handleUnlinkTf(kr.id, tf.id); }}
                    onSaveToDo={saveToDo} onDeleteToDo={deleteToDo}
                    isEditing={editId === tf.id}
                    editForm={form}
                    setEditForm={setForm}
                    onSaveEdit={() => { void saveTfEdit(); }}
                    onCancelEdit={() => setEditId(null)}
                    onDeleteTF={() => deleteTF(editId!)}
                    currentQuarter={selectedQuarter}
                    onMoveTo={(targetQ) => { void handleMoveTf(kr.id, tf.id, targetQ); }}
                  />
                ))}
              </div>

              {/* TF追加コントロール（固定下部） */}
              <div style={{ flexShrink: 0 }}>
                {ctxObj?.id && (
                  <div style={{ marginTop: "6px" }}>
                    <button
                      onClick={() => openNewTfForm(kr.id)}
                      style={{ fontSize: "10px", padding: "3px 10px", border: "1px dashed var(--color-border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", background: "transparent", color: "var(--color-text-secondary)" }}
                    >＋ 新規TFを作成</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 新規TF作成モーダル（マイルストーン追加と同じポップアップ形式・2026-07-23） */}
      {newTfFormKrId !== null && (() => {
        const krId = newTfFormKrId;
        if (!krId) return null;
        const krIdx = krs.findIndex(k => k.id === krId);
        const kr = krs[krIdx];
        return (
          <AdminFormModal
            title="Task Forceを追加"
            subtitle={kr ? `KR${krIdx + 1}：${kr.title}` : undefined}
            onClose={() => setNewTfFormKrId(null)}
          >
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
              <button onClick={() => { void handleCreateAndLinkTf(krId); }} style={primaryBtnStyle}>作成してリンク</button>
              <button onClick={() => setNewTfFormKrId(null)} style={ghostBtnStyle}>キャンセル</button>
            </div>
          </AdminFormModal>
        );
      })()}
    </div>
  );
}

function TFRow({ tf, members, todos, tasks, saveTask, projects, currentUser, onEdit, onDelete, onSaveToDo, onDeleteToDo,
  isEditing, editForm, setEditForm, onSaveEdit, onCancelEdit, onDeleteTF, currentQuarter, onMoveTo }: {
  tf: TaskForce; members: Member[];
  todos: ToDo[]; tasks: import("../../lib/localData/types").Task[];
  saveTask: (task: import("../../lib/localData/types").Task) => Promise<void>;
  projects: Project[];
  currentUser: Member;
  onEdit: () => void; onDelete: () => void;
  onSaveToDo: (todo: ToDo) => Promise<void>;
  onDeleteToDo: (id: string, deletedBy: string) => Promise<void>;
  isEditing: boolean;
  editForm: { kr_id: string; tf_number: string; name: string; description: string; background: string; leader_member_id: string };
  setEditForm: React.Dispatch<React.SetStateAction<{ kr_id: string; tf_number: string; name: string; description: string; background: string; leader_member_id: string }>>;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  // DangerAction の busy 状態・エラー捕捉が実際の削除完了を待てるよう Promise を返す
  // （() => void で void 経由の fire-and-forget にすると、DangerAction 側の
  //  try/finally が削除完了より先に終わってしまう）
  onDeleteTF: () => Promise<void>;
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
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button onClick={onSaveEdit} style={primaryBtnStyle}>保存</button>
            <button onClick={onCancelEdit} style={ghostBtnStyle}>キャンセル</button>
          </div>
          <DangerZone style={{ marginTop: "12px" }}>
            <DangerAction
              label="このTask Forceを完全に削除"
              description="紐づくToDo・タスクとの関連付けも失われます。この操作は取り消せません。"
              onConfirm={onDeleteTF}
            />
          </DangerZone>
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
          projects={projects}
          currentUser={currentUser}
          onSave={onSaveToDo}
          onDelete={onDeleteToDo}
        />
      )}
    </div>
  );
}

// ===== ToDoパネル =====

function ToDoPanel({ tfId, todos, tasks, members, saveTask, projects, currentUser, onSave, onDelete }: {
  tfId: string; todos: ToDo[];
  tasks: import("../../lib/localData/types").Task[];
  members: Member[];
  saveTask: (task: import("../../lib/localData/types").Task) => Promise<void>;
  projects: Project[];
  currentUser: Member;
  onSave: (todo: ToDo) => Promise<void>;
  onDelete: (id: string, deletedBy: string) => Promise<void>;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", title: "", due_date: "", memo: "" });
  const [addingTaskForTodoId, setAddingTaskForTodoId] = useState<string | null>(null);
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
      // undefinedではなくnullで送る（undefinedはJSON.stringifyで消え、既存ToDoのnameを
      // 空に戻す編集で更新から列ごと抜け落ちるため）
      name: form.name.trim() || null,
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
                          return (
                            <div key={task.id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px", background: "var(--color-bg-primary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-primary)" }}>
                              <span style={{ fontSize: "9px", color: TASK_STATUS_STYLE[task.status].color, fontWeight: "500", flexShrink: 0 }}>{TASK_STATUS_LABEL[task.status]}</span>
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

                    {/* タスク追加：通常ビューと同じQuickAddTaskModalに統一（重複実装の解消） */}
                    <button onClick={() => openAddTask(todo.id)} style={{ ...ghostBtnStyle, fontSize: "11px" }}>＋ タスクを追加</button>
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

      {/* タスク追加モーダル（通常ビューと共通のQuickAddTaskModal。対象ToDo/TFを既定選択で渡す） */}
      {addingTaskForTodoId && (
        <QuickAddTaskModal
          currentUser={currentUser}
          projects={projects}
          defaultTfId={tfId}
          defaultTodoId={addingTaskForTodoId}
          onClose={() => setAddingTaskForTodoId(null)}
        />
      )}
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

function PJSection({ currentUser, onDirtyChange, selectedGroupId }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void; selectedGroupId: string }) {
  // 【2026-07-23】以前はアプリ全体のcurrentGroupId基準のselectScopedProjectsを使っていたが、
  // 設定画面はローカルの部署セレクタ（selectedGroupId）で独立に絞り込む方針に変更したため、
  // 未絞り込みの s.projects を素で取得し、下の useMemo で selectedGroupId により絞り込む。
  const rawProjects             = useAppStore(s => s.projects);
  const rawMembers              = useAppStore(s => s.members);
  const saveProject             = useAppStore(s => s.saveProject);
  const deleteProject           = useAppStore(s => s.deleteProject);
  const rawMilestones           = useAppStore(s => s.milestones);
  const saveMilestone           = useAppStore(s => s.saveMilestone);
  const deleteMilestone         = useAppStore(s => s.deleteMilestone);
  const rawTaskForces           = useAppStore(s => s.taskForces);
  const rawKeyResults           = useAppStore(s => s.keyResults);
  const rawObjectives           = useAppStore(s => s.objectives);
  const rawProjectTaskForces    = useAppStore(s => s.projectTaskForces);
  const addProjectTaskForce     = useAppStore(s => s.addProjectTaskForce);
  const removeProjectTaskForce  = useAppStore(s => s.removeProjectTaskForce);
  const isMobile = useIsMobile();
  const projects   = useMemo(
    () => active(rawProjects).filter(p => projectInGroup(p, selectedGroupId)),
    [rawProjects, selectedGroupId],
  );
  const members    = useMemo(
    () => active(rawMembers).filter(m => memberInGroup(m, selectedGroupId)),
    [rawMembers, selectedGroupId],
  );
  const milestones = useMemo(() => (rawMilestones ?? []).filter((ms: Milestone) => !ms.is_deleted), [rawMilestones]);
  const activeKeyResults = useMemo(() => active(rawKeyResults), [rawKeyResults]);
  const activeTaskForces = useMemo(() => active(rawTaskForces), [rawTaskForces]);
  // 「紐づける TF」ピッカーは、このセクションの他の絞り込み（projects/members）と同じく
  // 設定画面ローカルのselectedGroupIdでスコープする（v3.02。v2.94時点では未対応だった穴を埋める）。
  const keyResults = useMemo(
    () => keyResultsInGroup(activeKeyResults, rawObjectives, selectedGroupId),
    [activeKeyResults, rawObjectives, selectedGroupId],
  );
  const taskForces = useMemo(
    () => taskForcesInGroup(activeTaskForces, activeKeyResults, rawObjectives, selectedGroupId),
    [activeTaskForces, activeKeyResults, rawObjectives, selectedGroupId],
  );

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

  // 既に紐づいているTFが選択中部署（selectedGroupId）の外にある場合でも、チェックボックス表示
  // からは消さない（絞り込むのは新規に選べる選択肢のみという方針。TaskEditModal等と同じ考え方）。
  // form.tf_ids に含まれるが taskForces（部署絞り込み済み）に無いTF・その所属KRを補って含める。
  const taskForcesForPicker = useMemo(() => {
    const missingIds = form.tf_ids.filter(id => !taskForces.some(tf => tf.id === id));
    if (missingIds.length === 0) return taskForces;
    return [...taskForces, ...activeTaskForces.filter(tf => missingIds.includes(tf.id))];
  }, [taskForces, activeTaskForces, form.tf_ids]);
  const keyResultsForPicker = useMemo(() => {
    const missingKrIds = new Set(
      taskForcesForPicker.filter(tf => !keyResults.some(kr => kr.id === tf.kr_id)).map(tf => tf.kr_id),
    );
    if (missingKrIds.size === 0) return keyResults;
    return [...keyResults, ...activeKeyResults.filter(kr => missingKrIds.has(kr.id))];
  }, [keyResults, activeKeyResults, taskForcesForPicker]);

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
        // group_id は今見ている部署（selectedGroupId）を明示指定する。省略すると
        // appStore.saveProject がアプリ全体のcurrentGroupId（自分のホーム部署）で
        // 補完してしまい、他部署を見ながら追加したPJが自分の部署に紛れ込む事故になるため。
        await saveProject({ id: projectId, ...projectFields, owner_member_id, group_id: selectedGroupId || undefined, is_deleted: false, created_at: now, updated_at: now, updated_by: currentUser.id });
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
    setEditId(null);
  };

  const STATUS_LABELS: Record<Project["status"], string> = {
    active: "進行中", completed: "完了", archived: "アーカイブ",
  };

  const activeStatusCount = projects.filter(pj => pj.status === "active").length;

  return (
    <div style={{ maxWidth: "720px" }}>
      <SummaryRow>
        <SummaryTile label="PJ総数" value={projects.length} tone="accent" />
        <SummaryTile label="進行中" value={activeStatusCount} tone="success" />
      </SummaryRow>

      <Card
        title="プロジェクト一覧"
        badge={`${projects.length}件`}
        headerExtra={<button onClick={openAdd} style={addBtnStyle}>＋ 追加</button>}
      >
      {projects.length === 0 && (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "4px 0" }}>
          まだプロジェクトがありません。「＋ 追加」から作成してください。
        </div>
      )}
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
                PJの節目（例：β版リリース）の日付マーカー。ガントに <span style={{ color: "var(--color-signal-yellow)" }}>◆</span> で表示されます。
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
                      role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setEditingMs(ms); }}
                      title="クリックして編集（メモ・詳細）"
                      style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        padding: "4px 8px",
                        background: "var(--color-bg-primary)",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                      }}>
                      <span style={{ fontSize: "11px", color: "var(--color-signal-yellow)", flexShrink: 0 }}>◆</span>
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
      </Card>

      {/* マイルストーン編集モーダル（一覧の行クリックで開く） */}
      {editingMs && (
        <MilestoneEditModal
          milestone={editingMs}
          currentUser={currentUser}
          project={projects.find(p => p.id === editingMs.project_id) ?? null}
          onClose={() => setEditingMs(null)}
        />
      )}

      {/* 編集フォーム（既存PJをクリック→インライン表示。従来どおり） */}
      {editId && editId !== "new" && (
        <div style={{
          marginTop: "12px", padding: "16px",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "500", marginBottom: "12px", color: "var(--color-text-primary)" }}>
            プロジェクトを編集
          </div>
          <ProjectFormFields form={form} setForm={setForm} members={members} keyResults={keyResultsForPicker} taskForces={taskForcesForPicker} isMobile={isMobile} />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={save} style={primaryBtnStyle}
              disabled={!form.name.trim() || !form.purpose.trim()}>
              保存
            </button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>

          <DangerZone style={{ marginTop: "16px" }}>
            <DangerAction
              label="このプロジェクトを削除"
              description="紐づくタスクも一緒に削除されます。この操作は取り消せません。"
              onConfirm={() => deletePJ(editId)}
            />
          </DangerZone>
        </div>
      )}

      {/* 追加フォーム（マイルストーン追加と同じポップアップ形式・2026-07-23） */}
      {editId === "new" && (
        <AdminFormModal
          title="プロジェクトを追加"
          subtitle="新しいプロジェクトを登録します"
          onClose={() => setEditId(null)}
          maxWidth="640px"
        >
          <ProjectFormFields form={form} setForm={setForm} members={members} keyResults={keyResultsForPicker} taskForces={taskForcesForPicker} isMobile={isMobile} />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={save} style={primaryBtnStyle}
              disabled={!form.name.trim() || !form.purpose.trim()}>
              保存
            </button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>
        </AdminFormModal>
      )}
    </div>
  );
}

// PJ追加・編集フォームのフィールド一式（PJSectionの編集用インラインパネル／追加用モーダルの
// 両方から呼ばれる共通部品。バリデーション・保存は呼び出し元のPJSectionに一元化したまま、
// 見た目の器（インライン or モーダル）だけを分けるための抽出）
interface ProjectFormState {
  name: string; purpose: string; contribution_memo: string;
  owner_member_ids: string[]; member_ids: string[];
  status: Project["status"]; color_tag: string; start_date: string; end_date: string;
  tf_ids: string[];
}
function ProjectFormFields({ form, setForm, members, keyResults, taskForces, isMobile }: {
  form: ProjectFormState;
  setForm: React.Dispatch<React.SetStateAction<ProjectFormState>>;
  members: Member[];
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  isMobile: boolean;
}) {
  return (
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
  );
}

// ===================================================
// セクション④：メンバー
// ===================================================

function MembersSection({ currentUser, onDirtyChange, selectedGroupId }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void; selectedGroupId: string }) {
  const rawMembers   = useAppStore(s => s.members);
  const rawGroups    = useAppStore(s => s.groups);
  const saveMember   = useAppStore(s => s.saveMember);
  const deleteMember = useAppStore(s => s.deleteMember);
  const isMobile = useIsMobile();
  // members：組織全体のアクティブメンバー（「最後の管理者」保護などの判定はグループを問わず
  // 組織全体で行う必要があるため、こちらは絞り込まない）。
  // scopedMembers：一覧表示だけを選択中の部署に絞り込んだもの（設定画面の部署絞り込み・2026-07-23）。
  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const scopedMembers = useMemo(
    () => members.filter(m => memberInGroup(m, selectedGroupId)),
    [members, selectedGroupId],
  );
  const groups  = useMemo(() => rawGroups.filter(g => !g.is_deleted), [rawGroups]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    display_name: "", short_name: "", teams_account: "", email: "",
    color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)",
    group_id: "" as string,
    group_ids: [] as string[],
    is_admin: false,
    is_super_admin: false,
  });

  // 未保存変更を親に通知
  useEffect(() => {
    onDirtyChange(editId !== null);
  }, [editId, onDirtyChange]);

  const openAdd = () => {
    setEditId("new");
    const homeId = selectedGroupId || groups[0]?.id || "";
    setForm({ display_name: "", short_name: "", teams_account: "", email: "", color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)", group_id: homeId, group_ids: homeId ? [homeId] : [], is_admin: false, is_super_admin: false });
  };

  const openEdit = (m: Member) => {
    setEditId(m.id);
    const groupIds = m.group_ids?.length ? m.group_ids : (m.group_id ? [m.group_id] : []);
    setForm({ display_name: m.display_name, short_name: m.short_name, teams_account: m.teams_account, email: m.email ?? "", color_bg: m.color_bg, color_text: m.color_text, group_id: m.group_id ?? "", group_ids: groupIds, is_admin: m.is_admin ?? false, is_super_admin: m.is_super_admin ?? false });
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
      // ホーム部署は必ず group_ids に含める最終正規化（DBのCHECK制約 members_group_id_in_group_ids
      // 及びトリガー guard_member_privilege_columns の前提と一致させる）
      const groupIdsVal = groupIdVal && !form.group_ids.includes(groupIdVal)
        ? [...form.group_ids, groupIdVal]
        : form.group_ids;
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
          group_ids: groupIdsVal,
          color_bg: form.color_bg, color_text: form.color_text,
          is_admin: isAdminVal,
          is_super_admin: isSuperAdminVal,
          is_deleted: false,
          created_at: now, updated_at: now, updated_by: currentUser.id,
        });
      } else {
        const existing = members.find(m => m.id === editId);
        if (existing) await saveMember({ ...existing, ...form, email: emailVal, group_id: groupIdVal, group_ids: groupIdsVal, short_name: shortName, initials, is_admin: isAdminVal, is_super_admin: isSuperAdminVal, updated_by: currentUser.id });
      }
      setEditId(null);
    } catch (e) {
      const msg = isMemberEmailUniqueViolation(e)
        ? "このメールアドレスは既に別のメンバーに登録されています。同じ人を複数部署に所属させたい場合は、そのメンバーを編集して「アクセス可能な部署」に部署を追加してください。"
        : getErrorMessage(e);
      await alertDialog(`保存に失敗しました。\n${msg}`);
    }
  };

  const handleDeleteMember = async (id: string) => {
    if (id === currentUser.id) { await alertDialog("自分自身は削除できません。"); return; }
    // 不可逆・影響が大きい操作のため、確認ダイアログではなく対象名の再入力（DangerZone側）を
    // ガードとして使う。ここでの二重確認は行わない
    await deleteMember(id, currentUser.id);
    setEditId(null);
  };

  // サマリー・一覧は選択中の部署に絞り込んだ scopedMembers 基準
  // （「最後の管理者」保護など保存時の安全ロジックは members=組織全体で継続）
  const adminCount = scopedMembers.filter(m => m.is_admin === true).length;
  const superAdminCount = scopedMembers.filter(m => m.is_super_admin === true).length;

  return (
    <div style={{ maxWidth: "560px" }}>
      <SummaryRow>
        <SummaryTile label="総メンバー" value={scopedMembers.length} tone="accent" />
        <SummaryTile label="管理者" value={adminCount} tone="info" />
        <SummaryTile label="全社管理者" value={superAdminCount} tone="purple" />
        <SummaryTile label="所属部署" value={groups.length} tone="success" />
      </SummaryRow>

      <Card
        title="メンバー一覧"
        badge={`${scopedMembers.length}名`}
        headerExtra={<button onClick={openAdd} style={addBtnStyle}>＋ 追加</button>}
      >
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {scopedMembers.map(m => (
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
                  <span style={{ fontSize: "9px", marginLeft: "6px", color: "#fff", background: "var(--color-text-purple)", padding: "1px 6px", borderRadius: "3px" }}>
                    全社スーパー管理者
                  </span>
                )}
                {(m.group_ids?.length ?? 0) > 1 && (
                  <span style={{ fontSize: "9px", marginLeft: "6px", color: "var(--color-text-info)", background: "var(--color-bg-info)", padding: "1px 6px", borderRadius: "3px" }}>
                    兼務（{m.group_ids!.length}部署）
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
          </div>
        ))}
      </div>
      </Card>

      {/* 編集フォーム（既存メンバーをクリック→インライン表示。従来どおり） */}
      {editId && editId !== "new" && (
        <div style={{
          marginTop: "12px", padding: "14px", background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "500", marginBottom: "10px", color: "var(--color-text-primary)" }}>
            メンバーを編集
          </div>
          <MemberFormFields form={form} setForm={setForm} groups={groups} isMobile={isMobile} editId={editId} currentUser={currentUser} members={members} />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={save} disabled={!form.display_name.trim()} style={{
              ...primaryBtnStyle,
              opacity: form.display_name.trim() ? 1 : 0.4,
              cursor: form.display_name.trim() ? "pointer" : "not-allowed",
            }}>保存</button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>

          {editId !== currentUser.id ? (
            <DangerZone key={editId} style={{ marginTop: "16px" }}>
              <DangerAction
                label="このメンバーを削除"
                description="担当タスクは「未担当」になります。この操作は取り消せません。"
                requireNameMatch={members.find(m => m.id === editId)?.display_name ?? ""}
                onConfirm={() => handleDeleteMember(editId)}
              />
            </DangerZone>
          ) : (
            <div style={{ marginTop: "16px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
              自分自身は削除できません。
            </div>
          )}
        </div>
      )}

      {/* 追加フォーム（マイルストーン追加と同じポップアップ形式・2026-07-23） */}
      {editId === "new" && (
        <AdminFormModal
          title="メンバーを追加"
          subtitle="新しいメンバーを登録します"
          onClose={() => setEditId(null)}
        >
          <MemberFormFields form={form} setForm={setForm} groups={groups} isMobile={isMobile} editId={editId} currentUser={currentUser} members={members} />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={save} disabled={!form.display_name.trim()} style={{
              ...primaryBtnStyle,
              opacity: form.display_name.trim() ? 1 : 0.4,
              cursor: form.display_name.trim() ? "pointer" : "not-allowed",
            }}>保存</button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>
        </AdminFormModal>
      )}
    </div>
  );
}

// メンバーのアバターカラー選択肢（MemberFormFields専用）
const MEMBER_AVATAR_COLORS = [
  { bg: "var(--avatar-1-bg)", text: "var(--avatar-1-text)" },
  { bg: "var(--avatar-2-bg)", text: "var(--avatar-2-text)" },
  { bg: "var(--avatar-3-bg)", text: "var(--avatar-3-text)" },
  { bg: "var(--avatar-0-bg)", text: "var(--avatar-0-text)" },
  { bg: "var(--avatar-5-bg)", text: "var(--avatar-5-text)" },
  { bg: "var(--avatar-7-bg)", text: "var(--avatar-7-text)" },
];

// メンバー追加・編集フォームのフィールド一式（MembersSectionの編集用インラインパネル／
// 追加用モーダルの両方から呼ばれる共通部品。バリデーション・保存・「最後の管理者」保護判定は
// 呼び出し元のMembersSectionに一元化したまま、見た目の器だけを分けるための抽出）
interface MemberFormState {
  display_name: string; short_name: string; teams_account: string; email: string;
  color_bg: string; color_text: string; group_id: string; group_ids: string[];
  is_admin: boolean; is_super_admin: boolean;
}
function MemberFormFields({ form, setForm, groups, isMobile, editId, currentUser, members }: {
  form: MemberFormState;
  setForm: React.Dispatch<React.SetStateAction<MemberFormState>>;
  groups: Group[];
  isMobile: boolean;
  editId: string | null;
  currentUser: Member;
  members: Member[];
}) {
  return (
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
          <FieldLabel>グループ（任意・ホーム部署）</FieldLabel>
          <CustomSelect
            value={form.group_id}
            onChange={v => setForm(f => ({
              ...f,
              group_id: v,
              // ホーム部署を変えたら、必ずアクセス可能な部署にも含める（CHECK制約と一致させる）
              group_ids: v && !f.group_ids.includes(v) ? [...f.group_ids, v] : f.group_ids,
            }))}
            options={[
              { value: "", label: "（未設定）" },
              ...groups.map(g => ({ value: g.id, label: g.name })),
            ]}
          />
        </div>
      )}
      {groups.length > 0 && (
        <div>
          <FieldLabel>アクセス可能な部署（複数可）</FieldLabel>
          {currentUser.is_super_admin === true ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
                {form.group_ids.map(id => {
                  const g = groups.find(g => g.id === id);
                  if (!g) return null;
                  const isHome = id === form.group_id;
                  return (
                    <span key={id} style={{
                      display: "inline-flex", alignItems: "center", gap: "4px",
                      fontSize: "11px", padding: "2px 8px",
                      background: isHome ? "var(--color-brand-light)" : "var(--color-bg-tertiary)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-full)",
                    }}>
                      {g.name}
                      {isHome ? (
                        <span style={{ fontSize: "9px", color: "var(--color-brand)" }}>（ホーム）</span>
                      ) : (
                        <button onClick={() => setForm(f => ({ ...f, group_ids: f.group_ids.filter(i => i !== id) }))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0", lineHeight: 1, color: "var(--color-text-tertiary)" }}>×</button>
                      )}
                    </span>
                  );
                })}
              </div>
              <CustomSelect
                value=""
                onChange={id => {
                  if (id && !form.group_ids.includes(id))
                    setForm(f => ({ ...f, group_ids: [...f.group_ids, id] }));
                }}
                options={[
                  { value: "", label: "＋ 部署を追加" },
                  ...groups.filter(g => !form.group_ids.includes(g.id)).map(g => ({ value: g.id, label: g.name })),
                ]}
                searchable searchPlaceholder="部署で検索..."
              />
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                ホーム部署は必ず含まれ、外せません。兼務させたい部署をここに追加してください。
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {form.group_ids.length === 0 && (
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>（未設定）</span>
                )}
                {form.group_ids.map(id => {
                  const g = groups.find(g => g.id === id);
                  if (!g) return null;
                  const isHome = id === form.group_id;
                  return (
                    <span key={id} style={{
                      display: "inline-flex", alignItems: "center", gap: "4px",
                      fontSize: "11px", padding: "2px 8px",
                      background: isHome ? "var(--color-brand-light)" : "var(--color-bg-tertiary)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-full)",
                    }}>
                      {g.name}{isHome && <span style={{ fontSize: "9px", color: "var(--color-brand)" }}>（ホーム）</span>}
                    </span>
                  );
                })}
              </div>
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                複数部署の付与・変更は全社スーパー管理者のみ行えます。
              </div>
            </>
          )}
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
              style={{ width: 14, height: 14, accentColor: "var(--color-text-purple)", cursor: "pointer" }}
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
          {MEMBER_AVATAR_COLORS.map(c => (
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
  // ダウンロード後「次に何をすればいいか分からない」とならないよう、成功直後に手順ガイドを自動表示する
  const [showWebhookGuide, setShowWebhookGuide] = useState(false);

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
      setShowWebhookGuide(true);
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
    // 不可逆・影響が大きい操作（特にメンバーがいる部署の強制削除）のため、確認ダイアログではなく
    // 対象名の再入力（DangerZone側）をガードとして使う。ここでの二重確認は行わない
    try {
      await deleteGroup(g.id, currentUser.id);
      setEditId(null);
    } catch (e) {
      setError(formatErrorForUser("削除に失敗しました", e));
    }
  };

  const webhookConfiguredCount = groups.filter(g => !!g.teams_webhook_url).length;

  return (
    <div style={{ maxWidth: "560px" }}>
      <SummaryRow>
        <SummaryTile label="部署数" value={groups.length} tone="accent" />
        <SummaryTile label="Webhook設定済み" value={webhookConfiguredCount} tone="info" />
      </SummaryRow>

      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "14px" }}>
        グループ（部署）単位でデータが隔離されます（マルチテナント）。メンバーは1グループに属します。
        {!isSuperAdmin && "新規部署の作成は全社スーパー管理者のみ行えます。"}
      </div>

      {error && (
        <div style={{ fontSize: "11px", color: "var(--color-text-danger)", marginBottom: "8px" }}>
          {error}
        </div>
      )}

      {isSuperAdmin && (
        <Card title="全部署の概要" style={{ marginBottom: "16px" }}>
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
        </Card>
      )}

      <Card
        title="グループ一覧"
        badge={`${groups.length}件`}
        headerExtra={isSuperAdmin ? <button onClick={openAdd} style={addBtnStyle}>＋ 部署を追加</button> : undefined}
      >
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
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
                <IconBtn onClick={() => openEdit(g)}>✏</IconBtn>
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
      </Card>

      {editId && (
        <div style={{
          marginTop: "12px", padding: "14px", background: "var(--color-bg-secondary)",
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

          {editId !== "new" && (() => {
            const g = groups.find(x => x.id === editId);
            if (!g || !canManage(g)) return null;
            const memberCount = members.filter(m => m.group_id === g.id).length;
            const blocked = memberCount > 0 && !isSuperAdmin;
            return (
              <DangerZone key={editId} style={{ marginTop: "16px" }}>
                {blocked ? (
                  <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                    このグループには {memberCount} 名のメンバーがいます。メンバーのグループ変更後に削除してください。
                  </div>
                ) : (
                  <DangerAction
                    label={memberCount > 0 ? `このグループを強制削除（${memberCount}名が所属中）` : "このグループを削除"}
                    description={
                      memberCount > 0
                        ? "メンバーが所属したまま削除します（全社スーパー管理者のみ実行可）。この操作は取り消せません。"
                        : "この操作は取り消せません。"
                    }
                    buttonLabel={memberCount > 0 ? "強制削除する" : "削除する"}
                    requireNameMatch={g.name}
                    onConfirm={() => handleDelete(g)}
                  />
                )}
              </DangerZone>
            );
          })()}
        </div>
      )}
      {showWebhookGuide && (
        <GuideOverlay modeKey="admin.groups-webhook" onClose={() => setShowWebhookGuide(false)} />
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
/** 各セクションヘッダーの「＋ 追加」系ボタン（ブランド色の塗りつぶし・モックのトーン） */
const addBtnStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: "12px", fontWeight: "500",
  background: "var(--color-brand)", color: "#fff",
  border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
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

function TagsSection({ currentUser, onDirtyChange, selectedGroupId }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void; selectedGroupId: string }) {
  const memberTags         = useAppStore(s => s.memberTags);
  const memberTagMembers   = useAppStore(s => s.memberTagMembers);
  const allMembers         = useAppStore(s => s.members);
  const saveMemberTag      = useAppStore(s => s.saveMemberTag);
  const deleteMemberTag    = useAppStore(s => s.deleteMemberTag);

  // タグ自体（member_tags）は部署概念を持たない全社共通マスタのため一覧は絞り込まない
  // （2026-07-23のRLS是正でもこの方針は維持。詳細はCLAUDE.md参照）。
  // ただし新規作成・編集時のメンバー選択チェックボックスは、選択中の部署に絞ると
  // 一覧が探しやすくなるため scopedMembers を用意する。
  const activeTags    = useMemo(() => active(memberTags), [memberTags]);
  const activeMembers = useMemo(() => active(allMembers), [allMembers]);
  const scopedMembers = useMemo(
    () => activeMembers.filter(m => memberInGroup(m, selectedGroupId)),
    [activeMembers, selectedGroupId],
  );

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
      setEditingId(null);
    } catch (e) {
      setError(formatErrorForUser("タグ削除に失敗しました", e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <SummaryRow>
        <SummaryTile label="タグ数" value={activeTags.length} tone="accent" />
      </SummaryRow>

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

      {/* 編集フォーム（既存タグをクリック→インライン表示。従来どおり） */}
      {editingId !== null && !isCreating && (
        <div style={{
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)", padding: "14px 16px",
          display: "flex", flexDirection: "column", gap: "10px",
        }}>
          <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>
            タグを編集
          </div>
          <TagFormFields draftName={draftName} setDraftName={setDraftName} draftDesc={draftDesc} setDraftDesc={setDraftDesc}
            draftMemberIds={draftMemberIds} toggleMember={toggleMember} setDraftMemberIds={setDraftMemberIds} members={scopedMembers} />
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
            >保存する</button>
          </div>

          {(() => {
            const tag = activeTags.find(t => t.id === editingId);
            if (!tag) return null;
            const memberCount = tagMembersMap.get(tag.id)?.length ?? 0;
            return (
              <DangerZone key={editingId} style={{ marginTop: "4px" }}>
                <DangerAction
                  label="このタグを削除"
                  description={`${memberCount}名のメンバー紐付けは残ります（タグ自体が論理削除されます）。`}
                  onConfirm={() => handleDelete(tag)}
                />
              </DangerZone>
            );
          })()}
        </div>
      )}

      {/* 追加フォーム（マイルストーン追加と同じポップアップ形式・2026-07-23） */}
      {isCreating && (
        <AdminFormModal title="タグを追加" subtitle="メンバーをまとめるタグを作成します" onClose={cancel}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <TagFormFields draftName={draftName} setDraftName={setDraftName} draftDesc={draftDesc} setDraftDesc={setDraftDesc}
              draftMemberIds={draftMemberIds} toggleMember={toggleMember} setDraftMemberIds={setDraftMemberIds} members={scopedMembers} />
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
              >追加する</button>
            </div>
          </div>
        </AdminFormModal>
      )}

      {/* 既存タグリスト */}
      <Card
        title="タグ一覧"
        badge={`${activeTags.length}件`}
        headerExtra={
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {saved && (
              <span style={{ fontSize: "11px", color: "var(--color-text-success)" }}>保存しました</span>
            )}
            {!isDirty && (
              <button onClick={startNew} style={addBtnStyle}>＋ タグを追加</button>
            )}
          </div>
        }
      >
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
              </div>
            );
          })}
        </div>
      )}
      </Card>
    </div>
  );
}

// タグ追加・編集フォームのフィールド一式（TagsSectionの編集用インラインパネル／追加用モーダルの
// 両方から呼ばれる共通部品。バリデーション・保存は呼び出し元のTagsSectionに一元化したまま、
// 見た目の器だけを分けるための抽出）
function TagFormFields({ draftName, setDraftName, draftDesc, setDraftDesc, draftMemberIds, toggleMember, setDraftMemberIds, members }: {
  draftName: string; setDraftName: (v: string) => void;
  draftDesc: string; setDraftDesc: (v: string) => void;
  draftMemberIds: string[]; toggleMember: (id: string) => void; setDraftMemberIds: (ids: string[]) => void;
  members: Member[];
}) {
  return (
    <>
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
          {members.map(m => {
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
            onClick={() => setDraftMemberIds(members.map(m => m.id))}
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
    </>
  );
}

function AIUsageSection({ selectedGroupId }: { selectedGroupId: string }) {
  const members = useAppStore(s => s.members);
  // ログ自体は部署を持たない（ai_usage_logsはmember_id経由でRLSが部署判定する）ため、
  // クライアント側で「そのログを打ったメンバーが選択中の部署に属するか」でフィルタする。
  const scopedMemberIds = useMemo(
    () => new Set(members.filter(m => memberInGroup(m, selectedGroupId)).map(m => m.id)),
    [members, selectedGroupId],
  );

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

  // 選択中の部署のメンバーによるログのみに絞り込む（設定画面の部署絞り込み・2026-07-23）
  const scopedLogs = useMemo(
    () => logs.filter(l => scopedMemberIds.has(l.member_id ?? "")),
    [logs, scopedMemberIds],
  );

  // 月ごとに集計
  const monthlyData = useMemo(() => {
    const map = new Map<string, AiUsageLog[]>();
    for (const log of scopedLogs) {
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
  }, [scopedLogs]);

  // メンバー別内訳（今月）：最新月（=monthlyData 先頭）or 現在の YYYY-MM のログを member_id で集計。
  const memberBreakdown = useMemo(() => {
    // monthlyData は月降順ソート済み。先頭が最新月。無ければ現在の YYYY-MM。
    const targetMonth = monthlyData[0]?.month ?? new Date().toISOString().slice(0, 7);
    const monthLogs = scopedLogs.filter(l => (l.called_at ?? "").slice(0, 7) === targetMonth);
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
  }, [scopedLogs, monthlyData, members]);

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
        設定画面で選択中の部署のメンバーの使用量です。約30秒ごとに自動更新します。
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
