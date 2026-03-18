// src/components/admin/AdminView.tsx
//
// 【設計意図】
// 管理画面。OKR/KR・Task Force・PJ・メンバーの4セクションを管理する。
// 全員が編集可（管理者権限なし）。
// 変更はlocalStoreに即時反映。

import { useState, useMemo, useCallback, useEffect } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  Member, Objective, KeyResult, TaskForce, Project,
} from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { confirmDialog, alertDialog } from "../../lib/dialog";
import { v4 as uuidv4 } from "uuid";

type AdminTab = "okr" | "tf" | "pj" | "members";

interface Props { currentUser: Member; }

// ===== ルートコンポーネント =====

export function AdminView({ currentUser }: Props) {
  const [tab, setTab] = useState<AdminTab>("okr");

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "okr",     label: "Objective / KR" },
    { key: "tf",      label: "Task Force" },
    { key: "pj",      label: "プロジェクト" },
    { key: "members", label: "メンバー" },
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
              onClick={() => setTab(t.key)}
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
        {tab === "okr"     && <OKRSection currentUser={currentUser} />}
        {tab === "tf"      && <TFSection currentUser={currentUser} />}
        {tab === "pj"      && <PJSection currentUser={currentUser} />}
        {tab === "members" && <MembersSection currentUser={currentUser} />}
      </div>
    </div>
  );
}

// ===================================================
// セクション①：Objective / KR
// ===================================================

function OKRSection({ currentUser }: { currentUser: Member }) {
  const { objective: ctxObj, keyResults: rawKrs, saveObjective, saveKeyResult, deleteKeyResult } = useAppData();
  const krs = useMemo(() => rawKrs.filter(k => !k.is_deleted), [rawKrs]);

  const [editingKrId, setEditingKrId] = useState<string | null>(null);
  const [newKrTitle, setNewKrTitle] = useState("");
  const [objTitle, setObjTitle] = useState(ctxObj?.title ?? "");
  const [saved, setSaved] = useState(false);

  // ctxObj がロード後に反映
  useEffect(() => {
    if (ctxObj?.title) setObjTitle(t => t || ctxObj.title);
  }, [ctxObj]);

  const flashSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const saveObj = () => {
    const updated: Objective = {
      id: ctxObj?.id ?? uuidv4(),
      title: objTitle,
      period: ctxObj?.period ?? "2026年度",
      is_current: true,
    };
    saveObjective(updated);
    flashSaved();
  };

  const addKr = () => {
    if (!newKrTitle.trim()) return;
    const kr: KeyResult = {
      id: uuidv4(),
      objective_id: ctxObj?.id ?? "",
      title: newKrTitle.trim(),
      is_deleted: false,
    };
    saveKeyResult(kr);
    setNewKrTitle("");
  };

  const updateKr = (id: string, title: string) => {
    const existing = krs.find(k => k.id === id);
    if (existing) saveKeyResult({ ...existing, title });
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
        <FieldLabel>Objective（O）</FieldLabel>
        <div style={{ display: "flex", gap: "8px" }}>
          <textarea
            value={objTitle}
            onChange={e => setObjTitle(e.target.value)}
            rows={2}
            maxLength={200}
            style={{ ...inputStyle, flex: 1, resize: "vertical" }}
            placeholder="Objectiveのタイトルを入力"
          />
          <button
            onClick={saveObj}
            style={{
              ...primaryBtnStyle,
              alignSelf: "flex-end",
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
// セクション②：Task Force
// ===================================================

function TFSection({ currentUser }: { currentUser: Member }) {
  const { taskForces: rawTfs, keyResults: rawKrs, members: rawMembers, saveTaskForce, deleteTaskForce } = useAppData();
  const isMobile = useIsMobile();
  const tfs     = useMemo(() => rawTfs.filter(t => !t.is_deleted), [rawTfs]);
  const krs     = useMemo(() => rawKrs.filter(k => !k.is_deleted), [rawKrs]);
  const members = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ kr_id: "", tf_number: "", name: "", leader_member_id: "" });

  const openAdd = () => {
    setEditId("new");
    setForm({ kr_id: krs[0]?.id ?? "", tf_number: "", name: "", leader_member_id: members[0]?.id ?? "" });
  };

  const openEdit = (tf: TaskForce) => {
    setEditId(tf.id);
    setForm({ kr_id: tf.kr_id, tf_number: tf.tf_number, name: tf.name, leader_member_id: tf.leader_member_id });
  };

  const save = () => {
    if (!form.name.trim()) return;
    if (editId === "new") {
      saveTaskForce({ id: uuidv4(), ...form, is_deleted: false });
    } else {
      const existing = tfs.find(t => t.id === editId);
      if (existing) saveTaskForce({ ...existing, ...form });
    }
    setEditId(null);
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
              onEdit={() => openEdit(tf)} onDelete={() => deleteTF(tf.id)} />
          ))}
        </div>
      ))}
      {orphans.map(tf => (
        <TFRow key={tf.id} tf={tf} members={members}
          onEdit={() => openEdit(tf)} onDelete={() => deleteTF(tf.id)} />
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
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={save} style={primaryBtnStyle}>保存</button>
            <button onClick={() => setEditId(null)} style={ghostBtnStyle}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TFRow({ tf, members, onEdit, onDelete }: {
  tf: TaskForce; members: Member[];
  onEdit: () => void; onDelete: () => void;
}) {
  const leader = members.find(m => m.id === tf.leader_member_id);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px",
      padding: "7px 10px", marginBottom: "4px",
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-md)",
    }}>
      <span style={{
        fontSize: "10px", padding: "1px 7px", borderRadius: "3px",
        background: "var(--color-brand-light)", color: "var(--color-text-purple)",
        border: "1px solid var(--color-brand-border)", flexShrink: 0,
      }}>{tf.tf_number}</span>
      <span style={{ fontSize: "12px", flex: 1, color: "var(--color-text-primary)" }}>{tf.name}</span>
      {leader && <Avatar member={leader} size={18} />}
      <IconBtn onClick={onEdit}>✏</IconBtn>
      <IconBtn danger onClick={onDelete}>✕</IconBtn>
    </div>
  );
}

// ===================================================
// セクション③：プロジェクト
// ===================================================

function PJSection({ currentUser }: { currentUser: Member }) {
  const { projects: rawProjects, members: rawMembers, saveProject, deleteProject } = useAppData();
  const isMobile = useIsMobile();
  const projects = useMemo(() => rawProjects.filter(p => !p.is_deleted), [rawProjects]);
  const members  = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", purpose: "", contribution_memo: "",
    owner_member_id: "", status: "active" as Project["status"],
    color_tag: "#7F77DD", start_date: "", end_date: "",
  });

  const openAdd = () => {
    setEditId("new");
    setForm({
      name: "", purpose: "", contribution_memo: "",
      owner_member_id: members[0]?.id ?? "",
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
      owner_member_id: pj.owner_member_id, status: pj.status,
      color_tag: pj.color_tag, start_date: pj.start_date, end_date: pj.end_date,
    });
  };

  const save = () => {
    if (!form.name.trim() || !form.purpose.trim()) return;
    if (editId === "new") {
      saveProject({ id: uuidv4(), ...form, is_deleted: false });
    } else {
      const existing = projects.find(p => p.id === editId);
      if (existing) saveProject({ ...existing, ...form });
    }
    setEditId(null);
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
        const owner = members.find(m => m.id === pj.owner_member_id);
        return (
          <div key={pj.id} style={{
            display: "flex", alignItems: "flex-start", gap: "10px",
            padding: "10px 12px", marginBottom: "6px",
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
            {owner && <Avatar member={owner} size={20} />}
            <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
              <IconBtn onClick={() => openEdit(pj)}>✏</IconBtn>
              <IconBtn danger onClick={() => deletePJ(pj.id)}>✕</IconBtn>
            </div>
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
                style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <div>
                <FieldLabel>オーナー</FieldLabel>
                <select value={form.owner_member_id} onChange={e => setForm(f => ({...f, owner_member_id: e.target.value}))} style={inputStyle}>
                  {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
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
    color_bg: "#dbeafe", color_text: "#1d4ed8",
  });

  const COLORS = [
    { bg: "#dbeafe", text: "#1d4ed8" },
    { bg: "#dcfce7", text: "#15803d" },
    { bg: "#fef3c7", text: "#92400e" },
    { bg: "#eeedfe", text: "#534AB7" },
    { bg: "#fee2e2", text: "#b91c1c" },
    { bg: "#E1F5EE", text: "#0F6E56" },
  ];

  const openAdd = () => {
    setEditId("new");
    setForm({ display_name: "", short_name: "", teams_account: "", color_bg: "#dbeafe", color_text: "#1d4ed8" });
  };

  const openEdit = (m: Member) => {
    setEditId(m.id);
    setForm({ display_name: m.display_name, short_name: m.short_name, teams_account: m.teams_account, color_bg: m.color_bg, color_text: m.color_text });
  };

  const save = () => {
    if (!form.display_name.trim()) return;
    // イニシャル自動生成
    const initials = form.display_name.replace(/[\s　]+/g, "").slice(0, 2).toUpperCase();
    const shortName = form.short_name.trim() || form.display_name.split(/[\s　]/)[0];

    if (editId === "new") {
      saveMember({
        id: uuidv4(), initials,
        display_name: form.display_name.trim(),
        short_name: shortName,
        teams_account: form.teams_account,
        color_bg: form.color_bg, color_text: form.color_text,
        is_deleted: false,
      });
    } else {
      const existing = members.find(m => m.id === editId);
      if (existing) saveMember({ ...existing, ...form, short_name: shortName, initials });
    }
    setEditId(null);
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
