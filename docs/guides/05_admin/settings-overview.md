---
title: 設定パネル概要
audience: [admin]
mode: admin.settings
order: 2
last_updated: 2026-05-15
owner: yamamoto
related: [admin.objective-kr-tf, role.admin]
---

# 設定パネル概要

サイドバー下部の **⚙ 設定**ボタンから全画面オーバーレイで開きます。
plan-app の構造（誰・何・どこ）を司る管理者向けの中央集権UIです。

## 主なセクション

| セクション | 内容 |
|---|---|
| **メンバー管理** | 追加・編集・論理削除。short_name / full_name / email |
| **Objective** | 期間・タイトル・purpose |
| **Key Result** | Objective にぶら下がる結果指標 |
| **TF（タスクフォース）** | KR にぶら下がる実働ユニット。上部のクォータータブ（1Q〜4Q）でTF自身が属するQを移動・確認 |
| **プロジェクト管理** | PJ オーナー・状態（active/archived）・期間 |
| **ToDo / タスク階層** | バルク編集・並び替え |
| **メンバータグ** | 部署・チームの目印として（権限制御には未使用） |
| **AI使用量** | intent ごとの消費トークン・回数を月次表示 |
| **管理ログ** | admin_change_logs。誰がいつ何を変えたか |

## 推奨運用

### 期初
1. メンバー登録（短縮名2〜4字）
2. Objective・KR を確定
3. TF を登録（初Q分。クォータータブは自動的に現在のQ）
4. パイロットメンバーに通知

### 四半期切替
1. クォーター計画（OKRモード）で次QのTF案を出してもらう
2. レビュー → 設定 → タスクフォースの次Qタブで、継続TFを移動・新設TFを作成
3. メンバーに変更を周知

→ [四半期切替の手順](../04_workflows/quarter-rollover.md)

### 月初
- AI使用量を確認
- メンバー追加・削除（必要に応じて）

## 注意点

- **論理削除のみ**：`is_deleted` フラグでの削除なので物理削除はしません。履歴は残ります
- **退職メンバーの扱い**：削除すると履歴に「（不明）」と表示されることがあるので、短縮名末尾に「（退）」を付ける運用がおすすめ
- **構造変更は影響範囲が広い**：KR/TF の削除は会議ノート・セッション・レポートに影響。慎重に

## 関連

- [Objective・KR・TF を登録する](./objective-kr-tf.md)
- [管理者ガイド](../03_roles/admin.md)
- [Supabase Migration の書き方](../../dev/supabase-migrations.md)
