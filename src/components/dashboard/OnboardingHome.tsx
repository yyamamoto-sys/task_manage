// src/components/dashboard/OnboardingHome.tsx
//
// 初見ユーザー向けの「次にやることガイド」。
// KR / PJ / タスクのカウントを見て、まだ完了していない最初のステップを目立たせる。
// ガイドを開かなくても、3 ステップを実行するだけで運用開始できる導線。

interface Props {
  krCount: number;
  pjCount: number;
  taskCount: number;
  onOpenAdmin: () => void;
  onOpenAiProject: () => void;
  onOpenQuickAdd: () => void;
}

type StepStatus = "done" | "current" | "pending";

interface Step {
  num: number;
  title: string;
  desc: string;
  cta: string;
  onCta: () => void;
  status: StepStatus;
}

export function OnboardingHome({
  krCount, pjCount, taskCount,
  onOpenAdmin, onOpenAiProject, onOpenQuickAdd,
}: Props) {
  const krDone   = krCount > 0;
  const pjDone   = pjCount > 0;
  const taskDone = taskCount >= 3;

  // 「現在のステップ」は最初の未完了ステップ。すべて完了なら表示不要（呼び出し側で制御）
  const currentStepNum = !krDone ? 1 : !pjDone ? 2 : 3;

  const steps: Step[] = [
    {
      num: 1,
      title: "目標と KR を決める",
      desc: "今期の Objective（目標）と KR（成果指標）を3〜5本登録します。",
      cta: krDone ? "KR を編集する" : "OKR を設定する",
      onCta: onOpenAdmin,
      status: krDone ? "done" : currentStepNum === 1 ? "current" : "pending",
    },
    {
      num: 2,
      title: "プロジェクトを作る",
      desc: "KR を実現する手段（PJ）を登録します。AI に議事メモから作ってもらうこともできます。",
      cta: pjDone ? "PJ を追加する" : "PJ を作成する",
      onCta: pjDone ? onOpenAdmin : onOpenAiProject,
      status: pjDone ? "done" : currentStepNum === 2 ? "current" : "pending",
    },
    {
      num: 3,
      title: "タスクを追加する",
      desc: "PJ 配下に具体的なタスクを追加して動き始めます（右下の ＋ ボタンからすぐに登録できます）。",
      cta: taskDone ? "タスクを追加する" : "最初のタスクを追加",
      onCta: onOpenQuickAdd,
      status: taskDone ? "done" : currentStepNum === 3 ? "current" : "pending",
    },
  ];

  const progress = steps.filter(s => s.status === "done").length;

  return (
    <div style={{
      margin: "12px 16px",
      padding: "16px 20px",
      background: "linear-gradient(135deg, var(--color-brand-light) 0%, var(--color-bg-secondary) 100%)",
      border: "1px solid var(--color-brand-border)",
      borderRadius: "var(--radius-lg)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
        <span style={{ fontSize: "18px" }}>👋</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            ようこそ — まずはこの 3 ステップで運用を始められます
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
            ステップ {progress} / 3 完了
          </div>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "10px",
      }}>
        {steps.map(s => <StepCard key={s.num} step={s} />)}
      </div>
    </div>
  );
}

function StepCard({ step }: { step: Step }) {
  const isDone    = step.status === "done";
  const isCurrent = step.status === "current";

  const bg = isDone    ? "var(--color-bg-success)"
           : isCurrent ? "var(--color-bg-primary)"
           :             "var(--color-bg-secondary)";
  const border = isCurrent ? "1.5px solid var(--color-brand)"
               : isDone    ? "1px solid var(--color-border-success)"
               :             "1px solid var(--color-border-primary)";
  const numBg = isDone    ? "var(--color-text-success)"
              : isCurrent ? "var(--color-brand)"
              :             "var(--color-text-tertiary)";

  return (
    <div style={{
      padding: "12px 14px",
      background: bg,
      border,
      borderRadius: "var(--radius-md)",
      display: "flex", flexDirection: "column", gap: "8px",
      opacity: step.status === "pending" ? 0.7 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%",
          background: numBg, color: "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: "11px", fontWeight: 700, flexShrink: 0,
        }}>{isDone ? "✓" : step.num}</span>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {step.title}
        </span>
      </div>
      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.5, minHeight: "33px" }}>
        {step.desc}
      </div>
      <button
        onClick={step.onCta}
        style={{
          padding: "6px 12px", fontSize: "11px", fontWeight: 600,
          background: isCurrent ? "var(--color-brand)" : "transparent",
          color: isCurrent ? "#fff" : "var(--color-text-secondary)",
          border: isCurrent ? "none" : "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        {isDone ? `↻ ${step.cta}` : `→ ${step.cta}`}
      </button>
    </div>
  );
}
