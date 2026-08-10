// src/i18n/auth.ja.ts
//
// 【設計意図】
// 認証まわり（ログイン/新規登録画面）の文言辞書（日本語）。Phase 1 パイロットとして
// LoginScreen.tsx の日本語ハードコードをここへ移した。
// ja/en分割の理由は src/i18n/common.ja.ts のコメント参照（v3.19）。

export const authJa = {
  "auth.tab.login": "ログイン",
  "auth.tab.signup": "新規登録",

  "auth.form.email": "メールアドレス",
  "auth.form.emailPlaceholder": "example@company.com",
  "auth.form.password": "パスワード",
  "auth.form.passwordHint": "（6文字以上）",
  "auth.form.passwordConfirm": "パスワード（確認）",

  "auth.error.passwordMismatch": "パスワードが一致しません。",
  "auth.error.passwordTooShort": "パスワードは6文字以上で設定してください。",
  "auth.error.loginFailed": "メールアドレスまたはパスワードが正しくありません。",
  "auth.error.emailAlreadyRegistered": "このメールアドレスはすでに登録されています。ログインしてください。",
  "auth.error.signupFailed": "登録に失敗しました。もう一度お試しください。",

  "auth.submit.loggingIn": "ログイン中...",
  "auth.submit.signingUp": "登録中...",
  "auth.submit.login": "ログイン",
  "auth.submit.signup": "アカウントを作成",

  "auth.note.forgotPassword": "パスワードをお忘れの場合は管理者にご連絡ください。",

  "auth.signup.done.title": "確認メールを送信しました",
  "auth.signup.done.sentTo": "{email} 宛にメールを送りました。",
  "auth.signup.done.instruction": "メール内のリンクをクリックして登録を完了してください。",
  "auth.signup.done.afterConfirm": "確認後、このページに戻ってログインしてください。",
  "auth.signup.done.noEmail": "メールが届かない場合は迷惑メールフォルダをご確認ください。",
  "auth.signup.done.backToLogin": "ログイン画面へ戻る",

  // ----- UserSelectScreen -----
  "auth.userSelect.tagline": "チーム計画管理ツール",
  "auth.userSelect.lastUserHeading": "前回のユーザーで続ける",
  "auth.userSelect.clickToLogin": "クリックしてログイン",
  "auth.userSelect.orSelectOther": "または別のメンバーを選択",
  "auth.userSelect.whoAreYou": "あなたはどなたですか？",
  "auth.userSelect.noMembersLine1": "メンバーが見つかりません。",
  "auth.userSelect.noMembersLine2": "セットアップをやり直してメンバーを登録してください。",
  "auth.userSelect.restartSetup": "セットアップをやり直す",
  "auth.userSelect.persistNote": "選択したユーザーは次回も自動で維持されます。",

  // ----- LoginScreen：サンプルを見る（ゲスト・2026-08-06） -----
  "auth.guest.divider": "または",
  "auth.guest.cta": "サンプルを見る（アカウント不要）",
  "auth.guest.loading": "サンプルを読み込み中...",
  "auth.guest.desc": "架空のデータでアプリの見た目だけ確認できます。編集はできません。AI機能は1日{limit}回まで試せます。",

  // ----- AccessDeniedScreen -----
  "auth.accessDenied.title": "アクセス権がありません",
  "auth.accessDenied.body1": "このメールアドレスはまだメンバーとして登録されていません。",
  "auth.accessDenied.body2": "管理者に連絡して、上記のメールアドレスでメンバー登録を依頼してください。登録が完了すれば、次回ログイン時に自動的にアクセスできるようになります。",
  "auth.accessDenied.logoutButton": "ログアウトして別のアカウントで入り直す",
  "auth.accessDenied.inviteCta": "プロジェクトの招待コードをお持ちの方はこちら",
  "auth.accessDenied.invite.title": "招待コードを入力",
  "auth.accessDenied.invite.subtitle": "{email} で登録します。",
  "auth.accessDenied.invite.form.code": "招待コード",
  "auth.accessDenied.invite.form.displayName": "表示名",
  "auth.accessDenied.invite.form.shortName": "略称",
  "auth.accessDenied.invite.submit": "招待を受け入れる",
  "auth.accessDenied.invite.submitting": "処理中...",
  "auth.accessDenied.invite.cancel": "キャンセル",

  // ----- プロジェクト招待（部署外メンバーの受け入れ・2026-08-10） -----
  "auth.invite.cta": "プロジェクトの招待コードをお持ちの方はこちら",
  "auth.invite.title": "招待コードで登録",
  "auth.invite.subtitle": "招待されたメールアドレスとコードを入力して、アカウントを作成してください。",
  "auth.invite.form.code": "招待コード",
  "auth.invite.form.codeHint": "招待の有効期限は発行から24時間です。期限が切れている場合は、招待した相手に再発行を依頼してください。",
  "auth.invite.form.displayName": "表示名",
  "auth.invite.form.shortName": "略称",
  "auth.invite.error.missingFields": "すべての項目を入力してください。",
  "auth.invite.error.alreadyRegistered": "このメールアドレスは既に登録されています。ログインしてから「プロジェクトの招待コードをお持ちの方」の代わりに、アクセス拒否画面の招待コード入力からお試しください。",
  "auth.invite.error.submitFailed": "登録に失敗しました",
  "auth.invite.submit": "登録する",
  "auth.invite.submitting": "登録中...",
  "auth.invite.backToLogin": "← ログインへ戻る",
  "auth.invite.awaiting.deadlineWarning": "招待の有効期限は24時間です。確認メールの確認が遅れると招待コードが失効します。失効した場合は招待した相手に再発行を依頼してください。",

  // ----- SetupWizard -----
  "auth.setup.step1.tabLabel": "ようこそ",
  "auth.setup.step2.tabLabel": "部署・メンバー登録",
  "auth.setup.step3.tabLabel": "完了",
  "auth.setup.step1.title": "グループ計画管理へようこそ",
  "auth.setup.step1.subtitle1": "チーム全員で",
  "auth.setup.step1.subtitle2": "プロジェクトとタスクを一元管理するツールです。",
  "auth.setup.step1.infoBox": "ℹ ここで登録したメンバーはSupabaseに保存され、チーム全員でリアルタイムに共有されます。",
  "auth.setup.step1.feature1": "カンバン・ガント・リストで進捗管理",
  "auth.setup.step1.feature2": "OKRと連動したプロジェクト設計",
  "auth.setup.step1.feature3": "AIへの相談で変更の影響を即座に把握",
  "auth.setup.step1.startButton": "セットアップを始める →",
  "auth.setup.step2.title": "部署とチームメンバーを登録",
  "auth.setup.step2.subtitle": "部署名は後から管理画面で変更できます。メンバーも後からいつでも追加・変更できます",
  "auth.setup.step2.groupNamePlaceholder": "部署名 ※必須（例：EGG、AID など）",
  "auth.setup.step2.youBadge": "👑 あなた（この部署の最初のメンバー・自動的に管理者になります）",
  "auth.setup.step2.displayNamePlaceholder": "表示名 ※必須（例：田中 一郎）",
  "auth.setup.step2.shortNamePlaceholder": "略称 ※必須（例：田中）",
  "auth.setup.step2.addMemberButton": "＋ メンバーを追加",
  "auth.setup.step2.groupNameRequired": "部署名を入力してください。",
  "auth.setup.step2.incompleteWarning": "未入力のメンバーが {count} 件あります。空欄のままだと保存されません。",
  "auth.setup.step2.back": "← 戻る",
  "auth.setup.step2.next": "次へ →",
  "auth.setup.step2.nextTitleReady": "次のステップへ進む",
  "auth.setup.step2.nextTitleBlocked": "部署名の入力、および表示名と略称を1名以上入力してください",
  "auth.setup.step3.title": "セットアップ完了！",
  "auth.setup.step3.summary": "部署「{group}」を作成し、{count}名のメンバーを登録します。",
  "auth.setup.step3.note": "最初のメンバーはこの部署の管理者・全社スーパー管理者になります。管理画面からOKR・タスクフォース・プロジェクトを設定してください。",
  "auth.setup.step3.startAppButton": "アプリを開始する",
  "auth.setup.step3.saving": "保存中...",
  "auth.setup.error.noMembers": "メンバーを1名以上入力してください",
  "auth.setup.error.noAuthEmail": "ログイン中のメールアドレスが取得できませんでした。一度ログインし直してください",
  "auth.setup.error.groupCreateFailed": "部署の作成に失敗しました",
  "auth.setup.error.saveFailed": "保存に失敗しました",
} as const;
