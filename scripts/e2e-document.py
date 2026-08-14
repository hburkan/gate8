"""Phase 20 Admin Document Management e2e — ad-hoc verification against the dev server.

Verifies against the live local Supabase that the document editor:
  - renders the Phase 20 labeled DocumentForm (Title/Type/Description/Asset URL)
    for create and edit
  - create -> draft v1; edit bumps version
  - the read-only Usage-relations list renders (Used in Locations / Cases /
    Chapters) once relation rows exist (seeded via psql, since Phase 20 cannot
    write relations) and shows the per-relation role (real/fake/decoy); a
    fresh document shows "Not used anywhere yet."
  - chapters are derived indirectly through the cases that use the document
    (there is no chapter_documents table)
  - REVIEWER sees the editor read-only and the usage list
  - unknown id -> not-found

Test rows are created through the UI with a timestamped title so the run is
idempotent. Run with the seo venv python (has playwright):
  ~/.claude/skills/seo/.venv/bin/python e2e-document.py
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
    m = re.search(
        rf"/library/(?:characters|locations|cases|chapters|items|documents)/([0-9a-f-]+)",
        page.url,
    )
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
    title = f"E2E Document {tag}"
    location_name = f"Location {tag}"
    case_title = f"Case {tag}"
    chapter_title = f"Chapter {tag}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Unauthenticated document detail redirects to /login
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(
            f"{BASE}/library/documents/00000000-0000-0000-0000-000000000000",
            wait_until="networkidle",
        )
        check("unauth /library/documents -> /login", page.url.startswith(f"{BASE}/login"), page.url)
        ctx.close()

        # 2. SUPER_ADMIN creates a document via the labeled DocumentForm
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/documents/new", wait_until="networkidle")
        body = page.inner_text("body")
        check("DocumentForm renders Title label", "Title" in body, body[:300])
        check("DocumentForm renders Type label", "Type" in body, body[:300])
        check("DocumentForm renders Description label", "Description" in body, body[:300])
        check("DocumentForm renders Asset label", "Asset URL" in body, body[:400])

        page.fill('input[name="title"]', title)
        page.fill('input[name="type"]', "passport")
        page.fill('textarea[name="description"]', f"Description {tag}")
        page.fill('input[name="asset"]', f"/assets/documents/{tag}.pdf")
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        check("create redirects to document detail", "/library/documents/" in page.url, page.url)
        body = page.inner_text("body")
        check("create shows title", title in body, body[:200])
        check("create is draft v1", "Draft" in body and "version 1" in body, body[:400])
        check("usage list empty state", "Not used anywhere yet." in body, body[:400])
        document_id = id_from_url(page, "documents")

        # 3. Edit bumps the version via the labeled form
        page.click('a:has-text("Edit")')
        page.wait_for_load_state("networkidle")
        page.fill('textarea[name="description"]', f"Description {tag} v2")
        page.click('button[type="submit"]:has-text("Save")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("edit saves", f"Description {tag} v2" in body, body[:300])
        check("edit bumps to v2", "version 2" in body, body[:400])

        # 4. Seed relations and verify the usage-relations list
        # location + link (with role real/fake/decoy)
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

        # chapter + link to the case (indirect chapters usage)
        page.goto(f"{BASE}/library/chapters/new", wait_until="networkidle")
        page.fill('input[name="title"]', chapter_title)
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        chapter_id = id_from_url(page, "chapters")

        seed(
            f"insert into location_documents (location_id, document_id, role, availability) "
            f"values ('{location_id}', '{document_id}', 'fake', false);"
        )
        seed(
            f"insert into case_documents (case_id, document_id, role, required, hidden, discovery_method) "
            f"values ('{case_id}', '{document_id}', 'real', true, false, 'search');"
        )
        seed(
            f"insert into chapter_cases (chapter_id, case_id) values ('{chapter_id}', '{case_id}');"
        )

        page.goto(f"{BASE}/library/documents/{document_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("usage shows Used in Locations", "Used in Locations" in body, body[:500])
        check("usage lists the location", location_name in body, body[:500])
        check("usage shows location role (fake)", "fake" in body, body[:500])
        check("usage shows location unavailable", "unavailable" in body, body[:500])
        check("usage shows Used in Cases", "Used in Cases" in body, body[:500])
        check("usage lists the case", case_title in body, body[:500])
        check("usage shows case role (real)", "real" in body, body[:500])
        check("usage shows case required", "required" in body, body[:600])
        check("usage shows case discovery", "discover: search" in body, body[:600])
        check("usage shows Used in Chapters", "Used in Chapters" in body, body[:500])
        check("usage lists the chapter (indirect)", chapter_title in body, body[:600])

        # cleanup seeded rows so reruns stay idempotent
        seed(
            f"delete from chapter_cases where chapter_id = '{chapter_id}'; "
            f"delete from case_documents where case_id = '{case_id}'; "
            f"delete from location_documents where location_id = '{location_id}';"
        )
        ctx.close()

        # 5. REVIEWER sees the usage list but no edit controls
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[1])
        page.goto(f"{BASE}/library/documents/{document_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("REVIEWER sees usage list", "Usage" in body, body[:300])
        check("REVIEWER no Edit button", "Edit" not in body, body[:300])
        check("REVIEWER no Duplicate/Archive", "Duplicate" not in body and "Archive" not in body, body[:300])
        ctx.close()

        # 6. Unknown id -> not-found
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/documents/00000000-0000-0000-0000-000000000000", wait_until="networkidle")
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