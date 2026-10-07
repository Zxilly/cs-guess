#!/usr/bin/env python3
"""Read-only GHCR retention audit. Deliberately has no deletion mode or API."""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

INDEX_TYPES = {
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
}
MANIFEST_TYPES = {
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
}
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
SNAPSHOT_TAG = re.compile(r"(?:run-[1-9][0-9]*-[1-9][0-9]*|reviewed-[0-9a-f]{40})\Z")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")


class UnsafeInventory(ValueError):
    """Missing or ambiguous evidence: retain everything."""


def require(condition, message):
    if not condition:
        raise UnsafeInventory(message)


def digest(value):
    require(isinstance(value, str) and DIGEST.fullmatch(value), "Invalid OCI digest")
    return value


def descriptor(value):
    require(isinstance(value, dict), "Invalid OCI descriptor")
    require(isinstance(value.get("mediaType"), str) and value["mediaType"],
            "Missing descriptor media type")
    require(type(value.get("size")) is int and value["size"] >= 0, "Invalid descriptor size")
    require(not value.get("urls"), "External OCI descriptor URLs require manual review")
    return digest(value.get("digest"))


def parse_versions(rows):
    require(isinstance(rows, list) and rows, "Package inventory is empty or invalid")
    versions, ids, tags = {}, set(), set()
    for row in rows:
        require(isinstance(row, dict), "Invalid package version")
        key = digest(row.get("name"))
        version_id = row.get("id")
        require(type(version_id) is int and version_id > 0, "Invalid package version ID")
        require(key not in versions and version_id not in ids, "Duplicate package version")
        metadata = row.get("metadata")
        require(isinstance(metadata, dict), "Missing package metadata")
        container = metadata.get("container")
        require(isinstance(container, dict), "Missing container metadata")
        names = container.get("tags")
        require(isinstance(names, list) and all(isinstance(t, str) and t for t in names),
                "Missing or invalid container tags")
        require(len(names) == len(set(names)) and not tags.intersection(names),
                "Duplicate or moving package tag")
        created = row.get("created_at")
        require(isinstance(created, str), "Missing package creation timestamp")
        try:
            timestamp = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError as exc:
            raise UnsafeInventory("Invalid package creation timestamp") from exc
        require(timestamp.tzinfo is not None, "Timestamp must include timezone")
        versions[key] = {"id": version_id, "tags": sorted(names), "created_at": timestamp.isoformat()}
        tags.update(names)
        ids.add(version_id)
    return versions


def closure(roots, graph):
    seen, todo = set(), list(roots)
    while todo:
        node = todo.pop()
        if node not in seen:
            require(node in graph, f"Missing referenced manifest: {node}")
            seen.add(node)
            todo.extend(graph[node] - seen)
    return seen


def plan_retention(rows, manifests, protected_refs, keep=8):
    """Count logical snapshot roots; retain every manifest reachable from a live root."""
    require(type(keep) is int and keep >= 1, "Retention count must be positive")
    versions = parse_versions(rows)
    require(set(manifests) == set(versions), "Incomplete manifest inventory")
    graph = {key: set() for key in versions}
    for key, manifest in manifests.items():
        require(isinstance(manifest, dict) and type(manifest.get("schemaVersion")) is int
                and manifest["schemaVersion"] == 2,
                f"Invalid manifest schema: {key}")
        media_type = manifest.get("mediaType")
        if media_type in INDEX_TYPES:
            children = manifest.get("manifests")
            require(isinstance(children, list) and children, f"Empty or invalid index: {key}")
            for child in children:
                child_digest = descriptor(child)
                graph[key].add(child_digest)
                annotations = child.get("annotations", {})
                require(isinstance(annotations, dict), "Invalid descriptor annotations")
                if "vnd.docker.reference.digest" in annotations:
                    target = digest(annotations["vnd.docker.reference.digest"])
                    require(child_digest in graph and target in graph,
                            "Missing Docker attestation reference")
                    graph[child_digest].add(target)
                    graph[target].add(child_digest)
        elif media_type in MANIFEST_TYPES:
            descriptor(manifest.get("config"))
            layers = manifest.get("layers")
            require(isinstance(layers, list), f"Missing manifest layers: {key}")
            for layer in layers:
                descriptor(layer)
        else:
            raise UnsafeInventory(f"Unsupported manifest media type: {key}")
        if "subject" in manifest:
            subject = descriptor(manifest["subject"])
            require(subject in graph, f"Missing OCI subject: {subject}")
            # A retained image also retains its external attestation/signature.
            graph[key].add(subject)
            graph[subject].add(key)
    for key in graph:
        require(graph[key] <= graph.keys(), f"Missing index children: {key}")

    latest = {key for key, value in versions.items() if "latest" in value["tags"]}
    require(len(latest) == 1, "Exactly one latest snapshot is required")
    snapshots = {key for key, value in versions.items()
                 if any(SNAPSHOT_TAG.fullmatch(tag) for tag in value["tags"])}
    require(snapshots, "No recognized logical snapshots")
    newest = set(sorted(snapshots, key=lambda key: (
        datetime.fromisoformat(versions[key]["created_at"]), key), reverse=True)[:keep])
    reasons = {}

    def protect(key, reason):
        require(key in versions, f"Protected reference is missing: {key}")
        reasons.setdefault(key, []).append(reason)

    for key in latest:
        protect(key, "latest")
    for key in newest:
        protect(key, f"newest-{keep}-snapshot")
    for label, key in protected_refs.items():
        protect(digest(key), label)
    for key, value in versions.items():
        if any(tag != "latest" and not SNAPSHOT_TAG.fullmatch(tag) for tag in value["tags"]):
            protect(key, "unrecognized-tag")
    # Untagged roots cannot safely be attributed to this publisher. Never sweep them.
    owned = closure(snapshots | set(reasons), graph)
    for key in versions.keys() - owned:
        protect(key, "unclassified-manifest")
    protected = closure(reasons, graph)
    expired = snapshots - protected
    candidates = closure(expired, graph) - protected
    return {
        "schemaVersion": 1,
        "mode": "dry-run",
        "status": "complete",
        "deletionEnabled": False,
        "keepSnapshots": keep,
        "snapshotCount": len(snapshots),
        "versionCount": len(versions),
        "protectedRoots": [{"digest": key, "reasons": sorted(value)}
                           for key, value in sorted(reasons.items())],
        "retainedDigests": sorted(protected),
        "expiredSnapshotDigests": sorted(expired),
        "candidateVersions": [{"digest": key, **versions[key]} for key in sorted(candidates)],
        "notice": "Informational only. No versions are deleted. This is not an executable deletion plan.",
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise UnsafeInventory("Unexpected HTTP redirect; refusing credential forwarding")


class Client:
    def __init__(self, repository, token, actor):
        require(REPOSITORY.fullmatch(repository), "Invalid GitHub repository")
        require(token and actor, "GH_TOKEN and GITHUB_ACTOR are required")
        self.repository = repository
        self.token = token
        self.actor = actor
        self.image = repository.split("/")[0].lower() + "/cs-guess-data"
        self.registry_token = None
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, url, headers):
        require(urllib.parse.urlsplit(url).scheme == "https"
                and urllib.parse.urlsplit(url).netloc in {"api.github.com", "ghcr.io"},
                "Unexpected API host")
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with self.opener.open(request, timeout=30) as response:
                require(response.status == 200, "Unexpected HTTP response")
                return response.read(), response.headers
        except urllib.error.HTTPError as exc:
            raise UnsafeInventory(f"HTTP {exc.code} reading {urllib.parse.urlsplit(url).path}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise UnsafeInventory("Network request failed; inventory is incomplete") from exc

    def api(self, path):
        raw, headers = self.get("https://api.github.com" + path, {
            "Authorization": "Bearer " + self.token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        return json.loads(raw), headers

    def pages(self, path, canonical_path=None):
        result, seen_ids = [], set()
        for page in range(1, 101):
            separator = "&" if "?" in path else "?"
            rows, headers = self.api(f"{path}{separator}per_page=100&page={page}")
            require(isinstance(rows, list) and len(rows) <= 100, "Invalid paginated response")
            for row in rows:
                require(isinstance(row, dict) and type(row.get("id")) is int,
                        "Invalid paginated item")
                require(row["id"] not in seen_ids, "Duplicate items across pages; inventory moved")
                seen_ids.add(row["id"])
            result.extend(rows)
            link = headers.get("Link", "")
            if link:
                for entry in link.split(","):
                    match = re.fullmatch(r'\s*<([^>]+)>;\s*rel="([a-z]+)"\s*', entry)
                    require(match is not None, "Malformed pagination link")
                    target = urllib.parse.urlsplit(match[1])
                    require(target.scheme == "https" and target.netloc == "api.github.com"
                            and target.path in {path.split("?")[0], canonical_path},
                            "Unexpected pagination target")
                    if match[2] == "next":
                        query = urllib.parse.parse_qs(target.query)
                        require(query.get("page") == [str(page + 1)]
                                and query.get("per_page") == ["100"], "Invalid next page")
            if len(rows) < 100 and 'rel="next"' not in link:
                return result
            require(rows, "Empty page with a next link")
        raise UnsafeInventory("Pagination limit reached; inventory is incomplete")

    def inventory(self):
        repo, _ = self.api(f"/repos/{self.repository}")
        owner = repo["owner"]
        require(owner["type"] in {"User", "Organization"}, "Unknown package owner type")
        namespace = "users" if owner["type"] == "User" else "orgs"
        rows = self.pages(f"/{namespace}/{owner['login']}/packages/container/cs-guess-data/versions?state=active")
        require(type(repo.get("id")) is int and repo["id"] > 0, "Invalid repository ID")
        prs = self.pages(f"/repos/{self.repository}/pulls?state=open",
                         canonical_path=f"/repositories/{repo['id']}/pulls")
        branch = urllib.parse.quote(repo["default_branch"], safe="")
        main, _ = self.api(f"/repos/{self.repository}/commits/{branch}")
        require(SHA.fullmatch(main["sha"]), "Invalid default branch SHA")
        heads = {"default-branch-candidate": (self.repository, main["sha"])}
        numbers = set()
        for pr in prs:
            number = pr.get("number")
            require(type(number) is int and number > 0 and number not in numbers,
                    "Duplicate or invalid open PR number")
            numbers.add(number)
            head = pr["head"]
            require(pr["state"] == "open" and head.get("repo"), "Incomplete open PR head")
            require(REPOSITORY.fullmatch(head["repo"]["full_name"]) and SHA.fullmatch(head["sha"]),
                    "Invalid open PR head")
            heads[f"open-pr-{pr['number']}"] = (head["repo"]["full_name"], head["sha"])
        # Normalize order but include every field that influences retention.
        return rows, heads

    def candidate(self, repository, sha):
        payload, _ = self.api(f"/repos/{repository}/contents/scraper/player-data-candidate.json?ref={sha}")
        require(payload.get("encoding") == "base64" and payload.get("type") == "file",
                "Candidate manifest is missing or not a file")
        content = json.loads(base64.b64decode(payload["content"].replace("\n", ""), validate=True))
        require(isinstance(content, dict) and type(content.get("schemaVersion")) is int
                and content["schemaVersion"] == 1, "Invalid candidate manifest schema")
        reference = content.get("snapshot", "")
        prefix = f"ghcr.io/{self.image}@"
        require(isinstance(reference, str) and reference.startswith(prefix), "Unexpected candidate image")
        return digest(reference[len(prefix):])

    def manifest(self, reference):
        if self.registry_token is None:
            auth = base64.b64encode(f"{self.actor}:{self.token}".encode()).decode()
            query = urllib.parse.urlencode({"service": "ghcr.io", "scope": f"repository:{self.image}:pull"})
            raw, _ = self.get("https://ghcr.io/token?" + query, {"Authorization": "Basic " + auth})
            self.registry_token = json.loads(raw).get("token")
            require(isinstance(self.registry_token, str) and self.registry_token, "Registry token missing")
        raw, _ = self.get(f"https://ghcr.io/v2/{self.image}/manifests/{urllib.parse.quote(reference, safe=':')}", {
            "Authorization": "Bearer " + self.registry_token,
            "Accept": ", ".join(sorted(INDEX_TYPES | MANIFEST_TYPES)),
        })
        actual = "sha256:" + hashlib.sha256(raw).hexdigest()
        if reference.startswith("sha256:"):
            require(actual == reference, "Registry manifest digest mismatch")
        return actual, json.loads(raw)


def audit(client, keep=8):
    rows, heads = client.inventory()
    versions = parse_versions(rows)
    refs = {label: client.candidate(*head) for label, head in heads.items()}
    manifests = {key: client.manifest(key)[1] for key in versions}

    def check_tags():
        for key, value in versions.items():
            for tag in value["tags"]:
                require(client.manifest(tag)[0] == key, f"Registry tag changed: {tag}")

    check_tags()
    result = plan_retention(rows, manifests, refs, keep)
    final_rows, final_heads = client.inventory()
    require(versions == parse_versions(final_rows) and heads == final_heads,
            "Package inventory or open PR/default branch heads changed during audit")
    check_tags()
    result["sourceHeads"] = {
        label: {"repository": head[0], "sha": head[1]} for label, head in sorted(heads.items())
    }
    result["generatedAt"] = datetime.now(timezone.utc).isoformat()
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument("--keep", type=int, default=8)
    parser.add_argument("--output", type=Path, default=Path("snapshot-retention-plan.json"))
    args = parser.parse_args(argv)
    try:
        report = audit(Client(args.repository or "", os.environ.get("GH_TOKEN"),
                              os.environ.get("GITHUB_ACTOR")), args.keep)
    except (UnsafeInventory, KeyError, TypeError, ValueError, AttributeError, OSError) as exc:
        report = {"schemaVersion": 1, "mode": "dry-run", "status": "blocked",
                  "deletionEnabled": False, "candidateVersions": [],
                  "reason": str(exc), "notice": "Retain everything; inventory could not be verified."}
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Snapshot retention audit: {report['status']}; no versions deleted.")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as output:
            output.write(f"## Snapshot retention (read-only)\n\nStatus: {report['status']}. "
                         f"Candidate versions: {len(report['candidateVersions'])}. No versions deleted.\n\n"
                         "See the uploaded JSON report for retained roots and any blocker.\n")
    return 0 if report["status"] == "complete" else 1


if __name__ == "__main__":
    sys.exit(main())
