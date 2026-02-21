export function detectLargeCommits({
  commits,
  largeFilesThreshold,
  largeLinesThreshold,
  hugeFilesThreshold,
  hugeLinesThreshold
}) {
  const events = [];
  for (const commit of commits) {
    const lineChanges = commit.additions + commit.deletions;
    const isHuge = commit.fileCount >= hugeFilesThreshold || lineChanges >= hugeLinesThreshold;
    const isLarge =
      commit.fileCount >= largeFilesThreshold || lineChanges >= largeLinesThreshold;
    if (!isLarge) {
      continue;
    }
    events.push({
      type: isHuge ? 'huge_commit' : 'large_commit',
      severity: isHuge ? 'high' : 'medium',
      commit: commit.sha,
      message: commit.subject,
      author: commit.authorName,
      date: commit.date,
      details: {
        fileCount: commit.fileCount,
        additions: commit.additions,
        deletions: commit.deletions
      }
    });
  }
  return events;
}
