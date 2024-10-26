import React, { useState, useCallback, useImperativeHandle, forwardRef } from "react";
import "./index.css";
import classes from "#/utils/classes";
import { DragHandleIcon, Flex, IconButton, Tooltip, ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import Loading from "../Loading";

type FileItem = {
  path: string;
  name: string;
  is_dir: boolean;
  children: Array<FileItem>;
};

type TreeNode<Data = any> = {
  parent: TreeNode<Data> | null;
  data: Data;
  children: Array<TreeNode<Data>>;
};

type Tree<Data> = TreeNode<Data>[];

const formatTree = (data: FileItem[]): Tree<FileItem> => {
  const buildTree = (item: FileItem, parent: TreeNode<FileItem> | null): TreeNode<FileItem> => {
    return {
      parent,
      data: item,
      children: item.children.map((child) => buildTree(child, parent)),
    };
  };

  return data.map((item) => buildTree(item, null));
};

export type TreeRef = {
  getIgnoredPaths: () => Array<string>;
};

interface FileTreeProps {
  items: Array<FileItem>;
  loading?: boolean;
}

const grabable: boolean = false;

export default forwardRef<TreeRef, FileTreeProps>(function FileTree(props, ref) {
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});
  const [ignored, setIgnored] = useState<{ [key: string]: boolean }>({});

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const handleLeftClick = useCallback((item: FileItem) => {
    if (item.is_dir) {
      toggleExpand(item.path);
    } else {
      console.log("Clicked on file", item);
    }
  }, []);

  const handleRightClick = useCallback((item: FileItem, event: React.MouseEvent) => {
    event.preventDefault();
    console.log("Right click on", item);
  }, []);

  const handleDragStart = useCallback((item: FileItem, event: React.DragEvent) => {
    event.dataTransfer.setData("text/plain", item.path);
    console.log("Drag start on", item);
  }, []);

  const handleDrop = useCallback((item: FileItem, event: React.DragEvent) => {
    event.preventDefault();
    const targetPath = event.dataTransfer.getData("text/plain");
    console.log(`Dropped on ${targetPath}`, item);
  }, []);

  useImperativeHandle(ref, () => ({
    getIgnoredPaths: () => Object.keys(ignored).filter((i) => ignored[i]),
  }));

  const renderTree = (node: TreeNode<FileItem>, root: boolean) => {
    const isExpanded = expanded[node.data.path];
    const isIgnored = ignored[node.data.path];
    return (
      <div key={node.data.path} className={classes("tree", root && "tree-root")}>
        <div
          onClick={() => handleLeftClick(node.data)}
          onContextMenu={(e) => handleRightClick(node.data, e)}
          draggable={grabable}
          onDragStart={(e) => handleDragStart(node.data, e)}
          onDrop={(e) => handleDrop(node.data, e)}
          className={classes("tree-item", root && "tree-item-root", isIgnored && "tree-item-ignored")}
        >
          <span style={{ flex: "1", overflow: "hidden", textOverflow: "ellipsis" }}>
            <i className="tree-item-i">{node.data.is_dir ? (isExpanded ? "📂" : "📁") : "📄"}</i>
            <span>{node.data.name}</span>
          </span>
          <Flex gap="0.2rem" alignItems="center" className="actions">
            <Tooltip label={isIgnored ? "应排除" : "应包含"} placement="bottom" hasArrow>
              <IconButton
                aria-label={isIgnored ? "应排除" : "应包含"}
                variant="ghost"
                size="sm"
                color={isIgnored ? "red.400" : "blue.400"}
                onClick={(e) => {
                  e.stopPropagation();
                  setIgnored((prev) => ({ ...prev, [node.data.path]: !prev[node.data.path] }));
                }}
              >
                {isIgnored ? <ViewOffIcon /> : <ViewIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip label={grabable ? "拖拽排序" : "拖拽排序尚未支持"} placement="bottom" hasArrow>
              <DragHandleIcon cursor={grabable ? "grab" : "default"} color={grabable ? "blue.400" : "gray.300"} />
            </Tooltip>
          </Flex>
        </div>
        {isExpanded && node.children.map((i) => renderTree(i, false))}
      </div>
    );
  };

  if (!props.items.length || props.loading) {
    return (
      <div
        style={{
          margin: 0,
          textAlign: "center",
          fontSize: "small",
          color: "var(--chakra-colors-gray-300)",
          marginTop: "calc((50vh - var(--header-height)) / 2)",
          transform: "translateY(-50%)",
        }}
      >
        {props.loading ? (
          <Flex alignItems="center" justifyContent="center" gap="0.5rem">
            <Loading mr={8} on />
            <span>加载中...</span>
          </Flex>
        ) : (
          "文件树空空如也"
        )}
      </div>
    );
  }

  const items = formatTree(props.items);

  return <div className="tree-wrapper">{items.map((i) => renderTree(i, true))}</div>;
});
