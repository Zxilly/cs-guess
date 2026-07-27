from pathlib import Path

import pytest

from cs_guess_scraper.config import Settings, SettingsError


def test_settings_load_required_credentials_without_leaking_token(
    tmp_path: Path,
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "PANDASCORE_API_TOKEN=test-secret-token",
                "BALLDONTLIE_API_TOKEN=bdl-secret-token",
                "LIQUIPEDIA_USER_AGENT=CSGuessTest/1.0 (test@example.com)",
                "ALLOW_HLTV_FALLBACK=true",
            ]
        ),
        encoding="utf-8",
    )

    settings = Settings.from_env_file(env_file)

    assert settings.pandascore_api_token == "test-secret-token"
    assert settings.balldontlie_api_token == "bdl-secret-token"
    assert settings.liquipedia_user_agent == (
        "CSGuessTest/1.0 (test@example.com)"
    )
    assert settings.allow_hltv_fallback is True
    assert "test-secret-token" not in repr(settings)
    assert "bdl-secret-token" not in repr(settings)


def test_settings_reject_missing_pandascore_token(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "LIQUIPEDIA_USER_AGENT=CSGuessTest/1.0 (test@example.com)\n",
        encoding="utf-8",
    )

    with pytest.raises(SettingsError, match="PANDASCORE_API_TOKEN"):
        Settings.from_env_file(env_file)


def test_settings_discover_environment_file_in_parent(
    tmp_path: Path,
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "PANDASCORE_API_TOKEN=parent-token",
                "LIQUIPEDIA_USER_AGENT=CSGuessTest/1.0 (test@example.com)",
            ]
        ),
        encoding="utf-8",
    )
    nested = tmp_path / "scraper" / "tests"
    nested.mkdir(parents=True)

    settings = Settings.discover(nested)

    assert settings.pandascore_api_token == "parent-token"
