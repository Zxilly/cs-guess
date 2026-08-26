from pathlib import Path


ROOT = Path(__file__).parents[2]


def test_refresh_preserves_conflicted_candidate_before_opening_review_pr():
    workflow = (ROOT / ".github/workflows/refresh-player-data.yml").read_text(
        encoding="utf-8"
    )

    quality_step = workflow.split("- name: Collect data quality", 1)[1].split(
        "- name: Summarize refresh", 1
    )[0]
    assert "--fail-on-critical" not in quality_step
    assert "audit-report.json" in quality_step
    assert 'tags+=(--tag "${SNAPSHOT_IMAGE}:latest")' in workflow
    assert "scraper/player-data-candidate.json" in workflow
    assert (
        'branch="automation/player-data-refresh-${GITHUB_RUN_ID}-'
        '${GITHUB_RUN_ATTEMPT}"' in workflow
    )


def test_candidate_review_replays_decisions_without_refetching_providers():
    workflow = (ROOT / ".github/workflows/review-player-data.yml").read_text(
        encoding="utf-8"
    )

    assert "docker pull" in workflow
    assert "merge-reviewed" in workflow
    assert "cs-guess-scraper export" in workflow
    assert "quality" in workflow
    assert "--fail-on-critical" in workflow
    assert "git diff --exit-code" in workflow
    assert "cs-guess-scraper sync" not in workflow
    assert "github.event_name == 'push'" in workflow
    assert '--tag "${image}:latest"' in workflow
