---
title: 用語集
audience: [all]
mode: guide.glossary
order: 1
last_updated: 2026-10-08
owner: yamamoto
related: []
---

# 用語集

plan-app・OKR運用で使う用語の**唯一の定義場所**です。本文で説明を増やさず、ここを引いてください。

## OKR の基本

### Objective
組織として「いつまでに、なぜ、何を成したいか」を定性的に宣言する1〜2文。期間は通常1年（plan-app では `period` で持つ）。

### KR（Key Result）
Objective の達成度を測る**結果指標**。「達成したかどうか」が外形的に判断できる粒度で書く。plan-app では Objective に複数 KR がぶら下がる構造。

### TF（タスクフォース）
KR を実現するために結成される**実働ユニット**。1つのKRに複数TFがぶら下がる。TF はクォーターごとに編成・組替えされる（TF自身が持つ「クォーター」欄で管理。設定 → タスクフォースのクォータータブから移動・新設）。

### ToDo
TF が「やる」と決めた中間アウトプット。タスクの集合の単位。

### タスク
ToDo を分解した実行可能な作業単位。担当者・期日・状態（未着手／進行中／完了／保留／中止）を持つ。

## 個人OKR

### OKRモード
個人の四半期KRを管理する画面。正本は Kintone の個人OKR（四半期KR・月次振り返り）で、OKRモードは Kintone に無い週単位の記録を埋める実行層。KRタブを選び、今月の計画・週の目標状態・自己評価を記入する。

### 週の目標状態
その週の終わりにどうなっていたいかを書く欄。記入は任意。

### 自己評価（◯△✕）
週の目標状態に対する振り返り。◯＝達成、△＝一部達成、✕＝未達。記入は任意。

## ロール

### 管理者
Objective・KR・TF・メンバー登録、TFのクォーターの移動などの設定を行う人。

### メンバー
TF に所属し、ToDo・タスクを動かす人。

## 技術用語（簡易）

### Supabase
plan-app のバックエンド（PostgreSQL ＋ Edge Functions）。OKR の各種データを保管。

### Edge Function `ai-consult`
Anthropic Claude API を呼び出すためのサーバ側関数。各種AI機能（相談・分析・抽出）はすべてこれを経由。

### intent
AI呼び出し時にどの用途で使うかを表すタグ。利用量集計に使う（例: `task-management`, `okr-personal-outlook`）。
