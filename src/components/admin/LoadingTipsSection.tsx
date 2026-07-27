// src/components/admin/LoadingTipsSection.tsx
//
// 【設計意図】
// 設定画面の「ローディングのヒント」セクション。データ読み込み中の待ち時間に出る
// 操作テクニックのヒント（loading_tips テーブル）を、全社スーパー管理者が
// 追加・編集・並べ替え・一時的な非表示・削除できるようにする。
//
// アクセス制御は二重：
//   ・UI …… AdminView 側で左ナビにこの項目を出すのを super-admin に限定＋本コンポーネント冒頭のガード
//   ・DB …… loading_tips の RLS が書き込みを current_member_is_super_admin() に限定
// UI 側だけの制御にしないのは、権限判定の真実は常にDB側に置くという既存方針に合わせるため。
//
// 部署スコープは持たない（全社共通マスタ）。ヒントは操作テクニックの説明であって
// 部署ごとに変える必要が無く、要件も「スーパー管理者のみが変更」だったため。

import { useState, useMemo, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../../stores/appStore";
import type { Member, LoadingTip } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { formatErrorForUser } from "../../lib/errorMessage";
import { Card, SummaryTile, SummaryRow } from "../common/Card";
import { DangerZone, DangerAction } from "../common/DangerZone";
import { AdminFormModal } from "./AdminFormModal";
import { inputStyle, primaryBtnStyle, ghostBtnStyle, addBtnStyle } from "./adminStyles";
import { DEFAULT_LOADING_TIPS } from "../../lib/tips/loadingTips";

interface Props {
  currentUser: Member;
  onDirtyChange: (dirty: boolean) => void;
}

/** 編集フォームの下書き（保存前の状態） */
interface TipDraft {
  title: string;
  body: string;
  is_active: boolean;
}

const emptyDraft: TipDraft = { title: "", body: "", is_active: true };

export function LoadingTipsSection({ currentUser, onDirtyChange }: Props) {
  const loadingTips    = useAppStore(s => s.loadingTips);
  const saveLoadingTip = useAppStore(s => s.saveLoadingTip);
  const deleteLoadingTip = useAppStore(s => s.deleteLoadingTip);

  const tips = useMemo(
    () => active(loadingTips).slice().sort((a, b) => a.sort_order - b.sort_order),
    [loadingTips],
  );
  const activeCount = useMemo(() => tips.filter(t => t.is_active).length, [tips]);

  const [editingId, setEditingId] = useState<string | null>(null); // "__new__" は新規作成
  const [draft, setDraft] = useState<TipDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isCreating = editingId === "__new__";
  const isDirty = editingId !== null;
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  const isSuperAdmin = currentUser.is_super_admin === true;

  const startNew = () => {
    setEditingId("__new__");
    setDraft(emptyDraft);
    setError(null);
  };
  const startEdit = (tip: LoadingTip) => {
    setEditingId(tip.id);
    setDraft({ title: tip.title, body: tip.body, is_active: tip.is_active });
    setError(null);
  };
  const cancel = () => { setEditingId(null); setError(null); };

  const save = async () => {
    if (!draft.body.trim()) { setError("本文を入力してください"); return; }
    setError(null);
    try {
      if (isCreating) {
        // 新規は末尾に置く（表示順は既存の最大 + 10。10刻みにしておくと後から間に差し込みやすい）
        const nextOrder = tips.length > 0 ? Math.max(...tips.map(t => t.sort_order)) + 10 : 10;
        await saveLoadingTip({
          id: uuidv4(),
          title: draft.title.trim(),
          body: draft.body.trim(),
          sort_order: nextOrder,
          is_active: draft.is_active,
          is_deleted: false,
          updated_by: currentUser.id,
        });
      } else {
        const existing = tips.find(t => t.id === editingId);
        if (!existing) { setError("対象のヒントが見つかりませんでした"); return; }
        await saveLoadingTip({
          ...existing,
          title: draft.title.trim(),
          body: draft.body.trim(),
          is_active: draft.is_active,
          updated_by: currentUser.id,
        });
      }
      setEditingId(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(formatErrorForUser("保存に失敗しました", e));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteLoadingTip(id, currentUser.id);
      setEditingId(null);
    } catch (e) {
      setError(formatErrorForUser("削除に失敗しました", e));
    }
  };

  /**
   * 隣り合うヒントと表示順を入れ替える。
   * sort_order を直接入力させるより誤りが起きにくいため、↑↓ の2ボタンだけを提供する。
   */
  const swapOrder = async (index: number, dir: -1 | 1) => {
    const a = tips[index];
    const b = tips[index + dir];
    if (!a || !b) return;
    try {
      await saveLoadingTip({ ...a, sort_order: b.sort_order, updated_by: currentUser.id });
      await saveLoadingTip({ ...b, sort_order: a.sort_order, updated_by: currentUser.id });
    } catch (e) {
      setError(formatErrorForUser("並べ替えに失敗しました", e));
    }
  };

  /** 組み込みの既定ヒント10件を一括で投入する（テーブルが空のときの復旧用） */
  const restoreDefaults = async () => {
    try {
      let order = 10;
      for (const t of DEFAULT_LOADING_TIPS) {
        await saveLoadingTip({
          id: uuidv4(),
          title: t.title,
          body: t.body,
          sort_order: order,
          is_active: true,
          is_deleted: false,
          updated_by: currentUser.id,
        });
        order += 10;
      }
    } catch (e) {
      setError(formatErrorForUser("既定ヒントの投入に失敗しました", e));
    }
  };

  if (!isSuperAdmin) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 2 }}>
        🔒 ローディングのヒントは全社スーパー管理者のみ編集できます。
      </div>
    );
  }

  const fields = (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div>
        <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
          見出し（任意・絵文字1個＋短い一文が読みやすい）
        </div>
        <input
          style={inputStyle}
          value={draft.title}
          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          placeholder="例）🔍 どこからでも一発ジャンプ"
        />
      </div>
      <div>
        <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
          本文（必須）
        </div>
        <textarea
          style={{ ...inputStyle, minHeight: "88px", lineHeight: 1.7, resize: "vertical" }}
          value={draft.body}
          onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
          placeholder="例）Ctrl（Mac は ⌘）＋ K でコマンドパレットが開きます。…"
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={draft.is_active}
          onChange={e => setDraft(d => ({ ...d, is_active: e.target.checked }))}
          style={{ accentColor: "var(--color-brand)" }}
        />
        ローディング画面に表示する
      </label>
      {error && (
        <div style={{ fontSize: "11px", color: "var(--color-text-danger)", lineHeight: 1.6 }}>{error}</div>
      )}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button style={ghostBtnStyle} onClick={cancel}>キャンセル</button>
        <button style={primaryBtnStyle} onClick={() => void save()}>保存</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <SummaryRow>
        <SummaryTile label="ヒント総数" value={tips.length} tone="accent" />
        <SummaryTile label="表示中" value={activeCount} tone="success" />
      </SummaryRow>

      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
        データ読み込み中の待ち時間に、ここで登録したヒントが1つずつ順番に表示されます。
        初回ガイドツアーで説明していない操作テクニックを載せると効果的です。
        <br />
        ※ 変更内容は各ユーザーの<strong>次回の読み込み</strong>から反映されます
        （ヒントはローディング画面より先に必要になるため、前回取得分を端末にキャッシュして表示しています）。
      </div>

      <Card
        title="ヒント一覧"
        badge={`${tips.length}件`}
        headerExtra={<button style={addBtnStyle} onClick={startNew}>＋ ヒントを追加</button>}
      >
        {tips.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              ヒントが1件もありません。この状態でも、アプリに組み込まれている既定のヒント10件が表示されます。
            </div>
            <button style={ghostBtnStyle} onClick={() => void restoreDefaults()}>
              既定のヒント10件を取り込んで編集できるようにする
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {tips.map((tip, i) => (
              <div key={tip.id}>
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: "8px",
                  padding: "9px 10px",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  background: tip.is_active ? "var(--color-bg-primary)" : "var(--color-bg-secondary)",
                  opacity: tip.is_active ? 1 : 0.6,
                }}>
                  {/* 並べ替え */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", flexShrink: 0 }}>
                    <button
                      style={miniBtnStyle} disabled={i === 0} aria-label="上へ"
                      onClick={() => void swapOrder(i, -1)}
                    >▲</button>
                    <button
                      style={miniBtnStyle} disabled={i === tips.length - 1} aria-label="下へ"
                      onClick={() => void swapOrder(i, 1)}
                    >▼</button>
                  </div>

                  <button
                    onClick={() => startEdit(tip)}
                    style={{
                      flex: 1, minWidth: 0, textAlign: "left", background: "transparent",
                      border: "none", cursor: "pointer", padding: 0,
                    }}
                  >
                    <div style={{
                      fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)",
                      marginBottom: "2px",
                    }}>
                      {tip.title || "（見出しなし）"}
                    </div>
                    <div style={{
                      fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.6,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}>
                      {tip.body}
                    </div>
                  </button>

                  {!tip.is_active && (
                    <span style={{
                      flexShrink: 0, fontSize: "10px", padding: "1px 6px", borderRadius: "99px",
                      background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)",
                      border: "1px solid var(--color-border-primary)",
                    }}>非表示</span>
                  )}
                </div>

                {/* 編集フォーム（一覧行の直下にインライン展開。新規追加のみモーダル） */}
                {editingId === tip.id && (
                  <div style={{
                    marginTop: "6px", marginBottom: "4px", padding: "12px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-secondary)",
                  }}>
                    {fields}
                    <div style={{ marginTop: "14px" }}>
                      <DangerZone>
                        <DangerAction
                          label="このヒントを削除する"
                          description="ローディング画面に表示されなくなります。一時的に隠すだけなら「ローディング画面に表示する」のチェックを外してください。"
                          buttonLabel="削除する"
                          onConfirm={() => remove(tip.id)}
                        />
                      </DangerZone>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {saved && (
        <div style={{ fontSize: "11px", color: "var(--color-text-success)" }}>✓ 保存しました</div>
      )}

      {isCreating && (
        <AdminFormModal
          title="ヒントを追加"
          subtitle="ローディング画面に表示される操作テクニック"
          onClose={cancel}
          maxWidth="520px"
        >
          {fields}
        </AdminFormModal>
      )}
    </div>
  );
}

const miniBtnStyle: React.CSSProperties = {
  width: "20px", height: "16px", padding: 0, lineHeight: 1,
  fontSize: "8px", color: "var(--color-text-tertiary)",
  background: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-sm)", cursor: "pointer",
};
