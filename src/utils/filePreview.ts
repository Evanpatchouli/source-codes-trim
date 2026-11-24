import invoke, { errorMessage } from "./invoke.ts";

export function describeFileRange({ startLine, endLine }: SourceFileRange): string {
  if (startLine === null || endLine === null) return "0 行";
  return startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}–${endLine} 行`;
}

export type FilePageView =
  | { status: "loading"; number: number }
  | { status: "loaded"; number: number; text: string; hasNext: boolean }
  | { status: "error"; number: number; message: string };

export function createFilePager(id: string, index: number, show: (page: FilePageView) => void) {
  const offsets = [0];
  let nextOffset: number | null = null;
  let revision = 0;

  async function read() {
    const request = ++revision;
    const number = offsets.length;
    nextOffset = null;
    show({ status: "loading", number });
    try {
      const page = await invoke("read_trim_file", { id, index, offset: offsets[number - 1] });
      if (request !== revision) return;
      nextOffset = page.nextOffset;
      show({ status: "loaded", number, text: page.text, hasNext: nextOffset !== null });
    } catch (error) {
      if (request === revision) show({ status: "error", number, message: errorMessage(error) });
    }
  }

  return {
    read,
    next() {
      if (nextOffset === null) return;
      offsets.push(nextOffset);
      return read();
    },
    previous() {
      if (offsets.length === 1) return;
      offsets.pop();
      return read();
    },
    dispose() { revision++; },
  };
}
