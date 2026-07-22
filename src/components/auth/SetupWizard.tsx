// src/components/auth/SetupWizard.tsx
//
// 【設計意図】
// 初回起動時のみ表示するセットアップウィザード。App.tsx側でis_system_bootstrapped()
// による判定を経て「システムに本当に誰もいない」場合のみ表示される（M25対応）。
// ステップ1: ようこそ（アプリ概要説明）
// ステップ2: 部署名＋メンバー登録（チームメンバーを追加）
// ステップ3: 完了
//
// 【ブートストラップの仕組み】
// このアプリのRLSでは、部署（groups）の新規作成はsuper-admin限定・membersの
// is_admin/is_super_admin/group_idは自己昇格ガード付きのため、通常のクライアント
// INSERTでは「誰もいない状態から最初の部署と管理者を作る」ことができない。
// そこで完了時、リストの先頭（有効な）メンバーを「あなた（この部署の最初のメンバー）」
// として扱い、SECURITY DEFINER関数 bootstrap_first_group_and_member() を1回だけ
// 呼び出す。この関数は「membersが0件のときに限り」部署作成＋そのメンバーを
// is_admin=true かつ is_super_admin=true として作成する（CLAUDE.md Section 1.6の
// 「ブートストラップ猶予」と同じ考え方をDB関数として明文化したもの）。
// 2人目以降のメンバーは、ブートストラップ後にcurrentGroupIdが設定された状態で
// 通常のsaveMember経由で登録する（super-adminになった直後の自分は他人の行も
// 作成できるため、通常のRLSで問題なく通る）。
//
// 完了後に WIZARD_COMPLETED フラグを localStorage に保存し、
// 2回目以降は表示しない。

import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { KEYS } from "../../lib/localData/localStore";
import { useAppStore } from "../../stores/appStore";
import { supabase } from "../../lib/supabase/client";
import { getAuthEmail } from "../../lib/supabase/auth";
import { formatErrorForUser } from "../../lib/errorMessage";
import type { Member } from "../../lib/localData/types";

interface Props {
  onComplete: () => void;
}

const AVATAR_COLORS = [
  { bg: "var(--avatar-0-bg)", text: "var(--avatar-0-text)" },
  { bg: "var(--avatar-1-bg)", text: "var(--avatar-1-text)" },
  { bg: "var(--avatar-2-bg)", text: "var(--avatar-2-text)" },
  { bg: "var(--avatar-3-bg)", text: "var(--avatar-3-text)" },
  { bg: "var(--avatar-4-bg)", text: "var(--avatar-4-text)" },
  { bg: "var(--avatar-5-bg)", text: "var(--avatar-5-text)" },
  { bg: "var(--avatar-6-bg)", text: "var(--avatar-6-text)" },
  { bg: "var(--avatar-7-bg)", text: "var(--avatar-7-text)" },
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
  const saveMember = useAppStore(s => s.saveMember);
  const setCurrentGroupId = useAppStore(s => s.setCurrentGroupId);
  const reload = useAppStore(s => s.reload);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [groupName, setGroupName] = useState("");
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
    // 有効なメンバーのみ保存。先頭が「あなた（この部署の最初のメンバー）」になる。
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

    const [you, ...rest] = validMembers;
    if (!you) {
      setSaveError("メンバーを1名以上入力してください");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const authEmail = await getAuthEmail();
      if (!authEmail) {
        throw new Error("ログイン中のメールアドレスが取得できませんでした。一度ログインし直してください");
      }

      // ブートストラップ専用のSECURITY DEFINER関数を1回だけ呼ぶ。
      // 「membersが0件のときに限り」部署＋最初のメンバー（super-admin）を作成する。
      const { data, error } = await supabase.rpc("bootstrap_first_group_and_member", {
        p_group_name: groupName.trim(),
        p_display_name: you.display_name,
        p_short_name: you.short_name,
        p_initials: you.initials,
        p_color_bg: you.color_bg,
        p_color_text: you.color_text,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const newGroupId = row?.group_id as string | undefined;
      if (!newGroupId) throw new Error("部署の作成に失敗しました");

      // これ以降のcurrentGroupId注入（saveMember等）が新しい部署を向くようにする。
      setCurrentGroupId(newGroupId);

      // 残りのメンバー（あなた以外）は通常のsaveMember経由で登録する。
      // 直前のブートストラップで「あなた」がis_super_admin=trueになっているため、
      // 他人の行を新しい部署に作成してもRLSで弾かれない。
      for (const member of rest) {
        await saveMember(member);
      }

      // ブートストラップで作った部署・メンバーをローカルstoreに反映する
      // （SECURITY DEFINER関数経由の変更はstoreのオプティミスティック更新を経由しないため）。
      await reload();

      localStorage.setItem(KEYS.WIZARD_COMPLETED, "true");
      onComplete();
    } catch (e) {
      setSaveError(formatErrorForUser("保存に失敗しました", e));
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
            { n: 2, label: "部署・メンバー登録" },
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
              background: "var(--color-bg-info)", border: "1px solid var(--color-border-info)",
              borderRadius: "var(--radius-md)", padding: "10px 12px",
              fontSize: "11px", color: "var(--color-text-info)", lineHeight: 1.6,
              marginBottom: "24px",
            }}>
              ℹ ここで登録したメンバーはSupabaseに保存され、チーム全員でリアルタイムに共有されます。
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

        {/* ステップ2：部署名＋メンバー登録 */}
        {step === 2 && (
          <div style={{ padding: "20px 24px" }}>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "15px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "4px" }}>
                部署とチームメンバーを登録
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                部署名は後から管理画面で変更できます。メンバーも後からいつでも追加・変更できます
              </div>
            </div>

            <div style={{ marginBottom: "14px" }}>
              <input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="部署名 ※必須（例：EGG、AID など）"
                aria-required="true"
                style={{
                  width: "100%", padding: "7px 10px", fontSize: "12px",
                  border: `1px solid ${!groupName.trim() ? "var(--color-border-warning)" : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-bg-primary)",
                  color: "var(--color-text-primary)", outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {(() => {
              const firstValidId = members.find(m => m.display_name.trim() && m.short_name.trim())?.id;
              return (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "300px", overflow: "auto" }}>
              {members.map((m, i) => (
                <div key={m.id}>
                  {m.id === firstValidId && (
                    <div style={{ fontSize: "10px", color: "var(--color-text-info)", marginBottom: "4px", fontWeight: 600 }}>
                      👑 あなた（この部署の最初のメンバー・自動的に管理者になります）
                    </div>
                  )}
                  <div style={{
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
                      placeholder="表示名 ※必須（例：田中 一郎）"
                      aria-required="true"
                      style={{
                        flex: 2, padding: "5px 8px", fontSize: "11px",
                        border: `1px solid ${!m.display_name.trim() ? "var(--color-border-warning)" : "var(--color-border-primary)"}`,
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)", outline: "none",
                      }}
                    />
                    <input
                      value={m.short_name}
                      onChange={e => updateMember(m.id, "short_name", e.target.value)}
                      placeholder="略称 ※必須（例：田中）"
                      aria-required="true"
                      style={{
                        flex: 1, padding: "5px 8px", fontSize: "11px",
                        border: `1px solid ${!m.short_name.trim() ? "var(--color-border-warning)" : "var(--color-border-primary)"}`,
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
                </div>
              ))}
            </div>
              );
            })()}

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

            {(() => {
              const validMembers = members.filter(m => m.display_name.trim() && m.short_name.trim());
              const incompleteCount = members.length - validMembers.length;
              const hasGroupName = !!groupName.trim();
              const canProceed = validMembers.length > 0 && hasGroupName;
              return (
                <>
                  {!hasGroupName && (
                    <div style={{
                      marginTop: "8px", padding: "6px 10px",
                      background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
                      borderRadius: "var(--radius-sm)", fontSize: "11px", lineHeight: 1.5,
                    }}>
                      部署名を入力してください。
                    </div>
                  )}
                  {incompleteCount > 0 && (
                    <div style={{
                      marginTop: "8px", padding: "6px 10px",
                      background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
                      borderRadius: "var(--radius-sm)", fontSize: "11px", lineHeight: 1.5,
                    }}>
                      未入力のメンバーが {incompleteCount} 件あります。空欄のままだと保存されません。
                    </div>
                  )}
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
                      disabled={!canProceed}
                      title={canProceed ? "次のステップへ進む" : "部署名の入力、および表示名と略称を1名以上入力してください"}
                      style={{
                        flex: 2, padding: "9px", fontSize: "12px", fontWeight: "500",
                        background: canProceed ? "var(--color-brand)" : "var(--color-bg-tertiary)",
                        color: canProceed ? "#fff" : "var(--color-text-tertiary)",
                        border: "none", borderRadius: "var(--radius-md)",
                        cursor: canProceed ? "pointer" : "not-allowed",
                      }}
                    >
                      次へ →
                    </button>
                  </div>
                </>
              );
            })()}
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
              部署「{groupName.trim()}」を作成し、{members.filter(m => m.display_name.trim()).length}名のメンバーを登録します。
            </div>
            <div style={{
              fontSize: "11px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-secondary)",
              borderRadius: "var(--radius-md)", padding: "10px 12px",
              marginBottom: "24px", lineHeight: 1.6,
            }}>
              最初のメンバーはこの部署の管理者・全社スーパー管理者になります。管理画面からOKR・タスクフォース・プロジェクトを設定してください。
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
