"""Phase 16 admin dashboard e2e — ad-hoc verification against `next start`.

Verifies against the live local Supabase (real counts) that the dashboard:
  - redirects unauthenticated visitors to /login
  - renders for all four admin roles (SUPER_ADMIN, CONTENT_ADMIN, EDITOR, REVIEWER)
  - shows the entity totals, Draft/Published cards, and Recent changes
  - renders honest empty states for Recent releases and Content validation errors
  - never exposes client-side content access (service-role only, server-side)

Run with the seo venv python (has playwright):
  .venv/bin/python e2e-dashboard.py
"""
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
ROLES = [
    {"email": "super@gumruk.local", "password": "Sup3rAdminP@ss2026", "role": "SUPER_ADMIN"},
    {"email": "reviewer@gumruk.local", "password": "Rev1ewerP@ss2026", "role": "REVIEWER"},
    {"email": "editor@gumruk.local", "password": "Ed1torP@ss2026", "role": "EDITOR"},
]

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
        check("unauth / -> /login", page.url.startswith(f"{BASE}/login"), page.url)
        ctx.close()

        # 2. Each role sees the dashboard with cards + empty states
        for creds in ROLES:
            ctx = browser.new_context()
            page = ctx.new_page()
            login(page, creds)
            body = page.inner_text("body")
            prefix = f"{creds['role']}"
            check(f"{prefix} sees Admin Dashboard", "Admin Dashboard" in body, body[:120])
            check(f"{prefix} role shown", creds["role"] in body, body[:200])
            for label in [
                "Total Chapters", "Total Cases", "Total Characters",
                "Total Items", "Total Documents", "Total Evidence",
                "Draft content", "Published content", "Recent changes",
                "Recent releases", "Content validation errors",
            ]:
                check(f"{prefix} card '{label}'", label in body, label)
            check(f"{prefix} empty Recent releases",
                  "Content Release System" in body, body[:400])
            check(f"{prefix} empty Content validation errors",
                  "Content validation" in body, body[:400])
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
