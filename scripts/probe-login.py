import re, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SUPER = {"email": "super@gumruk.local", "password": "Sup3rAdminP@ss2026"}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    console_msgs = []
    page.on("console", lambda m: console_msgs.append(f"{m.type}: {m.text[:300]}"))
    page.on("pageerror", lambda e: console_msgs.append(f"PAGEERROR: {e}"))
    page.on("response", lambda r: console_msgs.append(f"RESP {r.status} {r.url[:120]}") if r.status >= 400 else None)

    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.fill('input[name="email"]', SUPER["email"])
    page.fill('input[name="password"]', SUPER["password"])
    page.click('button[type="submit"]')
    try:
        page.wait_for_url(f"{BASE}/", timeout=12000)
        print("NAVIGATED to /")
    except Exception as e:
        print("NO NAVIGATION:", e)
    page.wait_for_timeout(2000)
    print("URL:", page.url)
    print("BODY:", page.inner_text("body")[:300])
    print("--- console/network ---")
    for m in console_msgs:
        print(m)
    browser.close()
