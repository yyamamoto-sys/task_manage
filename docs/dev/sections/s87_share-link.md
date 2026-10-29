## 87. プロジェクト・ビュー・タスクのリンク共有（v3.192・2026-10-29）

メンバーにPJ・ビュー・タスクを共有するためのリンクを、コピーで発行する。アドレスバーは画面操作に追従させない（コピーで発行する方式のみ・戻るボタン対応は今回の範囲外）。

- URL形式（既存の `/?open=` 方式。純関数は `src/lib/share/shareLink.ts`）
  - PJ：`/?open=project&pid=<projectId>`
  - PJ＋ビュー：`/?open=project&pid=<projectId>&view=<viewKey>`。許可する viewKey＝`dashboard` / `kanban` / `gantt` / `list` / `workload`（未知の値は無視してPJだけ開く）
  - タスク：`/?open=task&tid=<taskId>`
  - id は UUID 形式のみ受理。形が違えば無視する。組み立ては `window.location.origin` を使う（本番・dev どちらでも動く）。
- 受け側（MainLayout の起動時 effect）
  - 読んだら `stripOpenParam` で open・pid・view・tid を消す（他のクエリ・ハッシュは残す）。ゲストにも効かせるため、既存の通知用 `open=` effect（ゲストは対象外）とは別の effect にした。
  - MainLayout は読込完了後にしか出ない（App.tsx）ので、その時点の store を引いて存在を判定する。権限は RLS で見える行だけが store に入っていることに任せ、新しい権限ロジックは作っていない。
  - 見つからない・権限なし・削除済み：トースト「このリンクのプロジェクト（タスク）は見つからないか、閲覧権限がありません」を出し、通常の初期画面のまま。個人タスク（PJなし）のリンクは本人以外には同じ扱い。
  - 表示部署に入っていない行は、自分が選べる部署のうち行が属するもの（`pickAccessibleGroupId`）へ切り替える（サイドバーの部署切替と同じ。選べる部署に属さなければ見つからない扱い）。
  - 画面遷移は `guardedNavigate`（Section 46）を通す。タスクは PJ へ切り替えたうえで、コマンドパレットなどと同じ `TaskEditModal`（`aiEditTaskId`）で開く。
  - トーストは `setTimeout` で遅らせる：`ToastContainer` は MainLayout の後に mount され、同じ commit の effect では購読が間に合わず消えるため。
- ログイン前に開いた場合：ログイン画面・ユーザー選択はURLを書き換えないので、`?open=…` は残ったまま、ログイン後に MainLayout が起動時に読む。メール確認・パスワード再設定で別URLへ戻る経路だけは、リンクが消える。
- 発行側（`CopyLinkButton`・`copyShareLink`。コピーは `src/lib/clipboard.ts`）
  - PJ：サイドバーのPJ行「⋮」メニュー「リンクをコピー」（`projectRowMenu.ts` の `copyLink`。編集権限・ゲストの別に関わらず常に出す）
  - ビュー：サイドバー「メニュー」見出しの右の🔗（PC）／モバイルヘッダーのPJ選択の隣の🔗。PJ未選択（マイタスク等）では出さない
  - タスク：タスク詳細（TaskSidePanel・TaskEditModal）の見出しの🔗
- i18n：`layout.shareLink.*`・`layout.sidebar.pjRowMenu.copyLink`（ja/en）。
- テスト：`src/lib/share/__tests__/shareLink.test.ts`（組み立て・解析・strip・部署の選択・配線の走査）。DB変更なし・MIN_CLIENT_VERSION 据え置き。
