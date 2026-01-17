from __future__ import annotations

import argparse
from pathlib import Path

from .apply_overrides import main as apply_overrides_main
from .apply_semantic_tags import main as apply_semantic_tags_main
from .build_groupings import main as build_groupings_main
from .build_outputs import main as build_outputs_main
from .coverage_summary import main as coverage_summary_main
from .extract_backend import main as extract_backend_main
from .extract_details import main as extract_details_main
from .extract_frontend import main as extract_frontend_main
from .extract_git_metadata import main as extract_git_metadata_main
from .link_openapi_schemas import main as link_openapi_schemas_main
from .merge_graphs import main as merge_graphs_main
from .scan_dependencies import main as scan_dependencies_main
from .validate_graph import main as validate_graph_main


def run_step(step_name: str, func) -> None:
    print(f"==> {step_name}")
    func()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run codebase graph pipeline end-to-end.")
    parser.add_argument(
        "--skip-coverage",
        action="store_true",
        help="Skip coverage summary output",
    )
    args = parser.parse_args()

    run_step("extract_frontend", extract_frontend_main)
    run_step("extract_backend", extract_backend_main)
    run_step("merge_graphs", merge_graphs_main)
    run_step("apply_overrides", apply_overrides_main)
    run_step("extract_details", extract_details_main)
    run_step("apply_semantic_tags", apply_semantic_tags_main)
    run_step("link_openapi_schemas", link_openapi_schemas_main)
    run_step("validate_graph", validate_graph_main)
    run_step("build_groupings", build_groupings_main)
    run_step("extract_git_metadata", extract_git_metadata_main)
    run_step("scan_dependencies", scan_dependencies_main)
    run_step("build_outputs", build_outputs_main)
    if not args.skip_coverage:
        run_step("coverage_summary", coverage_summary_main)


if __name__ == "__main__":
    main()
