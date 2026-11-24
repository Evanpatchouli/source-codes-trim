import { useState } from "react";

export default function PlanChanges({ added, missing }: { added: string[]; missing: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!added.length && !missing.length) return <p className="plan-changes">文件没有增减</p>;
  return (
    <details className="plan-changes" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>新增 {added.length} 个文件，缺失 {missing.length} 个文件</summary>
      {expanded && (
        <div className="plan-change-paths">
          {added.length > 0 && <ul aria-label="新增文件">{added.map((path) => <li key={path}>新增 · <code>{path}</code></li>)}</ul>}
          {missing.length > 0 && <ul aria-label="缺失文件">{missing.map((path) => <li key={path}>缺失 · <code>{path}</code></li>)}</ul>}
        </div>
      )}
    </details>
  );
}
