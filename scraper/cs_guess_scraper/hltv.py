"""Narrow HLTV fallback for already-known player profile URLs."""

from __future__ import annotations

import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.error import HTTPError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from .merge import normalize_identity_text, person_name_token_signature
from .normalization import normalize_country_code

BASE_URL = "https://www.hltv.org"
MAX_RETRIES = 2
Transport = Callable[
    [str, Mapping[str, str]],
    tuple[int, Mapping[str, str], bytes],
]
_VOID_ELEMENTS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


class HltvError(RuntimeError):
    """Base exception for an unavailable known HLTV profile."""

    def __init__(self, status: int, source_url: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.source_url = source_url


class HltvUnavailableError(HltvError):
    """Raised when access is denied and fallback should be skipped."""


def _default_transport(
    url: str,
    headers: Mapping[str, str],
) -> tuple[int, Mapping[str, str], bytes]:
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
        return 0.0
    try:
        return max(0.0, float(value))
    except ValueError:
        return 0.0


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[_Node | str] = field(default_factory=list)

    def text(self) -> str:
        parts: list[str] = []
        for child in self.children:
            parts.append(child.text() if isinstance(child, _Node) else child)
        return " ".join(" ".join(parts).split())

    def has_class(self, name: str) -> bool:
        return name.casefold() in {
            item.casefold() for item in self.attrs.get("class", "").split()
        }

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, _Node):
                yield from child.walk()


class _DocumentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _Node("document")
        self._stack = [self.root]

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        node = _Node(
            tag.casefold(),
            {name.casefold(): value or "" for name, value in attrs},
        )
        self._stack[-1].children.append(node)
        if node.tag not in _VOID_ELEMENTS:
            self._stack.append(node)

    def handle_startendtag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        node = _Node(
            tag.casefold(),
            {name.casefold(): value or "" for name, value in attrs},
        )
        self._stack[-1].children.append(node)

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.casefold()
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == normalized_tag:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self._stack[-1].children.append(data)


def _first_by_class(root: _Node, *names: str) -> _Node | None:
    return next(
        (
            node
            for node in root.walk()
            if any(node.has_class(name) for name in names)
        ),
        None,
    )


def _canonical_url(root: _Node) -> str | None:
    for node in root.walk():
        if node.tag != "link":
            continue
        rel = {item.casefold() for item in node.attrs.get("rel", "").split()}
        if "canonical" in rel and node.attrs.get("href"):
            return urljoin(BASE_URL, node.attrs["href"])
    return None


def _profile_id(source_url: str | None) -> str | None:
    if source_url is None:
        return None
    match = re.search(r"/player/(\d+)(?:/|$)", urlparse(source_url).path)
    return match.group(1) if match else None


def _country(real_name_node: _Node | None) -> str | None:
    if real_name_node is None:
        return None
    for node in real_name_node.walk():
        if node.tag != "img":
            continue
        value = node.attrs.get("title") or node.attrs.get("alt")
        if value:
            return value.strip() or None
    return None


def _current_team(root: _Node) -> dict[str, object] | None:
    team_node = _first_by_class(root, "playerTeam", "player-team")
    if team_node is None:
        return None
    for node in team_node.walk():
        href = node.attrs.get("href", "")
        name = node.text()
        match = re.match(r"^/team/(\d+)(?:/|$)", href)
        if node.tag == "a" and match and name:
            return {
                "external_id": match.group(1),
                "name": name,
                "source_url": urljoin(BASE_URL, href),
            }
    return None


def _month_value(value: str) -> str:
    return datetime.strptime(value, "%b %Y").replace(tzinfo=timezone.utc).strftime(
        "%Y-%m"
    )


def _team_history(root: _Node) -> list[dict[str, object]]:
    table = _first_by_class(root, "team-breakdown")
    if table is None:
        return []
    history = []
    month_pattern = (
        r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        r"\s+\d{4}\b"
    )
    for row in table.walk():
        classes = set(row.attrs.get("class", "").split())
        if row.tag != "tr" or "team" not in classes or "team-detail" in classes:
            continue
        period_node = next(
            (
                node
                for node in row.walk()
                if node.has_class("time-period-cell")
            ),
            None,
        )
        team_link = next(
            (
                node
                for node in row.walk()
                if node.tag == "a"
                and re.match(r"^/team/\d+(?:/|$)", node.attrs.get("href", ""))
            ),
            None,
        )
        if period_node is None or team_link is None or not team_link.text():
            continue
        team_match = re.match(
            r"^/team/(\d+)(?:/|$)",
            team_link.attrs.get("href", ""),
        )
        assert team_match is not None
        month_values = re.findall(month_pattern, period_node.text())
        if not month_values:
            continue
        is_current = "present" in period_node.text().casefold()
        history.append(
            {
                "team": {
                    "external_id": team_match.group(1),
                    "name": team_link.text(),
                    "source_url": urljoin(
                        BASE_URL,
                        team_link.attrs["href"],
                    ),
                },
                "membership_kind": "active",
                "from": _month_value(month_values[0]),
                "from_precision": "month",
                "to": (
                    _month_value(month_values[1])
                    if len(month_values) > 1
                    else None
                ),
                "to_precision": (
                    "month" if len(month_values) > 1 else "unknown"
                ),
                "is_current": is_current,
                "is_primary": is_current,
            }
        )
    return history


def _number_near_label(root: _Node, label: str) -> int | None:
    escaped_label = re.escape(label)
    patterns = (
        rf"\b(\d+)\s+{escaped_label}\b",
        rf"\b{escaped_label}\s+(\d+)\b",
    )
    for node in root.walk():
        text = node.text()
        for pattern in patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                return int(match.group(1))
    return None


def parse_player_profile(html: str) -> dict[str, object]:
    """Extract only facts visibly rendered on one HLTV player profile."""
    parser = _DocumentParser()
    parser.feed(html)
    root = parser.root

    nickname_node = _first_by_class(root, "playerNickname", "player-nickname")
    if nickname_node is None:
        nickname_node = next(
            (node for node in root.walk() if node.tag == "h1"),
            None,
        )
    real_name_node = _first_by_class(root, "playerRealname", "player-realname")
    age_node = _first_by_class(root, "playerAge", "player-age")
    age_match = (
        re.search(r"\b(\d+)\s+years?\b", age_node.text(), flags=re.IGNORECASE)
        if age_node
        else None
    )
    source_url = _canonical_url(root)

    return {
        "external_id": _profile_id(source_url),
        "nickname": nickname_node.text() or None if nickname_node else None,
        "full_name": real_name_node.text() or None if real_name_node else None,
        "country": _country(real_name_node),
        "current_team": _current_team(root),
        "team_history": _team_history(root),
        "age": int(age_match.group(1)) if age_match else None,
        "majors_played": _number_near_label(root, "Majors played"),
        "source_url": source_url,
    }


def known_profile_mismatches(
    parsed: Mapping[str, object],
    *,
    canonical_nickname: str,
    canonical_full_name: str | None,
    canonical_country_code: str | None,
    match_external_id: str,
) -> list[str]:
    """Return identity fields that contradict an explicitly matched player."""
    mismatches = []
    parsed_nickname = normalize_identity_text(
        str(parsed.get("nickname") or "")
    )
    nickname_aliases = {
        normalize_identity_text(canonical_nickname),
        normalize_identity_text(match_external_id.replace("_", " ")),
    }
    if not parsed_nickname or parsed_nickname not in nickname_aliases:
        mismatches.append("nickname")

    parsed_full_name = str(parsed.get("full_name") or "")
    if canonical_full_name and parsed_full_name:
        canonical_tokens = set(
            person_name_token_signature(canonical_full_name)
        )
        parsed_tokens = set(person_name_token_signature(parsed_full_name))
        if not (
            canonical_tokens
            and parsed_tokens
            and (
                canonical_tokens <= parsed_tokens
                or parsed_tokens <= canonical_tokens
            )
        ):
            mismatches.append("full_name")

    parsed_country = normalize_country_code(
        str(parsed.get("country") or "")
    )
    if (
        canonical_country_code
        and parsed_country
        and parsed_country != canonical_country_code
    ):
        mismatches.append("country_code")
    return mismatches


class HltvClient:
    """Fetch only explicitly identified HLTV player profile pages."""

    def __init__(
        self,
        transport: Transport | None = None,
        min_interval: float = 5.0,
    ) -> None:
        if min_interval < 5.0 and transport is None:
            raise ValueError("live HLTV requests require min_interval >= 5 seconds")
        if min_interval < 0:
            raise ValueError("min_interval must be non-negative")
        self._transport = transport or _default_transport
        self._min_interval = min_interval
        self._last_request_at: float | None = None
        self._headers = {
            "User-Agent": "CSGuess-HLTV-Fallback/0.1",
            "Accept": "text/html",
        }

    def _throttle(self) -> None:
        if self._last_request_at is None:
            return
        delay = self._min_interval - (
            time.monotonic() - self._last_request_at
        )
        if delay > 0:
            time.sleep(delay)

    def fetch_player(
        self,
        hltv_id: int | str,
        slug: str,
    ) -> dict[str, object]:
        """Fetch one known ID/slug pair; no search or discovery is performed."""
        normalized_id = str(hltv_id)
        if not re.fullmatch(r"[1-9]\d*", normalized_id):
            raise ValueError("hltv_id must be a positive integer")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", slug):
            raise ValueError("slug must contain only letters, digits, _ or -")

        source_url = f"{BASE_URL}/player/{normalized_id}/{slug}"
        retries = 0
        while True:
            self._throttle()
            status, response_headers, body = self._transport(
                source_url,
                self._headers,
            )
            self._last_request_at = time.monotonic()
            retryable = status == 429 or 500 <= status <= 599
            if not retryable or retries >= MAX_RETRIES:
                break
            retry_after = _retry_after_seconds(response_headers)
            if retry_after > 0:
                time.sleep(retry_after)
            retries += 1
        if status == 403:
            raise HltvUnavailableError(
                status,
                source_url,
                (
                    "HLTV fallback unavailable (HTTP 403) for known player "
                    f"{normalized_id}; no access bypass was attempted"
                ),
            )
        if status != 200:
            raise HltvError(
                status,
                source_url,
                f"HLTV returned HTTP {status} for known player {normalized_id}",
            )
        html = body.decode("utf-8", errors="replace")
        normalized_html = html.casefold()
        challenge_markers = (
            "<title>just a moment",
            "checking your browser before accessing",
            "cf-chl-",
        )
        if any(marker in normalized_html for marker in challenge_markers):
            raise HltvUnavailableError(
                status,
                source_url,
                (
                    "HLTV fallback unavailable because an access challenge "
                    "was returned; no bypass was attempted"
                ),
            )
        parsed = parse_player_profile(html)
        parsed["external_id"] = normalized_id
        parsed["source_url"] = source_url
        return parsed
