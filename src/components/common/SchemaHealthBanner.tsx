// src/components/common/SchemaHealthBanner.tsx
//
// 【設計意図】
// マイグレーション適用漏れ（2026-08-06、on_hold/cancelledステータスのCHECK制約が本番に
// 未適用のまま約2週間気づかれなかった事故）を、起動時に管理者にだけ検知・警告する
// 非ブロッキングのバナー。Human in the loop：検知して知らせるだけで、スキーマを
// 自動修正することは絶対にしない（CLAUDE.md Section 22参照）。
//
// - 表示対象は部署管理者（is_admin）・全社スーパー管理者（is_super_admin）のみ。
//   一般メンバーにはこのコンポーネントは何も表示しない（RPCも呼ばない＝無駄な通信をしない）。
// - 起動時に1回だけ checkSchemaHealth を呼ぶ。await で初回描画をブロックしない
//   （useEffect内でfire-and-forgetし、結果が届いた時点でのみ再レンダーする）。
// - 閉じるとその場では消えるが、localStorageには何も保存しない。次回読み込み時には
//   （問題が解消していなければ）また表示される——今回のように2週間放置されるのを防ぐため。
// - RPC自体が未適用（この仕組みのマイグレ自体が未適用）の場合も、黙って無効化せず
//   「検査を実行できません」を出す（v3.19のDL確認ゲートが黙って無効化されうる件と同じ
//   轍を踏まないため。CLAUDE.md Section 19参照）。

import { useEffect, useState } from "react";
import type { Member } from "../../lib/localData/types";
import { runSchemaHealthCheck, type SchemaHealthResult } from "../../lib/schema/checkSchemaHealth";
import { useT } from "../../hooks/useT";

interface Props {
  currentUser: Member;
}

export function SchemaHealthBanner({ currentUser }: Props) {
  const t = useT();
  const isAdmin = currentUser.is_admin === true || currentUser.is_super_admin === true;
  const [result, setResult] = useState<SchemaHealthResult | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void runSchemaHealthCheck().then(r => {
      if (!cancelled) setResult(r);
    });
    return () => { cancelled = true; };
    // currentUser.id が変わる（ログインユーザー切替）たびに再検査する
  }, [isAdmin, currentUser.id]);

  if (!isAdmin || dismissed || !result) return null;
  if (result.status === "ok" || result.status === "unknown") return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed", top: "16px", right: "16px", zIndex: 150,
        width: "min(380px, calc(100vw - 32px))",
        background: "var(--color-bg-warning)",
        border: "1px solid var(--color-border-warning)",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
        padding: "12px 14px",
        fontSize: "12px",
        lineHeight: 1.5,
        color: "var(--color-text-warning)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <span style={{ flexShrink: 0, fontSize: "14px" }}>⚠️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
            {result.status === "rpc_unavailable"
              ? t("common.schemaHealth.rpcUnavailable")
              : t("common.schemaHealth.title")}
          </div>
          {result.status === "missing" && (
            <>
              <div style={{ marginBottom: "4px", opacity: 0.9 }}>
                {t("common.schemaHealth.body")}
              </div>
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {result.items.map(item => (
                  <li key={item.id} style={{ marginBottom: "4px" }}>
                    {item.label}
                    <br />
                    <span style={{ opacity: 0.75, fontFamily: "monospace", fontSize: "10.5px", wordBreak: "break-all" }}>
                      {item.migration}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          title={t("common.button.close")}
          style={{
            flexShrink: 0, background: "transparent", border: "none",
            color: "var(--color-text-warning)", cursor: "pointer",
            fontSize: "14px", padding: 0, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
