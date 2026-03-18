// src/components/auth/UserSelectScreen.tsx
import { useState, useEffect } from "react";
import { getCurrentUser, localStore, KEYS } from "../../lib/localData/localStore";
import type { Member } from "../../lib/localData/types";

interface Props {
  onLogin: (memberId: string) => void;
}

export function UserSelectScreen({ onLogin }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [lastUser, setLastUser] = useState<Member | null>(null);

  useEffect(() => {
    const all = localStore.get<Member>(KEYS.MEMBERS);
    setMembers(all.filter(m => !m.is_deleted));
    setLastUser(getCurrentUser());
  }, []);

  const others = members.filter(m => m.id !== lastUser?.id);

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
        padding: "28px 32px", width: "100%", maxWidth: "380px",
        boxShadow: "var(--shadow-md)",
      }}>
        {/* ロゴ */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <div style={{
              width: "28px", height: "28px", borderRadius: "var(--radius-md)",
              background: "var(--color-brand)", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="2" width="3" height="10" rx="1" stroke="white" strokeWidth="1.2"/>
                <rect x="5.5" y="2" width="3" height="7" rx="1" stroke="white" strokeWidth="1.2"/>
                <rect x="10" y="2" width="3" height="4" rx="1" stroke="white" strokeWidth="1.2"/>
              </svg>
            </div>
            <span style={{ fontSize: "15px", fontWeight: "600", color: "var(--color-text-primary)" }}>
              グループ計画管理
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", paddingLeft: "36px" }}>
            チーム計画管理ツール
          </div>
        </div>

        {/* 前回ユーザー */}
        {lastUser && (
          <div style={{ marginBottom: "14px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
              前回のユーザーで続ける
            </div>
            <button
              onClick={() => onLogin(lastUser.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 14px",
                background: "var(--color-brand-light)",
                border: "1px solid var(--color-brand-border)",
                borderRadius: "var(--radius-md)", cursor: "pointer",
                transition: "background 0.1s",
              }}
            >
              <Avatar member={lastUser} size={32} />
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-purple)" }}>
                  {lastUser.display_name}
                </div>
                <div style={{ fontSize: "10px", color: "var(--color-text-purple)", opacity: 0.7 }}>
                  クリックしてログイン
                </div>
              </div>
              <span style={{ fontSize: "16px", color: "var(--color-text-purple)" }}>→</span>
            </button>

            {others.length > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                margin: "12px 0", color: "var(--color-text-tertiary)", fontSize: "11px",
              }}>
                <div style={{ flex: 1, height: "1px", background: "var(--color-border-primary)" }}/>
                <span>または別のメンバーを選択</span>
                <div style={{ flex: 1, height: "1px", background: "var(--color-border-primary)" }}/>
              </div>
            )}
          </div>
        )}

        {/* メンバー一覧 */}
        {!lastUser && (
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "8px" }}>
            あなたはどなたですか？
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {others.map(member => (
            <MemberButton key={member.id} member={member} onClick={() => onLogin(member.id)} />
          ))}
        </div>

        {/* 注記 */}
        <div style={{
          marginTop: "16px", padding: "8px 10px",
          background: "var(--color-bg-secondary)", borderRadius: "var(--radius-sm)",
          fontSize: "10px", color: "var(--color-text-tertiary)", lineHeight: 1.6,
        }}>
          ⚠ 現在はローカルモードで動作しています。選択したユーザーは次回も自動で維持されます。
        </div>
      </div>
    </div>
  );
}

function MemberButton({ member, onClick }: { member: Member; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "8px 12px",
        background: hover ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "var(--radius-md)", cursor: "pointer",
        transition: "background 0.1s",
      }}
    >
      <Avatar member={member} size={26} />
      <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)" }}>
        {member.display_name}
      </span>
    </button>
  );
}

export function Avatar({ member, size = 24 }: { member: Member; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: member.color_bg, color: member.color_text,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: "600", flexShrink: 0,
    }}>
      {member.initials}
    </div>
  );
}
