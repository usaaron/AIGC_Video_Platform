"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { ConfirmationDialog } from "@/components/workspace-controls";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function ProjectDeleteButton({ projectId, title, className, children, onDeleted }: {
  projectId: string; title: string; className: string; children: ReactNode; onDeleted?: () => void;
}) {
  const { deleteProject } = useProjects();
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (!await deleteProject(projectId)) {
        setError(t("library.deleteFailed"));
        return;
      }
      setOpen(false);
      onDeleted?.();
      if (pathname.split("/")[2] === projectId) router.push("/");
    } catch {
      setError(t("library.deleteFailed"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <>
    <button aria-label={`${t("nav.delete")} ${title}`} className={className} type="button"
      onClick={() => { setError(""); setOpen(true); }}>{children}</button>
    <ConfirmationDialog open={open} title={t("library.deleteTitle")} confirmLabel={t("nav.delete")}
      cancelLabel={t("library.cancel")} busy={busy} onClose={() => setOpen(false)} onConfirm={() => void remove()}>
      <p className="workspace-confirm-project">{title}</p>
      <p>{t("nav.deleteConfirm")}</p>
      {error && <p role="alert" className="inline-notice is-error">{error}</p>}
    </ConfirmationDialog>
  </>;
}
