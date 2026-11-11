import { useState } from "react";
import { lastMemos, members, tasks } from "../fixtures";
import { addDays, dueBeforeCheckin, formatFull, formatMd, formatWindow, movement, nextCheckinDate, overdueTasks, tasksForKr, TODAY, weekWindow } from "../logic";
import { useMock } from "../state";
import type { Team } from "../types";
import { memberOf } from "../ui";
import { SynergyBody } from "./LinkScreen";
import { TfStatus } from "./TfStatus";

export function MeetingMode({ team }: { team: Team }) {
  const { items, pjs, pickedSynergies } = useMock();
  const krs = items.filter((i) => i.kind === "kr");
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const checkin = nextCheckinDate(TODAY, team.checkinWeekday);
  const win = weekWindow(TODAY, team.checkinWeekday);
  const ids = new Set(members.filter((m) => m.teamId === team.id).map((m) => m.id));
  const memo = lastMemos[team.id];
  const linkStep = krs.length;
  const lastStep = krs.length + 1;
  const isSummary = step === lastStep;

  if (done) {
    return (
      <div className="mk-card mk-meeting">
        <h2 className="mk-h1">次週へ引き継ぎました</h2>
        <p>次回のチェックインは {formatFull(addDays(checkin, 7))} です。</p>
        {krs.map((k) => (
          <p key={k.id}>
            <strong>{k.label}</strong>：{notes[k.id]?.trim() || "（合意メモなし）"}
          </p>
        ))}
        <button type="button" className="mk-btn" onClick={() => { setDone(false); setStep(0); }}>
          最初に戻る
        </button>
      </div>
    );
  }

  return (
    <div className="mk-meeting">
      <div className="mk-progress" aria-hidden="true">
        {[...krs, null, null].map((_, i) => (
          <i key={i} className={i <= step ? "on" : ""} />
        ))}
      </div>
      {step < linkStep ? (
        (() => {
          const kr = krs[step];
          const list = tasksForKr(tasks, pjs, items, kr.id).filter((t) => ids.has(t.assigneeId));
          const mv = movement(list, TODAY, win);
          const late = overdueTasks(list, TODAY);
          const soon = dueBeforeCheckin(list, TODAY, checkin);
          return (
            <div className="mk-card">
              <div className="mk-muted">
                {team.name}・{formatMd(checkin)}のチェックイン {step + 1} / {krs.length}
              </div>
              <h2 className="mk-h1">
                {kr.label} {kr.text}
              </h2>
              <div className="mk-muted">今週の動きの期間：{formatWindow(win)}（前回チェックインの翌日〜今回）</div>
              <div className="mk-big-stats">
                <div className="mk-big-stat"><b>{mv.updated}</b>件 更新（今週）</div>
                <div className="mk-big-stat"><b>{mv.completed}</b>件 完了</div>
                <div className="mk-big-stat" style={late.length ? { background: "var(--color-bg-danger)" } : undefined}><b>{late.length}</b>件 遅れ</div>
              </div>
              <h3 className="mk-h2">TFの状況（申告はここで変えられます）</h3>
              <TfStatus krId={kr.id} editable />
              <h3 className="mk-h2">遅れているタスク</h3>
              {late.length === 0 && <p className="mk-muted">遅れはありません。</p>}
              <ul>
                {late.map((t) => (
                  <li key={t.id}>
                    {t.title}（{memberOf(t.assigneeId)?.name}・期日 {formatMd(t.due)}）
                  </li>
                ))}
              </ul>
              {soon.length > 0 && (
                <>
                  <h3 className="mk-h2">次のチェックインまでに期日が来るタスク</h3>
                  <ul>
                    {soon.map((t) => (
                      <li key={t.id}>
                        {t.title}（{memberOf(t.assigneeId)?.name}・期日 {formatMd(t.due)}）
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3 className="mk-h2">前回の合意メモ（{formatMd(memo.date)}）</h3>
              <p className="mk-card" style={{ background: "var(--color-bg-secondary)" }}>{memo.byKr[kr.id] ?? "（なし）"}</p>
              <h3 className="mk-h2">
                <label htmlFor="mk-note">今回の合意メモ</label>
              </h3>
              <textarea id="mk-note" className="mk-textarea" style={{ fontSize: 16 }} value={notes[kr.id] ?? ""} onChange={(e) => setNotes((p) => ({ ...p, [kr.id]: e.target.value }))} placeholder="決まったこと・次にやることを書く" />
            </div>
          );
        })()
      ) : step === linkStep ? (
        <div className="mk-card">
          <h2 className="mk-h1">つながり</h2>
          <p className="mk-muted">「つながり」の画面で、チェックインで取り上げると決めた候補です。</p>
          {pickedSynergies.length === 0 && <p>取り上げる候補はありません。</p>}
          {pickedSynergies.map((s) => (
            <div key={s.id} className="mk-card" style={{ boxShadow: "none" }}>
              <SynergyBody s={s} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mk-card">
          <h2 className="mk-h1">今回のまとめ</h2>
          {krs.map((k) => (
            <p key={k.id}>
              <strong>{k.label}</strong>：{notes[k.id]?.trim() || "（合意メモなし）"}
            </p>
          ))}
          <p className="mk-muted">「次週へ引き継ぐ」を押すと、この内容が次回の「前回の合意メモ」になります（モックでは保存されません）。</p>
          <button type="button" className="mk-btn mk-btn-primary" onClick={() => setDone(true)}>
            次週へ引き継ぐ
          </button>
        </div>
      )}
      <div className="mk-row" style={{ marginTop: 12 }}>
        <button type="button" className="mk-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
          ← 前へ
        </button>
        <button type="button" className="mk-btn" disabled={isSummary} onClick={() => setStep(step + 1)}>
          {step === lastStep - 1 ? "まとめへ →" : "次へ →"}
        </button>
      </div>
    </div>
  );
}
