import { useRef, useState } from "react";
import { open as select } from "@tauri-apps/plugin-dialog";
import { Box, Button, Flex, FormLabel, Input, Switch, Text, Textarea, Tooltip } from "@chakra-ui/react";
import { CopyIcon } from "@chakra-ui/icons";
import TitleBar from "#components/TitleBar";
import FileTree from "#components/FileTree";
import FileSnapshot from "#components/FileSnapshot";
import FileIssues from "#components/FileIssues";
import PlanChanges from "#components/PlanChanges";
import { Resizable } from "re-resizable";
import invoke, { errorMessage } from "#utils/invoke";
import Loading from "./components/Loading";
import useSourceWorkspace from "./hooks/useSourceWorkspace";
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

function App() {
  const {
    options: { path: root, includes, excludes, excludeEmptyDirs },
    files, ignoredPaths, scanIssues, scanError, treeLoading, content, contentState, trimReport,
    setOption, toggleIgnored, moveFile, clearOutput, scanFiles, trimFiles, exportResult, exporting, exportFeedback,
    openPlan, savePlan, hasScan, planChanges, planBusy, planFeedback,
  } = useSourceWorkspace();
  const truncated = trimReport?.truncated ?? false;
  const [selection, setSelection] = useState<{ id: string; index: number } | null>(null);
  const selectedRange = selection && selection.id === trimReport?.exportId ? trimReport.fileRanges[selection.index] : null;

  const disable_trim_source_codes = files.length === 0 || treeLoading || planBusy === "open";

  const openRoot = () =>
    root &&
    invoke("open_directory_in_fs", {
      path: root,
    }).catch((error) => toast.error(`打开目录失败：${errorMessage(error)}`));

  const [treeWidth, setTreeWidth] = useState(240);

  const [showLongtimeTip, setShowLongtimeTip] = useLocalStorage("showLongtimeTip", true);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(truncated ? "已复制预览到剪贴板" : "已复制到剪贴板", {
        position: "bottom-right",
      });
    } catch (error) {
      toast.error("复制失败，请手动复制", {
        position: "bottom-right",
      });
    }
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
            <FileTree
              key={root}
              items={files}
              ignoredPaths={ignoredPaths}
              onToggleIgnored={toggleIgnored}
              onMove={moveFile}
              report={trimReport}
              onViewFile={(index) => {
                if (trimReport?.exportId) setSelection({ id: trimReport.exportId, index });
              }}
              loading={treeLoading}
            />
          </Resizable>
          <Box
            id="main-viewbox"
            display="flex"
            flexDirection="column"
            rowGap="1rem"
            w="100%"
            flex="1"
            minW={0}
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
                  onChange={(e) => setOption("path", e.target.value)}
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
                    if (path) setOption("path", path);
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
                  onChange={(e) => setOption("includes", e.target.value)}
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
                  onChange={(e) => setOption("excludes", e.target.value)}
                  size="sm"
                  placeholder={excludesPlaceholder}
                  sx={{
                    "::placeholder": {
                      color: "gray.300",
                    },
                  }}
                />
              </Flex>
              <Flex alignItems="center" w="100%" justifyContent="space-between" flexWrap="wrap" gap={2}>
                <Flex alignItems="center" gap={2} flexWrap="wrap">
                  <Flex alignItems="center">
                    <FormLabel htmlFor="exclude_empty_dirs" mb={0} size="sm">
                      去除空文件夹:
                    </FormLabel>
                    <Switch
                      name="exclude_empty_dirs"
                      isChecked={excludeEmptyDirs}
                      onChange={(e) => setOption("excludeEmptyDirs", e.target.checked)}
                      size="sm"
                    />
                  </Flex>
                  <Button variant="outline" size="sm" onClick={openPlan} isDisabled={!root || treeLoading || !!planBusy}>
                    {planBusy === "open" ? "正在打开…" : "打开方案"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={savePlan} isDisabled={!hasScan || treeLoading || !!planBusy}>
                    {planBusy === "save" ? "正在保存…" : "保存方案"}
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
                          不再显示
                        </Button>
                      )}
                    />
                  )}
                  <Button
                    onClick={scanFiles}
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
                    onClick={trimFiles}
                  >
                    整理源码
                  </Button>
                </Flex>
              </Flex>
            </Box>
            {scanError && <Text role="alert" color="red.600" fontSize="sm">{scanError}</Text>}
            <FileIssues label="扫描" issues={scanIssues} />
            {planFeedback && (
              <Text role={planFeedback.ok ? "status" : "alert"} fontSize="sm" color={planFeedback.ok ? "green.700" : "red.600"} overflowWrap="anywhere">
                {planFeedback.message}
              </Text>
            )}
            {planChanges && <PlanChanges {...planChanges} />}
            {trimReport && (
              <Text role="status" fontSize="sm">
                已处理 {trimReport.processed} 个文件
                {contentState === "loaded" && trimReport.byteCount === 0 && (trimReport.processed ? "，整理结果为空" : "，未选择待整理文件")}
                {truncated && `，当前仅预览开头部分，完整内容共 ${trimReport.byteCount.toLocaleString()} 字节`}
              </Text>
            )}
            {trimReport && <FileIssues label="整理" issues={trimReport.skipped} />}
            <Box
              className="content-container"
              tabIndex={0}
              onKeyDown={handleKeyDown}
            >
              <Flex className="content-toolbar" alignItems="center" justifyContent="flex-end" flexWrap="wrap" gap={1}>
                {contentState === "loaded" && (
                  <>
                    <Text fontSize="sm" color="GrayText" mr="auto">共 {trimReport?.lineCount ?? 0} 行</Text>
                    <Button size="sm" variant="ghost" color="GrayText" onClick={handleCopy} isDisabled={!content}>
                      <Text fontWeight="medium">{truncated ? "复制预览" : "复制"}</Text>
                      <CopyIcon fontSize="sm" ml="0.2rem" />
                    </Button>
                    {trimReport?.exportId && (
                      <Button size="sm" colorScheme="blue" onClick={exportResult} isDisabled={exporting}>
                        {exporting ? "正在导出…" : "导出 TXT"}
                      </Button>
                    )}
                  </>
                )}
                <Button size="sm" variant="ghost" color="GrayText" onClick={clearOutput}>
                  <Text fontWeight="medium">清除</Text>
                  <Broom fontSize="sm" ml="0.2rem" />
                </Button>
              </Flex>
              {exportFeedback && (
                <Text
                  role={exportFeedback.ok ? "status" : "alert"}
                  fontSize="sm"
                  px={2}
                  overflowWrap="anywhere"
                  color={exportFeedback.ok ? "green.700" : "red.600"}
                >
                  {exportFeedback.message}
                </Text>
              )}
              {contentState === "loading" ? (
                <Flex flex="1" alignItems="center" justifyContent="center" gap="1rem">
                  <Loading on />
                  <span>整理中...</span>
                </Flex>
              ) : (
                <pre id="content-box" data-state={contentState} role={contentState === "error" ? "alert" : undefined} ref={preRef}>
                  <code>{content}</code>
                </pre>
              )}
            </Box>
          </Box>
        </Box>
      </main>
      {selection && selectedRange && (
        <FileSnapshot
          key={`${selection.id}-${selection.index}`}
          id={selection.id}
          index={selection.index}
          range={selectedRange}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

export default App;
