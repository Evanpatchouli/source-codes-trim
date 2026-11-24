declare type FileItem = {
  path: string,
  name: string,
  is_dir: boolean,
  children: Array<FileItem>,
}

declare interface TrimSourceCodesResult {
  result: string;
  processed: number;
  skipped: FileIssue[];
  byteCount: number;
  lineCount: number;
  truncated: boolean;
  exportId: string | null;
}

declare interface FileIssue {
  path: string;
  reason: string;
}

declare interface ScanResult {
  files: FileItem[];
  skipped: FileIssue[];
}
