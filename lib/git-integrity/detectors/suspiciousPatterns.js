function matchesPattern(text, patterns) {
  const lowered = text.toLowerCase();
  return patterns.filter((pattern) => lowered.includes(pattern));
}

export function detectSuspiciousMessages({commits, messagePatterns}) {
  const events = [];
  for (const commit of commits) {
    const message = `${commit.subject}\n${commit.body}`.trim();
    const matches = matchesPattern(message, messagePatterns);
    if (matches.length === 0) {
      continue;
    }
    events.push({
      type: 'suspicious_message',
      severity: 'medium',
      commit: commit.sha,
      message: commit.subject,
      author: commit.authorName,
      date: commit.date,
      details: {
        matches
      }
    });
  }
  return events;
}

export function detectChainedReverts({commits}) {
  const revertCommits = commits.filter((commit) => /^revert\b/i.test(commit.subject));
  const events = [];
  if (revertCommits.length >= 2) {
    events.push({
      type: 'chained_revert',
      severity: 'high',
      commits: revertCommits.map((commit) => commit.sha),
      details: {
        count: revertCommits.length,
        messages: revertCommits.map((commit) => commit.subject)
      }
    });
  }
  for (const commit of revertCommits) {
    if (/revert "revert/i.test(commit.subject)) {
      events.push({
        type: 'chained_revert',
        severity: 'high',
        commits: [commit.sha],
        details: {
          count: 1,
          messages: [commit.subject]
        }
      });
    }
  }
  return events;
}
