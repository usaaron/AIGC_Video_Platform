import { ArrowLeft, ArrowUpRight } from "lucide-react";

export function HostReturnLink({ href, detail = false }: { href: string; detail?: boolean }) {
  return (
    <a
      aria-label="返回序幕主站"
      className={`host-return-link host-return-button${detail ? " is-sidebar" : ""}`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      title="在新标签页打开序幕主站，保留当前剧本和生成任务"
    >
      <ArrowLeft aria-hidden="true" size={17} />
      <span><strong>返回序幕主站</strong>{detail && <small>项目 · 资产 · 视频制作</small>}</span>
      <ArrowUpRight aria-hidden="true" size={15} />
    </a>
  );
}
