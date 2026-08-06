// src/i18n/auth.en.ts
//
// 【設計意図】
// auth.ja.ts の英語版。動的import専用モジュール（理由はsrc/i18n/common.ja.tsのコメント参照）。

import type { authJa } from "./auth.ja";

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

  "auth.userSelect.tagline": "Team plan management tool",
  "auth.userSelect.lastUserHeading": "Continue as the last user",
  "auth.userSelect.clickToLogin": "Click to log in",
  "auth.userSelect.orSelectOther": "Or choose another member",
  "auth.userSelect.whoAreYou": "Who are you?",
  "auth.userSelect.noMembersLine1": "No members found.",
  "auth.userSelect.noMembersLine2": "Please redo the setup to register members.",
  "auth.userSelect.restartSetup": "Redo setup",
  "auth.userSelect.persistNote": "The user you select will be remembered automatically next time.",

  // ----- LoginScreen: view sample (guest, 2026-08-06) -----
  "auth.guest.divider": "or",
  "auth.guest.cta": "View sample (no account needed)",
  "auth.guest.loading": "Loading sample...",
  "auth.guest.desc": "See what the app looks like with fictional data. Editing is disabled.",

  "auth.accessDenied.title": "Access denied",
  "auth.accessDenied.body1": "This email address is not yet registered as a member.",
  "auth.accessDenied.body2": "Please ask an administrator to register you with the email address above. Once registered, you'll be able to access the app automatically the next time you log in.",
  "auth.accessDenied.logoutButton": "Log out and sign in with a different account",

  "auth.setup.step1.tabLabel": "Welcome",
  "auth.setup.step2.tabLabel": "Register department & members",
  "auth.setup.step3.tabLabel": "Done",
  "auth.setup.step1.title": "Welcome to Group Plan Manager",
  "auth.setup.step1.subtitle1": "A tool for your whole team to",
  "auth.setup.step1.subtitle2": "manage projects and tasks in one place.",
  "auth.setup.step1.infoBox": "ℹ Members you register here are stored in Supabase and shared in real time with the whole team.",
  "auth.setup.step1.feature1": "Track progress with Kanban, Gantt, and List views",
  "auth.setup.step1.feature2": "Design projects linked to OKRs",
  "auth.setup.step1.feature3": "See the impact of changes instantly by consulting AI",
  "auth.setup.step1.startButton": "Start setup →",
  "auth.setup.step2.title": "Register your department and team members",
  "auth.setup.step2.subtitle": "The department name can be changed later in Settings. Members can also be added or changed anytime.",
  "auth.setup.step2.groupNamePlaceholder": "Department name *required (e.g. EGG, AID)",
  "auth.setup.step2.youBadge": "👑 You (the first member of this department — will automatically become an admin)",
  "auth.setup.step2.displayNamePlaceholder": "Display name *required (e.g. Ichiro Tanaka)",
  "auth.setup.step2.shortNamePlaceholder": "Short name *required (e.g. Tanaka)",
  "auth.setup.step2.addMemberButton": "＋ Add a member",
  "auth.setup.step2.groupNameRequired": "Please enter a department name.",
  "auth.setup.step2.incompleteWarning": "{count} member(s) are incomplete. Blank entries won't be saved.",
  "auth.setup.step2.back": "← Back",
  "auth.setup.step2.next": "Next →",
  "auth.setup.step2.nextTitleReady": "Proceed to the next step",
  "auth.setup.step2.nextTitleBlocked": "Please enter a department name, and at least one member's display name and short name",
  "auth.setup.step3.title": "Setup complete!",
  "auth.setup.step3.summary": "This will create the department \"{group}\" and register {count} member(s).",
  "auth.setup.step3.note": "The first member will become this department's admin and company-wide super admin. Set up OKRs, task forces, and projects from the Settings screen.",
  "auth.setup.step3.startAppButton": "Start the app",
  "auth.setup.step3.saving": "Saving...",
  "auth.setup.error.noMembers": "Please enter at least one member",
  "auth.setup.error.noAuthEmail": "Couldn't retrieve the email address you're logged in with. Please log in again",
  "auth.setup.error.groupCreateFailed": "Failed to create the department",
  "auth.setup.error.saveFailed": "Save failed",
};
