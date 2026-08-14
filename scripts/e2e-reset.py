import re, sys, urllib.request, json, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
MAILPIT = "http://localhost:54324"
EMAIL = "editor@gumruk.local"
NEW_PW = "N3wEditorP@ss2026"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()

    # 1. request reset link
    page.goto(f"{BASE}/auth/forgot-password", wait_until="networkidle")
    page.fill('input[name="email"]', EMAIL)
    page.click('button[type="submit"]')
    page.wait_for_function(
        'document.body.innerText.includes("If an account exists")', timeout=15000)
    print("1. reset requested: non-enumerating message shown")

    # 2. poll Mailpit for the reset email
    link = None
    for _ in range(10):
        time.sleep(2)
        with urllib.request.urlopen(f"{MAILPIT}/api/v1/messages") as r:
            data = json.load(r)
        if data.get("total"):
            for msg in data["messages"]:
                mid = msg["ID"]
                with urllib.request.urlopen(f"{MAILPIT}/api/v1/message/{mid}") as r2:
                    m = json.load(r2)
                tos = " ".join(t.get("Address", "") for t in (m.get("To") or []))
                if EMAIL in tos:
                    mbody = (m.get("Text") or "") + (m.get("HTML") or "")
                    m = re.search(r"http://[^\s\"'<]+verify\?[^\s\"'<]+", mbody)
                    if m:
                        link = m.group(0).replace("&amp;", "&")
                    break
        if link:
            break
    if not link:
        print("FAIL: no reset link found in Mailpit")
        sys.exit(1)
    print("2. reset link found in Mailpit")

    # 3. open reset link -> update-password page
    page.goto(link, wait_until="networkidle")
    body = page.inner_text("body")
    print("3. update-password page:", "Update password" in body or "New password" in body)

    # 4. set new password (min 12, must confirm)
    page.fill('input[name="password"]', NEW_PW)
    page.fill('input[name="confirmPassword"]', NEW_PW)
    page.click('button[type="submit"]')
    page.wait_for_function(
        'window.location.pathname === "/login"', timeout=20000)
    print("4. password updated, redirected to /login")

    # 5. sign in with new password
    page.fill('input[name="email"]', EMAIL)
    page.fill('input[name="password"]', NEW_PW)
    page.click('button[type="submit"]')
    page.wait_for_function(
        'window.location.pathname === "/"', timeout=20000)
    body = page.inner_text("body")
    print("5. login with new pw:", EMAIL in body and "EDITOR" in body)

    browser.close()
