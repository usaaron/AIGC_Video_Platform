import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import "./workspace-ui.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { LocaleProvider } from "@/providers/locale-provider";
import { ProjectProvider } from "@/providers/project-provider";

export const metadata: Metadata = {
  title: "剧本大师 | 序幕 TV",
  description: "序幕 TV 旗下剧本大师，面向中国大陆长篇漫剧创作的剧本工作区。",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <LocaleProvider>
          <ProjectProvider>
            <AppShell>{children}</AppShell>
          </ProjectProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
