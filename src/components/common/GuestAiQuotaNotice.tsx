// src/components/common/GuestAiQuotaNotice.tsx
//
// 【設計意図・v3.31】
// ゲスト（サンプル閲覧）に「AI機能は1日◯回まで試せます」を使う前に明示する注意書き。
// 表示する残り回数は src/lib/guestAiQuotaCounter.ts のlocalStorageベースの参考値であり、
// 実際の回数制限はEdge Function → consume_guest_ai_quota()（SQL）だけが行う
// （CLAUDE.md Section 23）。ここではボタンの無効化は一切しない。クライアント側の値だけで
// 誤って締め出すと、サーバー側ではまだ枠が残っているのに使えなくなる事故が起きるため。
//
// ゲストでないときは常に null を返す。呼び出し側に isGuestMember 分岐を書かせないため、
// どの画面にも無条件で置いてよい。
//
// 【あえて useT() フックを使わない理由】
// src/lib/ai/invokeAI.ts の tOutside と同じ「素の関数」方式（useLangStore.getState() +
// translate()）を使う。
// (1) 設置先のConsultationPanel/ProjectKarte/DashboardViewはi18n Phase 2凍結の対象外画面
//     （日本語固定・docs/dev/i18n-plan.md参照）。MainLayoutはuseT()で自前に再レンダーする
//     ため、そちら経由でこのコンポーネントも再評価され言語トグルに追従する。
// (2) vitest.config.ts が environment:"node" のためReactレンダラーが無い状態でこの関数を
//     直接呼んでテストする（フックはレンダー文脈が無いと "Invalid hook call" になり使えない）。

import { isGuestMode } from "../../lib/guestMode";
import { useLangStore } from "../../stores/langStore";
import { translate } from "../../lib/i18n";
import { GUEST_AI_DAILY_LIMIT, getGuestAiRemainingToday } from "../../lib/guestAiQuotaCounter";

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(useLangStore.getState().lang, key, vars);
}

interface Props {
  /** banner: 既存の帯（オレンジのゲストバナー等）に馴染む1行。inline: 枠付きの単体表示 */
  variant: "banner" | "inline";
}

export function GuestAiQuotaNotice({ variant }: Props) {
  if (!isGuestMode()) return null;

  const remaining = getGuestAiRemainingToday();
  const text = remaining > 0
    ? t("common.guest.quota.remaining", { limit: GUEST_AI_DAILY_LIMIT, remaining })
    : t("common.guest.quota.exhausted", { limit: GUEST_AI_DAILY_LIMIT });

  if (variant === "banner") {
    return <span>・{text}</span>;
  }

  // margin は持たせない（配置先ごとにレイアウト方向が異なるため。呼び出し側の
  // flexコンテナのgapに乗る想定。gapは実際にDOMへ描画された要素間にしか効かないため、
  // ゲストでない時（この関数がnullを返す時）に余分な空白が生まれることもない）
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "4px 10px", fontSize: "11px", fontWeight: 500,
      borderRadius: "var(--radius-full)",
      border: "1px solid var(--color-border-secondary)",
      background: "var(--color-bg-secondary)",
      color: "var(--color-text-secondary)",
    }}>
      <span>🧪</span>{text}
    </div>
  );
}
