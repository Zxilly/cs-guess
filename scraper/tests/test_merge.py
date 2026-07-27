from cs_guess_scraper.merge import (
    choose_display_casing,
    person_name_tokens_compatible,
    team_name_identity_signature,
)


def test_person_name_tokens_allow_omitted_middle_names() -> None:
    assert person_name_tokens_compatible(
        "Gabriel Toledo",
        "Gabriel Toledo de Alcântara Sguario",
    )


def test_person_name_tokens_allow_one_character_transliteration_difference() -> None:
    assert person_name_tokens_compatible(
        "Aleksandr Kostyliev",
        "Oleksandr Olehovych Kostyliev",
    )


def test_person_name_tokens_reject_two_character_difference() -> None:
    assert not person_name_tokens_compatible("Jon Smith", "Ian Smith")


def test_team_signature_ignores_only_generic_trailing_descriptors() -> None:
    assert team_name_identity_signature(
        "Lynn Vision Gaming"
    ) == team_name_identity_signature("lynn vision")
    assert team_name_identity_signature("Legacy Esports") == ("legacy",)
    assert team_name_identity_signature(
        "Denial E-Sports"
    ) == team_name_identity_signature("Denial")
    assert team_name_identity_signature(
        "Team Liquid"
    ) == team_name_identity_signature("Liquid")
    assert team_name_identity_signature(
        "9z Team"
    ) == team_name_identity_signature("9z")
    assert team_name_identity_signature(
        "FaZe Clan"
    ) == team_name_identity_signature("FaZe")


def test_team_signature_preserves_roster_qualifiers() -> None:
    assert team_name_identity_signature("Spirit Academy") != (
        team_name_identity_signature("Spirit")
    )
    assert team_name_identity_signature("Falcons Vega") != (
        team_name_identity_signature("Falcons")
    )


def test_display_casing_upgrades_provider_slugs_without_renaming() -> None:
    evidence = [
        {"value": "eternal fire"},
        {"value": "Eternal Fire"},
        {"value": "ETERNAL FIRE"},
    ]
    assert choose_display_casing("eternal fire", evidence) == "Eternal Fire"
    assert choose_display_casing(
        "mibr",
        [{"value": "mibr"}, {"value": "MIBR"}],
    ) == "MIBR"


def test_display_casing_does_not_change_semantic_team_name() -> None:
    assert choose_display_casing(
        "Lynn Vision Gaming",
        [{"value": "lynn vision"}, {"value": "Lynn Vision Gaming"}],
    ) == "Lynn Vision Gaming"
