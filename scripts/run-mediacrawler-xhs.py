"""Run MediaCrawler with a low-frequency, single-session browsing interval.

The upstream CLI exposes note count and concurrency but not its page/detail
sleep interval. Set that existing config before executing upstream main.py so
the integration can stay slow without maintaining a fork of MediaCrawler.
"""

from __future__ import annotations

import random
import runpy
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 6:
        raise SystemExit("usage: run-mediacrawler-xhs.py <crawler-dir> <main.py> <min-delay> <max-delay> [args...]")

    crawler_dir = Path(sys.argv[1]).resolve()
    crawler_entry = Path(sys.argv[2]).resolve()
    min_delay = float(sys.argv[3])
    max_delay = float(sys.argv[4])
    upstream_args = sys.argv[5:]

    sys.path.insert(0, str(crawler_dir))
    import config  # type: ignore

    # MediaCrawler reads this value before each page/detail pause. Selecting a
    # fresh value per run avoids every collection session using one rigid pace.
    config.CRAWLER_MAX_SLEEP_SEC = round(random.uniform(min_delay, max_delay), 2)
    sys.argv = [str(crawler_entry), *upstream_args]
    runpy.run_path(str(crawler_entry), run_name="__main__")


if __name__ == "__main__":
    main()
