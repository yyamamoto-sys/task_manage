// src/components/project/ProjectInviteModal.tsx
//
// 【設計意図】
// プロジェクト招待（部署外メンバーの受け入れ）Phase 2-1：PJから招待を発行する画面。
// docs/dev/project-invite-plan.md §7・CLAUDE.md Section 25 参照。
//
// 🔴 発行結果（コード・リンク）は create_project_invite() の戻り値でのみ得られ、DBには
// 平文で保存されないため、この画面を閉じたら二度と表示できない。「1度だけ表示」であることを
// 画面に明記し、コピーボタンを置く。
//
// エラーはformatErrorForUserを通す。create_project_invite()がRAISE EXCEPTIONで投げる
// 日本語メッセージ（「このプロジェクトを招待する権限がありません」「許可されていない
// メールドメインです（...）」等）がそのまま表示される。

import { useState } from "react";
import { createProjectInvite } from "../../lib/supabase/projectInviteStore";
import { buildInviteLink } from "../../lib/projectInvite/inviteUrl";
import { formatErrorForUser } from "../../lib/errorMessage";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

interface InviteResult {
  code: string;
  link: string;
  expiresAt: string;
}

const fieldInputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  fontSize: "13px", boxSizing: "border-box", outline: "none",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer",
};

const brandBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 16px", fontSize: "12px", fontWeight: 600,
  border: "none", borderRadius: "var(--radius-md)",
  background: disabled ? "var(--color-text-tertiary)" : "var(--color-brand)",
  color: "#fff", cursor: disabled ? "not-allowed" : "pointer",
});

export function ProjectInviteModal({ projectId, projectName, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const submitInvite = async () => {
    if (!email.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await createProjectInvite(projectId, email.trim());
      // 招待リンクの形式：アプリのURLに ?invite=<code> を付けたもの（現在のクエリ・ハッシュは
      // 引き継がない。誤って別の一時パラメータが乗るのを避ける）。
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      setResult({ code: res.code, link: buildInviteLink(baseUrl, res.code), expiresAt: res.expiresAt });
    } catch (err) {
      setError(formatErrorForUser("招待の発行に失敗しました", err));
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string, which: "code" | "link") => {
    void navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const expiresLabel = result
    ? new Date(result.expiresAt).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" })
    : "";

  return (
    <div style={{ ...modalOverlayStyle(400), background: "rgba(0,0,0,0.45)" }}>
      <div style={{
        ...modalBoxStyle("min(420px, 100%)"),
        background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            🔗 「{projectName}」に招待する
          </div>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "20px" }}>
          {!result ? (
            <form onSubmit={e => { e.preventDefault(); void submitInvite(); }}>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.7, marginBottom: "14px" }}>
                相手のメールアドレスを入力してください。招待コードとリンクを発行します（有効期限：発行から24時間）。
              </p>
              <label htmlFor="project-invite-email" style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                招待先メールアドレス
              </label>
              <input
                id="project-invite-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="example@amita-net.co.jp"
                style={fieldInputStyle}
              />
              {error && (
                <p style={{ fontSize: "12px", color: "var(--color-text-danger)", marginTop: "10px" }}>{error}</p>
              )}
            </form>
          ) : (
            <div>
              <div style={{
                padding: "10px 12px", marginBottom: "16px",
                background: "var(--color-bg-warning)", border: "1px solid var(--color-border-warning)",
                borderRadius: "var(--radius-md)", fontSize: "12px", color: "var(--color-text-warning)", lineHeight: 1.6,
              }}>
                ⚠ このコード・リンクは今だけ表示されます。閉じると二度と表示できません。必ずコピーしてから閉じてください。
              </div>

              <label htmlFor="project-invite-link" style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                招待リンク
              </label>
              <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
                <input
                  id="project-invite-link"
                  readOnly value={result.link} onFocus={e => e.target.select()}
                  style={{ ...fieldInputStyle, flex: 1, fontSize: "11px", background: "var(--color-bg-secondary)" }}
                />
                <button type="button" onClick={() => copy(result.link, "link")} style={{ ...ghostBtn, whiteSpace: "nowrap" }}>
                  {copied === "link" ? "コピーしました" : "コピー"}
                </button>
              </div>

              <label htmlFor="project-invite-code" style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                招待コード（単体）
              </label>
              <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
                <input
                  id="project-invite-code"
                  readOnly value={result.code} onFocus={e => e.target.select()}
                  style={{ ...fieldInputStyle, flex: 1, fontSize: "11px", fontFamily: "monospace", background: "var(--color-bg-secondary)" }}
                />
                <button type="button" onClick={() => copy(result.code, "code")} style={{ ...ghostBtn, whiteSpace: "nowrap" }}>
                  {copied === "code" ? "コピーしました" : "コピー"}
                </button>
              </div>

              <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                有効期限：{expiresLabel} まで（発行から24時間）
              </p>
            </div>
          )}
        </div>

        <div style={{
          ...MODAL_FOOTER_STYLE,
          padding: "12px 20px", borderTop: "1px solid var(--color-border-primary)",
          display: "flex", justifyContent: "flex-end", gap: "8px",
        }}>
          {!result ? (
            <>
              <button type="button" onClick={onClose} style={ghostBtn}>キャンセル</button>
              <button type="button" onClick={() => void submitInvite()} disabled={loading || !email.trim()} style={brandBtn(loading || !email.trim())}>
                {loading ? "発行中..." : "招待を発行"}
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose} style={brandBtn(false)}>閉じる</button>
          )}
        </div>
      </div>
    </div>
  );
}
