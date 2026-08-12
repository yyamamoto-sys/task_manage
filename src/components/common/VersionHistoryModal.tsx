// src/components/common/VersionHistoryModal.tsx
//
// 【設計意図】
// 画面隅のバージョン表示（VersionBadge）から開く、利用者向けのバージョン履歴モーダル。
// 目的は2つ：①利用者が「何が変わったか」を自分で確認できること ②OKRの実績として
// 「この期間に何を更新したか」を期間指定でコピーできること（山本さんの依頼）。
//
// データは src/lib/releaseNotes.ts（利用者向けに書き直した正本）。開発者向けの
// docs/dev/CHANGELOG.md とは別物のため混同しない。
//
// このコンポーネント自体は呼び出し側（MainLayout.tsx / LoginScreen.tsx）で
// lazyWithRetry により遅延読込される想定（CLAUDE.md Section 19）。ここで
// releaseNotes.ts を静的importしても、モーダルを開かない利用者はこのチャンク自体を
// ダウンロードしないため実害はない。
//
// ゲストにも見せてよい（社内情報ではなくアプリの更新内容のため。isGuestMember等の
// ガードはこのモーダルには不要）。

import { useEffect, useMemo, useRef, useState } from "react";
import { RELEASE_NOTES, type ReleaseNoteEntry } from "../../lib/releaseNotes";
import { filterReleaseNotesByPeriod, buildReleaseNotesText } from "../../lib/releaseNotes/filterByPeriod";
import { groupReleaseNotesByMonth, defaultOpenMonthKeys } from "../../lib/releaseNotes/groupByMonth";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "./modalStyles";
import { showToast } from "./Toast";

interface Props {
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: "12px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
};

/** クリップボードへのコピー。navigator.clipboard → execCommand → 失敗の3段フォールバック */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function VersionHistoryModal({ onClose }: Props) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // クリップボードAPI・execCommandの両方が使えない環境向けの最終フォールバック表示
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);

  const filtered: ReleaseNoteEntry[] = useMemo(
    () => filterReleaseNotesByPeriod(RELEASE_NOTES, { start: startDate || null, end: endDate || null }),
    [startDate, endDate],
  );

  const hasPeriodFilter = startDate !== "" || endDate !== "";

  // 月ごとの見出しで区切る（純粋関数はsrc/lib/releaseNotes/groupByMonth.tsに切り出し済み）
  const grouped = useMemo(() => groupReleaseNotesByMonth(filtered), [filtered]);

  const monthKeys = useMemo(() => grouped.map(g => g.monthKey), [grouped]);

  // 開いている月の集合。既定は「当月・前月だけ開く」（絞り込み中は該当月をすべて開く）。
  // 期間の指定（startDate/endDate）が変わるたびに既定状態へ再計算し直す。手動での開閉トグルは
  // 次に期間が変わるまで保持する。
  const [openMonths, setOpenMonths] = useState<Set<string>>(() =>
    defaultOpenMonthKeys(monthKeys, new Date(), hasPeriodFilter),
  );
  useEffect(() => {
    setOpenMonths(defaultOpenMonthKeys(monthKeys, new Date(), hasPeriodFilter));
    // monthKeys/hasPeriodFilterは依存に含めない：どちらもstartDate/endDateから毎レンダー
    // 導出される値（filtered→grouped→monthKeys、startDate/endDate→hasPeriodFilter）で、
    // 依存に含めると新しい配列/真偽値参照のたびにeffectが再実行され続けてしまう。
    // 実質のトリガーであるstartDate/endDateだけを依存にすれば、期間変更時には必ず
    // 最新のmonthKeys/hasPeriodFilterがこのeffect内で参照される。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const toggleMonth = (monthKey: string) => {
    setOpenMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const handleCopy = async () => {
    const text = buildReleaseNotesText(filtered);
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    if (ok) {
      showToast("この期間の更新内容をコピーしました", "success");
      setFallbackText(null);
    } else {
      // 最終フォールバック：テキストエリアに出して選択させる
      setFallbackText(text);
      showToast("コピーに失敗しました。下に表示した内容を選択してコピーしてください", "error");
      requestAnimationFrame(() => {
        fallbackRef.current?.focus();
        fallbackRef.current?.select();
      });
    }
  };

  return (
    <div
      className="animate-overlay"
      style={{ ...modalOverlayStyle(500), background: "rgba(0,0,0,0.45)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="animate-fadeIn"
        style={{
          ...modalBoxStyle("min(560px, 100%)"),
          background: "var(--color-bg-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        {/* ヘッダー */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px", flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
              バージョン履歴
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              これまでの更新内容を確認できます
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            style={{
              background: "transparent", border: "none", borderRadius: "6px",
              fontSize: "16px", cursor: "pointer", color: "var(--color-text-tertiary)",
              width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >✕</button>
        </div>

        {/* 期間の指定＋コピー（本文の外に固定。フッターより上に置く） */}
        <div style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "10px", flexShrink: 0,
        }}>
          <div style={{ minWidth: "130px" }}>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "3px" }}>開始日</div>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ minWidth: "130px" }}>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "3px" }}>終了日</div>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          </div>
          {hasPeriodFilter && (
            <button
              onClick={() => { setStartDate(""); setEndDate(""); }}
              style={{
                fontSize: "11px", color: "var(--color-text-tertiary)", background: "transparent",
                border: "none", cursor: "pointer", padding: "6px 0", textDecoration: "underline",
              }}
            >
              指定をクリア
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={handleCopy}
            disabled={filtered.length === 0}
            style={{
              padding: "7px 14px", fontSize: "12px", fontWeight: 600,
              background: filtered.length === 0 ? "var(--color-bg-secondary)" : "var(--color-brand)",
              color: filtered.length === 0 ? "var(--color-text-tertiary)" : "#fff",
              border: "none", borderRadius: "var(--radius-md)",
              cursor: filtered.length === 0 ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            📋 この期間の内容をコピー
          </button>
        </div>

        {/* 本文（スクロール領域） */}
        <div style={{ ...MODAL_BODY_STYLE, padding: "14px 20px" }}>
          {grouped.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "20px 0", textAlign: "center" }}>
              指定した期間に該当する更新はありません。
            </div>
          ) : (
            grouped.map(group => {
              const isOpen = openMonths.has(group.monthKey);
              return (
                <div key={group.monthKey} style={{ marginBottom: "18px" }}>
                  <button
                    onClick={() => toggleMonth(group.monthKey)}
                    aria-expanded={isOpen}
                    style={{
                      display: "flex", alignItems: "center", gap: "6px", width: "100%",
                      fontSize: "11px", fontWeight: 700, color: "var(--color-text-tertiary)",
                      letterSpacing: "0.03em", marginBottom: "8px",
                      padding: "0 0 4px", borderBottom: "1px solid var(--color-border-primary)",
                      background: "transparent", border: "none", borderRadius: 0,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{
                      display: "inline-block", transition: "transform 0.15s",
                      transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", fontSize: "9px",
                    }}>▶</span>
                    {group.label}
                    <span style={{ fontWeight: 400 }}>（{group.entries.length}件）</span>
                  </button>
                  {isOpen && group.entries.map(entry => (
                    <div key={`${entry.version}-${entry.date}`} style={{ marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                          {entry.date}
                        </span>
                        <span style={{
                          fontSize: "10px", fontWeight: 700, color: "var(--color-text-secondary)",
                          background: "var(--color-bg-secondary)", padding: "1px 6px", borderRadius: "var(--radius-sm)",
                          whiteSpace: "nowrap",
                        }}>
                          {entry.version}
                        </span>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                          {entry.title}
                        </span>
                      </div>
                      <ul style={{ margin: 0, paddingLeft: "18px" }}>
                        {entry.highlights.map((h, i) => (
                          <li key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                            {h}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })
          )}

          {fallbackText !== null && (
            <div style={{ marginTop: "10px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                自動コピーができない環境です。下の内容を選択してコピーしてください。
              </div>
              <textarea
                ref={fallbackRef}
                readOnly
                value={fallbackText}
                style={{ width: "100%", height: "120px", fontSize: "11px", fontFamily: "monospace", ...inputStyle }}
                onFocus={e => e.currentTarget.select()}
              />
            </div>
          )}
        </div>

        {/* フッター */}
        <div style={{
          ...MODAL_FOOTER_STYLE, padding: "12px 20px", borderTop: "1px solid var(--color-border-primary)",
          display: "flex", justifyContent: "flex-end",
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px", fontSize: "12px", color: "var(--color-text-secondary)",
              background: "transparent", border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
