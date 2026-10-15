// src/components/settings/SettingsView.tsx
//
// 【設計意図・v3.155 で作り直し】
// 設定ボタンから開く画面。トップはカード一覧（個人／部署の管理／アプリの管理）、カードを押すと詳細ページ。
// 階層は「トップ→詳細」の2段だけ。目次（左ナビ）・パンくずは置かず、戻る手段は見出しバーの「← 設定」の1つ。
// 見出しバー（← 設定／ページ名／？／✕）はこのコンポーネントが持つ（旧 MainLayout の adminOverlay のバーを移した）。
// ブラウザの戻るには対応しない（アプリは popstate を使わず、ガイド・ラボ・設定は画面内の状態で切り替える）。
// 設計の正本：docs/dev/設計仕様_設定画面リニューアル_20261015.md ／ CLAUDE.md Section 65。
//
// ページの定義・権限は src/lib/settings/settingsPages.ts が唯一の正本。詳細ページは離れるとアンマウントする。
// 未保存の確認は Section 46 のレジストリに一本化し、設定内の遷移は guardedSwitch だけを通す
// （src/components/layout/__tests__/guardedNavigateCoverage.test.ts が固定）。
//
// 個人の設定を足すときは必ずこのページのどこかに置く（Section 65）。
// テーマは useTheme が useState（インスタンスごと）のため、サイドバーと状態を共有するよう
// MainLayout から theme/onToggleTheme を受け取る。言語は zustand（langStore）なので直接使う。

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Member } from "../../lib/localData/types";
import { useAppStore } from "../../stores/appStore";
import { useT } from "../../hooks/useT";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useAdminCounts, useAdminScope } from "../../hooks/useAdminScope";
import { confirmDiscardUnsavedEdits } from "../../lib/editing/unsavedEditorRegistry";
import { withBellReserve } from "../../lib/layout/topRightBell";
import {
  buildSettingsCardGroups, canViewSettingsPage, isAdminPageId, resolveRequestedPage, resolveSettingsAudience,
  settingsPageDef, settingsPageDescKey, settingsPageTitleKey,
  type AdminPageId, type SettingsPageId,
} from "../../lib/settings/settingsPages";
import { SettingsHelpButton } from "./SettingsHelpButton";
import { SettingsTop } from "./SettingsTop";
import { ProfilePage, AccountPage, DisplayPage, HelpPage } from "./PersonalPages";
import { NotificationSettingsSection } from "./NotificationSettingsSection";

/** カードの1行説明より詳しい本文先頭の説明がある個人ページ（無いページはカードの1行説明をそのまま使う） */
const PAGE_LEAD_KEY: Partial<Record<SettingsPageId, string>> = {
  profile: "layout.settings.profile.lead",
  display: "layout.settings.display.lead",
  notify: "layout.settings.notify.lead",
  help: "layout.settings.help.lead",
};

interface Props {
  currentUser: Member;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  /** 部署の管理・アプリの管理ページの中身（MainLayout が lazy＋DLゲート付きの AdminView を渡す） */
  renderAdminPage: (page: AdminPageId) => ReactNode;
  /** ✕ で設定を閉じる（MainLayout が guardedNavigate で包んで渡す） */
  onClose: () => void;
  onOpenGuide: () => void;
  onRestartTour: () => void;
  onOpenShortcuts: () => void;
  onLogout: () => void;
  /** PC のみ（モバイルにはサイドバー幅が無い） */
  onResetSidebarWidth?: () => void;
  /** 開いたときに表示するページ（ベル・通知・ダッシュボード・オンボーディングから直接ジャンプ）。権限が無い・不明な ID はトップ */
  initialPage?: SettingsPageId;
}

export function SettingsView(props: Props) {
  const { currentUser } = props;
  const t = useT();
  const isMobile = useIsMobile();
  const members = useAppStore(s => s.members);
  const audience = useMemo(() => resolveSettingsAudience(currentUser, members), [currentUser, members]);
  const cardGroups = useMemo(() => buildSettingsCardGroups(audience), [audience]);
  const scope = useAdminScope(currentUser);
  const counts = useAdminCounts(scope.selectedGroupId);
  const [requestedPage, setPage] = useState<SettingsPageId | null>(() => resolveRequestedPage(props.initialPage, audience));
  // 権限が後から変わって見えなくなったページはトップとして扱う
  const page: SettingsPageId | null = requestedPage && canViewSettingsPage(requestedPage, audience) ? requestedPage : null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef(0);

  // 設定内の遷移（カード→詳細／← 設定）は未保存編集レジストリの確認を通す（Section 46・47）
  const guardedSwitch = async (action: () => void) => {
    if (!(await confirmDiscardUnsavedEdits())) return;
    action();
  };
  const openPage = (id: SettingsPageId) => void guardedSwitch(() => {
    topScrollRef.current = scrollRef.current?.scrollTop ?? 0;
    setPage(id);
  });
  const backToTop = () => void guardedSwitch(() => setPage(null));

  // トップへ戻ったときはスクロール位置を復元、詳細を開いたときは先頭から
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = page === null ? topScrollRef.current : 0;
  }, [page]);

  const padX = isMobile ? "16px" : "32px";
  const padY = isMobile ? "16px" : "24px";
  const barPadX = isMobile ? 16 : 24;
  const def = page ? settingsPageDef(page) : null;
  const adminDetail = page !== null && isAdminPageId(page);
  const showDeptChip = def?.deptScoped === true && scope.showDeptLabel;

  const intro = page ? (
    <div style={{ fontSize: "13px", lineHeight: 1.7, color: "var(--color-text-secondary)" }}>
      <span>{t(PAGE_LEAD_KEY[page] ?? settingsPageDescKey(page))}</span>
      {page === "groups" && <span> {t("layout.settings.page.groups.note")}</span>}
      {showDeptChip && (
        <span style={{
          marginLeft: "10px", display: "inline-block", padding: "2px 10px", borderRadius: "99px",
          fontSize: "12px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)",
          color: "var(--color-text-primary)", whiteSpace: "nowrap",
        }}>
          🏢 {t("layout.settings.deptChip", { name: scope.selectedGroupName })}
        </span>
      )}
    </div>
  ) : null;

  const renderPersonal = (id: SettingsPageId) => {
    switch (id) {
      case "profile": return <ProfilePage currentUser={currentUser} />;
      case "account": return <AccountPage currentUser={currentUser} onLogout={props.onLogout} />;
      case "display": return <DisplayPage theme={props.theme} onToggleTheme={props.onToggleTheme} onResetSidebarWidth={props.onResetSidebarWidth} />;
      case "notify": return <NotificationSettingsSection currentUser={currentUser} />;
      case "help": return <HelpPage onOpenGuide={props.onOpenGuide} onRestartTour={props.onRestartTour} onOpenShortcuts={props.onOpenShortcuts} />;
      default: return null;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <div style={{
        minHeight: "56px", padding: `8px ${barPadX}px`, paddingRight: isMobile ? withBellReserve(16) : withBellReserve(24),
        borderBottom: "1px solid var(--color-border-primary)", background: "var(--color-bg-secondary)",
        display: "flex", alignItems: "center", gap: "12px", flexShrink: 0,
      }}>
        {page !== null && (
          <button
            type="button"
            onClick={backToTop}
            style={{
              display: "inline-flex", alignItems: "center", flexShrink: 0, minHeight: "36px", padding: "0 12px",
              fontSize: "14px", cursor: "pointer", color: "var(--color-text-primary)",
              background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
            }}
          >{isMobile ? "‹" : "←"} {t("layout.settings.back")}</button>
        )}
        <div style={{ flex: 1, minWidth: 0, fontSize: "18px", fontWeight: 700, lineHeight: 1.4, color: "var(--color-text-primary)" }}>
          {page ? t(settingsPageTitleKey(page)) : t("layout.admin.title")}
        </div>
        <SettingsHelpButton currentUser={currentUser} title={t("layout.admin.helpTitle")} />
        <button
          type="button"
          onClick={props.onClose}
          aria-label={t("layout.settings.close")}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px 6px", lineHeight: 1,
          }}
        >✕</button>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
        overflowY: adminDetail ? "hidden" : "auto",
      }}>
        {page === null && (
          <div style={{ width: "100%", maxWidth: "960px", margin: "0 auto", padding: `${padY} ${padX}`, boxSizing: "border-box" }}>
            <SettingsTop
              groups={cardGroups}
              counts={counts}
              deptName={scope.showDeptLabel ? scope.selectedGroupName : null}
              onOpen={openPage}
            />
          </div>
        )}
        {page !== null && !adminDetail && (
          <div style={{ width: "100%", maxWidth: "720px", margin: "0 auto", padding: `${padY} ${padX}`, boxSizing: "border-box" }}>
            <div style={{ marginBottom: "16px" }}>{intro}</div>
            {renderPersonal(page)}
          </div>
        )}
        {adminDetail && (
          <>
            <div style={{ width: "100%", maxWidth: "960px", margin: "0 auto", padding: `${padY} ${padX} 0`, boxSizing: "border-box", flexShrink: 0 }}>
              {intro}
            </div>
            <div key={page} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {props.renderAdminPage(page as AdminPageId)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
