export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  // Keep the object URL alive until the browser has started the download.
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
