"""BALLDONTLIE Counter-Strike player ingestion."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator, Mapping
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://api.balldontlie.io/cs/v1/players"
JsonObject = Mapping[str, Any]
HttpResponse = tuple[int, Mapping[str, str], bytes]
Transport = Callable[[str, Mapping[str, str]], HttpResponse]
MAX_RETRIES = 3


class BallDontLieAPIError(RuntimeError):
    """Raised when BALLDONTLIE cannot return a usable response."""

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
            if header_name.casefold() == "retry-after"
        ),
        None,
    )
    if value is None:
        return 12.1
    try:
        return max(0.0, float(value))
    except ValueError:
        return 12.1


def parse_player(payload: JsonObject) -> dict[str, object]:
    """Normalize a BALLDONTLIE player without guessing vendor ID semantics."""
    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    full_name = (
        str(payload.get("full_name") or "").strip()
        or " ".join(part for part in (first_name, last_name) if part)
        or None
    )
    raw_team = payload.get("team")
    current_team = None
    if isinstance(raw_team, Mapping):
        current_team = {
            "source": "balldontlie",
            "external_id": (
                str(raw_team["id"])
                if raw_team.get("id") is not None
                else None
            ),
            "name": raw_team.get("name"),
            "short_name": raw_team.get("short_name"),
        }
    return {
        "source": "balldontlie",
        "external_id": (
            str(payload["id"]) if payload.get("id") is not None else None
        ),
        "nickname": payload.get("nickname"),
        "full_name": full_name,
        "birth_date": payload.get("birthday"),
        "age": payload.get("age"),
        "active": payload.get("is_active"),
        "current_team": current_team,
        # Despite the upstream name, live samples match PandaScore player IDs
        # rather than Steam64 IDs. Keep the relationship explicit and verify it
        # against an existing PandaScore record before linking.
        "pandascore_external_id": (
            str(payload["steam_id"])
            if payload.get("steam_id") is not None
            else None
        ),
    }


class BallDontLieClient:
    """Rate-limited client for BALLDONTLIE's CS2 player catalog."""

    def __init__(
        self,
        token: str,
        transport: Transport | None = None,
        min_interval: float = 12.1,
    ) -> None:
        if not token.strip():
            raise ValueError("BALLDONTLIE requires a non-empty API token")
        if min_interval < 0:
            raise ValueError("min_interval must be non-negative")
        self._headers = {
            "Authorization": token,
            "Accept": "application/json",
        }
        self._transport = transport or _default_transport
        self._min_interval = min_interval
        self._last_request_at: float | None = None

    def _request(self, params: Mapping[str, object]) -> Mapping[str, Any]:
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
                    url,
                    self._headers,
                )
            except (OSError, TimeoutError) as error:
                self._last_request_at = time.monotonic()
                if retries >= MAX_RETRIES:
                    raise BallDontLieAPIError(
                        0,
                        (
                            "BALLDONTLIE connection failed after finite "
                            "retries"
                        ),
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
            raise BallDontLieAPIError(
                status,
                f"BALLDONTLIE returned HTTP {status}",
            )
        try:
            payload = json.loads(body)
        except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BallDontLieAPIError(
                status,
                "BALLDONTLIE returned invalid JSON",
            ) from error
        if not isinstance(payload, Mapping):
            raise BallDontLieAPIError(
                status,
                "BALLDONTLIE players response must be an object",
            )
        return payload

    def iter_cs_players(
        self,
        per_page: int = 100,
    ) -> Iterator[dict[str, object]]:
        if not 1 <= per_page <= 100:
            raise ValueError("per_page must be between 1 and 100")
        cursor: object | None = None
        while True:
            params: dict[str, object] = {"per_page": per_page}
            if cursor is not None:
                params["cursor"] = cursor
            payload = self._request(params)
            players = payload.get("data")
            meta = payload.get("meta")
            if not isinstance(players, list) or not all(
                isinstance(item, Mapping) for item in players
            ):
                raise BallDontLieAPIError(
                    200,
                    "BALLDONTLIE data must be a list of player objects",
                )
            if not isinstance(meta, Mapping):
                raise BallDontLieAPIError(
                    200,
                    "BALLDONTLIE meta must be an object",
                )
            for player in players:
                yield parse_player(player)
            next_cursor = meta.get("next_cursor")
            if next_cursor is None:
                return
            if next_cursor == cursor:
                raise BallDontLieAPIError(
                    200,
                    "BALLDONTLIE returned a repeated cursor",
                )
            cursor = next_cursor
