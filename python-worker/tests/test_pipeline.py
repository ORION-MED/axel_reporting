"""
Tests for python-worker/processing/pipeline.py

Run from the python-worker directory:
    pytest tests/test_pipeline.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
import polars as pl
from processing.pipeline import run_pipeline


def _df(**kw) -> pl.DataFrame:
    return pl.DataFrame(kw)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _impute(config: dict) -> list:
    return [{"type": "impute", "config": config}]

def _scale(config: dict) -> list:
    return [{"type": "scale", "config": config}]

def _outliers(config: dict) -> list:
    return [{"type": "outliers", "config": config}]

def _timeseries(config: dict) -> list:
    return [{"type": "timeseries", "config": config}]


# ── Impute: constant fill ─────────────────────────────────────────────────────

class TestImputeConstant:
    """Constant fill value must be coerced to the column's dtype.

    Before the fix, fill_null("5") on a Float64 column raised
    polars.exceptions.SchemaError: cannot cast String to Float64.
    """

    def test_float_column_string_value_coerced(self):
        df = _df(v=[1.0, None, 3.0])
        out = run_pipeline(df, _impute({"v": {"method": "constant", "value": "5"}}))
        assert out["v"].to_list() == pytest.approx([1.0, 5.0, 3.0])

    def test_int_column_string_value_coerced(self):
        df = pl.DataFrame({"v": pl.Series([1, None, 3], dtype=pl.Int64)})
        out = run_pipeline(df, _impute({"v": {"method": "constant", "value": "9"}}))
        assert out["v"].null_count() == 0
        assert out["v"][1] == 9

    def test_float_column_empty_value_defaults_to_zero(self):
        df = _df(v=[1.0, None, 3.0])
        out = run_pipeline(df, _impute({"v": {"method": "constant", "value": ""}}))
        assert out["v"][1] == pytest.approx(0.0)

    def test_float_column_non_numeric_value_defaults_to_zero(self):
        df = _df(v=[1.0, None, 3.0])
        out = run_pipeline(df, _impute({"v": {"method": "constant", "value": "not-a-number"}}))
        assert out["v"][1] == pytest.approx(0.0)

    def test_string_column_value_stored_as_string(self):
        df = pl.DataFrame({"v": pl.Series(["a", None, "b"], dtype=pl.Utf8)})
        out = run_pipeline(df, _impute({"v": {"method": "constant", "value": "42"}}))
        assert out["v"][1] == "42"

    def test_unknown_column_skipped(self):
        df = _df(v=[1.0, None])
        out = run_pipeline(df, _impute({"nonexistent": {"method": "constant", "value": "5"}}))
        assert out["v"].null_count() == 1


# ── Impute: statistical methods ───────────────────────────────────────────────

class TestImputeMean:
    def test_basic_mean_fill(self):
        df = _df(v=[1.0, None, 3.0])
        out = run_pipeline(df, _impute({"v": {"method": "mean"}}))
        assert out["v"][1] == pytest.approx(2.0)

    def test_all_null_mean_is_noop(self):
        df = pl.DataFrame({"v": pl.Series([None, None], dtype=pl.Float64)})
        out = run_pipeline(df, _impute({"v": {"method": "mean"}}))
        assert out["v"].null_count() == 2

    def test_median_fill(self):
        df = _df(v=[1.0, None, 3.0, 5.0])
        out = run_pipeline(df, _impute({"v": {"method": "median"}}))
        assert out["v"][1] == pytest.approx(3.0)

    def test_drop_removes_null_rows(self):
        df = _df(v=[1.0, None, 3.0])
        out = run_pipeline(df, _impute({"v": {"method": "drop"}}))
        assert len(out) == 2
        assert out["v"].null_count() == 0


# ── Scale: null guard ─────────────────────────────────────────────────────────

class TestScaleNullGuard:
    """All-null columns must be skipped, not crash.

    Before the fix, s.min() returned None for an all-null column,
    and (mx - mn) == (None - None) raised TypeError.
    """

    @pytest.mark.parametrize("method", [
        "minmax", "minmax_sym", "robust", "standard",
        "center_only", "unit_variance", "maxabs", "percentile",
    ])
    def test_all_null_does_not_crash(self, method):
        df = pl.DataFrame({"a": pl.Series([None, None, None], dtype=pl.Float64)})
        out = run_pipeline(df, _scale({"a": {"method": method}}))
        assert out["a"].null_count() == 3

    def test_minmax_normal_column(self):
        df = _df(v=[0.0, 5.0, 10.0])
        out = run_pipeline(df, _scale({"v": {"method": "minmax"}}))
        assert out["v"].to_list() == pytest.approx([0.0, 0.5, 1.0])

    def test_standard_zero_std_does_not_crash(self):
        df = _df(v=[5.0, 5.0, 5.0])
        out = run_pipeline(df, _scale({"v": {"method": "standard"}}))
        assert out["v"].null_count() == 0

    def test_all_null_column_alongside_valid_column_unaffected(self):
        df = pl.DataFrame({
            "nulls": pl.Series([None, None, None], dtype=pl.Float64),
            "vals":  [0.0, 5.0, 10.0],
        })
        out = run_pipeline(df, _scale({
            "nulls": {"method": "minmax"},
            "vals":  {"method": "minmax"},
        }))
        assert out["nulls"].null_count() == 3
        assert out["vals"].to_list() == pytest.approx([0.0, 0.5, 1.0])


# ── Outliers: null guard ──────────────────────────────────────────────────────

class TestOutliersNullGuard:
    """All-null columns must be skipped, not crash.

    Before the fix, s.quantile(0.25) returned None and
    iqr_val = q3 - q1 == None - None raised TypeError.
    """

    @pytest.mark.parametrize("method", ["iqr", "zscore", "robust_zscore", "percentile"])
    def test_all_null_does_not_crash(self, method):
        df = pl.DataFrame({"a": pl.Series([None, None, None], dtype=pl.Float64)})
        out = run_pipeline(df, _outliers({"a": {"method": method}}))
        assert len(out) == 3

    def test_iqr_removes_extreme_outlier(self):
        df = _df(v=[1.0, 2.0, 3.0, 100.0])
        out = run_pipeline(df, _outliers({"v": {"method": "iqr", "iqrK": 1.5}}))
        assert 100.0 not in out["v"].to_list()

    def test_iqr_keeps_null_rows(self):
        df = pl.DataFrame({"v": pl.Series([1.0, None, 3.0], dtype=pl.Float64)})
        out = run_pipeline(df, _outliers({"v": {"method": "iqr"}}))
        assert out["v"].null_count() == 1

    def test_zscore_removes_extreme_value(self):
        base = [1.0] * 10 + [1000.0]
        df = _df(v=base)
        out = run_pipeline(df, _outliers({"v": {"method": "zscore", "zThreshold": 2}}))
        assert 1000.0 not in out["v"].to_list()

    def test_all_null_alongside_valid_column(self):
        df = pl.DataFrame({
            "nulls": pl.Series([None, None, None, None], dtype=pl.Float64),
            "vals":  [1.0, 2.0, 3.0, 100.0],
        })
        out = run_pipeline(df, _outliers({
            "nulls": {"method": "iqr"},
            "vals":  {"method": "iqr", "iqrK": 1.5},
        }))
        assert 100.0 not in out["vals"].to_list()


# ── Timeseries: null guard ────────────────────────────────────────────────────

class TestTimeseriesNullGuard:
    """All-null columns must not crash timeseries normalize/standardize.

    Before the fix, (mx - mn) where both are None raised TypeError.
    """

    @pytest.mark.parametrize("method", ["normalize", "standardize", "mean_fill", "median_fill"])
    def test_all_null_does_not_crash(self, method):
        df = pl.DataFrame({"a": pl.Series([None, None, None], dtype=pl.Float64)})
        out = run_pipeline(df, _timeseries({"method": method, "fields": ["a"]}))
        assert out["a"].null_count() == 3

    def test_normalize_normal_column(self):
        df = _df(v=[0.0, 5.0, 10.0])
        out = run_pipeline(df, _timeseries({"method": "normalize", "fields": ["v"]}))
        assert out["v"].to_list() == pytest.approx([0.0, 0.5, 1.0])

    def test_mean_fill_fills_nulls(self):
        df = _df(v=[1.0, None, 3.0])
        out = run_pipeline(df, _timeseries({"method": "mean_fill", "fields": ["v"]}))
        assert out["v"][1] == pytest.approx(2.0)

    def test_ffill(self):
        df = _df(v=[1.0, None, None, 4.0])
        out = run_pipeline(df, _timeseries({"method": "ffill", "fields": ["v"]}))
        assert out["v"].to_list() == pytest.approx([1.0, 1.0, 1.0, 4.0])


# ── Encode ────────────────────────────────────────────────────────────────────

class TestEncode:
    def test_label_encode_assigns_integers(self):
        df = pl.DataFrame({"cat": pl.Series(["a", "b", "a", None])})
        out = run_pipeline(df, [{"type": "encode", "config": {"cat": {"method": "label"}}}])
        vals = out["cat"].to_list()
        assert all(isinstance(v, int) for v in vals)
        assert vals[0] == vals[2]

    def test_onehot_adds_columns(self):
        df = pl.DataFrame({"cat": pl.Series(["x", "y", "x"])})
        out = run_pipeline(df, [{"type": "encode", "config": {"cat": {"method": "onehot"}}}])
        assert "cat" not in out.columns
        assert any("cat__" in c for c in out.columns)


# ── Pipeline: multiple steps ──────────────────────────────────────────────────

class TestMultiStep:
    def test_impute_then_scale(self):
        df = _df(v=[0.0, None, 10.0])
        out = run_pipeline(df, [
            *_impute({"v": {"method": "mean"}}),
            *_scale({"v": {"method": "minmax"}}),
        ])
        assert out["v"].null_count() == 0
        assert out["v"].min() == pytest.approx(0.0)
        assert out["v"].max() == pytest.approx(1.0)

    def test_empty_steps_returns_unchanged(self):
        df = _df(v=[1.0, 2.0, 3.0])
        out = run_pipeline(df, [])
        assert out.equals(df)
