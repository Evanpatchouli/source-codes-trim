/**
 * 解析 .gitignore 文件内容
 * @sperate `"\n"` | `"|"`
 */
export default function parseCludes(code: string): string[] {
  // 使用正则表达式匹配换行符或 |
  const reg = /^(?!#)(?!\s*$)(.+)$/gm;

  const result = [];

  // 将 code 按照换行符或 | 分隔
  const lines = code.split(/\n|\|/);

  for (const line of lines) {
    const match = line.match(reg);
    if (match) {
      result.push(match[0].trim());
    }
  }

  return result;
}