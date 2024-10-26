import { useRef, useState } from "react";
import { open as select } from "@tauri-apps/plugin-dialog";
import { Box, Button, Flex, FormLabel, Input, Switch, Text, Textarea, Tooltip } from "@chakra-ui/react";
import { AddIcon, CopyIcon } from "@chakra-ui/icons";
import TitleBar from "#components/TitleBar";
import FileTree, { TreeRef } from "#components/FileTree";
import flatternFileTree from "#utils/flatternFileTree";
import { Resizable } from "re-resizable";
import invoke from "#utils/invoke";
import parseCludes from "./utils/parseCludes";
import Loading from "./components/Loading";
import sleep from "./utils/sleep";
import Tip from "./components/Tip";
import { useLocalStorage } from "@uidotdev/usehooks";
import Broom from "./components/icons/Broom";
import toast from "react-hot-toast";
import "./App.css";

const includesPlaceholder = `不填写则默认包含全部文件。格式类同 .gitignore，用换行或 | 分割，示例:
*.ts | *.rs
`;

const excludesPlaceholder = `不填写则默认不排除任何文件。格式类同 .gitignore，用换行或 | 分割，示例:
node_modules
/src-tauri/target
`;

const minLoadingTime = 200;

const MAX_CONTENT_LENGTH = 1000000; // 设置最大内容长度 100 万字符

const getMaxContentLength = () => {
  if ("memory" in performance) {
    // @ts-ignore
    const { totalJSHeapSize, usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
    const availableMemory = jsHeapSizeLimit - usedJSHeapSize;
    // 假设我们使用可用内存的 10% 作为最大内容长度
    return Math.floor(availableMemory * 0.1);
  }
  // 如果 performance.memory 不可用，使用默认值
  return MAX_CONTENT_LENGTH;
};

function App() {
  const [root, setRoot] = useState<string>("");
  const [includes, setIncludes] = useState<string>("");
  const [excludes, setExcludes] = useState<string>("");
  const [exclude_empty_dirs, setExcludeEmptyDirs] = useState<boolean>(true);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(false);
  const [content, setContent] = useState<string>("");
  const [contentState, setContentState] = useState<"loading" | "loaded" | "error">("loaded");
  const lineNumber = (content ? content.split("\n") : []).length;

  const disable_trim_source_codes = files.length === 0;

  const treeRef = useRef<TreeRef>(null);

  const openRoot = () =>
    root &&
    invoke("open_directory_in_fs", {
      path: root,
    });

  const [treeWidth, setTreeWidth] = useState(240);

  const [showLongtimeTip, setShowLongtimeTip] = useLocalStorage("showLongtimeTip", true);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("已复制到剪贴板", {
        position: "bottom-right",
      });
    } catch (error) {
      toast.error("复制失败，请手动复制", {
        position: "bottom-right",
      });
    }
  };

  const handleClear = () => {
    setContent("");
  };

  const preRef = useRef<HTMLPreElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      if (preRef.current) {
        const range = document.createRange();
        range.selectNodeContents(preRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  };

  return (
    <div className="container">
      <TitleBar />
      <main className="main-container">
        <Box display="flex" flexDirection="row" height="100%">
          <Resizable
            className="file-tree-container"
            size={{
              width: treeWidth,
            }}
            onResizeStop={(_e, _direction, _ref, d) => {
              setTreeWidth((prev) => prev + d.width);
            }}
            minWidth={168}
            maxWidth={"80%"}
          >
            <header className="file-tree-header">
              <Text fontSize="sm" className="nowrap">
                文件树
              </Text>
              <Tooltip label={root && "在文件管理器中打开"} aria-label={root && "在文件管理器中打开"} hasArrow>
                <Text
                  ml="3.5"
                  fontSize="sm"
                  textDecoration={root ? "underline" : "none"}
                  onClick={openRoot}
                  color={root ? "blue.500" : "gray.300"}
                  cursor={root ? "pointer" : "default"}
                  className="nowrap"
                  overflow={"hidden"}
                  textOverflow={"ellipsis"}
                >
                  {root ? `${root}` : "未选择根目录"}
                </Text>
              </Tooltip>
            </header>
            <FileTree items={files} ref={treeRef} loading={treeLoading} />
          </Resizable>
          <Box
            id="main-viewbox"
            display="flex"
            flexDirection="column"
            rowGap="1rem"
            w="100%"
            flex="1"
            boxSizing="border-box"
            p="1rem"
          >
            <Box display="flex" flexDirection="column" rowGap="1rem">
              <Flex alignItems="center" w="100%">
                <FormLabel htmlFor="root" aria-required>
                  路径:
                </FormLabel>
                <Input
                  flex="1"
                  value={root}
                  onChange={(e) => {
                    e.preventDefault();
                    setRoot(e.target.value);
                  }}
                  name="root"
                  size="sm"
                  placeholder="输入或选择你的项目根目录的绝对路径..."
                  sx={{
                    "::placeholder": {
                      color: "gray.300",
                    },
                  }}
                  required
                />
                <Button
                  onClick={async () => {
                    const path = await select({
                      directory: true,
                      multiple: false,
                    });
                    if (path && path !== root) {
                      setRoot(path);
                      setFiles([]);
                      setContent("");
                    }
                  }}
                  size="sm"
                  className="nowrap"
                  ml={2}
                >
                  选择目录
                </Button>
              </Flex>
              <Flex alignItems="start" w="100%">
                <FormLabel htmlFor="includes" className="nowrap" size="sm">
                  包含:
                </FormLabel>
                <Textarea
                  name="includes"
                  value={includes}
                  onChange={(e) => {
                    e.preventDefault();
                    setIncludes(e.target.value);
                  }}
                  size="sm"
                  placeholder={includesPlaceholder}
                  sx={{
                    "::placeholder": {
                      color: "gray.300",
                    },
                  }}
                />
              </Flex>
              <Flex alignItems="start" w="100%">
                <FormLabel htmlFor="excludes" className="nowrap" size="sm">
                  排除:
                </FormLabel>
                <Textarea
                  name="excludes"
                  value={excludes}
                  onChange={(e) => {
                    e.preventDefault();
                    setExcludes(e.target.value);
                  }}
                  size="sm"
                  placeholder={excludesPlaceholder}
                  sx={{
                    "::placeholder": {
                      color: "gray.300",
                    },
                  }}
                />
              </Flex>
              <Flex alignItems="center" w="100%" justifyContent="space-between">
                <Flex alignItems="center" flex="1" gap="1rem">
                  <Flex alignItems="center">
                    <FormLabel htmlFor="exclude_empty_dirs" mb={0} size="sm">
                      去除空文件夹:
                    </FormLabel>
                    <Switch
                      name="exclude_empty_dirs"
                      isChecked={exclude_empty_dirs}
                      onChange={(e) => {
                        e.preventDefault();
                        setExcludeEmptyDirs(e.target.checked);
                      }}
                      size="sm"
                    />
                  </Flex>
                  <Button variant="ghost" size="sm" color="GrayText" hidden>
                    <Text>更多</Text>
                    <AddIcon ml="0.3rem" />
                  </Button>
                </Flex>
                <Flex columnGap="0.5rem" alignItems="center">
                  {showLongtimeTip && (
                    <Tip
                      aria-label="提示"
                      component="popover"
                      title="提示"
                      variant="info"
                      content="这两项操作可能需要较长时间，请耐心等待。"
                      footer={(close) => (
                        <Button
                          size="xs"
                          fontSize="xs"
                          colorScheme="blue"
                          onClick={() => {
                            close();
                            setShowLongtimeTip(false);
                          }}
                        >
                          不在显示
                        </Button>
                      )}
                    />
                  )}
                  <Button
                    onClick={async () => {
                      setTreeLoading(true);
                      const timestart = performance.now();
                      const files = await invoke("get_files", {
                        path: root,
                        includes: parseCludes(includes),
                        excludes: parseCludes(excludes),
                        excludeEmptyDirs: exclude_empty_dirs,
                      });
                      const timeend = performance.now();
                      const timedelta = timeend - timestart;
                      if (timedelta < minLoadingTime) {
                        await sleep(minLoadingTime - timedelta);
                      }
                      setTreeLoading(false);
                      queueMicrotask(() => {
                        setFiles(typeof files === "string" ? [] : files);
                      });
                    }}
                    disabled={!root}
                    className="nowrap"
                    size="sm"
                  >
                    获取文件
                  </Button>
                  <Button
                    id="trim-source-codes"
                    size="sm"
                    disabled={disable_trim_source_codes}
                    onClick={async () => {
                      setContentState("loading");
                      const timestart = performance.now();
                      const ignoredPaths = treeRef.current?.getIgnoredPaths() || [];
                      const pathList = flatternFileTree(files)
                        .filter((i) => !i.is_dir)
                        .map((i) => i.path)
                        .filter((i) => !ignoredPaths.some((j) => i.startsWith(j)));
                      const resp = await invoke("trim_source_codes", {
                        files: pathList,
                        trimWhitespace: true,
                        trimNewlines: true,
                        trimComments: true,
                      });
                      const timeend = performance.now();
                      const timedelta = timeend - timestart;
                      if (timedelta < minLoadingTime) {
                        await sleep(minLoadingTime - timedelta);
                      }
                      const MAX = getMaxContentLength();
                      if (resp.result.length > MAX) {
                        setContent("内容过长，无法显示");
                        setContentState("error");
                      } else {
                        queueMicrotask(() => {
                          setContent(resp.result || "");
                          setContentState("loaded");
                        });
                      }
                    }}
                  >
                    整理源码
                  </Button>
                </Flex>
              </Flex>
            </Box>
            {/** @Evanpatchouli 下面的 2rem 是因为 main-viewbox 的 padding 为 1rem */}
            <Box
              className="content-container"
              tabIndex={0}
              width={`calc(100vw - ${treeWidth}px - 2rem)`}
              onKeyDown={handleKeyDown}
            >
              <Flex
                position="absolute"
                right="1rem"
                top="0.5rem"
                alignItems="center"
                opacity={contentState === "loaded" ? 1 : 0}
                zIndex={contentState === "loaded" ? 1 : -1}
              >
                <Text fontSize="sm" color="GrayText">
                  {lineNumber} 行
                </Text>
                <Button size="sm" variant="ghost" color="GrayText" onClick={handleCopy} ml="0.5rem">
                  <Text fontWeight="medium">复制</Text>
                  <CopyIcon fontSize="sm" ml="0.2rem" />
                </Button>
                <Button size="sm" variant="ghost" color="GrayText" onClick={handleClear}>
                  <Text fontWeight="medium">清除</Text>
                  <Broom fontSize="sm" ml="0.2rem" />
                </Button>
              </Flex>
              <Flex
                hidden={contentState !== "loading"}
                position="absolute"
                top="50%"
                left="50%"
                gap="1rem"
                transform="translate(-50%, -50%)"
              >
                <Loading on />
                <span>整理中...</span>
              </Flex>
              <pre id="content-box" data-state={contentState} ref={preRef}>
                <code>{content}</code>
              </pre>
            </Box>
          </Box>
        </Box>
      </main>
    </div>
  );
}

export default App;
