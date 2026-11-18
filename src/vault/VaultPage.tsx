export function VaultPage({ supported }: { supported: boolean }) {
  return (
    <section className="view page">
      <h1>Vault <span className="seal" style={{ verticalAlign: "middle" }}>封</span></h1>
      <p className="lead">The locked lesson player. Next milestone. While this screen is open the window is excluded from screen capture{supported ? "" : " (not supported on this OS)"}: software recorders see black.</p>
      <div className="card"><h2>How it will work</h2><p>Discord-role gated sign-in (the same gate as the Academy), lessons streamed with short-lived signed URLs, each student's copy carrying their own invisible watermark from the Apostles watermarking machine so a leaked clip names the leaker. The capture block stops software recording; the watermark covers phone cameras and capture cards.</p></div>
    </section>
  );
}
