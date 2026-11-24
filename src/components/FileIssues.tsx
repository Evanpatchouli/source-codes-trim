import { useState } from "react";

export default function FileIssues({ label, issues }: { label: string; issues: FileIssue[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!issues.length) return null;
  return (
    <details className="file-issues" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{label}跳过 {issues.length} 项</summary>
      {expanded && (
        <ul>
          {issues.map(({ path, reason }, index) => (
            <li key={index}><code>{path}</code> — {reason}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
