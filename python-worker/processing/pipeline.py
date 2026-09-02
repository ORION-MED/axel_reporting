import math
import numpy as np
import polars as pl
from typing import Any


def run_pipeline(
    source: "pl.DataFrame | pl.LazyFrame",
    steps: list[dict],
) -> pl.DataFrame:
    """Execute preprocessing steps with minimal intermediate materializations.

    Accepts either a DataFrame or a LazyFrame (e.g. from scan_parquet).
    Pure-expression steps (scale, impute, outliers, timeseries, window_split)
    are chained lazily; encode steps that require group_by/join force a single
    intermediate collect and then continue lazily again.
    """
    lf: pl.LazyFrame = source if isinstance(source, pl.LazyFrame) else source.lazy()

    for step in steps:
        step_type = step.get("type")
        config: dict[str, Any] = step.get("config", {})
        if step_type == "impute":
            lf = _apply_impute(lf, config)
        elif step_type == "scale":
            lf = _apply_scale(lf, config)
        elif step_type == "encode":
            df_enc = lf.collect()
            lf = _apply_encode(df_enc, config).lazy()
        elif step_type == "outliers":
            lf = _apply_outliers(lf, config)
        elif step_type == "timeseries":
            lf = _apply_timeseries(lf, config)
        elif step_type == "window_split":
            lf = _apply_window_split(lf, config)

    return lf.collect()


# ──────────────────────────────────────────────────────────────────────────────
# IMPUTE
# ──────────────────────────────────────────────────────────────────────────────

def _apply_impute(lf: pl.LazyFrame, config: dict) -> pl.LazyFrame:
    schema = lf.collect_schema()
    cols = set(schema.names())

    pure_exprs: list[pl.Expr] = []
    scalar_cols: list[tuple[str, str]] = []   # (col, method) for mean/median
    mode_cols:   list[str]            = []
    drop_cols:   list[str]            = []

    for col, cfg in config.items():
        if col not in cols:
            continue
        method = cfg.get("method", "mean")

        if method == "drop":
            drop_cols.append(col)
        elif method == "ffill":
            pure_exprs.append(pl.col(col).forward_fill())
        elif method == "bfill":
            pure_exprs.append(pl.col(col).backward_fill())
        elif method == "linear":
            pure_exprs.append(
                pl.col(col).cast(pl.Float64, strict=False).interpolate("linear")
            )
        elif method == "constant":
            raw = cfg.get("value", "")
            dtype = schema[col]
            if dtype.is_numeric():
                try:
                    fv: float | int | str = float(raw) if raw != "" else 0.0
                    if dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64,
                                 pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64):
                        fv = int(fv)
                except (ValueError, TypeError):
                    fv = 0
            else:
                fv = str(raw) if raw is not None else ""
            pure_exprs.append(pl.col(col).fill_null(fv))
        elif method in ("mean", "median"):
            scalar_cols.append((col, method))
        elif method == "mode":
            mode_cols.append(col)

    scalar_exprs: list[pl.Expr] = []

    if scalar_cols:
        # ONE lazy scan for all mean/median scalars
        agg = [
            (pl.col(c).cast(pl.Float64, strict=False).mean()
             if m == "mean"
             else pl.col(c).cast(pl.Float64, strict=False).median()
             ).alias(f"__imp_{c}")
            for c, m in scalar_cols
        ]
        sc = lf.select(agg).collect().to_dicts()[0]
        for col, _ in scalar_cols:
            fill = sc.get(f"__imp_{col}")
            if fill is not None:
                scalar_exprs.append(pl.col(col).fill_null(fill))

    if mode_cols:
        # Collect only the mode columns (projection pushdown keeps this cheap)
        mode_df = lf.select(mode_cols).collect()
        for col in mode_cols:
            modes = mode_df[col].drop_nulls().mode()
            if len(modes) > 0:
                scalar_exprs.append(pl.col(col).fill_null(modes[0]))

    all_exprs = pure_exprs + scalar_exprs
    if all_exprs:
        lf = lf.with_columns(all_exprs)
    if drop_cols:
        lf = lf.filter(
            pl.all_horizontal([pl.col(c).is_not_null() for c in drop_cols])
        )
    return lf


# ──────────────────────────────────────────────────────────────────────────────
# SCALE
# ──────────────────────────────────────────────────────────────────────────────

def _apply_scale(lf: pl.LazyFrame, config: dict) -> pl.LazyFrame:
    cols = set(lf.collect_schema().names())
    active = {c: cfg for c, cfg in config.items() if c in cols}
    if not active:
        return lf

    # Build all aggregate expressions needed across every column in ONE scan
    agg: list[pl.Expr] = []
    for col, cfg in active.items():
        method = cfg.get("method", "minmax")
        fc = pl.col(col).cast(pl.Float64, strict=False)
        if method == "standard":
            agg += [fc.mean().alias(f"_sm_{col}"), fc.std().alias(f"_ss_{col}")]
        elif method == "center_only":
            agg += [fc.mean().alias(f"_sm_{col}")]
        elif method == "unit_variance":
            agg += [fc.std().alias(f"_ss_{col}")]
        elif method in ("minmax", "minmax_sym"):
            agg += [fc.min().alias(f"_sn_{col}"), fc.max().alias(f"_sx_{col}")]
        elif method == "maxabs":
            agg += [fc.abs().max().alias(f"_sa_{col}")]
        elif method == "robust":
            agg += [
                fc.median().alias(f"_sm_{col}"),
                fc.quantile(0.25).alias(f"_sq1_{col}"),
                fc.quantile(0.75).alias(f"_sq3_{col}"),
            ]
        elif method == "percentile":
            p_low  = cfg.get("pLow",  5) / 100
            p_high = cfg.get("pHigh", 95) / 100
            agg += [
                fc.quantile(p_low ).alias(f"_slo_{col}"),
                fc.quantile(p_high).alias(f"_shi_{col}"),
            ]

    sc = lf.select(agg).collect().to_dicts()[0]

    exprs: list[pl.Expr] = []
    for col, cfg in active.items():
        method = cfg.get("method", "minmax")
        c = pl.col(col).cast(pl.Float64, strict=False)

        if method == "standard":
            mu    = sc.get(f"_sm_{col}")
            sigma = sc.get(f"_ss_{col}") or 1.0
            if mu is not None:
                exprs.append(((c - mu) / sigma).alias(col))
        elif method == "center_only":
            mu = sc.get(f"_sm_{col}")
            if mu is not None:
                exprs.append((c - mu).alias(col))
        elif method == "unit_variance":
            sigma = sc.get(f"_ss_{col}") or 1.0
            exprs.append((c / sigma).alias(col))
        elif method == "minmax":
            mn, mx = sc.get(f"_sn_{col}"), sc.get(f"_sx_{col}")
            if mn is not None and mx is not None:
                rng = (mx - mn) or 1.0
                exprs.append(((c - mn) / rng).alias(col))
        elif method == "minmax_sym":
            mn, mx = sc.get(f"_sn_{col}"), sc.get(f"_sx_{col}")
            if mn is not None and mx is not None:
                rng = (mx - mn) or 1.0
                exprs.append((2.0 * (c - mn) / rng - 1.0).alias(col))
        elif method == "maxabs":
            ma = sc.get(f"_sa_{col}") or 1.0
            exprs.append((c / ma).alias(col))
        elif method == "robust":
            med = sc.get(f"_sm_{col}")
            q1  = sc.get(f"_sq1_{col}")
            q3  = sc.get(f"_sq3_{col}")
            if med is not None and q1 is not None and q3 is not None:
                iqr_val = (q3 - q1) or 1.0
                exprs.append(((c - med) / iqr_val).alias(col))
        elif method == "percentile":
            lo = sc.get(f"_slo_{col}")
            hi = sc.get(f"_shi_{col}")
            if lo is not None and hi is not None:
                rng = (hi - lo) or 1.0
                exprs.append(((c - lo) / rng).clip(0.0, 1.0).alias(col))

    return lf.with_columns(exprs) if exprs else lf


# ──────────────────────────────────────────────────────────────────────────────
# ENCODE  (requires group_by / join — must work on a materialised DataFrame)
# ──────────────────────────────────────────────────────────────────────────────

def _apply_encode(df: pl.DataFrame, config: dict) -> pl.DataFrame:
    for col, cfg in config.items():
        if col not in df.columns:
            continue
        method = cfg.get("method", "label")

        if method == "label":
            cats = sorted(
                df[col].drop_nulls().cast(pl.Utf8).unique().to_list(),
                key=lambda x: x.lower(),
            )
            null_code = len(cats)
            df = df.with_columns(
                pl.col(col).cast(pl.Utf8)
                  .replace(
                      old=pl.Series(cats),
                      new=pl.Series(list(range(null_code)), dtype=pl.Int64),
                  )
                  .cast(pl.Int64, strict=False)
                  .fill_null(null_code)
                  .alias(col)
            )

        elif method == "ordinal":
            order = cfg.get("ordinalOrder") or sorted(
                df[col].drop_nulls().cast(pl.Utf8).unique().to_list(),
                key=lambda x: x.lower(),
            )
            null_code = len(order)
            df = df.with_columns(
                pl.col(col).cast(pl.Utf8)
                  .replace(
                      old=pl.Series(order),
                      new=pl.Series(list(range(null_code)), dtype=pl.Int64),
                  )
                  .cast(pl.Int64, strict=False)
                  .fill_null(null_code)
                  .alias(col)
            )

        elif method == "frequency":
            total = len(df)
            freq_df = (
                df.select(pl.col(col).cast(pl.Utf8).alias(col))
                  .group_by(col)
                  .agg((pl.len().cast(pl.Float64) / total).round(8).alias("_freq"))
            )
            df = df.with_columns(pl.col(col).cast(pl.Utf8))
            df = df.join(freq_df, on=col, how="left")
            df = df.with_columns(pl.col("_freq").alias(col)).drop("_freq")

        elif method == "count":
            cnt_df = (
                df.select(pl.col(col).cast(pl.Utf8).alias(col))
                  .group_by(col)
                  .agg(pl.len().cast(pl.Int64).alias("_cnt"))
            )
            df = df.with_columns(pl.col(col).cast(pl.Utf8))
            df = df.join(cnt_df, on=col, how="left")
            df = df.with_columns(pl.col("_cnt").alias(col)).drop("_cnt")

        elif method == "onehot":
            df = df.with_columns(pl.col(col).cast(pl.Utf8))
            dummies = df.select(col).to_dummies(separator="__").cast(pl.Int8)
            df = pl.concat([df.drop(col), dummies], how="horizontal")

        elif method == "target":
            target_field = cfg.get("targetField")
            if target_field and target_field in df.columns:
                global_mean = df[target_field].cast(pl.Float64, strict=False).mean()
                means_df = (
                    df.select([col, target_field])
                      .group_by(col)
                      .agg(
                          pl.col(target_field).cast(pl.Float64, strict=False)
                            .mean().round(8).alias("_mean")
                      )
                )
                df = df.join(means_df, on=col, how="left")
                df = df.with_columns(
                    pl.col("_mean").fill_null(global_mean).alias(col)
                ).drop("_mean")

        elif method == "loo":
            target_field = cfg.get("targetField")
            if target_field and target_field in df.columns:
                t_col = pl.col(target_field).cast(pl.Float64, strict=False)
                global_mean = df[target_field].cast(pl.Float64, strict=False).mean()
                agg_df = (
                    df.select([col, target_field])
                      .group_by(col)
                      .agg([
                          t_col.sum().alias("_sum"),
                          t_col.count().alias("_cnt"),
                      ])
                )
                df = df.join(agg_df, on=col, how="left")
                df = df.with_columns(t_col.alias("_t_num"))
                df = df.with_columns(
                    pl.when(pl.col("_cnt") > 1)
                      .then(
                          ((pl.col("_sum") - pl.col("_t_num"))
                           / (pl.col("_cnt") - 1).clip(lower_bound=1))
                          .round(8)
                      )
                      .otherwise(global_mean)
                      .alias(col)
                ).drop(["_sum", "_cnt", "_t_num"])

        elif method == "woe":
            target_field = cfg.get("targetField")
            if target_field and target_field in df.columns:
                target = df[target_field].cast(pl.Float64, strict=False)
                total_events     = int((target == 1).sum())
                total_non_events = int((target == 0).sum())
                if total_events and total_non_events:
                    t_col = pl.col(target_field).cast(pl.Float64, strict=False)
                    woe_df = (
                        df.select([col, target_field])
                          .group_by(col)
                          .agg([
                              (t_col == 1).sum().cast(pl.Float64).alias("_ev"),
                              (t_col == 0).sum().cast(pl.Float64).alias("_ne"),
                          ])
                          .with_columns(
                              (
                                  (pl.col("_ev").clip(lower_bound=0.5) / total_events)
                                  / (pl.col("_ne").clip(lower_bound=0.5) / total_non_events)
                              ).log(base=math.e).round(8).alias("_woe")
                          )
                          .select([col, "_woe"])
                    )
                    df = df.join(woe_df, on=col, how="left")
                    df = df.with_columns(pl.col("_woe").alias(col)).drop("_woe")

    return df


# ──────────────────────────────────────────────────────────────────────────────
# OUTLIERS
# ──────────────────────────────────────────────────────────────────────────────

def _apply_outliers(lf: pl.LazyFrame, config: dict) -> pl.LazyFrame:
    cols = set(lf.collect_schema().names())
    active = {c: cfg for c, cfg in config.items() if c in cols}
    if not active:
        return lf

    # Build aggregate expressions for ALL methods in one scan
    agg: list[pl.Expr] = []
    for col, cfg in active.items():
        method = cfg.get("method", "iqr")
        fc = pl.col(col).cast(pl.Float64, strict=False)
        if method == "iqr":
            agg += [
                fc.quantile(0.25).alias(f"_oq1_{col}"),
                fc.quantile(0.75).alias(f"_oq3_{col}"),
            ]
        elif method == "zscore":
            agg += [fc.mean().alias(f"_om_{col}"), fc.std().alias(f"_os_{col}")]
        elif method == "robust_zscore":
            # MAD = median(|x - median(x)|) — expressible as a lazy aggregate
            agg += [
                fc.median().alias(f"_omed_{col}"),
                (fc - fc.median()).abs().median().alias(f"_omad_{col}"),
            ]
        elif method == "percentile":
            p_low  = cfg.get("pLow",  1) / 100
            p_high = cfg.get("pHigh", 99) / 100
            agg += [
                fc.quantile(p_low ).alias(f"_olo_{col}"),
                fc.quantile(p_high).alias(f"_ohi_{col}"),
            ]

    sc = lf.select(agg).collect().to_dicts()[0]

    filter_exprs: list[pl.Expr] = []
    for col, cfg in active.items():
        method = cfg.get("method", "iqr")
        c = pl.col(col).cast(pl.Float64, strict=False)

        if method == "iqr":
            k  = cfg.get("iqrK", 1.5)
            q1 = sc.get(f"_oq1_{col}")
            q3 = sc.get(f"_oq3_{col}")
            if q1 is None or q3 is None:
                continue
            iqr_val = q3 - q1
            lower, upper = q1 - k * iqr_val, q3 + k * iqr_val
        elif method == "zscore":
            t     = cfg.get("zThreshold", 3)
            mu    = sc.get(f"_om_{col}")
            sigma = sc.get(f"_os_{col}") or 1.0
            if mu is None:
                continue
            lower, upper = mu - t * sigma, mu + t * sigma
        elif method == "robust_zscore":
            t     = cfg.get("zThreshold", 3.5)
            med   = sc.get(f"_omed_{col}")
            mad   = sc.get(f"_omad_{col}") or 1.0
            sigma = (mad / 0.6745) or 1.0
            if med is None:
                continue
            lower, upper = med - t * sigma, med + t * sigma
        elif method == "percentile":
            lower = sc.get(f"_olo_{col}")
            upper = sc.get(f"_ohi_{col}")
            if lower is None or upper is None:
                continue
        else:
            continue

        filter_exprs.append(c.is_null() | ((c >= lower) & (c <= upper)))

    if not filter_exprs:
        return lf

    combined = filter_exprs[0]
    for e in filter_exprs[1:]:
        combined = combined & e
    return lf.filter(combined)


# ──────────────────────────────────────────────────────────────────────────────
# TIMESERIES
# ──────────────────────────────────────────────────────────────────────────────

def _apply_timeseries(lf: pl.LazyFrame, config: dict) -> pl.LazyFrame:
    method  = config.get("method", "mean_fill")
    fields: list[str] = config.get("fields", [])
    window  = int(config.get("window", 3))
    alpha   = float(config.get("alpha", 0.3))
    lam     = float(config.get("lambda", 0.5))

    cols = set(lf.collect_schema().names())
    active_fields = [f for f in fields if f in cols]
    if not active_fields:
        return lf

    # Methods that need data-derived scalars
    _SCALAR_METHODS = {"mean_fill", "median_fill", "normalize", "standardize"}

    if method not in _SCALAR_METHODS:
        # Pure-expression path — build all exprs, no collect needed
        exprs: list[pl.Expr] = []
        for field in active_fields:
            c = pl.col(field).cast(pl.Float64, strict=False)
            if method == "ffill":
                exprs.append(c.forward_fill().alias(field))
            elif method == "bfill":
                exprs.append(c.backward_fill().alias(field))
            elif method == "linear":
                exprs.append(c.interpolate("linear").alias(field))
            elif method == "rolling_mean_fill":
                roll = c.rolling_mean(window_size=window, center=True, min_periods=1)
                exprs.append(c.fill_null(roll).alias(field))
            elif method == "rolling_mean":
                exprs.append(
                    c.rolling_mean(window_size=window, center=True, min_periods=1).alias(field)
                )
            elif method == "rolling_median":
                exprs.append(
                    c.rolling_median(window_size=window, center=True, min_periods=1).alias(field)
                )
            elif method == "ewm":
                exprs.append(c.ewm_mean(alpha=alpha, adjust=False).alias(field))
            elif method == "log_transform":
                exprs.append(
                    pl.when(c > 0).then(c.log(base=math.e)).otherwise(None).alias(field)
                )
            elif method == "boxcox":
                if abs(lam) < 1e-6:
                    exprs.append(
                        pl.when(c > 0).then(c.log(base=math.e)).otherwise(None).alias(field)
                    )
                else:
                    exprs.append(
                        pl.when(c > 0)
                          .then(((c ** lam) - 1.0) / lam)
                          .otherwise(None)
                          .alias(field)
                    )
            elif method == "diff":
                exprs.append(c.diff(n=window).alias(field))
            elif method == "seasonal_diff":
                exprs.append(c.diff(n=window).alias(field))
            elif method == "lag_feature":
                exprs.append(c.shift(window).alias(f"{field}_lag{window}"))
            elif method in ("polynomial_fill", "spline_fill"):
                # scipy interpolation needs materialised numpy — keep eager per field
                kind = "quadratic" if method == "polynomial_fill" else "cubic"
                arr = lf.select(pl.col(field)).collect()[field].to_numpy()
                arr = _scipy_interp(arr, kind=kind)
                exprs.append(pl.lit(pl.Series(name=field, values=arr)))
        return lf.with_columns(exprs) if exprs else lf

    # Scalar path — compute all needed scalars in ONE scan then stay lazy
    agg: list[pl.Expr] = []
    for field in active_fields:
        fc = pl.col(field).cast(pl.Float64, strict=False)
        if method == "mean_fill":
            agg.append(fc.mean().alias(f"_ts_{field}"))
        elif method == "median_fill":
            agg.append(fc.median().alias(f"_ts_{field}"))
        elif method == "normalize":
            agg += [fc.min().alias(f"_tsn_{field}"), fc.max().alias(f"_tsx_{field}")]
        elif method == "standardize":
            agg += [fc.mean().alias(f"_ts_{field}"), fc.std().alias(f"_tss_{field}")]

    sc = lf.select(agg).collect().to_dicts()[0]

    exprs = []
    for field in active_fields:
        c = pl.col(field).cast(pl.Float64, strict=False)
        if method == "mean_fill":
            fill = sc.get(f"_ts_{field}")
            if fill is not None:
                exprs.append(c.fill_null(fill).alias(field))
        elif method == "median_fill":
            fill = sc.get(f"_ts_{field}")
            if fill is not None:
                exprs.append(c.fill_null(fill).alias(field))
        elif method == "normalize":
            mn  = sc.get(f"_tsn_{field}")
            mx  = sc.get(f"_tsx_{field}")
            if mn is not None and mx is not None:
                rng = (mx - mn) or 1.0
                exprs.append(((c - mn) / rng).alias(field))
        elif method == "standardize":
            mu    = sc.get(f"_ts_{field}")
            sigma = sc.get(f"_tss_{field}") or 1.0
            if mu is not None:
                exprs.append(((c - mu) / sigma).alias(field))

    return lf.with_columns(exprs) if exprs else lf


def _scipy_interp(arr: np.ndarray, kind: str) -> np.ndarray:
    from scipy.interpolate import interp1d
    arr = arr.copy()
    idx = np.arange(len(arr))
    valid = ~np.isnan(arr)
    if valid.sum() >= 3:
        f = interp1d(
            idx[valid], arr[valid], kind=kind,
            fill_value="extrapolate", bounds_error=False,
        )
        arr = f(idx).astype(np.float64)
    return arr


# ──────────────────────────────────────────────────────────────────────────────
# WINDOW SPLIT  (pure expression — fully lazy)
# ──────────────────────────────────────────────────────────────────────────────

def _apply_window_split(lf: pl.LazyFrame, config: dict) -> pl.LazyFrame:
    field = config.get("field")
    unit  = config.get("unit", "year")
    schema = lf.collect_schema()
    if not field or field not in schema.names():
        return lf

    new_col = f"{field}_{unit}"
    dtype   = schema[field]

    if dtype in (pl.Date, pl.Datetime):
        dt = pl.col(field).cast(pl.Datetime)
    else:
        dt = pl.col(field).str.to_datetime(format=None, strict=False)

    if unit == "year":
        return lf.with_columns(dt.dt.year().alias(new_col))
    elif unit == "yearmonth":
        return lf.with_columns(dt.dt.strftime("%Y-%m").alias(new_col))
    elif unit == "yearweek":
        return lf.with_columns(dt.dt.strftime("%G-W%V").alias(new_col))
    elif unit == "day":
        return lf.with_columns(dt.dt.strftime("%Y-%m-%d").alias(new_col))
    elif unit == "hour":
        return lf.with_columns(dt.dt.hour().alias(new_col))
    elif unit == "hourminute":
        return lf.with_columns(dt.dt.strftime("%H:%M").alias(new_col))
    elif unit == "second":
        return lf.with_columns(dt.dt.strftime("%H:%M:%S").alias(new_col))
    return lf
