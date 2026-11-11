import { CURRENT_QUARTER, LOCKED_AT, PERIOD_NAME, PERIOD_RANGE, QUARTER_INFO, teams } from "../fixtures";
import { formatFull, formatMd, nextCheckinDate, TODAY } from "../logic";
import { useMock, type ScreenId } from "../state";

const PHASES = ["計画中", "確定待ち", "期中", "期末"];

export function HomeScreen() {
  const { locked, setScreen, lockedAt, showToast, pendingSynergies } = useMock();
  const now = locked ? 2 : 1;
  const entries: { id: ScreenId; title: string; desc: string; tag?: string }[] = [
    { id: "import", title: "② 取り込み・突き合わせ", desc: "四半期ごとに、Kintoneで確定したOKRと見比べて確定します。月初のチェックポイントもここで取り込みます。", tag: locked ? "確定済み" : "確定待ち" },
    { id: "map", title: "③ OKRマップ", desc: "どのPJ・タスクが、どの目標に効いているかを一望します。" },
    { id: "kr", title: "④ KR詳細", desc: "KRごとのPJ・タスクと、TFリーダーの申告を確かめます。" },
    { id: "link", title: "◎ つながり", desc: "KRをまたいで、つなげると良さそうな仕事の候補を見ます。" },
    { id: "checkin", title: "⑤ チェックイン", desc: "事前に状況をつかみ、会議で全員の認識を揃えます。" },
    { id: "review", title: "⑥ 期末の振り返り", desc: "次版で作成します。" },
    { id: "plan", title: "⑦ 計画（次期の下書き）", desc: "次版で作成します。" },
  ];
  const q = QUARTER_INFO[CURRENT_QUARTER];
  return (
    <div>
      <h1 className="mk-h1">期のホーム</h1>
      <div className="mk-row" style={{ marginBottom: 6 }}>
        <label className="mk-small" htmlFor="mk-period">
          期
        </label>
        <select id="mk-period" className="mk-select" style={{ width: 240 }} defaultValue="now" onChange={() => showToast("期の切り替えは次版で作ります（モック）")}>
          <option value="now">{PERIOD_NAME}</option>
          <option value="prev">2026年 上期（終了）</option>
        </select>
        <span className="mk-muted">{PERIOD_RANGE}</span>
      </div>
      <div className="mk-stepper" aria-label="期の段階">
        {PHASES.map((p, i) => (
          <div key={p} className={`mk-step${i < now ? " is-done" : i === now ? " is-now" : ""}`}>
            {i < now ? "✓ " : ""}
            {p}
          </div>
        ))}
      </div>

      <div className="mk-grid mk-grid-3" style={{ marginBottom: 14 }}>
        <div className="mk-card">
          <div className="mk-muted">今期</div>
          <strong style={{ fontSize: 18 }}>
            {PERIOD_NAME}・{CURRENT_QUARTER}
          </strong>
          <div className="mk-muted">{q.range}（今日は{formatFull(TODAY)}）</div>
        </div>
        <div className="mk-card">
          <div className="mk-muted">次のチェックイン</div>
          {teams.map((t) => {
            const d = nextCheckinDate(TODAY, t.checkinWeekday);
            return (
              <div key={t.id}>
                <strong>{t.name}</strong> {formatMd(d)}
                {d === TODAY ? "（本日）" : ""}
              </div>
            );
          })}
        </div>
        <button type="button" className="mk-card" style={{ textAlign: "left" }} onClick={() => setScreen("link")}>
          <div className="mk-muted">取り上げ待ちの「つながり」</div>
          <strong style={{ fontSize: 18 }}>{pendingSynergies.length}件</strong>
          <div className="mk-muted">クリックで候補を見る</div>
        </button>
      </div>

      <p className="mk-lead">
        {locked
          ? `目標・KRは半期の間ずっと固定です（${formatFull(LOCKED_AT)}確定）。${CURRENT_QUARTER}のTFは${formatFull(lockedAt)}に確定しました。期中に動かすのは「PJ・タスクの紐づけ」と「状況」だけです。`
          : `目標・KRは半期の間ずっと固定です。${CURRENT_QUARTER}のTFはまだ確定していません。②で、Kintoneの内容と突き合わせて確定します。`}
      </p>
      <div className="mk-grid mk-grid-3">
        {entries.map((e) => (
          <button key={e.id} type="button" className="mk-card" style={{ textAlign: "left" }} onClick={() => setScreen(e.id)}>
            <div className="mk-row">
              <strong>{e.title}</strong>
              {e.tag && <span className={`mk-chip ${locked ? "mk-chip-green" : "mk-chip-yellow"}`}>{e.tag}</span>}
            </div>
            <div className="mk-muted" style={{ marginTop: 6 }}>
              {e.desc}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
