"""Phase 21 Admin Evidence Management e2e — ad-hoc verification against the dev server.

Verifies against the live local Supabase that the evidence editor:
  - renders the Phase 21 labeled EvidenceForm (Name/Type/Importance/Description)
    for create and edit, with Type/Importance as enum selects
  - create -> draft v1; edit bumps version
  - the read-only Usage-relations list renders (Used in Locations / Cases /
    Chapters) once relation rows exist (seeded via psql, since Phase 21 cannot
    write relations) and shows the per-relation role, importance override, and
    discovery method; a fresh evidence row shows "Not used anywhere yet."
  - chapters are derived indirectly through the cases that use the evidence
    (there is no chapter_evidence table)
  - per-role permissions: SUPER_ADMIN/CONTENT_ADMIN view/create/edit/archive;
    EDITOR view/create/edit/duplicate, no archive; REVIEWER read-only
  - conditions remain unavailable (deferred; not exposed anywhere)
  - no invented relations are exposed (no dependencies / related items,
    documents, characters surfaces)
  - unknown id -> not-found

Test rows are created through the UI with a timestamped name so the run is
idempotent. Run with the seo venv python (has playwright):
  ~/.claude/skills/seo/.venv/bin/python e2e-evidence.py
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


def submit_and_wait_not_pending(page):
    page.wait_for_function(
        '!document.body.innerText.includes("Saving…") && '
        '!document.body.innerText.includes("Working…")',
        timeout=20000,
    )
    page.wait_for_load_state("networkidle")


def id_from_url(page, prefix):
    m = re.search(
        rf"/library/(?:characters|locations|cases|chapters|items|documents|evidence)/([0-9a-f-]+)",
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
    name = f"E2E Evidence {tag}"
    location_name = f"Location {tag}"
    case_title = f"Case {tag}"
    chapter_title = f"Chapter {tag}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Unauthenticated evidence detail redirects to /login
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(
            f"{BASE}/library/evidence/00000000-0000-0000-0000-000000000000",
            wait_until="networkidle",
        )
        check("unauth /library/evidence -> /login", page.url.startswith(f"{BASE}/login"), page.url)
        ctx.close()

        # 2. SUPER_ADMIN creates evidence via the labeled EvidenceForm
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(f"{BASE}/library/evidence/new", wait_until="networkidle")
        body = page.inner_text("body")
        check("EvidenceForm renders Name label", "Name" in body, body[:300])
        check("EvidenceForm renders Type label", "Type" in body, body[:300])
        check("EvidenceForm renders Importance label", "Importance" in body, body[:300])
        check("EvidenceForm renders Description label", "Description" in body, body[:300])
        check("no invented discovery/conditions fields", "Discovery method" not in body, body[:400])
        check("no invented conditions field", "Conditions" not in body, body[:400])

        page.fill('input[name="name"]', name)
        page.select_option('select[name="type"]', 'digital')
        page.select_option('select[name="importance"]', 'high')
        page.fill('textarea[name="description"]', f"Description {tag}")
        page.click('button[type="submit"]:has-text("Create")')
        submit_and_wait_not_pending(page)
        check("create redirects to evidence detail", "/library/evidence/" in page.url, page.url)
        body = page.inner_text("body")
        check("create shows name", name in body, body[:200])
        check("create is draft v1", "Draft" in body and "version 1" in body, body[:400])
        check("usage list empty state", "Not used anywhere yet." in body, body[:400])
        evidence_id = id_from_url(page, "evidence")

        # 3. Edit bumps the version via the labeled form
        page.click('a:has-text("Edit")')
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("edit form shows enum select value", "digital" in body, body[:300])
        page.select_option('select[name="importance"]', 'critical')
        page.fill('textarea[name="description"]', f"Description {tag} v2")
        page.click('button[type="submit"]:has-text("Save")')
        submit_and_wait_not_pending(page)
        body = page.inner_text("body")
        check("edit saves", f"Description {tag} v2" in body, body[:300])
        check("edit bumps to v2", "version 2" in body, body[:400])
        check("edit shows updated importance", "critical" in body, body[:400])

        # 4. Seed relations and verify the usage-relations list
        # location + link (with role decoy, importance override, availability)
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
            f"insert into location_evidence (location_id, evidence_id, role, importance, availability) "
            f"values ('{location_id}', '{evidence_id}', 'decoy', 'low', false);"
        )
        seed(
            f"insert into case_evidence (case_id, evidence_id, role, importance, discovery_method) "
            f"values ('{case_id}', '{evidence_id}', 'required', 'high', 'search');"
        )
        seed(
            f"insert into chapter_cases (chapter_id, case_id) values ('{chapter_id}', '{case_id}');"
        )

        page.goto(f"{BASE}/library/evidence/{evidence_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("usage shows Used in Locations", "Used in Locations" in body, body[:500])
        check("usage lists the location", location_name in body, body[:500])
        check("usage shows location role (decoy)", "decoy" in body, body[:500])
        check("usage shows location importance override", "importance low" in body, body[:600])
        check("usage shows location unavailable", "unavailable" in body, body[:600])
        check("usage shows Used in Cases", "Used in Cases" in body, body[:500])
        check("usage lists the case", case_title in body, body[:500])
        check("usage shows case role (required)", "required" in body, body[:500])
        check("usage shows case importance override", "importance high" in body, body[:600])
        check("usage shows case discovery method", "discover: search" in body, body[:600])
        check("usage shows Used in Chapters", "Used in Chapters" in body, body[:500])
        check("usage lists the chapter (indirect)", chapter_title in body, body[:600])
        check("no invented related surfaces", "Dependencies" not in body, body[:400])

        # cleanup seeded rows so reruns stay idempotent
        seed(
            f"delete from chapter_cases where chapter_id = '{chapter_id}'; "
            f"delete from case_evidence where case_id = '{case_id}'; "
            f"delete from location_evidence where location_id = '{location_id}';"
        )
        ctx.close()

        # 5. REVIEWER sees the usage list but no edit controls
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[3])
        page.goto(f"{BASE}/library/evidence/{evidence_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("REVIEWER sees usage list", "Usage" in body, body[:300])
        check("REVIEWER no Edit button", "Edit" not in body, body[:300])
        check("REVIEWER no Duplicate/Archive", "Duplicate" not in body and "Archive" not in body, body[:300])
        ctx.close()

        # 6. EDITOR can create/edit/duplicate but has no archive
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[2])
        page.goto(f"{BASE}/library/evidence/{evidence_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("EDITOR sees Edit button", "Edit" in body, body[:300])
        check("EDITOR sees Duplicate", "Duplicate" in body, body[:300])
        check("EDITOR no Archive", "Archive" not in body, body[:300])
        ctx.close()

        # 7. CONTENT_ADMIN can view and archive
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[1])
        page.goto(f"{BASE}/library/evidence/{evidence_id}", wait_until="networkidle")
        body = page.inner_text("body")
        check("CONTENT_ADMIN sees usage list", "Usage" in body, body[:300])
        check("CONTENT_ADMIN sees Archive", "Archive" in body, body[:300])
        ctx.close()

        # 8. Unknown id -> not-found
        ctx = browser.new_context()
        page = ctx.new_page()
        login(page, ROLES[0])
        page.goto(
            f"{BASE}/library/evidence/00000000-0000-0000-0000-000000000000",
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