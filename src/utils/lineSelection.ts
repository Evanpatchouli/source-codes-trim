export type LineSelection =
  | { mode: "all" }
  | { mode: "range"; start: number; end: number }
  | { mode: "headTail"; head: number; tail: number };

function wholeNumber(input: string): number | null {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseLineSelection(
  mode: LineSelection["mode"],
  first: string,
  last: string,
  total: number,
): { selection: LineSelection; count: number } | { error: string } {
  if (!Number.isSafeInteger(total) || total < 0) return { error: "全文行数无效" };
  if (mode === "all") return { selection: { mode }, count: total };
  if (total === 0) return { error: "空结果可使用全文导出" };
  const a = wholeNumber(first);
  const b = wholeNumber(last);
  if (a === null || b === null) return { error: "请在两个输入框中填写非负整数" };
  if (mode === "range") {
    if (a < 1 || b > total || a > b) return { error: `行号须在 1 至 ${total} 之间，起始行不能大于结束行` };
    return { selection: { mode, start: a, end: b }, count: b - a + 1 };
  }
  if (mode !== "headTail") return { error: "请选择导出方式" };
  if (a === 0 && b === 0) return { error: "开头和结尾至少选取一行" };
  const head = Math.min(a, total);
  const tail = Math.min(b, total);
  return { selection: { mode, head, tail }, count: head + Math.min(tail, total - head) };
}
