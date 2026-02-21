import {runGitCommand} from './git.js';

const RECORD_SEPARATOR = '\u001e';
const FIELD_SEPARATOR = '\u001f';

export function extractCommits({
  cwd,
  range,
  maxCommits,
  includeFirstParent
}) {
  const args = [
    'log',
    '--date=iso-strict',
    `--pretty=format:%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%ad${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`,
    '--numstat'
  ];
  if (includeFirstParent) {
    args.splice(1, 0, '--first-parent');
  }
  if (maxCommits) {
    args.push(`--max-count=${maxCommits}`);
  }
  if (range) {
    args.push(range);
  }
  const output = runGitCommand(args, {cwd});
  if (!output) {
    return [];
  }
  return output
    .split(RECORD_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const header = lines.shift() ?? '';
      const [sha, parentsRaw, authorName, authorEmail, date, subject, body] =
        header.split(FIELD_SEPARATOR);
      const parents = parentsRaw ? parentsRaw.trim().split(' ').filter(Boolean) : [];
      const stats = lines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [addedRaw, deletedRaw, filePath] = line.split('\t');
          const added = addedRaw === '-' ? 0 : Number(addedRaw);
          const deleted = deletedRaw === '-' ? 0 : Number(deletedRaw);
          return {filePath, added, deleted};
        });
      const fileCount = stats.length;
      const additions = stats.reduce((sum, item) => sum + (Number.isNaN(item.added) ? 0 : item.added), 0);
      const deletions = stats.reduce((sum, item) => sum + (Number.isNaN(item.deleted) ? 0 : item.deleted), 0);
      return {
        sha,
        parents,
        authorName,
        authorEmail,
        date,
        subject,
        body: body?.trim() ?? '',
        fileCount,
        additions,
        deletions
      };
    });
}

export function extractReflog({cwd, limit}) {
  const args = [
    'reflog',
    '--date=iso-strict',
    `--pretty=format:%H${FIELD_SEPARATOR}%gd${FIELD_SEPARATOR}%gs${FIELD_SEPARATOR}%ad${RECORD_SEPARATOR}`
  ];
  if (limit) {
    args.push(`-n`, String(limit));
  }
  const output = runGitCommand(args, {cwd});
  if (!output) {
    return [];
  }
  return output
    .split(RECORD_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha, selector, message, date] = chunk.split(FIELD_SEPARATOR);
      return {sha, selector, message, date};
    });
}
