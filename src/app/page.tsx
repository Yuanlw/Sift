import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">Phase 0 Prototype</div>
        <h1>把散落的信息，沉淀成可复用知识。</h1>
        <p>
          Sift 的第一版只验证一条链路：保存链接或截图，异步处理成 Source，
          再生成一篇可读、可信、可追溯的 draft WikiPage。
        </p>
        <Link className="button" href="/inbox">
          进入 Inbox
        </Link>
      </section>

      <section className="grid" aria-label="Prototype modules">
        <div className="panel">
          <h3>Inbox</h3>
          <p>接收链接、文本和图片元数据，创建 Capture 和 ProcessingJob。</p>
        </div>
        <div className="panel">
          <h3>Sources</h3>
          <p>保存清理后的单份来源资料，并保留可追溯上下文。</p>
        </div>
        <div className="panel">
          <h3>Wiki</h3>
          <p>把 Source 整理成 draft WikiPage，先验证可读性和复用价值。</p>
        </div>
      </section>
    </>
  );
}
