"""Backend runtime identities must be split per environment (#4038).

Staging and prod backends used to run as the same service account
(`lingoleap-junyi-bq`), and that account can read the **prod** database URL
secret and write the **prod** upload/recording buckets. So any bug on staging
that lets someone use the runtime identity reached prod data.

Staging now runs as `lingoleap-backend-staging-rt`, which only has staging
resources. BigQuery still goes through `lingoleap-junyi-bq` by impersonation
(`junyi_bigquery_service_account` in backend/app/config.py), because Junyi
granted the table access to that account in their own project.

The staging deploy also must *set* (not *add*) its Cloud SQL instances:
`--add-cloudsql-instances` is cumulative across revisions, which is how the
staging backend ended up still attached to the prod instance `lingoleap-db`.
"""
from __future__ import annotations

import pathlib
import re

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"

STAGING_RT = "lingoleap-backend-staging-rt@lingoleap-dev.iam.gserviceaccount.com"
SHARED_BQ = "lingoleap-junyi-bq@lingoleap-dev.iam.gserviceaccount.com"
STAGING_DB = "lingoleap-dev:asia-east1:lingoleap-staging-db"


def _backend_deploy_block(name: str) -> str:
    raw = (WF / name).read_text(encoding="utf-8")
    blocks = raw.split("gcloud run deploy")
    assert len(blocks) >= 3, f"{name}: expected backend + frontend deploy blocks"
    block = blocks[1]
    assert "BACKEND_SERVICE" in block, f"{name}: first deploy is not the backend"
    # Stop at the end of this run step so later steps are not scanned.
    return block.split("\n      - name:")[0]


def _service_account(block: str) -> str:
    m = re.findall(r"--service-account[= ]+(\S+)", block)
    assert len(m) == 1, f"expected exactly one --service-account, got {m}"
    return m[0]


def test_staging_backend_runs_as_staging_only_account():
    block = _backend_deploy_block("staging-deploy.yml")
    sa = _service_account(block)
    assert sa == STAGING_RT, (
        f"staging backend runs as {sa}; it must be {STAGING_RT} so a staging "
        "bug cannot reach the prod DB secret or prod buckets (#4038)"
    )
    assert SHARED_BQ not in block


def test_staging_backend_sets_only_the_staging_cloudsql_instance():
    block = _backend_deploy_block("staging-deploy.yml")
    assert "--add-cloudsql-instances" not in block, (
        "--add-cloudsql-instances is cumulative; use --set-cloudsql-instances"
    )
    m = re.findall(r"--set-cloudsql-instances[= ]+(\S+)", block)
    assert m == [STAGING_DB], f"staging Cloud SQL instances must be only {STAGING_DB}, got {m}"
