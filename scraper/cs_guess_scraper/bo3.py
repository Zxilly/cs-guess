"""bo3.gg player enrichment with conservative cross-source linking."""

from __future__ import annotations

import json
import time
from collections.abc import Mapping
from collections.abc import Callable, Iterator
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_BASE_URL = "https://api.bo3.gg/api/v1"
MAX_RETRIES = 3
JsonObject = Mapping[str, Any]
HttpResponse = tuple[int, Mapping[str, str], bytes]
Transport = Callable[[str, Mapping[str, str]], HttpResponse]


class Bo3APIError(RuntimeError):
    """Raised when bo3.gg cannot return a usable public response."""

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


def parse_player(
    payload: JsonObject,
    *,
    countries: Mapping[int, JsonObject],
    teams: Mapping[int, JsonObject],
) -> dict[str, object]:
    """Normalize a bo3.gg player using separately paginated lookup tables."""
    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    full_name = " ".join(part for part in (first_name, last_name) if part) or None

    raw_country_id = payload.get("country_id")
    country = (
        countries.get(int(raw_country_id))
        if raw_country_id is not None
        else None
    )
    country_code = (
        str(country.get("code") or "").upper()
        if isinstance(country, Mapping)
        else ""
    )

    raw_team_id = payload.get("team_id")
    team = teams.get(int(raw_team_id)) if raw_team_id is not None else None
    current_team = None
    joined_team_at = str(payload.get("joined_team_at") or "").strip()
    has_current_membership = payload.get("status") == 1 and bool(
        joined_team_at
    )
    if (
        has_current_membership
        and isinstance(team, Mapping)
        and team.get("name")
    ):
        current_team = {
            "source": "bo3",
            "source_id": str(team["id"]),
            "slug": team.get("slug"),
            "name": team["name"],
            "short_name": team.get("acronym"),
            "country_code": team.get("country_code"),
            "image_url": team.get("image_url"),
            "start_value": joined_team_at[:10],
            "start_precision": "day",
        }

    raw_ps_id = payload.get("ps_id")
    return {
        "source": "bo3",
        "source_id": str(payload["id"]),
        "slug": payload.get("slug"),
        "nickname": payload.get("nickname"),
        "full_name": full_name,
        "country_code": country_code or None,
        "birth_date": payload.get("birthday"),
        "image_url": payload.get("image_url"),
        "active": payload.get("status") == 1,
        "is_coach": bool(payload.get("is_coach")),
        "pandascore_external_id": (
            str(raw_ps_id) if raw_ps_id is not None else None
        ),
        "current_team": current_team,
        "modified_at": payload.get("updated_at"),
    }


class Bo3Client:
    """Rate-limited client for the public JSON used by bo3.gg player pages."""

    def __init__(
        self,
        transport: Transport | None = None,
        min_interval: float = 0.25,
        user_agent: str = "CSGuess/0.1 (player data enrichment)",
    ) -> None:
        if min_interval < 0:
            raise ValueError("min_interval must be non-negative")
        if not user_agent.strip():
            raise ValueError("bo3.gg requires an identifying User-Agent")
        self._headers = {
            "Accept": "application/json",
            "User-Agent": user_agent,
        }
        self._transport = transport or _default_transport
        self._min_interval = min_interval
        self._last_request_at: float | None = None

    def _request_page(
        self,
        resource: str,
        *,
        offset: int,
        limit: int,
    ) -> tuple[list[JsonObject], int]:
        url = f"{API_BASE_URL}/{resource}?{urlencode({
            'page[offset]': offset,
            'page[limit]': limit,
        })}"
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
                    raise Bo3APIError(
                        0, "bo3.gg connection failed after finite retries"
                    ) from error
                time.sleep(float(2**retries))
                retries += 1
                continue
            self._last_request_at = time.monotonic()
            retryable = status == 429 or 500 <= status <= 599
            if not retryable or retries >= MAX_RETRIES:
                break
            retry_after = next(
                (
                    value
                    for name, value in response_headers.items()
                    if name.casefold() == "retry-after"
                ),
                None,
            )
            try:
                delay = max(0.0, float(retry_after or 2**retries))
            except ValueError:
                delay = float(2**retries)
            time.sleep(delay)
            retries += 1
        if status != 200:
            raise Bo3APIError(status, f"bo3.gg returned HTTP {status}")
        try:
            payload = json.loads(body)
        except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise Bo3APIError(status, "bo3.gg returned invalid JSON") from error
        if not isinstance(payload, Mapping):
            raise Bo3APIError(status, "bo3.gg response must be an object")
        rows = payload.get("results")
        total = payload.get("total")
        if (
            not isinstance(rows, list)
            or not all(isinstance(row, Mapping) for row in rows)
            or not isinstance(total, Mapping)
        ):
            raise Bo3APIError(status, "bo3.gg page has an invalid shape")
        try:
            total_count = int(total["count"])
        except (KeyError, TypeError, ValueError) as error:
            raise Bo3APIError(
                status, "bo3.gg page is missing total.count"
            ) from error
        return rows, total_count

    def _iter_resource(
        self,
        resource: str,
        *,
        page_size: int,
    ) -> Iterator[JsonObject]:
        if not 1 <= page_size <= 100:
            raise ValueError("page_size must be between 1 and 100")
        offset = 0
        while True:
            rows, total_count = self._request_page(
                resource,
                offset=offset,
                limit=page_size,
            )
            yield from rows
            offset += len(rows)
            if not rows or offset >= total_count:
                return

    def iter_cs_players(
        self,
        *,
        page_size: int = 100,
    ) -> Iterator[dict[str, object]]:
        """Yield normalized CS players after loading country/team lookups."""
        countries = {
            int(country["id"]): country
            for country in self._iter_resource(
                "countries", page_size=page_size
            )
        }
        teams: dict[int, dict[str, Any]] = {}
        for raw_team in self._iter_resource("teams", page_size=page_size):
            team = dict(raw_team)
            raw_country_id = team.get("country_id")
            country = (
                countries.get(int(raw_country_id))
                if raw_country_id is not None
                else None
            )
            team["country_code"] = (
                str(country.get("code") or "").upper()
                if isinstance(country, Mapping)
                else None
            )
            teams[int(team["id"])] = team
        for player in self._iter_resource("players", page_size=page_size):
            yield parse_player(player, countries=countries, teams=teams)
