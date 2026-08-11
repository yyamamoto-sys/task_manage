// src/components/project/ProjectSettingsModal.tsx
//
// 【設計意図】
// PJダッシュボード（ProjectKarte）から開く「⚙ このPJの設定」。PJごとに増えてきた管理項目
// （基本情報の編集・招待の発行/一覧/取り消し・関わるメンバーの把握）をここに集約する。
// CLAUDE.md Section 8参照：AdminView の「作業設定→PJ」タブ（部署横断の一覧編集・全ステータス
// 対象）は残す。こちらは「今見ているPJ1件」に絞った、日常的な操作の入口という役割分担。
//
// 【権限】既存の権限モデルを広げない。AdminViewのPJ編集は
// 「部署管理者(is_admin) or 全社スーパー管理者(is_super_admin)。ただし部署内にis_adminが
// 1人もいなければブートストラップとして全員編集可」というガードなので、この画面の
// 「基本情報」タブの編集可否も同じ条件にする（canEditBasicInfo）。編集不可の場合は
// 入力欄ではなく読み取り表示にする。
// 招待の発行は「全メンバー可」（CLAUDE.md Section 25・決定事項）でこの画面でも変えない。
// 「関わるメンバー」タブは常に読み取り専用（そもそも編集対象が無い）。
//
// 【新しいテーブルは作らない】project_members のような紐づけテーブルは作らず、
// オーナー・タスク担当者・招待用部署のメンバー、の3種の既存データから
// lib/project/projectMembers.ts の純粋関数で組み立てる。
//
// 【Section 21】中央寄せモーダルなので modalStyles.ts の契約に従う。

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAppStore, selectScopedTasks } from "../../stores/appStore";
import type { Member, Project, ProjectInvite } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { getAssigneeIds } from "../../lib/taskMeta";
import { computeProjectMembers, type ProjectMemberRole } from "../../lib/project/projectMembers";
import { CustomSelect } from "../common/CustomSelect";
import { Avatar } from "../auth/UserSelectScreen";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";
import { formatErrorForUser } from "../../lib/errorMessage";
import { confirmDialog, alertDialog } from "../../lib/dialog";
import { isGuestMember } from "../../lib/guestMode";
import {
  fetchProjectInvites, revokeProjectInvite, createProjectInvite,
} from "../../lib/supabase/projectInviteStore";
import { resolveInviteStatus, PROJECT_INVITE_STATUS_LABEL, type ProjectInviteStatus } from "../../lib/projectInvite/inviteStatus";
import { buildInviteLink } from "../../lib/projectInvite/inviteUrl";

interface Props {
  project: Project;
  currentUser: Member;
  onClose: () => void;
}

type SettingsTab = "basic" | "invite" | "members";

const STATUS_LABELS: Record<Project["status"], string> = {
  active: "進行中", completed: "完了", archived: "アーカイブ",
};

const ROLE_LABEL: Record<ProjectMemberRole, string> = {
  owner: "オーナー",
  assignee: "タスク担当",
  invited: "招待",
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 9px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  fontSize: "12px", boxSizing: "border-box", outline: "none",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
};

const ghostBtn: React.CSSProperties = {
  padding: "7px 14px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer",
};

const brandBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "7px 16px", fontSize: "12px", fontWeight: 600,
  border: "none", borderRadius: "var(--radius-md)",
  background: disabled ? "var(--color-text-tertiary)" : "var(--color-brand)",
  color: "#fff", cursor: disabled ? "not-allowed" : "pointer",
});

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>{children}</div>;
}

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "12px", color: "var(--color-text-primary)", padding: "6px 0" }}>{children}</div>;
}

function TabButton({ active: isActive, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: "12px", padding: "6px 14px", borderRadius: "var(--radius-full)",
        border: isActive ? "1px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
        background: isActive ? "var(--color-brand-light)" : "transparent",
        color: isActive ? "var(--color-brand)" : "var(--color-text-secondary)",
        cursor: "pointer", fontWeight: isActive ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

export function ProjectSettingsModal({ project, currentUser, onClose }: Props) {
  const rawMembers = useAppStore(s => s.members);
  const rawTasks = useAppStore(selectScopedTasks);
  const rawTpjs = useAppStore(s => s.taskProjects);
  const saveProject = useAppStore(s => s.saveProject);
  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const isGuest = isGuestMember(currentUser);

  const [tab, setTab] = useState<SettingsTab>("basic");

  // ===== 権限：AdminViewのPJ編集と同じ条件（Section 8参照） =====
  const activeAdmins = useMemo(() => active(rawMembers).filter(m => m.is_admin === true), [rawMembers]);
  const canEditBasicInfo = currentUser.is_admin === true || currentUser.is_super_admin === true || activeAdmins.length === 0;

  // ===== 基本情報フォーム =====
  const [form, setForm] = useState({
    name: project.name,
    purpose: project.purpose ?? "",
    contribution_memo: project.contribution_memo ?? "",
    owner_member_ids: project.owner_member_ids?.length ? project.owner_member_ids : (project.owner_member_id ? [project.owner_member_id] : []),
    status: project.status,
    color_tag: project.color_tag,
    start_date: project.start_date ?? "",
    end_date: project.end_date ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const dirty = useMemo(() => (
    form.name !== project.name
    || form.purpose !== (project.purpose ?? "")
    || form.contribution_memo !== (project.contribution_memo ?? "")
    || form.status !== project.status
    || form.color_tag !== project.color_tag
    || form.start_date !== (project.start_date ?? "")
    || form.end_date !== (project.end_date ?? "")
    || JSON.stringify(form.owner_member_ids) !== JSON.stringify(project.owner_member_ids?.length ? project.owner_member_ids : (project.owner_member_id ? [project.owner_member_id] : []))
  ), [form, project]);

  const saveBasicInfo = useCallback(async () => {
    if (!canEditBasicInfo || saving) return;
    if (!form.name.trim() || !form.purpose.trim()) {
      setSaveError("PJ名と目的は必須です。");
      return;
    }
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      setSaveError("開始日は終了日より前に設定してください。");
      return;
    }
    if (form.owner_member_ids.length === 0) {
      setSaveError("オーナーを1名以上選択してください。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveProject({
        ...project,
        name: form.name.trim(),
        purpose: form.purpose.trim(),
        contribution_memo: form.contribution_memo,
        owner_member_ids: form.owner_member_ids,
        owner_member_id: form.owner_member_ids[0],
        status: form.status,
        color_tag: form.color_tag,
        start_date: form.start_date,
        end_date: form.end_date,
        updated_by: currentUser.id,
      });
    } catch (e) {
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [canEditBasicInfo, saving, form, project, saveProject, currentUser.id]);

  // 「1クリックでアーカイブ」：フォームの下書き（未保存の編集）を巻き込まず、常に現在の
  // project（正本）を元にstatusだけを変える。他の下書き中フィールドを誤って一緒に
  // 保存してしまわないようにするための判断。
  const quickSetStatus = useCallback(async (nextStatus: Project["status"]) => {
    if (!canEditBasicInfo || archiving) return;
    const label = STATUS_LABELS[nextStatus];
    if (!await confirmDialog(`「${project.name}」を${label}にしますか？`)) return;
    setArchiving(true);
    try {
      await saveProject({ ...project, status: nextStatus, updated_by: currentUser.id });
      setForm(f => ({ ...f, status: nextStatus }));
    } catch (e) {
      await alertDialog(formatErrorForUser("更新に失敗しました", e));
    } finally {
      setArchiving(false);
    }
  }, [canEditBasicInfo, archiving, project, saveProject, currentUser.id]);

  // ===== 招待（発行・一覧・取り消し） =====
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteIssuing, setInviteIssuing] = useState(false);
  const [inviteIssueError, setInviteIssueError] = useState("");
  const [inviteResult, setInviteResult] = useState<{ code: string; link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const reloadInvites = useCallback(async () => {
    try {
      const data = await fetchProjectInvites(project.id);
      setInvites(data);
      setInvitesError(null);
    } catch (e) {
      setInvitesError(formatErrorForUser("招待一覧の取得に失敗しました", e));
    } finally {
      setInvitesLoading(false);
    }
  }, [project.id]);

  useEffect(() => { if (!isGuest) void reloadInvites(); else setInvitesLoading(false); }, [reloadInvites, isGuest]);

  const submitInvite = async () => {
    if (!inviteEmail.trim() || inviteIssuing) return;
    setInviteIssuing(true);
    setInviteIssueError("");
    try {
      const res = await createProjectInvite(project.id, inviteEmail.trim());
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      setInviteResult({ code: res.code, link: buildInviteLink(baseUrl, res.code), expiresAt: res.expiresAt });
      await reloadInvites();
    } catch (e) {
      setInviteIssueError(formatErrorForUser("招待の発行に失敗しました", e));
    } finally {
      setInviteIssuing(false);
    }
  };

  const copyInvite = (text: string, which: "code" | "link") => {
    void navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleRevoke = async (invite: ProjectInvite) => {
    if (!await confirmDialog(`招待（${invite.invited_email}）を取り消しますか？`)) return;
    setRevokingId(invite.id);
    try {
      await revokeProjectInvite(invite.id);
      await reloadInvites();
    } catch (e) {
      await alertDialog(formatErrorForUser("招待の取り消しに失敗しました", e));
    } finally {
      setRevokingId(null);
    }
  };

  const inviteStatusStyle: Record<ProjectInviteStatus, React.CSSProperties> = {
    unused:  { color: "var(--color-text-info)",    background: "var(--color-bg-info)",    border: "1px solid var(--color-border-info)" },
    used:    { color: "var(--color-text-secondary)", background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border-primary)" },
    expired: { color: "var(--color-text-warning)", background: "var(--color-bg-warning)", border: "1px solid var(--color-border-warning)" },
    revoked: { color: "var(--color-text-danger)",  background: "var(--color-bg-danger)",  border: "1px solid var(--color-border-danger)" },
  };

  // ===== このPJに関わるメンバー =====
  const pjTasks = useMemo(() => {
    const secondaryTaskIds = new Set(rawTpjs.filter(tp => tp.project_id === project.id).map(tp => tp.task_id));
    return rawTasks.filter(t => !t.is_deleted && (t.project_id === project.id || secondaryTaskIds.has(t.id)));
  }, [rawTasks, rawTpjs, project.id]);

  const assigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of pjTasks) for (const id of getAssigneeIds(t)) ids.add(id);
    return [...ids];
  }, [pjTasks]);

  const ownerIds = useMemo(
    () => (project.owner_member_ids?.length ? project.owner_member_ids : [project.owner_member_id]),
    [project.owner_member_ids, project.owner_member_id],
  );

  // 招待用部署のidは project_invites の実データから読む（'grp-invite-'+idの文字列組み立てを
  // フロントに複製しない。1件も招待が無いPJではそもそも招待用部署が存在しないため null のままでよい）
  const inviteGroupId = invites[0]?.invite_group_id ?? null;

  const memberRows = useMemo(
    () => computeProjectMembers(members, { ownerIds, assigneeIds, inviteGroupId }),
    [members, ownerIds, assigneeIds, inviteGroupId],
  );

  return (
    <div style={{ ...modalOverlayStyle(400), background: "rgba(0,0,0,0.45)" }}>
      <div style={{
        ...modalBoxStyle("min(640px, 100%)"),
        background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "10px" }}>
            ⚙ 「{project.name}」の設定
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <TabButton active={tab === "basic"} onClick={() => setTab("basic")}>基本情報</TabButton>
            {!isGuest && <TabButton active={tab === "invite"} onClick={() => setTab("invite")}>招待</TabButton>}
            <TabButton active={tab === "members"} onClick={() => setTab("members")}>関わるメンバー</TabButton>
          </div>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "18px 20px" }}>
          {tab === "basic" && (
            <div>
              {!canEditBasicInfo && (
                <div style={{
                  fontSize: "11px", color: "var(--color-text-tertiary)", padding: "6px 10px", marginBottom: "12px",
                  background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)",
                }}>
                  基本情報の編集は部署管理者・全社スーパー管理者のみ可能です。ここでは内容の確認のみできます。
                </div>
              )}

              {canEditBasicInfo ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <FieldLabel>PJ名 *</FieldLabel>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={100} style={fieldInputStyle} />
                  </div>
                  <div>
                    <FieldLabel>目的 *</FieldLabel>
                    <input value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} maxLength={200} style={fieldInputStyle} />
                  </div>
                  <div>
                    <FieldLabel>貢献メモ（KRとの関連）</FieldLabel>
                    <textarea value={form.contribution_memo} onChange={e => setForm(f => ({ ...f, contribution_memo: e.target.value }))}
                      maxLength={500} rows={2} style={{ ...fieldInputStyle, resize: "vertical" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <FieldLabel>オーナー</FieldLabel>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
                        {form.owner_member_ids.map(id => {
                          const m = members.find(m => m.id === id);
                          if (!m) return null;
                          return (
                            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", padding: "2px 8px", background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-full)" }}>
                              {m.short_name}
                              <button onClick={() => setForm(f => ({ ...f, owner_member_ids: f.owner_member_ids.filter(i => i !== id) }))}
                                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "var(--color-text-tertiary)" }}>×</button>
                            </span>
                          );
                        })}
                      </div>
                      <CustomSelect
                        value=""
                        onChange={id => { if (id && !form.owner_member_ids.includes(id)) setForm(f => ({ ...f, owner_member_ids: [...f.owner_member_ids, id] })); }}
                        options={[
                          { value: "", label: "＋ オーナーを追加" },
                          ...members.filter(m => !form.owner_member_ids.includes(m.id)).map(m => ({ value: m.id, label: m.display_name })),
                        ]}
                        searchable searchPlaceholder="メンバーで検索..."
                      />
                    </div>
                    <div>
                      <FieldLabel>ステータス</FieldLabel>
                      <CustomSelect value={form.status} onChange={value => setForm(f => ({ ...f, status: value as Project["status"] }))}
                        options={[
                          { value: "active", label: "進行中" },
                          { value: "completed", label: "完了" },
                          { value: "archived", label: "アーカイブ" },
                        ]} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                    <div>
                      <FieldLabel>開始日</FieldLabel>
                      <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={fieldInputStyle} />
                    </div>
                    <div>
                      <FieldLabel>終了日</FieldLabel>
                      <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} style={fieldInputStyle} />
                    </div>
                    <div>
                      <FieldLabel>カラー</FieldLabel>
                      <input type="color" value={form.color_tag} onChange={e => setForm(f => ({ ...f, color_tag: e.target.value }))}
                        style={{ ...fieldInputStyle, padding: "2px", height: "31px", cursor: "pointer" }} />
                    </div>
                  </div>

                  {saveError && <div style={{ fontSize: "12px", color: "var(--color-text-danger)" }}>{saveError}</div>}

                  <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    <button onClick={() => void saveBasicInfo()} disabled={saving || !dirty} style={brandBtn(saving || !dirty)}>
                      {saving ? "保存中..." : "保存"}
                    </button>
                  </div>

                  <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--color-border-primary)" }}>
                    <FieldLabel>クイック操作</FieldLabel>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {project.status !== "completed" && (
                        <button onClick={() => void quickSetStatus("completed")} disabled={archiving} style={ghostBtn}>
                          ✅ このPJを完了にする
                        </button>
                      )}
                      {project.status !== "archived" && (
                        <button onClick={() => void quickSetStatus("archived")} disabled={archiving} style={ghostBtn}>
                          🗄 このPJをアーカイブする
                        </button>
                      )}
                      {project.status === "archived" && (
                        <button onClick={() => void quickSetStatus("active")} disabled={archiving} style={ghostBtn}>
                          ↩ 進行中に戻す
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "6px", lineHeight: 1.6 }}>
                      完了・アーカイブのどちらも、サイドバーの一覧から既定で隠れます（「完了・アーカイブも表示」トグルでいつでも再表示できます）。
                    </p>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <FieldLabel>PJ名</FieldLabel>
                  <ReadOnlyValue>{project.name}</ReadOnlyValue>
                  <FieldLabel>目的</FieldLabel>
                  <ReadOnlyValue>{project.purpose || "—"}</ReadOnlyValue>
                  <FieldLabel>貢献メモ</FieldLabel>
                  <ReadOnlyValue>{project.contribution_memo || "—"}</ReadOnlyValue>
                  <FieldLabel>オーナー</FieldLabel>
                  <ReadOnlyValue>{ownerIds.map(id => members.find(m => m.id === id)?.display_name).filter(Boolean).join("、") || "未設定"}</ReadOnlyValue>
                  <FieldLabel>期間</FieldLabel>
                  <ReadOnlyValue>{project.start_date || "—"} 〜 {project.end_date || "—"}</ReadOnlyValue>
                  <FieldLabel>ステータス</FieldLabel>
                  <ReadOnlyValue>{STATUS_LABELS[project.status]}</ReadOnlyValue>
                </div>
              )}
            </div>
          )}

          {tab === "invite" && !isGuest && (
            <div>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.7, marginBottom: "14px" }}>
                社内の別部署の人をこのPJに招待します。メールアドレスを入力してください（有効期限：発行から24時間）。
              </p>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <input
                  type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="example@amita-net.co.jp" style={{ ...fieldInputStyle, flex: 1 }}
                />
                <button onClick={() => void submitInvite()} disabled={inviteIssuing || !inviteEmail.trim()} style={brandBtn(inviteIssuing || !inviteEmail.trim())}>
                  {inviteIssuing ? "発行中..." : "招待を発行"}
                </button>
              </div>
              {inviteIssueError && <p style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "12px" }}>{inviteIssueError}</p>}

              {inviteResult && (
                <div style={{
                  padding: "10px 12px", marginBottom: "16px",
                  background: "var(--color-bg-warning)", border: "1px solid var(--color-border-warning)",
                  borderRadius: "var(--radius-md)", fontSize: "12px", color: "var(--color-text-warning)", lineHeight: 1.6,
                }}>
                  <div style={{ marginBottom: "8px" }}>⚠ このコード・リンクは今だけ表示されます。必ずコピーしてください。</div>
                  <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
                    <input readOnly value={inviteResult.link} onFocus={e => e.target.select()} style={{ ...fieldInputStyle, flex: 1, fontSize: "11px", background: "var(--color-bg-secondary)" }} />
                    <button type="button" onClick={() => copyInvite(inviteResult.link, "link")} style={{ ...ghostBtn, whiteSpace: "nowrap" }}>
                      {copied === "link" ? "コピーしました" : "コピー"}
                    </button>
                  </div>
                </div>
              )}

              <FieldLabel>このPJへの招待一覧</FieldLabel>
              {invitesLoading && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>読み込み中...</div>}
              {invitesError && <div style={{ fontSize: "12px", color: "var(--color-text-danger)" }}>{invitesError}</div>}
              {!invitesLoading && !invitesError && invites.length === 0 && (
                <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>まだ招待はありません。</div>
              )}
              {!invitesLoading && invites.length > 0 && (
                <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                  {invites.map(inv => {
                    const status = resolveInviteStatus(inv);
                    return (
                      <div key={inv.id} style={{
                        display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px",
                        fontSize: "11px", borderBottom: "1px solid var(--color-border-primary)",
                      }}>
                        <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.invited_email}</div>
                        <div style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                          {inv.created_at ? new Date(inv.created_at).toLocaleDateString("ja-JP") : "—"}
                        </div>
                        <span style={{ ...inviteStatusStyle[status], fontSize: "10px", padding: "2px 8px", borderRadius: "99px", whiteSpace: "nowrap", flexShrink: 0 }}>
                          {PROJECT_INVITE_STATUS_LABEL[status]}
                        </span>
                        {status === "unused" && (
                          <button
                            onClick={() => void handleRevoke(inv)} disabled={revokingId === inv.id}
                            style={{ fontSize: "10px", padding: "3px 8px", border: "1px solid var(--color-border-danger)", borderRadius: "var(--radius-md)", background: "transparent", color: "var(--color-text-danger)", cursor: revokingId === inv.id ? "not-allowed" : "pointer", flexShrink: 0 }}
                          >
                            {revokingId === inv.id ? "処理中..." : "取り消し"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "members" && (
            <div>
              <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "10px", lineHeight: 1.6 }}>
                オーナー・タスクの担当者・このPJへの招待で参加しているメンバーの一覧です（読み取り専用）。
              </p>
              {memberRows.length === 0 && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>まだ誰も関わっていません。</div>}
              {memberRows.map(({ member, roles }) => (
                <div key={member.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "1px solid var(--color-border-primary)" }}>
                  <Avatar member={member} size={20} />
                  <span style={{ fontSize: "12px", color: "var(--color-text-primary)", flex: 1 }}>{member.display_name}</span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {roles.map(r => (
                      <span key={r} style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)" }}>
                        {ROLE_LABEL[r]}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...MODAL_FOOTER_STYLE, padding: "12px 20px", borderTop: "1px solid var(--color-border-primary)", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={ghostBtn}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
