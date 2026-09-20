"use client";

import { useState } from "react";
import { generationDiagnostics } from "@/lib/generation-diagnostics";

export function GenerationDiagnostics(props: Parameters<typeof generationDiagnostics>[0]) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState("");
  async function copy() {
    const text = JSON.stringify(generationDiagnostics(props), null, 2);
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setManual(text); }
  }
  return <details className="generation-diagnostics"><summary>排查信息</summary>
    <p>记录当前步骤和请求编号，方便定位问题。</p>
    <button className="outline-action" type="button" onClick={() => void copy()}>{copied ? "已复制诊断信息" : "复制诊断信息"}</button>
    {manual && <textarea aria-label="诊断信息" readOnly rows={8} value={manual} />}
  </details>;
}
