"""PandaScore Counter-Strike player ingestion."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator, Mapping
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_URL = "https://api.pandascore.co/csgo/players"

JsonObject = Mapping[str, Any]
HttpResponse = tuple[int, Mapping[str, str], bytes]
Transport = Callable[[str, Mapping[str, str]], HttpResponse]
MAX_RETRIES = 3


class PandaScoreAPIError(RuntimeError):
    """Raised when PandaScore cannot return a usable response."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _default_transport(
    url: str,
    headers: Mapping[str, str],
) -> HttpResponse:
    request = Request(url, headers=dict(headers), method="GET")
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, dict(response.headers), response.read()
    except HTTPError as error:
        return error.code, dict(error.headers or {}), error.read()


def _retry_after_seconds(headers: Mapping[str, str]) -> float:
    value = next(
        (
            header_value
            for header_name, header_value in headers.items()
            if header_name.lower() == "retry-after"
        ),
        None,
    )
    if value is None:
        return 1.0
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return 1.0
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        return max(
            0.0,
            (retry_at - datetime.now(timezone.utc)).total_seconds(),
        )


def parse_player(payload: JsonObject) -> dict[str, object]:
    """Normalize a PandaScore player without coupling it to persistence."""
    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    full_name = " ".join(part for part in (first_name, last_name) if part) or None
    country_code = payload.get("nationality")
    team = payload.get("current_team")
    current_team = None
    if isinstance(team, Mapping):
        team_country_code = team.get("location")
        current_team = {
            "source": "pandascore",
            "source_id": str(team["id"]) if team.get("id") is not None else None,
            "name": team.get("name"),
            "short_name": team.get("acronym"),
            "country_code": (
                str(team_country_code).upper() if team_country_code else None
            ),
            "image_url": team.get("image_url"),
            "modified_at": team.get("modified_at"),
        }

    return {
        "source": "pandascore",
        "source_id": (
            str(payload["id"]) if payload.get("id") is not None else None
        ),
        "nickname": payload.get("name"),
        "full_name": full_name,
        "country_code": str(country_code).upper() if country_code else None,
        "birth_date": payload.get("birthday") or payload.get("birth_date"),
        "age": payload.get("age"),
        "image_url": payload.get("image_url"),
        "active": payload.get("active"),
        "current_team": current_team,
        "modified_at": payload.get("modified_at"),
    }


class PandaScoreClient:
    """Rate-limited client for PandaScore's Counter-Strike players API."""

    def __init__(
        self,
        token: str,
        transport: Transport | None = None,
        min_interval: float = 0.1,
    ) -> None:
        if not token.strip():
            raise ValueError("PandaScore requires a non-empty API token")
        if min_interval < 0:
            raise ValueError("min_interval must be non-negative")
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        self._transport = transport or _default_transport
        self._min_interval = min_interval
        self._last_request_at: float | None = None

    def _request(self, params: Mapping[str, object]) -> list[JsonObject]:
        url = f"{API_URL}?{urlencode(params)}"
        retries = 0
        while True:
            if self._last_request_at is not None:
                delay = self._min_interval - (
                    time.monotonic() - self._last_request_at
                )
                if delay > 0:
                    time.sleep(delay)
            try:
                status, response_headers, body = self._transport(
                    url, self._headers
                )
            except (OSError, TimeoutError) as error:
                self._last_request_at = time.monotonic()
                if retries >= MAX_RETRIES:
                    raise PandaScoreAPIError(
                        0,
                        "PandaScore connection failed after finite retries",
                    ) from error
                time.sleep(float(2**retries))
                retries += 1
                continue
            self._last_request_at = time.monotonic()
            retryable = status == 429 or 500 <= status <= 599
            if not retryable or retries >= MAX_RETRIES:
                break
            time.sleep(_retry_after_seconds(response_headers))
            retries += 1
        if status != 200:
            raise PandaScoreAPIError(status, f"PandaScore returned HTTP {status}")
        try:
            payload = json.loads(body)
        except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PandaScoreAPIError(status, "PandaScore returned invalid JSON") from error
        if not isinstance(payload, list) or not all(
            isinstance(item, Mapping) for item in payload
        ):
            raise PandaScoreAPIError(
                status,
                "PandaScore players response must be a list of objects",
            )
        return payload

    def iter_cs_players(
        self,
        per_page: int = 100,
    ) -> Iterator[dict[str, object]]:
        """Yield all normalized CS players in PandaScore page order."""
        if not 1 <= per_page <= 100:
            raise ValueError("per_page must be between 1 and 100")

        page = 1
        while True:
            payloads = self._request({"page": page, "per_page": per_page})
            for payload in payloads:
                yield parse_player(payload)
            if len(payloads) < per_page:
                return
            page += 1
