from app.services.junyi_bigquery_client import student_identity_id_from_user_id_key


def test_student_identity_id_rejects_empty_suffix():
    assert student_identity_id_from_user_id_key("user_id_key_") is None
    assert student_identity_id_from_user_id_key("user_id_key_abc123") == "abc123"
    assert student_identity_id_from_user_id_key("garbage") is None


def test_impersonated_credentials_request_a_scope_that_can_run_queries(monkeypatch):
    """Running a query creates a BigQuery job (jobs.insert), which the
    bigquery.readonly scope does not allow: staging returned
    403 "Request had insufficient authentication scopes" with the right IAM
    roles in place (#3380, 2026-10-12). The impersonated token must carry the
    full bigquery scope (or cloud-platform)."""
    import google.auth
    from google.auth import impersonated_credentials

    from app.config import settings
    from app.services import junyi_bigquery_client as mod

    captured = {}

    class FakeCreds:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(google.auth, "default", lambda *a, **k: (object(), "lingoleap-dev"))
    monkeypatch.setattr(impersonated_credentials, "Credentials", FakeCreds)
    monkeypatch.setattr(
        settings,
        "junyi_bigquery_service_account",
        "lingoleap-junyi-bq@lingoleap-dev.iam.gserviceaccount.com",
    )

    creds = mod._impersonated_credentials()

    assert isinstance(creds, FakeCreds)
    assert captured["target_principal"] == "lingoleap-junyi-bq@lingoleap-dev.iam.gserviceaccount.com"
    scopes = set(captured["target_scopes"])
    assert scopes & {
        "https://www.googleapis.com/auth/bigquery",
        "https://www.googleapis.com/auth/cloud-platform",
    }, f"scope cannot create query jobs: {sorted(scopes)}"
