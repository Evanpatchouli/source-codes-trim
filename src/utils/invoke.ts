import { invoke as raw_invoke } from "@tauri-apps/api/core";
import { toast } from "react-hot-toast";

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
      includes: string[];
      excludes: string[];
      excludeEmptyDirs: boolean;
    };
    returns: FileItem[];
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
  open_directory_in_fs: {
    args: { path: string };
    returns: void;
  };
};

export default function invoke<T extends InvokeMap[K]["returns"], K extends keyof InvokeMap>(
  cmd: K,
  args?: InvokeMap[K]["args"]
): Promise<InvokeMap[K]["returns"]> {
  return raw_invoke<T>(cmd, args).catch(error => {
    console.error(`Invoke ${cmd} error:`, error);
    const errMsg = error.message || error.name || typeof error === "string" ? error : "未知错误";
    toast.error(errMsg, {
      position: "bottom-right"
    })
    return new Promise(resolve => resolve(errMsg));
  });
}