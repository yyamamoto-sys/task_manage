// src/components/lab/CalendarLabView.tsx
//
// 【設計意図】
// ラボ機能（プロトタイプ）：タスクの期日とマイルストーンを月間カレンダーに配置して
// 「いつ何があるか」を一目で把握できるようにする。
// 主な用途：上司への印刷報告（備考・注釈欄付き）。
// タスクをクリックすると編集モーダル（onOpenTask）を開く。
//
// 印刷 CSS は globals.css の @media print に集約（コンポーネント内 <style> タグの
// DOM 重複注入を防ぐため）。

import { useMemo, useState } from "react";
import { useAppStore, selectScopedTasks, selectScopedProjects } from "../../stores/appStore";
import type { Member, Task } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { isAssignedTo } from "../../lib/taskMeta";

interface Props {
  onClose: () => void;
  currentUser: Member;
  onOpenTask: (taskId: string) => void;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// #8: コンポーネント外に置くことで再レンダーごとの再生成を防ぐ
const HEADER_BTN: React.CSSProperties = {
  padding: "4px 10px", fontSize: "12px", cursor: "pointer",
  background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
};

function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarLabView({ onClose, currentUser, onOpenTask }: Props) {
  const rawTasks      = useAppStore(selectScopedTasks);
  const rawProjects   = useAppStore(selectScopedProjects);
  const rawMilestones = useAppStore(s => s.milestones);

  const projects    = useMemo(() => active(rawProjects), [rawProjects]);
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const tasks       = useMemo(() => active(rawTasks).filter(t => !!t.due_date), [rawTasks]);
  const milestones  = useMemo(() => (rawMilestones ?? []).filter(m => !m.is_deleted), [rawMilestones]);

  const [ym, setYm] = useState<{ y: number; m: number }>(() => {
    const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [mineOnly, setMineOnly] = useState(false);
  const [hideDone, setHideDone] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [pjMenuOpen, setPjMenuOpen] = useState(false);
  const [selectedPjIds, setSelectedPjIds] = useState<Set<string>>(new Set());

  const togglePj = (id: string) => {
    setSelectedPjIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // #7: noteText を localStorage に永続化（閉じても保持される）
  const [noteText, setNoteText] = useState<string>(() => {
    try { return localStorage.getItem("cal_note_text") ?? ""; } catch { return ""; }
  });

  // #1: todayStr を useMemo でメモ化（ym が変わるたびに再評価 → 日跨ぎでも正確）
  // ym 自体は式の中で参照しないが、月移動のたびに new Date() を取り直すための
  // 意図的なトリガー依存（ESLintのunnecessary-dependency警告は無視してよい）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todayStr = useMemo(() => toStr(new Date()), [ym]);

  // 表示グリッドの日付範囲（6週分）を ym から導出してフィルタに使う
  // #5 #6: 全期間でなく表示月の前後を含む範囲だけ処理してパフォーマンス改善
  const gridRange = useMemo(() => {
    const first    = new Date(ym.y, ym.m, 1);
    const startDay = new Date(ym.y, ym.m, 1 - first.getDay());
    const endDay   = new Date(startDay);
    endDay.setDate(startDay.getDate() + 41);
    return { start: toStr(startDay), end: toStr(endDay) };
  }, [ym]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const due = t.due_date as string;
      // 表示グリッド外のタスクはスキップ（全期間ループのパフォーマンス問題を解消）
      if (due < gridRange.start || due > gridRange.end) continue;
      if (mineOnly && !isAssignedTo(t, currentUser.id)) continue;
      if (hideDone && t.status === "done") continue;
      if (selectedPjIds.size > 0 && (!t.project_id || !selectedPjIds.has(t.project_id))) continue;
      if (!map.has(due)) map.set(due, []);
      map.get(due)!.push(t);
    }
    return map;
  }, [tasks, mineOnly, hideDone, currentUser.id, gridRange, selectedPjIds]);

  const milestonesByDate = useMemo(() => {
    const map = new Map<string, { name: string; pjColor?: string }[]>();
    for (const m of milestones) {
      // 表示グリッド外のマイルストーンはスキップ
      if (m.date < gridRange.start || m.date > gridRange.end) continue;
      if (selectedPjIds.size > 0 && !selectedPjIds.has(m.project_id)) continue;
      if (!map.has(m.date)) map.set(m.date, []);
      map.get(m.date)!.push({ name: m.name, pjColor: projectById.get(m.project_id)?.color_tag });
    }
    return map;
  }, [milestones, projectById, gridRange, selectedPjIds]);

  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const start = new Date(ym.y, ym.m, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [ym]);

  const goPrev  = () => setYm(({ y, m }) => (m === 0  ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  const goNext  = () => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0  } : { y, m: m + 1 }));
  const goToday = () => { const n = new Date(); setYm({ y: n.getFullYear(), m: n.getMonth() }); };

  const handleNoteChange = (v: string) => {
    setNoteText(v);
    try { localStorage.setItem("cal_note_text", v); } catch { /* ignore */ }
  };

  return (
    // #2: <style>タグを削除。印刷 CSS は globals.css の @media print に移動済み
    <div className="cal-root animate-overlay" style={{
      position: "fixed", inset: 0, zIndex: 250,
      background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 32px",
    }}>
      <div className="cal-body animate-fadeIn" style={{
        width: "100%", maxWidth: "1100px",
        height: "100%", maxHeight: "100%",
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* ===== ヘッダー ===== */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
          padding: "12px 18px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0,
        }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>🗓️ カレンダー</span>
          <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)" }}>ラボ</span>

          <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "6px" }}>
            <button className="cal-print-hide" onClick={goPrev}  title="前の月" aria-label="前の月" style={HEADER_BTN}>‹</button>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", minWidth: "92px", textAlign: "center" }}>
              {ym.y}年{ym.m + 1}月
            </span>
            <button className="cal-print-hide" onClick={goNext}  title="次の月" aria-label="次の月" style={HEADER_BTN}>›</button>
            <button className="cal-print-hide" onClick={goToday} title="今月へ" style={{ ...HEADER_BTN, marginLeft: "4px" }}>今日</button>
          </div>

          <button className="cal-print-hide"
            onClick={() => setMineOnly(v => !v)}
            title="自分が担当のタスクのみ表示"
            style={{ ...HEADER_BTN, background: mineOnly ? "var(--color-brand-light)" : "var(--color-bg-secondary)", color: mineOnly ? "var(--color-text-purple)" : "var(--color-text-secondary)", borderColor: mineOnly ? "var(--color-brand-border)" : "var(--color-border-primary)" }}
          >👤 自分のみ</button>

          <button className="cal-print-hide"
            onClick={() => setHideDone(v => !v)}
            title={hideDone ? "完了タスクも表示する" : "完了タスクを非表示にする"}
            style={{ ...HEADER_BTN, background: hideDone ? "var(--color-bg-secondary)" : "var(--color-brand-light)", color: hideDone ? "var(--color-text-secondary)" : "var(--color-text-purple)", borderColor: hideDone ? "var(--color-border-primary)" : "var(--color-brand-border)" }}
          >🙈 完了を隠す</button>

          <button className="cal-print-hide"
            onClick={() => setPjMenuOpen(v => !v)}
            title="表示するプロジェクトを絞り込む"
            style={{ ...HEADER_BTN, background: selectedPjIds.size > 0 ? "var(--color-brand-light)" : pjMenuOpen ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)", color: selectedPjIds.size > 0 ? "var(--color-text-purple)" : "var(--color-text-secondary)", borderColor: selectedPjIds.size > 0 ? "var(--color-brand-border)" : "var(--color-border-primary)" }}
          >📁 {selectedPjIds.size > 0 ? `${selectedPjIds.size}PJ選択中` : "PJ絞り込み"}</button>

          <button className="cal-print-hide"
            onClick={() => setNoteOpen(v => !v)}
            title="印刷用の備考・注釈欄を開く"
            style={{ ...HEADER_BTN, background: noteOpen ? "var(--color-bg-info)" : "var(--color-bg-secondary)", color: noteOpen ? "var(--color-text-info)" : "var(--color-text-secondary)", borderColor: noteOpen ? "var(--color-border-info)" : "var(--color-border-primary)" }}
          >📝 備考</button>

          <button className="cal-print-hide"
            onClick={() => window.print()}
            title="このカレンダーを印刷する"
            style={HEADER_BTN}
          >🖨️ 印刷</button>

          <div style={{ flex: 1 }} />
          <button className="cal-print-hide" onClick={onClose} title="閉じる" aria-label="閉じる" style={{ ...HEADER_BTN, fontSize: "16px", padding: "2px 10px" }}>×</button>
        </div>

        {/* ===== PJ絞り込みパネル ===== */}
        {pjMenuOpen && (
          <div className="cal-print-hide" style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-secondary)",
            flexShrink: 0,
          }}>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "7px" }}>
              表示するプロジェクトを選択（未選択＝全プロジェクト表示）
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {projects.map(p => {
                const sel = selectedPjIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePj(p.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      padding: "3px 10px", borderRadius: "var(--radius-full)",
                      fontSize: "11px", cursor: "pointer",
                      border: sel ? `1.5px solid ${p.color_tag ?? "var(--color-brand)"}` : "1px solid var(--color-border-primary)",
                      background: sel ? `${p.color_tag ?? "#6366f1"}22` : "var(--color-bg-primary)",
                      color: sel ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                      fontWeight: sel ? "600" : "400",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color_tag ?? "var(--color-text-tertiary)", flexShrink: 0 }} />
                    {p.name}
                  </button>
                );
              })}
            </div>
            {selectedPjIds.size > 0 && (
              <button
                onClick={() => setSelectedPjIds(new Set())}
                style={{ marginTop: "8px", fontSize: "10px", color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
              >
                選択をリセット（全PJ表示）
              </button>
            )}
          </div>
        )}

        {/* ===== 備考・注釈欄 ===== */}
        <div className="cal-note-area" style={{
          display: noteOpen ? "flex" : "none",
          flexDirection: "column", gap: "6px",
          padding: "10px 18px",
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-secondary)",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
            📝 備考・注釈（印刷時に表示されます）
          </div>
          <textarea
            value={noteText}
            onChange={e => handleNoteChange(e.target.value)}
            placeholder={
              "上司への説明が必要な補足、読み取りにくい点の注釈、前提条件などを記入してください。\n" +
              "例：◆タスク名はプロジェクト内の略称です／赤字は期限超過のタスクを示します"
            }
            rows={3}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "8px 10px", fontSize: "12px", lineHeight: 1.7,
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              resize: "vertical", fontFamily: "inherit", outline: "none",
            }}
          />
          <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <span>🟡 ◆ マイルストーン（節目）</span>
            <span style={{ color: "var(--color-text-danger)" }}>🔴 赤字 ＝ 期限超過（当日含む）</span>
            <span>● 色ドット ＝ プロジェクト別カラー</span>
            {mineOnly && <span>👤 自分担当のタスクのみ表示</span>}
            {hideDone && <span>🙈 完了タスクは非表示</span>}
          </div>
        </div>

        {/* ===== 曜日見出し ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", flexShrink: 0, borderBottom: "1px solid var(--color-border-primary)" }}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} style={{
              textAlign: "center", padding: "6px 0", fontSize: "11px", fontWeight: 600,
              color: i === 0 ? "var(--color-text-danger)" : i === 6 ? "var(--color-text-info)" : "var(--color-text-tertiary)",
            }}>{w}</div>
          ))}
        </div>

        {/* ===== カレンダー本体（6週） ===== */}
        <div className="cal-grid" style={{
          flex: 1, minHeight: 0,
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: "repeat(6, 1fr)",
          overflow: "auto",
        }}>
          {cells.map((d) => {
            const ds = toStr(d);
            const inMonth  = d.getMonth() === ym.m;
            const isToday  = ds === todayStr;
            const dayTasks = tasksByDate.get(ds) ?? [];
            const dayMs    = milestonesByDate.get(ds) ?? [];
            const weekday  = d.getDay();
            return (
              <div key={ds} style={{
                minHeight: 0,
                borderRight:  d.getDay() !== 6 ? "1px solid var(--color-border-primary)" : "none",
                borderBottom: "1px solid var(--color-border-primary)",
                outline: isToday ? "2px solid var(--color-brand)" : "none",
                outlineOffset: "-2px",
                padding: "4px 6px",
                overflow: "hidden",
                display: "flex", flexDirection: "column", gap: "2px",
                background: isToday ? "var(--color-brand-light)" : inMonth ? "var(--color-bg-primary)" : "var(--color-bg-secondary)",
                opacity: inMonth ? 1 : 0.5,
              }}>
                {/* 日付 */}
                <div style={{
                  fontSize: "11px", fontWeight: isToday ? 700 : 500, flexShrink: 0,
                  color: isToday    ? "var(--color-brand)"
                       : weekday === 0 ? "var(--color-text-danger)"
                       : weekday === 6 ? "var(--color-text-info)"
                       : "var(--color-text-secondary)",
                }}>{d.getDate()}</div>

                {/* マイルストーン */}
                {dayMs.map((m, mi) => (
                  <div key={`ms-${mi}`} title={`◆ ${m.name}`} style={{
                    fontSize: "10px", lineHeight: 1.3,
                    display: "flex", alignItems: "center", gap: "3px",
                    color: "#d97706",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    <span style={{ flexShrink: 0 }}>◆</span>{m.name}
                  </div>
                ))}

                {/* タスク（最大4件＋残数） */}
                {dayTasks.slice(0, 4).map(t => {
                  const pj     = t.project_id ? projectById.get(t.project_id) : undefined;
                  const isDone = t.status === "done";
                  // #3: <= で「今日期限のタスク」も期限超過として強調表示
                  const isOverdue = ds <= todayStr && !isDone;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onOpenTask(t.id)}
                      title={`${t.name}${pj ? `（${pj.name}）` : ""}`}
                      style={{
                        display: "flex", alignItems: "center", gap: "4px",
                        padding: "1px 5px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                        background: "var(--color-bg-secondary)", border: "none", textAlign: "left",
                        overflow: "hidden", flexShrink: 0,
                        opacity: isDone ? 0.5 : 1,
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: pj?.color_tag ?? "var(--color-text-tertiary)" }} />
                      <span style={{
                        fontSize: "10px", lineHeight: 1.4,
                        color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-primary)",
                        textDecoration: isDone ? "line-through" : "none",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{t.name}</span>
                    </button>
                  );
                })}
                {dayTasks.length > 4 && (
                  <div style={{ fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                    +{dayTasks.length - 4} 件
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>{/* /カード */}
    </div>
  );
}
