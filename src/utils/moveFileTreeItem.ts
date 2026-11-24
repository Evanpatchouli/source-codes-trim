export type TreeDropPosition = "before" | "after" | "inside";

type Location = {
  item: FileItem;
  siblings: FileItem[];
  index: number;
  ancestors: FileItem[];
};

function locate(siblings: FileItem[], path: string, ancestors: FileItem[] = []): Location | undefined {
  for (const [index, item] of siblings.entries()) {
    if (item.path === path) return { item, siblings, index, ancestors: ancestors.slice() };
    if (!item.is_dir) continue;
    ancestors.push(item);
    const found = locate(item.children, path, ancestors);
    ancestors.pop();
    if (found) return found;
  }
}

export default function moveFileTreeItem(
  files: FileItem[],
  sourcePath: string,
  targetPath: string,
  position: TreeDropPosition,
): FileItem[] {
  if (sourcePath === targetPath) return files;
  const source = locate(files, sourcePath);
  const target = locate(files, targetPath);
  if (!source || !target || target.ancestors.includes(source.item)) return files;

  let destination = target.siblings;
  let index = target.index;
  const changedParents = new Set([...source.ancestors, ...target.ancestors]);
  switch (position) {
    case "before": break;
    case "after": index++; break;
    case "inside":
      if (!target.item.is_dir) return files;
      destination = target.item.children;
      index = destination.length;
      changedParents.add(target.item);
      break;
    default: return files;
  }
  if (source.siblings === destination) {
    if (source.index < index) index--;
    if (source.index === index) return files;
  }

  const reorder = (siblings: FileItem[]): FileItem[] => {
    const next = siblings.map((item) => changedParents.has(item)
      ? { ...item, children: reorder(item.children) }
      : item);
    if (siblings === source.siblings) next.splice(source.index, 1);
    if (siblings === destination) next.splice(index, 0, source.item);
    return next;
  };
  return reorder(files);
}
