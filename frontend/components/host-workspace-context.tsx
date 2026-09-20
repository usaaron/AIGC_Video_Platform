"use client";

import { createContext, useContext } from "react";

// The page owns its outline and selection; the host frame only supplies its location.
export const HostWorkspaceContext = createContext<HTMLElement | null>(null);
export function useHostDirectoryTarget() {
  return useContext(HostWorkspaceContext);
}
