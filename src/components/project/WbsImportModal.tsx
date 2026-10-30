// src/components/project/WbsImportModal.tsx
//
// 【設計意図・v3.189】
// 「WBSを取り込む」：外部で作ったWBS（.xlsx／.md のテンプレート、MS Project 系の XML、各種ツールの CSV）を、
// 新しいPJまたは既存のPJへ取り込む。CSV・テンプレートに合わない xlsx は、列の役割と階層の取り方を選ぶ画面を挟む。
// ファイルを選ぶと決まった規則（AIは使わない）で読み、一覧（階層・名前・日付・先行タスク・完了・警告）を見せ、
// 「登録する」を押して初めて書き込む（Human in the loop）。読み取り・当てはめは lib/wbsImport の純粋関数、
// 書き込みは wbsApply.ts（失敗したら作ったものを論理削除して取り消す）。
// 取り込み前の画面には「保存されていない編集」が無い（読み取り結果は捨てても失うものがない）ので、
// 未保存編集レジストリ（Section 46）の対象にはしない。書き込み中だけ閉じられないようにする。
// このファイルは lazyWithRetry で読み込む（Section 19。取り込む人だけがダウンロードする）。

import { useMemo, useRef, useState } from "react";
import { useAppStore, selectScopedMembers, selectScopedProjects, selectScopedTasks } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";
import { loadWbsFile, defaultProjectName, WBS_IMPORT_ACCEPT, type WbsSource } from "../../lib/wbsImport/wbsFileLoader";
import { buildRowsFromItems } from "../../lib/wbsImport/wbsItems";
import {
  autoMapping, itemsFromTable, COLUMN_ROLES, ROLE_LABELS, type ColumnRole, type TableHierarchy, type WbsColumnMapping,
} from "../../lib/wbsImport/wbsColumns";
import { formatDepLabel } from "../../lib/dependencies/depType";
import { buildWbsPlan } from "../../lib/wbsImport/wbsPlan";
import { applyWbsPlan, describeCounts } from "../../lib/wbsImport/wbsApply";
import { formatMD } from "../../lib/date";

const DEFAULT_COLOR = "#4A90D9";

interface Props {
  currentUser: Member;
  /** PJ行の「⋮」から開いたときのPJ（既存PJに追加が初期選択）。「＋」まわりから開いたときは null（新しいPJを作るが初期選択） */
  defaultProjectId: string | null;
  onClose: () => void;
  /** 取り込み成功後に、そのPJを開くため */
  onImported: (projectId: string) => void;
}

const HIERARCHY_OPTIONS: SelectOption[] = [
  { value: "parent", label: "親ID列（親のIDまたは名前が入っている列）" },
  { value: "level", label: "レベル列（1・2・3…）" },
  { value: "wbs", label: "WBS番号（1.2.3）" },
  { value: "indent", label: "名前の先頭の空白（インデント）" },
  { value: "none", label: "階層なし（すべて同じ段）" },
];
const NO_ROLE = "";
const th: React.CSSProperties = {
  position: "sticky", top: 0, background: "var(--color-bg-secondary)", textAlign: "left",
  padding: "4px 6px", fontSize: "11px", fontWeight: 600, borderBottom: "1px solid var(--color-border-primary)", whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "3px 6px", fontSize: "11px", borderBottom: "1px solid var(--color-border-primary)", verticalAlign: "top" };
const inputStyle: React.CSSProperties = {
  width: "100%", fontSize: "12px", padding: "6px 8px", border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)", boxSizing: "border-box",
};

export function WbsImportModal({ currentUser, defaultProjectId, onClose, onImported }: Props) {
  const members = useAppStore(selectScopedMembers);
  const projects = useAppStore(selectScopedProjects);
  const tasks = useAppStore(selectScopedTasks);
  const sections = useAppStore(s => s.projectSections);

  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState<WbsSource | null>(null);
  const [groupTop, setGroupTop] = useState(true);
  const [mapping, setMapping] = useState<WbsColumnMapping | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetKind, setTargetKind] = useState<"new" | "existing">(defaultProjectId ? "existing" : "new");
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [existingId, setExistingId] = useState(defaultProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadedAtRef = useRef(new Date().toISOString());

  const projectOptions: SelectOption[] = useMemo(
    () => projects
      .filter(p => !p.is_deleted && (p.status === "active" || p.id === defaultProjectId))
      .map(p => ({ value: p.id, label: p.name, color: p.color_tag })),
    [projects, defaultProjectId],
  );

  const handleFile = async (file: File) => {
    setLoading(true);
    setLoadError(null);
    setError(null);
    setSource(null);
    setMapping(null);
    setFileName(file.name);
    const out = await loadWbsFile(file);
    setLoading(false);
    if (!out.ok) { setLoadError(out.error); return; }
    loadedAtRef.current = new Date().toISOString();
    setSource(out.source);
    setMapping(out.source.kind === "table" ? autoMapping(out.source.table) : null);
    setNewName(prev => prev || defaultProjectName(out.source.kind === "rows" ? out.source.result.title : out.source.title, file.name));
    setNewPurpose(prev => prev || `「${file.name}」から取り込んだWBS`);
  };

  const parsed = useMemo(() => {
    if (!source) return null;
    if (source.kind === "rows") return source.result;
    if (source.kind === "items") {
      return buildRowsFromItems(source.items, { groupTop, mode: source.mode, title: source.title, warnings: source.warnings });
    }
    if (!mapping) return null;
    const t = itemsFromTable(source.table, mapping);
    return buildRowsFromItems(t.items, { groupTop, mode: t.mode, title: source.title, warnings: t.warnings });
  }, [source, mapping, groupTop]);

  const plan = useMemo(() => {
    if (!parsed) return null;
    return buildWbsPlan(parsed, {
      target: targetKind === "new"
        ? { kind: "new", name: newName, purpose: newPurpose, color: DEFAULT_COLOR }
        : { kind: "existing", projectId: existingId },
      currentUserId: currentUser.id,
      members,
      existingTasks: targetKind === "existing" ? tasks.filter(t => t.project_id === existingId) : [],
      existingSections: targetKind === "existing" ? sections.filter(s => s.project_id === existingId) : [],
      now: loadedAtRef.current,
      newId: () => crypto.randomUUID(),
    });
  }, [parsed, targetKind, newName, newPurpose, existingId, currentUser.id, members, tasks, sections]);

  const warningCount = parsed && plan
    ? parsed.warnings.length + parsed.rows.reduce((a, r) => a + r.warnings.length + (plan.extraWarnings.get(r.index)?.length ?? 0), 0)
    : 0;

  const setRole = (col: number, role: string) => {
    setMapping(m => {
      if (!m) return m;
      const columns = { ...m.columns };
      for (const r of COLUMN_ROLES) if (columns[r] === col) columns[r] = -1;
      if (role !== NO_ROLE) columns[role as ColumnRole] = col;
      return { ...m, columns };
    });
  };

  const maxDepth = parsed ? parsed.rows.reduce((a, r) => (r.isGroup ? a : Math.max(a, r.depth + 1)), 0) : 0;
  const groupCount = parsed ? parsed.rows.filter(r => r.isGroup).length : 0;
  const targetReady = targetKind === "new" ? newName.trim() !== "" && newPurpose.trim() !== "" : existingId !== "";
  const canRegister = !!plan && plan.tasks.length > 0 && targetReady && !busy;

  const requestClose = () => { if (!busy) onClose(); };

  const handleRegister = async () => {
    if (!plan || !canRegister) return;
    setBusy(true);
    setError(null);
    const st = useAppStore.getState();
    const out = await applyWbsPlan(plan, currentUser.id, {
      saveProject: st.saveProject,
      deleteProject: st.deleteProject,
      saveProjectSection: st.saveProjectSection,
      deleteProjectSection: st.deleteProjectSection,
      saveTask: st.saveTask,
      deleteTask: st.deleteTask,
      getTask: id => useAppStore.getState().tasks.find(t => t.id === id),
      getTaskStatus: id => useAppStore.getState().tasks.find(t => t.id === id)?.status,
      addTaskDependency: st.addTaskDependency,
      findDependencyId: (p, s) => useAppStore.getState().taskDependencies
        .find(d => !d.is_deleted && d.predecessor_task_id === p && d.successor_task_id === s)?.id,
      removeTaskDependency: st.removeTaskDependency,
      saveMilestone: st.saveMilestone,
      deleteMilestone: st.deleteMilestone,
      onProgress: (done, total, label) => setProgress(`${label}（全体 ${done}/${total}）`),
    });
    setBusy(false);
    setProgress("");
    if (out.ok) {
      showToast(`WBSを取り込みました（${describeCounts(out.counts)}）`, "success");
      onImported(plan.projectId);
      onClose();
      return;
    }
    const head = formatErrorForUser(`${out.stage}に失敗しました`, out.error);
    const tail = out.rolledBack
      ? `途中まで書き込んだ分（${describeCounts(out.written)}）は取り消しました。もう一度登録できます。`
      : `取り消しの途中で一部を削除できませんでした。残っている分：${describeCounts(out.remaining)}。リストで確認して手動で削除してください。`;
    setError(`${head}\n${tail}`);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.4)" }}
      onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        className="animate-fadeIn"
        style={{ ...modalBoxStyle("min(920px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}
      >
        <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "13px" }}>WBSを取り込む</div>
          <button
            onClick={requestClose}
            disabled={busy}
            aria-label="閉じる"
            style={{ background: "transparent", border: "none", cursor: busy ? "not-allowed" : "pointer", fontSize: "16px", color: "var(--color-text-tertiary)", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "14px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            Excel／Markdown のテンプレート、MS Project・ProjectLibre・GanttProject の XML、各種ツールの CSV（Asana・Jira・Redmine・Backlog など）を取り込めます。
            テンプレートの列は <b>ID／階層（G・P・C）／タスク名／開始日／終了日／先行タスク（IDをカンマ区切り。「3FS+2」「3SS-1d」のように種類とずらし日数も書けます）／備考</b>
            （任意で担当者）。Gはグループ、Pは親タスク、Cはその子タスクになります。備考は「完了」「マイルストーン」「ユーザー」「仮」を「・」でつなげて書けます。
            MS Project の .mpp は「名前を付けて保存」で XML 形式にしてから選んでください。CSV は列の役割を選んでから確認します。
            読み取った内容を確認してから登録します（AIは使いません）。
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <input
              ref={inputRef}
              type="file"
              accept={WBS_IMPORT_ACCEPT}
              disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
              style={{ fontSize: "12px" }}
            />
            {loading && <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>読み取り中…</span>}
            {!loading && fileName && parsed && <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>{fileName}</span>}
          </div>

          {loadError && (
            <div role="alert" style={{ fontSize: "12px", padding: "8px 10px", borderRadius: "var(--radius-md)", background: "var(--color-danger-light, #fdecea)", color: "var(--color-danger, #b42318)" }}>
              {loadError}
            </div>
          )}

          {source?.kind === "table" && mapping && (
            <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600 }}>列の対応づけ（各列の役割を確認してください）</div>
              <div style={{ overflow: "auto", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)" }}>
                <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                  <thead>
                    <tr>
                      {source.table.header.map((h, i) => {
                        const role = COLUMN_ROLES.find(r => mapping.columns[r] === i) ?? NO_ROLE;
                        return (
                          <th key={i} style={{ ...th, position: "static", minWidth: "120px", verticalAlign: "top" }}>
                            <div style={{ marginBottom: "4px", color: "var(--color-text-tertiary)", fontWeight: 400 }}>{h || `（列${i + 1}）`}</div>
                            <CustomSelect
                              value={role}
                              onChange={v => setRole(i, v)}
                              options={[{ value: NO_ROLE, label: "（使わない）" }, ...COLUMN_ROLES.map(r => ({ value: r, label: ROLE_LABELS[r] }))]}
                            />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {source.table.rows.slice(0, 5).map((r, ri) => (
                      <tr key={ri}>
                        {source.table.header.map((_h, ci) => (
                          <td key={ci} style={{ ...td, whiteSpace: "pre-wrap", maxWidth: "220px", wordBreak: "break-all" }}>{String(r[ci] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "12px" }}>
                <span>階層の取り方：</span>
                <div style={{ minWidth: "300px" }}>
                  <CustomSelect
                    value={mapping.hierarchy}
                    onChange={v => setMapping(m => (m ? { ...m, hierarchy: v as TableHierarchy } : m))}
                    options={HIERARCHY_OPTIONS}
                  />
                </div>
              </div>
            </div>
          )}

          {parsed && source && source.kind !== "rows" && (
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
              <input type="checkbox" checked={groupTop} disabled={busy} onChange={e => setGroupTop(e.target.checked)} />
              一番上の段をグループにする（子を持つ最上位の行をPJ内のグループにし、その子を最上位のタスクにします）
            </label>
          )}

          {parsed && plan && (
            <>
              <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 600 }}>取り込み先</div>
                <div style={{ display: "flex", gap: "16px", fontSize: "12px", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                    <input type="radio" name="wbs-target" checked={targetKind === "new"} disabled={busy} onChange={() => setTargetKind("new")} />
                    新しいPJを作る
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                    <input type="radio" name="wbs-target" checked={targetKind === "existing"} disabled={busy} onChange={() => setTargetKind("existing")} />
                    既存のPJに追加する
                  </label>
                </div>
                {targetKind === "new" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <input type="text" value={newName} disabled={busy} onChange={e => setNewName(e.target.value)} placeholder="PJ名" style={inputStyle} aria-label="PJ名" />
                    <input type="text" value={newPurpose} disabled={busy} onChange={e => setNewPurpose(e.target.value)} placeholder="目的（何のためのPJか一行で）" style={inputStyle} aria-label="PJの目的" />
                  </div>
                ) : (
                  <div style={{ maxWidth: "420px" }}>
                    <CustomSelect value={existingId} onChange={setExistingId} options={projectOptions} searchable searchPlaceholder="PJ名で検索..." />
                    {plan.reusedSectionNames.length > 0 && (
                      <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                        同名のグループ（{plan.reusedSectionNames.join("・")}）は、既存のグループへ入れます。
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ fontSize: "12px" }}>
                読み取り結果：グループ{groupCount}件・タスク{plan.tasks.length}件
                （最大{maxDepth}段）・先行タスク{plan.dependencies.length}件・マイルストーン{plan.milestones.length}件
                {warningCount > 0
                  ? <span style={{ marginLeft: "12px", color: "var(--color-warning, #b54708)", fontWeight: 600 }}>警告{warningCount}件（内容を確認してください）</span>
                  : <span style={{ marginLeft: "12px", color: "var(--color-text-tertiary)" }}>警告なし</span>}
              </div>
              {parsed.warnings.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "11px", color: "var(--color-warning, #b54708)" }}>
                  {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}

              <div style={{ maxHeight: "300px", overflow: "auto", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={th}>階層</th><th style={th}>ID</th><th style={th}>名前</th><th style={th}>開始</th>
                      <th style={th}>終了</th><th style={th}>先行</th><th style={th}>状態</th><th style={th}>警告</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.map(r => {
                      const warns = [...r.warnings, ...(plan.extraWarnings.get(r.index) ?? [])];
                      return (
                        <tr key={r.index} style={{ background: r.isGroup ? "var(--color-bg-secondary)" : undefined }}>
                          <td style={td}>{r.isGroup ? "グループ" : `${r.depth + 1}段目`}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{r.id}</td>
                          <td style={{ ...td, paddingLeft: `${6 + (r.isGroup ? 0 : Math.min(r.depth, 10) * 12)}px`, fontWeight: r.isGroup ? 600 : 400 }}>
                            {r.name}{r.milestone ? " ◆" : ""}{r.tags.length > 0 ? `（${r.tags.join("・")}）` : ""}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{r.start ? formatMD(r.start) : ""}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{r.end ? formatMD(r.end) : ""}</td>
                          <td style={td}>{r.predecessors.map(p => `${p.id}${formatDepLabel({ dep_type: p.type, lag_days: p.lagDays }) ?? ""}`).join(", ")}</td>
                          <td style={td}>{r.status === "done" ? "完了" : r.status === "in_progress" ? "進行中" : ""}</td>
                          <td style={{ ...td, color: "var(--color-warning, #b54708)" }}>{warns.join(" ／ ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {error && (
            <div role="alert" style={{ fontSize: "12px", padding: "8px 10px", borderRadius: "var(--radius-md)", background: "var(--color-danger-light, #fdecea)", color: "var(--color-danger, #b42318)", whiteSpace: "pre-wrap" }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ ...MODAL_FOOTER_STYLE, padding: "10px 20px", borderTop: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
          {busy && <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginRight: "auto" }}>{progress || "登録中…"}</span>}
          <button
            onClick={requestClose}
            disabled={busy}
            style={{ fontSize: "12px", padding: "6px 14px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: busy ? "not-allowed" : "pointer" }}
          >キャンセル</button>
          <button
            onClick={() => void handleRegister()}
            disabled={!canRegister}
            style={{
              fontSize: "12px", padding: "6px 14px", border: "none", borderRadius: "var(--radius-md)",
              background: canRegister ? "var(--color-brand)" : "var(--color-bg-tertiary)",
              color: canRegister ? "#fff" : "var(--color-text-tertiary)",
              cursor: canRegister ? "pointer" : "not-allowed",
            }}
          >{busy ? "登録中..." : "登録する"}</button>
        </div>
      </div>
    </div>
  );
}
