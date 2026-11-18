export function JournalPage() {
  return (
    <section className="view page">
      <h1>Journal</h1>
      <p className="lead">Next milestone. Trades logged from the chart or by hand, screenshots, tags, the day's review and the stats that come out of it. Stored locally in SQLite; export to CSV.</p>
      <div className="card"><h2>Planned</h2><p>Per-trade entry (time, side, size, entry, exit, R, tags, notes, screenshot), daily review, calendar heatmap, equity and R curves, filters by tag and session. Streaks and homework can sync with the Academy later.</p></div>
    </section>
  );
}
