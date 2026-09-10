"""Run MediaCrawler while keeping generated data inside the CRM writable root."""

import os
import runpy
import sys


crawler_root = os.environ["MEDIACRAWLER_ROOT"]
output_root = os.environ["MEDIACRAWLER_OUTPUT_ROOT"]

sys.path.insert(0, crawler_root)
os.chdir(crawler_root)

import config  # noqa: E402

config.SAVE_DATA_PATH = output_root.replace("\\", "/")
if os.environ.get("MEDIACRAWLER_DY_PUBLISH_TIME_TYPE"):
    # Newer MediaCrawler versions removed this setting from the CLI but still
    # consume it from config in the Douyin search client.
    config.PUBLISH_TIME_TYPE = int(os.environ["MEDIACRAWLER_DY_PUBLISH_TIME_TYPE"])
if os.environ.get("MEDIACRAWLER_CDP_PORT"):
    config.CDP_DEBUG_PORT = int(os.environ["MEDIACRAWLER_CDP_PORT"])
if os.environ.get("MEDIACRAWLER_CDP_CONNECT_EXISTING"):
    config.CDP_CONNECT_EXISTING = os.environ["MEDIACRAWLER_CDP_CONNECT_EXISTING"].lower() in {"1", "true", "yes"}
runpy.run_path(os.path.join(crawler_root, "main.py"), run_name="__main__")
