import { useRef, useState } from "react";
import { open as select } from "@tauri-apps/plugin-dialog";
import { Box, Button, Flex, FormLabel, Input, Switch, Text, Textarea, Tooltip } from "@chakra-ui/react";
import { AddIcon, CopyIcon } from "@chakra-ui/icons";
import TitleBar from "#components/TitleBar";
import FileTree, { TreeRef } from "#components/FileTree";
import flatternFileTree from "#utils/flatternFileTree";
import { Resizable } from "re-resizable";
import invoke from "#utils/invoke";
import "./App.css";
import parseCludes from "./utils/parseCludes";
import Loading from "./components/Loading";
import sleep from "./utils/sleep";
import Tip from "./components/Tip";
import { useLocalStorage } from "@uidotdev/usehooks";

const includesPlaceholder = `不填写则默认包含全部文件。格式类同 .gitignore，用换行或 | 分割，示例:
*.ts | *.rs
`;

const excludesPlaceholder = `不填写则默认不排除任何文件。格式类同 .gitignore，用换行或 | 分割，示例:
node_modules
/src-tauri/target
`;

const minLoadingTime = 200;

function App() {
  const [root, setRoot] = useState<string>("");
  const [includes, setIncludes] = useState<string>("");
  const [excludes, setExcludes] = useState<string>("");
  const [exclude_empty_dirs, setExcludeEmptyDirs] = useState<boolean>(true);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(false);
  const [content, setContent] = useState<string>("");
  const [contentLoading, setContentLoading] = useState<boolean>(false);
  const lineNumber = content ? content.split("\n").length : 0;

  const disable_trim_source_codes = files.length === 0;

  const treeRef = useRef<TreeRef>(null);

  const openRoot = () =>
    root &&
    invoke("open_directory_in_fs", {
      path: root,
    });

  const [treeWidth, setTreeWidth] = useState(300);

  const [showLongtimeTip, setShowLongtimeTip] = useLocalStorage("showLongtimeTip", true);

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
            id="maib-viewbox"
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
                    setRoot(path || "");
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
                      setContentLoading(true);
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
                      setContentLoading(false);
                      queueMicrotask(() => {
                        setContent(resp.result || "");
                      });
                    }}
                  >
                    整理源码
                  </Button>
                </Flex>
              </Flex>
            </Box>
            {/** @Evanpatchouli 下面的 2rem 是因为 main-viewbox 的 padding 为 1rem */}
            <Box className="content-container" flex="1" tabIndex={0} width={`calc(100vw - ${treeWidth}px - 2rem)`}>
              <Flex
                position="absolute"
                alignItems="center"
                right="0.5rem"
                top="0.5rem"
                gap="0.5rem"
                opacity={contentLoading ? 0 : 1}
              >
                <Text fontSize="sm" color="GrayText">
                  {lineNumber} 行
                </Text>
                <Button size="sm" variant="ghost" color="GrayText">
                  <Text fontWeight="medium">复制</Text>
                  <CopyIcon fontSize="sm" ml="0.2rem" />
                </Button>
              </Flex>
              <Flex
                hidden={!contentLoading}
                position="absolute"
                top="50%"
                left="50%"
                gap="1rem"
                transform="translate(-50%, -50%)"
              >
                <Loading on={contentLoading} />
                <span>整理中...</span>
              </Flex>
              <pre
                style={{
                  opacity: contentLoading ? 0 : 1,
                }}
              >
                {content}
              </pre>
            </Box>
          </Box>
        </Box>
      </main>
    </div>
  );
}

export default App;
