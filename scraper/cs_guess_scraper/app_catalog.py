"""Transform canonical records into the compact shared game catalog."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pycountry


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    without_marks = "".join(
        character
        for character in normalized
        if not unicodedata.combining(character)
    )
    slug = re.sub(r"[^\w]+", "-", without_marks.casefold(), flags=re.UNICODE)
    return slug.strip("-") or "player"


def _age_on(birth_date: str, today: date) -> int:
    born = date.fromisoformat(birth_date)
    return today.year - born.year - (
        (today.month, today.day) < (born.month, born.day)
    )


def _country_name(country_code: str) -> str:
    normalized = country_code.upper()
    display_overrides = {
        "PS": "Palestine",
    }
    if normalized in display_overrides:
        return display_overrides[normalized]
    country = pycountry.countries.get(alpha_2=normalized)
    return country.name if country is not None else country_code.upper()


def build_app_catalog(
    records: Iterable[Mapping[str, Any]],
    *,
    today: date | None = None,
    previous_catalog: Iterable[Mapping[str, Any]] = (),
) -> list[dict[str, Any]]:
    """Create frontend/server rows while preserving already-issued public IDs."""

    source = list(records)
    previous_by_identity = {
        (
            str(record.get("nickname", "")).casefold(),
            str(record.get("name", "")).casefold(),
            str(record.get("countryCode", "")).upper(),
        ): record
        for record in previous_catalog
        if record.get("id")
    }
    bases = [_slug(str(record["nickname"])) for record in source]
    duplicate_bases = {
        base for base, count in Counter(bases).items() if count > 1
    }
    effective_today = today or datetime.now(timezone.utc).date()
    catalog: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for record, base in zip(source, bases, strict=True):
        full_name = str(record["fullName"])
        country_code = str(record["countryCode"]).upper()
        current_team = record["currentTeam"]
        identity = (
            str(record["nickname"]).casefold(),
            full_name.casefold(),
            country_code,
        )
        previous_record = previous_by_identity.get(identity)
        if not isinstance(current_team, Mapping):
            if previous_record and previous_record.get("team"):
                current_team = {
                    "name": previous_record["team"],
                    "logoUrl": previous_record.get("teamLogoUrl"),
                }
            else:
                raise ValueError(f"{record['nickname']} has no current team")
        previous_id = (
            str(previous_record["id"]) if previous_record is not None else None
        )
        public_id = previous_id if previous_id not in used_ids else None
        if public_id is None and base not in duplicate_bases and base not in used_ids:
            public_id = base
        if public_id is None:
            public_id = "-".join(
                (base, country_code.casefold(), _slug(full_name))
            )
        if public_id in used_ids:
            public_id = "-".join(
                (public_id, _slug(str(record["birthDate"])))
            )
        if public_id in used_ids:
            raise ValueError(
                f"app catalog cannot create a stable unique ID for {record['nickname']}"
            )
        used_ids.add(public_id)
        catalog_record = {
            "id": public_id,
            "nickname": str(record["nickname"]),
            "name": full_name,
            "team": str(current_team["name"]),
            "nationality": _country_name(country_code),
            "countryCode": country_code,
            "age": _age_on(str(record["birthDate"]), effective_today),
            "role": str(record["role"]),
            "majorAppearances": int(record["majorAppearances"]),
            "majorWins": int(record.get("majorWins", 0)),
        }
        team_logo_url = current_team.get("logoUrl")
        if team_logo_url:
            catalog_record["teamLogoUrl"] = str(team_logo_url)
        image_url = record.get("imageUrl") or (
            previous_record.get("imageUrl")
            if previous_record is not None
            else None
        )
        if image_url:
            catalog_record["imageUrl"] = str(image_url)
        catalog.append(catalog_record)
    if len({record["id"] for record in catalog}) != len(catalog):
        raise ValueError("app catalog generated duplicate public player IDs")
    return catalog


def read_previous_catalog(path: Path) -> list[Mapping[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise TypeError("existing app catalog must contain a JSON list")
    return [record for record in payload if isinstance(record, Mapping)]
