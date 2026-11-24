export default function selectedFilePaths(items: readonly FileItem[], ignoredPaths: ReadonlySet<string>): string[] {
  const paths: string[] = [];
  function visit(nodes: readonly FileItem[]) {
    for (const node of nodes) {
      if (ignoredPaths.has(node.path)) continue;
      if (node.is_dir) visit(node.children);
      else paths.push(node.path);
    }
  }
  visit(items);
  return paths;
}
