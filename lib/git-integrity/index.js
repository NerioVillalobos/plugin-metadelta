import {DEFAULT_CONFIG} from './constants.js';
import {extractCommits, extractReflog} from './extractor.js';
import {resolveMainlineRef, ensureGitRepo, resolveRepoRoot} from './git.js';
import {detectDirectCommits} from './detectors/directCommits.js';
import {detectMergeCommits} from './detectors/mergeCommits.js';
import {detectLargeCommits} from './detectors/largeCommits.js';
import {detectSuspiciousMessages, detectChainedReverts} from './detectors/suspiciousPatterns.js';
import {detectHistoryRewrite} from './detectors/historyRewrite.js';
import {scoreEvents} from './scoring.js';
import {buildJsonReport, buildMarkdownReport} from './report.js';
import {requestAiExplanation} from './ai.js';

export async function analyzeRepository({
  repoPath,
  range,
  maxCommits = DEFAULT_CONFIG.maxCommits,
  thresholds = DEFAULT_CONFIG,
  aiConfig = {}
}) {
  ensureGitRepo(repoPath);
  const root = resolveRepoRoot(repoPath);
  const mainlineRef = resolveMainlineRef(root);
  const effectiveThresholds = {
    ...DEFAULT_CONFIG,
    ...thresholds
  };

  const commits = extractCommits({
    cwd: root,
    range: range || mainlineRef,
    maxCommits,
    includeFirstParent: false
  });

  const mainlineCommits = extractCommits({
    cwd: root,
    range: range || mainlineRef,
    maxCommits,
    includeFirstParent: true
  });

  const reflogEntries = extractReflog({
    cwd: root,
    limit: effectiveThresholds.reflogLimit
  });

  const events = [
    ...detectDirectCommits({commits: mainlineCommits, mainlineRef}),
    ...detectMergeCommits({commits, conflictPatterns: effectiveThresholds.conflictMessagePatterns}),
    ...detectLargeCommits({
      commits,
      largeFilesThreshold: effectiveThresholds.largeFilesThreshold,
      largeLinesThreshold: effectiveThresholds.largeLinesThreshold,
      hugeFilesThreshold: effectiveThresholds.hugeFilesThreshold,
      hugeLinesThreshold: effectiveThresholds.hugeLinesThreshold
    }),
    ...detectSuspiciousMessages({
      commits,
      messagePatterns: effectiveThresholds.suspiciousMessagePatterns
    }),
    ...detectChainedReverts({commits}),
    ...detectHistoryRewrite({
      reflogEntries,
      rebasePatterns: effectiveThresholds.rebasePatterns,
      resetPatterns: effectiveThresholds.resetPatterns,
      forcePushPatterns: effectiveThresholds.forcePushPatterns
    })
  ];

  const scoring = scoreEvents(events);
  const metadata = {
    repoPath: root,
    mainlineRef,
    range: range || mainlineRef,
    commitCount: commits.length,
    analyzedAt: new Date().toISOString()
  };

  let ai = {status: 'skipped', response: null};
  try {
    if (aiConfig.enabled) {
      ai = await requestAiExplanation({
        events,
        summary: scoring,
        mainlineRef,
        repoPath: root,
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model
      });
    }
  } catch (error) {
    ai = {
      status: 'error',
      error: error.message,
      response: null
    };
  }

  const jsonReport = buildJsonReport({metadata, events, scoring, ai});
  const markdownReport = buildMarkdownReport({metadata, events, scoring, ai});

  return {metadata, events, scoring, ai, jsonReport, markdownReport};
}
