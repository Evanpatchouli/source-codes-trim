import { useEffect, useState, useSyncExternalStore } from "react";
import selectedFilePaths from "../utils/selectedFilePaths.ts";
import invoke, { errorMessage } from "../utils/invoke.ts";

type ScanOptions = { path: string; includes: string; excludes: string; excludeEmptyDirs: boolean };
type Output = {
  content: string;
  contentState: "loading" | "loaded" | "error";
  trimReport: Pick<TrimSourceCodesResult, "processed" | "skipped"> | null;
};

const emptyOutput: Output = { content: "", contentState: "loaded", trimReport: null };
const emptyScan = { files: [] as FileItem[], scanIssues: [] as FileIssue[], scanError: "", treeLoading: false };
const initialOptions: ScanOptions = { path: "", includes: "", excludes: "", excludeEmptyDirs: true };

function getMaxContentLength() {
  const memory = (performance as Performance & {
    memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
  }).memory;
  return memory ? Math.floor((memory.jsHeapSizeLimit - memory.usedJSHeapSize) * 0.1) : 1000000;
}

export function createSourceWorkspace() {
  let state = { options: initialOptions, ...emptyScan, ...emptyOutput, ignoredPaths: new Set<string>() };
  let scanRequest = 0;
  let trimRequest = 0;
  const listeners = new Set<() => void>();
  function update(patch: Partial<typeof state>) {
    state = { ...state, ...patch };
    listeners.forEach((notify) => notify());
  }

  function invalidateRequests() {
    scanRequest++;
    trimRequest++;
  }

  function setOption<K extends keyof ScanOptions>(key: K, value: ScanOptions[K]) {
    if (state.options[key] === value) return;
    invalidateRequests();
    update({ options: { ...state.options, [key]: value }, ...emptyScan, ...emptyOutput, ignoredPaths: new Set() });
  }

  function toggleIgnored(path: string) {
    trimRequest++;
    const ignoredPaths = new Set(state.ignoredPaths);
    if (ignoredPaths.has(path)) ignoredPaths.delete(path);
    else ignoredPaths.add(path);
    update({ ignoredPaths, ...emptyOutput });
  }

  function clearOutput() {
    trimRequest++;
    update(emptyOutput);
  }

  async function scanFiles() {
    const options = state.options;
    if (!options.path) return;
    const request = ++scanRequest;
    trimRequest++;
    update({ ...emptyScan, ...emptyOutput, treeLoading: true, ignoredPaths: new Set() });
    try {
      const scan = await invoke("get_files", options);
      if (request === scanRequest) update({ files: scan.files, scanIssues: scan.skipped, treeLoading: false });
    } catch (error) {
      if (request === scanRequest) update({ scanError: `扫描失败：${errorMessage(error)}`, treeLoading: false });
    }
  }

  async function trimFiles() {
    const { files, ignoredPaths } = state;
    if (!files.length) return;
    const request = ++trimRequest;
    update({ ...emptyOutput, contentState: "loading" });
    try {
      const { result, processed, skipped } = await invoke("trim_source_codes", {
        files: selectedFilePaths(files, ignoredPaths),
        trimWhitespace: true,
        trimNewlines: true,
        trimComments: true,
      });
      if (request !== trimRequest) return;
      const trimReport = { processed, skipped };
      if (processed === 0 && skipped.length) {
        update({ content: "整理失败，所选文件均被跳过", contentState: "error", trimReport });
      } else if (result.length > getMaxContentLength()) {
        update({ content: "内容过长，无法显示", contentState: "error", trimReport });
      } else {
        update({ content: result, contentState: "loaded", trimReport });
      }
    } catch (error) {
      if (request === trimRequest) update({ content: `整理失败：${errorMessage(error)}`, contentState: "error" });
    }
  }

  function subscribe(notify: () => void) {
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }

  return {
    getSnapshot: () => state,
    subscribe,
    invalidateRequests,
    setOption,
    toggleIgnored,
    clearOutput,
    scanFiles,
    trimFiles,
  };
}

export default function useSourceWorkspace() {
  const [workspace] = useState(createSourceWorkspace);
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  useEffect(() => workspace.invalidateRequests, [workspace]);
  return {
    ...state,
    setOption: workspace.setOption,
    toggleIgnored: workspace.toggleIgnored,
    clearOutput: workspace.clearOutput,
    scanFiles: workspace.scanFiles,
    trimFiles: workspace.trimFiles,
  };
}
