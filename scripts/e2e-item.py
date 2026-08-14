"""Phase 19 Admin Item Management e2e — ad-hoc verification against the dev server.

Verifies against the live local Supabase that the item editor:
  - renders the Phase 19 labeled ItemForm (Name/Category/Description/Value/Risk
    level/Rarity/Image asset URL) for create and edit
  - create -> draft v1; edit bumps version
  - the read-only Usage list renders (Used in Locations / Cases) once relation
    rows exist (seeded via psql, since Phase 19 cannot write relations) and
    shows "Not used anywhere yet." for a fresh item
  - REVIEWER sees the editor read-only and the usage list
  - unknown id -> not-found

Test rows are created through the UI with a timestamped name so the run is
idempotent. Run with the seo venv python (has playwright):
  ~/.claude/skills/seo/.venv/bin/python e2e-item.py
"""
import re
import subprocess
import sys
import uuid

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ROLES = [
    {"email": "super@gumruk.local", "password": "Sup3rAdminP@ss2026", "role": "SUPER_ADMIN"},
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


def submit_and_wait_not_pending(page):
    page.wait_for_function(
        '!document.body.innerText.includes("Saving…") && '
        '!document.body.innerText.includes("Working…")',
        timeout=20000,
    )
    page.wait_for_load_state("networkidle")


def id_from_url(page, prefix):
    m = re.search(rf"/library/(?:characters|locations|cases|chapters|items)/([0-9a-f-]+)", page.url)
    if not m:
        raise RuntimeError(f"could not extract id from {page.url}")
    return m.group(1)


def seed(sql):
    subprocess.run(
        ["psql", DB, "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=True,
        capture_output=True,
    )


def main():
    tag = uuid.uuid4().hex[:8]
    name = f"E2E Item {tag}"
    location_name = f"Location {tag}"
    case_title = f"Case {tag}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Unauthenticated item detail redirects to /login
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(
            f"{BASE}/library/items/00000000-0000-0000-0000-000000000000",
            wait_until="networkidle",
        )
        check("unauth /library/items -> /login", page.url.startswith(f"{BASE}/login"), page.url)
        ctx.close()

        # 2. SUPER_ADMIN creates an item via the labeled ItemForm
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/items/new", wait_until="networkidle")
        body = page.inner_text("body")
        check("ItemForm renders Name label", "Name" in body, body[:300])
        check("ItemForm renders Category label", "Category" in body, body[:300])
        check("ItemForm renders Description label", "Description" in body, body[:300])
        check("ItemForm renders Value label", "Value" in body, body[:300])
        check("ItemForm renders Risk level label", "Risk level" in body, body[:300])
        check("ItemForm renders Rarity label", "Rarity" in body, body[:300])
        check("ItemForm renders Image label", "Image asset URL" in body, body[:400])

        page.fill('input[name="name"]', name)
        page.select_option('select[name="category"]', 'electronics')
        page.select_option('select[name="rarity"]', 'rare')
        page.select_option('select[name="riskLevel"]', 'medium')
        page.fill('textarea[name="description"]', f"Description {tag}")
        page.fill('input[name="value"]', "250.50")
        page.fill('input[name="asset"]', f"/assets/items/{tag}.png")
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        check("create redirects to item detail", "/library/items/" in page.url, page.url)
        body = page.inner_text("body")
        check("create shows name", name in body, body[:200])
        check("create is draft v1", "Draft" in body and "version 1" in body, body[:400])
        check(
            "usage list empty state",
            "Not used anywhere yet." in body,
            body[:400],
        )
        item_id = id_from_url(page, "items")

        # 3. Edit bumps the version via the labeled form
        page.click('a:has-text("Edit")')
        page.wait_for_load_state("networkidle")
        page.fill('textarea[name="description"]', f"Description {tag} v2")
        page.click('button[type="submit"]:has-text("Save")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("edit saves", f"Description {tag} v2" in body, body[:300])
        check("edit bumps to v2", "version 2" in body, body[:400])

        # 4. Seed relations and verify the usage list
        # location + link
        page.goto(f"{BASE}/library/locations/new", wait_until="networkidle")
        page.fill('input[name="name"]', location_name)
        page.select_option('select[name="type"]', 'area')
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        location_id = id_from_url(page, "locations")

        # case + link
        page.goto(f"{BASE}/library/cases/new", wait_until="networkidle")
        page.fill('input[name="title"]', case_title)
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        case_id = id_from_url(page, "cases")

        seed(
            f"insert into location_items (location_id, item_id, availability) "
            f"values ('{location_id}', '{item_id}', false);"
        )
        seed(
            f"insert into case_items (case_id, item_id, required, min_quantity, max_quantity) "
            f"values ('{case_id}', '{item_id}', true, 1, 3);"
        )

        page.goto(f"{BASE}/library/items/{item_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("usage shows Used in Locations", "Used in Locations" in body, body[:500])
        check("usage lists the location", location_name in body, body[:500])
        check("usage shows location unavailable", "unavailable" in body, body[:500])
        check("usage shows Used in Cases", "Used in Cases" in body, body[:500])
        check("usage lists the case", case_title in body, body[:500])
        check("usage shows case required", "required" in body, body[:600])
        check("usage shows case quantity bounds", "quantity 1-3" in body or "quantity 1–3" in body, body[:600])
        check("usage does NOT show Used by Characters", "Used by Characters" not in body, body[:600])

        # cleanup seeded rows so reruns stay idempotent
        seed(
            f"delete from case_items where case_id = '{case_id}'; "
            f"delete from location_items where location_id = '{location_id}';"
        )
        ctx.close()

        # 5. REVIEWER sees the usage list but no edit controls
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[1])
        page.goto(f"{BASE}/library/items/{item_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("REVIEWER sees usage list", "Usage" in body, body[:300])
        check("REVIEWER no Edit button", "Edit" not in body, body[:300])
        check("REVIEWER no Duplicate/Archive", "Duplicate" not in body and "Archive" not in body, body[:300])
        ctx.close()

        # 6. Unknown id -> not-found
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/items/00000000-0000-0000-0000-000000000000", wait_until="networkidle")
        body = page.inner_text("body")
        check(
            "unknown id -> not-found",
            "404" in body or "Not Found" in body or "not found" in body.lower(),
            body[:200],
        )
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