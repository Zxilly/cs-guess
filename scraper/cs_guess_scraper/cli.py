"""Command-line interface for the CS Guess player data pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from .app_catalog import build_app_catalog, read_previous_catalog
from .balldontlie import BallDontLieClient
from .bo3 import Bo3Client
from .config import Settings, SettingsError
from .hltv import HltvClient, HltvError, known_profile_mismatches
from .liquipedia import LiquipediaClient
from .pandascore import PandaScoreClient
from .pipeline import _write_json, run_sync
from .store import PlayerStore


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cs-guess-scraper",
        description="Collect, merge, audit, and export Counter-Strike players.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync = subparsers.add_parser("sync", help="fetch and merge source data")
    sync.add_argument("--db", type=Path, default=Path("data/cs_guess.sqlite"))
    sync.add_argument(
        "--output",
        type=Path,
        default=Path("data/players.game.json"),
    )
    sync.add_argument(
        "--report",
        type=Path,
        default=Path("data/sync-report.json"),
    )
    sync.add_argument(
        "--catalog-output",
        type=Path,
        help="optional compact JSON shared by the frontend and game server",
    )
    sync.add_argument(
        "--reviewed-major-winners",
        type=Path,
        help="optional reviewed Major winner corrections",
    )
    sync.add_argument(
        "--reviewed-major-appearances",
        type=Path,
        help="optional reviewed Major roster corrections",
    )
    sync.add_argument(
        "--reviewed-identity-merges",
        type=Path,
        help="optional reviewed cross-source identity mappings",
    )
    sync.add_argument(
        "--reviewed-source-quarantines",
        type=Path,
        help="optional reviewed provider records to detach",
    )
    sync.add_argument(
        "--reviewed-identity-separations",
        type=Path,
        help="optional reviewed identity pairs to keep separate",
    )
    sync.add_argument(
        "--source",
        choices=("all", "liquipedia", "pandascore", "balldontlie", "bo3"),
        default="all",
    )
    sync.add_argument(
        "--env-file",
        type=Path,
        help="environment file; otherwise discover .env from the current path",
    )
    sync.add_argument(
        "--limit",
        type=_positive_int,
        help="smoke-test limit per selected source; omit for a full sync",
    )
    sync.add_argument(
        "--skip-majors",
        action="store_true",
        help="skip Liquipedia's Major player database",
    )
    sync.add_argument(
        "--liquipedia-min-interval",
        type=float,
        default=2.0,
    )
    sync.add_argument(
        "--pandascore-min-interval",
        type=float,
        default=0.1,
    )
    sync.add_argument(
        "--balldontlie-min-interval",
        type=float,
        default=12.1,
    )
    sync.add_argument(
        "--bo3-min-interval",
        type=float,
        default=0.25,
    )

    audit = subparsers.add_parser("audit", help="inspect database coverage")
    audit.add_argument("--db", type=Path, default=Path("data/cs_guess.sqlite"))
    audit.add_argument("--player-id")

    quality = subparsers.add_parser(
        "quality",
        help="validate canonical data and report non-blocking coverage gaps",
    )
    quality.add_argument(
        "--db",
        type=Path,
        default=Path("data/cs_guess.sqlite"),
    )
    quality.add_argument("--output", type=Path)
    quality.add_argument(
        "--fail-on-critical",
        action="store_true",
        help="exit with status 1 when integrity failures are present",
    )

    export = subparsers.add_parser("export", help="export game records")
    export.add_argument("--db", type=Path, default=Path("data/cs_guess.sqlite"))
    export.add_argument(
        "--output",
        type=Path,
        default=Path("data/players.game.json"),
    )
    export.add_argument(
        "--catalog-output",
        type=Path,
        help="optional compact JSON shared by the frontend and game server",
    )
    export.add_argument(
        "--reviewed-major-winners",
        type=Path,
        help="optional reviewed Major winner corrections",
    )
    export.add_argument(
        "--reviewed-major-appearances",
        type=Path,
        help="optional reviewed Major roster corrections",
    )
    export.add_argument(
        "--include-incomplete",
        action="store_true",
        help="include records that are not yet eligible for the game",
    )

    merge_reviewed = subparsers.add_parser(
        "merge-reviewed",
        help="apply an explicitly reviewed JSON list of identity mappings",
    )
    merge_reviewed.add_argument(
        "--db",
        type=Path,
        default=Path("data/cs_guess.sqlite"),
    )
    merge_reviewed.add_argument("--mappings", type=Path, required=True)
    merge_reviewed.add_argument(
        "--quarantines",
        type=Path,
        help="optional reviewed provider records to detach before merging",
    )
    merge_reviewed.add_argument(
        "--separations",
        type=Path,
        help="optional reviewed same-nickname pairs to keep separate",
    )

    hltv = subparsers.add_parser(
        "hltv",
        help="fetch one explicitly identified HLTV fallback profile",
    )
    hltv.add_argument("--db", type=Path, default=Path("data/cs_guess.sqlite"))
    hltv.add_argument("--env-file", type=Path)
    hltv.add_argument("--id", dest="hltv_id", required=True)
    hltv.add_argument("--slug", required=True)
    hltv.add_argument(
        "--match-source",
        choices=("liquipedia", "pandascore"),
        required=True,
    )
    hltv.add_argument("--match-external-id", required=True)

    hltv_batch = subparsers.add_parser(
        "hltv-batch",
        help="fetch a reviewed JSON list of known HLTV player profiles",
    )
    hltv_batch.add_argument(
        "--db",
        type=Path,
        default=Path("data/cs_guess.sqlite"),
    )
    hltv_batch.add_argument("--env-file", type=Path)
    hltv_batch.add_argument("--targets", type=Path, required=True)
    return parser


def _print_json(value: object) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _read_reviewed_major_winners(
    path: Path | None,
) -> list[dict[str, object]]:
    if path is None:
        return []
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, list) or not all(
        isinstance(item, dict) for item in loaded
    ):
        raise ValueError(
            "reviewed Major winners file must contain a JSON list of objects"
        )
    return loaded


def _read_reviewed_major_appearances(
    path: Path | None,
) -> list[dict[str, object]]:
    if path is None:
        return []
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, list) or not all(
        isinstance(item, dict) for item in loaded
    ):
        raise ValueError(
            "reviewed Major appearances file must contain a JSON list "
            "of objects"
        )
    return loaded


def _read_object_list(
    path: Path | None,
    *,
    label: str,
) -> list[dict[str, object]]:
    if path is None:
        return []
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, list) or not all(
        isinstance(item, dict) for item in loaded
    ):
        raise ValueError(f"{label} file must contain a JSON list of objects")
    return loaded


def _ingest_known_hltv_profile(
    store: PlayerStore,
    client: HltvClient,
    target: dict[str, object],
) -> str:
    hltv_id = str(target["hltv_id"])
    slug = str(target["slug"])
    match_source = str(target["match_source"])
    match_external_id = str(target["match_external_id"])
    if match_source not in {"liquipedia", "pandascore"}:
        raise ValueError("match_source must be liquipedia or pandascore")
    player_id = store.resolve_player_id(match_source, match_external_id)
    player = store.connection.execute(
        """
        SELECT canonical_nickname, full_name, country_code
        FROM players WHERE id = ?
        """,
        (player_id,),
    ).fetchone()
    if player is None:
        raise ValueError(f"canonical player not found: {player_id}")

    parsed = client.fetch_player(hltv_id, slug)
    mismatches = known_profile_mismatches(
        parsed,
        canonical_nickname=str(player["canonical_nickname"]),
        canonical_full_name=player["full_name"],
        canonical_country_code=player["country_code"],
        match_external_id=match_external_id,
    )
    if mismatches:
        raise ValueError(
            "HLTV profile contradicts the known player on: "
            + ", ".join(mismatches)
        )
    store.link_source_player(
        player_id,
        "hltv",
        hltv_id,
        source_url=str(parsed.get("source_url") or ""),
    )
    store.upsert_source_player(
        "hltv",
        parsed,
        {
            "source_url": parsed.get("source_url"),
            "payload": parsed,
        },
    )
    return player_id


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "audit":
        with PlayerStore(args.db) as store:
            _print_json(store.audit(args.player_id))
        return 0

    if args.command == "quality":
        with PlayerStore(args.db) as store:
            report = store.data_quality_report()
        if args.output is not None:
            _write_json(args.output, report)
        _print_json(report)
        if args.fail_on_critical and report["criticalIssues"]:
            return 1
        return 0

    if args.command == "export":
        reviewed_major_winners = _read_reviewed_major_winners(
            args.reviewed_major_winners
        )
        reviewed_major_appearances = _read_reviewed_major_appearances(
            args.reviewed_major_appearances
        )
        with PlayerStore(args.db) as store:
            reviewed = (
                store.apply_reviewed_major_winners(reviewed_major_winners)
                if reviewed_major_winners
                else {"events": 0, "appearances": 0}
            )
            reviewed_appearances = (
                store.apply_reviewed_major_appearances(
                    reviewed_major_appearances
                )
                if reviewed_major_appearances
                else {"reviewed": 0, "created": 0, "updated": 0}
            )
            records = store.export_game_records(
                guessable_only=not args.include_incomplete
            )
            catalog_records = (
                store.export_game_records()
                if args.catalog_output is not None
                else []
            )
        _write_json(args.output, records)
        if args.catalog_output is not None:
            _write_json(
                args.catalog_output,
                build_app_catalog(
                    catalog_records,
                    previous_catalog=read_previous_catalog(
                        args.catalog_output
                    ),
                ),
            )
        _print_json(
            {
                "output": str(args.output.resolve()),
                "exportedRecords": len(records),
                "catalogRecords": len(catalog_records),
                "reviewedMajorWinners": reviewed,
                "reviewedMajorAppearances": reviewed_appearances,
            }
        )
        return 0

    if args.command == "merge-reviewed":
        raw_mappings = json.loads(args.mappings.read_text(encoding="utf-8"))
        if not isinstance(raw_mappings, list) or not all(
            isinstance(mapping, dict) for mapping in raw_mappings
        ):
            raise ValueError(
                "reviewed identity mappings file must contain a JSON list "
                "of objects"
            )
        raw_quarantines: list[dict[str, object]] = []
        if args.quarantines is not None:
            loaded_quarantines = json.loads(
                args.quarantines.read_text(encoding="utf-8")
            )
            if not isinstance(loaded_quarantines, list) or not all(
                isinstance(quarantine, dict)
                for quarantine in loaded_quarantines
            ):
                raise ValueError(
                    "reviewed source quarantines file must contain a JSON "
                    "list of objects"
                )
            raw_quarantines = loaded_quarantines
        raw_separations: list[dict[str, object]] = []
        if args.separations is not None:
            loaded_separations = json.loads(
                args.separations.read_text(encoding="utf-8")
            )
            if not isinstance(loaded_separations, list) or not all(
                isinstance(separation, dict)
                for separation in loaded_separations
            ):
                raise ValueError(
                    "reviewed identity separations file must contain a JSON "
                    "list of objects"
                )
            raw_separations = loaded_separations
        with PlayerStore(args.db) as store:
            inconsistent = (
                store.quarantine_inconsistent_balldontlie_identities()
            )
            quarantined = store.apply_reviewed_source_quarantines(
                raw_quarantines
            )
            reviewed = store.apply_reviewed_identity_merges(raw_mappings)
            separated = store.apply_reviewed_identity_separations(
                raw_separations
            )
            merge = store.merge_all()
        _print_json(
            {
                "inconsistentBallDontLie": inconsistent,
                "quarantines": quarantined,
                "reviewed": reviewed,
                "separations": separated,
                "merge": merge,
            }
        )
        return 0

    settings = (
        Settings.from_env_file(args.env_file)
        if args.env_file
        else Settings.discover()
    )
    if (
        args.command in {"hltv", "hltv-batch"}
        and not settings.allow_hltv_fallback
    ):
        raise SettingsError(
            "HLTV fallback is disabled; explicitly enable it in .env "
            "only after reviewing the known target"
        )
    if args.command == "hltv":
        with PlayerStore(args.db) as store:
            player_id = _ingest_known_hltv_profile(
                store,
                HltvClient(),
                {
                    "hltv_id": args.hltv_id,
                    "slug": args.slug,
                    "match_source": args.match_source,
                    "match_external_id": args.match_external_id,
                },
            )
            store.merge_all()
            report = store.audit(player_id)
        _print_json(report)
        return 0
    if args.command == "hltv-batch":
        raw_targets = json.loads(args.targets.read_text(encoding="utf-8"))
        if not isinstance(raw_targets, list):
            raise ValueError("HLTV targets file must contain a JSON list")
        results = []
        client = HltvClient()
        with PlayerStore(args.db) as store:
            for raw_target in raw_targets:
                if not isinstance(raw_target, dict):
                    results.append(
                        {
                            "status": "failed",
                            "error": "target must be an object",
                        }
                    )
                    continue
                target = dict(raw_target)
                try:
                    player_id = _ingest_known_hltv_profile(
                        store,
                        client,
                        target,
                    )
                except (HltvError, KeyError, TypeError, ValueError) as error:
                    results.append(
                        {
                            "hltv_id": target.get("hltv_id"),
                            "slug": target.get("slug"),
                            "status": "failed",
                            "error": str(error),
                        }
                    )
                else:
                    results.append(
                        {
                            "hltv_id": target["hltv_id"],
                            "slug": target["slug"],
                            "player_id": player_id,
                            "status": "fetched",
                        }
                    )
            merge = store.merge_all()
        fetched = sum(item["status"] == "fetched" for item in results)
        _print_json(
            {
                "fetched": fetched,
                "failed": len(results) - fetched,
                "targets": results,
                "merge": merge,
            }
        )
        return 0

    use_liquipedia = args.source in {"all", "liquipedia"}
    use_pandascore = args.source in {"all", "pandascore"}
    use_balldontlie = args.source == "balldontlie" or (
        args.source == "all"
        and settings.balldontlie_api_token is not None
    )
    use_bo3 = args.source in {"all", "bo3"}
    if args.source == "balldontlie" and not settings.balldontlie_api_token:
        raise SettingsError(
            "BALLDONTLIE_API_TOKEN is required for this source"
        )
    liquipedia = (
        LiquipediaClient(
            settings.liquipedia_user_agent,
            min_interval=args.liquipedia_min_interval,
        )
        if use_liquipedia
        else None
    )
    pandascore = (
        PandaScoreClient(
            settings.pandascore_api_token,
            min_interval=args.pandascore_min_interval,
        )
        if use_pandascore
        else None
    )
    balldontlie = (
        BallDontLieClient(
            settings.balldontlie_api_token or "",
            min_interval=args.balldontlie_min_interval,
        )
        if use_balldontlie
        else None
    )
    bo3 = (
        Bo3Client(
            min_interval=args.bo3_min_interval,
            user_agent=settings.liquipedia_user_agent,
        )
        if use_bo3
        else None
    )
    args.db.parent.mkdir(parents=True, exist_ok=True)
    reviewed_major_winners = _read_reviewed_major_winners(
        args.reviewed_major_winners
    )
    reviewed_major_appearances = _read_reviewed_major_appearances(
        args.reviewed_major_appearances
    )
    reviewed_identity_merges = _read_object_list(
        args.reviewed_identity_merges,
        label="reviewed identity mappings",
    )
    reviewed_source_quarantines = _read_object_list(
        args.reviewed_source_quarantines,
        label="reviewed source quarantines",
    )
    reviewed_identity_separations = _read_object_list(
        args.reviewed_identity_separations,
        label="reviewed identity separations",
    )
    with PlayerStore(args.db) as store:
        report = run_sync(
            store,
            liquipedia_client=liquipedia,
            pandascore_client=pandascore,
            balldontlie_client=balldontlie,
            bo3_client=bo3,
            limit=args.limit,
            include_majors=not args.skip_majors,
            output_path=args.output,
            catalog_output_path=args.catalog_output,
            report_path=args.report,
            reviewed_identity_merges=reviewed_identity_merges,
            reviewed_source_quarantines=reviewed_source_quarantines,
            reviewed_identity_separations=reviewed_identity_separations,
            reviewed_major_winners=reviewed_major_winners,
            reviewed_major_appearances=reviewed_major_appearances,
            progress=lambda message: print(message, file=sys.stderr, flush=True),
        )
    _print_json(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
