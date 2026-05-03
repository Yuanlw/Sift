export default function WikiPage() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">Wiki</div>
        <h1>知识页</h1>
        <p>
          Phase 0 中，每个 Source 默认生成一篇 draft WikiPage。
          后续再加入相似页面推荐和合并建议。
        </p>
      </section>
      <div className="list">
        <div className="item">
          <strong>还没有 WikiPage</strong>
          <span className="meta">处理完成后，AI 生成的 draft WikiPage 会出现在这里。</span>
        </div>
      </div>
    </>
  );
}
