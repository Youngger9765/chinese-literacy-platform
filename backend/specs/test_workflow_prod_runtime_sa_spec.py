"""Prod backend runs as its own runtime identity (#4038).

`lingoleap-junyi-bq` used to be the runtime identity of BOTH the staging and
the prod backend, and it holds the prod DATABASE_URL secret and the prod
buckets. The plan is to shrink it to a BigQuery-only identity that both
runtimes impersonate (`junyi_bigquery_service_account` in
backend/app/config.py). For that, prod must stop *running as* it:
the prod backend runs as `lingoleap-backend-prod-rt`, which holds the prod
resources plus serviceAccountTokenCreator on junyi-bq.

Only after this is deployed and verified on prod are junyi-bq's prod grants
removed (tracked on #4038) — until then both identities have prod access.
"""
from __future__ import annotations

import pathlib
import re

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"

PROD_RT = "lingoleap-backend-prod-rt@lingoleap-dev.iam.gserviceaccount.com"
SHARED_BQ = "lingoleap-junyi-bq@lingoleap-dev.iam.gserviceaccount.com"


def _backend_deploy_block(name: str) -> str:
    raw = (WF / name).read_text(encoding="utf-8")
    blocks = raw.split("gcloud run deploy")
    assert len(blocks) >= 3, f"{name}: expected backend + frontend deploy blocks"
    block = blocks[1]
    assert "BACKEND_SERVICE" in block, f"{name}: first deploy is not the backend"
    return block.split("\n      - name:")[0]


def test_prod_backend_runs_as_prod_only_account():
    block = _backend_deploy_block("deploy.yml")
    m = re.findall(r"--service-account[= ]+(\S+)", block)
    assert m == [PROD_RT], (
        f"prod backend runs as {m}; it must be [{PROD_RT}] so junyi-bq can be "
        "reduced to a BigQuery-only identity (#4038)"
    )
    assert SHARED_BQ not in block
