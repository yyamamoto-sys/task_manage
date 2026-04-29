// src/lib/ai/krWhyClient.ts
//
// 【設計意図】
// 5Whys（なぜなぜ分析）を対話形式で進めるAI機能。
// ダイアログターン（短い問い返し）とサマリー生成の2種類の呼び出しを持つ。
// KR/TFデータをAIに渡す（ラボ機能例外ルール適用）。

import { supabase } from "../supabase/client";

export type WhyMessage = { role: "user" | "assistant"; content: string };

const DIALOGUE_SYSTEM_PROMPT = `あなたはOKR推進チームのソクラテス式コーチAIです。
5Whys手法を使って、担当者が抱える課題の根本原因を一緒に探ります。

【対話のルール】
- 返答は必ず「問い返し」1文だけにする（説明・評価・アドバイスは一切しない）
- ユーザーの回答の核心を短く言い換えてから、その一歩奥を尋ねる
  例：「○○ということですね。では、なぜ○○が起きているのでしょうか？」
- 表面的・曖昧な答えには「もう少し具体的に教えてください。例えば…？」と深掘り
- バリエーションを使う：「なぜ」「背景には」「そうなっている原因は」

【禁止】
- 解決策・アドバイスの提案
- 「なるほど」「おっしゃる通り」などの評価コメント
- 一度に複数の質問`;

const SUMMARY_SYSTEM_PROMPT = `あなたはOKR推進チームの分析AIです。
5Whys対話の全記録を受け取り、根本原因の分析サマリーを生成します。

出力形式（マークダウン。コードブロックは使わない）：

## 根本原因（仮説）
対話から浮かび上がった核心的な原因を1〜2文で。

## この問題の構造
表面的な課題の背後にある構造・パターンを2〜3文で説明。

## 今週動けるアクション
- アクション1：誰が・何を・いつまでに
- アクション2：同上（最大3件）`;

async function callAI(system: string, messages: WhyMessage[], maxTokens: number): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ai-consult", {
    body: { system, messages, max_tokens: maxTokens },
  });
  if (error) throw new Error(`AI呼び出しエラー: ${error.message}`);
  const text: string = data?.content?.[0]?.text ?? "";
  if (!text) throw new Error("AIからの応答が空でした。");
  return text;
}

export async function callWhyDialogue(messages: WhyMessage[]): Promise<string> {
  return callAI(DIALOGUE_SYSTEM_PROMPT, messages, 300);
}

export async function callWhySummary(context: string, conversation: WhyMessage[]): Promise<string> {
  const summaryMessage: WhyMessage = {
    role: "user",
    content: `【KR・課題コンテキスト】\n${context}\n\n【なぜなぜ対話記録】\n${conversation
      .map(m => `${m.role === "user" ? "担当者" : "AI"}: ${m.content}`)
      .join("\n")}\n\n以上の対話から根本原因分析サマリーを生成してください。`,
  };
  return callAI(SUMMARY_SYSTEM_PROMPT, [summaryMessage], 1500);
}
