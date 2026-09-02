from jobs import profile


def test_profile_job_finishes_slow_stats_before_completion(monkeypatch):
    events = []
    uploaded_json = {}
    artifacts = []
    profile_states = []
    dataframe = object()

    monkeypatch.setattr(
        profile,
        "get_upload",
        lambda upload_id: {
            "s3_raw_key": "raw/source.xlsx",
            "original_filename": "source.xlsx",
            "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
    )
    monkeypatch.setattr(profile, "is_job_cancelled", lambda job_id: False)
    monkeypatch.setattr(profile, "load_dataframe", lambda *args, **kwargs: dataframe)
    monkeypatch.setattr(
        profile,
        "build_dataset_stats",
        lambda df: ({"fast": True}, {"rowCount": 2}),
    )
    monkeypatch.setattr(
        profile,
        "build_pvalue_matrix",
        lambda df: events.append("pvalue") or {"matrix": [[1]]},
    )
    monkeypatch.setattr(
        profile,
        "build_slow_stats",
        lambda df: events.append("slow") or {"vif": []},
    )
    monkeypatch.setattr(
        profile,
        "upload_json",
        lambda key, value: uploaded_json.__setitem__(key, value),
    )
    monkeypatch.setattr(
        profile,
        "export_dataframe",
        lambda *args: ("staging/1/upload/source.parquet", 123),
    )
    monkeypatch.setattr(
        profile,
        "insert_artifact",
        lambda job_id, artifact_type, artifact_format, key, size: artifacts.append(artifact_type),
    )
    monkeypatch.setattr(
        profile,
        "upsert_dataset_profile",
        lambda upload_id, status, **kwargs: profile_states.append(status),
    )
    monkeypatch.setattr(
        profile,
        "update_job_status",
        lambda job_id, status, **kwargs: events.append(
            f"status:{status}:{kwargs.get('progress')}"
        ),
    )

    profile.handle_profile_job({
        "id": "job-1",
        "upload_id": "upload-1",
        "user_id": 1,
    })

    assert "pvalue" in events
    assert "slow" in events
    assert events[-1] == "status:completed:100"
    assert profile_states[-1] == "full_stats_ready"
    assert "pvalue_matrix" in artifacts
    assert uploaded_json["stats/1/upload-1/dataset_stats.json"] == {
        "fast": True,
        "vif": [],
    }
