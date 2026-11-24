import { useEffect, useState, useSyncExternalStore } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import selectedFilePaths from "../utils/selectedFilePaths.ts";
import invoke, { errorMessage } from "../utils/invoke.ts";

type ScanOptions = { path: string; includes: string; excludes: string; excludeEmptyDirs: boolean };
type Output = {
  content: string;
  contentState: "loading" | "loaded" | "error";
  trimReport: Omit<TrimSourceCodesResult, "result"> | null;
  exporting: boolean;
  exportFeedback: { ok: boolean; message: string } | null;
};

const emptyOutput: Output = {
  content: "", contentState: "loaded", trimReport: null, exporting: false, exportFeedback: null,
};
const emptyScan = { files: [] as FileItem[], scanIssues: [] as FileIssue[], scanError: "", treeLoading: false };
const initialOptions: ScanOptions = { path: "", includes: "", excludes: "", excludeEmptyDirs: true };

function releaseResult(id: string) {
  void invoke("release_trim_result", { id }).catch((error) => console.warn("释放临时整理结果失败", error));
}

export function createSourceWorkspace() {
  let state = { options: initialOptions, ...emptyScan, ...emptyOutput, ignoredPaths: new Set<string>() };
  let scanRequest = 0;
  let trimRequest = 0;
  const writing = new Set<string>();
  const listeners = new Set<() => void>();
  function update(patch: Partial<typeof state>) {
    const previousId = state.trimReport?.exportId;
    state = { ...state, ...patch };
    if (previousId && previousId !== state.trimReport?.exportId && !writing.has(previousId)) releaseResult(previousId);
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
      const { result, ...trimReport } = await invoke("trim_source_codes", {
        files: selectedFilePaths(files, ignoredPaths),
        trimWhitespace: true,
        trimNewlines: true,
        trimComments: true,
      });
      if (request !== trimRequest) {
        if (trimReport.exportId) releaseResult(trimReport.exportId);
        return;
      }
      if (trimReport.processed === 0 && trimReport.skipped.length) {
        update({ content: "整理失败，所选文件均被跳过", contentState: "error", trimReport });
      } else {
        update({ content: result, contentState: "loaded", trimReport });
      }
    } catch (error) {
      if (request === trimRequest) update({ content: `整理失败：${errorMessage(error)}`, contentState: "error" });
    }
  }

  async function exportResult() {
    const id = state.trimReport?.exportId;
    if (!id || state.exporting) return;
    const request = trimRequest;
    update({ exporting: true });
    try {
      const path = await save({ title: "导出完整内容", defaultPath: "整理后的源码.txt" });
      if (!path || request !== trimRequest) return;
      writing.add(id);
      try {
        await invoke("export_trim_result", { id, path });
      } finally {
        writing.delete(id);
        if (request !== trimRequest) releaseResult(id);
      }
      if (request === trimRequest) update({ exportFeedback: { ok: true, message: `已导出至 ${path}` } });
    } catch (error) {
      if (request === trimRequest) update({ exportFeedback: { ok: false, message: `导出失败：${errorMessage(error)}` } });
    } finally {
      if (request === trimRequest) update({ exporting: false });
    }
  }

  function dispose() {
    invalidateRequests();
    update(emptyOutput);
  }

  function subscribe(notify: () => void) {
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }

  return {
    getSnapshot: () => state,
    subscribe,
    dispose,
    setOption,
    toggleIgnored,
    clearOutput,
    scanFiles,
    trimFiles,
    exportResult,
  };
}

export default function useSourceWorkspace() {
  const [workspace] = useState(createSourceWorkspace);
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  useEffect(() => workspace.dispose, [workspace]);
  return {
    ...state,
    setOption: workspace.setOption,
    toggleIgnored: workspace.toggleIgnored,
    clearOutput: workspace.clearOutput,
    scanFiles: workspace.scanFiles,
    trimFiles: workspace.trimFiles,
    exportResult: workspace.exportResult,
  };
}
