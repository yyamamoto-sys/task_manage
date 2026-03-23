// src/components/auth/SetupWizard.tsx
//
// 【設計意図】
// 初回起動時のみ表示するセットアップウィザード。
// ステップ1: ようこそ（アプリ概要説明）
// ステップ2: メンバー登録（チームメンバーを追加）
// ステップ3: 完了
//
// 完了後に WIZARD_COMPLETED フラグを localStorage に保存し、
// 2回目以降は表示しない。

import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { KEYS } from "../../lib/localData/localStore";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";

interface Props {
  onComplete: () => void;
}

const AVATAR_COLORS = [
  { bg: "#EDE9FE", text: "#7C3AED" },
  { bg: "#DBEAFE", text: "#1D4ED8" },
  { bg: "#D1FAE5", text: "#065F46" },
  { bg: "#FEF3C7", text: "#92400E" },
  { bg: "#FCE7F3", text: "#9D174D" },
  { bg: "#FEE2E2", text: "#991B1B" },
  { bg: "#E0F2FE", text: "#0369A1" },
  { bg: "#F0FDF4", text: "#166534" },
];

interface MemberDraft {
  id: string;
  display_name: string;
  short_name: string;
  color_bg: string;
  color_text: string;
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // 姓名の場合は頭文字2文字、1語の場合は最初の1文字
  const parts = trimmed.split(/[\s　]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2);
}

export function SetupWizard({ onComplete }: Props) {
  const { saveMember } = useAppData();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [members, setMembers] = useState<MemberDraft[]>([
    {
      id: uuidv4(),
      display_name: "",
      short_name: "",
      color_bg: AVATAR_COLORS[0].bg,
      color_text: AVATAR_COLORS[0].text,
    },
  ]);

  const addMember = () => {
    const colorIdx = members.length % AVATAR_COLORS.length;
    setMembers(prev => [...prev, {
      id: uuidv4(),
      display_name: "",
      short_name: "",
      color_bg: AVATAR_COLORS[colorIdx].bg,
      color_text: AVATAR_COLORS[colorIdx].text,
    }]);
  };

  const removeMember = (id: string) => {
    setMembers(prev => prev.filter(m => m.id !== id));
  };

  const updateMember = (id: string, field: keyof MemberDraft, value: string) => {
    setMembers(prev => prev.map(m => {
      if (m.id !== id) return m;
      if (field === "display_name") {
        // 表示名変更時、short_name が未入力なら自動生成
        const newShort = m.short_name || value.split(/[\s　]+/).map(p => p[0]).join("").slice(0, 3);
        return { ...m, display_name: value, short_name: m.short_name ? m.short_name : newShort };
      }
      return { ...m, [field]: value };
    }));
  };

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleComplete = async () => {
    // 有効なメンバーのみ保存
    const validMembers: Member[] = members
      .filter(m => m.display_name.trim())
      .map(m => ({
        id: m.id,
        display_name: m.display_name.trim(),
        short_name: m.short_name.trim() || m.display_name.trim().slice(0, 4),
        initials: getInitials(m.display_name),
        color_bg: m.color_bg,
        color_text: m.color_text,
        teams_account: "",
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: "setup",
      }));

    setSaving(true);
    setSaveError(null);
    try {
      for (const member of validMembers) {
        await saveMember(member);
      }
      localStorage.setItem(KEYS.WIZARD_COMPLETED, "true");
      onComplete();
    } catch (e) {
      setSaveError("保存に失敗しました。Supabaseの設定を確認してください。");
      setSaving(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--color-bg-secondary)", padding: "24px",
    }}>
      <div style={{
        background: "var(--color-bg-primary)",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "var(--radius-lg)",
        width: "100%", maxWidth: "480px",
        boxShadow: "var(--shadow-md)",
        overflow: "hidden",
      }}>
        {/* ステップインジケーター */}
        <div style={{
          display: "flex", borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-secondary)",
        }}>
          {[
            { n: 1, label: "ようこそ" },
            { n: 2, label: "メンバー登録" },
            { n: 3, label: "完了" },
          ].map(({ n, label }) => (
            <div key={n} style={{
              flex: 1, padding: "10px 8px", textAlign: "center",
              fontSize: "10px", fontWeight: step === n ? "600" : "400",
              color: step >= n ? "var(--color-text-info)" : "var(--color-text-tertiary)",
              borderBottom: step === n ? "2px solid var(--color-text-info)" : "2px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: "50%", fontSize: "9px",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: step >= n ? "var(--color-bg-info)" : "var(--color-bg-tertiary)",
                color: step >= n ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                fontWeight: "600", flexShrink: 0,
              }}>
                {n}
              </span>
              {label}
            </div>
          ))}
        </div>

        {/* ステップ1：ようこそ */}
        {step === 1 && (
          <div style={{ padding: "28px 28px 20px" }}>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <div style={{
                width: 48, height: 48, borderRadius: "12px",
                background: "var(--color-brand)", display: "flex",
                alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
              }}>
                <svg width="24" height="24" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="2" width="3" height="10" rx="1" stroke="white" strokeWidth="1.2"/>
                  <rect x="5.5" y="2" width="3" height="7" rx="1" stroke="white" strokeWidth="1.2"/>
                  <rect x="10" y="2" width="3" height="4" rx="1" stroke="white" strokeWidth="1.2"/>
                </svg>
              </div>
              <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "8px" }}>
                グループ計画管理へようこそ
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                チーム全員で<br />
                プロジェクトとタスクを一元管理するツールです。
              </div>
            </div>

            <div style={{
              background: "var(--color-bg-warning)", border: "1px solid var(--color-border-warning)",
              borderRadius: "var(--radius-md)", padding: "10px 12px",
              fontSize: "11px", color: "var(--color-text-warning)", lineHeight: 1.6,
              marginBottom: "24px",
            }}>
              ⚠ 現在はデモ版です。データはこのブラウザのみに保存されます。<br />
              Supabase移行後にチーム全員でデータを共有できます。
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
              {[
                { icon: "📋", text: "カンバン・ガント・リストで進捗管理" },
                { icon: "🎯", text: "OKRと連動したプロジェクト設計" },
                { icon: "🤖", text: "AIへの相談で変更の影響を即座に把握" },
              ].map(({ icon, text }) => (
                <div key={text} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  <span style={{ fontSize: "16px" }}>{icon}</span>
                  {text}
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep(2)}
              style={{
                width: "100%", padding: "10px",
                background: "var(--color-brand)", color: "#fff",
                border: "none", borderRadius: "var(--radius-md)",
                fontSize: "13px", fontWeight: "500", cursor: "pointer",
              }}
            >
              セットアップを始める →
            </button>
          </div>
        )}

        {/* ステップ2：メンバー登録 */}
        {step === 2 && (
          <div style={{ padding: "20px 24px" }}>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "15px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "4px" }}>
                チームメンバーを登録
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                後から管理画面でいつでも変更できます
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "320px", overflow: "auto" }}>
              {members.map((m, i) => (
                <div key={m.id} style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 12px",
                  background: "var(--color-bg-secondary)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-border-primary)",
                }}>
                  {/* アバタープレビュー */}
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: m.color_bg, color: m.color_text,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11px", fontWeight: "700", flexShrink: 0,
                  }}>
                    {getInitials(m.display_name) || String(i + 1)}
                  </div>

                  <div style={{ flex: 1, display: "flex", gap: "8px", minWidth: 0 }}>
                    <input
                      value={m.display_name}
                      onChange={e => updateMember(m.id, "display_name", e.target.value)}
                      placeholder="表示名（例：田中 一郎）"
                      style={{
                        flex: 2, padding: "5px 8px", fontSize: "11px",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)", outline: "none",
                      }}
                    />
                    <input
                      value={m.short_name}
                      onChange={e => updateMember(m.id, "short_name", e.target.value)}
                      placeholder="略称（例：田中）"
                      style={{
                        flex: 1, padding: "5px 8px", fontSize: "11px",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)", outline: "none",
                      }}
                    />
                  </div>

                  {members.length > 1 && (
                    <button
                      onClick={() => removeMember(m.id)}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: "14px", color: "var(--color-text-tertiary)",
                        flexShrink: 0, padding: "0 2px",
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={addMember}
              style={{
                width: "100%", marginTop: "10px",
                padding: "7px", fontSize: "11px",
                color: "var(--color-text-tertiary)",
                background: "transparent",
                border: "1px dashed var(--color-border-primary)",
                borderRadius: "var(--radius-md)", cursor: "pointer",
              }}
            >
              ＋ メンバーを追加
            </button>

            <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  flex: 1, padding: "9px", fontSize: "12px",
                  color: "var(--color-text-secondary)",
                  background: "transparent",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)", cursor: "pointer",
                }}
              >
                ← 戻る
              </button>
              <button
                onClick={() => setStep(3)}
                style={{
                  flex: 2, padding: "9px", fontSize: "12px", fontWeight: "500",
                  background: "var(--color-brand)", color: "#fff",
                  border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
                }}
              >
                次へ →
              </button>
            </div>
          </div>
        )}

        {/* ステップ3：完了 */}
        {step === 3 && (
          <div style={{ padding: "32px 28px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "14px" }}>🎉</div>
            <div style={{ fontSize: "17px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "8px" }}>
              セットアップ完了！
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "8px", lineHeight: 1.7 }}>
              {members.filter(m => m.display_name.trim()).length}名のメンバーを登録しました。
            </div>
            <div style={{
              fontSize: "11px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-secondary)",
              borderRadius: "var(--radius-md)", padding: "10px 12px",
              marginBottom: "24px", lineHeight: 1.6,
            }}>
              管理画面からOKR・タスクフォース・プロジェクトを設定してください。
            </div>
            {saveError && (
              <div style={{
                marginBottom: "12px", padding: "10px 12px",
                background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
                border: "1px solid var(--color-border-danger)",
                borderRadius: "var(--radius-md)", fontSize: "11px",
              }}>
                {saveError}
              </div>
            )}
            <button
              onClick={handleComplete}
              disabled={saving}
              style={{
                width: "100%", padding: "11px",
                background: saving ? "var(--color-text-tertiary)" : "var(--color-brand)",
                color: "#fff",
                border: "none", borderRadius: "var(--radius-md)",
                fontSize: "13px", fontWeight: "500",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "保存中..." : "アプリを開始する"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
