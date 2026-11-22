#!/usr/bin/env python3
"""Hisob AI — XGBoost trade forecast for next calendar month (by day + category).

History dow uses JS Date.getDay() (Sun=0 … Sat=6). Features and recursion stay on that
convention. Expenses use a hybrid: calendar obligations (аренда/НДС/зарплата/…) +
XGBoost on variable residual, with lag clipping so recursion cannot explode.
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from calendar import monthrange

import numpy as np
import pandas as pd
import xgboost as xgb

HORIZON_MONTH = 11  # November 2026
HORIZON_YEAR = 2026
TARGETS = ["inn", "out_var"]

# Fixed monthly obligations (DOM → category). Amounts filled from history medians.
FIXED_SCHEDULE = {
    5: ("аренда", 18_000_000),
    10: ("коммунальные", 6_500_000),
    15: ("зарплата", 26_000_000),
    17: ("кредит", 12_500_000),
    22: ("налог", 32_000_000),
    28: ("зарплата", 24_000_000),
    30: ("налог", 10_500_000),
}

CAT_TARGETS = {
    "эквайринг": "in",
    "розница": "in",
    "B2B": "in",
    "сырьё": "out",
    "упаковка": "out",
    "коммунальные": "out",
    "логистика": "out",
    "аренда": "out",
    "зарплата": "out",
    "налог": "out",
    "кредит": "out",
    "хоз": "out",
}

FIXED_CATS = {"аренда", "коммунальные", "зарплата", "налог", "кредит"}
IN_CATS = [c for c, s in CAT_TARGETS.items() if s == "in"]
OUT_VAR_CATS = [c for c, s in CAT_TARGETS.items() if s == "out" and c not in FIXED_CATS]


def js_dow(d: date) -> int:
    """Match JavaScript Date.getDay(): Sun=0 … Sat=6."""
    return (d.weekday() + 1) % 7


def wape(y_true, y_pred) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.abs(y_true).sum()
    if denom <= 0:
        return 0.0
    return float(np.abs(y_true - y_pred).sum() / denom * 100)


def build_frame(daily: list[dict]) -> pd.DataFrame:
    rows = []
    for d in daily:
        row = {
            "iso": d["iso"],
            "dow": int(d.get("dow", 0)),  # JS getDay
            "dom": int(d.get("dom", 1)),
            "month": int(d.get("month", 1)),
            "inn": float(d.get("inn", 0)),
            "out": float(d.get("out", 0)),
        }
        cats = d.get("cats") or {}
        for cat, side in CAT_TARGETS.items():
            v = cats.get(cat) or {}
            row[f"cat__{cat}"] = float(v.get(side, 0) or 0)
        rows.append(row)
    df = pd.DataFrame(rows).sort_values("iso").reset_index(drop=True)
    df["date"] = pd.to_datetime(df["iso"])
    return df


def fixed_amount_for_day(dom: int, hist_medians: dict[str, float]) -> tuple[float, str | None]:
    if dom not in FIXED_SCHEDULE:
        return 0.0, None
    cat, fallback = FIXED_SCHEDULE[dom]
    return float(hist_medians.get(cat, fallback)), cat


def add_fixed_and_var(df: pd.DataFrame, hist_medians: dict[str, float] | None = None) -> pd.DataFrame:
    """Split actual daily out into fixed-category spend vs variable residual."""
    out = df.copy()
    fixed = np.zeros(len(out))
    for cat in FIXED_CATS:
        col = f"cat__{cat}"
        if col in out.columns:
            fixed = fixed + out[col].fillna(0).values
    out["out_fixed"] = fixed
    out["out_var"] = np.clip(out["out"].values - fixed, 0, None)
    return out


def hist_cat_medians(df: pd.DataFrame) -> dict[str, float]:
    """Median monthly total per fixed category (positive amounts)."""
    tmp = df.copy()
    tmp["ym"] = tmp["date"].dt.strftime("%Y-%m")
    med = {}
    for cat in FIXED_CATS:
        col = f"cat__{cat}"
        if col not in tmp.columns:
            continue
        monthly = tmp.groupby("ym")[col].sum()
        monthly = monthly[monthly > 0]
        if len(monthly):
            med[cat] = float(monthly.median())
    # Per-event medians for schedule days (more accurate than month/2 for salary)
    for dom, (cat, fallback) in FIXED_SCHEDULE.items():
        col = f"cat__{cat}"
        if col not in df.columns:
            continue
        vals = df.loc[df["dom"] == dom, col]
        vals = vals[vals > 1_000_000]
        if len(vals):
            # store event-level under cat__dom key used at forecast time via FIXED_SCHEDULE lookup
            med[f"{cat}@{dom}"] = float(vals.median())
        elif cat not in med:
            med[cat] = float(fallback)
    return med


def schedule_amount(dom: int, medians: dict[str, float]) -> tuple[float, str | None]:
    if dom not in FIXED_SCHEDULE:
        return 0.0, None
    cat, fallback = FIXED_SCHEDULE[dom]
    return float(medians.get(f"{cat}@{dom}", medians.get(cat, fallback))), cat


def business_day_map(year: int, month: int) -> dict[int, int]:
    """Map nominal DOM → actual pay DOM (shift Sun→Mon, clamp month end)."""
    last = monthrange(year, month)[1]
    mapping = {}
    for nom in FIXED_SCHEDULE:
        d = min(nom, last)
        dt = date(year, month, d)
        if js_dow(dt) == 0:  # Sunday → Monday
            nd = d + 1
            if nd > last:
                nd = d - 1  # Friday if somehow past end
            d = nd
        mapping[nom] = d
    return mapping


def fixed_for_date(d: date, medians: dict[str, float], bmap: dict[int, int]) -> list[tuple[float, str]]:
    """All fixed obligations that settle on this calendar date."""
    items = []
    for nom, pay_dom in bmap.items():
        if pay_dom != d.day:
            continue
        cat, fallback = FIXED_SCHEDULE[nom]
        amt = float(medians.get(f"{cat}@{nom}", medians.get(cat, fallback)))
        items.append((amt, cat))
    return items


def add_calendar(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["is_weekend"] = (out["dow"] == 6).astype(int)  # Sat (JS)
    out["is_friday"] = (out["dow"] == 5).astype(int)
    out["is_month_start"] = (out["dom"] <= 5).astype(int)
    out["is_month_end"] = (out["dom"] >= 25).astype(int)
    out["is_payday"] = out["dom"].isin([15, 28]).astype(int)
    out["is_rent_day"] = (out["dom"] == 5).astype(int)
    out["is_tax_day"] = out["dom"].isin([22, 30]).astype(int)
    out["is_credit_day"] = (out["dom"] == 17).astype(int)
    out["is_kommunal_day"] = (out["dom"] == 10).astype(int)
    return out


FEAT_CAL = [
    "dow", "dom", "month", "is_weekend", "is_friday", "is_month_start", "is_month_end",
    "is_payday", "is_rent_day", "is_tax_day", "is_credit_day", "is_kommunal_day",
]


def add_lags(df: pd.DataFrame, col: str) -> pd.DataFrame:
    out = df.copy()
    for lag in (1, 7, 14):
        out[f"{col}_lag{lag}"] = out[col].shift(lag)
    out[f"{col}_roll7"] = out[col].shift(1).rolling(7, min_periods=3).mean()
    out[f"{col}_roll14"] = out[col].shift(1).rolling(14, min_periods=5).mean()
    return out


def feat_cols(target: str) -> list[str]:
    return FEAT_CAL + [
        f"{target}_lag1", f"{target}_lag7", f"{target}_lag14",
        f"{target}_roll7", f"{target}_roll14",
    ]


def train_one(df: pd.DataFrame, target: str):
    d = add_lags(add_calendar(df), target)
    cols = feat_cols(target)
    train = d.dropna(subset=cols + [target]).copy()
    if len(train) < 40:
        raise RuntimeError(f"not enough rows for {target}: {len(train)}")

    last_month = int(train["month"].max())
    tr = train[train["month"] < last_month]
    te = train[train["month"] == last_month]
    if len(tr) < 25 or len(te) < 5:
        cut = train["date"].max() - pd.Timedelta(days=14)
        tr = train[train["date"] <= cut]
        te = train[train["date"] > cut]

    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=3,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.8,
        reg_lambda=3.0,
        reg_alpha=0.3,
        min_child_weight=5,
        objective="reg:squarederror",
        n_jobs=2,
        random_state=42,
    )
    y_tr = np.log1p(np.clip(tr[target].values, 0, None))
    model.fit(tr[cols], y_tr)
    pred_te = np.expm1(model.predict(te[cols]))
    score_day = wape(te[target].values, pred_te)
    # For out_var, evaluate against full out using fixed+pred on holdout
    if target == "out_var" and "out" in te.columns and "out_fixed" in te.columns:
        score_month = wape([te["out"].sum()], [(te["out_fixed"] + pred_te).sum()])
    else:
        score_month = wape([te[target].sum()], [pred_te.sum()])
    te2 = te.copy().assign(pred=pred_te)
    te2["week"] = te2["date"].dt.isocalendar().week.astype(int)
    if target == "out_var" and "out" in te2.columns and "out_fixed" in te2.columns:
        te2["y_full"] = te2["out"]
        te2["p_full"] = te2["out_fixed"] + te2["pred"]
        w_true = te2.groupby("week")["y_full"].sum()
        w_pred = te2.groupby("week")["p_full"].sum()
    else:
        w_true = te2.groupby("week")[target].sum()
        w_pred = te2.groupby("week")["pred"].sum()
    score_week = wape(w_true.values, w_pred.reindex(w_true.index).fillna(0).values)

    model.fit(train[cols], np.log1p(np.clip(train[target].values, 0, None)))
    imp = sorted(
        [{"feature": c, "gain": float(g)} for c, g in zip(cols, model.feature_importances_)],
        key=lambda x: -x["gain"],
    )[:8]
    # clip bounds from training distribution
    pos = train[target].values
    pos = pos[pos > 0]
    clip_hi = float(np.percentile(pos, 97)) if len(pos) else 50_000_000
    clip_lo = 0.0
    return model, cols, score_day, imp, train, score_week, score_month, clip_hi, clip_lo


def recursive_month(
    df_hist: pd.DataFrame,
    model,
    cols: list[str],
    target: str,
    year: int,
    month: int,
    clip_hi: float,
    medians: dict[str, float] | None = None,
    bmap: dict[int, int] | None = None,
    dow_baseline: dict[int, float] | None = None,
) -> list[dict]:
    hist = df_hist.copy()
    if "date" not in hist.columns:
        hist["date"] = pd.to_datetime(hist["iso"])
    values = {r.date.date(): float(getattr(r, target)) for r in hist.itertuples()}
    bmap = bmap or {}
    # invert: pay_dom → list of nominal DOMs
    pay_to_noms: dict[int, list[int]] = {}
    for nom, pay in bmap.items():
        pay_to_noms.setdefault(pay, []).append(nom)

    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])

    out = []
    d = start
    while d <= end:
        dow = js_dow(d)
        if dow == 0:  # Sunday closed
            values[d] = 0.0
            out.append({
                "iso": d.isoformat(), "dow": dow, "dom": d.day, "month": d.month,
                target: 0.0, "closed": True, "out_fixed": 0.0, "fixed_items": [],
            })
            d += timedelta(days=1)
            continue

        # Calendar flags use nominal intent (payday still true if salary shifted onto this day)
        noms_today = pay_to_noms.get(d.day, [])
        is_payday = int(any(n in (15, 28) for n in noms_today) or d.day in (15, 28))
        is_rent = int(any(n == 5 for n in noms_today) or d.day == 5)
        is_tax = int(any(n in (22, 30) for n in noms_today) or d.day in (22, 30))
        is_credit = int(any(n == 17 for n in noms_today) or d.day == 17)
        is_komm = int(any(n == 10 for n in noms_today) or d.day == 10)

        row = {
            "dow": dow,
            "dom": d.day,
            "month": d.month,
            "is_weekend": int(dow == 6),
            "is_friday": int(dow == 5),
            "is_month_start": int(d.day <= 5),
            "is_month_end": int(d.day >= 25),
            "is_payday": is_payday,
            "is_rent_day": is_rent,
            "is_tax_day": is_tax,
            "is_credit_day": is_credit,
            "is_kommunal_day": is_komm,
        }

        def lag(n):
            return values.get(d - timedelta(days=n), 0.0)

        row[f"{target}_lag1"] = lag(1)
        row[f"{target}_lag7"] = lag(7)
        row[f"{target}_lag14"] = lag(14)
        roll7 = [values.get(d - timedelta(days=i), 0.0) for i in range(1, 8)]
        roll14 = [values.get(d - timedelta(days=i), 0.0) for i in range(1, 15)]
        row[f"{target}_roll7"] = float(np.mean(roll7))
        row[f"{target}_roll14"] = float(np.mean(roll14))
        X = pd.DataFrame([row])[cols]
        yhat = float(max(0.0, np.expm1(model.predict(X)[0])))
        yhat = float(min(yhat, clip_hi))

        # Blend toward same-weekday baseline so recursive drift stays realistic
        if dow_baseline and dow in dow_baseline and target == "inn":
            base = dow_baseline[dow]
            yhat = 0.55 * yhat + 0.45 * base
            yhat = float(min(max(yhat, base * 0.55), base * 1.35))

        fixed_items: list[tuple[float, str]] = []
        fixed_amt = 0.0
        if medians is not None and target == "out_var":
            fixed_items = fixed_for_date(d, medians, bmap)
            fixed_amt = sum(a for a, _ in fixed_items)

        values[d] = yhat
        rec = {
            "iso": d.isoformat(), "dow": dow, "dom": d.day, "month": d.month,
            target: round(yhat), "closed": False,
            "out_fixed": round(fixed_amt), "fixed_items": fixed_items,
        }
        out.append(rec)
        d += timedelta(days=1)
    return out


def month_cat_share(df: pd.DataFrame, cats: list[str], side_col_prefix: str = "cat__") -> dict[str, float]:
    """Average share of each category within its side over history months."""
    tmp = df.copy()
    tmp["ym"] = tmp["date"].dt.strftime("%Y-%m")
    shares = {c: [] for c in cats}
    for _, g in tmp.groupby("ym"):
        total = sum(float(g[f"{side_col_prefix}{c}"].sum()) for c in cats)
        if total <= 0:
            continue
        for c in cats:
            shares[c].append(float(g[f"{side_col_prefix}{c}"].sum()) / total)
    return {c: float(np.mean(v)) if v else 0.0 for c, v in shares.items()}


def run(payload: dict) -> dict:
    df = build_frame(payload["daily"])
    medians = hist_cat_medians(df)
    df = add_fixed_and_var(df, medians)

    results = {
        "model": "XGBoostRegressor",
        "horizon": f"{HORIZON_YEAR}-{HORIZON_MONTH:02d}",
        "targets": {},
        "daily": [],
        "categories": {},
    }

    models = {}
    # Income
    model, cols, score_day, imp, train, score_week, score_month, clip_hi, _ = train_one(df, "inn")
    models["inn"] = (model, cols, train, clip_hi)
    results["targets"]["inn"] = {
        "wape": round(score_month, 2),
        "wape_week": round(score_week, 2),
        "wape_day": round(score_day, 2),
        "importance": imp,
    }

    # Variable expenses
    model, cols, score_day, imp, train, score_week, score_month, clip_hi, _ = train_one(df, "out_var")
    models["out_var"] = (model, cols, train, clip_hi)
    results["targets"]["out"] = {
        "wape": round(score_month, 2),
        "wape_week": round(score_week, 2),
        "wape_day": round(score_day, 2),
        "importance": imp,
    }

    # Light category models only for variable / income (WAPE metadata); amounts from shares
    for cat in IN_CATS + OUT_VAR_CATS:
        col = f"cat__{cat}"
        if col not in df.columns or float(df[col].sum()) <= 0:
            continue
        try:
            m, c, sd, im, tr, sw, sm, chi, _ = train_one(df, col)
            results["categories"][cat] = {
                "wape": round(sm, 2),
                "wape_week": round(sw, 2),
                "wape_day": round(sd, 2),
                "side": CAT_TARGETS[cat],
                "importance": im[:5],
            }
        except Exception as e:
            results["categories"][cat] = {"error": str(e), "side": CAT_TARGETS[cat]}

    for cat in FIXED_CATS:
        results["categories"][cat] = {
            "wape": 0.0,
            "wape_week": 0.0,
            "wape_day": 0.0,
            "side": "out",
            "importance": [{"feature": "calendar", "gain": 1.0}],
            "note": "календарное обязательство (медиана истории)",
        }

    df2 = df.copy()
    bmap = business_day_map(HORIZON_YEAR, HORIZON_MONTH)

    # Same-weekday income baseline from last 6 weeks of history
    recent = df2.tail(42)
    dow_baseline = {}
    for dow, g in recent.groupby("dow"):
        vals = g["inn"].values
        vals = vals[vals > 0]
        if len(vals):
            dow_baseline[int(dow)] = float(np.median(vals))

    # October variable spend → target for Nov variable (mild growth)
    oct_mask = df2["date"].dt.strftime("%Y-%m") == "2026-10"
    oct_var_total = float(df2.loc[oct_mask, "out_var"].sum()) if oct_mask.any() else float(df2["out_var"].sum() / 3)
    target_var = oct_var_total * 1.02  # slight seasonal uptick

    fc_in = recursive_month(
        df2, models["inn"][0], models["inn"][1], "inn",
        HORIZON_YEAR, HORIZON_MONTH, models["inn"][3],
        dow_baseline=dow_baseline,
    )
    fc_var = recursive_month(
        df2, models["out_var"][0], models["out_var"][1], "out_var",
        HORIZON_YEAR, HORIZON_MONTH, models["out_var"][3], medians, bmap,
    )

    by_day = []
    fixed_by_cat: dict[str, float] = {c: 0.0 for c in FIXED_CATS}
    for a, b in zip(fc_in, fc_var):
        inn = float(a["inn"])
        var = float(b["out_var"])
        fixed = float(b.get("out_fixed") or 0)
        for amt, fcat in b.get("fixed_items") or []:
            fixed_by_cat[fcat] = fixed_by_cat.get(fcat, 0) + float(amt)
        out = var + fixed
        by_day.append({
            "iso": a["iso"], "label": a["iso"][8:], "closed": a.get("closed", False),
            "inn": round(inn), "out": round(out), "margin": round(inn - out),
            "outVar": round(var), "outFixed": round(fixed),
            "innLo": round(inn * 0.9), "innHi": round(inn * 1.1),
            "outLo": round(out * 0.9), "outHi": round(out * 1.1),
        })

    next_in = sum(x["inn"] for x in by_day)
    next_var_raw = sum(x["outVar"] for x in by_day)
    # Scale variable out to ~October level (XGB residual alone under-predicts)
    if next_var_raw > 0 and target_var > 0:
        vscale = target_var / next_var_raw
        vscale = float(np.clip(vscale, 0.7, 2.2))
        for x in by_day:
            x["outVar"] = round(x["outVar"] * vscale)
            x["out"] = x["outVar"] + x["outFixed"]
            x["margin"] = x["inn"] - x["out"]
            x["outLo"] = round(x["out"] * 0.9)
            x["outHi"] = round(x["out"] * 1.1)

    next_out = sum(x["out"] for x in by_day)
    next_var = sum(x["outVar"] for x in by_day)

    # Soft income band vs October trading-day adjusted
    oct_in = float(df2.loc[oct_mask, "inn"].sum()) if oct_mask.any() else float(df2["inn"].sum() / 3)
    oct_days = int((df2.loc[oct_mask, "inn"] > 0).sum()) if oct_mask.any() else 26
    nov_days = sum(1 for x in by_day if not x["closed"])
    expected_in = oct_in * (nov_days / max(1, oct_days)) * 0.99
    if next_in > 0 and abs(next_in / expected_in - 1) > 0.12:
        iscale = expected_in / next_in
        iscale = float(np.clip(iscale, 0.85, 1.18))
        for x in by_day:
            x["inn"] = round(x["inn"] * iscale)
            x["margin"] = x["inn"] - x["out"]
            x["innLo"] = round(x["inn"] * 0.9)
            x["innHi"] = round(x["inn"] * 1.1)
        next_in = sum(x["inn"] for x in by_day)
        next_out = sum(x["out"] for x in by_day)

    # Category month: income/out-var via historical shares; fixed via schedule
    in_share = month_cat_share(df, IN_CATS)
    out_var_share = month_cat_share(df, OUT_VAR_CATS)

    cat_month = []
    for cat in IN_CATS:
        amt = round(next_in * in_share.get(cat, 0))
        cat_month.append({
            "cat": cat, "side": "in", "amount": amt,
            "wape": results["categories"].get(cat, {}).get("wape"),
        })
    # renormalize income cats to exact next_in
    in_sum = sum(x["amount"] for x in cat_month if x["side"] == "in") or 1
    for x in cat_month:
        if x["side"] == "in":
            x["amount"] = round(x["amount"] * next_in / in_sum)

    for cat in OUT_VAR_CATS:
        amt = round(next_var * out_var_share.get(cat, 0))
        cat_month.append({
            "cat": cat, "side": "out", "amount": amt,
            "wape": results["categories"].get(cat, {}).get("wape"),
        })
    for cat in FIXED_CATS:
        cat_month.append({
            "cat": cat, "side": "out", "amount": round(fixed_by_cat.get(cat, 0)),
            "wape": 0.0,
        })
    # renormalize variable out cats to next_var
    var_sum = sum(x["amount"] for x in cat_month if x["side"] == "out" and x["cat"] in OUT_VAR_CATS) or 1
    for x in cat_month:
        if x["side"] == "out" and x["cat"] in OUT_VAR_CATS:
            x["amount"] = round(x["amount"] * next_var / var_sum)

    # history months
    df2["ym"] = df2["date"].dt.strftime("%Y-%m")
    hist_months = []
    for ym, g in df2.groupby("ym"):
        hist_months.append({
            "label": ym,
            "inn": round(float(g["inn"].sum())),
            "out": round(float(g["out"].sum())),
            "margin": round(float(g["inn"].sum() - g["out"].sum())),
        })
    oct = next((m for m in hist_months if m["label"] == "2026-10"), hist_months[-1] if hist_months else {"inn": 1, "out": 1})
    growth_in = round((next_in / max(1, oct["inn"]) - 1) * 1000) / 10
    growth_out = round((next_out / max(1, oct["out"]) - 1) * 1000) / 10

    # Soft realism guard: out should stay within ±35% of October unless calendar forces more
    oct_out = max(1, oct["out"])
    if next_out > oct_out * 1.35:
        scale = (oct_out * 1.25) / next_out
        for x in by_day:
            x["outVar"] = round(x["outVar"] * scale)
            x["out"] = x["outVar"] + x["outFixed"]
            x["margin"] = x["inn"] - x["out"]
            x["outLo"] = round(x["out"] * 0.9)
            x["outHi"] = round(x["out"] * 1.1)
        next_out = sum(x["out"] for x in by_day)
        next_var = sum(x["outVar"] for x in by_day)
        growth_out = round((next_out / oct_out - 1) * 1000) / 10
        for x in cat_month:
            if x["cat"] in OUT_VAR_CATS:
                x["amount"] = round(x["amount"] * scale)

    scenarios = [
        {"id": "base", "title": "База (XGB)", "inn": round(next_in), "out": round(next_out),
         "note": "XGBoost + календарь обязательств"},
        {"id": "up", "title": "Оптимизм +10%", "inn": round(next_in * 1.10), "out": round(next_out * 1.03),
         "note": "спрос / новый B2B"},
        {"id": "down", "title": "Пессимизм −12%", "inn": round(next_in * 0.88), "out": round(next_out * 0.97),
         "note": "слабый трафик, сырьё держится"},
    ]
    for s in scenarios:
        s["margin"] = s["inn"] - s["out"]
        s["marginPct"] = round(s["margin"] / max(1, s["inn"]) * 1000) / 10

    forward_weeks = []
    for i in range(0, len(by_day), 7):
        chunk = by_day[i:i + 7]
        if not chunk:
            continue
        inn = sum(x["inn"] for x in chunk)
        out = sum(x["out"] for x in chunk)
        forward_weeks.append({
            "label": f"N{len(forward_weeks) + 1}",
            "week": len(forward_weeks) + 1,
            "inn": inn, "out": out, "margin": inn - out,
            "marginPct": round((inn - out) / max(1, inn) * 1000) / 10,
            "innLo": round(inn * 0.9), "innHi": round(inn * 1.1),
            "outLo": round(out * 0.9), "outHi": round(out * 1.1),
            "kind": "forecast",
        })

    drivers = [
        {"title": "Модель", "value": "XGBoost + календарь", "hint": "приход XGB · расход = обязательства + residual"},
        {"title": "WAPE приход (месяц)", "value": f"{results['targets']['inn']['wape']}%", "hint": "holdout: октябрь"},
        {"title": "WAPE расход (месяц)", "value": f"{results['targets']['out']['wape']}%", "hint": "fixed + variable residual"},
        {"title": "vs октябрь", "value": f"{growth_in:+.1f}% / {growth_out:+.1f}%", "hint": "приход / расход"},
    ]

    tip = (
        f"XGBoost: ноябрь приход ≈ {round(next_in):,} сум ({growth_in:+.1f}%), "
        f"расход ≈ {round(next_out):,} ({growth_out:+.1f}%), "
        f"WAPE прихода {results['targets']['inn']['wape']}%."
    ).replace(",", " ")

    results.update({
        "method": "XGBoost · recursive приход + календарные обязательства + residual расход",
        "wapeIn": results["targets"]["inn"]["wape"],
        "wapeOut": results["targets"]["out"]["wape"],
        "wapeInWeek": results["targets"]["inn"]["wape_week"],
        "wapeOutWeek": results["targets"]["out"]["wape_week"],
        "wapeInDay": results["targets"]["inn"]["wape_day"],
        "wapeOutDay": results["targets"]["out"]["wape_day"],
        "nextMonthIn": round(next_in),
        "nextMonthOut": round(next_out),
        "nextMargin": round(next_in - next_out),
        "growthIn": growth_in,
        "growthOut": growth_out,
        "scenarios": scenarios,
        "months": hist_months + [{
            "label": "2026-11",
            "inn": round(next_in),
            "out": round(next_out),
            "margin": round(next_in - next_out),
            "marginPct": round((next_in - next_out) / max(1, next_in) * 1000) / 10,
            "kind": "forecast",
        }],
        "forward": forward_weeks,
        "daily": by_day,
        "categoryMonth": cat_month,
        "drivers": drivers,
        "topFeatures": results["targets"]["inn"]["importance"][:5],
        "tip": tip,
        "categories": {
            **results["categories"],
            **{c["cat"]: {
                **results["categories"].get(c["cat"], {}),
                "side": c["side"],
                "amount": c["amount"],
                "wape": c.get("wape"),
            } for c in cat_month},
        },
    })
    return results


def main():
    payload = json.load(sys.stdin)
    out = run(payload)
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
