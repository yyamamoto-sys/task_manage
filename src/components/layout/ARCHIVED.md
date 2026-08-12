# レイアウト（サイドバー）：描画停止した機能の台帳

**日付**：2026-08-12（v3.54）
**対象**：サイドバーの「プロジェクト」一覧の下にあった「OKRタスク」セクション（`layout.sidebar.okrSectionLabel`。KR一覧を表示し、クリックするとGantt/Kanban/Listを`selectedKrId`（`krTaskIds`）で絞り込む機能）。
**理由**：山本さんの判断（2026-08-12）。「メニューバーの『OKRタスク』はあまり使われないので、一旦非表示にしましょう。PJがTFと紐づけられる仕様になっていれば十分」。
**方式**：v3.40（`src/components/okr/ARCHIVED.md`）と同じ「描画経路を切るだけ」。ファイルは削除・移動しない。

## この台帳を `src/components/okr/ARCHIVED.md` に置かなかった理由

`src/components/okr/ARCHIVED.md` はOKR**モード**のグループ側機能（`GroupOkrDashboardArchived.tsx`等、`src/components/okr/`/`src/components/lab/`配下の複数ファイル）のアーカイブ台帳であり、対象はコンポーネントファイル単位の退避。
今回の対象は計画**モード**のサイドバー内の1ブロック（`MainLayout.tsx`の`Sidebar`コンポーネント内、`keyResults.length > 0`のJSXブロック）で、`okr/`配下のファイルには一切手を触れていない。ドメインが異なる（レイアウト／サイドバーの入口 vs OKRモードのグループ機能本体）ため、混同を避けて`src/components/layout/`に新規の台帳を置いた。

## 切った描画経路（ファイルは残るがコード側の呼び出し口を撤去した箇所）

- `src/components/layout/MainLayout.tsx`の`Sidebar`コンポーネント：`appMode==="plan"`のプロジェクト一覧の下にあった
  ```
  {keyResults.length > 0 && (<>
    {!c && (<button onClick={toggleOkrOpen} ...>{t("layout.sidebar.okrSectionLabel")}</button>)}
    {(c || okrOpen) && keyResults.map(kr => (<NavItem ... onClick={() => onSelectKr(...)} />))}
  </>)}
  ```
  のブロック全体を削除し、コメント1行に置き換えた。

## 触っていないもの（復帰させなくてよい・そもそも変更していない）

- **`selectedKrId`・`handleSelectKr`・`krTaskIds`（`MainLayout.tsx`）**：Gantt/Kanban/Listの絞り込みロジック自体は変更していない。入口（サイドバーのKRクリック）が無くなったことで`selectedKrId`は常に`null`のままになり、結果的に絞り込みは発生しなくなるが、ロジック自体は壊れていない。
- **`keyResults`データ取得（`fetchOkrData`等）**：起動時フェッチはガント/カンバンのTF・ToDoピッカー等が使うため維持。
- **`project_task_forces`（PJ↔TF紐づけ）**：山本さんの言葉通り「PJがTFと紐づけられる仕様」は今回変更していない（PJカルテ・ガント等の既存の紐づけUIはそのまま）。
- **`KEYS.SIDEBAR_OKR_OPEN`・i18nキー（`layout.sidebar.okrSection*`）**：削除しない。`localStore.ts`のコメントに「v3.54で描画停止」を追記した。

## 復帰させるときに何を戻せばよいか

1. `MainLayout.tsx`の`Sidebar`コンポーネントに、上記「切った描画経路」のJSXブロックを`{(c || pjOpen) && (<>...</>)}`ブロックの直後（元の位置）に戻す。
2. 🔴 `okrOpen`/`toggleOkrOpen`のstateはv3.54で削除した（JSXが無くなり本当に使われなくなったため。
   `KEYS.SIDEBAR_OKR_OPEN`のキー自体は残っている）。旧実装と同じ形にするには
   `const [okrOpen, setOkrOpen] = useState<boolean>(() => { try { return localStorage.getItem(KEYS.SIDEBAR_OKR_OPEN) !== "0"; } catch { return true; } });`
   と`toggleOkrOpen`関数を`pjOpen`と同じ形で書き戻す。
3. `KrIcon()`関数はそのまま残っている（v3.54で削除していない）ため戻す必要はない。
4. 本ファイル冒頭の注記を削除する。
