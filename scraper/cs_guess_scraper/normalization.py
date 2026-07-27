from __future__ import annotations

import pycountry


_COUNTRY_ALIASES = {
    "bosnia": "BA",
    "bolivia": "BO",
    "brunei": "BN",
    "cape verde": "CV",
    "czech republic": "CZ",
    "iran": "IR",
    "kosovo": "XK",
    "macedonia": "MK",
    "moldova": "MD",
    "north korea": "KP",
    "palestine": "PS",
    "russia": "RU",
    "south korea": "KR",
    "syria": "SY",
    "taiwan": "TW",
    "tanzania": "TZ",
    "turkey": "TR",
    "türkiye": "TR",
    "united states": "US",
    "venezuela": "VE",
    "vietnam": "VN",
}


def normalize_country_code(raw: str | None) -> str | None:
    if raw is None:
        return None

    value = raw.strip()
    if not value:
        return None

    if len(value) == 2:
        code = value.upper()
        if code == "XK" or pycountry.countries.get(alpha_2=code):
            return code

    alias = _COUNTRY_ALIASES.get(value.casefold())
    if alias:
        return alias

    try:
        country = pycountry.countries.lookup(value)
    except LookupError:
        return None
    return country.alpha_2
