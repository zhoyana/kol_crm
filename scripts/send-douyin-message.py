"""Send one Douyin DM through the employee's signed-in CDP Chrome."""

from __future__ import annotations

import argparse
import json
import re
import sys
from urllib.parse import urlparse

from playwright.sync_api import Locator, Page, sync_playwright


def output(ok: bool, message: str) -> None:
    print(json.dumps({"ok": ok, "message": message}, ensure_ascii=False))


def visible_first(locator: Locator) -> Locator | None:
    for index in range(min(locator.count(), 30)):
        item = locator.nth(index)
        try:
            if item.is_visible():
                return item
        except Exception:
            continue
    return None


def click_private_message(page: Page) -> bool:
    candidates = [
        page.locator("button").filter(has_text=re.compile(r"^\s*私信\s*$")),
        page.get_by_role("button", name=re.compile(r"^(私信|发私信)$")),
        page.get_by_role("link", name=re.compile(r"^(私信|发私信)$")),
        page.get_by_text(re.compile(r"^\s*(私信|发私信)\s*$")),
        page.locator('a, button, div[role="button"]').filter(has_text=re.compile(r"^\s*私信\s*$")),
        page.locator('[data-e2e*="message" i], [data-e2e*="private" i]').filter(has_text=re.compile("私信")),
    ]
    for candidate in candidates:
        target = visible_first(candidate)
        if not target:
            continue
        try:
            page.bring_to_front()
            target.scroll_into_view_if_needed(timeout=3_000)
            page.wait_for_timeout(500)
            target.click(force=True, timeout=5_000)
            for _ in range(12):
                page.wait_for_timeout(250)
                if find_editor(page):
                    return True
        except Exception:
            continue
    return False


def find_editor(page: Page) -> Locator | None:
    selectors = [
        '[contenteditable="true"][data-slate-editor="true"]',
        'textarea[placeholder*="发送消息"]',
    ]
    for selector in selectors:
        target = visible_first(page.locator(selector))
        if target:
            return target
    return None


def fill_editor(editor: Locator, message: str) -> None:
    try:
        is_slate = editor.get_attribute("data-slate-editor") == "true"
        if not is_slate:
            editor.fill(message)
            return
        # Douyin uses a Slate/React editor. locator.fill() can change the DOM
        # before Slate's internal value catches up, leaving a red arrow that
        # visually looks enabled but ignores the immediate send click. Use
        # real keyboard input so React receives the full beforeinput/input
        # sequence, just like an employee typing the message.
        editor.click()
        editor.press("Control+A")
        editor.press("Backspace")
        editor.press_sequentially(" ".join(message.splitlines()), delay=5)
    except Exception:
        editor.fill(message)


def editor_text(editor: Locator) -> str:
    try:
        tag = editor.evaluate("element => element.tagName.toLowerCase()")
        value = editor.input_value(timeout=2_000) if tag in {"textarea", "input"} else editor.inner_text(timeout=2_000)
        return re.sub(r"[\s\u200b\u200c\u200d\ufeff]+", "", value or "")
    except Exception:
        return ""


def click_send_arrow(page: Page, editor: Locator) -> bool:
    send_requests: list[str] = []

    def observe_request(request) -> None:
        if "/message/send" in request.url:
            send_requests.append(request.url)

    page.on("request", observe_request)
    candidates = [
        page.locator("svg.e2e-send-msg-btn"),
        page.locator(".messageMsgInputpublishBtn"),
        page.locator('[class*="publishBtn"]'),
    ]
    for candidate in candidates:
        target = visible_first(candidate)
        if not target:
            continue
        try:
            page.bring_to_front()
            target.scroll_into_view_if_needed(timeout=3_000)
            # The red class is added before the composer is fully ready to
            # accept its React pointer handler. Give the focused page one
            # stable animation frame window before emitting the click.
            for _ in range(20):
                if "messageMsgInputpublishRedBtn" in (target.get_attribute("class") or ""):
                    break
                page.wait_for_timeout(250)
            else:
                continue
            page.wait_for_timeout(800)
            # Douyin currently binds the send action directly to this SVG.
            # A coordinate-only mouse click can hit its inner path without
            # dispatching the complete pointer sequence to the React handler.
            target.click(force=True, timeout=5_000)
            for _ in range(8):
                page.wait_for_timeout(500)
                if send_requests or not editor_text(editor):
                    return True

            # On a freshly mounted Douyin composer the first trusted pointer
            # sequence is occasionally swallowed even though the arrow is
            # red. Only when there was no send request at all and the draft is
            # still present, invoke the element handler once as a fallback.
            target.evaluate("element => element.click()")
            return True
        except Exception:
            continue
    return False


def wait_for_sent(page: Page, editor: Locator, message: str) -> bool:
    for _ in range(30):
        page.wait_for_timeout(500)
        if not editor_text(editor):
            return True
        # Do not use page text as proof here: before sending, the editor
        # itself contains the same prefix and caused a false positive.
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-url", required=True)
    parser.add_argument("--message", required=True)
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    args = parser.parse_args()

    parsed = urlparse(args.profile_url)
    message = args.message.strip()
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or not parsed.hostname.endswith("douyin.com"):
        output(False, "只允许打开抖音达人主页")
        return 2
    if not message or len(message) > 500:
        output(False, "私信内容不能为空且不能超过 500 字")
        return 2

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(args.cdp_url, timeout=60_000)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            target_path = parsed.path.rstrip("/")
            matching_pages = [
                current
                for current in context.pages
                if urlparse(current.url).hostname
                and urlparse(current.url).hostname.endswith("douyin.com")
                and urlparse(current.url).path.rstrip("/") == target_path
            ]
            page = next(
                (
                    current
                    for current in matching_pages
                    if current.locator('[contenteditable="true"][data-slate-editor="true"]:visible').count()
                ),
                matching_pages[0] if matching_pages else None,
            )
            if page is None:
                page = context.new_page()
                page.goto(args.profile_url, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_timeout(2_500)
            else:
                page.bring_to_front()
                page.wait_for_timeout(800)

            editor = find_editor(page)
            if not editor and not click_private_message(page):
                output(False, "没有找到私信按钮；请确认已登录且该达人允许私信")
                return 3

            for _ in range(15):
                candidate = find_editor(page)
                if candidate:
                    page.wait_for_timeout(400)
                    editor = find_editor(page)
                if editor:
                    break
                page.wait_for_timeout(1_000)
            if not editor:
                output(False, "私信窗口已打开，但没有找到消息输入框")
                return 4

            wrote_message = editor_text(editor) != re.sub(r"[\s\u200b\u200c\u200d\ufeff]+", "", message)
            if wrote_message:
                fill_editor(editor, message)
            editor.click()
            page.wait_for_timeout(2_500 if wrote_message else 800)
            if editor_text(editor) == "":
                output(False, "话术没有成功写入输入框")
                return 5
            if not click_send_arrow(page, editor):
                output(False, "话术已填入，但没有找到红色发送箭头")
                return 5
            if not wait_for_sent(page, editor, message):
                output(False, "已点击发送箭头，但 15 秒内未确认消息发出；已停止重试以避免重复发送")
                return 5

            for duplicate in matching_pages:
                if duplicate == page:
                    continue
                try:
                    duplicate.close()
                except Exception:
                    pass

            output(True, "私信已发送")
            return 0
    except Exception as error:
        output(False, f"浏览器自动建联失败：{error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
