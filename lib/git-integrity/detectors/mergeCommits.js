function matchesPattern(text, patterns) {
  const lowered = text.toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern));
}

export function detectMergeCommits({commits, conflictPatterns}) {
  const events = [];
  for (const commit of commits) {
    if (commit.parents.length <= 1) {
      continue;
    }
    const message = `${commit.subject}\n${commit.body}`.trim();
    const hasConflictHint = matchesPattern(message, conflictPatterns);
    events.push({
      type: 'merge_commit',
      severity: 'low',
      commit: commit.sha,
      message: commit.subject,
      author: commit.authorName,
      date: commit.date,
      details: {
        parents: commit.parents,
        conflictHint: hasConflictHint
      }
    });
    if (hasConflictHint) {
      events.push({
        type: 'merge_conflict',
        severity: 'high',
        commit: commit.sha,
        message: commit.subject,
        author: commit.authorName,
        date: commit.date,
        details: {
          heuristic: 'commit_message',
          parents: commit.parents
        }
      });
    }
  }
  return events;
}
