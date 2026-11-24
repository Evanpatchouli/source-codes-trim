export type PlanFilters = { includes: string; excludes: string; excludeEmptyDirs: boolean };

type PlanEntry = {
  path: string;
  parent: string | null;
  kind: "file" | "directory";
  ignored: boolean;
};

export type SourcePlan = { version: 1; filters: PlanFilters; entries: PlanEntry[] };

// Portable relative keys use "/" as separator. Escape only characters that could
// otherwise look like Windows path syntax or an escape (including in POSIX filenames).
const escapes: Record<string, string> = { "%": "%25", "\\": "%5C", ":": "%3A" };
function displayPath(key: string) {
  return key.replace(/%25|%5C|%3A/g, (code) => String.fromCharCode(parseInt(code.slice(1), 16)));
}

function validKey(key: unknown): key is string {
  return typeof key === "string" && !/[\0\\:]|%(?!25|5C|3A)/.test(key)
    && key.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function relativeKeys(root: string, files: readonly FileItem[]) {
  if (!root || root.includes("\0")) throw new Error("方案需要有效的项目根目录");
  const windows = /^(?:[a-z]:[\\/]|\\\\|\/\/[^/]+\/[^/]+)/i.test(root)
    || (!root.startsWith("/") && (root.includes("\\") || files[0]?.path.startsWith(root + "\\")));
  const normalize = (path: string) => windows ? path.replace(/\\/g, "/") : path;
  const prefix = normalize(root).replace(/\/+$/, "") + "/";
  const expected = windows ? prefix.toLowerCase() : prefix;
  return (path: string) => {
    const normalized = normalize(path);
    const start = normalized.slice(0, prefix.length);
    if ((windows ? start.toLowerCase() : start) !== expected) throw new Error("文件路径超出所选根目录");
    const key = normalized.slice(prefix.length).replace(/[%\\:]/g, (char) => escapes[char]);
    if (!validKey(key)) throw new Error("扫描结果含无效的相对路径");
    return key;
  };
}

function* walkFiles(root: string, files: readonly FileItem[]) {
  const relative = relativeKeys(root, files);
  const seen = new Set<string>();
  const stack: { items: readonly FileItem[]; index: number; parent: string | null }[] = [
    { items: files, index: 0, parent: null },
  ];
  while (stack.length) {
    const level = stack[stack.length - 1];
    if (level.index === level.items.length) {
      stack.pop();
      continue;
    }
    const item = level.items[level.index++];
    const key = relative(item.path);
    if (seen.has(key)) throw new Error("扫描结果含重复路径");
    seen.add(key);
    yield { item, key, parent: level.parent };
    if (item.is_dir) stack.push({ items: item.children, index: 0, parent: key });
  }
}

export function createSourcePlan(
  root: string, files: readonly FileItem[], ignoredPaths: ReadonlySet<string>, filters: PlanFilters,
): SourcePlan {
  const entries: PlanEntry[] = [];
  for (const { item, key, parent } of walkFiles(root, files)) {
    entries.push({ path: key, parent, kind: item.is_dir ? "directory" : "file", ignored: ignoredPaths.has(item.path) });
  }
  const { includes, excludes, excludeEmptyDirs } = filters;
  return { version: 1, filters: { includes, excludes, excludeEmptyDirs }, entries };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inspectPlan(value: unknown) {
  if (!isObject(value) || value.version !== 1) throw new Error("无法识别整理方案版本，需要版本 1");
  const filters = value.filters;
  if (!isObject(filters) || typeof filters.includes !== "string" || typeof filters.excludes !== "string"
    || typeof filters.excludeEmptyDirs !== "boolean") throw new Error("方案的筛选条件无效");
  if (!Array.isArray(value.entries)) throw new Error("方案缺少文件列表");
  const nodes = new Map<string, PlanEntry>();
  const groups = new Map<string | null, PlanEntry[]>();
  for (const entry of value.entries as unknown[]) {
    if (!isObject(entry) || !validKey(entry.path) || !(entry.parent === null || validKey(entry.parent))
      || (entry.kind !== "file" && entry.kind !== "directory") || typeof entry.ignored !== "boolean") {
      throw new Error("方案含无效的文件条目或相对路径");
    }
    if (nodes.has(entry.path)) throw new Error("方案含重复的相对路径");
    const safeEntry: PlanEntry = { path: entry.path, parent: entry.parent, kind: entry.kind, ignored: entry.ignored };
    nodes.set(safeEntry.path, safeEntry);
    const siblings = groups.get(safeEntry.parent);
    if (siblings) siblings.push(safeEntry);
    else groups.set(safeEntry.parent, [safeEntry]);
  }
  for (const parent of groups.keys()) {
    if (parent !== null && nodes.get(parent)?.kind !== "directory") throw new Error("方案中的上级目录无效");
  }
  // With unique nodes and one parent per entry, an unreachable group implies a cycle.
  let reachable = 0;
  const levels = [groups.get(null) ?? []];
  while (levels.length) {
    for (const entry of levels.pop()!) {
      reachable++;
      const children = groups.get(entry.path);
      if (children) levels.push(children);
    }
  }
  if (reachable !== nodes.size) throw new Error("方案中的目录形成循环");
  const { includes, excludes, excludeEmptyDirs } = filters;
  const plan: SourcePlan = { version: 1, filters: { includes, excludes, excludeEmptyDirs }, entries: [...nodes.values()] };
  return { plan, groups };
}

export function parseSourcePlan(text: string): SourcePlan {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("整理方案不是有效的 JSON 文件"); }
  return inspectPlan(value).plan;
}

export function applySourcePlan(root: string, scannedFiles: readonly FileItem[], plan: SourcePlan) {
  const { groups } = inspectPlan(plan);
  const scanned = new Map<string, { item: FileItem; parent: string | null }>();
  for (const { item, key, parent } of walkFiles(root, scannedFiles)) {
    scanned.set(key, { item: item.is_dir ? { ...item, children: [] } : item, parent });
  }

  const files: FileItem[] = [];
  const ignoredPaths = new Set<string>();
  const added: string[] = [];
  const missing: string[] = [];
  const retained = new Set<string>();
  const stack = [{ entries: groups.get(null) ?? [], index: 0, output: files }];
  while (stack.length) {
    const level = stack[stack.length - 1];
    if (level.index === level.entries.length) {
      stack.pop();
      continue;
    }
    const entry = level.entries[level.index++];
    const current = scanned.get(entry.path)?.item;
    let output = level.output;
    if (current && current.is_dir === (entry.kind === "directory")) {
      output.push(current);
      retained.add(entry.path);
      if (entry.ignored) ignoredPaths.add(current.path);
      output = current.children;
    } else if (entry.kind === "file") {
      missing.push(displayPath(entry.path));
    }
    // If a virtual folder disappeared, surviving children occupy its former position.
    const children = groups.get(entry.path);
    if (children) stack.push({ entries: children, index: 0, output });
  }
  // Append newcomers to their physical parent's current (possibly moved) directory.
  for (const [key, { item, parent }] of scanned) {
    if (retained.has(key)) continue;
    const siblings = parent === null ? files : scanned.get(parent)!.item.children;
    siblings.push(item);
    if (!item.is_dir) added.push(displayPath(key));
  }
  return { files, ignoredPaths, added, missing };
}
