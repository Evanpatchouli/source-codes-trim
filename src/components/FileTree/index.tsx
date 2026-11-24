import { useState } from "react";
import { Flex, IconButton, Tooltip } from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import classes from "#/utils/classes";
import Loading from "../Loading";
import "./index.css";

interface FileTreeProps {
  items: FileItem[];
  ignoredPaths: ReadonlySet<string>;
  onToggleIgnored: (path: string) => void;
  loading?: boolean;
}

export default function FileTree({ items, ignoredPaths, onToggleIgnored, loading }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function renderNode(item: FileItem, root: boolean, parentIgnored: boolean) {
    const isExpanded = !!expanded[item.path];
    const isIgnored = parentIgnored || ignoredPaths.has(item.path);
    const action = parentIgnored ? "已随上级目录排除" : isIgnored ? "恢复包含" : "排除";
    const name = (
      <>
        <span aria-hidden="true">{item.is_dir ? (isExpanded ? "📂" : "📁") : "📄"}</span> {item.name}
      </>
    );
    return (
      <div key={item.path} className={classes("tree", root && "tree-root")}>
        <div className={classes("tree-item", root && "tree-item-root", isIgnored && "tree-item-ignored")}>
          {item.is_dir ? (
            <button
              type="button"
              className="tree-name"
              aria-expanded={isExpanded}
              onClick={() => setExpanded((prev) => ({ ...prev, [item.path]: !prev[item.path] }))}
            >
              {name}
            </button>
          ) : (
            <span className="tree-name">{name}</span>
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
        {item.is_dir && isExpanded && item.children.map((child) => renderNode(child, false, isIgnored))}
      </div>
    );
  }

  if (loading || !items.length) {
    return (
      <div className="tree-placeholder">
        {loading ? (
          <Flex alignItems="center" justifyContent="center" gap="0.5rem">
            <Loading mr={8} on />
            <span>加载中...</span>
          </Flex>
        ) : "文件树空空如也"}
      </div>
    );
  }
  return <div className="tree-wrapper">{items.map((item) => renderNode(item, true, false))}</div>;
}
