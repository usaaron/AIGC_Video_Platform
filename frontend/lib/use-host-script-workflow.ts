"use client";

import { useEffect, useState } from "react";
import { isHostScriptWorkflow } from "./host-navigation";

export function useHostScriptWorkflow(): boolean | null {
  const [scriptWorkflow, setScriptWorkflow] = useState<boolean | null>(null);
  useEffect(() => { setScriptWorkflow(isHostScriptWorkflow()); }, []);
  return scriptWorkflow;
}
