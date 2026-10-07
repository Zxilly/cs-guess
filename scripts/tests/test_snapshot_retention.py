"""Offline safety regressions for the informational GHCR retention planner."""

import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.error

MODULE_PATH = Path(__file__).resolve().parents[1] / "snapshot_retention.py"
SPEC = importlib.util.spec_from_file_location("snapshot_retention", MODULE_PATH)
retention = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retention)
OCI_INDEX = "application/vnd.oci.image.index.v1+json"
OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
DOCKER_INDEX = "application/vnd.docker.distribution.manifest.list.v2+json"
DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json"
REPOSITORY = "Zxilly/cs-guess"
HEAD = "a" * 40


def sha(value):
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


def descriptor(key, media_type=OCI_MANIFEST):
    return {"mediaType": media_type, "size": 123, "digest": key}


def image(subject=None):
    result = {
        "schemaVersion": 2,
        "mediaType": OCI_MANIFEST,
        "config": descriptor(sha("config"), "application/vnd.oci.image.config.v1+json"),
        "layers": [descriptor(sha("layer"), "application/vnd.oci.image.layer.v1.tar+gzip")],
    }
    if subject is not None:
        result["subject"] = descriptor(subject)
    return result


class InventoryFixture:
    def __init__(self, count=9):
        self.rows = []
        self.manifests = {}
        self.roots = []
        self.children = []
        self.attestations = []
        for number in range(1, count + 1):
            child = self.add(f"image-{number}", day=number)
            attestation = self.add(f"attestation-{number}", day=number)
            attestation_descriptor = descriptor(attestation)
            attestation_descriptor.update({
                "platform": {"os": "unknown", "architecture": "unknown"},
                "annotations": {
                    "vnd.docker.reference.type": "attestation-manifest",
                    "vnd.docker.reference.digest": child,
                },
            })
            root = self.add(f"root-{number}", tags=[f"run-{number}-1"], day=number, manifest={
                "schemaVersion": 2,
                "mediaType": OCI_INDEX,
                "manifests": [descriptor(child), attestation_descriptor],
            })
            self.roots.append(root)
            self.children.append(child)
            self.attestations.append(attestation)
        self.row(self.roots[-1])["metadata"]["container"]["tags"].append("latest")

    def add(self, name, tags=None, day=1, manifest=None):
        key = sha(name)
        self.manifests[key] = image() if manifest is None else manifest
        self.rows.append({
            "id": len(self.rows) + 1,
            "name": key,
            "created_at": f"2026-01-{day:02d}T00:00:00Z",
            "metadata": {"package_type": "container", "container": {"tags": list(tags or [])}},
        })
        return key

    def row(self, key):
        return next(row for row in self.rows if row["name"] == key)

    def plan(self, refs=None, keep=8):
        return retention.plan_retention(self.rows, self.manifests, refs or {}, keep)


class PlanTests(unittest.TestCase):
    def assert_blocked(self, fixture, refs=None):
        with self.assertRaises(retention.UnsafeInventory):
            fixture.plan(refs)

    def test_keeps_eight_logical_roots_not_eight_package_versions(self):
        fixture = InventoryFixture()
        report = fixture.plan()
        self.assertEqual(report["snapshotCount"], 9)
        self.assertEqual(report["versionCount"], 27)
        self.assertEqual(report["expiredSnapshotDigests"], fixture.roots[:1])
        candidates = {item["digest"] for item in report["candidateVersions"]}
        self.assertEqual(candidates, {fixture.roots[0], fixture.children[0], fixture.attestations[0]})
        self.assertEqual(len(report["retainedDigests"]), 24)
        self.assertFalse(report["deletionEnabled"])
        self.assertEqual(report["mode"], "dry-run")

    def test_run_and_reviewed_aliases_count_as_one_logical_root(self):
        fixture = InventoryFixture()
        fixture.row(fixture.roots[-1])["metadata"]["container"]["tags"].extend([
            "run-999-2", "reviewed-" + "b" * 40,
        ])
        self.assertEqual(fixture.plan()["snapshotCount"], 9)

    def test_reviewed_and_run_roots_share_the_eight_snapshot_budget(self):
        fixture = InventoryFixture()
        fixture.row(fixture.roots[1])["metadata"]["container"]["tags"] = ["reviewed-" + "b" * 40]
        self.assertEqual(fixture.plan()["expiredSnapshotDigests"], fixture.roots[:1])

    def test_old_latest_is_always_protected(self):
        fixture = InventoryFixture()
        fixture.row(fixture.roots[-1])["metadata"]["container"]["tags"].remove("latest")
        fixture.row(fixture.roots[0])["metadata"]["container"]["tags"].append("latest")
        self.assertEqual(fixture.plan()["candidateVersions"], [])

    def test_open_pr_and_default_branch_candidates_are_protected(self):
        for label in ("open-pr-123", "default-branch-candidate"):
            with self.subTest(label=label):
                fixture = InventoryFixture()
                report = fixture.plan({label: fixture.roots[0]})
                self.assertEqual(report["candidateVersions"], [])
                self.assertIn(label, next(item["reasons"] for item in report["protectedRoots"]
                                          if item["digest"] == fixture.roots[0]))

    def test_unknown_and_malformed_tags_protect_entire_old_snapshot(self):
        for tag in ("manual-backup", "run-1", "run-0-1", "run-1-0", "run-1-1-extra",
                    "reviewed-short", "reviewed-" + "A" * 40):
            with self.subTest(tag=tag):
                fixture = InventoryFixture()
                fixture.row(fixture.roots[0])["metadata"]["container"]["tags"].append(tag)
                self.assertEqual(fixture.plan()["candidateVersions"], [])

    def test_unclassified_untagged_manifest_and_its_dependencies_are_retained(self):
        fixture = InventoryFixture()
        root = fixture.add("unclassified-index", manifest={
            "schemaVersion": 2, "mediaType": OCI_INDEX,
            "manifests": [descriptor(fixture.children[0])],
        })
        retained = set(fixture.plan()["retainedDigests"])
        self.assertTrue({root, fixture.children[0]} <= retained)

    def test_nested_indexes_keep_transitive_children_and_attestations(self):
        fixture = InventoryFixture()
        nested = fixture.add("nested-index", manifest={
            "schemaVersion": 2, "mediaType": OCI_INDEX,
            "manifests": [descriptor(fixture.children[-1]), descriptor(fixture.attestations[-1])],
        })
        fixture.manifests[fixture.roots[-1]]["manifests"] = [descriptor(nested, OCI_INDEX)]
        retained = set(fixture.plan()["retainedDigests"])
        self.assertTrue({nested, fixture.children[-1], fixture.attestations[-1]} <= retained)

    def test_shared_child_of_expired_and_retained_roots_is_retained(self):
        fixture = InventoryFixture()
        fixture.manifests[fixture.roots[-1]]["manifests"].append(descriptor(fixture.children[0]))
        self.assertIn(fixture.children[0], fixture.plan()["retainedDigests"])
        self.assertNotIn(fixture.children[0], {v["digest"] for v in fixture.plan()["candidateVersions"]})

    def test_external_subject_attestations_and_subject_chains_are_retained(self):
        fixture = InventoryFixture()
        signed = fixture.add("signature", manifest=image(fixture.children[-1]))
        second = fixture.add("signature-of-signature", manifest=image(signed))
        self.assertTrue({signed, second} <= set(fixture.plan()["retainedDigests"]))

    def test_docker_attestation_with_own_tag_retains_its_target(self):
        fixture = InventoryFixture()
        fixture.row(fixture.attestations[0])["metadata"]["container"]["tags"] = ["keep-provenance"]
        retained = set(fixture.plan()["retainedDigests"])
        self.assertTrue({fixture.children[0], fixture.attestations[0]} <= retained)
        self.assertNotIn(fixture.roots[0], retained)

    def test_shared_target_retains_legacy_docker_attestation(self):
        fixture = InventoryFixture()
        fixture.manifests[fixture.roots[-1]]["manifests"].append(descriptor(fixture.children[0]))
        self.assertIn(fixture.attestations[0], fixture.plan()["retainedDigests"])

    def test_missing_or_malformed_docker_attestation_target_blocks(self):
        for value in ("sha256:bad", sha("missing"), None):
            with self.subTest(value=value):
                fixture = InventoryFixture()
                fixture.manifests[fixture.roots[0]]["manifests"][1]["annotations"][
                    "vnd.docker.reference.digest"] = value
                self.assert_blocked(fixture)

    def test_docker_v2_manifest_and_index_supported(self):
        fixture = InventoryFixture()
        fixture.manifests[fixture.roots[-1]]["mediaType"] = DOCKER_INDEX
        fixture.manifests[fixture.children[-1]]["mediaType"] = DOCKER_MANIFEST
        self.assertEqual(fixture.plan()["status"], "complete")

    def test_newest_uses_creation_instant_not_input_order_or_tag_lexicography(self):
        fixture = InventoryFixture()
        fixture.rows.reverse()
        fixture.row(fixture.roots[0])["metadata"]["container"]["tags"] = ["run-999999-1"]
        fixture.row(fixture.roots[0])["created_at"] = "2026-01-02T00:00:00+01:00"
        self.assertEqual(fixture.plan()["expiredSnapshotDigests"], fixture.roots[:1])

    def test_missing_latest_blocks(self):
        fixture = InventoryFixture()
        fixture.row(fixture.roots[-1])["metadata"]["container"]["tags"].remove("latest")
        self.assert_blocked(fixture)

    def test_missing_protected_root_blocks(self):
        self.assert_blocked(InventoryFixture(), {"open-pr-99": sha("missing")})

    def test_missing_manifest_blocks_even_when_unrelated_to_kept_snapshots(self):
        fixture = InventoryFixture()
        del fixture.manifests[fixture.children[0]]
        self.assert_blocked(fixture)

    def test_missing_child_or_subject_blocks(self):
        for subject in (False, True):
            with self.subTest(subject=subject):
                fixture = InventoryFixture()
                if subject:
                    fixture.manifests[fixture.attestations[0]]["subject"] = descriptor(sha("missing"))
                else:
                    fixture.manifests[fixture.roots[0]]["manifests"].append(descriptor(sha("missing")))
                self.assert_blocked(fixture)

    def test_malformed_oci_data_blocks(self):
        mutations = [
            lambda doc: doc.update(schemaVersion=1),
            lambda doc: doc.update(schemaVersion=2.0),
            lambda doc: doc.update(mediaType="unknown/media-type"),
            lambda doc: doc.update(manifests=[]),
            lambda doc: doc.update(manifests={}),
            lambda doc: doc["manifests"][0].update(digest="sha256:bad"),
            lambda doc: doc["manifests"][0].update(size=True),
            lambda doc: doc["manifests"][0].update(urls=["https://example.com/manifest"]),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                fixture = InventoryFixture()
                mutate(fixture.manifests[fixture.roots[0]])
                self.assert_blocked(fixture)

    def test_duplicate_version_id_digest_or_tag_blocks(self):
        for kind in ("id", "name", "tag"):
            with self.subTest(kind=kind):
                fixture = InventoryFixture()
                if kind == "tag":
                    fixture.rows[0]["metadata"]["container"]["tags"] = ["latest"]
                else:
                    fixture.rows[1][kind] = fixture.rows[0][kind]
                self.assert_blocked(fixture)

    def test_invalid_retention_counts_block(self):
        for keep in (0, -1, True, 2.5):
            with self.subTest(keep=keep), self.assertRaises(retention.UnsafeInventory):
                InventoryFixture().plan(keep=keep)

    def test_invalid_package_metadata_tags_and_timestamps_block(self):
        mutations = [
            lambda row: row.update(metadata=None),
            lambda row: row.update(metadata=[]),
            lambda row: row["metadata"].update(container=None),
            lambda row: row["metadata"]["container"].update(tags=None),
            lambda row: row["metadata"]["container"].update(tags=["same", "same"]),
            lambda row: row["metadata"]["container"].update(tags=[1]),
            lambda row: row.update(created_at="not-a-date"),
            lambda row: row.update(created_at="2026-01-01T00:00:00"),
            lambda row: row.update(id=True),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                fixture = InventoryFixture()
                mutate(fixture.rows[0])
                self.assert_blocked(fixture)


class PagingClient(retention.Client):
    def __init__(self, responses):
        super().__init__(REPOSITORY, "fake-token", "test-actor")
        self.responses = iter(responses)
        self.calls = []

    def api(self, path):
        self.calls.append(path)
        return next(self.responses)


def page_rows(start, stop):
    return [{"id": number} for number in range(start, stop)]


class PaginationTests(unittest.TestCase):
    PATH = "/repos/Zxilly/cs-guess/pulls?state=open"

    def next_link(self, number=2, prefix="https://api.github.com", path="/repos/Zxilly/cs-guess/pulls"):
        return {"Link": f'<{prefix}{path}?state=open&per_page=100&page={number}>; rel="next"'}

    def test_multiple_pages_follow_next_until_short_final_page(self):
        client = PagingClient([(page_rows(1, 101), self.next_link()), (page_rows(101, 104), {})])
        self.assertEqual(len(client.pages(self.PATH)), 103)
        self.assertIn("state=open&per_page=100&page=2", client.calls[-1])

    def test_short_page_with_next_is_not_treated_as_complete(self):
        client = PagingClient([(page_rows(1, 3), self.next_link()), (page_rows(3, 5), {})])
        self.assertEqual(len(client.pages(self.PATH)), 4)

    def test_github_canonical_repository_id_link_is_accepted(self):
        canonical = "/repositories/123/pulls"
        client = PagingClient([(page_rows(1, 3), self.next_link(path=canonical)),
                               (page_rows(3, 5), {})])
        self.assertEqual(len(client.pages(self.PATH, canonical_path=canonical)), 4)

    def test_other_repository_canonical_link_is_rejected(self):
        client = PagingClient([(page_rows(1, 3), self.next_link(path="/repositories/999/pulls"))])
        with self.assertRaises(retention.UnsafeInventory):
            client.pages(self.PATH, canonical_path="/repositories/123/pulls")

    def test_full_final_page_without_link_checks_one_more_page(self):
        client = PagingClient([(page_rows(1, 101), {}), ([], {})])
        self.assertEqual(len(client.pages(self.PATH)), 100)
        self.assertEqual(len(client.calls), 2)

    def test_empty_inventory_is_allowed_at_transport_level(self):
        self.assertEqual(PagingClient([([], {})]).pages(self.PATH), [])

    def test_duplicate_across_pages_blocks(self):
        client = PagingClient([(page_rows(1, 3), self.next_link()), (page_rows(2, 4), {})])
        with self.assertRaises(retention.UnsafeInventory):
            client.pages(self.PATH)

    def test_malformed_or_untrusted_next_links_block(self):
        headers = [
            {"Link": "not-a-link"}, self.next_link(1), self.next_link(3),
            self.next_link(prefix="https://example.com"),
            self.next_link(prefix="http://api.github.com"),
            self.next_link(path="/wrong/path"),
            {"Link": '<https://api.github.com/repos/Zxilly/cs-guess/pulls?page=2>; rel="next"'},
        ]
        for header in headers:
            with self.subTest(header=header), self.assertRaises(retention.UnsafeInventory):
                PagingClient([(page_rows(1, 3), header)]).pages(self.PATH)

    def test_empty_page_with_next_blocks(self):
        with self.assertRaises(retention.UnsafeInventory):
            PagingClient([([], self.next_link())]).pages(self.PATH)

    def test_pagination_cap_blocks_instead_of_silently_truncating(self):
        responses = [(page_rows(i * 100, (i + 1) * 100), {}) for i in range(100)]
        with self.assertRaises(retention.UnsafeInventory):
            PagingClient(responses).pages(self.PATH)

    def test_invalid_item_shape_blocks(self):
        for rows in ({}, [None], [{"id": True}], page_rows(0, 101)):
            with self.subTest(rows=str(rows)[:40]), self.assertRaises(retention.UnsafeInventory):
                PagingClient([(rows, {})]).pages(self.PATH)


class FakeAuditClient:
    def __init__(self):
        self.fixture = InventoryFixture()
        self.heads = {"default-branch-candidate": (REPOSITORY, HEAD),
                      "open-pr-1": (REPOSITORY, "b" * 40)}
        self.inventory_calls = 0
        self.tag_calls = {}
        self.final_mutation = None
        self.tag_move_on = None

    def inventory(self):
        self.inventory_calls += 1
        rows, heads = copy.deepcopy(self.fixture.rows), copy.deepcopy(self.heads)
        if self.inventory_calls > 1 and self.final_mutation:
            self.final_mutation(rows, heads)
        return rows, heads

    def candidate(self, repository, head):
        return self.fixture.roots[-1]

    def manifest(self, reference):
        if reference.startswith("sha256:"):
            return reference, self.fixture.manifests[reference]
        self.tag_calls[reference] = self.tag_calls.get(reference, 0) + 1
        if self.tag_move_on and self.tag_calls[reference] == self.tag_move_on:
            return sha("moved-tag"), image()
        key = next(row["name"] for row in self.fixture.rows
                   if reference in row["metadata"]["container"]["tags"])
        return key, self.fixture.manifests[key]


class AuditTests(unittest.TestCase):
    def test_stable_inventory_completes_after_two_tag_and_inventory_observations(self):
        client = FakeAuditClient()
        result = retention.audit(client)
        self.assertEqual(result["status"], "complete")
        self.assertIn("generatedAt", result)
        self.assertEqual(client.inventory_calls, 2)
        self.assertTrue(all(count == 2 for count in client.tag_calls.values()))

    def test_final_inventory_or_pr_heads_change_blocks(self):
        mutations = [
            lambda rows, heads: rows.pop(),
            lambda rows, heads: rows[0]["metadata"]["container"]["tags"].append("added-tag"),
            lambda rows, heads: heads.update({"open-pr-1": (REPOSITORY, "c" * 40)}),
            lambda rows, heads: heads.update({"open-pr-2": (REPOSITORY, "d" * 40)}),
            lambda rows, heads: heads.pop("open-pr-1"),
            lambda rows, heads: heads.update({"default-branch-candidate": (REPOSITORY, "e" * 40)}),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index), self.assertRaises(retention.UnsafeInventory):
                client = FakeAuditClient()
                client.final_mutation = mutate
                retention.audit(client)

    def test_registry_tag_moving_in_either_pass_blocks(self):
        for call in (1, 2):
            with self.subTest(call=call), self.assertRaises(retention.UnsafeInventory):
                client = FakeAuditClient()
                client.tag_move_on = call
                retention.audit(client)

    def test_missing_candidate_or_manifest_blocks(self):
        for method in ("candidate", "manifest"):
            with self.subTest(method=method), self.assertRaises(retention.UnsafeInventory):
                client = FakeAuditClient()
                setattr(client, method, mock.Mock(side_effect=retention.UnsafeInventory("HTTP 404")))
                retention.audit(client)


class InventoryTests(unittest.TestCase):
    def prepare(self, prs=None, owner_type="User"):
        client = retention.Client(REPOSITORY, "fake-token", "test-actor")
        client.api = mock.Mock(side_effect=[
            ({"id": 123, "owner": {"type": owner_type, "login": "Zxilly"},
              "default_branch": "release/main"}, {}), ({"sha": HEAD}, {}),
        ])
        client.pages = mock.Mock(side_effect=[InventoryFixture().rows, prs or []])
        return client

    def pr(self, number=1, repository=REPOSITORY, sha_value=HEAD):
        return {"id": number + 10, "number": number, "state": "open", "draft": True,
                "title": "Unrelated title must not filter the candidate",
                "head": {"sha": sha_value, "repo": {"full_name": repository},
                         "ref": "not-a-candidate-looking-branch"}}

    def test_all_open_heads_including_forks_and_drafts_are_pinned(self):
        client = self.prepare([self.pr(), self.pr(2, "fork-owner/fork-name", "b" * 40)])
        _, heads = client.inventory()
        self.assertEqual(heads, {
            "default-branch-candidate": (REPOSITORY, HEAD),
            "open-pr-1": (REPOSITORY, HEAD),
            "open-pr-2": ("fork-owner/fork-name", "b" * 40),
        })
        self.assertEqual(client.api.call_args_list[-1].args[0],
                         "/repos/Zxilly/cs-guess/commits/release%2Fmain")
        self.assertEqual(client.pages.call_args_list[-1].args[0],
                         "/repos/Zxilly/cs-guess/pulls?state=open")
        self.assertEqual(client.pages.call_args_list[-1].kwargs,
                         {"canonical_path": "/repositories/123/pulls"})

    def test_user_and_organization_package_routes_are_selected(self):
        for owner_type, namespace in (("User", "users"), ("Organization", "orgs")):
            with self.subTest(owner_type=owner_type):
                client = self.prepare(owner_type=owner_type)
                client.inventory()
                self.assertTrue(client.pages.call_args_list[0].args[0].startswith(
                    f"/{namespace}/Zxilly/packages/container/cs-guess-data/versions"))

    def test_invalid_duplicate_or_missing_pr_heads_block(self):
        missing_repo = self.pr()
        missing_repo["head"]["repo"] = None
        closed = self.pr()
        closed["state"] = "closed"
        cases = [[self.pr(0)], [self.pr(True)], [self.pr(), self.pr()], [missing_repo],
                 [closed], [self.pr(sha_value="not-a-sha")],
                 [self.pr(repository="https://example.com/not-a-repo")]]
        for prs in cases:
            with self.subTest(prs=prs), self.assertRaises(retention.UnsafeInventory):
                self.prepare(prs).inventory()


class ClientTests(unittest.TestCase):
    def client(self):
        return retention.Client(REPOSITORY, "fake-token", "test-actor")

    def candidate_response(self, content):
        return ({"type": "file", "encoding": "base64",
                 "content": base64.b64encode(json.dumps(content).encode()).decode()}, {})

    def test_candidate_is_pinned_to_head_sha_and_expected_ghcr_image(self):
        client = self.client()
        key = sha("candidate")
        client.api = mock.Mock(return_value=self.candidate_response({
            "schemaVersion": 1, "snapshot": "ghcr.io/zxilly/cs-guess-data@" + key,
        }))
        self.assertEqual(client.candidate(REPOSITORY, HEAD), key)
        self.assertIn("?ref=" + HEAD, client.api.call_args.args[0])

    def test_wrong_candidate_schema_registry_repo_or_digest_blocks(self):
        good = {"schemaVersion": 1, "snapshot": "ghcr.io/zxilly/cs-guess-data@" + sha("candidate")}
        cases = [dict(good, schemaVersion=True), dict(good, schemaVersion=2),
                 dict(good, snapshot="ghcr.io/zxilly/other@" + sha("candidate")),
                 dict(good, snapshot="registry.example.com/zxilly/cs-guess-data@" + sha("candidate")),
                 dict(good, snapshot="ghcr.io/zxilly/cs-guess-data:latest"),
                 dict(good, snapshot="ghcr.io/zxilly/cs-guess-data@sha256:bad")]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(retention.UnsafeInventory):
                client = self.client()
                client.api = mock.Mock(return_value=self.candidate_response(value))
                client.candidate(REPOSITORY, HEAD)

    def test_candidate_json_non_objects_and_invalid_base64_block(self):
        for value in ([], None, "not-an-object", 123):
            with self.subTest(value=value), self.assertRaises(retention.UnsafeInventory):
                client = self.client()
                client.api = mock.Mock(return_value=self.candidate_response(value))
                client.candidate(REPOSITORY, HEAD)
        client = self.client()
        client.api = mock.Mock(return_value=({"type": "file", "encoding": "base64",
                                             "content": "%%not-base64%%"}, {}))
        with self.assertRaises(ValueError):
            client.candidate(REPOSITORY, HEAD)

    def test_manifest_bytes_are_verified_by_digest(self):
        client = self.client()
        raw = json.dumps(image()).encode()
        key = "sha256:" + hashlib.sha256(raw).hexdigest()
        client.get = mock.Mock(side_effect=[(b'{"token":"pull-only-token"}', {}), (raw, {})])
        actual, manifest = client.manifest(key)
        self.assertEqual(actual, key)
        self.assertEqual(manifest, image())
        auth_url = client.get.call_args_list[0].args[0]
        self.assertIn("%3Apull", auth_url)
        self.assertNotIn("push", auth_url)

    def test_manifest_digest_mismatch_blocks(self):
        client = self.client()
        client.registry_token = "pull-only-token"
        client.get = mock.Mock(return_value=(json.dumps(image()).encode(), {}))
        with self.assertRaises(retention.UnsafeInventory):
            client.manifest(sha("different"))

    def test_network_client_is_get_only(self):
        client = self.client()
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b"{}"
        response.headers = {}
        client.opener.open = mock.Mock(return_value=response)
        client.get("https://api.github.com/repos/Zxilly/cs-guess", {})
        request = client.opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)

    def test_http_permission_missing_and_server_failures_block(self):
        for status in (401, 403, 404, 429, 500):
            with self.subTest(status=status), self.assertRaises(retention.UnsafeInventory):
                client = self.client()
                client.opener.open = mock.Mock(side_effect=urllib.error.HTTPError(
                    "https://api.github.com/test", status, "test", {}, None))
                client.get("https://api.github.com/test", {})

    def test_network_timeout_and_redirect_block(self):
        for failure in (urllib.error.URLError("offline"), TimeoutError()):
            with self.subTest(failure=failure), self.assertRaises(retention.UnsafeInventory):
                client = self.client()
                client.opener.open = mock.Mock(side_effect=failure)
                client.get("https://api.github.com/test", {})
        with self.assertRaises(retention.UnsafeInventory):
            retention.NoRedirect().redirect_request(None, None, 302, "moved", {}, "https://example.com")

    def test_untrusted_or_insecure_url_rejected_before_network(self):
        for url in ("https://example.com/path", "http://api.github.com/path", "http://ghcr.io/path"):
            with self.subTest(url=url), self.assertRaises(retention.UnsafeInventory):
                client = self.client()
                client.opener.open = mock.Mock(side_effect=AssertionError("Network must not be used"))
                client.get(url, {})


class CliTests(unittest.TestCase):
    def test_failure_writes_blocked_report_with_no_candidates(self):
        failures = [retention.UnsafeInventory("Incomplete pagination"),
                    ValueError("Malformed JSON"), KeyError("missing field"),
                    TypeError("Invalid shape"), AttributeError("Invalid metadata"), OSError("offline")]
        for failure in failures:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / "report.json"
                with mock.patch.object(retention, "Client"), \
                     mock.patch.object(retention, "audit", side_effect=failure), \
                     mock.patch.dict("os.environ", {}, clear=True), \
                     contextlib.redirect_stdout(io.StringIO()):
                    status = retention.main(["--repository", REPOSITORY, "--output", str(output)])
                report = json.loads(output.read_text())
                self.assertEqual(status, 1)
                self.assertEqual(report["status"], "blocked")
                self.assertEqual(report["candidateVersions"], [])
                self.assertFalse(report["deletionEnabled"])

    def test_success_writes_read_only_report_and_summary(self):
        with tempfile.TemporaryDirectory() as temp:
            output, summary = Path(temp) / "report.json", Path(temp) / "summary.md"
            with mock.patch.object(retention, "Client", return_value=FakeAuditClient()), \
                 mock.patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(summary)}, clear=True), \
                 contextlib.redirect_stdout(io.StringIO()):
                status = retention.main(["--repository", REPOSITORY, "--output", str(output)])
            report = json.loads(output.read_text())
            self.assertEqual(status, 0)
            self.assertEqual(report["status"], "complete")
            self.assertFalse(report["deletionEnabled"])
            self.assertIn("No versions deleted", summary.read_text())

    def test_cli_has_no_deletion_switch(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as stopped:
            retention.main(["--delete"])
        self.assertEqual(stopped.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
