export const DEFAULT_CONFIG = {
  maxCommits: 200,
  largeFilesThreshold: 20,
  largeLinesThreshold: 500,
  hugeFilesThreshold: 50,
  hugeLinesThreshold: 1500,
  suspiciousMessagePatterns: [
    'fix',
    'hotfix',
    'urgent',
    'temp',
    'wip',
    'hack'
  ],
  conflictMessagePatterns: [
    'conflict',
    'conflicts',
    'resolve conflict',
    'resolved conflict'
  ],
  rebasePatterns: ['rebase'],
  resetPatterns: ['reset --hard', 'reset: moving to'],
  forcePushPatterns: ['forced-update', 'force push', 'push --force'],
  reflogLimit: 200
};

export const RISK_LEVELS = ['BAJO', 'MEDIO', 'ALTO', 'CRITICO'];

export const EVENT_SEVERITY = {
  direct_commit_mainline: 3,
  merge_commit: 2,
  merge_conflict: 4,
  large_commit: 3,
  huge_commit: 4,
  suspicious_message: 3,
  chained_revert: 4,
  history_rewrite: 4
};
