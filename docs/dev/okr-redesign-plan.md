# OKRモード再設計 計画書

作成：2026-08-07（統括Claude／山本さんとの設計セッション）
画面案のモック：[okr-redesign-mock.html](okr-redesign-mock.html)（ブラウザで開く。グループ／自分の2ビュー・ライト/ダーク対応）
関連：`CLAUDE.md` Section 2（6層構造）／Section 6（AI連携）／Section 16（AI使用量計測）／Section 19（DL最小化）／Section 20（全画面ビューの契約）／Section 22（マイグレ時の検査項目）

---

## 0. この再設計の一行

**Kintoneが正本。task_manage は Kintone に存在しない「週の層」を埋める実行層になる。**

---

## 1. 前提（一次資料で確定済み・2026-08-07）

出典：`OneDrive - アミタホールディングス　株式会社　\01_yyamamoto\03_AID\OKR` 配下（個人OKR設計手順書／グループ四半期OKR／個人四半期OKR3Q／個人OKR_月次振返り記録／AID下期OKR全文マスター v3.0／個人KR作成のための生成AIとの対話フロー）。詳細はメモリ `project_okr_operations.md`。

### 1-1. OKRは5層。すべて Kintone（`amita.cybozu.com`）で運用されている

| 層 | Kintoneアプリ |
|---|---|
| ①グループ通期（下期＝7〜12月） | 【2026年度から】四半期OKR登録・月次振り返り の「通期OKR」区画 |
| ②グループ四半期（3Q/4Q） | 同アプリ「当四半期のOKR」区画 |
| ③グループ月次（1〜3か月目） | 同アプリ「月次の計画および振り返り」区画 |
| ④個人四半期 | 個人OKR設定フォーム |
| ⑤個人月次＋四半期評価 | 個人OKR_月次振返り記録 |

**⑤は人事評価に直結している。** 個人OKR達成度は `Σ(ウェイト × 自己評価%)` の加重平均で、月次面談・四半期面談・GM評価・育成担当者が紐づく。**Kintoneを置き換える設計は取らない。**

TFは独立層ではなく**KRの下位区分**（KR1-TF1〜）。これは既存の `Objective > KR > TF` と一致する。

### 1-2. 🔴 週次・日次の仕組みは「そもそも設計されていない」

5層すべてを確認した結果、週次・日次の管理フィールドも運用指示も存在しない。計画と振り返りの最小単位は「月」で、**月初にチェックポイントを立て月末に振り返る2点方式のみ**。

→ 山本さんの課題「月次OKRを使うのは毎月末の振返りのときだけ」は運用崩れではなく**構造上の必然**。ここがこの再設計の狙い所。

### 1-3. 達成度バンドの定義（誤用しないこと）

60＝この取り組みがなくても到達していた水準／70＝介入による明確な改善・前進／80＝第三者にも成果が明らか／90＝誰が見ても成功が明らかで革新的要素を含む／**100＝既存の発想・やり方では達成できない＝要革新**。**3Qは基本的に90・100を置かない。**

> ⚠️ 「70%＝プロセスが設計通り、100%＝成果の芽が出ている」は誤り（7/13ドラフト時点の記述）。2026-08-07に一次資料で是正した。

### 1-4. 個人KR設計のAI対話フローが既に存在する

`個人KR作成のための生成AIとの対話フロー_2026_更新版.docx` は、10ステップ（理想状態→現状→ギャップ→原因→ボトルネック→**目指す存在**→必要な変化→…）の完成した system prompt。出力形式は Kintone の `個人KR_N` 欄そのまま（●対象業務カテゴリ／●実施内容／●得意領域の強化：（役割）／●苦手領域の克服：（役割）／●達成基準／●補足（心持ちの変化）（目指す存在））。

**§1「入力情報」が要求するもののうち、以下はアプリが持っている**：会社/グループのObjective・担当するグループKR・担当業務とPJと期待役割・現状の成果と課題と制約・過去のOKRと振り返り・関連する会議と成果物。**アプリが持っていないのは、役割等級要件（Kintone人事規程）と、本人の強み・弱み・関心・自己研鑽テーマ（保存場所が無く毎期聞き直している）。**

→ この対話フローをアプリに内蔵し、入力情報の大半を自動で埋めるのが Phase 5 以降の候補。自己研鑽は**独立した1本のKR**として設計する運用（設計手順書 §2-6）。

---

## 2. アプリが持つもの／持たないもの

| | |
|---|---|
| **持たない**（Kintoneが正本） | 個人KR・月次計画の**編集**。評価の確定。面談記録。GM評価。ウェイトの強制検算 |
| **読み取り専用で持つ**（取込） | 個人四半期KRの本文・ウェイト・月次計画（位置づけ／当月に取り組む内容／当月末の達成目標と証拠／リスクと依存関係／狙いのバンド）・過去月の振り返りと評価 |
| **アプリだけが持つ** | ★**週の目標状態**と自己評価（◯△✕）／KRごとのメモ／AI解析の結果とキャッシュ／週とタスクの紐づけ／部署ナレッジ |

---

## 3. データモデル（追加7本）

命名は既存の snake_case・`is_deleted`/`deleted_at`/`deleted_by`/`created_at`/`updated_at`/`updated_by` の慣行に合わせる。物理削除は禁止（Section 4）。楽観ロックが必要な行は `saveWithLock` 経由（Section 5）。

### 3-1. `personal_krs` — 個人四半期KR

| 列 | 型 | 備考 |
|---|---|---|
`id` | uuid PK | |
`member_id` | text NOT NULL | 本人 |
`group_id` | text NOT NULL | 部署（RLS） |
`fiscal_year` | int NOT NULL | 例 2026 |
`quarter` | text NOT NULL | '1Q'〜'4Q' |
`kr_kind` | text NOT NULL | 'group_kr' / 'general' / 'company_common' / 'om_common' / 'agm_common' / 'leader_common' |
`key_result_id` | uuid NULL | グループKRへの実リンク（`key_results.id`） |
`task_force_id` | uuid NULL | TFへの実リンク（`task_forces.id`） |
`label` | text NOT NULL | タブに出す短い名前（例「エース（AAS）」） |
`weight_pct` | numeric NOT NULL | 合計100%は**警告のみ・強制しない** |
`category` | text | ●対象業務カテゴリ |
`activity` | text | ●実施内容／●対象業務内容 |
`strength_role` | text | ●得意領域の強化：（役割） |
`weakness_role` | text | ●苦手領域の克服：（役割） |
`criteria` | text | ●達成基準 |
`supplement` | text | ●補足（心持ちの変化／目指す存在） |
`display_order` | int | |
`imported_at` / `source_label` | timestamptz / text | 取込の出典（例「個人OKR設定フォーム 3Q・8/1取込」） |

- **Kintoneは `個人KR_1〜8` のフラットな欄だが、アプリでは行として持つ。** `kr_kind='group_kr'` のときだけ `key_result_id` を使う。
- 自己研鑽KRは `kr_kind='general'` で `label='自己研鑽'`。全社共通（勤怠）は `kr_kind='company_common'`・`weight_pct=10` 固定。

### 3-2. `personal_kr_months` — 個人月次計画（取込＋人の決定）

| 列 | 型 | 備考 |
|---|---|---|
`id` | uuid PK | |
`personal_kr_id` | uuid NOT NULL | |
`month` | date NOT NULL | 月初（YYYY-MM-01） |
`month_index` | int NOT NULL | 1/2/3（四半期内の何か月目） |
`positioning` | text | 【位置づけ】 |
`activities` | text | ▼当月に取り組む内容（計画） |
`target_and_evidence` | text | ▼当月末の達成目標と、その証拠（計画値） |
`risks` | text | ▼リスクと依存関係 |
`band_target` | int NULL | **Kintoneに書いた「狙い」**（60/70/80/90/100） |
`band_override` | int NULL | **人が決めたバンド** |
`band_override_by` / `band_override_at` | text / timestamptz | 決定者と日時 |
`weight_override_pct` | numeric NULL | 「※1か月目のみ25%」の特例 |
`review_text` | text | 過去月：Kintoneに提出した振り返り本文 |
`self_eval_pct` / `gm_eval_pct` | numeric NULL | 過去月：自己評価／GM評価 |
`gm_comment` | text | 過去月：GMコメント |
`imported_at` / `source_label` | | |

UNIQUE(`personal_kr_id`, `month`)。

### 3-3. `personal_kr_weeks` — ★週の目標状態

| 列 | 型 | 備考 |
|---|---|---|
`id` | uuid PK | |
`personal_kr_id` | uuid NOT NULL | |
`month` | date NOT NULL | 月初。月次計画と突き合わせるため冗長に持つ |
`week_index` | int NOT NULL | 1〜5 |
`week_start` / `week_end` | date NOT NULL | |
`goal_state` | text | 「この週末にこうなっている」 |
`self_rating` | text NULL | 'o'（達成）/ 't'（一部）/ 'x'（未達）/ null（未評価） |
`rated_at` | timestamptz NULL | |
`note` | text | 週固有の短いメモ（任意） |

UNIQUE(`personal_kr_id`, `month`, `week_index`)。

**週の区切りは既存のカレンダー週ロジック（v3.09）をそのまま使う**：月曜始まり・W1＝月頭〜最初の日曜・月ごとにリセット。新しい週計算を書かない（実装時に既存関数の所在を確認して流用すること）。

### 3-4. `personal_kr_week_tasks` — 週とタスクの紐づけ（多対多）

| 列 | 型 |
|---|---|
`week_id` | uuid NOT NULL |
`task_id` | uuid NOT NULL |
`created_at` | timestamptz |

PK(`week_id`,`task_id`)。**方式は「自動候補＋明示リンク」**（決定事項）：UIが TF/ToDo 紐づけと期日から候補を提示し、人が選んで紐づける。自動だけにすると期日変更で週を飛び移り、後から見て意味が変わってしまう。

### 3-5. `personal_kr_memos` — KRごとのメモ（追記型）

| 列 | 型 | 備考 |
|---|---|---|
`id` | uuid PK | |
`personal_kr_id` | uuid NOT NULL | |
`member_id` | text NOT NULL | 本人 |
`body` | text NOT NULL | |
`created_at` / `updated_at` | | |

追記型（1件＝1エントリ）。上書き型にすると「7月に何を考えていたか」が消え、月末の下書きの材料として惜しい。

### 3-6. `personal_kr_outlooks` — AI解析の結果とキャッシュ

| 列 | 型 | 備考 |
|---|---|---|
`id` | uuid PK | |
`personal_kr_id` | uuid NOT NULL | |
`month` | date NOT NULL | |
`input_fingerprint` | text NOT NULL | **一致したら再解析しない**（§5参照） |
`outlook_json` | jsonb NOT NULL | 見立て・週ごとの一手・捨てる候補 |
`band_ai` | int NULL | **月の途中でも出す「見通し」**（山本さん決定・2026-08-07） |
`band_ai_reason` | text | 判定の根拠 |
`model` | text | |
`created_at` | timestamptz | 履歴として積む（上書きしない） |

使用量は既存 `ai_usage_logs` に `invokeAI` 経由で自動計上（Section 16）。このテーブルにトークン数を二重に持たない。

### 3-7. `okr_knowledge_docs` — 部署ナレッジ（要点インデックス方式）

| 列 | 型 | 備考 |
|---|---|---|
`id` | uuid PK | |
`group_id` | text NOT NULL | **部署スコープ。既存の `current_member_group_ids()` をそのまま使う** |
`title` | text NOT NULL | |
`kind` | text | 'period_okr' / 'distributed' / 'master' / 'minutes' / 'other' |
`period_label` | text | '2026下期' / '3Q' 等 |
`source_filename` / `mime` | text | |
`body_text` | text | 抽出テキスト（＝**中身を閲覧できる**） |
`summary` | text | AIが作った数百字の要点 |
`key_points` | jsonb | 箇条の要点 |
`uploaded_by` / `uploaded_at` | | |
`is_deleted` / `deleted_at` / `deleted_by` | | |

**原本ファイルは保存しない**（決定事項）。Supabase Storage は本アプリで未使用のため、新規に RLS 設計を持ち込まない。図表が本質の資料が出てきたら、そのときに Storage を検討する。

**検索は埋め込み（embeddings）を使わない**（決定事項）。理由：Claude API に埋め込みエンドポイントが無く、本格RAGは別ベンダーへ社内資料テキストを送ることになりブランドコア §4 に該当する。1部署・数十〜数百件の規模なら次の2段で足りる。

1. AIにまず**全文書の `summary` リスト**を渡す
2. AIが関連文書を選び、**選ばれた文書の `body_text` だけを追加で読む**

資料が増えて限界が来たら pgvector を足す。そのときもこの `summary` は無駄にならない。

---

## 4. RLS方針

- `personal_krs` / `personal_kr_months` / `personal_kr_weeks` / `personal_kr_week_tasks` / `personal_kr_memos` / `personal_kr_outlooks` … **本人のみ read/write**（決定事項）。`member_id = current_member_id()` 相当で絞る。既存の `member_widget_layouts`（本人のみRLS）が手本。
  - 理由：見られる前提だと「正直な✕」を付けられなくなり、冗長視の道具として死ぬ。
  - 将来KR単位で公開範囲を切り替えたくなったら、`visibility` 列を足して拡張する（今回は入れない）。
- `okr_knowledge_docs` … `group_id = ANY(current_member_group_ids())` で参照。書き込みは同部署のメンバー。
- **`current_member_id()` に相当する関数が既にあるか実装時に確認すること。** 無ければ `member_widget_layouts` のポリシーの書き方を踏襲する（新しい SECURITY DEFINER 関数を増やす前に既存を探す）。

---

## 5. AI解析のトリガー設計

### 5-1. 原則：AIが要るものと要らないものを分ける

これが「更新中に茫然と待たない」ことへの本質的な答え。

| | 内容 |
|---|---|
**機械計算（ゼロトークン・即時描画）** | 残り週数／W評価の積み上げ／遅延日数（ベースライン差分）／停滞日数／先行待ちの相手／未設定の週／当月末の達成目標との突き合わせ |
**AIが必要（後から差し込む）** | 「今のままではバンド60に着地する」という見立て／捨てる候補／△の原因の推定／「先月と同じ理由でつまずいている」／振り返りの下書き |

**起動と同時に機械計算分を描画し、AI分だけを後から差し込む。** 待っている間も週の目標状態やメモは編集できる。

### 5-2. 発火と抑制

- **発火はOKRモード起動時のみ。** cron・全員一律のバッチ解析はやらない（モードを開かない人には1トークンも発生させない）。
- **`input_fingerprint` が前回と一致したら呼ばない。** ハッシュに含めるもの：対象KRに紐づくタスクの `updated_at` の最大値／週の目標状態と `self_rating`／月次計画の `imported_at`／メモの最終 `updated_at`／現在の週番号。
- **粒度は開いているKRタブ1本だけ。** 全KR分をまとめて解析しない。タブ切替でそのKRを解析（ハッシュが同じなら呼ばない）。
- **「これからの見立て」と「バンドのAI判定」は1回の呼び出しにまとめる。** 別々に呼ぶと倍かかる。
- 結果は `personal_kr_outlooks` に永続化するので、**別端末・別セッションでも再解析されない**。実質これがいちばん効くトークン削減。
- 明示実行用の「再解析」ボタンを置く。
- `AIIntent` に新タグを追加（Section 6-1b・16）。案：`okr-personal-outlook`。振り返り下書きは**別枠の呼び出し**にする（月末に1回・明示ボタン・プロンプトも頻度も別）。案：`okr-personal-review-draft`。

---

## 6. 達成度バンドは3つの値を区別して持つ

| 値 | 置き場所 | 意味 |
|---|---|---|
`band_target` | `personal_kr_months` | Kintoneに書いた**当月の狙い** |
`band_ai` | `personal_kr_outlooks` | **現時点の見通し**（月の途中でも出す） |
`band_override` | `personal_kr_months` | **人が決めた値**。入っていれば以後AIは上書きしない |

表示は `band_override` があればそれ、無ければ `band_ai`。バッジで「✦ AI判定」／「● 自分で決定」を明示する。Human in the loop パターン②「変更して承認」（`ClaudeCodeForWork/CLAUDE.md`）。

**「狙い」と「見通し」と「決定」を混ぜないこと。** 混ぜると「AIが人事評価を付けた」ことになる。

---

## 7. 画面構成

モック [okr-redesign-mock.html](okr-redesign-mock.html) が正本。要点だけ：

### グループOKRビュー
期のヘッダ（パーパスと達成度バンドの定義）→ KRカード（畳んだ状態が既定・状態は左端の色帯とピル・開くと3層記述とTF一覧）→ 波及の注意（単一障害点）→ 「言われたこと と 動いているもの」（照合結果）→ 部署ナレッジ。

**タブの入れ子（OKR管理 ＞ 概要／①会議ノート／②セッション記録／③分析／④レポート）を廃止する。** 儀式の名前を画面の骨格から外し、縦1本＋展開にする。取込は右上の1ボタンに集約し、**チェックインかウィンセッションかは判定しない**（OKR・グループ全体に関わる情報として抽出する）。

### 個人OKRビュー
**最上部に個人KRごとのタブ**（ウェイト付き。自己研鑽・全社共通も1本ずつ）。タブ内は 期・月の切替バー → このKRの内容（折りたたみ・取込）→ 今月の計画（取込・読み取り専用）→ **週の目標状態（W1〜W5・◯△✕で自己評価。評価すると週の色が変わる）** → **これから** → メモ → 月末にやること（Kintone下書き）。

- **「今日の焦点」は作らない**（毎日見るものではない・山本さん指摘）。
- **中心は「これから」**。過去は、これからの判断を変えるときにだけ出す（「先月と同じ理由でつまずいている」等）。
- 過去月は月タブから読み取り専用で遡れる。
- AIは**計画モードと同じ右のAIパネル**（`ConsultationPanel` の型）を流用し、ガイド・スターター・答え方をOKR用に差し替える。冒頭に「このパネルが見ているもの」として文脈を明示する。

---

## 8. 段階計画

| Phase | 内容 | AI |
|---|---|---|
**1** | `personal_krs` / `personal_kr_months` / `personal_kr_weeks` / `personal_kr_week_tasks` / `personal_kr_memos` ＋ 個人ビューの骨格（KRタブ・月切替・週レーン・◯△✕・メモ・週とタスクの紐づけ）。**手入力で完結** ＋ 既存の整理（§9） | **なし** |
**2** | ✅ **完了（2026-08-10・v3.41）** Kintone取込（PDF／貼り付け → 抽出 → 人が確認 → 登録）。既存の取込基盤（`FileAttachButton` / `docxText` / `invokeAI`）を流用。`PersonalOkrImportModal.tsx`。種別（四半期／月次振返り）はAIが判定・人が確認画面で切替可。🔴既存`personal_kr`への対応づけを必ず人が確認するフロー（`importMatch.ts`の候補提示・`importApplyPlan.ts`の書き込み）で、週の目標状態・メモの孤立を防止。詳細はCLAUDE.md Section 24 Step F | 抽出のみ |
**3** | ✅ **完了（2026-08-11・前半v3.51／後半v3.52）** 前半：`personal_kr_outlooks`テーブル＋「これから」の機械計算パート＋フィンガープリント（純粋関数）＋バンドの3値表示分離の骨格。後半：AI呼び出し（見立て・週ごとの一手・捨てる候補・バンドのAI判定を1回にまとめる。`AIIntent="okr-personal-outlook"`）＋`personal_kr_outlooks`への書き込み（トリガーはKRタブを開いたときのみ・fingerprint一致で再解析しない・「再解析」ボタン）＋AIパネルのOKR版（`ConsultationPanel`と同じ型を流用。`AIIntent="okr-personal-chat"`）。詳細はCLAUDE.md Section 24 Step G・Step H | 前半：なし／後半：中核 |
**4** | 月末の振り返り下書き（明示ボタン・別 `AIIntent`） | あり |
**5** | `okr_knowledge_docs`（要点インデックス方式）＋ ナレッジ閲覧 ＋ 個人KR設計支援（既存の10ステップ対話フローを内蔵） | あり |
**6** | ~~グループビュー刷新 ＋ 照合（言 vs 実）＋ 取込の統合~~ **【2026-08-10更新】グループ側はアーカイブ済み。再設計はゼロベースで別途。** 山本さんの判断で「元々あったグループモードの機能は一旦白紙にしたい」となったため、Phase 6として旧グループUIを刷新する計画は取り下げた。旧実装（①会議ノート／②セッション記録&分析／③レポート作成／なぜなぜ分析／クォーター計画タブ）はコードのみ保管（`src/components/okr/ARCHIVED.md`参照）。グループ側を再び作る場合は、この保管コードを土台にするのではなく、その時点のニーズから**ゼロベースで再設計する**（旧実装をそのまま復帰させることを前提にしない） | — |

**Phase 1 をAIゼロで成立させることが最重要。** 週の層が実際に運用に乗るかを、トークンを使わずに確かめる。乗らなければAIを足しても意味がない。

### Phase 1 の受け入れ条件
- 個人KRを手で登録でき、KRタブが並ぶ（ウェイト表示・合計100%でなければ警告のみ）
- 月を切り替えられ、過去月は読み取り専用になる
- 週の目標状態を書けて、◯△✕を付けると週の色が変わる
- 週にタスクを紐づけられる（候補が提示される）
- KRごとにメモを追記でき、履歴が残る
- 本人以外にはRLSで見えない（**非super-adminアカウントで実地検証すること**。山本さんはsuper-adminなので自分のアカウントでは検証にならない）
- `npx tsc --noEmit` 0／`npx vitest run` 全通過／`npm run lint` 新規エラー0／`npm run build` 成功

---

## 9. 既存の整理（Phase 1と同時に実施・決定事項）

- ✅ **完了（2026-08-10・v3.38・Step C）** `quarterly_objectives` / `quarterly_kr_task_forces` を畳む。どの画面からも参照されない死蔵（`docs/REFACTORING.md` M24）。物理削除はせず、参照コードの撤去と `schema.sql` へのコメント明記、`schemaChecks.ts` の扱いを整理する。
  → `quarterly_kr_task_forces` はappStore.ts/store.tsの死蔵state・アクション・fetch/insert/deleteを削除（読み書きとも参照ゼロに）。`quarterly_objectives` はOKR PDF取込（`OkrImportModal`）が今も書き込むため経路は残した（取込機能を壊すリスク回避）。テーブル自体はDropしていない（Section 4）。
- ✅ **完了（2026-08-10・v3.38・Step C）** `quarterPlanStore.ts` の localStorage → Supabase 移行。ファイル冒頭の「IT部門のSupabase承認後にDB移行予定」は解消済み（2026-08-07・山本さん確認：**Supabase保存は問題ない**）。
  → `kr_quarter_plans` テーブル（部署スコープRLS）へ移行。`migrations/20260807c_add_kr_quarter_plans.sql`（**未適用・山本さんの手動適用が必要**）。
- ✅ **完了（2026-08-10・v3.38・Step C）** `CLAUDE.md` Section 1 の「⚠ 確認が必要な事項（未解決）：Supabaseへのデータ保存について社内情報セキュリティポリシーの確認が必要」を是正する。この古い記述が残っているせいでクォーター計画が localStorage に取り残されていた。
  → 「2026-08-07に確認済み（社内的にクリア）」と決着を明記。他2項目（Claude API送信／Teams埋め込み申請）は今回の確認範囲外のため未解決のまま残した。
- マイグレを追加したら **`src/lib/schema/schemaChecks.ts` に検査項目を1行足す**（Section 22）。→ `kr_quarter_plans_table` を追加済み。
- ✅ **完了（2026-08-10・v3.39・Step D）** `quarterly_objectives` を起動時フェッチ（`fetchOkrData`／Phase 2）から除外。Step Cで「参照は残す」と決めた書き込み経路（OkrImportModal）はそのまま維持し、appStore.tsの読み取り用state（`quarterlyObjectives`）だけを撤去した（読み取り側の参照がゼロだったため）。CLAUDE.md Section 19「ダウンロード量の最小化」の対象。
- ✅ **完了（2026-08-10・v3.40・Step E）** OKRモードのグループ側を白紙化（山本さん指示）。詳細はCLAUDE.md Section 24 Step E参照。本計画書§8のPhase 6（グループビュー刷新）は取り下げ、再設計はゼロベースで別途行う方針に変更した。

---

## 10. 今回決めたこと（2026-08-07・山本さん判断）

| 論点 | 決定 |
|---|---|
Kintoneとの関係 | **Kintoneは正本。アプリは実行層**（二重入力を作らない） |
週次層の単位 | 週の**「目標状態」** |
Supabaseへの社外秘保存 | **問題ない**（クォーター計画の移行も解禁） |
ナレッジの検索方式 | **要点インデックス方式**（埋め込み・pgvector・新ベンダーを使わない） |
UI刷新の進め方 | 先にデザイン案（モック）を確認 → 合意済み |
取込の入口 | **種別を判定しない単一入口**（チェックイン/ウィンセッションを区別しない） |
「今日の焦点」 | **作らない**（毎日見るものではない） |
週の自己評価 | ◯△✕。**評価によって週の色が変わる** |
バンドのAI判定 | **月の途中でも出す**。人が変更でき、変更後はAIが上書きしない |
AIチャット | **計画モードと同じ右パネルの型**を流用し、中身をOKR用にカスタム |
週の共有範囲 | **本人のみ** |
週とタスクの紐づけ | **自動候補＋明示リンク** |
ナレッジの原本 | **テキストのみ**（Storage を新規導入しない） |
既存の整理 | **Phase 1と同時** |

---

## 11. 未決・要確認

- `current_member_id()` 相当の SECURITY DEFINER 関数が既にあるか（無ければ `member_widget_layouts` のポリシーを踏襲）
- カレンダー週計算の既存関数の所在（v3.09 で実装済み。新規に書かない）
- 既存のOKR循環ワークフロー（`kr_meeting_notes` 等）の扱い。**AIDでは週次ノート運用が無いが他部署では使われている可能性がある**ため、今回は撤去せず併存させる。Phase 6 で整理を判断する
- ✅ **確認済み（2026-08-10）** Kintone取込の入力形式：実物（`個人四半期OKR3Q.pdf`・`個人OKR_月次振返り記録.pdf`）で確認した。**PDFエクスポート形式**（画面をPDF化したもの）で、レコード詳細画面のレイアウトがそのままテキスト抽出される。CSVは試していない（Kintoneのサブテーブル・添付ファイルを含む画面の再現度がPDFより低く、月次振返り記録の「分類＝計画／振り返り」の対構造がCSVでは崩れる可能性が高いため今回は対象外）。構造上の注意点：①月次振返り記録は同じKR・同じ月について「分類＝計画」の行と「分類＝振り返り」の行が別レコードとして存在し、PDF上は縦に並んで見えるため、抽出時にAIへ両者を1つの月次データにまとめるよう明示する必要があった。②達成度バンドの月次目標欄は単一の目標値ではなく60/70/80（時に90/100「設定しない」の注記付き）の複数基準を並べたルーブリック（説明文）であることが大半で、`band_target`に単一値を機械的に埋められるケースは稀（明記されていなければnullのまま）。③自己評価・GM評価の判定は「✔/✖/□」のチェックマーク付きバンド一覧ではなく、本文中の「[自己評価：XX%（本KR%）…]→（人名）評価：YY%」という角括弧表記から取る方が信頼できる（✔✖のリストはPDFの列レイアウトでチェック印と基準文がずれて抽出されることがあった）。④「【7月限定KR】」のような四半期の個人KR一覧に無い一時的なKR（羅針盤フォーラム等）は対応づけ先が無いため取込対象外とした。詳細はCLAUDE.md Section 24 Step F・`src/lib/ai/personalOkrImportExtractor.ts`のSYSTEM_PROMPT参照
- 個人KR設計支援（Phase 5）で、本人の強み・弱み・関心・自己研鑽テーマをどこに保存するか（毎期聞き直している課題）
- 「役職など選択」「面談形式」の全選択肢一覧（Kintoneフォーム設定画面が必要）
