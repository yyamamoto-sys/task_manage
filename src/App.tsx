// src/App.tsx
import { useState, useEffect } from "react";
import { getCurrentUser, setCurrentUser, KEYS } from "./lib/localData/localStore";
import { getSession, onAuthStateChange } from "./lib/supabase/auth";
import { isMisconfigured } from "./lib/supabase/client";
import { LoginScreen } from "./components/auth/LoginScreen";
import { UserSelectScreen } from "./components/auth/UserSelectScreen";
import { SetupWizard } from "./components/auth/SetupWizard";
import { MainLayout } from "./components/layout/MainLayout";
import { ConfirmModal } from "./components/common/ConfirmModal";
import { AppDataProvider, useAppData } from "./context/AppDataContext";
import type { Member } from "./lib/localData/types";

export default function App() {
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
      if (session) {
        const saved = getCurrentUser();
        setCurrentUserState(saved);
      }
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

  const handleLogin = (member: Member) => {
    setCurrentUser(member.id);
    setCurrentUserState(member);
  };

  const handleLogout = () => {
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
  const { error, reload } = useAppData();

  // 初回起動時はセットアップウィザードを表示
  if (!wizardCompleted) {
    return <SetupWizard onComplete={onWizardComplete} />;
  }

  // メンバー未選択 → メンバー選択画面
  if (!currentUser) {
    return <UserSelectScreen onLogin={onLogin} />;
  }

  return (
    <>
      {error && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
          border: "1px solid var(--color-border-danger)",
          padding: "10px 16px", fontSize: "12px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ flex: 1 }}>⚠ データの取得に失敗しました: {error}</span>
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
    </>
  );
}
