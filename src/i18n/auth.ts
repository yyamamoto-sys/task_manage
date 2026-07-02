// src/i18n/auth.ts
//
// 【設計意図】
// 認証まわり（ログイン/新規登録画面）の文言辞書。Phase 1 パイロットとして
// LoginScreen.tsx の日本語ハードコードをここへ移した。

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
} as const;

export const authEn: Record<keyof typeof authJa, string> = {
  "auth.tab.login": "Login",
  "auth.tab.signup": "Sign up",

  "auth.form.email": "Email address",
  "auth.form.emailPlaceholder": "example@company.com",
  "auth.form.password": "Password",
  "auth.form.passwordHint": "(6+ characters)",
  "auth.form.passwordConfirm": "Password (confirm)",

  "auth.error.passwordMismatch": "Passwords do not match.",
  "auth.error.passwordTooShort": "Password must be at least 6 characters.",
  "auth.error.loginFailed": "Incorrect email or password.",
  "auth.error.emailAlreadyRegistered": "This email is already registered. Please log in instead.",
  "auth.error.signupFailed": "Registration failed. Please try again.",

  "auth.submit.loggingIn": "Logging in...",
  "auth.submit.signingUp": "Signing up...",
  "auth.submit.login": "Login",
  "auth.submit.signup": "Create account",

  "auth.note.forgotPassword": "If you forgot your password, please contact your administrator.",

  "auth.signup.done.title": "Confirmation email sent",
  "auth.signup.done.sentTo": "We've sent an email to {email}.",
  "auth.signup.done.instruction": "Please click the link in the email to complete your registration.",
  "auth.signup.done.afterConfirm": "After confirming, please return to this page and log in.",
  "auth.signup.done.noEmail": "If you don't receive the email, please check your spam folder.",
  "auth.signup.done.backToLogin": "Back to login",
};
