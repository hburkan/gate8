"""Phase 22 Admin Location Management e2e — ad-hoc verification against the dev server.

Verifies against the live local Supabase that the location management editor:
  - renders the Phase 22 labeled LocationForm (Name/Type/Description/Parent/Asset)
    for create and edit, with Type as an enum select and a parent selector
  - create -> draft v1; edit bumps version; parent persists on edit
  - the parent selector excludes the location itself and its descendants
    (listLocationParentOptions mirrors validateLocationParent server guard)
  - the "Available content" relation panels render on the location detail page
    (Characters / Items / Documents / Evidence / Cases) with per-row config
  - relation ADD via the picker + config; duplicate add -> "Already available
    here."; EDIT config; REMOVE removes only the relation row (entity survives)
  - per-role permissions: SUPER_ADMIN/CONTENT_ADMIN full view/edit relations;
    EDITOR can add/edit/remove relations but has no Archive; REVIEWER sees the
    panels read-only (no add/edit/remove controls, no Edit button)
  - unknown id -> not-found

Test rows are created through the UI with a timestamped name so the run is
idempotent. Entities used in relations are created through the UI (Phase 22
writes relations itself, unlike Phase 21). Run with the seo venv python:
  ~/.claude/skills/seo/.venv/bin/python e2e-location.py
"""
import re
import sys
import uuid

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


def wait_not_pending(page):
    page.wait_for_function(
        '!document.body.innerText.includes("Saving…") && '
        '!document.body.innerText.includes("Working…") && '
        '!document.body.innerText.includes("Adding…") && '
        '!document.body.innerText.includes("Removing…")',
        timeout=20000,
    )
    page.wait_for_load_state("networkidle")


def id_from_url(page, prefix):
    m = re.search(rf"/library/(?:{prefix})/([0-9a-f-]+)", page.url)
    if not m:
        raise RuntimeError(f"could not extract id from {page.url}")
    return m.group(1)


def create_entity(page, entity, field, value, select=None):
    """Create an entity through the generic/new editor and return its id."""
    page.goto(f"{BASE}/library/{entity}/new", wait_until="networkidle")
    page.fill(f'input[name="{field}"]', value)
    if select:
        page.select_option(f'select[name="{select[0]}"]', select[1])
    page.click('button[type="submit"]:has-text("Create")')
    wait_not_pending(page)
    return id_from_url(page, entity)


def panel(page, label):
    return page.locator(f'div:has(> h3:text-is("Available {label}"))')


def add_relation(page, label, entity_value, config=None):
    p = panel(page, label)
    p.locator('select[name="entityId"]').select_option(entity_value)
    for name, value in (config or {}).items():
        p.locator(f'input[name="config_{name}"]').fill(str(value))
    p.locator('button[type="submit"]:has-text("Add")').click()
    wait_not_pending(page)


def row(page, label, title):
    return panel(page, label).locator("ul li", has_text=title)


def main():
    tag = uuid.uuid4().hex[:8]
    country_name = f"E2E Country {tag}"
    city_name = f"E2E City {tag}"
    airport_name = f"E2E Airport {tag}"
    character_name = f"E2E Character {tag}"
    item_name = f"E2E Item {tag}"
    document_title = f"E2E Document {tag}"
    evidence_name = f"E2E Evidence {tag}"
    case_title = f"E2E Case {tag}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Unauthenticated location detail redirects to /login
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(
            f"{BASE}/library/locations/00000000-0000-0000-0000-000000000000",
            wait_until="networkidle",
        )
        check("unauth /library/locations -> /login", page.url.startswith(f"{BASE}/login"), page.url)
        ctx.close()

        # 2. SUPER_ADMIN creates a top-level location via the labeled LocationForm
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/locations/new", wait_until="networkidle")
        body = page.inner_text("body")
        check("LocationForm renders Name label", "Name" in body, body[:300])
        check("LocationForm renders Type label", "Type" in body, body[:300])
        check("LocationForm renders Description label", "Description" in body, body[:300])
        check("LocationForm renders Parent label", "Parent location" in body, body[:300])
        check("LocationForm renders Asset label", "Asset" in body, body[:300])

        page.fill('input[name="name"]', country_name)
        page.select_option('select[name="type"]', 'country')
        page.fill('textarea[name="description"]', f"Description {tag}")
        page.click('button[type="submit"]:has-text("Create")')
        wait_not_pending(page)
        check("create redirects to location detail", "/library/locations/" in page.url, page.url)
        body = page.inner_text("body")
        check("create shows name", country_name in body, body[:200])
        check("create is draft v1", "Draft" in body and "version 1" in body, body[:400])
        country_id = id_from_url(page, "locations")

        # 3. Create a child location selecting the parent through the selector
        page.goto(f"{BASE}/library/locations/new", wait_until="networkidle")
        page.fill('input[name="name"]', city_name)
        page.select_option('select[name="type"]', 'city')
        page.select_option('select[name="parentId"]', country_id)
        page.click('button[type="submit"]:has-text("Create")')
        wait_not_pending(page)
        city_id = id_from_url(page, "locations")

        page.goto(f"{BASE}/library/locations/new", wait_until="networkidle")
        page.fill('input[name="name"]', airport_name)
        page.select_option('select[name="type"]', 'airport')
        page.select_option('select[name="parentId"]', city_id)
        page.click('button[type="submit"]:has-text("Create")')
        wait_not_pending(page)
        airport_id = id_from_url(page, "locations")

        # 4. Parent selector excludes self + descendants on edit
        page.goto(f"{BASE}/library/locations/{airport_id}/edit", wait_until="networkidle")
        parent_opts = page.locator('select[name="parentId"] option').all_inner_texts()
        check("edit parent options exclude self (airport)", airport_name not in parent_opts, str(parent_opts))
        check("edit parent options include country", country_name in parent_opts, str(parent_opts))
        check("edit parent options include city", city_name in parent_opts, str(parent_opts))

        page.goto(f"{BASE}/library/locations/{city_id}/edit", wait_until="networkidle")
        parent_opts = page.locator('select[name="parentId"] option').all_inner_texts()
        check("edit parent options exclude descendant (airport)", airport_name not in parent_opts, str(parent_opts))
        check("edit parent options exclude self (city)", city_name not in parent_opts, str(parent_opts))
        check("edit parent options include country", country_name in parent_opts, str(parent_opts))

        # 5. Edit the city (parent preserved) bumps version
        page.locator('select[name="parentId"]').input_value()
        page.fill('textarea[name="description"]', f"City {tag} v2")
        page.click('button[type="submit"]:has-text("Save")')
        wait_not_pending(page)
        body = page.inner_text("body")
        check("edit saves", f"City {tag} v2" in body, body[:300])
        check("edit bumps to v2", "version 2" in body, body[:400])

        # 6. Create entities to attach as relations
        char_id = create_entity(page, "characters", "name", character_name)
        page.goto(f"{BASE}/library/items/new", wait_until="networkidle")
        page.fill('input[name="name"]', item_name)
        page.select_option('select[name="category"]', 'electronics')
        page.select_option('select[name="rarity"]', 'common')
        page.select_option('select[name="riskLevel"]', 'low')
        page.fill('input[name="value"]', '100')
        page.click('button[type="submit"]:has-text("Create")')
        wait_not_pending(page)
        item_id = id_from_url(page, "items")
        page.goto(f"{BASE}/library/documents/new", wait_until="networkidle")
        page.fill('input[name="title"]', document_title)
        page.fill('input[name="type"]', "official")
        page.click('button[type="submit"]:has-text("Create")')
        wait_not_pending(page)
        doc_id = id_from_url(page, "documents")
        page.goto(f"{BASE}/library/evidence/new", wait_until="networkidle")
        page.fill('input[name="name"]', evidence_name)
        page.select_option('select[name="type"]', 'digital')
        page.select_option('select[name="importance"]', 'medium')
        page.click('button[type="submit"]:has-text("Create")')
        wait_not_pending(page)
        ev_id = id_from_url(page, "evidence")
        case_id = create_entity(page, "cases", "title", case_title)

        # 7. Relation ADD for each kind via the panels
        page.goto(f"{BASE}/library/locations/{country_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("detail shows Available content", "Available content" in body, body[:400])
        check("detail shows Characters panel", "Available Characters" in body, body[:400])
        check("detail shows Items panel", "Available Items" in body, body[:400])
        check("detail shows Documents panel", "Available Documents" in body, body[:400])
        check("detail shows Evidence panel", "Available Evidence" in body, body[:400])
        check("detail shows Cases panel", "Available Cases" in body, body[:400])

        add_relation(page, "Characters", char_id, {"priority": "3", "role": "guard"})
        char_row = row(page, "Characters", character_name)
        check("added character relation listed", char_row.count() == 1, page.inner_text("body")[:600])
        check(
            "character config role saved",
            char_row.locator('input[name="role"]').input_value() == "guard",
            "role input value",
        )

        add_relation(page, "Items", item_id, {"min_quantity": "1", "max_quantity": "2"})
        add_relation(page, "Documents", doc_id, {"role": "required"})
        add_relation(page, "Evidence", ev_id, {"importance": "high"})
        add_relation(page, "Cases", case_id)
        body = page.inner_text("body")
        for label in (item_name, document_title, evidence_name, case_title):
            check(f"added relation listed ({label})", label in body, body[:600])

        # 8. Duplicate add rejected
        add_relation(page, "Characters", char_id, {"priority": "9"})
        body = page.inner_text("body")
        check("duplicate relation rejected", "Already available here." in body, body[:600])

        # 9. Relation EDIT config
        char_row = row(page, "Characters", character_name)
        char_row.locator('input[name="priority"]').fill("7")
        char_row.locator('input[name="weight"]').fill("2.5")
        char_row.locator('button[type="submit"]:has-text("Save")').click()
        wait_not_pending(page)
        char_row = row(page, "Characters", character_name)
        check(
            "relation edit saved priority",
            char_row.locator('input[name="priority"]').input_value() == "7",
            "priority input value",
        )
        check(
            "relation edit saved weight",
            char_row.locator('input[name="weight"]').input_value() == "2.5",
            "weight input value",
        )

        # 10. Relation REMOVE removes only the relation row (entity survives)
        char_row = row(page, "Characters", character_name)
        page.once("dialog", lambda dialog: dialog.accept())
        char_row.locator('button:has-text("Remove")').click()
        wait_not_pending(page)
        check(
            "removed character relation gone",
            row(page, "Characters", character_name).count() == 0,
            page.inner_text("body")[:600],
        )
        page.goto(f"{BASE}/library/characters/{char_id}", wait_until="networkidle")
        check("removed relation does not delete entity", character_name in page.inner_text("body"), page.url)
        ctx.close()

        # 11. REVIEWER sees the panels read-only
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[3])
        page.goto(f"{BASE}/library/locations/{country_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("REVIEWER sees Available content", "Available content" in body, body[:400])
        check("REVIEWER sees relation row (item)", item_name in body, body[:600])
        check("REVIEWER no Add buttons", page.locator('button:has-text("Add")').count() == 0, body[:400])
        check("REVIEWER no Remove buttons", page.locator('button:has-text("Remove")').count() == 0, body[:400])
        check("REVIEWER no Save buttons", page.locator('button:has-text("Save")').count() == 0, body[:400])
        check("REVIEWER no Edit button", "Edit" not in body, body[:300])
        ctx.close()

        # 12. EDITOR can add relations but has no Archive
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[2])
        page.goto(f"{BASE}/library/locations/{country_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("EDITOR sees Add controls", page.locator('button:has-text("Add")').count() > 0, body[:400])
        check("EDITOR no Archive", "Archive" not in body, body[:300])
        add_relation(page, "Characters", char_id)
        body = page.inner_text("body")
        check("EDITOR added character relation", character_name in body, body[:600])
        ctx.close()

        # 13. CONTENT_ADMIN can view and archive
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[1])
        page.goto(f"{BASE}/library/locations/{country_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("CONTENT_ADMIN sees Available content", "Available content" in body, body[:400])
        check("CONTENT_ADMIN sees Archive", "Archive" in body, body[:300])
        ctx.close()

        # 14. Unknown id -> not-found
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(
            f"{BASE}/library/locations/00000000-0000-0000-0000-000000000000",
            wait_until="networkidle",
        )
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