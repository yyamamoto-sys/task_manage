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
import { active, KEYS } from "../../lib/localData/localStore";
import { isAssignedTo, isPausedOrCancelledStatus, suppressOverdue, TASK_PRIORITY_STRIPE_COLOR } from "../../lib/taskMeta";
import { isTaskStagnant, STAGNANT_THRESHOLD_DAYS } from "../gantt/ganttUtils";
import { toDate, addDays } from "../../lib/date";

interface Props {
  onClose: () => void;
  currentUser: Member;
  onOpenTask: (taskId: string) => void;
  /** 日付セルクリック（空白部分／タッチ端末は全面）で、その日を期日初期値としたQuickAddTaskModalを開く */
  onRequestQuickAdd: (dateStr: string) => void;
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

export function CalendarLabView({ onClose, currentUser, onOpenTask, onRequestQuickAdd }: Props) {
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
  // ④ 月／週の表示モード（既定=月）。週表示中は ym は動かさず weekAnchor（週内の任意の日）で管理する
  const [viewMode, setViewMode] = useState<"month" | "week">(() => {
    try { return localStorage.getItem(KEYS.CAL_VIEW_MODE) === "week" ? "week" : "month"; } catch { return "month"; }
  });
  const [weekAnchor, setWeekAnchor] = useState<string>(() => toStr(new Date()));
  const [mineOnly, setMineOnly] = useState(false);
  const [hideDone, setHideDone] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [pjMenuOpen, setPjMenuOpen] = useState(false);
  const [selectedPjIds, setSelectedPjIds] = useState<Set<string>>(new Set());
  // ③ 日付セルホバー時の「＋」表示用（PCのみのアフォーダンス。タッチ端末はセル自体のクリックで開く）
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  // ⑥ 週末（土日）セルを淡くするトグル（既定OFF。土日の列自体は消さない＝暦の形を保つ）
  const [dimWeekends, setDimWeekends] = useState<boolean>(() => {
    try { return localStorage.getItem(KEYS.CAL_DIM_WEEKENDS) === "1"; } catch { return false; }
  });
  const toggleDimWeekends = () => {
    setDimWeekends(v => {
      const next = !v;
      try { localStorage.setItem(KEYS.CAL_DIM_WEEKENDS, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // ④ 月⇔週の切替。切替時に「今どのあたりを見ていたか」を引き継ぐ
  // （月→週：月表示で見ていた月の1日を含む週を初期表示に／週→月：週表示で見ていた週が属する月に）
  const handleSetViewMode = (mode: "month" | "week") => {
    if (mode !== viewMode) {
      if (mode === "week") {
        setWeekAnchor(toStr(new Date(ym.y, ym.m, 1)));
      } else {
        const d = toDate(weekAnchor) ?? new Date();
        setYm({ y: d.getFullYear(), m: d.getMonth() });
      }
      setViewMode(mode);
      try { localStorage.setItem(KEYS.CAL_VIEW_MODE, mode); } catch { /* ignore */ }
    }
  };

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

  // #1: todayStr を useMemo でメモ化（ym/weekAnchor が変わるたびに再評価 → 日跨ぎでも正確）
  // ym/weekAnchor 自体は式の中で参照しないが、月・週移動のたびに new Date() を取り直すための
  // 意図的なトリガー依存（ESLintのunnecessary-dependency警告は無視してよい）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todayStr = useMemo(() => toStr(new Date()), [ym, weekAnchor]);

  // ④ 月間グリッド（6週・42セル。従来どおり）
  const monthCells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const start = new Date(ym.y, ym.m, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [ym]);

  // ④ 週間グリッド（weekAnchor を含む週の日曜〜土曜・7セル）
  const weekCells = useMemo(() => {
    const anchor = toDate(weekAnchor) ?? new Date();
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - anchor.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [weekAnchor]);

  const cells = viewMode === "week" ? weekCells : monthCells;

  // 表示グリッドの日付範囲を cells から導出してフィルタに使う（月表示=6週／週表示=1週の両方に対応）
  // #5 #6: 全期間でなく表示中の範囲だけ処理してパフォーマンス改善
  const gridRange = useMemo(() => ({
    start: toStr(cells[0]),
    end: toStr(cells[cells.length - 1]),
  }), [cells]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const due = t.due_date as string;
      // 表示グリッド外のタスクはスキップ（全期間ループのパフォーマンス問題を解消）
      if (due < gridRange.start || due > gridRange.end) continue;
      if (mineOnly && !isAssignedTo(t, currentUser.id)) continue;
      // 完了・保留・中止をまとめて隠す（他ビュー v2.74〜76 のステータス5値化に追従。CLAUDE.md v2.77）
      if (hideDone && (t.status === "done" || isPausedOrCancelledStatus(t.status))) continue;
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

  // ④ 前後ナビは表示モードに応じて月送り／週送りに切り替える
  const goPrev = () => {
    if (viewMode === "week") {
      setWeekAnchor(prev => toStr(addDays(toDate(prev) ?? new Date(), -7)));
    } else {
      setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
    }
  };
  const goNext = () => {
    if (viewMode === "week") {
      setWeekAnchor(prev => toStr(addDays(toDate(prev) ?? new Date(), 7)));
    } else {
      setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
    }
  };
  // 「今日」ボタンは両モードで機能させる（今見ていないモード側も今日基準にリセットしておく）
  const goToday = () => {
    const n = new Date();
    setYm({ y: n.getFullYear(), m: n.getMonth() });
    setWeekAnchor(toStr(n));
  };

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
            <button className="cal-print-hide" onClick={goPrev}  title={viewMode === "week" ? "前の週" : "前の月"} aria-label={viewMode === "week" ? "前の週" : "前の月"} style={HEADER_BTN}>‹</button>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", minWidth: "120px", textAlign: "center" }}>
              {viewMode === "week"
                ? (weekCells[0].getMonth() === weekCells[6].getMonth()
                    ? `${weekCells[0].getFullYear()}年${weekCells[0].getMonth() + 1}月${weekCells[0].getDate()}〜${weekCells[6].getDate()}日`
                    : `${weekCells[0].getMonth() + 1}/${weekCells[0].getDate()}〜${weekCells[6].getMonth() + 1}/${weekCells[6].getDate()}`)
                : `${ym.y}年${ym.m + 1}月`}
            </span>
            <button className="cal-print-hide" onClick={goNext}  title={viewMode === "week" ? "次の週" : "次の月"} aria-label={viewMode === "week" ? "次の週" : "次の月"} style={HEADER_BTN}>›</button>
            <button className="cal-print-hide" onClick={goToday} title="今日へ" style={{ ...HEADER_BTN, marginLeft: "4px" }}>今日</button>
          </div>

          {/* ④ 月／週 表示モード切替（セグメント） */}
          <div className="cal-print-hide" style={{
            display: "flex", alignItems: "center",
            border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden",
          }}>
            <button
              onClick={() => handleSetViewMode("month")}
              title="月表示"
              style={{
                padding: "4px 10px", fontSize: "12px", cursor: "pointer", border: "none",
                background: viewMode === "month" ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
                color: viewMode === "month" ? "var(--color-text-purple)" : "var(--color-text-secondary)",
                fontWeight: viewMode === "month" ? 600 : 400,
              }}
            >月</button>
            <button
              onClick={() => handleSetViewMode("week")}
              title="週表示"
              style={{
                padding: "4px 10px", fontSize: "12px", cursor: "pointer",
                border: "none", borderLeft: "1px solid var(--color-border-primary)",
                background: viewMode === "week" ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
                color: viewMode === "week" ? "var(--color-text-purple)" : "var(--color-text-secondary)",
                fontWeight: viewMode === "week" ? 600 : 400,
              }}
            >週</button>
          </div>

          <button className="cal-print-hide"
            onClick={() => setMineOnly(v => !v)}
            title="自分が担当のタスクのみ表示"
            style={{ ...HEADER_BTN, background: mineOnly ? "var(--color-brand-light)" : "var(--color-bg-secondary)", color: mineOnly ? "var(--color-text-purple)" : "var(--color-text-secondary)", borderColor: mineOnly ? "var(--color-brand-border)" : "var(--color-border-primary)" }}
          >👤 自分のみ</button>

          <button className="cal-print-hide"
            onClick={() => setHideDone(v => !v)}
            title={hideDone ? "完了・保留・中止タスクも表示する" : "完了・保留・中止タスクを非表示にする"}
            style={{ ...HEADER_BTN, background: hideDone ? "var(--color-bg-secondary)" : "var(--color-brand-light)", color: hideDone ? "var(--color-text-secondary)" : "var(--color-text-purple)", borderColor: hideDone ? "var(--color-border-primary)" : "var(--color-brand-border)" }}
          >🙈 完了・保留・中止を隠す</button>

          <button className="cal-print-hide"
            onClick={() => setPjMenuOpen(v => !v)}
            title="表示するプロジェクトを絞り込む"
            style={{ ...HEADER_BTN, background: selectedPjIds.size > 0 ? "var(--color-brand-light)" : pjMenuOpen ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)", color: selectedPjIds.size > 0 ? "var(--color-text-purple)" : "var(--color-text-secondary)", borderColor: selectedPjIds.size > 0 ? "var(--color-brand-border)" : "var(--color-border-primary)" }}
          >📁 {selectedPjIds.size > 0 ? `${selectedPjIds.size}PJ選択中` : "PJ絞り込み"}</button>

          <button className="cal-print-hide"
            onClick={toggleDimWeekends}
            title={dimWeekends ? "週末セルの淡い表示をやめる" : "土日のセルを淡く表示する"}
            style={{ ...HEADER_BTN, background: dimWeekends ? "var(--color-brand-light)" : "var(--color-bg-secondary)", color: dimWeekends ? "var(--color-text-purple)" : "var(--color-text-secondary)", borderColor: dimWeekends ? "var(--color-brand-border)" : "var(--color-border-primary)" }}
          >🗓 週末を淡く</button>

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
            {hideDone && <span>🙈 完了・保留・中止タスクは非表示</span>}
            {dimWeekends && <span>🗓 土日のセルを淡く表示</span>}
          </div>
        </div>

        {/* ===== 曜日見出し（④ 週表示では日付も併記＝「日 19」の形） ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", flexShrink: 0, borderBottom: "1px solid var(--color-border-primary)" }}>
          {viewMode === "week"
            ? weekCells.map((d, i) => {
                const isHeaderToday = toStr(d) === todayStr;
                return (
                  <div key={toStr(d)} style={{
                    textAlign: "center", padding: "6px 0", fontSize: "11px", fontWeight: isHeaderToday ? 700 : 600,
                    color: isHeaderToday
                      ? "var(--color-brand)"
                      : i === 0 ? "var(--color-text-danger)" : i === 6 ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                  }}>{WEEKDAYS[i]} {d.getDate()}</div>
                );
              })
            : WEEKDAYS.map((w, i) => (
                <div key={w} style={{
                  textAlign: "center", padding: "6px 0", fontSize: "11px", fontWeight: 600,
                  color: i === 0 ? "var(--color-text-danger)" : i === 6 ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                }}>{w}</div>
              ))}
        </div>

        {/* ===== カレンダー本体（月表示=6週／週表示=1週。行数はcellsの長さから自動算出） ===== */}
        <div className="cal-grid" style={{
          flex: 1, minHeight: 0,
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: `repeat(${cells.length / 7}, 1fr)`,
          overflow: "auto",
        }}>
          {cells.map((d) => {
            const ds = toStr(d);
            // ④ 週表示では「表示月の外」という概念自体が無い（全7日が対象週として等しく主役）ため
            // 常にinMonth=true扱いにし、月表示特有の淡色・4件上限を適用しない
            const inMonth  = viewMode === "week" ? true : d.getMonth() === ym.m;
            const isToday  = ds === todayStr;
            const dayTasks = tasksByDate.get(ds) ?? [];
            const dayMs    = milestonesByDate.get(ds) ?? [];
            const weekday  = d.getDay();
            const isHovered = hoveredCell === ds;
            return (
              // ③ 空白部分クリック（またはタッチ端末はセル全体クリック）でその日を期日初期値にQuickAddTaskModalを開く。
              // タスク行・「＋」ボタン側で stopPropagation しているため、それらのクリックはここまで伝播しない
              <div
                key={ds}
                className="cal-cell"
                role="button"
                tabIndex={0}
                onClick={() => onRequestQuickAdd(ds)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRequestQuickAdd(ds); } }}
                onMouseEnter={() => setHoveredCell(ds)}
                onMouseLeave={() => setHoveredCell(prev => (prev === ds ? null : prev))}
                title={`${ds} にタスクを追加`}
                style={{
                  position: "relative", minHeight: 0, cursor: "pointer",
                  borderRight:  d.getDay() !== 6 ? "1px solid var(--color-border-primary)" : "none",
                  borderBottom: "1px solid var(--color-border-primary)",
                  outline: isToday ? "2px solid var(--color-brand)" : "none",
                  outlineOffset: "-2px",
                  padding: "4px 6px",
                  // ④ 週表示はその日の全タスクを縦に並べるため、セル内で縦スクロール可にする
                  // （印刷時はglobals.cssの.cal-cellルールでoverflow:visibleに上書きされ、全件そのまま出力される）
                  overflow: viewMode === "week" ? "auto" : "hidden",
                  display: "flex", flexDirection: "column", gap: "2px",
                  // ⑥ 週末を淡く：今日の強調が最優先、次に週末ダイマー、それ以外は従来どおり
                  // 「表示月の外は淡色（inMonth）」判定（暦の形自体は変えない＝土日の列は消さない）
                  background: isToday
                    ? "var(--color-brand-light)"
                    : dimWeekends && (weekday === 0 || weekday === 6)
                    ? "var(--color-bg-secondary)"
                    : inMonth ? "var(--color-bg-primary)" : "var(--color-bg-secondary)",
                  opacity: inMonth ? 1 : 0.5,
                }}>
                {/* ＋ 新規タスク追加（PCのホバー時のみ表示。印刷には出さない） */}
                {isHovered && (
                  <button
                    className="cal-print-hide"
                    onClick={e => { e.stopPropagation(); onRequestQuickAdd(ds); }}
                    title="この日にタスクを追加"
                    aria-label="この日にタスクを追加"
                    style={{
                      position: "absolute", top: "2px", right: "3px", zIndex: 1,
                      width: "16px", height: "16px", lineHeight: "14px",
                      fontSize: "12px", fontWeight: 700, textAlign: "center", padding: 0,
                      borderRadius: "var(--radius-full)", cursor: "pointer",
                      background: "var(--color-brand)", color: "var(--btn-primary-text)",
                      border: "none",
                    }}
                  >＋</button>
                )}

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

                {/* タスク（月表示は最大4件＋残数。週表示は上限なしで全件縦に並べる） */}
                {(viewMode === "week" ? dayTasks : dayTasks.slice(0, 4)).map(t => {
                  const pj = t.project_id ? projectById.get(t.project_id) : undefined;
                  // 中止(cancelled)はdoneと同じ「終わった見た目」（取り消し線・薄い表示）。保留(on_hold)は
                  // まだ動きうる仕事のため見た目は変えない（他ビューと同じ扱い。CLAUDE.md v2.77）
                  const isClosed = t.status === "done" || t.status === "cancelled";
                  const isOverdue = !suppressOverdue(t.status) && ds <= todayStr;
                  // ② 優先度ストライプ（カンバンの TASK_PRIORITY_STRIPE_COLOR をそのまま流用。判定ロジックの二重化を避ける）
                  const stripeColor = t.priority ? TASK_PRIORITY_STRIPE_COLOR[t.priority] : "var(--color-border-primary)";
                  // ② 滞留バッジ（ガントの isTaskStagnant/STAGNANT_THRESHOLD_DAYS をそのまま流用）
                  const stagnant = isTaskStagnant(t);
                  const stagnantDays = stagnant && t.updated_at
                    ? Math.floor((Date.now() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                  return (
                    <button
                      key={t.id}
                      onClick={e => { e.stopPropagation(); onOpenTask(t.id); }}
                      title={`${t.name}${pj ? `（${pj.name}）` : ""}`}
                      style={{
                        display: "flex", alignItems: "center", gap: "4px",
                        padding: "1px 5px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                        background: "var(--color-bg-secondary)",
                        border: "none", borderLeft: `3px solid ${stripeColor}`,
                        textAlign: "left",
                        overflow: "hidden", flexShrink: 0,
                        opacity: isClosed ? 0.5 : 1,
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: pj?.color_tag ?? "var(--color-text-tertiary)" }} />
                      <span style={{
                        flex: 1,
                        fontSize: "10px", lineHeight: 1.4,
                        color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-primary)",
                        textDecoration: isClosed ? "line-through" : "none",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{t.name}</span>
                      {stagnant && (
                        <span title={`${STAGNANT_THRESHOLD_DAYS}日以上更新なし`} style={{
                          flexShrink: 0, fontSize: "8px", lineHeight: 1.4,
                          color: "var(--color-text-warning)", whiteSpace: "nowrap",
                        }}>🕒{stagnantDays}日</span>
                      )}
                    </button>
                  );
                })}
                {viewMode !== "week" && dayTasks.length > 4 && (
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
