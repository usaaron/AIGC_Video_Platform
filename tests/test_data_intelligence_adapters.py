from app.modules.data_intelligence.adapters import (
    ManualCSVImportAdapter,
    ManualJSONImportAdapter,
)


def test_manual_json_import_adapter_parses_records() -> None:
    adapter = ManualJSONImportAdapter()
    records = adapter.parse(
        [
            {
                "source_name": "manual_json",
                "source_item_id": "item_001",
                "platform": "tiktok",
                "title": "Revenge wedding drama",
                "body_text": "A revenge romance erupts during a wedding ceremony.",
                "author_handle": "creator_a",
                "language": "en",
                "region": "US",
                "engagement": {
                    "view_count": 100000,
                    "like_count": 12000,
                    "comment_count": 900,
                    "share_count": 700,
                    "save_count": 500,
                    "completion_rate": 0.62,
                },
            }
        ]
    )
    assert len(records) == 1
    assert records[0].source_item_id == "item_001"


def test_manual_csv_import_adapter_parses_records() -> None:
    adapter = ManualCSVImportAdapter()
    csv_content = (
        "source_name,source_item_id,platform,title,body_text,author_handle,language,region,"
        "view_count,like_count,comment_count,share_count,save_count,completion_rate\n"
        "manual_csv,item_002,tiktok,Fake marriage drama,"
        "\"A fake marriage turns into public revenge.\",creator_b,en,US,"
        "200000,18000,1200,900,800,0.71\n"
    )
    records = adapter.parse(csv_content)
    assert len(records) == 1
    assert records[0].engagement.view_count == 200000


def test_manual_csv_import_adapter_requires_explicit_platform_and_language_fields() -> None:
    adapter = ManualCSVImportAdapter()
    csv_content = (
        "source_name,source_item_id,platform,title,body_text,author_handle,language,region,"
        "view_count,like_count,comment_count,share_count,save_count,completion_rate\n"
        "manual_csv,item_003,,Fake marriage drama,"
        "\"A fake marriage turns into public revenge.\",creator_b,,US,"
        "200000,18000,1200,900,800,0.71\n"
    )

    try:
        adapter.parse(csv_content)
    except ValueError as exc:
        assert "platform" in str(exc) or "language" in str(exc)
    else:
        raise AssertionError("Expected ManualCSVImportAdapter to reject missing explicit fields.")
