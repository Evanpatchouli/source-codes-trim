import {
  Accordion, AccordionButton, AccordionIcon, AccordionItem, AccordionPanel, usePrefersReducedMotion,
} from "@chakra-ui/react";

function IssueList({ issues }: { issues: FileIssue[] }) {
  return (
    <ul>
      {issues.map(({ path, reason }, index) => (
        <li key={index}><code>{path}</code> — {reason}</li>
      ))}
    </ul>
  );
}

export default function FileIssues({ label, issues }: { label: string; issues: FileIssue[] }) {
  const reduceMotion = usePrefersReducedMotion();
  if (!issues.length) return null;
  return (
    <Accordion allowToggle reduceMotion={reduceMotion} className="file-issues">
      <AccordionItem>
        {({ isExpanded }) => (
          <>
            <h2>
              <AccordionButton px={2} py={1} fontSize="sm" justifyContent="space-between">
                <span>{label}跳过 {issues.length} 项</span>
                <AccordionIcon />
              </AccordionButton>
            </h2>
            <AccordionPanel px={2} pt={0} pb={2} motionProps={{ unmountOnExit: true }}>
              {(!reduceMotion || isExpanded) && <IssueList issues={issues} />}
            </AccordionPanel>
          </>
        )}
      </AccordionItem>
    </Accordion>
  );
}
