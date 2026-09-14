import pytest

from cs_guess_scraper.catalog_review import render_review


def test_review_reports_semantic_changes_and_ignores_record_key_order():
    before = [
        {"id": "same", "nickname": "Same"},
        {"id": "changed", "nickname": "Name", "team": "Old"},
        {"id": "removed", "nickname": "Gone"},
    ]
    after = [
        {"nickname": "Same", "id": "same"},
        {"id": "added", "nickname": "New"},
        {"id": "changed", "nickname": "Name", "team": "New", "age": 20},
    ]
    report = render_review(before, after, "abc123")
    assert "| Added | 1 |" in report
    assert "| Removed | 1 |" in report
    assert "| Modified | 1 |" in report
    assert "| Unchanged | 1 |" in report
    assert "| Name (changed) | team | Old | New |" in report
    assert "| Name (changed) | age | ∅ | 20 |" in report
    assert "abc123" in report


def test_review_escapes_provider_text_and_explicitly_limits_preview():
    after = [{"id": str(i), "nickname": "<b>@user|\n`x`"} for i in range(3)]
    report = render_review([], after, "base", limit=1)
    assert "2 more rows" in report
    assert "<b>" not in report
    assert "@user" not in report
    assert "&#124;" in report
    assert "&#96;" in report
    assert "more rows" not in render_review([], after, "base")


def test_review_rejects_duplicate_ids_instead_of_hiding_records():
    with pytest.raises(ValueError, match="Duplicate"):
        render_review([], [{"id": "x"}, {"id": "x"}], "base")
