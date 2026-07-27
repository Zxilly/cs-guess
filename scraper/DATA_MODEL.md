# CS Guess player data model

## Goals

The scraper merges Liquipedia, PandaScore, BALLDONTLIE CS2, a narrowly scoped
HLTV fallback, and reviewed corrections into one canonical dataset. Provider
payloads are evidence, not the application's data model.

The canonical store is normalized in `schema.sql`. A smaller aggregate is
generated for the game client and server.

## Source responsibilities

| Field | Preferred source | Fallback |
| --- | --- | --- |
| Nickname, real name, birth date, nationality | Liquipedia | PandaScore identity/name, BALLDONTLIE birth date, then HLTV |
| Current team and active roster | PandaScore | BALLDONTLIE, Liquipedia, then HLTV |
| Complete team history | Liquipedia | PandaScore roster history, BALLDONTLIE current tenure, then HLTV |
| Weapon and tactical roles | Liquipedia | Manual review, then HLTV |
| Major event list and appearances | Liquipedia Major Player Database | PandaScore-derived records, then HLTV verification |
| Player image | PandaScore | Liquipedia |

Manual overrides always have the highest priority. Source precedence is
field-specific; one provider never replaces an entire canonical player.

HLTV is only a missing-field fallback for already identified players. It must
not be used for site-wide discovery. Cache every result, keep the source URL,
apply a conservative request rate, and leave `ALLOW_HLTV_FALLBACK=false`
unless its use has been explicitly reviewed.

## Stable identity

`players.id` and `teams.id` are application-owned identifiers. Liquipedia page
names, PandaScore integer IDs, HLTV IDs, Steam IDs, and FACEIT IDs are stored
in the source-ID tables.

Entity matching order:

1. Existing provider ID mapping.
2. Steam64 or another strong platform ID.
3. A unique complementary Liquipedia/PandaScore pair with exact normalized
   real name and independently matching exact birth dates.
4. A one-to-one Liquipedia/PandaScore pair with the same nickname, current
   team, country, conservatively compatible legal-name tokens, and no
   birth-date contradiction.
5. The same one-to-one pair with an exact birth date independently present on
   both sides, even when transliteration exceeds the name-token threshold.
6. A reviewed HLTV profile that triangulates a shortened legal name or a
   Liquipedia nickname alias while confirming the team and country.
7. An explicit provider-ID mapping confirmed by a reviewed third-source
   profile.
8. Nickname plus current team, queued for review.

Step 3 refuses same-provider duplicates and country contradictions, checks all
latest birth-date evidence, and records an
`identity:exact_name_birth_date` decision. Step 4 requires at least two tokens,
permits extra middle/patronymic tokens and
at most one edit per matched token, and records an
`identity:high_confidence_cross_source` decision. All latest provider evidence
is checked for birth-date contradictions before steps 4–5. Step 6 records the
specific triangulation basis. Step 7 records
`identity:reviewed_cross_source` with the external evidence and is replay-safe.
Nickname-only matches are never merged automatically because duplicate and
reused nicknames are common.

Cross-provider IDs supplied by a vendor are hints, not proof. Existing
BALLDONTLIE/PandaScore links are replayed through the same legal-name gate.
Contradictory links have their BALLDONTLIE fields and current-team tenure
detached while the raw source record is retained under an
`identity:quarantined_source` audit decision.

## Team history

Every continuous membership is one `player_team_tenures` row. History is not
stored as a list of team names because names and organizations change.

Important semantics:

- `membership_kind` distinguishes active, benched, loan, stand-in, academy,
  trial, and inactive periods.
- `start_value` and `end_value` accept ISO partial dates such as `2024`,
  `2024-07`, and `2024-07-31`; their precision columns preserve how much the
  source actually knew.
- `is_current` is explicit. A missing end date alone does not prove that a
  membership is current.
- `is_primary` selects the team used by the guessing game when overlapping
  memberships exist.
- Team names shown to users are resolved through `team_id`; comparisons use
  IDs, not display strings.

## Roles

Weapon roles and tactical responsibilities are separate:

- Weapon: `awper`, `rifler`
- Tactical: `igl`, `entry`, `lurker`, `support`

A player may have several current roles. The persisted model never discards
that information. The current four-value game role is derived only when
exporting:

1. `players.game_role_override`, when manually set.
2. Primary `igl`.
3. Primary `awper`.
4. Primary `entry`.
5. `rifler`.

This preserves combinations such as AWPer + IGL while remaining compatible
with the existing UI.

## Major appearances

`major_appearances` contains one row per player and Major. The displayed count
is derived from rows where `counts_toward_total = 1`; it is never hand-edited
on the player.

The importer should normally count entries in Liquipedia's Major Player
Database. `participation_kind`, `matches_played`, and
`counts_toward_total` make substitutes and registered-only players auditable.

## Game aggregate

The frontend and realtime server should consume a generated record shaped like
this:

```ts
type GameRole = "AWPer" | "Rifler" | "IGL" | "Entry";

interface PlayerGameRecord {
  schemaVersion: 1;
  id: string;
  nickname: string;
  fullName: string;
  imageUrl?: string;
  countryCode: string;
  birthDate: string;
  currentTeam: {
    id: string;
    name: string;
    shortName?: string;
  };
  role: GameRole;
  roles: Array<{
    kind: "weapon" | "tactical";
    value: "awper" | "rifler" | "igl" | "entry" | "lurker" | "support";
    primary: boolean;
  }>;
  majorAppearances: number;
  teamHistory: Array<{
    team: {
      id: string;
      name: string;
    };
    kind:
      | "active"
      | "benched"
      | "inactive"
      | "loan"
      | "standin"
      | "academy"
      | "trial"
      | "unknown";
    from?: string;
    fromPrecision: "day" | "month" | "year" | "unknown";
    to?: string;
    toPrecision: "day" | "month" | "year" | "unknown";
    current: boolean;
  }>;
  updatedAt: string;
}
```

Age is calculated from `birthDate` at request/render time. Only records with
complete nickname, real name, country, birth date, current primary team, game
role, and a resolved Major count may set `is_guessable = 1`.

## Merge and audit

Each fetch creates a `source_records` row and retains a payload hash. Selected
canonical fields and rejected alternatives are recorded in `field_evidence`.
Unresolved disagreements create `merge_conflicts` rows instead of silently
overwriting values.

This makes a small HLTV fallback or manual correction removable later without
losing the Liquipedia and PandaScore facts it replaced.
