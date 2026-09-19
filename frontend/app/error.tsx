"use client";

import Link from "next/link";

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return <main className="centered-state" role="alert">
    <h1>页面暂时无法打开</h1>
    <p>已保存的作品仍然保留。请重试，或返回项目库重新打开。</p>
    <button className="primary-action" onClick={reset} type="button">重新打开页面</button>
    <Link className="outline-action" href="/">返回项目库</Link>
  </main>;
}
