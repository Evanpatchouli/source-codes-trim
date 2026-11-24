import { useEffect, useState, useSyncExternalStore } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import selectedFilePaths from "../utils/selectedFilePaths.ts";
import moveFileTreeItem, { type TreeDropPosition } from "../utils/moveFileTreeItem.ts";
import invoke, { errorMessage } from "../utils/invoke.ts";
import type { LineSelection } from "../utils/lineSelection.ts";
import { applySourcePlan, createSourcePlan, parseSourcePlan, type PlanFilters, type SourcePlan } from "../utils/sourcePlan.ts";

type ScanOptions = PlanFilters & { path: string };
type Layout = { files: FileItem[]; ignoredPaths: ReadonlySet<string> };
type PlanChanges = { added: string[]; missing: string[] };
type PlanActivity = {
  planBusy: "open" | "save" | null;
  planFeedback: { ok: boolean; message: string } | null;
};
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
const emptyScan = {
  files: [] as FileItem[], scanIssues: [] as FileIssue[], scanError: "", treeLoading: false,
  hasScan: false, planChanges: null as PlanChanges | null,
};
const emptyPlanActivity: PlanActivity = { planBusy: null, planFeedback: null };
const planFileFilter = [{ name: "源码整理方案", extensions: ["sctplan"] }];
const initialOptions: ScanOptions = { path: "", includes: "", excludes: "", excludeEmptyDirs: true };

function releaseResult(id: string) {
  void invoke("release_trim_result", { id }).catch((error) => console.warn("释放临时整理结果失败", error));
}

export function createSourceWorkspace() {
  let state = { options: initialOptions, ...emptyScan, ...emptyOutput, ...emptyPlanActivity, ignoredPaths: new Set<string>() };
  let previousLayout: Layout | null = null;
  let scanRequest = 0;
  let trimRequest = 0;
  let planRequest = 0;
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
    planRequest++;
  }

  function setOption<K extends keyof ScanOptions>(key: K, value: ScanOptions[K]) {
    if (state.options[key] === value) return;
    if (key === "path") previousLayout = null;
    else if (state.hasScan) previousLayout = { files: state.files, ignoredPaths: state.ignoredPaths };
    invalidateRequests();
    update({ options: { ...state.options, [key]: value }, ...emptyScan, ...emptyOutput, ...emptyPlanActivity, ignoredPaths: new Set() });
  }

  function toggleIgnored(path: string) {
    invalidateRequests();
    const ignoredPaths = new Set(state.ignoredPaths);
    if (ignoredPaths.has(path)) ignoredPaths.delete(path);
    else ignoredPaths.add(path);
    update({ ignoredPaths, treeLoading: false, ...emptyOutput, ...emptyPlanActivity });
  }

  function clearOutput() {
    trimRequest++;
    update(emptyOutput);
  }

  function moveFile(sourcePath: string, targetPath: string, position: TreeDropPosition) {
    const files = moveFileTreeItem(state.files, sourcePath, targetPath, position);
    if (files === state.files) return false;
    invalidateRequests();
    update({ files, treeLoading: false, ...emptyOutput, ...emptyPlanActivity });
    return true;
  }

  function applyScan(options: ScanOptions, scan: ScanResult, plan: SourcePlan | null) {
    const restored = plan && applySourcePlan(options.path, scan.files, plan);
    previousLayout = null;
    trimRequest++;
    update({
      options,
      files: restored?.files ?? scan.files,
      ignoredPaths: restored?.ignoredPaths ?? new Set(),
      planChanges: restored ? { added: restored.added, missing: restored.missing } : null,
      hasScan: true, treeLoading: false, scanIssues: scan.skipped, scanError: "", ...emptyOutput,
    });
  }

  async function scanFiles() {
    const options = state.options;
    if (!options.path) return;
    const request = ++scanRequest;
    planRequest++;
    const layout = state.hasScan ? { files: state.files, ignoredPaths: state.ignoredPaths } : previousLayout;
    update({ treeLoading: true, scanError: "", ...emptyPlanActivity });
    try {
      const scan = await invoke("get_files", options);
      if (request !== scanRequest) return;
      const { path, ...filters } = options;
      const plan = layout ? createSourcePlan(path, layout.files, layout.ignoredPaths, filters) : null;
      applyScan(options, scan, plan);
    } catch (error) {
      if (request === scanRequest) update({ scanError: `扫描失败：${errorMessage(error)}`, treeLoading: false });
    }
  }

  async function openPlan() {
    const root = state.options.path;
    if (!root || state.treeLoading || state.planBusy) return;
    const request = ++planRequest;
    update({ planBusy: "open" });
    try {
      const path = await open({ title: "打开整理方案", defaultPath: root, filters: planFileFilter, multiple: false });
      if (!path || request !== planRequest) return;
      const text = await invoke("read_source_plan", { path });
      if (request !== planRequest) return;
      const plan = parseSourcePlan(text);
      const options = { ...plan.filters, path: root };
      const scan = await invoke("get_files", options);
      if (request !== planRequest) return;
      applyScan(options, scan, plan);
      update({ planFeedback: { ok: true, message: `已应用方案：${path}` } });
    } catch (error) {
      if (request === planRequest) update({ planFeedback: { ok: false, message: `打开方案失败：${errorMessage(error)}` } });
    } finally {
      if (request === planRequest) update({ planBusy: null });
    }
  }

  async function savePlan() {
    if (!state.hasScan || state.treeLoading || state.planBusy) return;
    const request = ++planRequest;
    const { path: root, ...filters } = state.options;
    const separator = root.includes("\\") ? "\\" : "/";
    const defaultPath = root.replace(/[\\/]$/, "") + separator + "整理方案.sctplan";
    update({ planBusy: "save" });
    try {
      const path = await save({ title: "保存整理方案", defaultPath, filters: planFileFilter });
      if (!path || request !== planRequest) return;
      const plan = createSourcePlan(root, state.files, state.ignoredPaths, filters);
      await invoke("write_source_plan", { path, content: JSON.stringify(plan, null, 2) });
      if (request === planRequest) update({ planFeedback: { ok: true, message: `已保存方案：${path}` } });
    } catch (error) {
      if (request === planRequest) update({ planFeedback: { ok: false, message: `保存方案失败：${errorMessage(error)}` } });
    } finally {
      if (request === planRequest) update({ planBusy: null });
    }
  }

  async function trimFiles() {
    const { files, ignoredPaths } = state;
    if (!files.length || state.treeLoading || state.planBusy === "open") return;
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

  async function exportResult(selection: LineSelection = { mode: "all" }, expectedId?: string) {
    const id = state.trimReport?.exportId;
    if (!id || state.exporting || (expectedId !== undefined && expectedId !== id)) return;
    const request = trimRequest;
    update({ exporting: true });
    try {
      const path = await save({
        title: selection.mode === "all" ? "导出 TXT" : "按行导出 TXT",
        defaultPath: "整理后的源码.txt",
        filters: [{ name: "文本文件", extensions: ["txt"] }],
      });
      if (!path || request !== trimRequest) return;
      writing.add(id);
      try {
        await invoke("export_trim_result", { id, path, selection });
      } finally {
        writing.delete(id);
        if (request !== trimRequest) releaseResult(id);
      }
      if (request === trimRequest) {
        const feedback = { ok: true, message: `已导出至 ${path}` };
        update({ exportFeedback: feedback });
        return feedback;
      }
    } catch (error) {
      if (request === trimRequest) {
        const feedback = { ok: false, message: `导出失败：${errorMessage(error)}` };
        update({ exportFeedback: feedback });
        return feedback;
      }
    } finally {
      if (request === trimRequest) update({ exporting: false });
    }
  }

  function dispose() {
    invalidateRequests();
    previousLayout = null;
    update({ ...emptyOutput, ...emptyPlanActivity });
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
    moveFile,
    clearOutput,
    scanFiles,
    openPlan,
    savePlan,
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
    moveFile: workspace.moveFile,
    clearOutput: workspace.clearOutput,
    scanFiles: workspace.scanFiles,
    openPlan: workspace.openPlan,
    savePlan: workspace.savePlan,
    trimFiles: workspace.trimFiles,
    exportResult: workspace.exportResult,
  };
}
