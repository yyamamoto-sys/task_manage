// src/components/lab/CalendarLabView.tsx
//
// 【設計意図】
// ラボ機能（プロトタイプ）：タスクの期日とマイルストーンを月間カレンダーに配置して
// 「いつ何があるか」を一目で把握できるようにする。
// 主な用途：上司への印刷報告（備考・注釈欄付き）。
// タスクをクリックすると編集モーダル（onOpenTask）を開く。

import { useMemo, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Task } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { isAssignedTo } from "../../lib/taskMeta";

interface Props {
  onClose: () => void;
  currentUser: Member;
  onOpenTask: (taskId: string) => void;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarLabView({ onClose, currentUser, onOpenTask }: Props) {
  const rawTasks      = useAppStore(s => s.tasks);
  const rawProjects   = useAppStore(s => s.projects);
  const rawMilestones = useAppStore(s => s.milestones);

  const projects    = useMemo(() => active(rawProjects), [rawProjects]);
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const tasks       = useMemo(() => active(rawTasks).filter(t => !!t.due_date), [rawTasks]);
  const milestones  = useMemo(() => (rawMilestones ?? []).filter(m => !m.is_deleted), [rawMilestones]);

  const todayStr = toStr(new Date());
  const [ym, setYm] = useState<{ y: number; m: number }>(() => {
    const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [mineOnly,  setMineOnly]  = useState(false);
  const [hideDone,  setHideDone]  = useState(true);
  // 備考欄の状態（画面上では折りたたみ・印刷では常に展開）
  const [noteOpen,  setNoteOpen]  = useState(false);
  const [noteText,  setNoteText]  = useState("");

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (mineOnly && !isAssignedTo(t, currentUser.id)) continue;
      if (hideDone && t.status === "done") continue;
      const key = t.due_date as string;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks, mineOnly, hideDone, currentUser.id]);

  const milestonesByDate = useMemo(() => {
    const map = new Map<string, { name: string; pjColor?: string }[]>();
    for (const m of milestones) {
      if (!map.has(m.date)) map.set(m.date, []);
      map.get(m.date)!.push({ name: m.name, pjColor: projectById.get(m.project_id)?.color_tag });
    }
    return map;
  }, [milestones, projectById]);

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

  const headerBtn: React.CSSProperties = {
    padding: "4px 10px", fontSize: "12px", cursor: "pointer",
    background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)",
    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  };

  return (
    <>
      {/* ===== 印刷スタイル ===== */}
      <style>{`
        @media print {
          /* ヘッダー操作ボタン・閉じるボタンを非表示 */
          .cal-print-hide { display: none !important; }
          /* 備考欄を強制展開 */
          .cal-note-area { display: block !important; }
          /* オーバーレイを外してページ全体に印刷 */
          .cal-root {
            position: static !important;
            height: auto !important;
            overflow: visible !important;
          }
          .cal-body { overflow: visible !important; }
          /* セルがページをまたがないように */
          .cal-grid { page-break-inside: avoid; }
        }
      `}</style>

      {/* ===== 外枠：圧迫感を和らげる余白つきラッパー ===== */}
      <div className="cal-root" style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: "rgba(0,0,0,0.45)",          // 周囲を暗くして余白感を演出
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 32px",                    // 画面端との余白
      }}>
        {/* ===== 内側カード ===== */}
        <div className="cal-body" style={{
          width: "100%", maxWidth: "1100px",     // 横が広すぎない上限
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
              <button className="cal-print-hide" onClick={goPrev}  title="前の月" aria-label="前の月" style={headerBtn}>‹</button>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", minWidth: "92px", textAlign: "center" }}>
                {ym.y}年{ym.m + 1}月
              </span>
              <button className="cal-print-hide" onClick={goNext}  title="次の月" aria-label="次の月" style={headerBtn}>›</button>
              <button className="cal-print-hide" onClick={goToday} title="今月へ"  style={{ ...headerBtn, marginLeft: "4px" }}>今日</button>
            </div>

            <button className="cal-print-hide"
              onClick={() => setMineOnly(v => !v)}
              title="自分が担当のタスクのみ表示"
              style={{ ...headerBtn, background: mineOnly ? "var(--color-brand-light)" : "var(--color-bg-secondary)", color: mineOnly ? "var(--color-text-purple)" : "var(--color-text-secondary)", borderColor: mineOnly ? "var(--color-brand-border)" : "var(--color-border-primary)" }}
            >👤 自分のみ</button>
            <button className="cal-print-hide"
              onClick={() => setHideDone(v => !v)}
              title={hideDone ? "完了タスクも表示する" : "完了タスクを非表示にする"}
              style={{ ...headerBtn, background: hideDone ? "var(--color-bg-secondary)" : "var(--color-brand-light)", color: hideDone ? "var(--color-text-secondary)" : "var(--color-text-purple)", borderColor: hideDone ? "var(--color-border-primary)" : "var(--color-brand-border)" }}
            >🙈 完了を隠す</button>

            {/* 備考欄トグル */}
            <button className="cal-print-hide"
              onClick={() => setNoteOpen(v => !v)}
              title="印刷用の備考・注釈欄を開く"
              style={{ ...headerBtn, background: noteOpen ? "var(--color-bg-info)" : "var(--color-bg-secondary)", color: noteOpen ? "var(--color-text-info)" : "var(--color-text-secondary)", borderColor: noteOpen ? "var(--color-border-info)" : "var(--color-border-primary)" }}
            >📝 備考</button>

            {/* 印刷ボタン */}
            <button className="cal-print-hide"
              onClick={() => window.print()}
              title="このカレンダーを印刷する"
              style={{ ...headerBtn }}
            >🖨️ 印刷</button>

            <div style={{ flex: 1 }} />
            <button className="cal-print-hide" onClick={onClose} title="閉じる" aria-label="閉じる" style={{ ...headerBtn, fontSize: "16px", padding: "2px 10px" }}>×</button>
          </div>

          {/* ===== 備考・注釈欄（画面：折りたたみ / 印刷：常に展開） ===== */}
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
              onChange={e => setNoteText(e.target.value)}
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
                resize: "vertical", fontFamily: "inherit",
                outline: "none",
              }}
            />
            {/* 印刷時の凡例も追加 */}
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <span>🟡 ◆ マイルストーン（節目）</span>
              <span style={{ color: "var(--color-text-danger)" }}>🔴 赤字 ＝ 期限超過</span>
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
                    const pj        = t.project_id ? projectById.get(t.project_id) : undefined;
                    const isDone    = t.status === "done";
                    const isOverdue = ds < todayStr && !isDone;
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
      </div>{/* /ラッパー */}
    </>
  );
}
