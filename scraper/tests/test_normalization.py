import pytest
from cs_guess_scraper.normalization import normalize_country_code


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("France", "FR"),
        ("denmark", "DK"),
        ("United States", "US"),
        ("South Korea", "KR"),
        ("Russia", "RU"),
        ("Türkiye", "TR"),
        ("Czech Republic", "CZ"),
        ("Kosovo", "XK"),
        ("br", "BR"),
        (None, None),
        ("", None),
    ],
)
def test_country_names_and_codes_normalize_to_alpha_2(
    raw: str | None,
    expected: str | None,
) -> None:
    assert normalize_country_code(raw) == expected


def test_unknown_country_is_not_silently_invented() -> None:
    assert normalize_country_code("European Mix") is None
