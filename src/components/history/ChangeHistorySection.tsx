// src/components/history/ChangeHistorySection.tsx
//
// 【設計意図】CLAUDE.md Section 57（v3.111）参照。
// タスク編集モーダル・サイドパネル・PJ設定画面の3箇所に埋め込む共通の「変更履歴」表示。
// 新しいモーダルは作らず、各画面の本文（スクロール領域）内に埋め込む1セクションとして
// 実装する（依頼文の「表示はタスク単位から始める」に沿い、タスク/PJの詳細画面の一部として
// 表示する形にした）。
//
// 【Undoの対応関係】
// - action="update"：diffのbeforeへ、onRevertFields（saveTask/saveProject経由）で戻す。
// - action="delete"：onRestore（restoreTask/restoreProject経由）で復元する。
// - action="restore"：onDelete（deleteTask/deleteProject経由）で再度削除する。
// - action="create"：Undoボタンを出さない（diffが常に空で「戻す先」が無いため。
//   作成自体を取り消すなら削除操作自体を使えばよく、この履歴からの操作対象にはしない）。
//
// 🔴 テーブル未適用・取得失敗はエラーを表に出さず「まだ履歴はありません」と表示する
// （管理者向けのSchemaHealthBanner・BackupHealthBannerとは違い、ここは一般メンバーも
// 見る画面のため、機能不全を利用者に説明する必要はなく黙って空に倒す）。
// ゲストはDBに一切接続しない（CLAUDE.md Section 23）ため、fetch自体を呼ばず常に空。

import { useCallback, useEffect, useState } from "react";
import type { Member, EntityChangeLog, EntityChangeLogEntityType } from "../../lib/localData/types";
import { fetchEntityChangeLogs, markEntityChangeLogUndone } from "../../lib/supabase/store";
import { isGuestMode } from "../../lib/guestMode";
import { fieldLabel, formatChangeValue } from "../../lib/history/fieldLabels";
import { hasLaterConflictingChange } from "../../lib/history/undoWarning";
import { canUndoEntityChangeLog } from "../../lib/history/undoPermission";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";

const HISTORY_LIMIT = 20;

const ACTION_LABEL: Record<EntityChangeLog["action"], string> = {
  create: "作成しました",
  update: "変更しました",
  delete: "削除しました",
  restore: "復元しました",
};

function isUndoableAction(log: EntityChangeLog): boolean {
  if (log.action === "create") return false;
  if (log.action === "update") return Object.keys(log.diff).length > 0;
  return true; // delete / restore
}

function formatChangedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface Props {
  entityType: EntityChangeLogEntityType;
  entityId: string;
  currentUser: Member;
  members: Member[];
  /** action="update"のUndo：diffのbeforeの値だけを含むオブジェクトを渡す。
   *  呼び出し側が現在のエンティティにこれをマージしてsaveTask/saveProjectを呼ぶこと。 */
  onRevertFields: (fields: Record<string, unknown>) => Promise<void>;
  /** action="delete"のUndo（そのエンティティを復元する） */
  onRestore: () => Promise<void>;
  /** action="restore"のUndo（そのエンティティを再度削除する） */
  onDelete: () => Promise<void>;
}

export function ChangeHistorySection({ entityType, entityId, currentUser, members, onRevertFields, onRestore, onDelete }: Props) {
  const [logs, setLogs] = useState<EntityChangeLog[] | null>(null); // null = 読み込み中
  const [undoingId, setUndoingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (isGuestMode()) {
      // 🔴 ゲストはSupabaseに一切接続しない（CLAUDE.md Section 23）。表示は空にする
      setLogs([]);
      return;
    }
    try {
      const data = await fetchEntityChangeLogs(entityType, entityId, HISTORY_LIMIT);
      setLogs(data);
    } catch {
      // テーブル未適用・取得失敗はエラーを出さず空扱いにする（この画面の趣旨は
      // 「見られたら便利」程度の付随機能であり、失敗を利用者に説明する必要はない）
      setLogs([]);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    setLogs(null);
    void refresh();
  }, [refresh]);

  const handleUndo = useCallback(async (log: EntityChangeLog) => {
    if (undoingId !== null) return;
    if (hasLaterConflictingChange(log, logs ?? [])) {
      const ok = await confirmDialog(
        "この項目はその後も変更されています。戻しますか？",
        { tone: "neutral", confirmLabel: "戻す", cancelLabel: "戻さない" },
      );
      if (!ok) return;
    }
    setUndoingId(log.id);
    try {
      if (log.action === "delete") {
        await onRestore();
      } else if (log.action === "restore") {
        await onDelete();
      } else if (log.action === "update") {
        const fields: Record<string, unknown> = {};
        for (const [field, change] of Object.entries(log.diff)) fields[field] = change.before;
        await onRevertFields(fields);
      }
      try {
        await markEntityChangeLogUndone(log.id, currentUser.id);
      } catch (e) {
        // undone_atの記録失敗は「元に戻す」操作自体の成功を妨げない（記録の失敗を
        // 操作の失敗にしないという設計方針をUndo自体にも一貫させる）
        console.warn("entity_change_logsのundone_at記録に失敗しました", e);
      }
      showToast("元に戻しました", "info");
      await refresh();
    } catch (e) {
      showToast(formatErrorForUser("元に戻す処理に失敗しました", e), "error");
    } finally {
      setUndoingId(null);
    }
  }, [undoingId, logs, onRestore, onDelete, onRevertFields, currentUser.id, refresh]);

  return (
    <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--color-border-primary)" }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
        変更履歴
      </div>
      {logs === null ? (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>読み込み中…</div>
      ) : logs.length === 0 ? (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>まだ履歴はありません</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {logs.map(log => {
            const who = members.find(m => m.id === log.changed_by)?.short_name ?? "不明なメンバー";
            const canUndo = canUndoEntityChangeLog(log, currentUser) && isUndoableAction(log) && !log.undone_at;
            const fields = Object.entries(log.diff);
            return (
              <div key={log.id} style={{
                fontSize: "11px", lineHeight: 1.6,
                padding: "6px 8px",
                background: "var(--color-bg-secondary)",
                borderRadius: "var(--radius-md)",
                color: "var(--color-text-secondary)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "baseline" }}>
                  <span>
                    <strong style={{ color: "var(--color-text-primary)" }}>{who}</strong>
                    {" "}が{formatChangedAt(log.changed_at)}に{ACTION_LABEL[log.action]}
                  </span>
                  {log.undone_at && (
                    <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>取り消し済み</span>
                  )}
                </div>
                {log.action === "update" && fields.length > 0 && (
                  <ul style={{ margin: "2px 0 0", paddingLeft: "16px" }}>
                    {fields.map(([field, change]) => (
                      <li key={field}>
                        {fieldLabel(entityType, field)}：
                        {formatChangeValue(entityType, field, change.before, members)}
                        {" → "}
                        {formatChangeValue(entityType, field, change.after, members)}
                      </li>
                    ))}
                  </ul>
                )}
                {canUndo && (
                  <button
                    onClick={() => void handleUndo(log)}
                    disabled={undoingId === log.id}
                    style={{
                      marginTop: "4px",
                      padding: "2px 8px", fontSize: "10px",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-primary)",
                      color: "var(--color-text-secondary)",
                      cursor: undoingId === log.id ? "wait" : "pointer",
                    }}
                  >
                    {undoingId === log.id ? "処理中…" : "↺ 元に戻す"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
