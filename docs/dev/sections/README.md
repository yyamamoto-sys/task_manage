# docs/dev/sections/ — CLAUDE.md の節ごとの原文

- 分割日：2026-10-23（分割時点の HEAD＝32e4cfd・v3.179）
- 理由：サブエージェントが task_manage で起動するたびに CLAUDE.md 全文（5,639行）が自動で読み込まれ、巡回1回あたり10〜49万トークンを消費していたため。CLAUDE.md を「目次＋常時守るルールの要約」に絞り、原文を1節1ファイルへ移した。
- 原文は1行も変更していない（各 `## ` 見出し行から次の `## ` の直前までをそのまま移動）。節番号も変えていない。
- 新しい節はここへ `sNN_<slug>.md` として追加し、CLAUDE.md の目次に1行（グランドルールなら要約にも1項目）足す。
- 冒頭（1〜13行目）・伝言板・Section 0・Section 1（元の1〜55行）は CLAUDE.md にも原文のまま残してあり、ここにもファイルがある。
- 例外：伝言板の節（`s00_message-board.md`）は 2026-10-27 に、管理者以外の PC で clone しても成り立つ条件付きの記述（リポジトリ外の資料は存在する場合のみ読む）へ書き直した。CLAUDE.md 側も同じ。

## 元の行範囲との対応（分割前の CLAUDE.md の行番号）

| 節 | ファイル | 元の行範囲 |
|---|---|---|
| - | s00_message-board.md | 14〜25 |
| 0 | s0_overview.md | 26〜36 |
| 1 | s1_tech-stack.md | 37〜55 |
| 1.5 | s1_5_state-management.md | 56〜83 |
| 1.6 | s1_6_multi-tenancy-roles.md | 84〜181 |
| 2 | s2_six-layers.md | 182〜227 |
| 3 | s3_data-model.md | 228〜586 |
| 4 | s4_delete-archive.md | 587〜738 |
| 5 | s5_concurrency.md | 739〜850 |
| 6 | s6_ai-integration.md | 851〜1092 |
| 7 | s7_change-history.md | 1093〜1123 |
| 8 | s8_screens.md | 1124〜1163 |
| 9 | s9_open-issues.md | 1164〜1176 |
| 10 | s10_dev-notes.md | 1177〜1218 |
| 11 | s11_doc-update-rules.md | 1219〜1233 |
| 12 | s12_related-docs.md | 1234〜1246 |
| 13 | s13_file-structure.md | 1247〜1344 |
| 14 | s14_refactoring.md | 1345〜1357 |
| 14.5 | s14_5_tour-rules.md | 1358〜1376 |
| 14.6 | s14_6_mypage-widget-rules.md | 1377〜1397 |
| 15 | s15_error-display.md | 1398〜1461 |
| 16 | s16_ai-usage-metering.md | 1462〜1509 |
| 17 | s17_ai-ui-parity.md | 1510〜1544 |
| 18 | s18_ai-edge-security.md | 1545〜1608 |
| 19 | s19_download-volume.md | 1609〜1712 |
| 20 | s20_no-position-fixed.md | 1713〜1779 |
| 21 | s21_modal-height.md | 1780〜1827 |
| 22 | s22_migration-schema-check.md | 1828〜1856 |
| 23 | s23_guest-mode.md | 1857〜1948 |
| 24 | s24_personal-okr.md | 1949〜2417 |
| 25 | s25_project-invite.md | 2418〜2482 |
| 26 | s26_ai-non2xx-error.md | 2483〜2498 |
| 27 | s27_pdf-attach.md | 2499〜2521 |
| 28 | s28_okr-import-split.md | 2522〜2540 |
| 29 | s29_release-history.md | 2541〜2564 |
| 30 | s30_sidebar-resize.md | 2565〜2584 |
| 31 | s31_view-header-flex.md | 2585〜2601 |
| 32 | s32_sidebar-misc.md | 2602〜2617 |
| 33 | s33_invite-permissions.md | 2618〜2669 |
| 34 | s34_invitee-experience.md | 2670〜2697 |
| 35 | s35_ai-suggest-undo.md | 2698〜2810 |
| 36 | s36_invitee-gaps.md | 2811〜2929 |
| 37 | s37_pdf-client-extract.md | 2930〜2977 |
| 38 | s38_schema-check-fn-body.md | 2978〜3006 |
| 39 | s39_rls-security-definer.md | 3007〜3094 |
| 40 | s40_visible-member-ids.md | 3095〜3136 |
| 41 | s41_display-group-persist.md | 3137〜3179 |
| 42 | s42_popover-clamp.md | 3180〜3250 |
| 43 | s43_fab-bottom-stack.md | 3251〜3326 |
| 44 | s44_explicit-save.md | 3327〜3372 |
| 45 | s45_sidepanel-save-fail.md | 3373〜3403 |
| 46 | s46_unsaved-warning.md | 3404〜3449 |
| 47 | s47_guarded-navigate.md | 3450〜3505 |
| 48 | s48_save-button-disabled.md | 3506〜3542 |
| 49 | s49_zoom-fab-shift.md | 3543〜3589 |
| 50 | s50_bottom-stack-height.md | 3590〜3616 |
| 51 | s51_portal-pointer-events.md | 3617〜3650 |
| 52 | s52_okr-registry.md | 3651〜3698 |
| 53 | s53_backup-phase4.md | 3699〜3729 |
| 54 | s54_task-reorder.md | 3730〜3763 |
| - | sxx_vercel-best-practices.md | 3764〜3789 |
| 55 | s55_pj-info-edit.md | 3790〜3839 |
| 56 | s56_ai-bulk-rename.md | 3840〜3936 |
| 57 | s57_edit-history-undo.md | 3937〜4049 |
| 58 | s58_assumption-check.md | 4050〜4158 |
| 59 | s59_scan-test-comments.md | 4159〜4210 |
| 60 | s60_compact-display.md | 4211〜4255 |
| 61 | s61_fetch-all-rows.md | 4256〜4327 |
| 62 | s62_ai-progress.md | 4328〜4388 |
| 63 | s63_reload-notice.md | 4389〜4494 |
| 64 | s64_personal-okr-week-test.md | 4495〜4552 |
| 65 | s65_settings-page.md | 4553〜4672 |
| 66 | s66_deadline-reminder.md | 4673〜4755 |
| 67 | s67_notification-registry.md | 4756〜4857 |
| 68 | s68_admin-announcement.md | 4858〜4956 |
| 69 | s69_uset-deps.md | 4957〜4977 |
| 70 | s70_members-write-perm.md | 4978〜5015 |
| 71 | s71_display-group-scope.md | 5016〜5061 |
| 72 | s72_guide-undo-mention.md | 5062〜5094 |
| 73 | s73_ai-target-scope.md | 5095〜5129 |
| 74 | s74_gantt-zoom.md | 5130〜5143 |
| 75 | s75_ai-attachment.md | 5144〜5173 |
| 76 | s76_realtime-resync.md | 5174〜5300 |
| 77 | s77_inline-add.md | 5301〜5351 |
| 78 | s78_pj-group-deliverable.md | 5352〜5395 |
| 79 | s79_password-reset.md | 5396〜5430 |
| 80 | s80_gantt-row-gap.md | 5431〜5439 |
| 81 | s81_list-multiselect.md | 5440〜5485 |
| 82 | s82_feedback-stage1.md | 5486〜5548 |
| 83 | s83_announce-tour.md | 5549〜5584 |
| 84 | s84_tour-bubble-hidden.md | 5585〜5596 |
| 85 | s85_keyboard-shortcuts.md | 5597〜5631 |
| 86 | s86_small-font-switch.md | 5632〜5640 |
