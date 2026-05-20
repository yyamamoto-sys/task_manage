# Teams 埋め込み 調査・設計メモ

> ステータス：**方式②へ方針転換（方式①は不可と判明）** ／ 最終更新：2026-05-20
> 関連：`docs/IT相談書_Supabase_AzureAD.html`（既存の社内申請ドラフト）、CLAUDE.md 設計論点 D

> ## ⚠ 重要な判明事項（2026-05-20・実機検証）
> **方式①（Teams「Website」タブにURL追加）ではインライン埋め込みできない。**
> Microsoft が **2024年7月**に新Teamsクライアントの「Website」タブ仕様を変更し、URLを
> Teams内に埋め込まず**ブラウザで開く（ブックマーク化）**ようになったため。Chromium の
> セキュリティ/プライバシー強化に合わせた変更。既存Websiteタブも順次ブックマークに移行。
> - 実機で確認：本アプリをWebsiteタブに追加 → **ブラウザに遷移**した
> - `frame-ancestors` ヘッダは本番で正しく配信されている（curl確認済）が、Teams側がもう埋めない
> - **この変更はカスタムTeamsアプリのタブ（SharePoint/Jira/Planner等と同じ仕組み）には影響しない**
> → **インライン埋め込みには方式②（カスタムアプリ）が必須**。frame-ancestors 設定は②でも必要なので無駄ではない。
> 出典：Microsoft 365 Dev Blog「Upcoming updates to loading websites in Teams tabs」/ MS Learn / office365itpros

plan-app を Microsoft Teams に埋め込んで「Teams から離れずに使える」状態にするための、
方式比較・技術要件・必要手順・社内依頼事項を 1 枚にまとめたもの。**この時点では実装しない。**
意思決定（①簡易 / ②本格 のどちらで進めるか）の材料。

---

## 1. Teams 埋め込みとは

plan-app（Web アプリ）を、ブラウザで別途開くのではなく **Teams の画面内に「タブ」として
iframe 表示**し、メンバーが Teams から離れずに使えるようにする機能。中身は Teams が指定 URL を
iframe（画面内の小窓）で読み込んでいるだけ、というのが本質。

埋め込みには 2 レベルある（下記 §2）。

---

## 2. 2 つの方式

| | ① 簡易：Website タブ / 設定可能タブで URL を表示 | ② 本格：カスタム Teams アプリ |
|---|---|---|
| やること | チャネル/チャットの「＋タブ」で URL を貼る | manifest（アプリ定義 JSON）＋アイコンをパッケージ化し配布 |
| 開発 | ほぼ不要（iframe 許可ヘッダだけ） | Teams JS SDK 導入・manifest 作成・(任意で) SSO 実装 |
| 認証 | アプリ自前ログイン（現状の利用者選択 / Supabase Auth）をそのまま使う | Teams SSO（Azure AD サインイン済みのまま自動ログイン）も選べる |
| 配布 | タブを足した人 / そのチャネルのみ | 組織全体に配布・アプリとして検索可能 |
| 体験 | 「埋め込んだサイト」感 | Teams テーマ連動・ディープリンク・"ネイティブ"感 |
| 社内手続き | ほぼ不要（URL を足すだけ） | Teams 管理者承認 ＋（SSO する場合）Azure AD アプリ登録 |
| 私（Claude）側で完結できる範囲 | iframe 許可ヘッダ・テーマ追従・手順書まで | manifest・Teams JS SDK 組込みまで（Azure 登録/管理者承認は不可） |

**【改訂 2026-05-20】① は Microsoft の仕様変更で「インライン埋め込み」ができなくなった（上記⚠）。**
インライン表示が目的なら **方式② 一択**。ただし②は **SSO の有無**で難易度が大きく変わる：
- **②-a（推奨・最小）：カスタムアプリ＋自前ログインのまま**（SSO なし）。manifest＋アイコン＋
  contentUrl だけ。Azure AD 登録**不要**。私（Claude）側で package まで作れる。山本さんは
  「カスタムアプリのアップロード（サイドロード）」で試用（テナントが許可していれば管理者承認も不要）。
- **②-b（将来）：Teams SSO 追加**。再ログイン不要になるが Azure AD 登録（IT 部門）が要る。②-a の後でよい。

---

## 3. 技術要件（共通）

### 3-1. iframe 許可（最重要・現状の唯一の技術的関門）
Teams はタブを iframe で読み込むため、サイト側が **Teams ドメインからのフレーム化を許可**して
いる必要がある。許可していないと Teams は「ブラウザで開く」にフォールバックし、埋め込みにならない。

- **現状**：`vercel.json` が無く、CSP も `X-Frame-Options` も未設定。
  → デフォルトでは **誰でも iframe 可能**（＝Teams からも読めるが、クリックジャッキング対策も無い）。
- **あるべき姿**：`frame-ancestors` を **自分自身＋Teams 系ドメインだけ**に絞る。
  これで「Teams には埋め込めるが、無関係なサイトには埋め込ませない」を両立できる。

設計参考（②本格時/①でも推奨。実装時に `vercel.json` へ）：
```jsonc
// vercel.json（案・未適用）
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.teams.cloud.microsoft https://*.skype.com https://local.teams.office.com;"
        }
      ]
    }
  ]
}
```
> `X-Frame-Options` は許可リストを表現できない（DENY/SAMEORIGIN のみ）ので使わず、
> モダンブラウザで有効な `frame-ancestors` で許可ドメインを列挙する。

### 3-2. HTTPS
必須。Vercel は標準で HTTPS なので **充足済み**。

### 3-3. レスポンシブ（Teams タブは幅・高さが可変）
Teams タブは PC 全画面〜サイドパネル幅まで可変。設計論点 D「ウィンドウサイズ対応」がこれ。
→ 2026-05-20 のモバイル/レスポンシブ対応（`useIsMobile`・ボトムナビ・ガントのリスト化・
タップ領域 44px 等）で **実質かなり前進**。Teams 内の狭い幅でも崩れにくい。残りは実機（Teams内）確認。

### 3-4. Teams JS SDK（②、または①でテーマ追従したい場合）
`@microsoft/teams-js`（v2）を入れて：
- `app.initialize()` → Teams 内で動いているか検出
- `app.getContext()` でテーマ（light/dark/contrast）取得＋`app.registerOnThemeChangeHandler` で追従
  → 既存の `[data-theme]` ダークモードに橋渡しできる
- （②SSO 時のみ）`authentication.getAuthToken()` で Azure AD トークン取得

---

## 4. 認証の設計（重要な分岐）

| 方式 | ログイン体験 | 必要なもの | 留意点 |
|---|---|---|---|
| 現状維持（自前ログイン） | Teams 内でもアプリの利用者選択 / Supabase Auth で都度サインイン | なし | **iframe 内で Supabase セッションが保持されるか要検証**（ブラウザのストレージ分割でログインが残らない場合がある。Teams デスクトップ版は緩め、Web 版は要確認） |
| Teams SSO（②） | Teams にサインイン済みなら **再ログイン不要** | Azure AD アプリ登録（IT 部門）＋ manifest の `webApplicationInfo` ＋ トークン検証 | Azure AD トークンを Supabase の認証にどう橋渡しするか設計が必要（OBO や Supabase 側 JWT 検証）。難易度高 |

**推奨：①フェーズは「自前ログインのまま」で進め、iframe 内ログイン保持を実機検証。**
SSO は②で本格統合するときに、Azure AD 登録とセットで設計する。

---

## 5. 既存 IT 相談書とのギャップ（要修正）

`docs/IT相談書_Supabase_AzureAD.html` は **ホスティングを Azure Static Web Apps 前提**で書かれているが、
実際は **Vercel に確定**（CLAUDE.md v2.2）。Supabase・Claude API の社内承認は **2026-05-07 に可決済**。

→ ②本格化や正式申請に進む場合、相談書を以下の点で更新する必要がある：
- ホスティング：Azure Static Web Apps → **Vercel**（GitHub push で自動デプロイ）
- 認証：相談書は「Azure AD 認証を全面」想定だが、現状は **Supabase Auth**。
  Teams SSO を入れるかどうかで Azure AD 依頼の要否が変わる
- データ国内保管：Supabase 東京リージョンは継続して訴求可。Azure 東日本の記述は実態に合わせる

---

## 6. 方式① の手順（最小で使い始める）

1. **(私) `vercel.json` に `frame-ancestors`** を追加（§3-1）。clickjacking 対策と Teams 許可を両立
2. **(私) Teams JS SDK でテーマ追従**（任意。入れると Teams のダーク/ライトに自動で揃う）
3. **(私) iframe 内でのログイン保持を検証**（Supabase セッションが残るか。残らなければ対策を設計）
4. **(山本さん) Teams のチャネル/チャットで「＋」→ Website タブ → Vercel の URL を追加**
5. 数名で試用 → 効果と使い勝手を確認 → ②に進むか判断

> ①は「タブを足すだけ」なので Teams 管理者承認も Azure 登録も不要。最速で検証できる。

---

## 7. 方式② の手順（本格・カスタムアプリ）

1. **(私) `@microsoft/teams-js` 組込み**（initialize / context / theme / deep link）
2. **(私) manifest.json ＋ アイコン（color 192×192・outline 32×32）作成**
   - `staticTabs`（個人用）or `configurableTabs`（チャネル用）、`validDomains` に Vercel ドメイン
   - SSO する場合 `webApplicationInfo`（Azure AD クライアント ID・アプリ ID URI）
3. **(山本さん/IT) Azure AD にアプリ登録**（SSO する場合）：リダイレクト URI・アプリ ID URI・
   Teams を既知クライアントに登録。← 相談書「依頼②」に相当
4. **(私) SSO トークン → Supabase 認証の橋渡し設計＆実装**（SSO する場合のみ・難易度高）
5. **(山本さん/IT) Teams 管理センターでカスタムアプリをアップロード・組織配布の承認**
6. 配布 → 全メンバーが Teams の「アプリ」から起動

---

## 8. 役割分担サマリ（自分で完結できない部分）

| 作業 | 担当 | 方式 |
|---|---|---|
| `vercel.json` frame-ancestors | Claude | ①② |
| Teams JS SDK・テーマ追従・manifest 作成 | Claude | ①(一部)②|
| iframe 内ログイン保持の検証・対策 | Claude（実機確認は要 Teams 環境） | ①② |
| **Teams タブに URL 追加** | **山本さん** | ① |
| **Azure AD アプリ登録** | **IT 部門**（依頼：山本さん） | ②(SSO時) |
| **Teams 管理センターでのアプリ配布承認** | **Teams 管理者**（依頼：山本さん） | ② |
| IT 相談書の Azure→Vercel 修正 | Claude（ドラフト）→ 山本さん（提出） | ②/正式申請時 |

---

## 9. 推奨ロードマップ（2026-05-20 改訂）

1. ✅ **frame-ancestors 設定**（vercel.json・本番配信確認済）← ②でも必要な前提なので完了済み
2. ❌ **方式①（Websiteタブ）検証** → Microsoft仕様変更でインライン不可と判明（ブラウザ遷移）
3. **→ ②-a：カスタムアプリ（SSOなし・自前ログイン）を作る**（次のステップ）
   - (私) manifest.json＋アイコン（color 192×192 / outline 32×32）＋contentUrl をパッケージ化
   - (山本さん) Teams で「アプリを管理 → カスタムアプリをアップロード（サイドロード）」で試用
     ※ テナントが custom app upload を許可している必要あり。不可なら Teams 管理者に有効化依頼
   - iframe 内でのログイン保持を実機確認
4. **②-b：必要なら Teams SSO 追加**（Azure AD 登録＝IT部門依頼）。相談書を Vercel 構成に更新して申請
5. **組織配布**：Teams 管理センターでアプリ公開（管理者承認）

---

## 10. 未確定・要調査の論点

- [ ] Teams **Web 版**の iframe 内で Supabase Auth セッションが保持されるか（ストレージ分割の影響）
- [ ] Teams **デスクトップ版**（Electron/WebView2）での挙動差
- [ ] SSO する場合の Azure AD トークン → Supabase JWT 連携方式（OBO / カスタム JWT 検証）
- [ ] 通知連携（Teams Webhook）は既存の KR レポート送信機能と統合済み。埋め込みとは独立
