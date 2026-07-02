# 英語化（i18n）ロードマップ — task_manage

> **目的**：アプリ全体を日本語／英語で切り替えられるようにする。
> **進め方**：[`module-map.md`](./module-map.md) のモジュール単位で**段階的**に。土台→骨格→機能を1つずつ。
> **状態**：🟢 **Phase 0（土台）完了／Phase 1 は `LoginScreen` のみ完了**（Phase 1 の残り＝`App.tsx`/`MainLayout` 本体/共通UI/認証その他画面は未着手）。最終更新 2026-07-02。

---

## 0. 決定事項（前提）

| 項目 | 決定 |
|---|---|
| 実装方式 | **軽量自前 i18n**（依存追加なし。`t("key")` ＋ JA/EN 辞書）。react-i18next は採用しない |
| 対象範囲 | **3層すべて（段階的）**：① UI文言 ② AIの応答 ③ ガイド/ヘルプ文書 |
| 翻訳しないもの | **ユーザー入力データ**（PJ名・タスク名・メモ・OKR本文等）＝原文のまま |
| 既定言語 | 日本語（`ja`）。英語（`en`）を追加。将来3言語目も足せる設計に |
| 言語の保存 | localStorage（テーマ切替と同じ要領）。端末ごと |

### 規模感（現状＝全部ハードコード日本語）
- `.tsx` で日本語を含む行 **約3,100・57ファイル**。重いのは **管理(AdminView 348)／OKR系(計約810)／計画ビュー(計約850)／AI相談(計約360)／会議(140)／骨格(MainLayout 139)**。
- 規模順：**L＝OKR・計画ビュー・管理 / M＝AI相談・会議・骨格・各ビュー / S＝グラフ・マイルストーン・共通UI小物・認証**。

---

## 1. 3つの層と扱い方

| 層 | 中身 | 扱い | 量・優先度 |
|---|---|---|---|
| **① UI文言** | ボタン・ラベル・メニュー・トースト・確認文 | `t("key")` に置換＋JA/EN辞書 | 多い・**最優先** |
| **② AIの応答** | 相談・分析・レポート等の生成文 | プロンプトに言語を渡す（systemPrompt 等に「Respond in {lang}」）。`invokeAI` 経由の各クライアントへ `lang` を伝播 | 中・UI①が一段落してから |
| **③ ガイド/文書** | `docs/guides/**` の日本語Markdown | 英語版 `docs/guides/en/**` を用意し、ロケールで出し分け（`lib/docs/manifest.ts` を locale 対応に） | 大・**最後でよい** |

---

## 2. 土台の設計（Phase 0 で作るもの・設計案）

> ✅ **実装済み**（2026-07-02）。以下は確定した実装。

**`src/lib/i18n.ts`（仕組み）**
```ts
export type Lang = "ja" | "en";
// 辞書はモジュールごとに分割し、ここで束ねる（高凝集・モジュール化）
import { commonJa, commonEn } from "../i18n/common";
import { authJa, authEn } from "../i18n/auth";
// ...
const DICT: Record<Lang, Record<string, string>> = {
  ja: { ...commonJa, ...authJa, /* ... */ },
  en: { ...commonEn, ...authEn, /* ... */ },
};
// translate(lang, "auth.tab.login") → 現在言語の文字列
//   1) 現在言語に無ければ ja にフォールバック＋console.warn
//   2) ja にも無ければ key 自体を返す＋console.warn（画面を壊さない）
// {name} 形式のプレースホルダの差し込みに対応（例：t("auth.signup.done.sentTo", { email })）
```
**言語state＋フック**：`src/stores/langStore.ts`（zustand。`useTheme` と同じ要領で localStorage
キー `KEYS.LANG` に同期）＋ `src/hooks/useT.ts` の `useT()` フック
（`lang` を selector で subscribe するため、言語切替で `useT()` を使うコンポーネントは自動再レンダーされる）。

**言語切替トグル**：実装済み。`MainLayout` のテーマ切替の隣（モバイルヘッダー／デスクトップサイドバー下部の
2箇所）に「EN」⇄「JA」ボタン（title に「🌐 日本語 | English」を表示）。

**キー命名規約**：`<module>.<area>.<name>`（例：`auth.tab.login` / `auth.signup.done.sentTo`）。
辞書ファイルは **モジュールごと**に持つ（`src/i18n/<module>.ts`）＝英語化もモジュール単位で進む。
Phase 0 では `src/i18n/common.ts`（アプリ名・汎用ボタン等）と、Phase 1 パイロット用に
`src/i18n/auth.ts`（ログイン画面）を作成した。

**日付/曜日**：`lib/date.ts` には現状 曜日名を出すロジックが無い（各画面が個別に日本語ハードコードしている）ため、
今回はスキップ（plan記載の「無ければスキップしてよい」に従った）。曜日名の英語化は該当モジュールの
Phase で個別対応する。

---

## 3. モジュール別ロードマップ（フェーズ順）

> 各フェーズの完了基準（DoD）：そのモジュールの**画面に日本語ハードコードが残っていない**／
> 言語切替で日英が切り替わる／`tsc`・テスト・build 通過。

### 🧱 Phase 0：土台（最初・小）— ✅ 完了（2026-07-02）
- `src/lib/i18n.ts`＋`src/stores/langStore.ts`＋`src/hooks/useT.ts`＋言語切替トグル（`MainLayout`）＋キー命名規約＋`src/i18n/{common,auth}.ts`。
- `lib/date.ts` のロケール対応は対象ロジックが無いためスキップ（上記 Section 2 参照）。
- テスト：`src/lib/__tests__/i18n.test.ts`（`translate()` のフォールバック・プレースホルダ差し込みを検証）。

### 🟦 Phase 1：アプリ骨格＋共通UI（みんなが見る枠）— 🟡 一部着手（`LoginScreen` のみ完了）
| 対象 | 主ファイル | 規模 | 状態 |
|---|---|---|---|
| App Shell / レイアウト | `App.tsx` / `layout/MainLayout.tsx` | M | 未着手（言語トグルの土台のみ追加済み。画面文言は未英語化） |
| 認証・ゲスト・初期設定 | `auth/{LoginScreen,UserSelectScreen,SetupWizard}` | S | `LoginScreen` ✅完了（2026-07-02）／`UserSelectScreen`・`SetupWizard` は未着手 |
| 共通UI | `components/common/*`（Toast/Confirm/EmptyState/ErrorBoundary 等） | S〜M | 未着手 |

### 🟩 Phase 2：計画ビュー（A・最も使う画面）
| 対象 | 主ファイル | 規模 |
|---|---|---|
| ダッシュボード/カルテ | `dashboard/{DashboardView,ProjectKarte,OnboardingHome}` | M |
| ガント/カンバン/リスト | `gantt/GanttView` `kanban/KanbanView` `list/ListView` | M×3 |
| タスク編集/追加 | `task/{TaskEditModal,QuickAddTaskModal,TaskSidePanel}` | M |
| マイルストーン | `milestone/*` | S |

### 🟪 Phase 3：AI相談（B）＋②AI応答の言語化
| 対象 | 主ファイル | 規模 |
|---|---|---|
| 相談UI | `consultation/*` | M |
| ②AI応答 | `lib/ai/systemPrompt.ts` ほか各 prompt に `lang` を渡し「英語で回答」分岐 | M（横断） |

### 🟧 Phase 4：OKR（D・最大級）
- `okr/*` ＋ `lab/{KrJointSessionFlow,KrReportPanel,KrWhyPanel,KrQuarterPlanPanel}` ＋ 各 AI 応答（②）。**ボリューム大**なので、さらに会議ノート/セッション/レポート/なぜなぜ/計画と**小分け**して進める。

### 🟥 Phase 5：管理・設定（F・大）／会議読み込み（C）
- `admin/{AdminView,TodoDecomposeModal}`（348行・最大の単一ファイル。タブ単位で小分け）。
- `meeting/MeetingImportPanel`＋②AI応答。

### ⬜ Phase 6：オンボーディング（G）＋グラフ（H）
- `tour/*`（文面は `tour-guidelines.md` 準拠）・`guide/*`・`graph/GraphView`。

### 📚 別トラック（③ガイド・最後でよい）
- `docs/guides/en/**` を新設し、`lib/docs/manifest.ts` を locale 対応に。ガイド本文の英訳（量大）。UIが一通り英語化されてから。

---

## 4. 進め方のルール（モジュール化を効かせる）
1. **1フェーズ＝1〜数モジュール**を完結させる（辞書ファイルもモジュール単位）。混ぜない。
2. 着手前に該当モジュールの `README.md` と本計画の該当行を見る。
3. **共通UI（Phase 1）を先に**英語化すると、以降の機能モジュールで共通部品の文言が自動的に揃う。
4. 各フェーズ完了で `tsc`・vitest・build を通し、言語切替で日英が切り替わることを目視確認。
5. 新規コードは**最初から `t()` で書く**（日本語ハードコードを増やさない）。

## 5. 留意点・リスク
- **量が多い**：UI①だけで約3,100行。一気にやらず必ずフェーズ分割。
- **AI応答②**：英語UIなのに回答が日本語、を避けるため `lang` をプロンプトまで伝播。ユーザーデータ（日本語のPJ名等）が混じる点は許容（翻訳しない）。
- **ガイド③**：英訳の維持コストが高い。優先度最後。まずUIだけでも実用価値は高い。
- **既存テスト**：日本語の文言をassertしているテスト（systemPrompt.test 等）は、英語化で文言を変える箇所に注意（キー化で吸収）。

## 6. 最初の一歩（合意できれば）
**Phase 0（土台）だけを実装**して「型」を作り、**Phase 1 の小さな1画面（例：ログイン画面）だけ**を日英対応にして動作確認する——ここまでで「やり方が回る」ことを確認してから Phase 2 以降へ。

✅ **2026-07-02 完了**：Phase 0（土台）＋ Phase 1 の `LoginScreen` のみ実装済み（詳細は Section 2・3 参照）。
`tsc`・vitest（152件）・build 通過済み。動作確認は `translate()` の単体テスト＋コードレビュー（`LoginScreen` の
日本語ハードコードが全て `t("auth.*")` に置換済み・`useT()` が `langStore` を subscribe して再レンダーされる配線）
で実施（このセッションではブラウザでの目視クリック確認は未実施）。
次は Phase 1 の残り（`App.tsx`／`MainLayout` 本体の文言／共通UI／`UserSelectScreen`・`SetupWizard`）から着手する。
