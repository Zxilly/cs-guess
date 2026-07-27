from datetime import date

from cs_guess_scraper.app_catalog import build_app_catalog


def test_app_catalog_derives_age_country_name_and_stable_public_fields():
    catalog = build_app_catalog(
        [
            {
                "id": "internal-random-id",
                "nickname": "ZywOo",
                "fullName": "Mathieu Herbaut",
                "countryCode": "FR",
                "birthDate": "2000-11-09",
                "imageUrl": "https://cdn.example/zywoo.png",
                "currentTeam": {
                    "id": "team-id",
                    "name": "Team Vitality",
                    "logoUrl": "https://cdn.example/vitality.png",
                },
                "role": "AWPer",
                "majorAppearances": 11,
                "majorWins": 2,
            }
        ],
        today=date(2026, 7, 27),
    )

    assert catalog == [
        {
            "id": "zywoo",
            "nickname": "ZywOo",
            "name": "Mathieu Herbaut",
            "team": "Team Vitality",
            "teamLogoUrl": "https://cdn.example/vitality.png",
            "imageUrl": "https://cdn.example/zywoo.png",
            "nationality": "France",
            "countryCode": "FR",
            "age": 25,
            "role": "AWPer",
            "majorAppearances": 11,
            "majorWins": 2,
        }
    ]


def test_duplicate_nicknames_receive_deterministic_disambiguated_ids():
    records = [
        {
            "id": "first-random",
            "nickname": "mds",
            "fullName": "First Player",
            "countryCode": "BR",
            "birthDate": "2000-01-01",
            "currentTeam": {"name": "Alpha"},
            "role": "Rifler",
            "majorAppearances": 0,
        },
        {
            "id": "second-random",
            "nickname": "mds",
            "fullName": "Second Player",
            "countryCode": "PT",
            "birthDate": "2001-01-01",
            "currentTeam": {"name": "Beta"},
            "role": "Rifler",
            "majorAppearances": 0,
        },
    ]

    catalog = build_app_catalog(records, today=date(2026, 7, 27))

    assert [item["id"] for item in catalog] == [
        "mds-br-first-player",
        "mds-pt-second-player",
    ]


def test_catalog_uses_a_human_country_label_for_palestine():
    record = {
        "id": "internal-0samas",
        "nickname": "0SAMAS",
        "fullName": "Osama Orabi",
        "countryCode": "PS",
        "birthDate": "2002-04-10",
        "currentTeam": {"name": "JiJieHao"},
        "role": "Rifler",
        "majorAppearances": 0,
    }

    catalog = build_app_catalog([record], today=date(2026, 7, 27))

    assert catalog[0]["nationality"] == "Palestine"


def test_existing_player_id_stays_stable_when_a_duplicate_nickname_is_added():
    existing = {
        "id": "mds",
        "nickname": "mds",
        "name": "First Player",
        "countryCode": "BR",
    }
    records = [
        {
            "id": "first-random",
            "nickname": "mds",
            "fullName": "First Player",
            "countryCode": "BR",
            "birthDate": "2000-01-01",
            "currentTeam": {"name": "Alpha"},
            "role": "Rifler",
            "majorAppearances": 0,
        },
        {
            "id": "second-random",
            "nickname": "mds",
            "fullName": "Second Player",
            "countryCode": "PT",
            "birthDate": "2001-01-01",
            "currentTeam": {"name": "Beta"},
            "role": "Rifler",
            "majorAppearances": 0,
        },
    ]

    catalog = build_app_catalog(
        records,
        today=date(2026, 7, 27),
        previous_catalog=[existing],
    )

    assert [item["id"] for item in catalog] == [
        "mds",
        "mds-pt-second-player",
    ]


def test_catalog_preserves_last_confirmed_team_when_current_team_is_missing():
    record = {
        "id": "internal-player",
        "nickname": "steady",
        "fullName": "Stable Player",
        "countryCode": "SE",
        "birthDate": "2000-01-01",
        "currentTeam": None,
        "role": "Rifler",
        "majorAppearances": 1,
    }
    previous = {
        "id": "steady",
        "nickname": "steady",
        "name": "Stable Player",
        "countryCode": "SE",
        "team": "Confirmed Team",
        "teamLogoUrl": "https://cdn.example/confirmed.png",
    }

    catalog = build_app_catalog(
        [record],
        today=date(2026, 7, 27),
        previous_catalog=[previous],
    )

    assert catalog[0]["team"] == "Confirmed Team"
    assert catalog[0]["teamLogoUrl"] == "https://cdn.example/confirmed.png"
