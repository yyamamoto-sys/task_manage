# マイページ用ウィジェット作成仕様書

作成：2026-07-28（Phase 3） ／ 対象読者：山本さん＋Claude Code
関連：`CLAUDE.md` v3.17・`docs/dev/mypage-widgets-design.md`（設計の経緯・§6セキュリティ判断）

> **この仕様書は実装済みのコードを正として書いている。** 設計書（`mypage-widgets-design.md`）の記述と
> 実装が食い違っている箇所があれば、それは設計書側が古いままの記述であり、実装のほうが正しい
> （該当箇所には設計書側に注記を入れてある）。

---

## 1. これは何か・配布のしかた

マイページのウィジェットは、**1ファイル追加＋レジストリへの1行登録**で増やせる。

反映の流れは他の機能追加と同じ：`git commit` → `git push` → Vercel が自動デプロイ。デプロイが
終われば、**その時点でログインしている全員のマイページに、新しいウィジェットが「＋ウィジェットを
追加」の一覧に並ぶ**（配布 ＝ 通常のデプロイそのもの）。

### ランタイムでの取り込みは、現時点では提供していない

「Claude Code に指示するだけでウィジェットが増えていく」体験の理想形は、コードをビルド・デプロイ
せずにその場でアプリへ読み込ませる（ランタイム取り込み）ことかもしれない。しかし、これは
**意図的に実装していない**。

理由：このアプリのオリジン（ブラウザ上のこのアプリが動いている場所）の `localStorage` には、
Supabase の認証セッショントークンが置かれている。もしアプリ本体が任意の JavaScript をその場で
実行できる仕組み（`eval` / `new Function` / 動的 `import()` によるコード読み込み等）を持ってしまうと、
その任意コードは全社の PJ・タスク・メンバー情報を読み取り、外部へ送信できてしまう。悪意が無くても、
生成されたコードのバグや、どこかからコピペしたスニペットの混入だけで成立してしまう危険な経路になる。
そのためウィジェットは必ず「コードとして書く → ビルドを通す → 差分をレビューできる状態で配布する」
というデプロイ型に限定している（詳しい比較は `mypage-widgets-design.md` §6 参照）。

---

## 2. 5分で1個作る手順

1. **テンプレートをコピーする**

   ```bash
   cp src/components/lab/widgets/_template.tsx src/components/lab/widgets/MyNewWidget.tsx
   ```

2. **ファイル内のコンポーネント名・configSchema定数名を変える**

   `_template.tsx` には `// 👉 ここを変える：` というコメントが付いた箇所がある。そこを実際の
   中身に書き換える。最低限リネームするのは次の2つ：

   ```tsx
   // Before（_template.tsx のまま）
   export const TEMPLATE_WIDGET_CONFIG_SCHEMA: WidgetConfigField[] = [ ... ];
   export function TemplateWidget({ currentUser, data, config, actions }: WidgetContext) { ... }

   // After（例：MyNewWidget.tsx）
   export const MY_NEW_WIDGET_CONFIG_SCHEMA: WidgetConfigField[] = [ ... ];
   export function MyNewWidget({ currentUser, data, config, actions }: WidgetContext) { ... }
   ```

3. **中身を書く**（データの絞り込み・空状態・一覧描画）。詳しくは本書の §3〜§8 を参照。

4. **`registry.ts` に1行登録する**

   ```ts
   // src/components/lab/widgets/registry.ts
   import { MyNewWidget, MY_NEW_WIDGET_CONFIG_SCHEMA } from "./MyNewWidget";

   export const WIDGET_REGISTRY: WidgetDefinition[] = [
     // ...既存のウィジェット定義...
     {
       id: "my-new-widget",
       title: "新しいウィジェット",
       description: "何を表示するウィジェットか一言で",
       icon: "🆕",
       defaultSize: "m",
       allowedSizes: ["s", "m", "l"],
       dataNeeds: ["tasks"],
       configSchema: MY_NEW_WIDGET_CONFIG_SCHEMA, // 設定が不要なら削除
       render: MyNewWidget,
     },
   ];
   ```

5. **検証コマンドを一括で通す**

   ```bash
   npx tsc --noEmit && npx vitest run && npm run build
   ```

   併せて `npx eslint src` も実行し、変更前（baseline）と比較して**新規のエラー・警告が0件**で
   あることを確認する（baseline の数はセッションごとに変わりうるため、着手前に一度
   `npx eslint src` を実行して件数を控えておくこと）。

6. **commit / push**

   ```bash
   git add src/components/lab/widgets/MyNewWidget.tsx src/components/lab/widgets/registry.ts
   git commit -m "feat: マイページウィジェット「新しいウィジェット」を追加"
   git push
   ```

これで Vercel が自動デプロイし、次にログインした全員のマイページに新しいウィジェットが並ぶ。

---

## 3. 契約（WidgetContext）の完全リファレンス

ウィジェットが受け取れる情報・できる操作は、すべて `WidgetContext` 1個に集約されている。
**これ以外の経路（`useAppStore` の直接購読・`supabase` クライアントの直接呼び出し等）でデータや
書き込み手段を得てはいけない。** 以下は `src/lib/widgets/types.ts` の実装をそのまま転記したもの
（要約せず正本をそのまま貼る）。

```ts
/**
 * ウィジェットに渡される唯一の入口。
 * ウィジェットはこれ以外の経路（useAppStore・supabase クライアント等）でデータ・書き込み手段を
 * 得てはならない。
 */
export interface WidgetContext {
  currentUser: Member;
  /** 部署スコープ済み・論理削除除外済み。読み取り専用（ホストが1回だけ購読して渡す） */
  data: {
    tasks: readonly Task[];
    projects: readonly Project[];
    members: readonly Member[];
    /** B1依存ゲートと同じ getIncompletePredecessors を使うウィジェット向け */
    taskDependencies: readonly TaskDependency[];
    // OKR系は必要になった段階で足す（最初から全部渡さない）
  };
  /**
   * 副作用はここに列挙したものだけ。ウィジェットが直接DBを触ることはない（choke point迂回防止）。
   * 新しい副作用を足すときは、必ずホスト（MyPageView）側で appStore の choke point
   * （saveTask 等）を経由して実装すること。ウィジェット側に store・supabase を直接触らせる
   * 例外は作らない。
   */
  actions: {
    openTask: (taskId: string) => void;
    navigateTo: (view: ViewMode) => void;
    /**
     * タスクを1件作成する（QuickAddTaskWidget向け）。ウィジェットは saveTask を
     * 直接呼ばない。ホスト（MyPageView経由でMainLayout）が appStore.saveTask を呼ぶことで
     * B1依存ゲート・B4ベースライン・v2.75親自動完了などの choke point を必ず通す。
     */
    createTask: (draft: { name: string; projectId?: string | null; dueDate?: string | null }) => Promise<void>;
  };
  /** このインスタンス固有の設定（configSchema で編集される） */
  config: Record<string, unknown>;
  /** 自分の設定を書き換える（メモウィジェット等） */
  setConfig: (next: Record<string, unknown>) => void;
}
```

### `data` について

- `tasks` / `projects` / `members` は、**ホスト（`MyPageView.tsx`）が `selectScopedTasks` /
  `selectScopedProjects` / `selectScopedMembers` を1回だけ購読し、`active()`（論理削除除外）を
  かけたあとの配列**。つまり自分の部署（＋兼務先）以外のデータは最初から入ってこないし、
  削除済みデータも入ってこない。ウィジェット側でこれ以上の絞り込み（部署・削除）を気にする必要は
  ない。
- `taskDependencies` も同様にホストが `selectScopedTaskDependencies` を購読し、`is_deleted` を
  除外したもの。
- いずれも `readonly` 配列。`Task[]` を要求する既存の純粋関数（`isParentTask` 等）に渡すときは
  `[...data.tasks]` のように1回コピーしてから渡す（`PinnedProjectsWidget.tsx` の実例を参照）。

### `actions` について

- `openTask(taskId)` — タスク一覧の行をクリックしたときにタスク編集画面を開く。
- `navigateTo(view)` — 他のビュー（ガント・リスト等）へ切り替える。呼ぶとマイページ自体も閉じる
  （ホスト側の `handleNavigate` が面倒を見る）。
- `createTask(draft)` — タスクを1件作成する。**これが「actions に列挙された副作用しか呼べない」の
  唯一の書き込み実例**（`QuickAddTaskWidget.tsx`）。`draft.name` 以外は省略可（`projectId`未指定＝
  PJなし、`dueDate`未指定＝期日なし）。

### `config` / `setConfig` について

- `config` は、このウィジェット**インスタンス**（同じウィジェットを複数置いた場合はそれぞれ別）に
  紐づく自由形式の `Record<string, unknown>`。保存されている値は壊れている可能性がある
  （バージョン違い・手動編集等）ので、**直接読まずに必ず `resolveConfig(schema, config)` を通してから
  使う**（§5参照）。
- `setConfig(next)` はインスタンスの `config` を丸ごと差し替える。`configSchema` を持つ
  ウィジェットは基本的に `WidgetConfigModal`（⚙ボタン経由）が呼ぶため、ウィジェット本体が直接
  `setConfig` を呼ぶのは「本文自体が設定の一部」であるケースだけ（`MemoWidget.tsx` のテキスト本文の
  ような例。§5参照）。

---

## 4. WidgetDefinition の各フィールドの書き方

`registry.ts` に登録する `WidgetDefinition` の各フィールド：

| フィールド | 書き方 |
|---|---|
| `id` | **安定ID。公開後は絶対に変更しない。** レイアウト（`member_widget_layouts`）は `widget_id` としてこの文字列を保存する。あとから `id` を変えると、既にそのウィジェットを配置している人のレイアウトから該当ウィジェットが見えなくなり「⚠ 利用できないウィジェット」のプレースホルダに置き換わる（`MyPageView.tsx` の未知 `widget_id` フォールバック）。ケバブケースの英字（例：`"my-new-widget"`）で、他の `id` と重複しないこと。 |
| `title` | 一覧・ヘッダーに出す名前。日本語で簡潔に。 |
| `description` | 「＋ウィジェットを追加」モーダルで表示される一言説明。 |
| `icon` | **絵文字1個。** `tour-guidelines.md` の作法（絵文字1個ルール）に合わせる。2個以上・文字列は不可。 |
| `defaultSize` | 新規追加時の初期サイズ（`"s"`/`"m"`/`"l"`）。 |
| `allowedSizes` | ユーザーが選べるサイズの配列。**必ず `defaultSize` を含めること**（含めないとレジストリ不変条件のテストが落ちる。§9参照）。グラフ系（棒グラフ・折れ線）は `"s"` を除外する等、見た目が崩れるサイズを除外してよい（`due-forecast`/`velocity` の実例）。 |
| `dataNeeds` | **正直に書くこと。** `"tasks"` / `"projects"` / `"members"` / `"dependencies"` / `"okr"` のうち実際に使うものだけを配列で列挙する。何も使わないなら空配列 `[]`。これは今は表示に使っていないが、**将来ウィジェットを外部から受け入れる審査の土台**になる（「このウィジェットは tasks しか読まない」と機械的に提示・強制するため）。後から全ウィジェットに遡って正しく書き直すのは苦痛なので、今書くときに正確に書く。 |
| `configSchema` | 設定フォームを持たせる場合のみ指定（§5）。持たせない場合はフィールド自体を省略する（`undefined`）。 |
| `render` | ウィジェット本体のコンポーネント。 |

---

## 5. configSchema の全type一覧

`configSchema` は「ウィジェット固有の設定UIを自分で書いてはいけない」というルールの実体である。
**設定項目は必ず `WidgetConfigField[]` として宣言し、`WidgetConfigModal.tsx`（汎用フォーム）に
自動生成させる。** 個別ウィジェットが `⚙` ボタン・設定用モーダル・保存ボタン等を自前で実装する
ことは禁止（§6の禁止事項参照）。

理由は2つ。①設定UIの見た目・操作性（デバウンス・チップ表示・全社共通の入力コンポーネント）を
全ウィジェットで統一するため。②将来これらの宣言を「外部ウィジェット審査」の入力としてそのまま
使えるようにするため（コードでUIを自由に書けてしまうと審査できない）。

| type | 用途 | `options` | `defaultValue` | `min`/`max` | `description` | `placeholder` |
|---|---|---|---|---|---|---|
| `text` | 1行テキスト（600msデバウンス保存） | 使わない | 文字列。未指定なら `""` | 使わない | ○ ラベル下に小さく表示 | ○ 入力欄のプレースホルダ |
| `textarea` | 複数行テキスト（600msデバウンス保存） | 使わない | 文字列。未指定なら `""` | 使わない | ○ | ○ |
| `number` | 数値（即時保存） | 使わない | 数値。未指定なら `0` | ○ `resolveConfig` が範囲外の値をクランプする | ○ | ○（`<input type="number">` の placeholder） |
| `boolean` | チェックボックス（即時保存） | 使わない | 真偽値。未指定なら `false` | 使わない | ○ チェックボックスの下に表示 | 使わない |
| `select` | 単一選択（即時保存） | **省略可**。省略した場合は `WidgetContext.data.projects` から `{label: p.name, value: p.id}` の一覧が動的に組み立てられる（先頭に「（なし）」付き）。**現状この動的組み立ては `projects` 固定**（`WidgetConfigModal.tsx` の実装。他のデータ源から動的に組み立てたい場合は `options` を明示するか、モーダル側の拡張を検討すること）。静的な選択肢が必要なら必ず `options` を明示する。 | 文字列（`options` に存在する値のみ有効） | 使わない | ○ | 使わない（`CustomSelect` を使うため） |
| `projectMultiSelect` | プロジェクトの複数選択（即時保存・チップ表示） | **使わない**（常に `WidgetContext.data.projects` から選択肢を組み立てる） | 文字列配列 | 使わない | ○ | 使わない |
| `memberMultiSelect` | メンバーの複数選択（即時保存・チップ表示） | **使わない**（常に `WidgetContext.data.members` から選択肢を組み立てる） | 文字列配列 | 使わない | ○ | 使わない |

**`defaultValue` / `min` / `max` の効き方**：これらは保存時の値そのものではなく、`resolveConfig`
（`src/lib/widgets/config.ts`）が「保存されている値が無い・壊れている・型が違う」場合に使う
フォールバックである。つまり `configSchema` を変更しても、既に保存済みのレイアウトの `config` は
自動で書き換わらない。次に画面がその値を読むタイミングで、都度 `resolveConfig` が矯正した値を
返す（DB上の生データを書き換えるマイグレーションは発生しない）。

---

## 6. 禁止事項

以下は**すべて契約テスト（§9・`widgetContract.test.ts`）で機械チェックされる**か、レビューで
必ず指摘される事項。

- **`useAppStore` / `supabase` クライアントの直接使用禁止。** データは `WidgetContext.data`、
  書き込みは `WidgetContext.actions` のみを経由する。
- **`fetch` 等での外部通信禁止。** ウィジェットから外部APIを直接叩かない（ブランドコア§4）。
- **`localStorage` の直接操作禁止。** 使う場合は既存の `KEYS` 経由のルール（`src/lib/localData/
  localStore.ts`）に従う。マイページのウィジェット設定自体は `config`/`setConfig`（DB永続化）を
  使うため、通常はウィジェット側で `localStorage` を触る必要自体が生じない。
- **外部ライブラリの追加禁止。** 新しい npm パッケージを追加してウィジェットを作らない
  （サードパーティ導入はブランドコア§4のトリガーであり、別途相談が必要）。
- **色・フォントのハードコード禁止。** 必ず `var(--color-*)` を使う（既存ウィジェットの
  スタイル定数をそのまま真似ればよい）。ダークモード対応が自動的に効く。
- **他ウィジェットの import 禁止。** ウィジェット同士は互いに独立している（設計書§0の3層
  アーキテクチャ）。ただし `resolveConfig` 等の `lib/widgets/*` や `taskMeta.ts` のような共有の
  純粋関数を import するのは問題ない（「他ウィジェットの実装そのもの」を import しないという意味）。
- **`window` へのグローバル書き込み禁止。** `window.foo = ...` のような形でグローバル状態を
  作らない。

---

## 7. 副作用（書き込み）を増やしたいとき

`WidgetContext.actions` に無い操作（タスクの削除・一括変更・ステータス変更等）は、**ウィジェット
単独では追加できない**。これは制約ではなく設計そのもの（`mypage-widgets-design.md` §2-4
「actions の拡張ポリシー」）。

### 手順

1. `src/lib/widgets/types.ts` の `WidgetContext.actions` に、新しい関数のシグネチャを追加する
   （`createTask` と同じ形。引数は必要最小限にする）。
2. `MyPageView.tsx` の `Props` に、対応する `onXxx` prop を追加し、`buildContext` の
   `actions: {...}` にそのまま渡す（`createTask: onCreateTask` と同じパターン）。
3. `MainLayout.tsx` に実装本体（`handleMyPageXxx`）を書く。**ここで必ず `useAppStore.getState()`
   経由で appStore の choke point（`saveTask` 等）を呼ぶ。** ウィジェット側・`MyPageView.tsx` 側の
   どちらにも、appStore・supabase を直接叩くコードを書かない。
4. `MainLayout.tsx` から `<MyPageView onXxx={handleMyPageXxx} ... />` として配線する。

### なぜ必ず choke point を通すのか

`appStore.saveTask` は単なる保存関数ではなく、以下の副作用が**自動的に**発動する唯一の入口である：

- **B1依存ゲート**：先行タスクが未完了のまま完了にしようとするとブロックする。
- **B4ベースライン凍結**：開始日・期日が初めて両方揃った瞬間にベースラインを記録する。
- **v2.75親タスク自動完了**：子タスクが全て完了すると親を自動的に完了にする。

ウィジェットが `saveTask` を経由せず自分で `supabase.from("tasks").update(...)` のようなコードを
書いてしまうと、これらのルールが**静かに効かなくなる**。バグとして気づきにくく、しかも
「マイページから編集した時だけ挙動が違う」という発見しづらい不整合を生む。だから choke point の
迂回は例外なく禁止し、必ずホスト側（`MainLayout.tsx`）で実装する。

---

## 8. 見た目の作法

- **余白**：ウィジェット本体の外側パディングはホスト（`MyPageView.tsx` の `wrapperStyle`/中身の
  `padding: "10px 12px"`）が担うため、ウィジェット内部で外枠に余分な余白を足さない。
- **見出し**：ウィジェットのタイトル・アイコンはヘッダー（ホスト側）が表示するため、ウィジェット
  本体の中に大きな見出しを重ねて出さない。
- **フォントサイズ**：本文は `12px`、補足・日付等の副次情報は `10px`〜`11px` が既存ウィジェットの
  相場（`MyWeekTasksWidget.tsx` 等を参照）。
- **横幅**：`s`/`m`/`l` でグリッドの列数（1/2/3カラム）が変わる。グラフ系ウィジェットで `s` だと
  潰れて読めない場合は `allowedSizes` から `"s"` を除外してよい（`due-forecast`/`velocity` の実例）。
- **内部スクロール**：中身が多くて溢れる場合は、ウィジェット内部で `overflow: "auto"` にする
  （ホストの `<div style={{ padding: "10px 12px", flex: 1, overflow: "auto" }}>` が既に対応済みの
  ため、通常は追加対応不要。表・グラフなど独自に固定サイズの領域を持つ場合のみ意識する）。**親の
  レイアウト自体を押し広げないこと。**
- **空状態**：データが0件のときは「〇〇はありません」という短い日本語メッセージを
  `color: "var(--color-text-tertiary)"`・`fontSize: "12px"`・中央寄せで表示する（既存ウィジェット
  全ての実例に統一されている型。`_template.tsx` の `emptyStyle` も同じ）。
- **アニメーション**：ウィジェット自体に新規アニメーションを追加する必要は通常ない（ホストの
  `animate-overlay`/`animate-fadeIn` が画面全体の出現を担う）。もし追加する場合は既存クラス
  （`globals.css` に定義済みのもの）を流用し、`prefers-reduced-motion` の対応が効くようにする
  （個別に `@keyframes` を新設しない）。

---

## 9. 提出前チェックリスト

- [ ] `npx tsc --noEmit` がエラー0
- [ ] `npx vitest run` が全通過（`src/components/lab/widgets/__tests__/widgetContract.test.ts` を
      含む契約テストが通ること）
- [ ] `npx eslint src` の結果が、着手前に控えた baseline と比較して**新規0件**
- [ ] `npm run build` が成功する
- [ ] **ゲスト（閲覧専用）で壊れないか**：`currentUser` が `isGuestMember` を満たす場合に、
      書き込み系UI（`QuickAddTaskWidget` の入力欄等）が無効化・非表示になっているか
      （`isGuestMember` のチェックを入れる。§3の `actions.createTask` 等を呼ぶウィジェットは必須）
- [ ] **データ0件で壊れないか**：`data.tasks`/`data.projects` 等が空配列のときに例外を投げず、
      空状態メッセージが出るか
- [ ] `dataNeeds` が実際に `data.` から読んでいるフィールドと一致しているか（使っていないものを
      書いていないか、逆に使っているのに書き漏らしていないか）

---

## 10. Claude Code に貼るプロンプト雛形

そのままコピペして、末尾に作りたいウィジェットの内容を書き足して使う。

````
以下の仕様に従って task_manage のマイページ用ウィジェットを1つ作ってください。

【必ず読むファイル（着手前に読むこと）】
- docs/dev/widget-authoring.md（このプロンプトの元になっている仕様書。本文全体）
- src/lib/widgets/types.ts（WidgetContext・WidgetDefinition・WidgetConfigField の型）
- src/lib/widgets/config.ts（resolveConfig・applyConfigChange）
- src/components/lab/widgets/_template.tsx（雛形。まずこれをコピーする）
- src/components/lab/widgets/registry.ts（登録先。既存の並びに1件追記する）
- 参考になる既存ウィジェット2〜3個（配列一覧表示なら MyWeekTasksWidget.tsx、
  configSchemaで設定を持たせるなら PinnedProjectsWidget.tsx、
  書き込み（タスク作成）を伴うなら QuickAddTaskWidget.tsx）

【手順】
1. src/components/lab/widgets/_template.tsx をコピーし、内容に合わせたファイル名・
   コンポーネント名にリネームする
2. 中身を実装する（下記「やりたいこと」を実現する）
3. src/components/lab/widgets/registry.ts に1行登録する（id は安定ID・公開後は変更しない前提で
   慎重に決める。allowedSizes には必ず defaultSize を含める。dataNeeds は実際に使うデータだけを
   正直に書く。icon は絵文字1個）

【絶対に守ること（禁止事項）】
- useAppStore・supabase クライアントを直接使わない。データは WidgetContext.data、
  書き込みは WidgetContext.actions のみを経由する
- fetch 等の外部通信をしない
- localStorage を直接触らない
- 新しい npm パッケージを追加しない
- 色・フォントをハードコードしない（var(--color-*) を使う）
- 他のウィジェットファイルを import しない
- window へグローバル書き込みをしない
- ウィジェット固有の設定UIを自作しない（設定が必要なら configSchema で宣言し、
  WidgetConfigModal に自動生成させる）
- WidgetContext.actions に無い書き込み操作が必要になったら、ウィジェット単独で実装しようと
  せず「actions に無い操作が必要です」と報告して止まる（勝手に appStore や supabase を
  直接叩かない）

【完成の定義（このコマンドが全て通ること）】
```
npx tsc --noEmit
npx vitest run
npx eslint src   # 着手前のbaseline件数と比較して新規0件であること
npm run build
```
併せて、ゲスト（isGuestMember）で書き込み系UIが無効化されているか、data が0件でも
空状態メッセージが出るかを確認すること。

【やりたいこと】
（ここに、表示したい内容・絞り込み条件・設定項目の有無・書き込みの要否を書く。例：
「自分が担当する、優先度が『高』の未完了タスクを一覧表示したい。件数の上限をconfigSchemaで
設定できるようにしたい。書き込みは不要。」）
````

---

*本仕様書は Phase 3（`docs/dev/mypage-widgets-design.md` §7）の成果物として、
実装済みコード（Phase 1〜2）を正としてまとめたものです。*
