import valid from "semver/functions/valid.js";
import gt from "semver/functions/gt.js";

export interface AvailableRelease {
  version: string;
  publishedAt: string;
  htmlUrl: string;
}

export async function readAvailableRelease(response: Response, currentVersion: string): Promise<AvailableRelease | null> {
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
  const release: unknown = await response.json().catch(() => {
    throw new Error("GitHub 返回了无效的 JSON");
  });
  if (typeof release !== "object" || release === null) throw new Error("发布信息格式无效");

  const { tag_name, published_at, html_url } = release as Record<string, unknown>;
  if (typeof tag_name !== "string" || !valid(tag_name)) throw new Error("发布标签缺少有效的版本号");
  if (typeof published_at !== "string" || !Number.isFinite(Date.parse(published_at))) {
    throw new Error("发布时间无效");
  }
  let page: URL;
  try {
    page = new URL(typeof html_url === "string" ? html_url : "");
  } catch {
    throw new Error("发布页面地址无效");
  }
  if (page.origin !== "https://github.com" || page.username || page.password ||
      !/^\/evanpatchouli\/source-codes-trim\/releases\/tag\/.+$/i.test(page.pathname)) {
    throw new Error("发布页面不属于此项目");
  }
  if (!valid(currentVersion)) throw new Error("本地版本号无效");
  return gt(tag_name, currentVersion) ? { version: tag_name, publishedAt: published_at, htmlUrl: page.href } : null;
}
