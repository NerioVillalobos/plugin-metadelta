export function detectDirectCommits({commits, mainlineRef}) {
  return commits
    .filter((commit) => commit.parents.length <= 1)
    .map((commit) => ({
      type: 'direct_commit_mainline',
      severity: 'medium',
      mainlineRef,
      commit: commit.sha,
      message: commit.subject,
      author: commit.authorName,
      date: commit.date,
      details: {
        additions: commit.additions,
        deletions: commit.deletions,
        fileCount: commit.fileCount
      }
    }));
}
