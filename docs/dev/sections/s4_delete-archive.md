## 4. 削除・アーカイブ設計（確定）

### 基本方針：全層論理削除（is_deleted フラグ）

物理削除は絶対に行わない。

```typescript
// ❌ 物理削除は絶対禁止
await supabase.from('tasks').delete().eq('id', taskId);

// ✅ 論理削除
await supabase.from('tasks')
  .update({ is_deleted: true, deleted_at: new Date(), deleted_by: currentUserId })
  .eq('id', taskId);
```

### 層ごとの挙動

| 層 | 操作 | 挙動 | ダイアログ | 復元 |
|---|---|---|---|---|
| O | 削除不可・期切替 | is_current=false + archived_at記録。新Oを作成してis_current=true | なし | 参照のみ |
| KR | 論理削除 | 非表示。TFはKR欠番で残る | あり | 変更履歴から可 |
| TF | 論理削除 | 非表示。PJの紐づきのみ解除 | あり | 変更履歴から可 |
| PJ | 論理削除 | PJ＋紐づく全タスクを一括論理削除 | あり（件数表示） | 変更履歴からPJ＋タスク一括復元可 |
| Task | 論理削除 | 一覧から非表示 | あり | 変更履歴から可 |
| Member | 論理削除 | 非表示。担当タスクの assignee_member_id を null に変更 | あり（件数表示） | 変更履歴から可 |

### PJのライフサイクル状態（`status`）とサイドバー表示（v3.49・2026-08-11／v3.50で是正・2026-08-11）

`projects.status`（`active` / `completed` / `archived`）は上表の論理削除（`is_deleted`）とは別軸。
削除ではなく「今どのフェーズか」を表す。サイドバー・ダッシュボード・カンバン・ガント・リスト・
稼働状況・コマンドパレット・タスク追加系モーダルが共有する `MainLayout.tsx` の
`projects`（`filterSidebarProjects`。`src/lib/project/sidebarProjectFilter.ts`・純粋関数）は
次のルール：

- **既定では active のみ表示する。** completed・archived はどちらも既定で隠す。
- **「完了・アーカイブも表示」トグル**（`KEYS.SIDEBAR_SHOW_COMPLETED_ARCHIVED`。既定OFF・
  localStorageに記憶）でON にすると、completed・archived の両方がまとめて表示される。
- **選択中のPJが隠れて宙に浮く問題への対応**：トグルOFFのままcompleted/archived済みPJを選択して
  いると、一覧からそのPJだけが消えてハイライトが行方不明になる。`filterSidebarProjects` は
  `pinnedProjectId`（＝選択中のPJ id）を渡すとcompleted/archived判定だけを免除し、選択中のPJは
  常に一覧に残す（トグルを勝手にON にする案・選択を強制解除する案も検討し、「見ているものが
  急に消えない」を優先してこちらを採用した）。（v3.188で mineOnly によるPJ一覧の絞り込み自体を撤去した。mineOnly はタスクの絞り込みだけに効く。）
- **視覚的な区別**：一覧上でcompleted・archivedはどちらも鈍色（`--color-text-tertiary`）で
  表示するが、マークは archived=🗄・completed=✅ で区別する（同じ見た目にしない）。
- **揃えた範囲**：`MainLayout.tsx` の `projects` を共有するダッシュボード・カンバン・ガント・
  リスト・稼働状況ビュー・コマンドパレット・タスク追加/マイルストーン追加モーダルは全て
  自動的にこのルールに揃った（単一の変数を共有しているため）。体制図（`ProjectStructureView`）
  は元々`status !== "archived"`で運用済み（completedは出す）だが、これはこのSectionのルールと
  別の運用として維持している（次項の「意図的に揃えなかった範囲」参照）。
- **意図的に揃えなかった範囲**：`TaskEditModal`のPJピッカー（`active(allProjects)`＝status不問で
  is_deletedのみ除外）と`ProjectCreateModal`の「他PJから引き継ぐ」元PJ選択（`selectScopedProjects`
  そのまま）は、既存タスクの現在の紐づき先を選択肢から消さない／過去の完了・アーカイブ済みPJから
  でも引き継げるようにする、という別の目的があるため変更していない。`AdminView`のPJ一覧・編集は
  部署横断の棚卸し用途のため全ステータス表示のまま（次項参照）。

**🔴 v3.49→v3.50の訂正（経緯の記録）**：v3.49では「active・completedは常に表示・archivedのみ
トグルで隠す」という設計にしたが、これは統括の事前診断ミスに基づく誤った指示によるもので、
山本さんの要望（「完了してもサイドバーに残り続けて不便。片付けたい」）と逆方向の変更だった。
v3.49導入前の実態は`status==="active"`のみを通す＝completedもarchivedも一律で隠れる、が正しい
挙動だった。v3.50で「既定ではactiveのみ表示」に戻し、「アーカイブを表示」トグルを
「完了・アーカイブも表示」に統合してcompleted/archivedの両方をこの1トグルで扱うようにした。
**同じ判断を繰り返さないための記録**：機能追加の前提を「元の実装がこうだったから」で決め打ちせず、
コードを実際に読んで確認すること。

### PJ設定画面（Section 8参照）とAdminViewのPJ編集の使い分け（v3.49）

PJの基本情報を編集できる画面は2つある。役割が違うため両方残す：

- **AdminView「作業設定→PJ」タブ**：部署管理者・全社スーパー管理者向け。部署横断で全PJ・
  全ステータスを一覧編集する棚卸し画面。PJの削除（論理削除）もここだけ。
- **PJ設定画面（`ProjectSettingsModal`）**：PJカルテの「⚙ このPJの設定」から開く。
  今見ているPJ1件に絞った日常操作の入口（基本情報・招待・関わるメンバー）。
  基本情報タブの編集権限は**同じ部署のメンバー全員**（v3.109で管理者限定から開放。Section 55）。

### サイドバーPJ行の「⋮」メニュー（v3.54）

山本さんの指摘（2026-08-12）：「PJの設定などの場所がわかりにくい」。サイドバーの各PJ行に
「⋮」（縦三点）を追加し、そこから設定画面を開く／状態を変えられるようにした。

- **表示**：行ホバー時・フォーカス時・選択中のPJのときのみ表示する（`globals.css`の
  `.pj-row-menu-trigger`。常時表示すると行が賑やかになりすぎるため）。折りたたみ時（幅48px）・
  ゲスト・「全PJ表示」行には出さない。
- **構造**：`NavItem`は行全体が1個の`<button>`のため「⋮」を内側に置けない（buttonの入れ子は
  不可）。PJ行だけ`NavItem`をやめ、`[選択ボタン][⋮トリガー]`を並べたラッパー`<div className="pj-row">`
  に変えた（`MainLayout.tsx`の`Sidebar`。折りたたみ時は従来通り`NavItem`のまま）。
- **メニュー項目**（`src/lib/project/projectRowMenu.ts`の`buildProjectRowMenuItems()`・純粋関数）：
  「⚙ このPJの設定」は常に出す。状態変更ボタンは編集権限がある人だけに出し、
  `active`なら「✅ 完了にする」「🗄 アーカイブ」の2つ、`completed`/`archived`なら
  代わりに「↩ activeに戻す」1つだけを出す（complete/archiveを同時に出さない）。
  ゲストには空配列（呼び出し側でも`⋮`自体を描画しないため二重の防御）。
- **🔴 権限判定は1箇所に集約している**（v3.109で条件自体を「同じ部署なら誰でも」に変更。Section 55）：`ProjectSettingsModal`の基本情報編集権限
  （部署管理者・全社スーパー管理者。部署内にis_adminが1人もいなければ全員可のブートストラップ）を
  `src/lib/project/projectEditPermission.ts`の`canEditProjectBasicInfo()`に切り出し、
  `ProjectSettingsModal.tsx`とサイドバーの両方から呼ぶ（判定ロジックの複製をやめた）。
- **「⚙ このPJの設定」は既存の`ProjectSettingsModal`をそのまま開く**（新しい設定画面は
  作っていない）。`Sidebar`が`settingsModalProjectId`を持ち、未絞り込みの
  `useAppStore(s => s.projects)`から対象PJを探す（sidebarの表示用`projects`prop＝
  `filterSidebarProjects`済みのリストから探すと、モーダルを開いた後に別の操作でstatusが
  変わり一覧から消えた瞬間にモーダルまで閉じてしまうため、意図的に別ソースを使っている）。
- **保存・Undo**：状態変更は既存の`appStore.saveProject`（choke point・楽観ロック込み）を
  経由する。確認ダイアログは挟まず、実行後にトースト＋「元に戻す」を出す
  （`useBulkTaskActions.ts`の一括操作トーストと同じ流儀。Undoで戻せるため確認ダイアログは
  不要と判断した）。選択中のPJを完了・アーカイブした場合は`pinnedProjectId`の仕組み
  （本Section前項）にそのまま乗るため、一覧から消えずに残る。
- **ポップオーバーの実装**：`src/components/project/ProjectRowMenu.tsx`。`CustomSelect.tsx`と
  同じ「トリガーの`getBoundingClientRect()`からfixed座標を算出し`createPortal`で`body`直下に
  描画する」方式。画面外にはみ出さないよう、共通ユーティリティ`computeFloatingPanelPosition`
  （`src/lib/layout/floatingPanelPosition.ts`）で右端・下端をクランプ・反転する（🔴
  2026-08-20訂正：このユーティリティに切り出すまで、実は`CustomSelect.tsx`自身はクランプを
  一切持っておらず、この記述は誤りだった。`ProjectRowMenu.tsx`が元々持っていた完成済みの
  クランプ・反転ロジックを共通関数に切り出し、`CustomSelect.tsx`／`InlineEditAssignee.tsx`／
  `MentionTextarea.tsx`の4箇所全てがこれを使う形に揃えて記述を実態に合わせた）。Escape・
  外側クリック・スクロール/リサイズで閉じる。**Section 21（中央寄せモーダルの高さ上限契約）の
  対象外**：`alignItems:center + justifyContent:center`で中央寄せする全画面オーバーレイでは
  なく、`CustomSelect.tsx`のドロップダウンパネルと同種の「トリガーに追従する小さい
  ポップオーバー」のため、そもそも対象のパターンに一致しない（`CustomSelect.tsx`がSection 21の
  除外リストに入っていないのと同じ理由）。

### サイドバーの「OKRタスク」セクションを描画停止（v3.54）

山本さんの指示（2026-08-12）：「メニューバーの『OKRタスク』はあまり使われないので、
一旦非表示にしましょう。PJがTFと紐づけられる仕様になっていれば十分」。

- 計画モードのサイドバーにあった「OKRタスク」セクション（KR一覧。クリックすると
  Gantt/Kanban/Listを`selectedKrId`（`krTaskIds`）で絞り込む）の**描画だけ**を止めた
  （v3.40のOKRモード グループ側白紙化と同じ「描画経路を切るだけ」方式。ファイルは
  削除・移動していない）。
- **絞り込みロジック（`selectedKrId`/`krTaskIds`）・`keyResultsInGroup`・DBテーブル・
  `project_task_forces`（PJ↔TF紐づけ）は一切触っていない。** 入口（サイドバーのKRクリック）が
  無くなったため`selectedKrId`は常に`null`のままになるが、絞り込み自体のコードは壊れていない。
- 復帰手順は`src/components/layout/ARCHIVED.md`（新設）に記録した。`src/components/okr/
  ARCHIVED.md`は対象がOKRモードのグループ側コンポーネント（`okr/`/`lab/`配下のファイル）で
  ドメインが異なるため、混同を避けて`layout/`配下に別ファイルを作った。
- `KEYS.SIDEBAR_OKR_OPEN`・i18nキー（`layout.sidebar.okrSection*`）は削除していない
  （`localStore.ts`のコメントに「v3.54で描画停止」を追記）。トグルstate自体
  （`okrOpen`/`toggleOkrOpen`）はJSXが無くなり本当に使われなくなったため削除した
  （復帰時の書き戻し方は`layout/ARCHIVED.md`参照）。

### Objectiveの期切替フロー

```
1. 管理画面 > OKR管理 > 「新しい期に切り替える」ボタン
2. 現行のO・KR・TF全体をアーカイブ（is_current=false, archived_at=now）
3. 新しいOのタイトルと期ラベルを入力して作成（is_current=true）
4. 過去の期は管理画面「過去の期を見る」から参照のみ可能
```

---
