from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


class SettingsError(ValueError):
    """Raised when required scraper configuration is missing or invalid."""


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip("\"'")
    return values


def _parse_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise SettingsError(f"invalid boolean value: {value}")


@dataclass(frozen=True)
class Settings:
    pandascore_api_token: str = field(repr=False)
    liquipedia_user_agent: str
    balldontlie_api_token: str | None = field(default=None, repr=False)
    allow_hltv_fallback: bool = False

    @classmethod
    def discover(cls, start: Path | None = None) -> Settings:
        current = (start or Path.cwd()).resolve()
        if current.is_file():
            current = current.parent
        for directory in (current, *current.parents):
            candidate = directory / ".env"
            if candidate.is_file():
                return cls.from_env_file(candidate)
        raise SettingsError(f"no .env found from {current} or its parents")

    @classmethod
    def from_env_file(cls, path: Path) -> Settings:
        if not path.is_file():
            raise SettingsError(f"environment file not found: {path}")

        values = _parse_env_file(path)
        token = values.get("PANDASCORE_API_TOKEN", "").strip()
        if not token:
            raise SettingsError("PANDASCORE_API_TOKEN is required")

        user_agent = values.get("LIQUIPEDIA_USER_AGENT", "").strip()
        if not user_agent:
            raise SettingsError("LIQUIPEDIA_USER_AGENT is required")

        return cls(
            pandascore_api_token=token,
            liquipedia_user_agent=user_agent,
            balldontlie_api_token=(
                values.get("BALLDONTLIE_API_TOKEN", "").strip() or None
            ),
            allow_hltv_fallback=_parse_bool(
                values.get("ALLOW_HLTV_FALLBACK")
            ),
        )
