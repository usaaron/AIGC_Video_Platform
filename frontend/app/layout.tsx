import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/600.css";
import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { LocaleProvider } from "@/providers/locale-provider";
import { ProjectProvider } from "@/providers/project-provider";

export const metadata: Metadata = {
  title: "AI Comic Content OS",
  description: "An editorial workspace for shaping AI comic scripts.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>
          <ProjectProvider>
            <AppShell>{children}</AppShell>
          </ProjectProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
