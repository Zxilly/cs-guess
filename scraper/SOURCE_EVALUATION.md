# Counter-Strike player source evaluation

Updated: 2026-07-27

## Recommended source order

| Priority | Source | Useful fields | Access | Intended use |
| --- | --- | --- | --- | --- |
| 1 | Liquipedia MediaWiki | Biography, exact/partial birth date, nationality, roles, transfers, Major participation, Steam/FACEIT IDs | Identifying User-Agent | Primary biography and team-history source |
| 2 | PandaScore | Broad player coverage, current roster, images, activity | API token | Broad discovery and current-state source |
| 3 | BALLDONTLIE CS2 | Full name, current team, active state, exact birthday | API key; players are in the free tier at 5 requests/minute | Best next source for filling exact birth dates |
| 4 | HLTV known profiles | Biography cross-check, current team, month-precision team history, Major total | Targeted known IDs only; discovery pages may deny access | Third-source verification and targeted gaps |
| 5 | FACEIT Data API | FACEIT ID, Steam64/game ID, nickname, country, avatar, match/team participation | Developer API key | Strong identity confirmation; not a birth-date source |
| 6 | GRID Open Access | Official match telemetry and player/team performance | Application for free access | Match/stat verification, not core biography |
| 7 | Abios | Players, teams, tournaments, schedules and official feeds for some competitions | Commercial access | Paid operational fallback |

## Secondary discovery sources

- [CS API](https://www.csapi.de/) is free and publishes current teams,
  players, rosters and statistics for roughly the top-100-team ecosystem. Its
  own documentation says the data is scraped from HLTV and that the project is
  unaffiliated, so it must not count as an independent confirming source. It
  may be used to propose HLTV IDs for review.
- [bo3.gg](https://bo3.gg/) visibly publishes player biography, role and
  transfer pages, but no supported public API was found. Do not add a broad
  scraper until its terms and stable access method are reviewed.

## Merge policy

Automatic player identity merges are intentionally narrower than general fuzzy
search:

1. exactly one Liquipedia record and one PandaScore record;
2. same normalized nickname and conservative current-team signature; the
   signature ignores a leading/trailing generic `Team` and trailing `Gaming`,
   `Esport`, `Esports`, `E-Sports` or `Clan` descriptors, while retaining
   roster qualifiers such as `Academy`, `NXT`, `Vega` and `Female`;
3. equal non-empty country;
4. compatible accent-insensitive legal-name tokens: at least two tokens on
   each side, one-to-one matching, optional additional middle/patronymic
   tokens, and at most one insertion/deletion/substitution per matched token;
5. no conflicting non-empty birth-date evidence from any provider.

If both sides independently provide the same exact birth date, nickname,
current team and country may establish the identity even when transliterated
legal-name tokens exceed the one-edit threshold. This decision is recorded
with `match_basis=exact_birth_date`.

Every automatic decision is retained as
`identity:high_confidence_cross_source` evidence. Edit distance 2, single-token
names, country disagreements and same-provider duplicates stay open for review.
A reviewed HLTV profile may independently resolve exceptional legal-name or
country fields; those mappings are stored by provider ID and recorded as
`identity:reviewed_cross_source`. A reviewed Liquipedia page alias may likewise
bridge a nickname styling difference such as `dev1ce`/`device`. When the
providers disagree on a verified birth date, nationality or coach flag, the
reviewed mapping may add a replayable `manual` field override; rebuilding the
database therefore produces the same canonical result.

Confirmed same-nickname false positives are stored separately in
`identity-separations.reviewed.json`. The review queue excludes those exact
provider pairs without weakening the automatic merge rules for new records.

HLTV targets additionally have to match the known nickname or provider alias,
have compatible legal-name tokens, and not contradict the known country before
an HLTV ID can be linked.

Normalized team names are candidate aliases, not sufficient proof by
themselves. Display casing, short names and logos are shared only when at least
one merged player has tenures under both team IDs. This prevents unrelated
same-name organizations from borrowing each other's branding.

## Access blockers

- BALLDONTLIE is integrated as an enrichment source. Sparse/unmatched accounts
  are not added as new canonical players: its observed cross-provider ID must
  resolve to an existing PandaScore player. If both providers expose legal
  names they must be exact or conservatively token-compatible; a nickname
  match cannot override a contradictory legal name. Existing links are
  revalidated by the same rule, and failures are quarantined without deleting
  the raw source record.
- FACEIT requires a developer key. Existing Liquipedia records already expose
  thousands of FACEIT and Steam IDs, so this integration would mainly improve
  identity confidence.
- GRID requires an application. It is authoritative for match telemetry but
  does not replace a biography/transfer source.
- HLTV broad discovery returned HTTP 403 during verification. The pipeline
  does not bypass access controls and fetches only reviewed profile URLs with
  at least five seconds between live requests.
