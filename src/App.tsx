// src/App.tsx
import { useState, useEffect } from "react";
import { setCurrentUser, getCurrentUser, clearCurrentUser, KEYS, active } from "./lib/localData/localStore";
import { setGuestMode, GUEST_MEMBER } from "./lib/guestMode";
import { loadDemoDataset } from "./lib/demo/loadDemoDataset";
import { getSession, onAuthStateChange, getAuthEmail, signOut } from "./lib/supabase/auth";
import { isMisconfigured, supabase } from "./lib/supabase/client";
import { LoginScreen } from "./components/auth/LoginScreen";
import { UserSelectScreen } from "./components/auth/UserSelectScreen";
import { SetupWizard } from "./components/auth/SetupWizard";
import { AccessDeniedScreen } from "./components/auth/AccessDeniedScreen";
import { MainLayout } from "./components/layout/MainLayout";
import { ConfirmModal } from "./components/common/ConfirmModal";
import { ToastContainer, showToast } from "./components/common/Toast";
import { formatErrorForUser } from "./lib/errorMessage";
import { SchemaHealthBanner } from "./components/common/SchemaHealthBanner";
import { FullScreenLoading } from "./components/common/FullScreenLoading";
import { AppDataProvider } from "./context/AppDataContext";
import { useAppStore } from "./stores/appStore";
import { subscribeToRealtime } from "./lib/supabase/realtime";
import type { Member } from "./lib/localData/types";
import { useT } from "./hooks/useT";
import { loadPendingProjectInvite, clearPendingProjectInvite } from "./lib/projectInvite/pendingInvite";
import { acceptProjectInvite } from "./lib/supabase/projectInviteStore";
import { extractInviteCodeFromSearch } from "./lib/projectInvite/inviteUrl";
import { shouldPromptLoggedInInviteAccept, buildAcceptPayloadForExistingMember, stripInviteParamFromUrl } from "./lib/projectInvite/loggedInInviteFlow";
import { confirmDialog } from "./lib/dialog";
import { computeAccessibleGroupsForSidebar } from "./lib/projectInvite/sidebarGroupVisibility";
import { loadStoredSidebarGroupId, resolveRestoredCurrentGroupId } from "./lib/layout/sidebarCurrentGroupRestore";
import { confirmDiscardUnsavedEdits } from "./lib/editing/unsavedEditorRegistry";

export default function App() {
  const t = useT();
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUserState] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  // ゲスト（サンプル閲覧）：Supabase Authのサインインを一切行わず、サンプルデータで
  // appStoreを満たしてMainLayoutへ直接遷移する。authenticated とは独立のフラグにし、
  // AppDataProvider（Supabase load()・realtime購読）の配下に一切置かないことで、
  // ゲストがSupabaseへアクセスする経路そのものを無くす（CLAUDE.md Section 23）。
  const [guestActive, setGuestActive] = useState(false);
  // ウィザード完了フラグはlocalStorageで管理（デバイスごとの設定）
  const [wizardCompleted, setWizardCompleted] = useState(
    () => !!localStorage.getItem(KEYS.WIZARD_COMPLETED)
  );

  // Supabaseセッション確認
  //
  // 【ゲスト（サンプル閲覧）のAI用匿名セッションを認証フローに混ぜない・Phase 3】
  // ゲストがAI機能を使うと ensureGuestAiSession()（src/lib/supabase/guestAiAuth.ts）が
  // signInAnonymously() で匿名セッションを作る。この匿名セッションは通常の認証フロー
  // （AuthenticatedApp・membersとのAuto Match）を通す対象ではない。もし通してしまうと、
  // ページ再読み込み時に「ゲストなのに認証済み扱いになり、membersに存在しないため
  // AccessDeniedScreenに飛ぶ」という混乱が起きる（guestActiveはページ内stateのため
  // リロードで必ず失われるが、匿名セッション自体はlocalStorageに残るため）。
  useEffect(() => {
    getSession().then(session => {
      if (session?.user?.is_anonymous) {
        // 起動時に残っていた匿名セッションは確実に切ってから未ログイン扱いにする
        // （ネットワーク断等でsignOutが失敗しても、次回起動時に再試行されるだけで安全側）。
        void signOut().catch(() => { /* 失敗しても致命的ではない。次回起動時に再試行される */ });
        setAuthenticated(false);
        setLoading(false);
        return;
      }
      setAuthenticated(!!session);
      // currentUser は UserSelectScreen で復元するため、ここでは設定しない
      setLoading(false);
    });

    // セッション変化を監視（ゲストのAI用匿名セッションのSIGNED_INイベントは無視する。
    // guestActiveの見た目（MainLayout+GUEST_MEMBER）に影響させないため）
    const subscription = onAuthStateChange(session => {
      if (session?.user?.is_anonymous) return;
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
        <div style={{ fontSize: "20px" }}>{t("layout.app.configError.title")}</div>
        <div style={{ fontSize: "14px", color: "#666" }}>{t("layout.app.configError.body")}</div>
        <code style={{ background: "#f3f4f6", padding: "12px 20px", borderRadius: "8px", fontSize: "12px", lineHeight: 2 }}>
          VITE_SUPABASE_URL<br />
          VITE_SUPABASE_ANON_KEY
        </code>
      </div>
    );
  }

  // 【設計意図】ゲスト（サンプル閲覧）はここを通らない。ログイン画面の「サンプルを見る」
  // から handleGuestEnter で直接 guestActive に入るため、handleLogin は実ユーザーの
  // ログインのみを扱う（Section 23）。
  const handleLogin = (member: Member) => {
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

  // 【設計意図】signOut() を待たずにローカル状態だけクリアすると、currentUser が null に
  // なった瞬間に AuthenticatedApp の autoMatch()（認証セッションがまだ生きている）が
  // 再実行され、Auth email 一致で同じユーザーへ即座に自動ログインし直してしまう
  // （＝「ログアウトを押しても何も起きない」不具合の原因）。signOut() の完了を待ってから
  // ローカル状態をクリアする順序を必ず守ること。
  const handleLogout = async () => {
    // v3.89：未保存の編集（TaskEditModal/TaskSidePanel）がある状態でログアウト（ゲスト終了も
    // 同じ経路）すると、この後のwindow.location.reload()で無言のまま失われる。
    // signOut()より前に確認することで、ネットワーク断等でsignOut自体が失敗した場合に
    // 無駄な確認をさせない（先に確認→ユーザーが進むと決めてから実際のログアウト処理に入る）。
    if (!(await confirmDiscardUnsavedEdits())) return;
    try {
      await signOut();
    } catch (e) {
      // ネットワーク断等でサーバー側セッションの失効に失敗した場合。ここでローカル状態を
      // クリアしてしまうと、サーバー側セッションは生きたままなのに見た目だけログアウトした
      // ように見え、次の autoMatch() で結局同じユーザーに戻ってしまう（＝本質的には未解決）。
      // 無言で何も起きないと事故に見えるため、エラーを明示して再試行を促すだけに留める。
      showToast(formatErrorForUser("ログアウトに失敗しました", e), "error");
      return;
    }
    setGuestMode(false);
    clearCurrentUser();
    // appStore（zustand）に残った前ユーザーのタスク・PJ等をメモリ上から確実に消すため、
    // ストアの個別リセットではなくページ全体をリロードする（迷ったらリロードを選ぶ方針）。
    window.location.reload();
  };

  const handleWizardComplete = () => {
    setWizardCompleted(true);
  };

  // 【設計意図】ログイン画面の「サンプルを見る」から呼ばれる。Supabase Authのサインインは
  // 一切行わず、appStoreにサンプルデータ（src/lib/demo/）を直接注入するだけで完結する
  // （Supabaseへの接続そのものが発生しない。CLAUDE.md Section 23）。
  const handleGuestEnter = async () => {
    setGuestMode(true);
    try {
      const dataset = await loadDemoDataset();
      useAppStore.getState().loadDemoData(dataset);
      setCurrentUserState(GUEST_MEMBER);
      setGuestActive(true);
    } catch (e) {
      setGuestMode(false);
      showToast(formatErrorForUser("サンプルデータの読み込みに失敗しました", e), "error");
    }
  };

  if (loading) {
    return <FullScreenLoading message={t("layout.app.loading.preparing")} />;
  }

  // ゲスト（サンプル閲覧）：authenticated の判定より前段で分岐する。AppDataProvider配下には
  // 一切置かないため、Supabaseのload()・realtime購読が発生しない（Section 23）。
  // ログアウト経路（onLogout=handleLogout）はそのまま流用する。ゲストは認証セッションを
  // 持たないため signOut() は実質no-opになり、window.location.reload() で
  // ログイン画面に戻る（handleLogout自体に変更は不要）。
  if (guestActive) {
    return (
      <>
        <MainLayout currentUser={GUEST_MEMBER} onLogout={handleLogout} />
        <ConfirmModal />
        <ToastContainer />
      </>
    );
  }

  // 未ログイン → ログイン画面（AppDataProvider不要）
  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} onGuest={handleGuestEnter} />;
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
  const t = useT();
  const members            = useAppStore(s => s.members);
  const groups             = useAppStore(s => s.groups);
  const loading            = useAppStore(s => s.loading);
  const backgroundLoading  = useAppStore(s => s.backgroundLoading);
  const loadProgress       = useAppStore(s => s.loadProgress);
  const loadingHint        = useAppStore(s => s.loadingHint);
  const error              = useAppStore(s => s.error);
  const reload             = useAppStore(s => s.reload);
  const applyRemoteChange  = useAppStore(s => s.applyRemoteChange);
  const setCurrentGroupId  = useAppStore(s => s.setCurrentGroupId);
  const setCurrentUserIsSuperAdmin = useAppStore(s => s.setCurrentUserIsSuperAdmin);

  // DBにメンバーが1人以上存在すればウィザード完了とみなす（localStorage不要）
  const isWizardDone = wizardCompleted || (!loading && active(members).length > 0);

  // ①未登録ユーザーをSetupWizardに入れない（M25対応）：
  // RLSでは「本当にシステムが空」と「自分に権限が無いだけで0件に見える」を区別できない
  // （current_member_group_id()がNULLを返し、group_id一致チェックがNULL=偽になるだけ）。
  // isWizardDoneがfalseになり得るケースに限り、RLSを迂回するSECURITY DEFINER関数
  // is_system_bootstrapped() でサーバー側に判定してもらう。
  const [bootstrapStatus, setBootstrapStatus] = useState<"checking" | "empty" | "populated" | "error">("checking");
  useEffect(() => {
    if (loading || isWizardDone) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("is_system_bootstrapped");
        if (cancelled) return;
        if (error) throw error;
        setBootstrapStatus(data ? "populated" : "empty");
      } catch {
        if (!cancelled) setBootstrapStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [loading, isWizardDone]);

  // ②プロジェクト招待：メール確認後の初回ログイン時に保留中の招待を自動受諾する
  // （3-2の🔴要件・設計判断(a)。CLAUDE.md Section 25・src/lib/projectInvite/pendingInvite.ts
  // 冒頭コメント参照）。
  //
  // 【なぜここ（isWizardDone/matchStateより前）に置くか】
  // LoginScreenの招待登録フォーム（mode="invite"）でsignUp()した直後は、needsConfirmation
  // の値に関わらずpendingProjectInviteをlocalStorageに保存するだけで、
  // accept_project_invite()の呼び出し自体はここに一本化してある（App.tsxのトップレベルの
  // onAuthStateChangeがsignUp成功と同時にauthenticated=trueへ切り替えるレースを避けるため。
  // needsConfirmation=trueの場合も、確認メールのリンクをクリックしてこの端末に戻ってきた
  // ときに必ずここを通る）。この時点ではまだmembersにこのユーザーの行が無いため、
  // isWizardDone判定・matchStateのどちらに転んでもAccessDeniedScreen/UserSelectScreenの
  // どちらかが表示されてしまう（wizardCompletedフラグの状態に依存し、どちらが出るかは
  // 環境依存＝Section 1.6 M25の設計を参照）。どちらが出るにせよ「保留中の招待をまず
  // 自動で試す」ことを優先させたいため、両方の判定より前段でチェックする。
  const [inviteAutoAcceptChecked, setInviteAutoAcceptChecked] = useState(false);
  useEffect(() => {
    if (loading || currentUser) return;
    const pending = loadPendingProjectInvite();
    if (!pending) { setInviteAutoAcceptChecked(true); return; }
    let cancelled = false;
    (async () => {
      const authEmail = await getAuthEmail();
      if (cancelled) return;
      if (!authEmail || authEmail.toLowerCase() !== pending.email.toLowerCase()) {
        // 別ユーザーのセッション・別メールでの再ログイン等。この端末にこの保留データを
        // 残し続けると別人に誤って適用されるリスクになるため消す。
        clearPendingProjectInvite();
        // このURLの招待コードはこのセッションでは処理できなかった。残したままにすると、
        // このあと別の経路（③のログイン済み受諾フロー等）が同じコードを何度も拾い直す
        // ことになるため、ここで一緒に外す（stripInviteParamFromUrlはPhase 5で③のために
        // 作られた既存の純粋関数を再利用）。
        window.history.replaceState(null, "", stripInviteParamFromUrl(window.location.href));
        setInviteAutoAcceptChecked(true);
        return;
      }
      try {
        await acceptProjectInvite({
          code: pending.code,
          email: pending.email,
          displayName: pending.displayName,
          shortName: pending.shortName,
          initials: pending.initials,
          colorBg: pending.colorBg,
          colorText: pending.colorText,
        });
        clearPendingProjectInvite();
        // 🔴 受諾直後のURLには?invite=<code>がまだ残っている。ここで外さずにreload()すると、
        // reload後にcurrentUserが確定した瞬間、今度は③（ログイン済み既存メンバー向けの
        // URL拾い直し）が同じコードを拾って再度confirmDialogを出し、accept_project_invite()を
        // もう一度呼んで「既に使用されています」エラーになる（2026-08-18・山本さんの実機報告）。
        // reload前に必ず外す（reload後はURLから読み直すため、reload前に書き換えれば消える）。
        window.history.replaceState(null, "", stripInviteParamFromUrl(window.location.href));
        // 迷ったらリロードを選ぶ方針（handleLogoutと同じ判断）。新しく作られたmembers行を
        // RLS越しに確実に反映させるため、zustandの部分更新ではなくページ全体を再読み込みする。
        window.location.reload();
      } catch (e) {
        if (cancelled) return;
        // 失敗したら消す（無限リトライループの防止。期限切れ等は再試行しても直らない）。
        clearPendingProjectInvite();
        // 失敗時もURLに残したままにしない（再読み込みのたびに同じエラーを踏み続けるため）。
        window.history.replaceState(null, "", stripInviteParamFromUrl(window.location.href));
        showToast(formatErrorForUser("招待の受諾に失敗しました", e), "error");
        setInviteAutoAcceptChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [loading, currentUser]);

  // ③プロジェクト招待：ログイン済みの既存メンバーがURLの招待コード（?invite=<code>）を
  // 開いた場合の受け入れ（Phase 4・山本さんの指摘対応）。②の自動受諾（保留中の招待）は
  // currentUserが未確定の間だけ動く経路であり、既にmembersに登録済みの人がこのURLを
  // 開いてもautoMatch()が成功して通常画面に入るだけで、招待コードはURLに残ったまま
  // 無視されてしまっていた（行き止まり）。ここでcurrentUserが確定した後に拾い直す。
  //
  // 判定（shouldPromptLoggedInInviteAccept）・受諾ペイロードの組み立て
  // （buildAcceptPayloadForExistingMember）・URLからコードを除く処理
  // （stripInviteParamFromUrl）は src/lib/projectInvite/loggedInInviteFlow.ts の純粋関数。
  //
  // 結果（承諾・キャンセル・失敗）に関わらずURLからinviteパラメータを外す
  // （history.replaceState。ページ遷移は起こさない）：再訪問・再読み込みで同じ確認・
  // 同じRPC呼び出しが繰り返されないようにするため。
  const [inviteUrlPromptChecked, setInviteUrlPromptChecked] = useState(false);
  useEffect(() => {
    if (!currentUser || inviteUrlPromptChecked) return;
    const inviteCode = extractInviteCodeFromSearch(window.location.search);
    if (!shouldPromptLoggedInInviteAccept(inviteCode, currentUser) || !inviteCode) {
      setInviteUrlPromptChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      // 🔴 参加の確認であって削除ではない（2026-08-18・山本さんの実機報告：ボタンが赤・
      // ゴミ箱アイコン・ラベル「削除する」になっていた）。tone:"neutral"を明示する
      // （既定はdanger据え置き。src/lib/dialog.ts冒頭コメント参照）。
      const accept = await confirmDialog(t("auth.invite.urlPrompt.confirm"), {
        tone: "neutral",
        confirmLabel: t("auth.invite.member.submit"),
      });
      if (cancelled) return;
      window.history.replaceState(null, "", stripInviteParamFromUrl(window.location.href));
      if (!accept) {
        setInviteUrlPromptChecked(true);
        return;
      }
      try {
        const authEmail = await getAuthEmail();
        if (!authEmail) throw new Error("認証されたメールアドレスが取得できません");
        await acceptProjectInvite(buildAcceptPayloadForExistingMember(inviteCode, authEmail, currentUser));
        // 迷ったらリロードを選ぶ方針。新しく追加されたgroup_idsをRLS越しに確実に反映するため。
        window.location.reload();
      } catch (e) {
        if (cancelled) return;
        showToast(formatErrorForUser(t("auth.invite.urlPrompt.failed"), e), "error");
        setInviteUrlPromptChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser, inviteUrlPromptChecked, t]);

  // メンバー読み込み完了後、ログインユーザーを自動マッチング
  // 優先順位: ① Auth email でメンバーを特定 → ② localStorage の前回ユーザー
  //
  // matchState: autoMatch の非同期判定が完了するまで UserSelectScreen を
  // 出さないためのガード。"matching" の間はローディング表示に留め、
  // email/localStorage のどちらでも一致しないと確定した場合だけ "unmatched"
  // にして選択画面を出す（メール一致ユーザーには選択画面を一切見せない）。
  const [matchState, setMatchState] = useState<"matching" | "matched" | "unmatched">("matching");
  useEffect(() => {
    if (loading || currentUser) return;
    setMatchState("matching");
    let cancelled = false;
    const activeMembers = active(members);

    // 【v3.82】サイドバー「表示部署」をリロード後も維持する。保存されている部署に今も
    // アクセスできる場合だけ復元し、そうでなければホーム部署（member.group_id）へ
    // フォールバックする（兼務が外れた・部署が削除された後にその部署を復元しようとすると、
    // currentGroupIdの対応先が無くなり何も見えない画面になるため）。
    // 判定基準はサイドバーの切替UI（MainLayout.tsxのaccessibleGroups）と完全に一致させる
    // （computeAccessibleGroupsForSidebar。全社スーパー管理者・招待受諾者もこの1関数で
    // 個別分岐なしに扱える）。①②どちらの経路でログインが確定した場合も同じ判定を適用する
    // （リロード時にどちらの経路でマッチするかは環境依存＝email設定の有無で変わるため）。
    function resolveGroupIdForLogin(member: Member): string | null {
      const homeGroupId = member.group_id ?? null;
      const isSuperAdmin = member.is_super_admin === true;
      const accessibleGroupIds = computeAccessibleGroupsForSidebar(groups, member, isSuperAdmin)
        .map(g => g.id);
      const stored = loadStoredSidebarGroupId(member.id);
      return resolveRestoredCurrentGroupId(stored, homeGroupId, accessibleGroupIds);
    }

    async function autoMatch() {
      // ① Auth email が members.email と一致するメンバーを優先（セキュアな自動同定）
      const authEmail = await getAuthEmail();
      if (cancelled) return;
      if (authEmail) {
        const matched = activeMembers.find(
          m => m.email && m.email.toLowerCase() === authEmail.toLowerCase(),
        );
        if (matched) {
          setCurrentGroupId(resolveGroupIdForLogin(matched));
          setCurrentUserIsSuperAdmin(matched.is_super_admin === true);
          setMatchState("matched");
          onLogin(matched);
          return;
        }
      }
      // ② email 未設定のケース：localStorage の前回ユーザーにフォールバック
      const saved = getCurrentUser();
      const member = saved ? activeMembers.find(m => m.id === saved.id) : undefined;
      if (member) {
        setCurrentGroupId(resolveGroupIdForLogin(member));
        setCurrentUserIsSuperAdmin(member.is_super_admin === true);
        setMatchState("matched");
        onLogin(member);
        return;
      }
      if (!cancelled) setMatchState("unmatched");
    }

    void autoMatch();
    return () => { cancelled = true; };
  }, [loading, members, groups, currentUser, onLogin, setCurrentGroupId, setCurrentUserIsSuperAdmin]);

  // Realtime 購読は初期ロード完了後にだけ開始する（subscribeToRealtime 内で
  // 1 channel に複数テーブルを相乗りさせており、cleanup で必ず removeChannel される）
  useEffect(() => {
    if (loading) return;
    return subscribeToRealtime(applyRemoteChange);
  }, [loading, applyRemoteChange]);

  // プロジェクト招待：保留中の招待の自動受諾チェックが終わるまで、
  // SetupWizard/AccessDeniedScreen/UserSelectScreenのどれも出さない（上のuseEffect参照）。
  if (!loading && !currentUser && !inviteAutoAcceptChecked) {
    return <FullScreenLoading message={t("layout.app.loading.preparing")} />;
  }

  // 初回起動時はセットアップウィザードを表示（本当にシステムが空の場合のみ）
  if (!loading && !isWizardDone) {
    if (bootstrapStatus === "empty") {
      return <SetupWizard onComplete={onWizardComplete} />;
    }
    if (bootstrapStatus === "checking") {
      return <FullScreenLoading message={t("layout.app.loading.preparing")} />;
    }
    // "populated"（既に他のメンバーがいる＝自分に権限が無いだけ）または
    // "error"（is_system_bootstrapped() 呼び出し失敗。マイグレ未適用の環境など）は
    // 安全側に倒し、SetupWizardではなくアクセス拒否画面を表示する。
    // 【安全側の理由】ここで誤ってSetupWizardを出すと、未登録の第三者がgroup_id無しの
    // 宙に浮いたメンバー行を作ろうとする経路を開いてしまう（実際にはRLSのWITH CHECKで
    // 弾かれるが、ユーザーに「保存に失敗しました」という不親切な失敗を見せるより、
    // 最初から「アクセス権がありません」と正しく案内する方が安全かつ親切）。
    return <AccessDeniedScreen onLogout={onLogout} />;
  }

  // メンバー未選択かつ自動マッチング判定中 → ローディング表示
  // （email 一致/localStorage 復元の判定が終わるまで選択画面を出さない）
  if (!currentUser && !loading && matchState === "matching") {
    return <FullScreenLoading message={t("layout.app.loading.preparing")} />;
  }

  // メンバー未選択かつ自動マッチング不成立確定 → 選択画面（復元できなかった場合のフォールバック）
  if (!currentUser && !loading && matchState === "unmatched") {
    return <UserSelectScreen onLogin={onLogin} />;
  }

  // データ読み込み中（Phase 1 完了前）はローディング画面を表示
  // ※ currentUser は loading=false になってから自動復元されるため、loading 中は必ず null
  if (!currentUser) {
    return (
      <FullScreenLoading
        message={t("layout.app.loading.dataLoading")}
        progress={loadProgress}
        hint={loadingHint}
      />
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
            {t("layout.app.error.retry")}
          </button>
        </div>
      )}
      <MainLayout currentUser={currentUser} onLogout={onLogout} />
      <SchemaHealthBanner currentUser={currentUser} />
      <ConfirmModal />
      <ToastContainer />
    </>
  );
}
