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

  const handleLogin = (memberId: string) => {
    setCurrentUser(memberId);
    const user = getCurrentUser();
    setCurrentUserState(user);
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

  // 未ログイン → ログイン画面
  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  }

  // 初回起動時はセットアップウィザードを表示
  if (!wizardCompleted) {
    return <SetupWizard onComplete={handleWizardComplete} />;
  }

  // メンバー未選択 → メンバー選択画面
  if (!currentUser) {
    return <UserSelectScreen onLogin={handleLogin} />;
  }

  return (
    <>
      <MainLayout currentUser={currentUser} onLogout={handleLogout} />
      <ConfirmModal />
    </>
  );
}
