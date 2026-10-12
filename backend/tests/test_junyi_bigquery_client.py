from app.services.junyi_bigquery_client import student_identity_id_from_user_id_key


def test_student_identity_id_rejects_empty_suffix():
    assert student_identity_id_from_user_id_key("user_id_key_") is None
    assert student_identity_id_from_user_id_key("user_id_key_abc123") == "abc123"
    assert student_identity_id_from_user_id_key("garbage") is None
