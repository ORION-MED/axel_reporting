import logging
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import polars as pl
import polars.selectors as cs
from scipy import stats as scipy_stats

log = logging.getLogger(__name__)

_STATS_WORKERS = min(8, int(os.environ.get("OMP_NUM_THREADS", "4")))
_DEDUP_THRESHOLD = 100_000
_MAX_PVALUE_COLS = 50

_EMPTY_BOXPLOT = {
    "min": None, "q1": None, "median": None,
    "q3": None, "max": None,
    "wLow": None, "wHigh": None, "outliers": [],
}

_NUMERIC_DTYPES = frozenset({
    pl.Int8, pl.Int16, pl.Int32, pl.Int64,
    pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
    pl.Float32, pl.Float64,
})


# ─── helpers ─────────────────────────────────────────────────────────────────

def _safe(val):
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(val, float):
        return None if (math.isnan(val) or math.isinf(val)) else val
    return val


def _fmt_edge(n: float) -> str:
    if abs(n) >= 1000 or (abs(n) < 0.01 and n != 0):
        return f"{n:.2e}"
    return str(round(n, 2))


def _histogram(vals: np.ndarray, bins: int = 20) -> list:
    if len(vals) == 0:
        return []
    mn, mx = float(vals.min()), float(vals.max())
    if mn == mx:
        return [{"range": str(mn), "count": int(len(vals)), "from": mn, "to": mn}]
    counts, edges = np.histogram(vals, bins=bins)
    result = []
    for i in range(len(counts)):
        lo, hi = float(edges[i]), float(edges[i + 1])
        result.append({
            "range": _fmt_edge(lo) + "-" + _fmt_edge(hi),
            "count": int(counts[i]),
            "from": lo,
            "to": hi,
        })
    return result


def _derive_overview(quality: dict, columns: list) -> dict:
    overview_cols = []
    for c in columns:
        proj = {
            "kind": c["kind"],
            "field": c["field"],
            "colType": c["colType"],
            "n": c["n"],
            "missing": c["missing"],
            "missingPct": c["missingPct"],
        }
        if c["kind"] == "categorical":
            proj["unique"] = c["unique"]
        overview_cols.append(proj)
    return {"quality": quality, "columns": overview_cols}


def _corr_pvalues(r: np.ndarray, n: np.ndarray) -> list:
    with np.errstate(divide="ignore", invalid="ignore"):
        denom = np.sqrt(np.maximum(1.0 - r ** 2, 1e-15))
        t = r * np.sqrt(np.maximum(n - 2, 0)) / denom
        p = 2.0 * scipy_stats.t.sf(np.abs(t), df=np.maximum(n - 2, 1))
    rows = []
    for i, row in enumerate(p):
        rows.append([
            None if i == j else _safe(float(v))
            for j, v in enumerate(row)
        ])
    return rows


def _mat_to_list(arr: np.ndarray) -> list:
    out = []
    for i, row in enumerate(arr):
        out.append([
            1.0 if i == j else _safe(float(v))
            for j, v in enumerate(row)
        ])
    return out


def _pmat_to_list(arr: np.ndarray) -> list:
    return [
        [None if i == j else _safe(float(v)) for j, v in enumerate(row)]
        for i, row in enumerate(arr)
    ]


# ─── per-column workers ───────────────────────────────────────────────────────

def _compute_numeric_col(
    col: str,
    series: pl.Series,
    n_missing: int,
    missing_pct: float,
) -> dict:
    vals = series.drop_nulls().cast(pl.Float32).to_numpy()
    n = len(vals)

    if n == 0:
        return {
            "kind": "numeric", "field": col, "colType": "number",
            "n": 0, "missing": n_missing, "missingPct": missing_pct,
            "mean": None, "median": None, "std": None,
            "variance": None, "iqr": None,
            "min": None, "max": None,
            "p5": None, "p25": None, "p75": None, "p95": None,
            "skewness": None, "kurtosis": None,
            "outliersCount": 0, "histogram": [],
            "boxplot": _EMPTY_BOXPLOT,
        }

    # Sort once — np.quantile on a pre-sorted array skips the internal sort
    vals = np.sort(vals)
    p5, p25, p50, p75, p95 = np.quantile(
        vals, [0.05, 0.25, 0.50, 0.75, 0.95], method="inverted_cdf"
    )
    iqr = float(p75 - p25)
    w_low = float(p25) - 1.5 * iqr
    w_high = float(p75) + 1.5 * iqr
    n_out = int(((vals < w_low) | (vals > w_high)).sum())

    desc = scipy_stats.describe(vals.astype(np.float64))
    mean_v = _safe(float(desc.mean))
    var_v = _safe(float(desc.variance) if n > 1 else 0.0)
    std_v = _safe(
        float(math.sqrt(max(float(desc.variance), 0.0))) if n > 1 else 0.0
    )
    sk = _safe(float(desc.skewness)) if n >= 3 else None
    kt = _safe(float(desc.kurtosis)) if n >= 4 else None

    out_vals = vals[(vals < w_low) | (vals > w_high)]
    boxplot = {
        "min": float(desc.minmax[0]),
        "q1": float(p25),
        "median": float(p50),
        "q3": float(p75),
        "max": float(desc.minmax[1]),
        "wLow": float(w_low),
        "wHigh": float(w_high),
        "outliers": [float(v) for v in out_vals[:50]],
    }

    return {
        "kind": "numeric",
        "field": col,
        "colType": "number",
        "n": n,
        "missing": n_missing,
        "missingPct": missing_pct,
        "mean": mean_v,
        "median": _safe(float(p50)),
        "std": std_v,
        "variance": var_v,
        "iqr": _safe(iqr),
        "min": _safe(float(desc.minmax[0])),
        "max": _safe(float(desc.minmax[1])),
        "p5": _safe(float(p5)),
        "p25": _safe(float(p25)),
        "p75": _safe(float(p75)),
        "p95": _safe(float(p95)),
        "skewness": sk,
        "kurtosis": kt,
        "outliersCount": n_out,
        "histogram": _histogram(vals),
        "boxplot": boxplot,
    }


def _compute_categorical_col(
    col: str,
    series: pl.Series,
    nunique_val: int,
    n_missing: int,
    missing_pct: float,
) -> dict:
    strs = series.drop_nulls().cast(pl.Utf8)
    n = len(strs)
    # value_counts returns DataFrame([col_name, "count"]), sorted desc by count
    freq = strs.value_counts(sort=True)
    counts = freq["count"]
    rare_thresh = max(1, n * 0.01)

    top_values = [
        {
            "value": str(r[0]), "count": int(r[1]),
            "pct": int(r[1]) / n if n > 0 else 0.0,
        }
        for r in freq.head(10).iter_rows()
    ]
    mode_val = str(freq.row(0)[0]) if len(freq) > 0 else ""
    mode_pct = float(freq.row(0)[1]) / n if (n > 0 and len(freq) > 0) else 0.0
    rare_count = int((counts < rare_thresh).sum())

    return {
        "kind": "categorical",
        "field": col,
        "colType": "string",
        "n": n,
        "missing": n_missing,
        "missingPct": missing_pct,
        "unique": nunique_val,
        "topValues": top_values,
        "rareCount": rare_count,
        "mode": mode_val,
        "modePct": mode_pct,
        "histogram": [
            {
                "value": str(r[0]), "count": int(r[1]),
                "pct": int(r[1]) / n if n > 0 else 0.0,
            }
            for r in freq.head(20).iter_rows()
        ],
    }


# ─── public API ──────────────────────────────────────────────────────────────

def build_dataset_stats(df: pl.DataFrame) -> tuple[dict, dict]:
    """Returns (stats_dict, overview_dict).
    cramersV and vif excluded — call build_slow_stats() for those.
    """
    total_rows = len(df)
    total_cols = len(df.columns)

    # One scan for both null counts and n_unique values
    quality_row = df.select(
        [pl.col(c).null_count().alias(f"__miss_{c}") for c in df.columns]
        + [pl.col(c).n_unique().alias(f"__uniq_{c}") for c in df.columns]
    ).to_dicts()[0]

    missing_by_col: dict[str, int] = {c: quality_row[f"__miss_{c}"] for c in df.columns}
    nunique_dict:   dict[str, int] = {c: quality_row[f"__uniq_{c}"] for c in df.columns}
    total_missing = sum(missing_by_col.values())

    if total_rows <= _DEDUP_THRESHOLD:
        duplicate_rows = int(df.is_duplicated().sum())
    else:
        log.debug(
            "dedup check skipped for %d rows (> %d threshold)",
            total_rows, _DEDUP_THRESHOLD,
        )
        duplicate_rows = 0

    high_missing_cols = [
        c for c, m in missing_by_col.items()
        if total_rows > 0 and m / total_rows > 0.5
    ]

    constant_or_id_cols = [
        c for c in df.columns if nunique_dict[c] in (1, total_rows)
    ]

    quality = {
        "totalRows": total_rows,
        "totalCols": total_cols,
        "duplicateRows": duplicate_rows,
        "duplicateRowsPct": duplicate_rows / total_rows if total_rows > 0 else 0.0,
        "missingCells": total_missing,
        "missingCellsPct": (
            total_missing / (total_rows * total_cols)
            if total_rows * total_cols > 0 else 0.0
        ),
        "missingByCol": missing_by_col,
        "highMissingCols": high_missing_cols,
        "constantOrIdCols": constant_or_id_cols,
    }

    numeric_col_set = set(df.select(cs.numeric()).columns)

    def _submit(col: str) -> dict:
        series = df[col]
        nm = missing_by_col[col]
        mp = nm / total_rows if total_rows > 0 else 0.0
        if col in numeric_col_set:
            return _compute_numeric_col(col, series, nm, mp)
        return _compute_categorical_col(col, series, nunique_dict[col], nm, mp)

    col_map: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=_STATS_WORKERS) as ex:
        futures = {ex.submit(_submit, col): col for col in df.columns}
        for fut in as_completed(futures):
            col_map[futures[fut]] = fut.result()

    columns = [col_map[col] for col in df.columns]
    numeric_cols = [col for col in df.columns if col in numeric_col_set]

    correlation = None
    if len(numeric_cols) >= 2:
        n_cols = len(numeric_cols)
        # Float32 halves memory of the working array; numpy/scipy promote internally
        num_np = df.select(
            [pl.col(c).cast(pl.Float32) for c in numeric_cols]
        ).to_numpy(allow_copy=True)

        notna_np = (~np.isnan(num_np)).astype(np.int32)
        n_pairs = (notna_np.T @ notna_np)  # vectorized pairwise valid-row counts

        has_nan = bool(np.isnan(num_np).any())

        if not has_nan:
            # Fast path: no missing data — one BLAS call per metric
            r_p = np.corrcoef(num_np.T)
            sp_result = scipy_stats.spearmanr(num_np)
            r_s_raw, sp_p_raw = sp_result[0], sp_result[1]
            if n_cols == 2:
                r_s = np.array([[1.0, float(r_s_raw)], [float(r_s_raw), 1.0]])
                sp_p = np.array([[np.nan, float(sp_p_raw)], [float(sp_p_raw), np.nan]])
            else:
                r_s = np.asarray(r_s_raw)
                sp_p = np.asarray(sp_p_raw)
            n_clean = len(num_np)
        else:
            # Slow path: pairwise deletion for both metrics, parallelized over pairs
            r_p = np.full((n_cols, n_cols), np.nan)
            r_s = np.full((n_cols, n_cols), np.nan)
            sp_p = np.full((n_cols, n_cols), np.nan)
            np.fill_diagonal(r_p, 1.0)
            np.fill_diagonal(r_s, 1.0)

            pairs = [(i, j) for i in range(n_cols) for j in range(i + 1, n_cols)]

            def _pair_corr(ij: tuple) -> tuple:
                i, j = ij
                mask = ~np.isnan(num_np[:, i]) & ~np.isnan(num_np[:, j])
                n_v = int(mask.sum())
                rp = rs = spp = np.nan
                if n_v >= 2:
                    rp = float(np.corrcoef(num_np[mask, i], num_np[mask, j])[0, 1])
                if n_v >= 5:
                    rs_v, spp_v = scipy_stats.spearmanr(num_np[mask, i], num_np[mask, j])
                    rs, spp = float(rs_v), float(spp_v)
                return i, j, rp, rs, spp

            with ThreadPoolExecutor(max_workers=_STATS_WORKERS) as ex:
                for i, j, rp, rs, spp in ex.map(_pair_corr, pairs):
                    r_p[i, j] = r_p[j, i] = rp
                    r_s[i, j] = r_s[j, i] = rs
                    sp_p[i, j] = sp_p[j, i] = spp

            n_clean = int((~np.isnan(num_np).any(axis=1)).sum())

        correlation = {
            "fields": numeric_cols,
            "pearson": _mat_to_list(r_p),
            "spearman": _mat_to_list(r_s),
            "pearsonP": _corr_pvalues(r_p, n_pairs),
            "spearmanP": _pmat_to_list(sp_p),
            "nPairs": n_pairs.tolist(),
            "nSpearman": n_clean,
        }

    stats = {
        "quality": quality,
        "columns": columns,
        "correlation": correlation,
        "cramersV": None,
        "vif": [],
    }
    overview = _derive_overview(quality, columns)
    return stats, overview


def build_slow_stats(df: pl.DataFrame) -> dict:
    """Compute Cramer's V and VIF (background thread — slow for wide data)."""
    numeric_col_set = set(df.select(cs.numeric()).columns)
    categorical_cols = [c for c in df.columns if c not in numeric_col_set]
    numeric_cols = [c for c in df.columns if c in numeric_col_set]

    # ── Cramer's V ───────────────────────────────────────────────────────────
    cramers_v = None
    if len(categorical_cols) >= 2:
        n_cats = len(categorical_cols)

        factorized: list[np.ndarray] = []
        n_uniq: list[int] = []
        for col in categorical_cols:
            codes = (
                df[col].cast(pl.Categorical)
                  .to_physical()
                  .cast(pl.Int64)
                  .fill_null(-1)
                  .to_numpy()
            )
            factorized.append(codes)
            n_uniq.append(int(df[col].drop_nulls().n_unique()))

        def _cramer_pair(i: int, j: int):
            ci, cj = factorized[i], factorized[j]
            valid = (ci >= 0) & (cj >= 0)
            n_obs = int(valid.sum())
            if n_obs == 0:
                return i, j, None
            try:
                ni, nj = n_uniq[i], n_uniq[j]
                flat = ci[valid].astype(np.int64) * nj + cj[valid].astype(np.int64)
                ct = np.bincount(flat, minlength=ni * nj).reshape(ni, nj)
                ct = ct[ct.sum(axis=1) > 0]
                ct = ct[:, ct.sum(axis=0) > 0]
                if ct.shape[0] < 2 or ct.shape[1] < 2:
                    return i, j, None
                chi2, _, _, _ = scipy_stats.chi2_contingency(ct)
                min_dim = min(ct.shape[0], ct.shape[1]) - 1
                v = math.sqrt(chi2 / (n_obs * min_dim))
                return i, j, _safe(v)
            except Exception:
                return i, j, None

        mat: list[list] = [
            [1.0 if i == j else None for j in range(n_cats)]
            for i in range(n_cats)
        ]
        pairs = [(i, j) for i in range(n_cats) for j in range(i + 1, n_cats)]
        with ThreadPoolExecutor(max_workers=_STATS_WORKERS) as ex:
            for i, j, v in ex.map(lambda p: _cramer_pair(*p), pairs):
                mat[i][j] = mat[j][i] = v

        cramers_v = {"fields": categorical_cols, "matrix": mat}

    # ── VIF ──────────────────────────────────────────────────────────────────
    vif: list[dict] = []
    if len(numeric_cols) >= 2:
        try:
            from statsmodels.stats.outliers_influence import variance_inflation_factor

            num_clean = df.select(
                [pl.col(c).cast(pl.Float64, strict=False) for c in numeric_cols]
            ).drop_nulls()

            min_rows = len(numeric_cols) + 1
            if len(num_clean) >= min_rows:
                X = num_clean.to_numpy()

                def _vif_one(idx_field: tuple) -> dict:
                    idx, field = idx_field
                    try:
                        v = float(variance_inflation_factor(X, idx))
                        return {"field": field, "vif": _safe(min(v, 9999.0))}
                    except Exception:
                        return {"field": field, "vif": None}

                with ThreadPoolExecutor(max_workers=_STATS_WORKERS) as ex:
                    vif = list(ex.map(_vif_one, enumerate(numeric_cols)))
        except ImportError:
            pass

    return {"cramersV": cramers_v, "vif": vif}


def build_pvalue_matrix(df: pl.DataFrame) -> dict:
    """Pairwise p-value matrix (background).
    num-num: Spearman; cat-cat: Chi²; num-cat: Mann-Whitney/Kruskal.
    """
    cols = list(df.columns)
    n = len(cols)

    if n > _MAX_PVALUE_COLS:
        log.warning(
            "pvalue_matrix skipped: %d cols exceeds limit %d", n, _MAX_PVALUE_COLS,
        )
        return {"fields": [], "pMatrix": [], "testMatrix": [], "nMatrix": []}

    numeric_col_set = set(df.select(cs.numeric()).columns)
    col_types: dict[str, str] = {
        col: "number" if col in numeric_col_set else "string"
        for col in cols
    }

    num_arrays: dict[str, np.ndarray] = {
        col: df[col].cast(pl.Float64, strict=False).to_numpy(allow_copy=True)
        for col in cols if col_types[col] == "number"
    }

    p_mat: list[list] = [[None] * n for _ in range(n)]
    test_mat: list[list[str]] = [[""] * n for _ in range(n)]
    n_mat: list[list[int]] = [[0] * n for _ in range(n)]

    for i in range(n):
        p_mat[i][i] = 1.0
        n_mat[i][i] = int(df[cols[i]].drop_nulls().len())

    def _pair(i: int, j: int):
        ca, cb = cols[i], cols[j]
        ta, tb = col_types[ca], col_types[cb]
        try:
            if ta == "number" and tb == "number":
                a, b = num_arrays[ca], num_arrays[cb]
                valid = ~np.isnan(a) & ~np.isnan(b)
                np_ = int(valid.sum())
                if np_ < 5:
                    return i, j, np_, None, ""
                _, p = scipy_stats.spearmanr(a[valid], b[valid])
                return i, j, np_, _safe(float(p)), "Spearman"

            paired = df.select([ca, cb]).drop_nulls()
            np_ = len(paired)
            if np_ < 5:
                return i, j, np_, None, ""

            if ta == "string" and tb == "string":
                # Replace pd.crosstab with numpy bincount (same approach as Cramer's V)
                ci = (
                    paired[ca].cast(pl.Categorical).to_physical()
                      .cast(pl.Int64).fill_null(-1).to_numpy()
                )
                cj = (
                    paired[cb].cast(pl.Categorical).to_physical()
                      .cast(pl.Int64).fill_null(-1).to_numpy()
                )
                valid = (ci >= 0) & (cj >= 0)
                if valid.sum() == 0:
                    return i, j, np_, None, ""
                ni = int(paired[ca].n_unique())
                nj = int(paired[cb].n_unique())
                flat = ci[valid] * nj + cj[valid]
                ct = np.bincount(flat, minlength=ni * nj).reshape(ni, nj)
                ct = ct[ct.sum(axis=1) > 0][:, ct.sum(axis=0) > 0]
                if ct.shape[0] < 2 or ct.shape[1] < 2:
                    return i, j, np_, None, ""
                _, p, _, _ = scipy_stats.chi2_contingency(ct)
                return i, j, np_, _safe(float(p)), "chi2"

            num_col = ca if ta == "number" else cb
            cat_col = cb if ta == "number" else ca
            grp_data = paired.group_by(cat_col).agg(
                pl.col(num_col).cast(pl.Float64, strict=False).drop_nulls()
            )
            gs = [row[1] for row in grp_data.iter_rows() if row[1] and len(row[1]) >= 1]
            if len(gs) < 2:
                return i, j, np_, None, ""
            if len(gs) == 2:
                _, p = scipy_stats.mannwhitneyu(gs[0], gs[1], alternative="two-sided")
                return i, j, np_, _safe(float(p)), "Mann-Whitney"
            _, p = scipy_stats.kruskal(*gs)
            return i, j, np_, _safe(float(p)), "KW"

        except Exception:
            return i, j, 0, None, ""

    pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    with ThreadPoolExecutor(max_workers=_STATS_WORKERS) as ex:
        for i, j, np_, p_val, test_name in ex.map(lambda p: _pair(*p), pairs):
            n_mat[i][j] = n_mat[j][i] = np_
            p_mat[i][j] = p_mat[j][i] = p_val
            test_mat[i][j] = test_mat[j][i] = test_name

    return {
        "fields": cols,
        "pMatrix": p_mat,
        "testMatrix": test_mat,
        "nMatrix": n_mat,
    }
