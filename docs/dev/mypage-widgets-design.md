# マイページ（ウィジェット）設計・計画

作成：2026-07-27 ／ 状態：**設計のみ（未実装）**
関連：`CLAUDE.md` Section 8（画面一覧）・`docs/dev/module-map.md`

---

## 0. 何をつくるか

ラボ機能として **「マイページ」** を追加する。各メンバーが「自分がほしい情報のかたまり（ウィジェット）」を選んで自分の画面に並べられる、iPhone のウィジェット画面に相当するもの。

最終的に目指す状態（山本さんの要望）：

1. ウィジェットの種類は、アップデートによって増やしていける
2. 各メンバーが自分の画面を自由にカスタムできる
3. **将来的に、仕様に従って自分で（Claude Code などで）ウィジェットを作り、取り込めるようにする**

3 は最初から実装しない。ただし **3 が後から可能になる型で 1・2 をつくる**ことが本設計の最重要要件である。後から差し込むのが最も高いのは「ウィジェットがどうやってデータを受け取るか」の契約なので、そこだけは Phase 1 から正しく切る。

---

## 1. アーキテクチャ（3層に分ける）

```
┌─────────────────────────────────────────────┐
│ ① ホスト画面  MyPageView                     │  ← 並べる・追加する・消す・サイズを変える
│    （ラボのオーバーレイとして開く）              │
├─────────────────────────────────────────────┤
│ ② レジストリ  widgetRegistry                 │  ← 「どんなウィジェットが存在するか」の一覧
│    WidgetDefinition[] を1箇所で保持            │
├─────────────────────────────────────────────┤
│ ③ 個々のウィジェット  widgets/*.tsx           │  ← 表示の中身。互いに一切依存しない
│    WidgetContext だけを受け取って描画する        │
└─────────────────────────────────────────────┘
        ＋ レイアウト永続化 widgetLayoutStore
          （誰がどのウィジェットをどの順で置いたか）
```

**この分離のねらい**：ウィジェットを1個足すとき、触るのは③に1ファイル追加＋②に1行登録だけで済む。①とレイアウト永続化には二度と触らない。将来ウィジェットを外部から取り込む場合も、差し替わるのは②の「一覧をどこから集めるか」だけになる。

---

## 2. ウィジェット契約（本設計の核心）

### 2-1. 原則：ウィジェットは appStore を直接触らない

```ts
// ❌ 禁止。これを1つでも許すと、将来ウィジェットを外部から受け入れられなくなる
const tasks = useAppStore(s => s.tasks);
await useAppStore.getState().saveTask(...);

// ✅ ホストから渡された WidgetContext だけを使う
export function MyTasksWidget({ data, actions, config }: WidgetContext) { ... }
```

理由は3つ。

- **部署スコープの担保**：`selectScopedTasks` 等を通す責任をホスト1箇所に集約できる。ウィジェットごとに書かせると、いつか誰かが素の `s.tasks` を読んで他部署のデータを表示する（過去に実際に起きた種類の事故。CLAUDE.md Section 1.6 参照）
- **将来の権限制御**：外部ウィジェットを受け入れる段階で「このウィジェットに何を渡すか」をホストが決められる。直接 store を触る設計だと、渡す／渡さないの制御点が存在しない
- **書き込みの制御**：`saveTask` を直接呼ばせない。副作用は `actions` に列挙した関数だけに限定する（B1依存ゲート・B3自動リスケ等の choke point を迂回させないため）

### 2-2. 型（Phase 1 で確定させる）

```ts
/** ウィジェットに渡される唯一の入口 */
export interface WidgetContext {
  currentUser: Member;
  /** 部署スコープ済み・論理削除除外済み。読み取り専用 */
  data: {
    tasks: readonly Task[];
    projects: readonly Project[];
    members: readonly Member[];
    // OKR系は必要になった段階で足す（最初から全部渡さない）
  };
  /** 副作用はここに列挙したものだけ。ウィジェットが直接DBを触ることはない */
  actions: {
    openTask: (taskId: string) => void;
    navigateTo: (view: ViewMode) => void;
  };
  /** このインスタンス固有の設定（下記 configSchema で編集される） */
  config: Record<string, unknown>;
  /** 自分の設定を書き換える（メモウィジェット等） */
  setConfig: (next: Record<string, unknown>) => void;
}

export type WidgetSize = "s" | "m" | "l";   // 1 / 2 / 3 カラム分

export interface WidgetDefinition {
  /** 安定ID。レイアウトはこれで参照するので、公開後は絶対に変えない */
  id: string;
  title: string;
  description: string;
  icon: string;                    // 絵文字1個（tour-guidelines.md の作法に合わせる）
  defaultSize: WidgetSize;
  allowedSizes: WidgetSize[];
  /**
   * 何を読むかの宣言。Phase 1 では表示に使わないが、必ず書かせる。
   * Phase 4 で外部ウィジェットを受け入れるとき「これは tasks しか読まない」を
   * 機械的に提示・強制するための土台。後から全ウィジェットに遡って足すのは苦痛なので最初から。
   */
  dataNeeds: Array<"tasks" | "projects" | "members" | "okr">;
  /** 設定フォームの自動生成（Phase 2 で使用。Phase 1 は未設定でよい） */
  configSchema?: WidgetConfigField[];
  render: React.ComponentType<WidgetContext>;
}
```

### 2-3. レイアウト

```ts
export interface WidgetInstance {
  instance_id: string;   // uuid。同じウィジェットを複数置ける（PJ別に3枚など）
  widget_id: string;     // WidgetDefinition.id
  size: WidgetSize;
  config: Record<string, unknown>;
}

export interface MyPageLayout {
  version: 1;            // 将来の形式変更に備える
  widgets: WidgetInstance[];   // 配列順 ＝ 表示順
}
```

**前方・後方互換のルール（重要）**：レイアウトに知らない `widget_id` が入っていたら、**エラーにせず読み飛ばして「このウィジェットは現在利用できません（削除/名称変更）」のプレースホルダを出す**。これがないと、ウィジェットを1つ廃止しただけで、それを置いていた人のマイページが丸ごと壊れる。逆に未知の設定キーも無視する。

### 2-4. `actions` の拡張ポリシー（Phase 2で追記）

`WidgetContext.actions`（2-2の型定義）は、ウィジェットが要求できる副作用の唯一の一覧である。Phase 2 で `createTask`（QuickAddTaskWidget向け）を追加した際に確定した拡張ルールを明文化する。

- (a) **ウィジェットが要求できる副作用は `actions` に列挙されたものだけ**。列挙されていない操作（削除・一括変更・他人のデータの書き換え等）をウィジェットが必要とする場合は、まず `actions` に新しい関数を1つ追加するところから始める。ウィジェットが独自に代替手段（イベント発火・グローバル変数・DOM操作等）で回避することは禁止。
- (b) **新しい副作用を足すときは、必ずホスト側（`MyPageView` → `MainLayout`）で appStore の choke point を経由して実装する。** 例：`createTask` は `MyPageView` が受け取った `onCreateTask` prop をそのまま `actions.createTask` として渡すだけで、実装（`saveTask` の呼び出し）は `MainLayout` 側にある。これにより B1依存ゲート・B3自動リスケ連鎖・B4ベースライン捕捉・v2.75親自動完了などの choke point を必ず通る。
- (c) **ウィジェット側に store・supabase を直接触らせる例外は作らない。** 「このウィジェットだけは特別に…」という例外を1つ許すと、2-1で防ごうとした事故（部署スコープの取りこぼし・choke point 迂回）が起きる経路が復活する。書き込みが必要な機能を思いついたら、必ず `actions` の拡張として設計する。

---

## 3. レイアウトの保存先

| 案 | 内容 | 評価 |
|---|---|---|
| A | localStorage | 実装は最小。ただし**端末・ブラウザごとに別物**になる。このアプリは PC ブラウザと Teams 埋め込みの両方で使うため、「設定したのに消えた」が日常的に起きる |
| **B（推奨）** | 新テーブル `member_widget_layouts`（member_id 主キー＋ layout jsonb）＋ RLS で**自分の行だけ**読み書き | 端末をまたいで追従する。マイグレ1本と `current_member_id()` ヘルパー追加で済む |
| C | `members` に jsonb 列を追加 | マイグレは軽いが、`members` の RLS は同部署の他メンバーも更新できるため、**他人にレイアウトを上書きされうる**。却下 |

**推奨は B。** 既存のヘルパー（`current_member_group_id()` 等）と同じ流儀で `current_member_id()`（`auth.email()` から自分の member id を返す SECURITY DEFINER 関数）を1つ足し、RLS を `member_id = current_member_id()` にする。これは「個人設定」という新しいカテゴリの置き場所になるので、今後の個人設定（既定ビュー・通知細目など）もここに寄せられる。

いずれの案でも、読み書きは `widgetLayoutStore` 1モジュールに閉じ込める（保存先を変えてもウィジェット側は無改修）。

---

## 4. 画面（ホスト）の仕様

- **入口**：サイドバー「🧪 ラボ」サブメニューに「🧩 マイページ」を追加。既存のカレンダー・体制図・関係グラフと同じ全画面オーバーレイ方式（`isMyPageOpen` state ＋ `lazyWithRetry` で別チャンク）。モバイルのラボボトムシートにも同じ項目を追加
- **レイアウト**：CSS Grid（PC 3カラム／タブレット 2／モバイル 1）。サイズ S=1・M=2・L=3 カラム分
- **並べ替え**：既存の HTML5 drag events（`useTaskDragReorder` と同じ流儀）。**react-grid-layout 等の外部ライブラリは導入しない**（ブランドコア §4 のサードパーティ確認が必要になるうえバンドルが重い。CSS Grid ＋ 既存パターンで足りる）
- **編集モード**：通常は閲覧のみ。「編集」トグルで ✕（削除）・サイズ変更・ドラッグハンドル・⚙（設定）を出す。誤操作でウィジェットが消えないようにする
- **ウィジェット追加**：「＋ ウィジェットを追加」でレジストリ一覧をモーダル表示（アイコン・名前・説明・プレビューなしの簡易カード）
- **エラー隔離**：各ウィジェットを `ErrorBoundary` で個別に包む。**1個のウィジェットが落ちてもマイページ全体は生きている**こと。これは外部ウィジェットを受け入れる前提として必須

---

## 5. 初期ウィジェット（Phase 1 の 5〜7 個）

いずれも**既存の純粋関数・既存チャートを再利用**し、新しい集計ロジックを作らない（＝真実の源を二重化しない）。

| # | ウィジェット | 流用元 |
|---|---|---|
| 1 | 📌 自分の今週のタスク | DashboardView の `thisWeekTasks` 相当 |
| 2 | 🔥 期限超過・滞留 | DashboardView の `alertTasks` / `stagnantTasks` 相当 |
| 3 | 👥 自分の負荷 | `computeMemberWorkloadRows`（workload/computeWorkload.ts） |
| 4 | 📊 締切の見通し | `computeDueForecast` ＋ `DueForecastChart` をそのまま埋め込む |
| 5 | 📈 完了ペース | `computeWeeklyVelocity` ＋ `VelocityChart` |
| 6 | 📝 メモ | 自分だけのフリーテキスト。`config` に保存（configの往復を実証する見本を兼ねる） |
| 7 | ⭐ ピン留めプロジェクト | 既存の PJ 進捗計算（`isCompletedForProgress` 経由） |

6 は機能としては小さいが、**「設定を持つウィジェット」の最初の実例**として Phase 2 の configSchema 設計の検証になるので入れておく価値がある。

---

## 6. 将来：自作ウィジェットの取り込み（セキュリティ判断）

山本さんの最終目標。ここは**実装方式によって危険度が桁違い**なので、選択肢を明記する。

### 🔴 絶対にやらない：任意 JS をアプリ本体で実行（eval / new Function）

このアプリのオリジンの localStorage には **Supabase の認証セッショントークン**がある。アプリ本体で任意コードを実行できるようにすると、そのコードは全社の PJ・タスク・メンバー情報を読み、外部へ送信できる。悪意がなくても、生成コードのバグや第三者由来のスニペット混入で成立してしまう。ブランドコア §0・§4 に真正面から抵触するため、この方式は選択肢に入れない。

### 案1：デプロイ型（推奨・Phase 3）

**ウィジェット作成の仕様書とテンプレートを用意し、山本さんが Claude Code で1ファイル書いてリポジトリに追加・push する。** ビルドを通り、差分レビューでき、実行時の動的コード読み込みがゼロ。

- 「仕様に従って自分でウィジェットを作れる」という目的の**大半はこれで達成される**
- 必要なもの：`docs/dev/widget-authoring.md`（契約・作法・禁止事項）＋ `widgets/_template.tsx`
- 制約：反映に push とデプロイが必要（山本さんは日常的にやっているので実質的な障壁は小さい）

### 案2：宣言的ウィジェット（Phase 4-a・非エンジニア向け）

コードではなく**設定（JSON）をインポート**する。「対象＝タスク／絞り込み＝自分の担当かつ期限7日以内／表示＝リスト」のような宣言を、アプリ側の汎用レンダラが描画する。**コードを実行しないので安全**。表現力は限られるが、実際に欲しいウィジェットの多くは「絞り込み＋表示形式」の組み合わせで書ける。

### 案3：サンドボックス iframe（Phase 4-b・要判断）

任意 JS を `sandbox="allow-scripts"`（`allow-same-origin` を**付けない**）の iframe で実行し、postMessage でデータを渡す。同一オリジンの localStorage / Supabase セッションには到達できない。ただし **iframe 内から外部への fetch は別途 CSP `connect-src` で塞ぐ必要がある**（塞がないと、渡したデータを外部に持ち出せる）。Vercel 側のヘッダ設定を伴うため、着手前に必ず判断を仰ぐ。

**推奨の進め方**：Phase 3（案1）まで進めて実運用し、「それでも足りない・非エンジニアも作りたい」となった時点で案2を検討する。案3は最後の手段。

---

## 7. フェーズ計画

| Phase | 内容 | 成果物 | DBマイグレ |
|---|---|---|---|
| 0 | 設計（本ドキュメント） | 本ファイル | — |
| 1 | MVP：ホスト画面＋レジストリ＋レイアウト永続化＋ウィジェット5〜7個。追加・削除・並べ替え・サイズ変更 | ラボに「🧩 マイページ」 | 案B採用時に1本 |
| → | **実装済み（2026-07-27）**。`supabase/migrations/20260727b_add_member_widget_layouts.sql`（`current_member_id()`ヘルパー＋`member_widget_layouts`テーブル）・`src/lib/widgets/{types,layout}.ts`・`src/components/lab/widgets/*`（レジストリ＋ウィジェット7個＋WidgetErrorBoundary）・`src/components/lab/MyPageView.tsx`・`src/hooks/useMyPageLayout.ts`。詳細はCLAUDE.md v3.15参照 | | |
| 2 | `configSchema` 駆動の設定フォーム、ウィジェット追加、既定レイアウト（初回だけ自動配置） | — | 不要 |
| → | **実装済み（2026-07-27）**。`src/lib/widgets/config.ts`（`resolveConfig`/`applyConfigChange`）・`src/components/lab/widgets/WidgetConfigModal.tsx`（configSchema駆動の設定フォーム）・既存2ウィジェット（メモ／ピン留めプロジェクト）のconfigSchema移行・新規ウィジェット3個（🕒最近更新されたタスク／⏳先行待ちのタスク／➕クイックタスク追加。うちクイックタスク追加は`actions.createTask`による最初の書き込みアクション実例）・`createDefaultLayout`のサイズ二重管理解消（レジストリの`defaultSize`に一本化）。詳細はCLAUDE.md v3.16参照 | | |
| 3 | **ウィジェット作成仕様書＋テンプレート**（デプロイ型の自作を解禁） | `docs/dev/widget-authoring.md` | 不要 |
| → | **実装済み（2026-07-28）**。`docs/dev/widget-authoring.md`（仕様書本体）・`src/components/lab/widgets/_template.tsx`（コピー用テンプレート・レジストリ未登録）・`src/components/lab/widgets/__tests__/widgetContract.test.ts`（禁止import・外部通信・レジストリ不変条件を機械チェック）。詳細はCLAUDE.md v3.17参照 | | |
| 4 | ランタイム取り込み（案2 → 必要なら案3）。着手前にセキュリティ判断 | — | 未定 |

Phase 1 は「ラボの実験機能」として出し、実際に使ってみてから正式ビュー（サイドバー上部の NAV_ITEMS）への格上げを判断する（カレンダーと同じ扱い）。

---

## 8. やらないこと（スコープ外の明示）

- 他人のマイページを見る／共有する（Phase 1〜3 では自分の画面のみ）
- ウィジェット間の連携・相互通信
- ウィジェットからの外部 API 呼び出し（ブランドコア §4）
- 外部レイアウトライブラリの導入
- モバイル専用のウィジェット最適化（1カラムで縦積みするだけに留める）
