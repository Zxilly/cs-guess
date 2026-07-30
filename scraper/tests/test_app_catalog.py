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


def test_app_catalog_preserves_searchable_player_aliases():
    [player] = build_app_catalog(
        [
            {
                "id": "internal-machine",
                "nickname": "MachineWJQ",
                "aliases": ["6657", "玩机器", "刘亦博"],
                "fullName": "Liu Yibo",
                "countryCode": "CN",
                "birthDate": "1996-01-11",
                "currentTeam": None,
                "role": "Unknown",
                "majorAppearances": 0,
                "majorWins": 0,
            }
        ],
        today=date(2026, 7, 29),
    )

    assert player["aliases"] == ["6657", "玩机器", "刘亦博"]


def test_app_catalog_exposes_deduplicated_historical_teams_for_near_hints():
    [player] = build_app_catalog(
        [
            {
                "id": "internal-player",
                "nickname": "traveler",
                "fullName": "Team Traveler",
                "countryCode": "DK",
                "birthDate": "2000-01-01",
                "currentTeam": {"name": "Current Team"},
                "teamHistory": [
                    {
                        "team": {"name": "Current Team"},
                        "current": True,
                    },
                    {
                        "team": {"name": "Previous Team"},
                        "current": False,
                    },
                    {
                        "team": {"name": "ex-Previous Team"},
                        "current": False,
                    },
                    {
                        "team": {"name": "previous team"},
                        "current": False,
                    },
                    {
                        "team": {"name": "Another Team (European team)"},
                        "current": False,
                    },
                ],
                "role": "Rifler",
                "majorAppearances": 1,
                "majorWins": 0,
            }
        ],
        today=date(2026, 7, 30),
    )

    assert player["historicalTeams"] == [
        "Previous Team",
        "Another Team",
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


def test_catalog_does_not_promote_a_previous_team_to_current():
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

    assert catalog[0]["team"] == "无队伍"
    assert "teamLogoUrl" not in catalog[0]


def test_catalog_labels_a_player_without_team_as_unattached():
    record = {
        "id": "internal-retired",
        "nickname": "retired",
        "fullName": "Retired Player",
        "countryCode": "SE",
        "birthDate": "1990-01-01",
        "currentTeam": None,
        "role": "Rifler",
        "majorAppearances": 1,
    }

    catalog = build_app_catalog([record], today=date(2026, 7, 27))

    assert catalog[0]["team"] == "无队伍"
    assert "teamLogoUrl" not in catalog[0]


def test_catalog_rejects_undefined_team_names_and_their_logo():
    record = {
        "id": "internal-jedqr",
        "nickname": "jedqr",
        "fullName": "Grzegorz Jędras",
        "countryCode": "PL",
        "birthDate": "1998-11-03",
        "currentTeam": {
            "name": "undefined (American team)",
            "logoUrl": "https://cdn.example/undefined.png",
        },
        "role": "Entry",
        "majorAppearances": 0,
    }

    catalog = build_app_catalog([record], today=date(2026, 7, 28))

    assert catalog[0]["team"] == "无队伍"
    assert "teamLogoUrl" not in catalog[0]


def test_catalog_treats_departed_ex_roster_labels_as_unattached():
    record = {
        "id": "internal-departed",
        "nickname": "departed",
        "fullName": "Departed Player",
        "countryCode": "DK",
        "birthDate": "2000-01-01",
        "currentTeam": {
            "name": "ex-Copenhagen Flames",
            "logoUrl": "https://cdn.example/old-team.png",
        },
        "role": "Rifler",
        "majorAppearances": 1,
    }

    catalog = build_app_catalog([record], today=date(2026, 7, 28))

    assert catalog[0]["team"] == "无队伍"
    assert "teamLogoUrl" not in catalog[0]
