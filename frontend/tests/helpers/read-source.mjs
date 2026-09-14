import { readFile } from "node:fs/promises";

export async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n/g, "\n");
}
