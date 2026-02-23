function matchAny(text, patterns) {
  const lowered = text.toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern));
}

export function detectHistoryRewrite({reflogEntries, rebasePatterns, resetPatterns, forcePushPatterns}) {
  const events = [];
  for (const entry of reflogEntries) {
    const message = entry.message || '';
    if (matchAny(message, rebasePatterns)) {
      events.push({
        type: 'history_rewrite',
        severity: 'high',
        commit: entry.sha,
        date: entry.date,
        details: {
          action: 'rebase',
          message
        }
      });
    }
    if (matchAny(message, resetPatterns)) {
      events.push({
        type: 'history_rewrite',
        severity: 'high',
        commit: entry.sha,
        date: entry.date,
        details: {
          action: 'reset --hard',
          message
        }
      });
    }
    if (matchAny(message, forcePushPatterns)) {
      events.push({
        type: 'history_rewrite',
        severity: 'high',
        commit: entry.sha,
        date: entry.date,
        details: {
          action: 'force push',
          message
        }
      });
    }
  }
  return events;
}
