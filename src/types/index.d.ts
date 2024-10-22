declare type FileItem = {
  path: string,
  name: string,
  is_dir: boolean,
  children: Array<FileItem>,
}

declare interface TrimSourceCodesResult {
  result: string;
  skipped: string[];
}

declare namespace ApiGithub {
  declare type Author = Record<string, any> & {
    avatar_url: string;
    /**
     * e.g. "https://github.com/Evanpatchouli"
     */
    html_url: string;
  };
  declare interface ResponseLatestRelease {
    assets: {
      /**
       * e.g. "https://api.github.com/repos/Evanpatchouli/source-codes-trim/releases/assets/41520875"
       */
      "url": string,
      "id": number,
      "node_id": string,
      /**
       * e.g. "Source.Codes.Trim_1.1.0_x64_windows_10_msi.zip"
       */
      "name": string,
      "label": null | string,
      "uploader": ApiGithub.Author,
      "content_type": "application/x-zip-compressed",
      /**
       * e.g. "uploaded"
       */
      "state": string,
      /**
       * e.g. 3463040
       */
      "size": 3463040,
      "download_count": number,
      /**
       * e.g. "2024-10-04T03:30:33Z"
       */
      "created_at": string,
      /**
       * e.g. "2024-10-04T03:30:33Z"
       */
      "updated_at": string,
      /**
       * e.g. "https://github.com/Evanpatchouli/source-codes-trim/releases/download/v1.1.0/Source.Codes.Trim_1.1.0_x64_windows_10_msi.zip"
       */
      "browser_download_url": string
    }[],
    /**
     * e.g. "https://api.github.com/repos/Evanpatchouli/source-codes-trim/releases/178329371/assets"
     */
    assets_url: string,
    /**
     * markdown content
     */
    body: string,
    /**
     * e.g. "2024-10-04T03:30:33Z"
     */
    "created_at": string,
    draft: boolean,
    /** "https://github.com/Evanpatchouli/source-codes-trim/releases/tag/v1.1.0" */
    html_url: string
    id: number,
    /**
     * e.g. "source-codes-trim-v1.1.0"
     */
    name: string,
    node_id: string,
    prerelease: boolean,
    /**
     * e.g. "2024-10-04T03:30:33Z"
     */
    "published_at": string,
    /**
     * e.g. "v1.1.0"
     */
    tag_name: string,
    /**
     * e.g. "https://api.github.com/repos/Evanpatchouli/source-codes-trim/tarball/v1.1.0"
     */
    tarball_url: string,
    /**
     * e.g. "master"
     */
    target_commitish: string,
    upload_url: string,
    /**
     * e.g. "https://api.github.com/repos/Evanpatchouli/source-codes-trim/releases/178329371"
     */
    url: string,
    /**
     * e.g. "https://api.github.com/repos/Evanpatchouli/source-codes-trim/zipball/v1.1.0"
     */
    zipball_url: string
  }
}