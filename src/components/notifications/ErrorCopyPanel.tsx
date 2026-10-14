// src/components/notifications/ErrorCopyPanel.tsx
//
// v3.151：ベルのパネルの「⚙ 通知設定」の真下に出す、super_admin 専用の「エラーをコピー」欄。
// 呼び出し側（InAppNotificationBell）が isSuperAdmin のときだけ描画する。
// 一覧＝未読の client_error 通知に対応するエラー（結び方は errorCopyText.ts の matchNewErrors）。
// 取得はこのコンポーネントが出たとき（＝パネルを開いたとき）とタブを切り替えたときだけ。世代番号で古い応答を捨てる（Section 69）。
// 🔴 取得の effect の依存に t を入れない（tRef から読む）。コピーしても既読にはしない（勝手に状態を変えない）。

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { showToast } from "../common/Toast";
import { formatErrorForUser } from "../../lib/errorMessage";
import { APP_VERSION } from "../../lib/version";
import { fetchNewClientErrors, type NewClientError } from "../../lib/supabase/clientErrorStore";
import { buildErrorCopyText, firstLine, formatJst } from "../../lib/errors/errorCopyText";

/** 欄の中だけスクロールする高さ（px）。取得は最大50件 */
export const ERROR_COPY_LIST_MAX_HEIGHT = 150;

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

interface Props {
  memberId: string;
  /** ベルのタブ。切り替えたときに取り直す */
  tab: string;
}

export function ErrorCopyPanel({ memberId, tab }: Props) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [errors, setErrors] = useState<NewClientError[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const reqRef = useRef(0);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const req = ++reqRef.current;
    let cancelled = false;
    setErrors(null);
    setFailed(null);
    void (async () => {
      try {
        const rows = await fetchNewClientErrors(memberId);
        if (cancelled || req !== reqRef.current) return;
        setErrors(rows);
        setSelected(new Set(rows.map(r => r.id)));
      } catch (e) {
        if (cancelled || req !== reqRef.current) return;
        setFailed(formatErrorForUser(tRef.current("layout.bell.errCopy.loadFailed"), e));
        setErrors([]);
      }
    })();
    return () => { cancelled = true; };
  }, [memberId, tab]);

  const list = useMemo(() => errors ?? [], [errors]);
  const chosen = useMemo(() => list.filter(r => selected.has(r.id)), [list, selected]);
  const allOn = list.length > 0 && chosen.length === list.length;

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const copy = async () => {
    if (chosen.length === 0) return;
    const text = buildErrorCopyText(chosen, { now: new Date(), appVersion: APP_VERSION });
    if (await copyTextToClipboard(text)) {
      setFallbackText(null);
      showToast(t("layout.bell.errCopy.copied", { n: chosen.length }), "success");
    } else {
      setFallbackText(text);
      showToast(t("layout.bell.errCopy.copyFailed"), "error");
      requestAnimationFrame(() => { fallbackRef.current?.focus(); fallbackRef.current?.select(); });
    }
  };

  return (
    <div data-testid="bell-error-copy" style={{ borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "6px", width: "100%", textAlign: "left", padding: "6px 10px",
          background: "transparent", border: "none", cursor: "pointer", fontSize: "11px", fontWeight: 600, color: "var(--color-text-purple)",
        }}>
        <span style={{ flex: 1 }}>🛡 {t("layout.bell.errCopy.title")}{errors !== null ? `（${list.length}）` : ""}</span>
        <span aria-hidden>{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div style={{ padding: "0 10px 8px" }}>
          {failed && <div role="alert" style={{ fontSize: "11px", color: "var(--color-text-danger)" }}>{failed}</div>}
          {errors === null && <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>…</div>}
          {errors !== null && list.length === 0 && !failed && (
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>{t("layout.bell.errCopy.empty")}</div>
          )}
          {list.length > 0 && (
            <>
              <div style={{ marginBottom: "4px" }}>
                <button type="button" onClick={() => setSelected(allOn ? new Set() : new Set(list.map(r => r.id)))}
                  style={{ fontSize: "11px", background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-info)", padding: 0 }}>
                  {t(allOn ? "layout.bell.errCopy.clearAll" : "layout.bell.errCopy.selectAll")}
                </button>
              </div>
              <div style={{ maxHeight: `${ERROR_COPY_LIST_MAX_HEIGHT}px`, overflowY: "auto", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)" }}>
                {list.map(r => (
                  // eslint-disable-next-line jsx-a11y/label-has-associated-control -- 本文は入れ子の span（式）で、入力は label の子
                  <label key={r.id} style={{ display: "flex", gap: "6px", alignItems: "flex-start", padding: "4px 6px", fontSize: "11px", cursor: "pointer", borderBottom: "1px solid var(--color-border-primary)" }}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} style={{ marginTop: "2px", flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{firstLine(r.message)}</span>
                      <span style={{ display: "block", color: "var(--color-text-tertiary)", fontSize: "10px" }}>
                        {t("layout.bell.errCopy.meta", { count: r.count, last: formatJst(r.last_seen).slice(5) })}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <button type="button" disabled={chosen.length === 0} onClick={() => void copy()}
            style={{
              marginTop: "6px", width: "100%", fontSize: "11px", fontWeight: 600, padding: "4px 8px", borderRadius: "var(--radius-sm)",
              cursor: chosen.length === 0 ? "default" : "pointer", opacity: chosen.length === 0 ? 0.5 : 1,
              background: "var(--color-bg-purple)", color: "var(--color-text-purple)", border: "1px solid var(--color-border-purple)",
            }}>
            📋 {t("layout.bell.errCopy.button")}
          </button>
          {fallbackText !== null && (
            <textarea ref={fallbackRef} readOnly value={fallbackText} onFocus={e => e.currentTarget.select()}
              style={{ marginTop: "6px", width: "100%", height: "100px", fontSize: "10px", fontFamily: "monospace", boxSizing: "border-box" }} />
          )}
        </div>
      )}
    </div>
  );
}
