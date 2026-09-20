"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createCopilotProgressRun, type CopilotProgress, type CopilotProgressRun } from "@/lib/copilot-progress";

export function useCopilotProgress(scopeKey: string): {
  progress: CopilotProgress | null;
  begin(signal: AbortSignal): CopilotProgressRun;
} {
  const [snapshot, setSnapshot] = useState<{ scope: object; value: CopilotProgress } | null>(null);
  const scopeRef = useRef({ key: scopeKey });
  const ownerRef = useRef<object | null>(null);
  const runRef = useRef<CopilotProgressRun | null>(null);
  // A -> B -> A must not revive A's earlier running snapshot or callbacks.
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const scope = scopeRef.current;

  useEffect(() => () => {
    ownerRef.current = null;
    runRef.current?.finish("paused");
    runRef.current = null;
  }, [scope]);

  const begin = useCallback((signal: AbortSignal): CopilotProgressRun => {
    if (scopeRef.current !== scope) {
      const stale = createCopilotProgressRun({ id: crypto.randomUUID(), signal, onChange: () => {}, isCurrent: () => false });
      stale.finish("paused");
      return stale;
    }
    runRef.current?.finish("paused");
    const owner = {};
    ownerRef.current = owner;
    const run = createCopilotProgressRun({
      id: crypto.randomUUID(),
      signal,
      isCurrent: () => scopeRef.current === scope && ownerRef.current === owner,
      onChange: value => setSnapshot({ scope, value }),
    });
    runRef.current = run;
    return run;
  }, [scope]);

  return { progress: snapshot?.scope === scope ? snapshot.value : null, begin };
}
