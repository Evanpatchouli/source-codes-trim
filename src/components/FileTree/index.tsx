import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Flex, IconButton, Tooltip } from "@chakra-ui/react";
import { DragHandleIcon, ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import classes from "#/utils/classes";
import type { TreeDropPosition } from "#/utils/moveFileTreeItem";
import { describeFileRange } from "#/utils/filePreview";
import Loading from "../Loading";
import "./index.css";

interface FileTreeProps {
  items: FileItem[];
  ignoredPaths: ReadonlySet<string>;
  onToggleIgnored: (path: string) => void;
  onMove: (sourcePath: string, targetPath: string, position: TreeDropPosition) => void;
  report: Pick<TrimSourceCodesResult, "fileRanges" | "skipped"> | null;
  onViewFile: (index: number) => void;
  loading?: boolean;
}

const treeDragType = "application/x-source-codes-trim-tree-item";

function dropPosition(event: DragEvent<HTMLDivElement>, isDirectory: boolean): TreeDropPosition {
  const row = event.currentTarget.getBoundingClientRect();
  const fraction = (event.clientY - row.top) / row.height;
  if (isDirectory && fraction >= 0.25 && fraction <= 0.75) return "inside";
  return fraction < 0.5 ? "before" : "after";
}

export default function FileTree({ items, ignoredPaths, onToggleIgnored, onMove, report, onViewFile, loading }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const results = useMemo(() => {
    const byPath = new Map<string, { index: number | null; label: string; reason?: string }>();
    report?.fileRanges.forEach((range, index) => byPath.set(range.path, { index, label: describeFileRange(range) }));
    report?.skipped.forEach(({ path, reason }) => byPath.set(path, { index: null, label: "已跳过", reason }));
    return byPath;
  }, [report]);
  const dragSource = useRef<{ path: string; subtree: HTMLElement; items: FileItem[] } | null>(null);
  const dropRow = useRef<HTMLElement | null>(null);

  function clearDropRow() {
    dropRow.current?.removeAttribute("data-drop-position");
    dropRow.current = null;
  }

  function endDrag() {
    clearDropRow();
    dragSource.current?.subtree.removeAttribute("data-dragging");
    dragSource.current = null;
  }

  useEffect(() => endDrag, [items]);

  function startDrag(event: DragEvent<HTMLDivElement>, path: string) {
    const subtree = event.currentTarget.parentElement;
    if (!subtree) return;
    endDrag();
    dragSource.current = { path, subtree, items };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(treeDragType, "move");
    subtree.dataset.dragging = "true";
  }

  function validSource(event: DragEvent<HTMLDivElement>) {
    const source = dragSource.current;
    if (!source || source.items !== items || !event.dataTransfer.types.includes(treeDragType)) return null;
    return source.subtree.contains(event.currentTarget) ? null : source;
  }

  function dragOver(event: DragEvent<HTMLDivElement>, item: FileItem) {
    event.preventDefault();
    event.stopPropagation();
    if (!validSource(event)) {
      event.dataTransfer.dropEffect = "none";
      clearDropRow();
      return;
    }
    event.dataTransfer.dropEffect = "move";
    if (dropRow.current !== event.currentTarget) clearDropRow();
    dropRow.current = event.currentTarget;
    event.currentTarget.dataset.dropPosition = dropPosition(event, item.is_dir);
  }

  function drop(event: DragEvent<HTMLDivElement>, item: FileItem) {
    event.preventDefault();
    event.stopPropagation();
    const source = validSource(event);
    endDrag();
    if (!source) return;
    const position = dropPosition(event, item.is_dir);
    onMove(source.path, item.path, position);
    if (position === "inside") setExpanded((prev) => ({ ...prev, [item.path]: true }));
  }

  function renderNode(item: FileItem, index: number, siblings: FileItem[], root: boolean, parentIgnored: boolean) {
    const isExpanded = !!expanded[item.path];
    const isIgnored = parentIgnored || ignoredPaths.has(item.path);
    const action = parentIgnored ? "已随上级目录排除" : isIgnored ? "恢复包含" : "排除";
    const result = !item.is_dir && !isIgnored ? results.get(item.path) : undefined;
    const indexInResult = result?.index;
    const status = isIgnored && !item.is_dir ? "已排除" : result?.label;
    const name = (
      <>
        <span className="tree-filename">
          <span aria-hidden="true">{item.is_dir ? (isExpanded ? "📂" : "📁") : "📄"}</span> {item.name}
        </span>
        {status && <small className="tree-file-status">{status}</small>}
      </>
    );
    return (
      <div key={item.path} className={classes("tree", root && "tree-root")}>
        <div
          className={classes("tree-item", root && "tree-item-root", isIgnored && "tree-item-ignored")}
          draggable
          onDragStart={(event) => startDrag(event, item.path)}
          onDragEnd={endDrag}
          onDragOver={(event) => dragOver(event, item)}
          onDrop={(event) => drop(event, item)}
        >
          <button
            type="button"
            className="tree-move-handle"
            aria-label={`移动 ${item.name}`}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title="拖动调整位置，或按 Alt + ↑ / ↓ 在同级移动"
            onKeyDown={(event) => {
              if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              const up = event.key === "ArrowUp";
              const neighbor = siblings[index + (up ? -1 : 1)];
              if (neighbor) onMove(item.path, neighbor.path, up ? "before" : "after");
            }}
          >
            <DragHandleIcon aria-hidden="true" />
          </button>
          {item.is_dir ? (
            <button
              type="button"
              className="tree-name"
              aria-expanded={isExpanded}
              onClick={() => setExpanded((prev) => ({ ...prev, [item.path]: !prev[item.path] }))}
            >
              {name}
            </button>
          ) : typeof indexInResult === "number" ? (
            <button
              type="button"
              className="tree-name"
              aria-label={`查看 ${item.name} 的整理结果，${status}`}
              title={item.path}
              onClick={() => onViewFile(indexInResult)}
            >{name}</button>
          ) : (
            <span className="tree-name" title={result?.reason ?? item.path}>{name}</span>
          )}
          <Tooltip label={action} placement="bottom" hasArrow>
            <span className="actions">
              <IconButton
                aria-label={`${action} ${item.name}`}
                variant="ghost"
                size="sm"
                isDisabled={parentIgnored}
                color={isIgnored ? "red.400" : "blue.400"}
                onClick={() => onToggleIgnored(item.path)}
              >
                {isIgnored ? <ViewOffIcon /> : <ViewIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </div>
        {item.is_dir && isExpanded && item.children.map((child, i, children) => renderNode(child, i, children, false, isIgnored))}
      </div>
    );
  }

  return (
    <div
      className="tree-wrapper"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
        clearDropRow();
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) clearDropRow();
      }}
      onDrop={(event) => { event.preventDefault(); endDrag(); }}
    >
      {loading || !items.length ? (
        <div className="tree-placeholder">
          {loading ? (
            <Flex alignItems="center" justifyContent="center" gap="0.5rem">
              <Loading mr={8} on />
              <span>加载中...</span>
            </Flex>
          ) : "文件树空空如也"}
        </div>
      ) : items.map((item, i) => renderNode(item, i, items, true, false))}
    </div>
  );
}
