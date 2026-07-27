from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from typing import Any

DEFAULT_SOURCE_PRIORITY = (
    "manual",
    "liquipedia",
    "bo3",
    "balldontlie",
    "pandascore",
    "hltv",
)

FIELD_SOURCE_PRIORITIES: dict[str, tuple[str, ...]] = {
    # HLTV renders human-facing team capitalization more consistently than
    # provider slugs such as "vitality" or "spirit".
    "canonical_name": (
        "manual",
        "hltv",
        "liquipedia",
        "bo3",
        "balldontlie",
        "pandascore",
    ),
    "nickname": DEFAULT_SOURCE_PRIORITY,
    # BALLDONTLIE's cross-provider record occasionally contains a legal name
    # from a different person; prefer the directly linked PandaScore identity.
    "full_name": (
        "manual",
        "liquipedia",
        "pandascore",
        "bo3",
        "balldontlie",
        "hltv",
    ),
    "birth_date": DEFAULT_SOURCE_PRIORITY,
    "country_code": DEFAULT_SOURCE_PRIORITY,
    "status": (
        "manual",
        "pandascore",
        "bo3",
        "balldontlie",
        "liquipedia",
        "hltv",
    ),
    "is_coach": ("manual", "bo3"),
    "image_url": ("manual", "pandascore", "bo3", "liquipedia", "hltv"),
    "current_team_id": (
        "manual",
        "pandascore",
        "bo3",
        "balldontlie",
        "liquipedia",
        "hltv",
    ),
    "role": ("manual", "liquipedia", "hltv", "bo3", "pandascore"),
    "major_appearance": ("manual", "liquipedia", "pandascore", "hltv"),
}


def normalize_identity_text(value: str | None) -> str:
    """Normalize identity text without erasing meaningful nickname characters."""
    return " ".join((value or "").strip().casefold().split())


def choose_display_casing(
    selected_value: str,
    evidence: Iterable[Mapping[str, Any]],
) -> str:
    """Improve casing from equivalent evidence without changing the name."""
    normalized_selected = normalize_identity_text(selected_value)

    def casing_score(value: str) -> int:
        letters = [character for character in value if character.isalpha()]
        alphanumeric_count = sum(character.isalnum() for character in value)
        if not letters:
            return 1
        if all(character.isupper() for character in letters):
            return 0 if alphanumeric_count <= 5 else 2
        words = re.findall(r"[^\W_]+", value, flags=re.UNICODE)
        if words and all(
            not any(character.isalpha() for character in word)
            or (
                next(
                    character
                    for character in word
                    if character.isalpha()
                ).isupper()
                and "".join(
                    character
                    for character in word[1:]
                    if character.isalpha()
                ).islower()
            )
            for word in words
        ):
            return 0
        if all(character.islower() for character in letters):
            return 3
        return 1

    candidates = [
        str(item["value"])
        for item in evidence
        if item.get("value") is not None
        and normalize_identity_text(str(item["value"]))
        == normalized_selected
    ]
    candidates.append(selected_value)
    return min(
        candidates,
        key=lambda value: (
            casing_score(value),
            value.casefold(),
            value,
        ),
    )


def team_name_identity_signature(value: str | None) -> tuple[str, ...]:
    """Return a conservative team-name signature for cross-source identity.

    Providers commonly append a generic ``Gaming`` or ``Esports`` suffix to
    the same organization. Only trailing generic descriptors are removed;
    meaningful roster qualifiers such as ``Academy``, ``NXT`` or ``Vega`` stay
    in the signature and therefore cannot be merged by this rule.
    """
    decomposed = unicodedata.normalize("NFKD", value or "")
    characters = []
    for character in decomposed:
        if unicodedata.combining(character):
            continue
        characters.append(character.casefold() if character.isalnum() else " ")
    tokens = "".join(characters).split()
    if len(tokens) > 1 and tokens[0] == "team":
        tokens = tokens[1:]
    while len(tokens) > 1:
        if tokens[-1] in {
            "clan",
            "esport",
            "esports",
            "gaming",
            "team",
        }:
            tokens.pop()
            continue
        if len(tokens) > 2 and tokens[-2:] in (
            ["e", "sport"],
            ["e", "sports"],
        ):
            tokens = tokens[:-2]
            continue
        break
    return tuple(tokens)


def person_name_token_signature(value: str | None) -> tuple[str, ...]:
    """Return accent-insensitive name tokens, ignoring only token order.

    This intentionally does not use fuzzy spelling. It supports the common
    family-name/given-name ordering difference without treating similar names
    as the same person.
    """
    decomposed = unicodedata.normalize("NFKD", value or "")
    characters = []
    for character in decomposed:
        if unicodedata.combining(character):
            continue
        characters.append(character.casefold() if character.isalnum() else " ")
    return tuple(sorted("".join(characters).split()))


def primary_person_name(value: str | None) -> str | None:
    """Return the first display name from an HTML-break-separated alias list."""
    cleaned = re.split(
        r"<br\s*/?>",
        value or "",
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()
    return cleaned or None


def person_name_tokens_compatible(
    first: str | None,
    second: str | None,
) -> bool:
    """Match legal-name tokens one-to-one, allowing one edit per token."""
    first_tokens = person_name_token_signature(first)
    second_tokens = person_name_token_signature(second)
    if len(first_tokens) < 2 or len(second_tokens) < 2:
        return False

    shorter, longer = sorted(
        (first_tokens, second_tokens),
        key=len,
    )

    def within_one_edit(left: str, right: str) -> bool:
        if left == right:
            return True
        if abs(len(left) - len(right)) > 1:
            return False
        if len(left) == len(right):
            return sum(a != b for a, b in zip(left, right)) == 1
        short, long = (left, right) if len(left) < len(right) else (right, left)
        index_short = 0
        index_long = 0
        edits = 0
        while index_short < len(short) and index_long < len(long):
            if short[index_short] == long[index_long]:
                index_short += 1
            else:
                edits += 1
                if edits > 1:
                    return False
            index_long += 1
        return True

    def match(index: int, remaining: tuple[str, ...]) -> bool:
        if index == len(shorter):
            return True
        for candidate_index, candidate in enumerate(remaining):
            if within_one_edit(shorter[index], candidate) and match(
                index + 1,
                remaining[:candidate_index] + remaining[candidate_index + 1 :],
            ):
                return True
        return False

    return match(0, longer)


def choose_evidence(
    field_name: str,
    evidence: Iterable[Mapping[str, Any]],
) -> tuple[Mapping[str, Any] | None, list[dict[str, Any]]]:
    """Select a candidate by field-specific source priority, then recency.

    The caller supplies at most the latest observation for each provider. The
    returned candidate list is JSON-serializable and intentionally retains
    alternatives for audit.
    """
    candidates = [row for row in evidence if row.get("value") is not None]
    if not candidates:
        return None, []

    priority = FIELD_SOURCE_PRIORITIES.get(field_name, DEFAULT_SOURCE_PRIORITY)
    ranks = {source: index for index, source in enumerate(priority)}
    selected = min(
        candidates,
        key=lambda row: (
            ranks.get(str(row.get("source")), len(ranks)),
            -float(row.get("confidence", 1.0)),
            str(row.get("source")),
        ),
    )
    audit_candidates = [
        {
            "source": str(row["source"]),
            "value": row["value"],
            "observed_at": row.get("observed_at"),
            "confidence": float(row.get("confidence", 1.0)),
        }
        for row in sorted(
            candidates,
            key=lambda row: (
                ranks.get(str(row.get("source")), len(ranks)),
                str(row.get("source")),
            ),
        )
    ]
    return selected, audit_candidates


def derive_game_role(
    override: str | None,
    roles: Iterable[Mapping[str, Any]],
) -> str | None:
    labels = {
        "awper": "AWPer",
        "rifler": "Rifler",
        "igl": "IGL",
        "entry": "Entry",
    }
    if override:
        return labels.get(override)

    current = [row for row in roles if row.get("valid_to") is None]
    for role_name in ("igl", "awper", "entry", "rifler"):
        if any(
            row.get("role") == role_name and bool(row.get("is_primary"))
            for row in current
        ):
            return labels[role_name]
    if any(row.get("role") == "rifler" for row in current):
        return "Rifler"
    return None
