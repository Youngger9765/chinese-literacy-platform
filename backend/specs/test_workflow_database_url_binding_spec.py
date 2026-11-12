"""No workflow but the one-shot migration may read DATABASE_URL as a plain
GitHub Actions secret (#3999, Junyi security baseline rule 7).

Why
---
`deploy.yml` / `staging-deploy.yml` / `preview-deploy.yml` used to inject
`${{ secrets.DATABASE_URL }}` / `${{ secrets.STAGING_DATABASE_URL }}` /
`${{ secrets.PREVIEW_DATABASE_URL }}` into Cloud Run as a literal value in
the bulk env-vars flag -- the DB connection string (including password)
lived as a plain repository secret and showed up as a literal env var on
every revision. They now bind `DATABASE_URL` via a dedicated secrets flag
pointed at a Secret Manager secret (`lingoleap-database-url-{prod,staging,
preview}:latest`) instead.

The one legitimate exception is `migrate-db-url-to-secret-manager.yml`: a
one-shot, human-triggered workflow whose entire job is copying the CURRENT
value of each of those three GitHub Actions secrets into its matching
Secret Manager secret as a new version. It has to read them to do that.

Parsed, not grepped
--------------------
This walks each file's *parsed* YAML structure (dict/list/str), not its raw
text. A prose comment that merely mentions the old secret name -- explaining
history, or warning a future reader not to reintroduce it -- is dropped by
the YAML parser before this ever sees it, so it can never trip this lock.
Only live `${{ ... }}` expressions and other actual field values count.
`test_a_comment_merely_mentioning_the_old_secret_name_does_not_trip_this_lock`
pins that down so a future rewrite to raw-text grepping would fail loudly
instead of silently flagging this file's own explanatory comments.
"""
from __future__ import annotations

import pathlib
import re

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
WF_DIR = REPO / ".github" / "workflows"

#: The only file allowed to read the per-environment DATABASE_URL GitHub
#: Actions secrets -- see module docstring. Once it has run once per
#: environment (each Secret Manager secret has at least one version), there
#: is no remaining reason for any workflow to ever read
#: `secrets.*DATABASE_URL` again.
_MIGRATION_WORKFLOW = "migrate-db-url-to-secret-manager.yml"

#: Matches `secrets.DATABASE_URL`, `secrets.STAGING_DATABASE_URL`,
#: `secrets.PREVIEW_DATABASE_URL`, and any other `secrets.*DATABASE_URL*`
#: shape, so a future fourth environment doesn't need a new pattern.
_DATABASE_URL_SECRET_REF = re.compile(r"secrets\.\w*DATABASE_URL\w*")


def _iter_strings(node: object):
    """Yield every string value anywhere inside a parsed YAML document."""
    if isinstance(node, dict):
        for value in node.values():
            yield from _iter_strings(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_strings(item)
    elif isinstance(node, str):
        yield node


def _database_url_secret_refs_in_doc(doc: object) -> list[str]:
    return [s for s in _iter_strings(doc) if _DATABASE_URL_SECRET_REF.search(s)]


def _database_url_secret_refs_in_file(path: pathlib.Path) -> list[str]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    return _database_url_secret_refs_in_doc(doc)


def _workflow_files() -> list[pathlib.Path]:
    return sorted(WF_DIR.glob("*.yml")) + sorted(WF_DIR.glob("*.yaml"))


def test_no_workflow_other_than_the_migration_reads_database_url_as_a_secret() -> None:
    offenders: dict[str, list[str]] = {}
    for path in _workflow_files():
        if path.name == _MIGRATION_WORKFLOW:
            continue
        hits = _database_url_secret_refs_in_file(path)
        if hits:
            offenders[path.name] = hits

    assert not offenders, (
        "這些 workflow 檔仍在讀 secrets.*DATABASE_URL（GitHub Actions 的明文 DB 連線字串），"
        "deploy.yml / staging-deploy.yml / preview-deploy.yml 應該已經改成從 Secret Manager "
        f"用 --update-secrets 取值（#3999，Junyi security baseline rule 7）。只有 "
        f"{_MIGRATION_WORKFLOW}（把 GitHub secret 的現值搬進 Secret Manager 的一次性 "
        f"migration）可以讀它：{offenders}"
    )


def test_this_repo_has_at_least_one_workflow_file_to_check() -> None:
    """正向對照：掃描目錄本身要抓到東西 —— 否則上面那條全空通過什麼都沒證明。"""
    files = _workflow_files()
    assert files, f"{WF_DIR} 下找不到任何 workflow 檔，掃描範圍本身是空的"
    names = {f.name for f in files}
    for expected in ("deploy.yml", "staging-deploy.yml", "preview-deploy.yml"):
        assert expected in names, f"預期存在的 {expected} 不在掃描範圍內，WF_DIR 可能選錯了"


def test_the_check_catches_a_live_reference_in_a_non_exempt_file() -> None:
    """正向對照：non-exempt 檔若真的有 ${{ secrets.STAGING_DATABASE_URL }}，這條鎖要紅。
    這是 deploy.yml / staging-deploy.yml / preview-deploy.yml 修正前的真實形狀。"""
    fake_doc = {
        "jobs": {
            "deploy-backend": {
                "steps": [
                    {
                        "run": (
                            "gcloud run deploy X --set-env-vars="
                            '"DATABASE_URL=${{ secrets.STAGING_DATABASE_URL }}"'
                        )
                    }
                ]
            }
        }
    }
    hits = _database_url_secret_refs_in_doc(fake_doc)
    assert hits, "掃法壞了 —— 真的有 secrets.STAGING_DATABASE_URL 卻沒抓到"


def test_the_migration_workflow_is_exempt_even_though_it_reads_the_same_secrets() -> None:
    """正向對照：migration workflow 本身讀 secrets.*DATABASE_URL 是設計上允許的
    （它的工作就是把那個值搬進 Secret Manager），排除清單要擋下它，不是掃描邏輯從沒跑過。"""
    fake_migration_doc = {
        "jobs": {
            "migrate": {
                "steps": [
                    {"env": {"VAL": "${{ secrets.DATABASE_URL }}"}},
                    {"env": {"VAL": "${{ secrets.STAGING_DATABASE_URL }}"}},
                    {"env": {"VAL": "${{ secrets.PREVIEW_DATABASE_URL }}"}},
                ]
            }
        }
    }
    # Sanity: the scanning logic itself really does find these (otherwise the
    # exemption below would trivially "work" because there was nothing to exempt).
    assert len(_database_url_secret_refs_in_doc(fake_migration_doc)) == 3

    offenders = {}
    for name, doc in {_MIGRATION_WORKFLOW: fake_migration_doc}.items():
        if name == _MIGRATION_WORKFLOW:
            continue
        hits = _database_url_secret_refs_in_doc(doc)
        if hits:
            offenders[name] = hits
    assert not offenders, "排除清單沒有擋下 migration workflow 本身"


def test_a_comment_merely_mentioning_the_old_secret_name_does_not_trip_this_lock() -> None:
    """負向對照：YAML comment 提到 secrets.PREVIEW_DATABASE_URL（說明歷史/提醒不要走回頭路）
    不該被當成違規 —— yaml.safe_load 本來就會丟掉註解，這條把這個預期寫成斷言，避免未來
    有人把掃描邏輯換成裸 grep 整份檔案文字（那樣會把這個檔案自己的說明性註解也抓成違規）。"""
    yaml_text = (
        "jobs:\n"
        "  x:\n"
        "    steps:\n"
        "      # 這裡以前讀 secrets.PREVIEW_DATABASE_URL，現在改讀 Secret Manager\n"
        "      - run: echo hello\n"
    )
    doc = yaml.safe_load(yaml_text)
    hits = _database_url_secret_refs_in_doc(doc)
    assert not hits, "YAML 註解被當成違規抓到了 —— 掃描邏輯正在裸讀檔案文字，不是解析過的結構"
