// src/App.tsx
import { useState, useEffect } from "react";
import { setCurrentUser, getCurrentUser, clearCurrentUser, KEYS, active } from "./lib/localData/localStore";
import { setGuestMode, isGuestMember } from "./lib/guestMode";
import { getSession, onAuthStateChange, getAuthEmail } from "./lib/supabase/auth";
import { isMisconfigured } from "./lib/supabase/client";
import { LoginScreen } from "./components/auth/LoginScreen";
import { UserSelectScreen } from "./components/auth/UserSelectScreen";
import { SetupWizard } from "./components/auth/SetupWizard";
import { MainLayout } from "./components/layout/MainLayout";
import { ConfirmModal } from "./components/common/ConfirmModal";
import { ToastContainer } from "./components/common/Toast";
import { AppDataProvider } from "./context/AppDataContext";
import { useAppStore } from "./stores/appStore";
import { subscribeToRealtime } from "./lib/supabase/realtime";
import type { Member } from "./lib/localData/types";

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUserState] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  // ウィザード完了フラグはlocalStorageで管理（デバイスごとの設定）
  const [wizardCompleted, setWizardCompleted] = useState(
    () => !!localStorage.getItem(KEYS.WIZARD_COMPLETED)
  );

  // Supabaseセッション確認
  useEffect(() => {
    getSession().then(session => {
      setAuthenticated(!!session);
      // currentUser は UserSelectScreen で復元するため、ここでは設定しない
      setLoading(false);
    });

    // セッション変化を監視
    const subscription = onAuthStateChange(session => {
      setAuthenticated(!!session);
      if (!session) {
        setCurrentUserState(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 環境変数未設定の早期returnは全フック宣言の後に置く（react-hooks/rules-of-hooks 対応）。
  // isMisconfigured はモジュール定数で実行時に値が変わることはないが、
  // ESLintのルールに従いフックより前には置かない。
  if (isMisconfigured) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: "20px" }}>⚠️ 設定エラー</div>
        <div style={{ fontSize: "14px", color: "#666" }}>Vercel の Environment Variables に以下を設定してください</div>
        <code style={{ background: "#f3f4f6", padding: "12px 20px", borderRadius: "8px", fontSize: "12px", lineHeight: 2 }}>
          VITE_SUPABASE_URL<br />
          VITE_SUPABASE_ANON_KEY
        </code>
      </div>
    );
  }

  const handleLogin = (member: Member) => {
    if (isGuestMember(member)) {
      // ゲストは閲覧専用。書き込みブロックを有効化し、localStorage には保存しない
      // （次回起動時にゲストへ自動復元されないように）。
      setGuestMode(true);
      setCurrentUserState(member);
      return;
    }
    setGuestMode(false);
    setCurrentUser(member.id);
    setCurrentUserState(member);

    // members.email が未登録なら、Authのログインメールで一度だけ自動補完する。
    // 新規登録画面はSupabase Authのアカウント作成のみを行い members.email へは反映されない
    // 設計のため、ここで埋めておかないと①のAuth email自動マッチングもTeamsメンションも機能しない。
    if (!member.email) {
      void (async () => {
        const authEmail = await getAuthEmail();
        if (!authEmail) return;
        try {
          await useAppStore.getState().saveMember({ ...member, email: authEmail, updated_by: member.id });
        } catch { /* 失敗しても致命的ではないため黙って無視（次回ログイン時に再試行される） */ }
      })();
    }
  };

  const handleLogout = () => {
    setGuestMode(false);
    clearCurrentUser();
    setCurrentUserState(null);
  };

  const handleWizardComplete = () => {
    setWizardCompleted(true);
  };

  if (loading) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "20px", height: "20px", border: "2px solid #e5e7eb", borderTopColor: "#7F77DD", borderRadius: "50%" }} className="animate-spin" />
      </div>
    );
  }

  // 未ログイン → ログイン画面（AppDataProvider不要）
  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  }

  // 認証済み → AppDataProviderでSupabaseデータをロード
  return (
    <AppDataProvider>
      <AuthenticatedApp
        wizardCompleted={wizardCompleted}
        currentUser={currentUser}
        onWizardComplete={handleWizardComplete}
        onLogin={handleLogin}
        onLogout={handleLogout}
      />
    </AppDataProvider>
  );
}

// ===== 認証済み後のルーティング =====

interface AuthenticatedAppProps {
  wizardCompleted: boolean;
  currentUser: Member | null;
  onWizardComplete: () => void;
  onLogin: (member: Member) => void;
  onLogout: () => void;
}

function AuthenticatedApp({
  wizardCompleted, currentUser, onWizardComplete, onLogin, onLogout,
}: AuthenticatedAppProps) {
  const members            = useAppStore(s => s.members);
  const loading            = useAppStore(s => s.loading);
  const backgroundLoading  = useAppStore(s => s.backgroundLoading);
  const loadProgress       = useAppStore(s => s.loadProgress);
  const loadingHint        = useAppStore(s => s.loadingHint);
  const error              = useAppStore(s => s.error);
  const reload             = useAppStore(s => s.reload);
  const applyRemoteChange  = useAppStore(s => s.applyRemoteChange);
  const setCurrentGroupId  = useAppStore(s => s.setCurrentGroupId);

  // DBにメンバーが1人以上存在すればウィザード完了とみなす（localStorage不要）
  const isWizardDone = wizardCompleted || (!loading && active(members).length > 0);

  // メンバー読み込み完了後、ログインユーザーを自動マッチング
  // 優先順位: ① Auth email でメンバーを特定 → ② localStorage の前回ユーザー
  useEffect(() => {
    if (loading || currentUser) return;
    const activeMembers = active(members);

    async function autoMatch() {
      // ① Auth email が members.email と一致するメンバーを優先（セキュアな自動同定）
      const authEmail = await getAuthEmail();
      if (authEmail) {
        const matched = activeMembers.find(
          m => m.email && m.email.toLowerCase() === authEmail.toLowerCase(),
        );
        if (matched) {
          setCurrentGroupId(matched.group_id ?? null);
          onLogin(matched);
          return;
        }
      }
      // ② email 未設定のケース：localStorage の前回ユーザーにフォールバック
      const saved = getCurrentUser();
      if (!saved) return;
      const member = activeMembers.find(m => m.id === saved.id);
      if (member) {
        setCurrentGroupId(member.group_id ?? null);
        onLogin(member);
      }
    }

    void autoMatch();
  }, [loading, members, currentUser, onLogin, setCurrentGroupId]);

  // Realtime 購読は初期ロード完了後にだけ開始する（subscribeToRealtime 内で
  // 1 channel に複数テーブルを相乗りさせており、cleanup で必ず removeChannel される）
  useEffect(() => {
    if (loading) return;
    return subscribeToRealtime(applyRemoteChange);
  }, [loading, applyRemoteChange]);

  // 初回起動時はセットアップウィザードを表示
  if (!loading && !isWizardDone) {
    return <SetupWizard onComplete={onWizardComplete} />;
  }

  // メンバー未選択かつ自動復元待ち → 選択画面（復元できなかった場合のフォールバック）
  if (!currentUser && !loading) {
    return <UserSelectScreen onLogin={onLogin} />;
  }

  // データ読み込み中（Phase 1 完了前）はローディング画面を表示
  // ※ currentUser は loading=false になってから自動復元されるため、loading 中は必ず null
  if (!currentUser) {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: "24px",
        background: "var(--color-bg-primary)",
      }}>
        {/* アイコン */}
        <svg width="40" height="40" viewBox="0 0 40 40" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
          <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-bg-tertiary)" strokeWidth="3" />
          <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-brand)" strokeWidth="3"
            strokeLinecap="round" strokeDasharray="68 38" />
        </svg>

        {/* テキスト＋プログレスバー */}
        <div style={{ textAlign: "center", lineHeight: 1.6, width: "200px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "6px" }}>
            データを読み込み中...
          </div>

          {/* 決定的プログレスバー */}
          <div style={{
            height: "5px", borderRadius: "3px",
            background: "var(--color-bg-tertiary)", overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${loadProgress}%`,
              background: "var(--color-brand)",
              borderRadius: "3px",
              transition: "width 0.25s ease",
            }} />
          </div>

          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
            {loadingHint || `${loadProgress}%`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* バックグラウンドローディングバー: OKRデータ（Phase 2）取得中に表示 */}
      {backgroundLoading && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 9998,
          background: "var(--color-bg-tertiary)",
          pointerEvents: "none",
        }}>
          <div style={{
            height: "100%",
            width: `${loadProgress}%`,
            background: "var(--color-brand)",
            transition: "width 0.25s ease",
          }} />
        </div>
      )}
      {error && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
          border: "1px solid var(--color-border-danger)",
          padding: "10px 16px", fontSize: "12px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ flex: 1 }}>⚠ {error}</span>
          <button
            onClick={reload}
            style={{
              padding: "4px 12px", fontSize: "11px", fontWeight: "500",
              background: "var(--color-text-danger)", color: "#fff",
              border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
            }}
          >
            再試行
          </button>
        </div>
      )}
      <MainLayout currentUser={currentUser} onLogout={onLogout} />
      <ConfirmModal />
      <ToastContainer />
    </>
  );
}
