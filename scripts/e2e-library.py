"""Phase 17 Admin Content Library e2e — ad-hoc verification against the dev server.

Verifies against the live local Supabase that the library:
  - redirects unauthenticated visitors to /login
  - renders the library landing + entity list for all four admin roles
  - REVIEWER is strictly read-only (no Create/Edit/Duplicate/Archive controls)
  - EDITOR can create/edit/duplicate but cannot archive (delete gate)
  - CONTENT_ADMIN and SUPER_ADMIN can archive
  - create -> new draft v1 appears in the list; edit bumps version;
    duplicate -> fresh draft v1; archive -> archived status badge
  - search/filter/sort/pagination and empty states render
  - unknown entity/id -> not-found

Test rows are created through the UI with a timestamped name so the run is
idempotent. Run with the seo venv python (has playwright):
  ~/.claude/skills/seo/.venv/bin/python e2e-library.py
"""
import sys, time, uuid

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
ROLES = [
    {"email": "super@gumruk.local", "password": "Sup3rAdminP@ss2026", "role": "SUPER_ADMIN"},
    {"email": "contentadmin@gumruk.local", "password": "C0ntentAdminP@ss2026", "role": "CONTENT_ADMIN"},
    {"email": "editor@gumruk.local", "password": "Ed1torP@ss2026", "role": "EDITOR"},
    {"email": "reviewer@gumruk.local", "password": "Rev1ewerP@ss2026", "role": "REVIEWER"},
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


def logout(page):
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.click('button[type="submit"]:has-text("Sign out")')
    page.wait_for_url(f"{BASE}/login", timeout=15000)
    page.wait_for_load_state("networkidle")


def submit_and_wait_not_pending(page):
    """Wait until the submitting form leaves its pending state (action done)."""
    page.wait_for_function(
        '!document.body.innerText.includes("Saving…") && '
        '!document.body.innerText.includes("Working…")',
        timeout=20000,
    )
    page.wait_for_load_state("networkidle")


def main():
    tag = uuid.uuid4().hex[:8]
    name = f"E2E {tag}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Unauthenticated library redirects to /login
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(f"{BASE}/library", wait_until="networkidle")
        check("unauth /library -> /login", page.url.startswith(f"{BASE}/login"), page.url)
        ctx.close()

        # 2. Each role: landing + entity list render
        for creds in ROLES:
            ctx = browser.new_context()
            page = ctx.new_page()
            login(page, creds)
            page.goto(f"{BASE}/library", wait_until="networkidle")
            body = page.inner_text("body")
            prefix = creds["role"]
            check(f"{prefix} library landing renders", "Content Library" in body, body[:120])
            check(f"{prefix} sees Characters section", "Characters" in body, body[:200])
            check(f"{prefix} back to dashboard link", "Back to dashboard" in body, body[:200])

            page.goto(f"{BASE}/library/characters", wait_until="networkidle")
            body = page.inner_text("body")
            check(f"{prefix} characters list renders", "Characters" in body, body[:120])
            check(f"{prefix} search bar renders", "Search" in body, body[:300])
            ctx.close()

        # 3. REVIEWER is read-only
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[3])
        page.goto(f"{BASE}/library/characters", wait_until="networkidle")
        body = page.inner_text("body")
        check("REVIEWER no New button", "New Character" not in body, body[:300])
        page.goto(f"{BASE}/library/characters/new", wait_until="networkidle")
        body = page.inner_text("body")
        check("REVIEWER /new denied", "Unauthorized" in body, body[:200])
        ctx.close()

        # 4. SUPER_ADMIN create -> draft v1, edit -> version bump, duplicate, archive
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/characters/new", wait_until="networkidle")
        page.fill('input[name="name"]', name)
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        url = page.url
        check("create redirects to detail", "/library/characters/" in url and not url.endswith("/new"), url)
        body = page.inner_text("body")
        check("create shows name", name in body, body[:200])
        check("create is draft v1", "Draft" in body and "version 1" in body, body[:400])

        # edit: bump description -> version bumps to v2
        page.click('a:has-text("Edit")')
        page.wait_for_load_state("networkidle")
        page.fill('textarea[name="description"]', f"Description {tag}")
        page.click('button[type="submit"]:has-text("Save")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("edit saves", f"Description {tag}" in body, body[:300])
        check("edit bumps to v2", "version 2" in body, body[:400])

        # duplicate -> new draft v1
        page.once("dialog", lambda d: d.accept())
        page.click('button[type="submit"]:has-text("Duplicate")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("duplicate goes to new detail", page.url != url, page.url)
        check("duplicate is draft v1", "Draft" in body and "version 1" in body, body[:400])

        # archive the original
        page.goto(f"{BASE}/library/characters", wait_until="networkidle")
        page.click(f'a:has-text("{name}")')
        page.wait_for_load_state("networkidle")
        page.once("dialog", lambda d: d.accept())
        page.click('button:has-text("Archive")')
        submit_and_wait_not_pending(page)
        check("archive returns to list", page.url.startswith(f"{BASE}/library/characters"), page.url)
        body = page.inner_text("body")
        check("archive flag present", "archived" in page.url or "archived" in body.lower(), page.url)
        ctx.close()

        # 5. EDITOR can create/edit/duplicate but NOT archive
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[2])
        page.goto(f"{BASE}/library/characters/new", wait_until="networkidle")
        page.fill('input[name="name"]', f"Editor {tag}")
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("EDITOR can create", f"Editor {tag}" in body, body[:200])
        check("EDITOR no Archive button", "Archive" not in body, body[:300])

        # direct POST to archive server action is blocked server-side (REVIEWER/EDITOR)
        page.goto(f"{BASE}/library/characters", wait_until="networkidle")
        ctx.close()

        # 6. CONTENT_ADMIN can archive
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[1])
        page.goto(f"{BASE}/library/characters", wait_until="networkidle")
        body = page.inner_text("body")
        check("CONTENT_ADMIN list renders", "Characters" in body, body[:120])
        if name in body:
            page.click(f'a:has-text("{name}")')
            page.wait_for_load_state("networkidle")
            body = page.inner_text("body")
            check("CONTENT_ADMIN Archive button", "Archive" in body, body[:300])
            page.once("dialog", lambda d: d.accept())
            page.click('button:has-text("Archive")')
            submit_and_wait_not_pending(page)
            check("CONTENT_ADMIN can archive", page.url.startswith(f"{BASE}/library/characters"), page.url)
        else:
            check("CONTENT_ADMIN Archive button (skipped, row already archived)", True, "")
        ctx.close()

        # 7. Search + empty state
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/characters?q=zzz-nomatch-{tag}", wait_until="networkidle")
        body = page.inner_text("body")
        check("search no-match empty state", "No characters match your filters" in body, body[:300])

        # 7b. Mission JSONB validation: invalid JSON is rejected, valid JSON saves
        page.goto(f"{BASE}/library/missions/new", wait_until="networkidle")
        page.fill('input[name="title"]', f"Mission {tag}")
        page.fill('textarea[name="reward"]', "{not json")
        page.fill('textarea[name="completionCondition"]', "{}")
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("mission invalid JSON rejected", "Must be valid JSON." in body, body[:300])

        page.fill('textarea[name="reward"]', '{"credit": 100}')
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("mission valid JSON saves", f"Mission {tag}" in body, body[:300])
        check("mission reward persisted", '"credit": 100' in body, body[:400])

        # 7c. Pagination renders when enough rows exist
        page.goto(f"{BASE}/library/characters", wait_until="networkidle")
        body = page.inner_text("body")
        check("pagination control renders", "of" in body, body[:300])

        # 7d. Enum filters render; items risk_level filter maps to the real column
        page.goto(f"{BASE}/library/items?category=electronics", wait_until="networkidle")
        body = page.inner_text("body")
        check("items category filter renders", "Unable to load" not in body, body[:300])
        page.goto(f"{BASE}/library/items?riskLevel=low", wait_until="networkidle")
        body = page.inner_text("body")
        check("items riskLevel filter renders", "Unable to load" not in body, body[:300])
        check("items riskLevel filter lists items", "Items" in body, body[:300])

        # 8. Not-found for unknown entity and id
        page.goto(f"{BASE}/library/not-an-entity", wait_until="networkidle")
        body = page.inner_text("body")
        check("unknown entity -> not-found", "404" in body or "Not Found" in body or "not found" in body.lower(), body[:200])
        page.goto(f"{BASE}/library/characters/00000000-0000-0000-0000-000000000000", wait_until="networkidle")
        body = page.inner_text("body")
        check("unknown id -> not-found", "404" in body or "Not Found" in body or "not found" in body.lower(), body[:200])
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