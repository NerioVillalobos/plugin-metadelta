#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from urllib import request


DEFAULT_CONFIG = {
    "max_commits": 200,
    "large_files": 20,
    "large_lines": 500,
    "huge_files": 50,
    "huge_lines": 1500,
    "suspicious_message_patterns": ["fix", "hotfix", "urgent", "temp", "wip", "hack"],
    "conflict_message_patterns": ["conflict", "conflicts", "resolve conflict", "resolved conflict"],
    "rebase_patterns": ["rebase"],
    "reset_patterns": ["reset --hard", "reset: moving to"],
    "force_push_patterns": ["forced-update", "force push", "push --force"],
    "reflog_limit": 200,
}

AI_PROMPT = """Eres un analista senior de integridad Git. Recibes eventos estructurados sobre un repositorio.
Tu respuesta debe:
1) Explicar qué ocurrió.
2) Explicar por qué es riesgoso.
3) Explicar el impacto posible.
4) Recomendar acciones concretas.

No hagas supuestos fuera de los datos. No inventes información. Escribe en español, claro y profesional."""


def run_git(args, cwd):
    result = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip() or f"Git command failed: git {' '.join(args)}")
    return result.stdout.strip()


def resolve_repo_root(cwd):
    return run_git(["rev-parse", "--show-toplevel"], cwd)


def ensure_git_repo(cwd):
    if run_git(["rev-parse", "--is-inside-work-tree"], cwd).strip() != "true":
        raise RuntimeError("El directorio indicado no es un repositorio Git.")


def resolve_mainline_ref(cwd):
    try:
        remote_head = run_git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], cwd)
        if remote_head:
            return remote_head
    except RuntimeError:
        pass
    try:
        head_ref = run_git(["symbolic-ref", "-q", "--short", "HEAD"], cwd)
        if head_ref:
            return head_ref
    except RuntimeError:
        pass
    return "HEAD"


def extract_commits(cwd, range_spec, max_commits, first_parent=False):
    record_sep = "\x1e"
    field_sep = "\x1f"
    args = [
        "log",
        "--date=iso-strict",
        f"--pretty=format:%H{field_sep}%P{field_sep}%an{field_sep}%ae{field_sep}%ad{field_sep}%s{field_sep}%B{record_sep}",
        "--numstat",
    ]
    if first_parent:
        args.insert(1, "--first-parent")
    if max_commits:
        args.append(f"--max-count={max_commits}")
    if range_spec:
        args.append(range_spec)
    output = run_git(args, cwd)
    if not output:
        return []
    commits = []
    for chunk in output.split(record_sep):
        chunk = chunk.strip()
        if not chunk:
            continue
        lines = chunk.splitlines()
        header = lines.pop(0)
        parts = header.split(field_sep)
        sha, parents_raw, author_name, author_email, date, subject, body = parts
        parents = [p for p in parents_raw.split(" ") if p]
        stats = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            added_raw, deleted_raw, file_path = line.split("\t")
            added = 0 if added_raw == "-" else int(added_raw)
            deleted = 0 if deleted_raw == "-" else int(deleted_raw)
            stats.append({"filePath": file_path, "added": added, "deleted": deleted})
        file_count = len(stats)
        additions = sum(item["added"] for item in stats)
        deletions = sum(item["deleted"] for item in stats)
        commits.append(
            {
                "sha": sha,
                "parents": parents,
                "authorName": author_name,
                "authorEmail": author_email,
                "date": date,
                "subject": subject,
                "body": body.strip(),
                "fileCount": file_count,
                "additions": additions,
                "deletions": deletions,
            }
        )
    return commits


def extract_reflog(cwd, limit):
    record_sep = "\x1e"
    field_sep = "\x1f"
    args = [
        "reflog",
        "--date=iso-strict",
        f"--pretty=format:%H{field_sep}%gd{field_sep}%gs{field_sep}%ad{record_sep}",
    ]
    if limit:
        args += ["-n", str(limit)]
    output = run_git(args, cwd)
    if not output:
        return []
    entries = []
    for chunk in output.split(record_sep):
        chunk = chunk.strip()
        if not chunk:
            continue
        sha, selector, message, date = chunk.split(field_sep)
        entries.append({"sha": sha, "selector": selector, "message": message, "date": date})
    return entries


def detect_direct_commits(commits, mainline_ref):
    return [
        {
            "type": "direct_commit_mainline",
            "severity": "medium",
            "mainlineRef": mainline_ref,
            "commit": commit["sha"],
            "message": commit["subject"],
            "author": commit["authorName"],
            "date": commit["date"],
            "details": {
                "additions": commit["additions"],
                "deletions": commit["deletions"],
                "fileCount": commit["fileCount"],
            },
        }
        for commit in commits
        if len(commit["parents"]) <= 1
    ]


def detect_merge_commits(commits, conflict_patterns):
    events = []
    for commit in commits:
        if len(commit["parents"]) <= 1:
            continue
        message = f"{commit['subject']}\n{commit['body']}".lower()
        conflict_hint = any(pattern in message for pattern in conflict_patterns)
        events.append(
            {
                "type": "merge_commit",
                "severity": "low",
                "commit": commit["sha"],
                "message": commit["subject"],
                "author": commit["authorName"],
                "date": commit["date"],
                "details": {"parents": commit["parents"], "conflictHint": conflict_hint},
            }
        )
        if conflict_hint:
            events.append(
                {
                    "type": "merge_conflict",
                    "severity": "high",
                    "commit": commit["sha"],
                    "message": commit["subject"],
                    "author": commit["authorName"],
                    "date": commit["date"],
                    "details": {"heuristic": "commit_message", "parents": commit["parents"]},
                }
            )
    return events


def detect_large_commits(commits, large_files, large_lines, huge_files, huge_lines):
    events = []
    for commit in commits:
        line_changes = commit["additions"] + commit["deletions"]
        is_huge = commit["fileCount"] >= huge_files or line_changes >= huge_lines
        is_large = commit["fileCount"] >= large_files or line_changes >= large_lines
        if not is_large:
            continue
        events.append(
            {
                "type": "huge_commit" if is_huge else "large_commit",
                "severity": "high" if is_huge else "medium",
                "commit": commit["sha"],
                "message": commit["subject"],
                "author": commit["authorName"],
                "date": commit["date"],
                "details": {
                    "fileCount": commit["fileCount"],
                    "additions": commit["additions"],
                    "deletions": commit["deletions"],
                },
            }
        )
    return events


def detect_suspicious_messages(commits, patterns):
    events = []
    for commit in commits:
        message = f"{commit['subject']}\n{commit['body']}".lower()
        matches = [pattern for pattern in patterns if pattern in message]
        if not matches:
            continue
        events.append(
            {
                "type": "suspicious_message",
                "severity": "medium",
                "commit": commit["sha"],
                "message": commit["subject"],
                "author": commit["authorName"],
                "date": commit["date"],
                "details": {"matches": matches},
            }
        )
    return events


def detect_chained_reverts(commits):
    revert_commits = [commit for commit in commits if commit["subject"].lower().startswith("revert")]
    events = []
    if len(revert_commits) >= 2:
        events.append(
            {
                "type": "chained_revert",
                "severity": "high",
                "commits": [commit["sha"] for commit in revert_commits],
                "details": {"count": len(revert_commits), "messages": [commit["subject"] for commit in revert_commits]},
            }
        )
    for commit in revert_commits:
        if 'revert "revert' in commit["subject"].lower():
            events.append(
                {
                    "type": "chained_revert",
                    "severity": "high",
                    "commits": [commit["sha"]],
                    "details": {"count": 1, "messages": [commit["subject"]]},
                }
            )
    return events


def detect_history_rewrite(reflog_entries, rebase_patterns, reset_patterns, force_push_patterns):
    events = []
    for entry in reflog_entries:
        message = entry["message"].lower()
        if any(pattern in message for pattern in rebase_patterns):
            events.append(
                {
                    "type": "history_rewrite",
                    "severity": "high",
                    "commit": entry["sha"],
                    "date": entry["date"],
                    "details": {"action": "rebase", "message": entry["message"]},
                }
            )
        if any(pattern in message for pattern in reset_patterns):
            events.append(
                {
                    "type": "history_rewrite",
                    "severity": "high",
                    "commit": entry["sha"],
                    "date": entry["date"],
                    "details": {"action": "reset --hard", "message": entry["message"]},
                }
            )
        if any(pattern in message for pattern in force_push_patterns):
            events.append(
                {
                    "type": "history_rewrite",
                    "severity": "high",
                    "commit": entry["sha"],
                    "date": entry["date"],
                    "details": {"action": "force push", "message": entry["message"]},
                }
            )
    return events


def score_events(events):
    weights = {
        "direct_commit_mainline": 3,
        "merge_commit": 2,
        "merge_conflict": 4,
        "large_commit": 3,
        "huge_commit": 4,
        "suspicious_message": 3,
        "chained_revert": 4,
        "history_rewrite": 4,
    }
    total = 0
    by_type = {}
    for event in events:
        score = weights.get(event["type"], 1)
        total += score
        by_type[event["type"]] = by_type.get(event["type"], 0) + score
    if total >= 35:
        level = "CRITICO"
    elif total >= 20:
        level = "ALTO"
    elif total >= 8:
        level = "MEDIO"
    else:
        level = "BAJO"
    return {"score": total, "level": level, "byType": by_type}


def build_markdown(metadata, scoring, events, ai):
    lines = [
        "# Reporte de integridad Git",
        "",
        f"**Repositorio:** {metadata['repoPath']}",
        f"**Referencia principal:** {metadata['mainlineRef']}",
        f"**Rango analizado:** {metadata['range']}",
        f"**Commits analizados:** {metadata['commitCount']}",
        f"**Riesgo global:** {scoring['level']} (score {scoring['score']})",
        "",
        "## Eventos detectados",
    ]
    if not events:
        lines.append("No se detectaron eventos de riesgo.")
    else:
        for event in events:
            header = f"- **{event['type']}** ({event['severity']}) - {event.get('message','')}".strip()
            lines.append(header)
            if event.get("commit"):
                lines.append(f"  - Commit: `{event['commit']}`")
            if event.get("author"):
                lines.append(f"  - Autor: {event['author']}")
            if event.get("date"):
                lines.append(f"  - Fecha: {event['date']}")
            if event.get("details"):
                lines.append(f"  - Detalles: `{json.dumps(event['details'])}`")
            if event.get("commits"):
                lines.append(f"  - Commits: {', '.join(event['commits'])}")
    lines += ["", "## Scoring", "```json", json.dumps(scoring, indent=2), "```", "", "## IA"]
    if ai["status"] == "ok":
        lines.append(ai.get("response", ""))
    elif ai["status"] == "skipped":
        lines.append("IA no ejecutada. Proporcione credenciales y habilite el flag `--ai`.")
    else:
        lines.append(f"IA no disponible: {ai.get('error', 'error desconocido')}")
    return "\n".join(lines)


def request_ai(events, summary, mainline_ref, repo_path, model, api_key):
    if not api_key:
        raise RuntimeError("Falta OPENAI_API_KEY para ejecutar IA.")
    payload = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": AI_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "repository": repo_path,
                        "mainlineRef": mainline_ref,
                        "summary": summary,
                        "events": events,
                    },
                    indent=2,
                ),
            },
        ],
        "temperature": 0.2,
    }
    req = request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with request.urlopen(req) as response:
        body = json.loads(response.read().decode("utf-8"))
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        return content


def main():
    parser = argparse.ArgumentParser(description="Analiza integridad Git y detecta malas integraciones.")
    parser.add_argument("--repo", "-r", default=".", help="Repositorio Git local a analizar")
    parser.add_argument("--range", dest="range_spec", help="Rango Git (ej: base..HEAD)")
    parser.add_argument("--max-commits", type=int, default=DEFAULT_CONFIG["max_commits"])
    parser.add_argument("--large-files", type=int, default=DEFAULT_CONFIG["large_files"])
    parser.add_argument("--large-lines", type=int, default=DEFAULT_CONFIG["large_lines"])
    parser.add_argument("--huge-files", type=int, default=DEFAULT_CONFIG["huge_files"])
    parser.add_argument("--huge-lines", type=int, default=DEFAULT_CONFIG["huge_lines"])
    parser.add_argument("--json", dest="json_path", help="Ruta de salida JSON")
    parser.add_argument("--markdown", dest="markdown_path", help="Ruta de salida Markdown")
    parser.add_argument("--output-dir", dest="output_dir", help="Directorio para ambos reportes")
    parser.add_argument("--ai", action="store_true", help="Habilita IA (OPENAI_API_KEY)")
    parser.add_argument("--ai-model", default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    args = parser.parse_args()

    repo_path = os.path.abspath(args.repo)
    ensure_git_repo(repo_path)
    root = resolve_repo_root(repo_path)
    mainline_ref = resolve_mainline_ref(root)
    range_spec = args.range_spec or mainline_ref

    commits = extract_commits(root, range_spec, args.max_commits, first_parent=False)
    mainline_commits = extract_commits(root, range_spec, args.max_commits, first_parent=True)
    reflog_entries = extract_reflog(root, DEFAULT_CONFIG["reflog_limit"])

    events = []
    events += detect_direct_commits(mainline_commits, mainline_ref)
    events += detect_merge_commits(commits, DEFAULT_CONFIG["conflict_message_patterns"])
    events += detect_large_commits(
        commits, args.large_files, args.large_lines, args.huge_files, args.huge_lines
    )
    events += detect_suspicious_messages(commits, DEFAULT_CONFIG["suspicious_message_patterns"])
    events += detect_chained_reverts(commits)
    events += detect_history_rewrite(
        reflog_entries,
        DEFAULT_CONFIG["rebase_patterns"],
        DEFAULT_CONFIG["reset_patterns"],
        DEFAULT_CONFIG["force_push_patterns"],
    )

    scoring = score_events(events)
    metadata = {
        "repoPath": root,
        "mainlineRef": mainline_ref,
        "range": range_spec,
        "commitCount": len(commits),
        "analyzedAt": datetime.utcnow().isoformat() + "Z",
    }

    ai_result = {"status": "skipped", "response": None}
    if args.ai:
        try:
            ai_response = request_ai(events, scoring, mainline_ref, root, args.ai_model, os.getenv("OPENAI_API_KEY"))
            ai_result = {"status": "ok", "response": ai_response, "prompt": AI_PROMPT}
        except Exception as exc:
            ai_result = {"status": "error", "error": str(exc), "response": None}

    report = {"metadata": metadata, "scoring": scoring, "events": events, "ai": ai_result}
    markdown = build_markdown(metadata, scoring, events, ai_result)

    output_dir = os.path.abspath(args.output_dir) if args.output_dir else None
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        args.json_path = args.json_path or os.path.join(output_dir, "git-integrity-report.json")
        args.markdown_path = args.markdown_path or os.path.join(output_dir, "git-integrity-report.md")

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=False)
        print(f"✅ JSON generado: {args.json_path}")

    if args.markdown_path:
        with open(args.markdown_path, "w", encoding="utf-8") as handle:
            handle.write(markdown)
        print(f"✅ Markdown generado: {args.markdown_path}")

    if not args.json_path and not args.markdown_path:
        print(markdown)
    else:
        print(f"Riesgo global: {scoring['level']} (score {scoring['score']})")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
