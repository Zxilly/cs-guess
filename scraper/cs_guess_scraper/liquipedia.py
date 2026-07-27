"""Liquipedia MediaWiki API ingestion and wikitext parsing."""

from __future__ import annotations

import gzip
import json
import re
import time
from collections.abc import Callable, Iterator, Mapping
from html import unescape
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

API_URL = "https://liquipedia.net/counterstrike/api.php"

JsonObject = Mapping[str, Any]
Transport = Callable[[str, Mapping[str, str]], JsonObject]

_ROLE_NAMES = {
    "awp": "awper",
    "awper": "awper",
    "rifle": "rifler",
    "rifler": "rifler",
    "igl": "igl",
    "in-game leader": "igl",
    "entry": "entry",
    "entry fragger": "entry",
    "lurker": "lurker",
    "support": "support",
}
_PLATFORM_FIELDS = {
    "steam64ID": "steam",
    "faceitdb": "faceit",
    "esea": "esea",
    "esl": "esl",
    "gamersclub": "gamersclub",
}
_MEMBERSHIP_KINDS = {
    "active": "active",
    "benched": "benched",
    "bench": "benched",
    "inactive": "inactive",
    "loan": "loan",
    "stand-in": "standin",
    "standin": "standin",
    "substitute": "standin",
    "academy": "academy",
    "trial": "trial",
}
_PLAYER_STATUSES = {
    "active": "active",
    "inactive": "inactive",
    "not active": "inactive",
    "retired": "retired",
    "deceased": "deceased",
    "passed away": "deceased",
}


def _default_transport(url: str, headers: Mapping[str, str]) -> JsonObject:
    request = Request(url, headers=dict(headers), method="GET")
    with urlopen(request, timeout=30) as response:
        payload = response.read()
        if response.headers.get("Content-Encoding", "").casefold() == "gzip":
            payload = gzip.decompress(payload)
        return json.loads(payload)


class LiquipediaClient:
    """Small, rate-limited client for Liquipedia's MediaWiki Action API."""

    def __init__(
        self,
        user_agent: str,
        transport: Transport | None = None,
        min_interval: float = 2.0,
    ) -> None:
        if not user_agent.strip():
            raise ValueError("Liquipedia requires a non-empty custom User-Agent")
        if min_interval < 0:
            raise ValueError("min_interval must be non-negative")
        self._headers = {
            "User-Agent": user_agent,
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
        }
        self._transport = transport or _default_transport
        self._min_interval = min_interval
        self._last_request_at: float | None = None

    def _request(self, params: Mapping[str, str]) -> JsonObject:
        if self._last_request_at is not None:
            delay = self._min_interval - (time.monotonic() - self._last_request_at)
            if delay > 0:
                time.sleep(delay)
        url = f"{API_URL}?{urlencode(params)}"
        response = self._transport(url, self._headers)
        self._last_request_at = time.monotonic()
        return response

    def iter_player_pages(self) -> Iterator[dict[str, object]]:
        base_params = {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "generator": "categorymembers",
            "gcmtitle": "Category:Players",
            "gcmnamespace": "0",
            "gcmtype": "page",
            "gcmlimit": "max",
            "prop": "revisions",
            "rvprop": "ids|timestamp|content",
            "rvslots": "main",
        }
        continuation: Mapping[str, Any] = {}
        while True:
            params = {
                **base_params,
                **{key: str(value) for key, value in continuation.items()},
            }
            response = self._request(params)
            for page in response.get("query", {}).get("pages", []):
                revisions = page.get("revisions", [])
                if not revisions:
                    continue
                revision = revisions[0]
                yield {
                    "title": page["title"],
                    "wikitext": revision["slots"]["main"]["content"],
                    "revid": revision["revid"],
                    "timestamp": revision["timestamp"],
                }
            continuation = response.get("continue", {})
            if not continuation:
                return

    def iter_player_pages_by_titles(
        self,
        titles: list[str],
    ) -> Iterator[dict[str, object]]:
        """Fetch known player page titles in API-sized batches with redirects."""

        unique_titles = list(dict.fromkeys(title for title in titles if title))
        for offset in range(0, len(unique_titles), 50):
            requested = unique_titles[offset : offset + 50]
            response = self._request(
                {
                    "action": "query",
                    "format": "json",
                    "formatversion": "2",
                    "titles": "|".join(requested),
                    "redirects": "1",
                    "prop": "revisions",
                    "rvprop": "ids|timestamp|content",
                    "rvslots": "main",
                }
            )
            query = response.get("query", {})
            aliases = {
                str(item["from"]): str(item["to"])
                for group_name in ("normalized", "redirects")
                for item in query.get(group_name, [])
                if item.get("from") is not None and item.get("to") is not None
            }

            requested_by_target: dict[str, list[str]] = {}
            for original in requested:
                target = original
                visited: set[str] = set()
                while target in aliases and target not in visited:
                    visited.add(target)
                    target = aliases[target]
                requested_by_target.setdefault(target, []).append(original)

            for page in query.get("pages", []):
                revisions = page.get("revisions", [])
                if page.get("missing") or not revisions:
                    continue
                revision = revisions[0]
                title = str(page["title"])
                yield {
                    "title": title,
                    "requested_titles": requested_by_target.get(title, [title]),
                    "wikitext": revision["slots"]["main"]["content"],
                    "revid": revision["revid"],
                    "timestamp": revision["timestamp"],
                }

    def fetch_major_player_database(self) -> dict[str, object]:
        response = self._request(
            {
                "action": "query",
                "format": "json",
                "formatversion": "2",
                "titles": "Majors/Player Database",
                "prop": "revisions",
                "rvprop": "ids|timestamp|content",
                "rvslots": "main",
            }
        )
        page = response["query"]["pages"][0]
        revision = page["revisions"][0]
        return {
            "title": page["title"],
            "wikitext": revision["slots"]["main"]["content"],
            "revid": revision["revid"],
            "timestamp": revision["timestamp"],
        }


def _extract_template(wikitext: str, template_name: str) -> str | None:
    start_match = re.search(
        r"\{\{\s*" + re.escape(template_name) + r"\b",
        wikitext,
        flags=re.IGNORECASE,
    )
    if not start_match:
        return None
    start = start_match.start()
    depth = 0
    index = start
    while index < len(wikitext) - 1:
        pair = wikitext[index : index + 2]
        if pair == "{{":
            depth += 1
            index += 2
            continue
        if pair == "}}":
            depth -= 1
            index += 2
            if depth == 0:
                return wikitext[start:index]
            continue
        index += 1
    return None


def _iter_templates(value: str, template_name: str) -> Iterator[tuple[int, str]]:
    pattern = re.compile(
        r"\{\{\s*" + re.escape(template_name) + r"\b",
        flags=re.IGNORECASE,
    )
    search_from = 0
    while match := pattern.search(value, search_from):
        start = match.start()
        depth = 0
        index = start
        while index < len(value) - 1:
            pair = value[index : index + 2]
            if pair == "{{":
                depth += 1
                index += 2
                continue
            if pair == "}}":
                depth -= 1
                index += 2
                if depth == 0:
                    yield start, value[start:index]
                    search_from = index
                    break
                continue
            index += 1
        else:
            return


def _split_top_level(value: str, delimiter: str = "|") -> list[str]:
    parts: list[str] = []
    start = 0
    curly_depth = 0
    square_depth = 0
    index = 0
    while index < len(value):
        pair = value[index : index + 2]
        if pair == "{{":
            curly_depth += 1
            index += 2
            continue
        if pair == "}}" and curly_depth:
            curly_depth -= 1
            index += 2
            continue
        if pair == "[[":
            square_depth += 1
            index += 2
            continue
        if pair == "]]" and square_depth:
            square_depth -= 1
            index += 2
            continue
        if value[index] == delimiter and not curly_depth and not square_depth:
            parts.append(value[start:index])
            start = index + 1
        index += 1
    parts.append(value[start:])
    return parts


def _template_parameters(template: str) -> dict[str, str]:
    _, fields = _template_arguments(template)
    return fields


def _template_arguments(template: str) -> tuple[list[str], dict[str, str]]:
    inner = template[2:-2]
    positional: list[str] = []
    named: dict[str, str] = {}
    for part in _split_top_level(inner)[1:]:
        if "=" not in part:
            positional.append(part.strip())
            continue
        name, argument_value = part.split("=", 1)
        named[name.strip()] = argument_value.strip()
    return positional, named


def _clean_markup(value: str) -> str:
    value = re.sub(r"<!--.*?-->", "", value, flags=re.DOTALL)
    value = value.replace("'''", "").replace("''", "")
    value = re.sub(
        r"\[\[(?:[^]|]*\|)?([^]]+)\]\]",
        lambda match: match.group(1).strip(),
        value,
    )
    return value.strip()


def _clean_person_name(value: str) -> str:
    """Select the primary name when Liquipedia embeds aliases with HTML breaks."""
    primary = re.split(r"<br\s*/?>", value, maxsplit=1, flags=re.IGNORECASE)[0]
    return _clean_markup(primary)


def _partial_date(value: str) -> tuple[str | None, str]:
    cleaned = _clean_markup(value)
    if not cleaned or cleaned.casefold() == "present":
        return None, "unknown"
    match = re.search(
        r"(?<!\d)(\d{4})(?:-(\d{1,2}|\?\?|00))?(?:-(\d{1,2}|\?\?|00))?",
        cleaned,
    )
    if not match:
        return None, "unknown"
    year, month, day = match.groups()
    if not month or month in {"??", "00"}:
        return year, "year"
    normalized_month = f"{int(month):02d}"
    if not day or day in {"??", "00"}:
        return f"{year}-{normalized_month}", "month"
    return f"{year}-{normalized_month}-{int(day):02d}", "day"


def _parse_team_history(
    history_wikitext: str,
    current_team: str | None,
    default_game_title: str,
) -> list[dict[str, object]]:
    history: list[dict[str, object]] = []
    for offset, template in _iter_templates(history_wikitext, "TH"):
        positional, named = _template_arguments(template)
        if len(positional) < 2:
            continue
        raw_range, raw_team = positional[0], positional[1]
        dates = re.split(
            r"\s+(?:—|–|-|&(?:m|n)dash;)\s+",
            raw_range,
            maxsplit=1,
            flags=re.IGNORECASE,
        )
        raw_start = dates[0]
        raw_end = dates[1] if len(dates) == 2 else ""
        start_value, start_precision = _partial_date(raw_start)
        end_value, end_precision = _partial_date(raw_end)
        is_current = _clean_markup(raw_end).casefold() == "present"

        team_name = _clean_markup(raw_team)
        team_external_id = _clean_markup(named.get("link", "")) or team_name
        raw_kind = positional[2] if len(positional) >= 3 else "active"
        membership_kind = _MEMBERSHIP_KINDS.get(
            _clean_markup(raw_kind).casefold(),
            "unknown",
        )

        preceding_text = history_wikitext[:offset]
        csgo_marker = preceding_text.rfind("Counter-Strike: Global Offensive")
        cs2_marker = preceding_text.rfind("Counter-Strike 2")
        if cs2_marker > csgo_marker:
            game_title = "cs2"
        elif csgo_marker >= 0:
            game_title = "csgo"
        else:
            game_title = default_game_title

        history.append(
            {
                "team": {
                    "external_id": team_external_id,
                    "name": team_name,
                },
                "membership_kind": membership_kind,
                "start_value": start_value,
                "start_precision": start_precision,
                "end_value": end_value,
                "end_precision": end_precision,
                "is_current": is_current,
                "is_primary": (
                    is_current
                    and membership_kind == "active"
                    and team_name == current_team
                ),
                "game_title": game_title,
            }
        )
    return history


def parse_player_page(title: str, wikitext: str) -> dict[str, object]:
    """Parse source-neutral player facts from a Liquipedia player page."""

    infobox = _extract_template(wikitext, "Infobox player")
    if infobox is None:
        raise ValueError(f"{title!r} does not contain an Infobox player template")
    fields = _template_parameters(infobox)

    nickname = _clean_markup(fields.get("id", "")) or title
    native_name = _clean_person_name(fields.get("name", ""))
    romanized_name = _clean_person_name(fields.get("romanized_name", ""))
    full_name = romanized_name or native_name or None
    current_team = _clean_markup(fields.get("team", "")) or None
    birth_date, _ = _partial_date(fields.get("birth_date", ""))
    death_date, _ = _partial_date(fields.get("death_date", ""))
    if _clean_markup(fields.get("cs2", "")).casefold() == "y":
        default_game_title = "cs2"
    elif _clean_markup(fields.get("csgo", "")).casefold() == "y":
        default_game_title = "csgo"
    else:
        default_game_title = "counter-strike"

    roles: list[str] = []
    for raw_role in fields.get("roles", "").split(","):
        role = _ROLE_NAMES.get(_clean_markup(raw_role).casefold())
        if role and role not in roles:
            roles.append(role)

    platform_ids = {
        normalized_name: _clean_markup(fields[field_name])
        for field_name, normalized_name in _PLATFORM_FIELDS.items()
        if _clean_markup(fields.get(field_name, ""))
    }
    source_ids = {"liquipedia": title, **platform_ids}
    status = _PLAYER_STATUSES.get(
        _clean_markup(fields.get("status", "")).casefold(),
        "unknown",
    )

    result: dict[str, object] = {
        "id": nickname,
        "external_id": title,
        "nickname": nickname,
        "full_name": full_name,
        "country": _clean_markup(fields.get("country", "")) or None,
        "birth_date": birth_date,
        "death_date": death_date,
        "status": status,
        "team": current_team,
        "current_team": (
            {"external_id": current_team, "name": current_team}
            if current_team
            else None
        ),
        "roles": roles,
        "source_ids": source_ids,
        "platform_ids": platform_ids,
        "source_url": (
            "https://liquipedia.net/counterstrike/"
            + quote(title.replace(" ", "_"), safe="/()_-")
        ),
        "image_url": None,
        "team_history": _parse_team_history(
            fields.get("team_history", ""),
            current_team,
            default_game_title,
        ),
    }
    if romanized_name and native_name and romanized_name != native_name:
        result["native_name"] = native_name
    return result


def parse_major_player_database(wikitext: str) -> list[dict[str, object]]:
    """Return one source-neutral record for every player/Major table row."""

    records: list[dict[str, object]] = []
    current_player: dict[str, str] | None = None
    pending_game_title: str | None = None

    for line in wikitext.splitlines():
        if line.lstrip().startswith("!") and "{{player" in line.casefold():
            player_template = _extract_template(line, "player")
            if not player_template:
                continue
            positional, named = _template_arguments(player_template)
            if not positional:
                continue
            nickname = _clean_markup(positional[0])
            current_player = {
                "external_id": _clean_markup(named.get("link", "")) or nickname,
                "nickname": nickname,
                "country": _clean_markup(named.get("flag", "")),
            }
            pending_game_title = None
            continue

        if "data-filter-group=\"major-players-filters\"" in line:
            categories_match = re.search(
                r'data-filter-categories="([^"]+)"',
                line,
                flags=re.IGNORECASE,
            )
            categories = (
                categories_match.group(1).casefold().split(",")
                if categories_match
                else []
            )
            pending_game_title = next(
                (name for name in ("csgo", "cs2") if name in categories),
                None,
            )
            continue

        if (
            current_player is None
            or pending_game_title is None
            or not line.lstrip().startswith("|[[")
        ):
            continue

        event_match = re.search(
            r"\[\[([^]|]+)(?:\|([^]]+))?\]\]",
            line,
        )
        team_template = _extract_template(line, "TeamPart")
        if not event_match or not team_template:
            pending_game_title = None
            continue

        team_positional, team_named = _template_arguments(team_template)
        if not team_positional:
            pending_game_title = None
            continue
        team_name = _clean_markup(team_positional[0])
        team_external_id = (
            _clean_markup(team_named.get("link", "")) or team_name
        )
        starts_on = None
        if len(team_positional) >= 2:
            starts_on, _ = _partial_date(team_positional[1])

        placement = None
        placement_template = _extract_template(line, "Placement")
        if placement_template:
            placement_positional, _ = _template_arguments(placement_template)
            if placement_positional:
                placement = _clean_markup(placement_positional[0]) or None

        event_external_id = _clean_markup(event_match.group(1))
        event_name = unescape(
            _clean_markup(event_match.group(2) or event_external_id)
        )
        records.append(
            {
                "player_external_id": current_player["external_id"],
                "player_nickname": current_player["nickname"],
                "player_country": current_player["country"] or None,
                "event_external_id": event_external_id,
                "event_name": event_name,
                "game_title": pending_game_title,
                "starts_on": starts_on,
                "team_external_id": team_external_id,
                "team_name": team_name,
                "participation_kind": "participant",
                "placement": placement,
                "stage_reached": None,
                "counts_toward_total": True,
            }
        )
        pending_game_title = None

    return records
