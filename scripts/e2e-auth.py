"""Phase 15 admin auth e2e — production build via `next start`.

Covers: unauthenticated redirect, login (valid + invalid), cookie persistence
across requests (proxy refresh), role claim read, role-gated UI, logout.
Run with the seo venv python (has playwright):
  .venv/bin/python e2e.py
"""
import re
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SUPER = {"email": "super@gumruk.local", "password": "Sup3rAdminP@ss2026"}
REVIEWER = {"email": "reviewer@gumruk.local", "password": "Rev1ewerP@ss2026"}
EDITOR = {"email": "editor@gumruk.local", "password": "Ed1torP@ss2026"}

passed = []
failed = []


def check(name, cond, detail=""):
    if cond:
        passed.append(name)
        print(f"  PASS  {name}")
    else:
        failed.append(name)
        print(f"  FAIL  {name} {detail}")


def login(page, creds):
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.fill('input[name="email"]', creds["email"])
    page.fill('input[name="password"]', creds["password"])
    page.click('button[type="submit"]')
    page.wait_for_url(f"{BASE}/", timeout=15000)
    page.wait_for_load_state("networkidle")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Unauthenticated root redirects to /login
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(f"{BASE}/", wait_until="networkidle")
        check("unauth / -> /login", page.url.startswith(f"{BASE}/login"),
              page.url)
        # login page shows email+password fields
        check("login form visible", page.is_visible('input[name="email"]'))
        ctx.close()

        # 2. Invalid login shows non-enumerating error, stays on /login
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.fill('input[name="email"]', SUPER["email"])
        page.fill('input[name="password"]', "wrong-password-123")
        page.click('button[type="submit"]')
        page.wait_for_function(
            'document.body.innerText.includes("Invalid email or password")',
            timeout=15000)
        check("invalid login stays on /login", page.url.startswith(f"{BASE}/login"),
              page.url)
        body = page.inner_text("body")
        check("invalid login shows error", "Invalid email or password" in body,
              body[:200])
        ctx.close()

        # 3. Valid SUPER_ADMIN login -> protected shell, role read, cookie persists
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, SUPER)
        check("logged in lands on /", page.url.rstrip("/") == BASE or page.url == f"{BASE}/",
              page.url)
        body = page.inner_text("body")
        check("shows email", SUPER["email"] in body, body[:300])
        check("shows role SUPER_ADMIN", "SUPER_ADMIN" in body, body[:300])
        check("shows all 6 permissions", all(x in body for x in
              ["view", "create", "edit", "delete", "publish", "rollback"]), body[:300])
        check("SUPER_ADMIN sees Publish placeholder", "Publish" in body, body[:300])

        # cookie persistence: reload the page (new request through proxy) - still authed
        page.reload(wait_until="networkidle")
        body = page.inner_text("body")
        check("session persists across reload", SUPER["email"] in body, body[:200])
        # navigate to /login while authed -> proxy bounces back to /
        page.goto(f"{BASE}/login", wait_until="networkidle")
        check("authed /login bounces to /", page.url.rstrip("/") == BASE, page.url)
        ctx.close()

        # 4. REVIEWER login: view-only, no Publish button
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, REVIEWER)
        body = page.inner_text("body")
        check("REVIEWER role shown", "REVIEWER" in body, body[:300])
        check("REVIEWER has view permission", "view" in body, body[:300])
        check("REVIEWER has NO create", "create" not in body, body[:300])
        check("REVIEWER has NO publish button", "Publish" not in body, body[:300])
        ctx.close()

        # 5. EDITOR login: view/create/edit, no delete/publish
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, EDITOR)
        body = page.inner_text("body")
        check("EDITOR role shown", "EDITOR" in body, body[:300])
        check("EDITOR has edit permission", "edit" in body, body[:300])
        check("EDITOR has NO delete", "delete" not in body, body[:300])
        check("EDITOR has NO publish", "publish" not in body, body[:300])
        ctx.close()

        # 6. Logout revokes session; / is protected again
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, SUPER)
        page.click('button:has-text("Sign out")')
        page.wait_for_url(f"{BASE}/login", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("logout -> /login", page.url.startswith(f"{BASE}/login"), page.url)
        page.goto(f"{BASE}/", wait_until="networkidle")
        check("post-logout / redirects to /login", page.url.startswith(f"{BASE}/login"),
              page.url)
        ctx.close()

        browser.close()

    print("\n=== RESULTS ===")
    print(f"passed: {len(passed)}  failed: {len(failed)}")
    if failed:
        for f in failed:
            print(f"  FAILED: {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
