import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    msgs = []
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text[:200]}"))
    page.on("pageerror", lambda e: msgs.append(f"PAGEERROR: {e}"))
    page.on("response", lambda r: msgs.append(f"RESP {r.status} {r.url[:100]}") if r.status >= 400 else None)

    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.fill('input[name="email"]', "super@gumruk.local")
    page.fill('input[name="password"]', "wrong-password-123")
    page.click('button[type="submit"]')
    page.wait_for_timeout(4000)
    print("URL:", page.url)
    print("BODY:", page.inner_text("body"))
    print("--- events ---")
    for m in msgs:
        print(m)
    browser.close()
