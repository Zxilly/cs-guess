"""Render a stable, human-readable diff of two exported player catalogs."""

import argparse
import html
import json
import subprocess
from collections import Counter
from pathlib import Path


CATALOG = "src/data/players.generated.json"


def _index(players):
    result = {}
    for player in players:
        player_id = player["id"]
        if player_id in result:
            raise ValueError(f"Duplicate player ID: {player_id}")
        result[player_id] = player
    return result


def _cell(value, limit=None):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    value = (html.escape(value, quote=False).replace("|", "&#124;").replace("`", "&#96;")
            .replace("@", "&#64;").replace("\r", " ").replace("\n", " ")
            .replace("[", "&#91;").replace("]", "&#93;"))
    if limit is not None and len(value) > limit:
        value = value[:limit]
        if value.rfind("&") > value.rfind(";"):
            value = value[:value.rfind("&")]
        value += "…"
    return value


def render_review(before, after, base, *, limit=None):
    old, new = _index(before), _index(after)
    added = sorted(new.keys() - old.keys())
    removed = sorted(old.keys() - new.keys())
    changed = sorted(key for key in old.keys() & new.keys() if old[key] != new[key])
    lines = [
        "## Catalog changes", "", f"Compared with commit: {_cell(base)}", "",
        "| Metric | Count |", "| --- | ---: |",
        f"| Before | {len(old)} |", f"| After | {len(new)} |",
        f"| Added | {len(added)} |", f"| Removed | {len(removed)} |",
        f"| Modified | {len(changed)} |",
        f"| Unchanged | {len(old) - len(removed) - len(changed)} |", "",
    ]

    def section(title, headers, rows):
        lines.extend([f"### {title}", ""])
        if not rows:
            lines.extend(["None.", ""])
            return
        lines.extend(["| " + " | ".join(headers) + " |",
                      "| " + " | ".join("---" for _ in headers) + " |"])
        for row in rows if limit is None else rows[:limit]:
            # Keep PR previews bounded; the artifact retains complete values.
            cells = [_cell(value, 120 if limit is not None else None) for value in row]
            lines.append("| " + " | ".join(cells) + " |")
        if limit is not None and len(rows) > limit:
            lines.append(f"\n{len(rows) - limit} more rows; see the full review artifact.")
        lines.append("")

    for title, keys, catalog in [("Added players", added, new), ("Removed players", removed, old)]:
        section(title, ["ID", "Nickname", "Team"], [
            [key, catalog[key].get("nickname", "∅"), catalog[key].get("team", "∅")]
            for key in keys
        ])
    rows = []
    for key in changed:
        for field in sorted(old[key].keys() | new[key].keys()):
            if (field in old[key]) != (field in new[key]) or old[key].get(field) != new[key].get(field):
                rows.append([f"{new[key].get('nickname', key)} ({key})", field,
                             old[key].get(field, "∅"), new[key].get(field, "∅")])
    field_counts = Counter(row[1] for row in rows)
    section("Field totals", ["Field", "Players"], sorted(field_counts.items()))
    cosmetic = {"age", "imageUrl", "teamLogoUrl"}
    for title, selected in [
        ("Gameplay and identity changes", [row for row in rows if row[1] not in cosmetic]),
        ("Age and image changes", [row for row in rows if row[1] in cosmetic]),
    ]:
        section(title, ["Player", "Field", "Before", "After"], selected)
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="Git commit containing the baseline catalog")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--preview", required=True, type=Path)
    args = parser.parse_args()
    base = subprocess.check_output(
        ["git", "rev-parse", "--verify", f"{args.base}^{{commit}}"], text=True,
    ).strip()
    before = json.loads(subprocess.check_output(["git", "show", f"{base}:{CATALOG}"]))
    after = json.loads(Path(CATALOG).read_text(encoding="utf-8"))
    for path, limit in [(args.output, None), (args.preview, 25)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_review(before, after, base, limit=limit), encoding="utf-8")


if __name__ == "__main__":
    main()
