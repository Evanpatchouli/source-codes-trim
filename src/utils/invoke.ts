import { invoke as raw_invoke } from "@tauri-apps/api/core";

type Resp<T = unknown> = {
  ok: boolean,
  code: number,
  msg: string,
  data: T,
}

type InvokeMap = {
  get_files: {
    args: {
      path: string;
      includes: string;
      excludes: string;
      excludeEmptyDirs: boolean;
    };
    returns: ScanResult;
  };
  trim_source_codes: {
    args: {
      files: string[];
      /** @default true */
      trimWhitespace: boolean;
      /** @default true */
      trimNewlines: boolean;
      /** @default true */
      trimComments: boolean;
    };
    returns: TrimSourceCodesResult;
  };
  export_trim_result: {
    args: { id: string; path: string };
    returns: void;
  };
  release_trim_result: {
    args: { id: string };
    returns: void;
  };
  open_directory_in_fs: {
    args: { path: string };
    returns: void;
  };
};

export default function invoke<K extends keyof InvokeMap>(
  cmd: K,
  args: InvokeMap[K]["args"]
): Promise<InvokeMap[K]["returns"]> {
  return raw_invoke<InvokeMap[K]["returns"]>(cmd, args);
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return "未知错误";
}
