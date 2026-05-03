export default function SourcesPage() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">Sources</div>
        <h1>来源资料</h1>
        <p>这里会显示经过提取和清理后的单份资料。每个 Source 都能追溯到 Capture。</p>
      </section>
      <div className="list">
        <div className="item">
          <strong>还没有 Source</strong>
          <span className="meta">提交 Capture 后，后台任务会在这里生成来源资料。</span>
        </div>
      </div>
    </>
  );
}
