import { CaptureForm } from "@/components/capture-form";

export default function InboxPage() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">Inbox</div>
        <h1>保存新的资料</h1>
        <p>
          Phase 0 先支持链接和文本。图片上传会接入同一条处理链路，
          但先从数据结构和任务入口开始。
        </p>
      </section>
      <CaptureForm />
    </>
  );
}
