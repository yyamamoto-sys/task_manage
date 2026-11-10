export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h1 className="mk-h1">{title}</h1>
      <div className="mk-card" style={{ marginTop: 12 }}>
        <span className="mk-chip mk-chip-yellow">次版で作成</span>
        <p style={{ margin: "10px 0 0" }}>{note}</p>
      </div>
    </div>
  );
}
