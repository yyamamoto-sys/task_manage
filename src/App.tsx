// src/App.tsx
import { useState, useEffect } from "react";
import { getCurrentUser, setCurrentUser, KEYS } from "./lib/localData/localStore";
import { UserSelectScreen } from "./components/auth/UserSelectScreen";
import { SetupWizard } from "./components/auth/SetupWizard";
import { MainLayout } from "./components/layout/MainLayout";
import { ConfirmModal } from "./components/common/ConfirmModal";
import type { Member } from "./lib/localData/types";

export default function App() {
  const [currentUser, setCurrentUserState] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardCompleted, setWizardCompleted] = useState(true);

  useEffect(() => {
    const saved = getCurrentUser();
    setCurrentUserState(saved);
    const completed = !!localStorage.getItem(KEYS.WIZARD_COMPLETED);
    setWizardCompleted(completed);
    setLoading(false);
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

  // 初回起動時はセットアップウィザードを表示
  if (!wizardCompleted) {
    return <SetupWizard onComplete={handleWizardComplete} />;
  }

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
