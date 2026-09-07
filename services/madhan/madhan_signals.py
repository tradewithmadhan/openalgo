"""
MadhaN Signals — Pine Script to Python conversion.

9 individual signals (B1-B9, S1-S9) + 5in1 + AIO Main (direction changes) + AIO Sub (raw signals).

Signal Logic:
  B1/S1: Close > max(high[1], high[2]) with opposite prev 2 candles
  B2/S2: Doji[1] + next candle breaks prev candle range
  B3/S3: BullPinbar/BearPinbar[1] + next candle breaks high/low
  B4/S4: ATR trailing stop reversal (ls/ss)
  B5/S5: Candle range >= avg range with high/low break (custom filters: first-only, color, momentum)
  B6/S6: Consecutive pinbars in same direction
  B7/S7: EMA5 crossover (hlc3)
  B8/S8: Triple EMA (13, 34, 55) new cross
  B9/S9: TCC (Trend Change Candle) — cumulative red/green momentum
  5in1: All 5 candles in same 5-min bucket are same direction (no move logic)

ATR: Wilder's RMA (not EMA) — matches Pine Script ta.atr()

S5 Custom Filters (beyond Pine Script):
  - First-only: only first candle in consecutive sequence
  - Color filter: buy requires green candle (close > open), sell requires red
  - Momentum: close > previous close (buy) / close < previous close (sell)
  - Range: candle range > previous candle range

S9 (TCC) Logic:
  - Track last red candle high and last green candle low
  - Green close > last red high = buy signal (momentum shift to buyers)
  - Red close < last green low = sell signal (momentum shift to sellers)
  - Buy momentum resets on next red candle, sell momentum resets on next green
  - alreadyBought/alreadySold reset when opposite trigger fires
  - Signal fires on FIRST candle of momentum change
  - Unlike S1 (prev 2 candles only), TCC tracks cumulative momentum

5in1 Logic:
  - Group 1-min candles into 5-min buckets (12:00-12:05, etc.)
  - If ALL 5 candles in bucket are same direction → signal at 5th candle
  - NON-REPAINTING: All candles must be closed
  - NO MOVE LOGIC: Raw signal at 5th candle (unlike app.py which moves to streak start)
  - Use this for testing without displacement

AIO Sub: OR of S1,S2,S4,S6,S7,S8 + not BearPinbar/BullPinbar filter
  - Excludes S3 (pinbar dependent), S5 (small candle can trigger), S9 (no size filter)
  - No dedup (fires on every signal)

AIO Test01-A: Level break signals
  - Track last AIO Sub buy signal low and sell signal high
  - Close above last sell high = buy signal (once)
  - Close below last buy low = sell signal (once)
  - Levels update only when AIO Sub direction changes

AIO Test01-B: AIO Sub alternating only
  - Same as AIO Sub but ignores if last signal was same direction
  - Buy → Sell → Buy → Sell pattern

AIO Test01: A + B combined

Levels: Step-like lines from AIO Main last buy low / last sell high
"""

import numpy as np
import pandas as pd


def compute_madhan_signals(df):
    """
    Compute all 8 signals + AIO Main + AIO Sub from 5-min OHLCV data.

    Args:
        df: DataFrame with columns [open, high, low, close, timestamp]

    Returns:
        dict with keys: s1..s8, aio_main, aio_sub, levels
        Each signal is list of {time, dir} where time is epoch seconds.
        levels is list of {time, buy_level, sell_level}.
    """
    o = df["open"].values.astype(float)
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    c = df["close"].values.astype(float)
    n = len(c)

    # ── Helpers ──────────────────────────────────────────────────────────

    def ema(src, period):
        out = np.empty(n)
        out[:] = np.nan
        if n < period:
            return out
        out[period - 1] = np.mean(src[:period])
        k = 2.0 / (period + 1)
        for i in range(period, n):
            out[i] = src[i] * k + out[i - 1] * (1 - k)
        return out

    def atr(hi, lo, cl, period):
        """RMA (Wilder's smoothing) — matches Pine Script's ta.atr().
        Formula: (prev*(n-1) + curr) / n
        Not EMA — this is Wilder's smoothing method."""
        tr = np.empty(n)
        tr[0] = hi[0] - lo[0]
        for i in range(1, n):
            tr[i] = max(hi[i] - lo[i], abs(hi[i] - cl[i - 1]), abs(lo[i] - cl[i - 1]))
        out = np.empty(n)
        out[:] = np.nan
        if n < period:
            return out
        out[period - 1] = np.mean(tr[:period])
        for i in range(period, n):
            out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
        return out

    def ta_valuewhen(cond, val, occ):
        """Return val at the occ-th most recent True in cond."""
        result = np.empty(n)
        result[:] = np.nan
        hits = []
        for i in range(n):
            if cond[i]:
                hits.append(i)
            if len(hits) > occ:
                result[i] = val[hits[-(occ + 1)]]
        return result

    def nz(x, default=0.0):
        return default if np.isnan(x) else x

    # ── Derived ──────────────────────────────────────────────────────────

    body = np.abs(c - o)
    upshadow = np.where(o > c, h - o, h - c)
    downshadow = np.where(o > c, c - l, o - l)
    c_pos_neg = np.where(o > c, -1, np.where(o < c, 1, 0))

    BullPinbar = (downshadow > body) & (downshadow > 1.23 * upshadow)
    BearPinbar = (upshadow > body) & (upshadow > 1.23 * downshadow)
    Dojibar = (upshadow > 0.7 * body) & (downshadow > 0.7 * body)

    hlc3 = (h + l + c) / 3.0
    candle_range = h - l

    # ── EMA indicators ───────────────────────────────────────────────────

    ema5 = ema(hlc3, 5)
    emaFast = ema(hlc3, 13)
    emaMedium = ema(hlc3, 34)
    emaSlow = ema(hlc3, 55)

    # ── Signal 4: ATR trailing stop ──────────────────────────────────────

    ar = 1.0 * atr(h, l, c, 7)
    ls = np.empty(n)
    ss = np.empty(n)
    ls[:] = np.nan
    ss[:] = np.nan

    for i in range(n):
        ls_val = hlc3[i] - ar[i] if not np.isnan(ar[i]) else np.nan
        ss_val = hlc3[i] + ar[i] if not np.isnan(ar[i]) else np.nan
        if i > 0 and not np.isnan(ls[i - 1]):
            ls_val = max(ls_val, ls[i - 1]) if c[i - 1] > ls[i - 1] else ls_val
        if i > 0 and not np.isnan(ss[i - 1]):
            ss_val = min(ss_val, ss[i - 1]) if c[i - 1] < ss[i - 1] else ss_val
        ls[i] = ls_val
        ss[i] = ss_val

    dr = np.ones(n)
    for i in range(1, n):
        dr[i] = dr[i - 1]
        if dr[i - 1] == -1 and c[i] > ss[i - 1]:
            dr[i] = 1
        elif dr[i - 1] == 1 and c[i] < ls[i - 1]:
            dr[i] = -1

    # ── Signal 5: avg range ──────────────────────────────────────────────
    # Pine: (CandleRange[1]+CandleRange[1]+CandleRange[3]+...+CandleRange[7])/7
    # CandleRange[1] used twice, CandleRange[2] skipped — matches original Pine Script
    # avg_high = open + avg_candle_range/2 (midpoint + half range)
    # avg_low = open - avg_candle_range/2 (midpoint - half range)

    avg_candle_range = np.empty(n)
    avg_candle_range[:] = np.nan
    for i in range(7, n):
        avg_candle_range[i] = (candle_range[i-1]*2 + candle_range[i-3] + candle_range[i-4] +
                               candle_range[i-5] + candle_range[i-6] + candle_range[i-7]) / 7.0

    avg_high = o + avg_candle_range / 2.0
    avg_low = o - avg_candle_range / 2.0

    # ── Compute 8 signals ────────────────────────────────────────────

    b1 = np.zeros(n, dtype=bool)
    s1 = np.zeros(n, dtype=bool)
    b2 = np.zeros(n, dtype=bool)
    s2 = np.zeros(n, dtype=bool)
    b3 = np.zeros(n, dtype=bool)
    s3 = np.zeros(n, dtype=bool)
    b4 = np.zeros(n, dtype=bool)
    s4 = np.zeros(n, dtype=bool)
    b5 = np.zeros(n, dtype=bool)
    s5 = np.zeros(n, dtype=bool)
    b6 = np.zeros(n, dtype=bool)
    s6 = np.zeros(n, dtype=bool)
    b7 = np.zeros(n, dtype=bool)
    s7 = np.zeros(n, dtype=bool)
    b8 = np.zeros(n, dtype=bool)
    s8 = np.zeros(n, dtype=bool)

    # ── Signal 9 (TCC): Trend Change Candle ──────────────────────────────
    # Converted from Pine Script — tracks cumulative red/green momentum
    #
    # Logic:
    # 1. Track last red candle high and last green candle low
    # 2. Buy trigger: green candle closes ABOVE last red candle high
    #    (and not already bought). Signals momentum shift to buyers.
    # 3. Sell trigger: red candle closes BELOW last green candle low
    #    (and not already sold). Signals momentum shift to sellers.
    # 4. Buy momentum resets on next red candle.
    #    Sell momentum resets on next green candle.
    # 5. alreadyBought/alreadySold reset when opposite trigger fires.
    # 6. Signal fires on FIRST candle of momentum change.
    #
    # Unlike S1 (which only looks at prev 2 candles), TCC tracks
    # cumulative momentum over time — closer to any distance break.
    #
    # No candle size check — even small candles can trigger signal.
    # No same-direction filter — handled in Test01-B instead.
    #
    # Example:
    #   Red candle high = 100
    #   Green candle closes at 102 → BUY signal
    #   Green candle closes at 105 → no signal (already_bought=True)
    #   Red candle → buy_momentum resets
    #   Green candle closes at 108 → no signal (already_bought still True)
    #   Red candle closes below green low → SELL signal, already_bought resets
    #   Green candle closes at 110 → BUY signal again
    #
    # Variables:
    #   last_red_high: highest high of recent red candle (tracks sell level)
    #   last_green_low: lowest low of recent green candle (tracks buy level)
    #   tcc_buy_momentum: True when buy signal just fired (resets on red)
    #   tcc_sell_momentum: True when sell signal just fired (resets on green)
    #   tcc_already_bought: prevents duplicate buy until sell fires
    #   tcc_already_sold: prevents duplicate sell until buy fires

    b9 = np.zeros(n, dtype=bool)
    s9 = np.zeros(n, dtype=bool)
    last_red_high = None
    last_green_low = None
    tcc_buy_momentum = False
    tcc_sell_momentum = False
    tcc_already_bought = False
    tcc_already_sold = False

    for i in range(n):
        is_red = c[i] < o[i]
        is_green = c[i] > o[i]
        prev_buy_mom = tcc_buy_momentum
        prev_sell_mom = tcc_sell_momentum

        # Track levels — update on every candle of that color
        if is_red:
            last_red_high = h[i]  # track red high for buy break
            tcc_buy_momentum = False  # reset buy momentum on red

        if is_green:
            last_green_low = l[i]  # track green low for sell break
            tcc_sell_momentum = False  # reset sell momentum on green

        # Buy trigger: green closes above last red high
        # Requires: is_green AND close > last_red_high AND not already bought
        if is_green and last_red_high is not None and c[i] > last_red_high and not tcc_already_bought:
            tcc_buy_momentum = True
            tcc_already_bought = True  # prevent duplicate buy

        # Sell trigger: red closes below last green low
        # Requires: is_red AND close < last_green_low AND not already sold
        if is_red and last_green_low is not None and c[i] < last_green_low and not tcc_already_sold:
            tcc_sell_momentum = True
            tcc_already_sold = True  # prevent duplicate sell

        # Reset alreadySold when buy triggers for first time
        # This allows next sell to fire after buy
        if tcc_buy_momentum and not prev_buy_mom:
            tcc_already_sold = False

        # Reset alreadyBought when sell triggers for first time
        # This allows next buy to fire after sell
        if tcc_sell_momentum and not prev_sell_mom:
            tcc_already_bought = False

        # Emit signal on trigger (first candle of momentum)
        # Only fires when momentum just changed (prev was False, now True)
        if tcc_buy_momentum and not prev_buy_mom:
            b9[i] = True
        elif tcc_sell_momentum and not prev_sell_mom:
            s9[i] = True

    for i in range(2, n):
        # ── B1/S1: Close breaks prev 2 candle extreme ────────────────────
        # Buy: close > max(high[1], high[2]) AND prev 2 candles are opposite colors
        # Sell: close < min(low[1], low[2]) AND prev 2 candles are opposite colors
        # Why: Momentum break with reversal confirmation
        b1[i] = (c[i] > max(h[i - 1], h[i - 2])) and (
            (c_pos_neg[i - 1] == 1 and c_pos_neg[i - 2] == -1) or
            (c_pos_neg[i - 1] == -1 and c_pos_neg[i - 2] == 1)
        )
        s1[i] = (c[i] < min(l[i - 1], l[i - 2])) and (
            (c_pos_neg[i - 1] == 1 and c_pos_neg[i - 2] == -1) or
            (c_pos_neg[i - 1] == -1 and c_pos_neg[i - 2] == 1)
        )

        # ── B2/S2: Doji breakout ────────────────────────────────────────
        # Buy: Doji[1] + current candle breaks above max(high[1], open[2], close[2])
        # Sell: Doji[1] + current candle breaks below min(low[1], open[2], close[2])
        # Why: Doji = indecision, breakout confirms direction
        if i >= 2:
            b2[i] = Dojibar[i - 1] and c[i] >= max(h[i - 1], o[i - 2], c[i - 2])
            s2[i] = Dojibar[i - 1] and c[i] <= min(l[i - 1], o[i - 2], c[i - 2])

        # ── B3/S3: Pinbar breakout ──────────────────────────────────────
        # Buy: BullPinbar[1] + current candle breaks above high[1]
        # Sell: BearPinbar[1] + current candle breaks below low[1]
        # Why: Pinbar = rejection, breakout confirms reversal
        b3[i] = BullPinbar[i - 1] and c[i] >= h[i - 1]
        s3[i] = BearPinbar[i - 1] and c[i] <= l[i - 1]

        # ── B4/S4: ATR trailing stop reversal ────────────────────────────
        # Buy: direction changes from -1 to 1 (close crosses above ls)
        # Sell: direction changes from 1 to -1 (close crosses below ss)
        # Why: ATR-based trailing stop, captures trend reversals
        if i >= 1:
            b4[i] = (dr[i] == 1 and dr[i - 1] == -1)
            s4[i] = (dr[i] == -1 and dr[i - 1] == 1)

        # ── B5/S5: Candle range >= avg range with high/low break ──────────
        # Buy: green candle + close > prev close + range >= avg + range > prev range + high > avg_high
        # Sell: red candle + close < prev close + range >= avg + range > prev range + low < avg_low
        # Custom filters (beyond Pine Script):
        #   1. First-only: only first candle in consecutive sequence
        #   2. Color: buy requires green candle (close > open), sell requires red
        #   3. Momentum: close > previous close (buy) / close < previous close (sell)
        #   4. Range: candle range > previous candle range
        # Why: Large momentum candle with range expansion
        if not np.isnan(avg_candle_range[i]) and i >= 1:
            is_green = c[i] > o[i]
            is_red = c[i] < o[i]
            b5[i] = is_green and (c[i] > c[i - 1]) and (candle_range[i] >= avg_candle_range[i]) and (candle_range[i] > candle_range[i - 1]) and (h[i] > avg_high[i])
            s5[i] = is_red and (c[i] < c[i - 1]) and (candle_range[i] >= avg_candle_range[i]) and (candle_range[i] > candle_range[i - 1]) and (l[i] < avg_low[i])
            # Only keep first in consecutive sequence
            if b5[i] and b5[i - 1]:
                b5[i] = False
            if s5[i] and s5[i - 1]:
                s5[i] = False

        # ── B6/S6: Consecutive pinbars ───────────────────────────────────
        # Buy: BullPinbar[1] + BullPinbar[0] + close > prev close + close > prev open
        # Sell: BearPinbar[1] + BearPinbar[0] + close < prev close + close < prev open
        # Why: Two consecutive rejection candles with confirmation
        b6[i] = BullPinbar[i - 1] and BullPinbar[i] and c[i] > c[i - 1] and c[i] > o[i - 1]
        s6[i] = BearPinbar[i - 1] and BearPinbar[i] and c[i] < c[i - 1] and c[i] < o[i - 1]

        # ── B7/S7: EMA5 crossover ────────────────────────────────────────
        # Buy: close > EMA5 AND prev high < prev EMA5 AND green candle
        # Sell: close < EMA5 AND prev low > prev EMA5 AND red candle
        # Why: Short-term momentum shift with trend confirmation
        if not np.isnan(ema5[i]) and not np.isnan(ema5[i - 1]):
            b7[i] = (c[i] > ema5[i]) and (h[i - 1] < ema5[i - 1]) and (c[i] > o[i])
            s7[i] = (c[i] < ema5[i]) and (l[i - 1] > ema5[i - 1]) and (c[i] < o[i])

        # ── B8/S8: Triple EMA new cross ──────────────────────────────────
        # Buy: close > all 3 EMAs (13, 34, 55) AND prev close was NOT above all 3
        # Sell: close < all 3 EMAs (13, 34, 55) AND prev close was NOT below all 3
        # Why: Strong trend alignment with new momentum
        if not np.isnan(emaFast[i]) and not np.isnan(emaMedium[i]) and not np.isnan(emaSlow[i]):
            if not np.isnan(emaFast[i - 1]) and not np.isnan(emaMedium[i - 1]) and not np.isnan(emaSlow[i - 1]):
                is_buy = c[i] > emaFast[i] and c[i] > emaMedium[i] and c[i] > emaSlow[i]
                is_buy_prev = c[i - 1] > emaFast[i - 1] and c[i - 1] > emaMedium[i - 1] and c[i - 1] > emaSlow[i - 1]
                is_sell = c[i] < emaFast[i] and c[i] < emaMedium[i] and c[i] < emaSlow[i]
                is_sell_prev = c[i - 1] < emaFast[i - 1] and c[i - 1] < emaMedium[i - 1] and c[i - 1] < emaSlow[i - 1]
                b8[i] = is_buy and not is_buy_prev
                s8[i] = is_sell and not is_sell_prev

    # ── AIO Sub: consolidated raw signals ────────────────────────────────
    # OR of S1,S2,S4,S6,S7,S8 + not BearPinbar/BullPinbar filter
    # Excludes:
    #   S3: Pinbar dependent (redundant with S6 which also uses pinbars)
    #   S5: Small candle can trigger (has avg range check but still risky)
    #   S9: No candle size filter (even tiny candles can trigger)
    # No dedup — fires on every signal (2-bar dedup commented out)
    # Why this组合: Captures multiple signal types without size-dependent signals

    aio_buy = np.zeros(n, dtype=bool)
    aio_sell = np.zeros(n, dtype=bool)
    for i in range(n):
        aio_buy[i] = (b1[i] or b2[i] or b4[i] or b6[i] or b7[i] or b8[i]) and not BearPinbar[i]
        aio_sell[i] = (s1[i] or s2[i] or s4[i] or s6[i] or s7[i] or s8[i]) and not BullPinbar[i]

    mad_long = np.zeros(n, dtype=bool)
    mad_short = np.zeros(n, dtype=bool)
    for i in range(2, n):
        ## 2-bar dedup removed — fire on every aio_buy/aio_sell
        mad_long[i] = aio_buy[i] # and not aio_buy[i - 1] and not aio_buy[i - 2]
        mad_short[i] = aio_sell[i] # and not aio_sell[i - 1] and not aio_sell[i - 2]

    # ── AIO Test01-A: Level break signals ──────────────────────────────
    # Track last AIO Sub buy signal low and sell signal high
    # Only update level when AIO Sub direction changes (buy→sell or sell→buy)
    # Close above last sell high = buy signal (fires once until opposite break)
    # Close below last buy low = sell signal (fires once until opposite break)
    # Level break resets opposite flag — alternates buy/sell breaks

    last_buy_signal_low = None
    last_sell_signal_high = None
    level_break_buy_done = False
    level_break_sell_done = False
    last_aio_dir = 0  # 1=long, -1=short
    aio_test01a_long = np.zeros(n, dtype=bool)
    aio_test01a_short = np.zeros(n, dtype=bool)
    for i in range(n):
        # Update level only on direction change
        if mad_long[i] and last_aio_dir != 1:
            last_buy_signal_low = l[i]
            last_aio_dir = 1
        if mad_short[i] and last_aio_dir != -1:
            last_sell_signal_high = h[i]
            last_aio_dir = -1
        # Level break signals — fire once per direction
        if last_sell_signal_high is not None and c[i] > last_sell_signal_high and not level_break_buy_done:
            aio_test01a_long[i] = True
            level_break_buy_done = True
            level_break_sell_done = False
        if last_buy_signal_low is not None and c[i] < last_buy_signal_low and not level_break_sell_done:
            aio_test01a_short[i] = True
            level_break_sell_done = True
            level_break_buy_done = False

    # ── AIO Test01-B: AIO Sub alternating only ────────────────────────
    # Same as AIO Sub but ignores if last signal was same direction
    # Ensures buy → sell → buy → sell pattern (no consecutive same direction)

    aio_test01b_long = np.zeros(n, dtype=bool)
    aio_test01b_short = np.zeros(n, dtype=bool)
    last_test01b_dir = 0  # 1=long, -1=short, 0=none
    for i in range(n):
        if mad_long[i] and last_test01b_dir != 1:
            aio_test01b_long[i] = True
            last_test01b_dir = 1
        elif mad_short[i] and last_test01b_dir != -1:
            aio_test01b_short[i] = True
            last_test01b_dir = -1

    # ── AIO Test01: A + B combined ────────────────────────────────────
    # Level break signals (always show) + AIO Sub alternating signals

    aio_test01_long = aio_test01a_long | aio_test01b_long
    aio_test01_short = aio_test01a_short | aio_test01b_short

    # ── AIO Main: direction tracking ─────────────────────────────────────
    # Tracks market direction (1=long, -1=short, 0=neutral)
    # Direction changes on various conditions:
    #   - AIO Sub signal + close breaks opposite level
    #   - Buy low/high increases while in long direction
    #   - Sell high/low decreases while in short direction
    #   - 4+ candles without opposite signal + new signal + level holds
    #   - Close breaks last sell high (for long) or last buy low (for short)

    last_sell_high = ta_valuewhen(mad_short, h, 0)
    last_sell_low = ta_valuewhen(mad_short, l, 0)
    last_buy_low = ta_valuewhen(mad_long, l, 0)
    last_buy_high = ta_valuewhen(mad_long, h, 0)

    direction = np.zeros(n)
    for i in range(1, n):
        direction[i] = direction[i - 1]
        cond_long = (
            mad_long[i] and c[i] > nz(last_sell_high[i - 1]) or
            (nz(last_buy_low[i]) > nz(last_buy_low[i - 1]) and direction[i - 1] == 1) or
            (nz(last_buy_high[i]) > nz(last_buy_high[i - 1]) and direction[i - 1] == 1) or
            (
                i >= 4 and
                not mad_short[i - 1] and not mad_short[i - 2] and not mad_short[i - 3] and not mad_short[i - 4] and
                mad_long[i] and
                (mad_long[i - 2] or mad_long[i - 3] or mad_long[i - 4]) and
                l[i] > nz(last_buy_low[i - 1])
            ) or
            c[i] > nz(last_sell_high[i - 1])
        )
        cond_short = (
            mad_short[i] and c[i] < nz(last_buy_low[i - 1]) or
            (nz(last_sell_high[i]) < nz(last_sell_high[i - 1]) and direction[i - 1] == -1) or
            (nz(last_sell_low[i]) < nz(last_sell_low[i - 1]) and direction[i - 1] == -1) or
            (
                i >= 4 and
                not mad_long[i - 1] and not mad_long[i - 2] and not mad_long[i - 3] and not mad_long[i - 4] and
                mad_short[i] and
                (mad_short[i - 2] or mad_short[i - 3] or mad_short[i - 4])
            ) or
            c[i] < nz(last_buy_low[i - 1])
        )
        if cond_long:
            direction[i] = 1
        elif cond_short:
            direction[i] = -1

    # ── AIO Main signals: direction changes ──────────────────────────────
    # Fires when direction changes from non-long to long (buy)
    # or from non-short to short (sell)
    # Only the FIRST candle of each direction change fires

    long_condition = np.zeros(n, dtype=bool)
    short_condition = np.zeros(n, dtype=bool)
    for i in range(1, n):
        long_condition[i] = (direction[i] == 1 and direction[i - 1] != 1)
        short_condition[i] = (direction[i] == -1 and direction[i - 1] != -1)

    # ── Convert to signal lists ──────────────────────────────────────────

    times = df["timestamp"].values

    def to_signals(cond_buy, cond_sell):
        buys = [{"time": int(times[i]), "dir": "up"}
                for i in range(n) if cond_buy[i]]
        sells = [{"time": int(times[i]), "dir": "down"}
                 for i in range(n) if cond_sell[i]]
        return buys, sells

    # ── Levels: step-like lines from AIO Main ────────────────────────────
    # Tracks last buy signal low and last sell signal high from AIO Main
    # Updates on AIO Sub signals and direction changes
    # Used for horizontal level lines on chart

    def to_levels():
        levels = []
        for i in range(n):
            if mad_long[i] or mad_short[i] or direction[i] != direction[i - 1]:
                levels.append({
                    "time": int(times[i]),
                    "buy_level": float(last_buy_low[i]) if not np.isnan(last_buy_low[i]) else None,
                    "sell_level": float(last_sell_high[i]) if not np.isnan(last_sell_high[i]) else None,
                })
        return levels

    s1_buys, s1_sells = to_signals(b1, s1)
    s2_buys, s2_sells = to_signals(b2, s2)
    s3_buys, s3_sells = to_signals(b3, s3)
    s4_buys, s4_sells = to_signals(b4, s4)
    s5_buys, s5_sells = to_signals(b5, s5)
    s6_buys, s6_sells = to_signals(b6, s6)
    s7_buys, s7_sells = to_signals(b7, s7)
    s8_buys, s8_sells = to_signals(b8, s8)
    s9_buys, s9_sells = to_signals(b9, s9)
    aio_main_buys, aio_main_sells = to_signals(long_condition, short_condition)
    aio_sub_buys, aio_sub_sells = to_signals(mad_long, mad_short)
    aio_test01_buys, aio_test01_sells = to_signals(aio_test01_long, aio_test01_short)
    aio_test01a_buys, aio_test01a_sells = to_signals(aio_test01a_long, aio_test01a_short)
    aio_test01b_buys, aio_test01b_sells = to_signals(aio_test01b_long, aio_test01b_short)
    levels = to_levels()

    return {
        "s1": {"buys": s1_buys, "sells": s1_sells},
        "s2": {"buys": s2_buys, "sells": s2_sells},
        "s3": {"buys": s3_buys, "sells": s3_sells},
        "s4": {"buys": s4_buys, "sells": s4_sells},
        "s5": {"buys": s5_buys, "sells": s5_sells},
        "s6": {"buys": s6_buys, "sells": s6_sells},
        "s7": {"buys": s7_buys, "sells": s7_sells},
        "s8": {"buys": s8_buys, "sells": s8_sells},
        "s9": {"buys": s9_buys, "sells": s9_sells},
        "aio_main": {"buys": aio_main_buys, "sells": aio_main_sells},
        "aio_sub": {"buys": aio_sub_buys, "sells": aio_sub_sells},
        "aio_test01": {"buys": aio_test01_buys, "sells": aio_test01_sells},
        "aio_test01a": {"buys": aio_test01a_buys, "sells": aio_test01a_sells},
        "aio_test01b": {"buys": aio_test01b_buys, "sells": aio_test01b_sells},
        "levels": levels,
    }


def compute_5in1_only(df):
    """
    Compute 5in1 signal from 1-min data.

    Args:
        df: DataFrame with columns [open, close, timestamp]

    Returns:
        dict with keys: buys, sells
    """
    buys = []
    sells = []

    o = df["open"].values.astype(float)
    c = df["close"].values.astype(float)
    times_ts = df["timestamp"].values

    bucket_start = None
    bucket_idx = []
    prev_had_signal = False  # did previous 5-min bucket have any 5in1 signal?

    def _check_and_append(indices, bstart):
        nonlocal prev_had_signal
        if len(indices) >= 5:
            all_green = all(c[j] > o[j] for j in indices)
            all_red = all(c[j] < o[j] for j in indices)
            if all_green and not prev_had_signal:
                buys.append({"time": bstart, "dir": "up"})
                prev_had_signal = True
            elif all_red and not prev_had_signal:
                sells.append({"time": bstart, "dir": "down"})
                prev_had_signal = True
            elif all_green or all_red:
                # Has signal but prev also had signal → skip
                pass
            else:
                # No signal in this bucket → reset flag
                prev_had_signal = False
        else:
            # Less than 5 candles → not a signal bucket → reset flag
            prev_had_signal = False

    for i in range(len(df)):
        ts = int(times_ts[i])
        bucket = (ts // 300) * 300  # 5-min bucket
        if bucket_start is None:
            bucket_start = bucket
        if bucket != bucket_start:
            _check_and_append(bucket_idx, bucket_start)
            bucket_start = bucket
            bucket_idx = [i]
        else:
            bucket_idx.append(i)
    _check_and_append(bucket_idx, bucket_start)

    return {"buys": buys, "sells": sells}


# ══════════════════════════════════════════════════════════════════════════════
# Standalone signal functions
# Each function internally computes its own dependencies and returns only
# its specific signal. Use these when you need individual signals without
# computing everything.
#
# Usage:
#   from madhan_signals import compute_test01a, compute_s1
#   test01a = compute_test01a(df_5m)
#   s1 = compute_s1(df_5m)
# ══════════════════════════════════════════════════════════════════════════════


def _ema(src, period, n):
    """EMA helper — shared across all standalone functions."""
    out = np.empty(n)
    out[:] = np.nan
    if n < period:
        return out
    out[period - 1] = np.mean(src[:period])
    k = 2.0 / (period + 1)
    for i in range(period, n):
        out[i] = src[i] * k + out[i - 1] * (1 - k)
    return out


def _atr(hi, lo, cl, period, n):
    """RMA (Wilder's smoothing) — matches Pine Script's ta.atr()."""
    tr = np.empty(n)
    tr[0] = hi[0] - lo[0]
    for i in range(1, n):
        tr[i] = max(hi[i] - lo[i], abs(hi[i] - cl[i - 1]), abs(lo[i] - cl[i - 1]))
    out = np.empty(n)
    out[:] = np.nan
    if n < period:
        return out
    out[period - 1] = np.mean(tr[:period])
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def _ta_valuewhen(cond, val, occ, n):
    """Return val at the occ-th most recent True in cond."""
    result = np.empty(n)
    result[:] = np.nan
    hits = []
    for i in range(n):
        if cond[i]:
            hits.append(i)
        if len(hits) > occ:
            result[i] = val[hits[-(occ + 1)]]
    return result


def _nz(x, default=0.0):
    """Replace NaN with default."""
    return default if np.isnan(x) else default if np.isnan(x) else x


def _compute_internals(df):
    """
    Shared helper — computes all derived arrays from OHLCV data.
    Returns dict with:
        o, h, l, c, n — raw arrays
        body, upshadow, downshadow, c_pos_neg — candle shapes
        BullPinbar, BearPinbar, Dojibar — pattern recognition
        hlc3, candle_range, avg_candle_range, avg_high, avg_low — range
        ema5, emaFast, emaMedium, emaSlow — EMA indicators
        ar, ls, ss, dr — ATR trailing stop (for S4/AIO)
        times — timestamp array
    """
    o = df["open"].values.astype(float)
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    c = df["close"].values.astype(float)
    n = len(c)
    times = df["timestamp"].values

    # Candle shape
    body = np.abs(c - o)
    upshadow = np.where(o > c, h - o, h - c)
    downshadow = np.where(o > c, c - l, o - l)
    c_pos_neg = np.where(o > c, -1, np.where(o < c, 1, 0))

    # Pattern recognition
    BullPinbar = (downshadow > body) & (downshadow > 1.23 * upshadow)
    BearPinbar = (upshadow > body) & (upshadow > 1.23 * downshadow)
    Dojibar = (upshadow > 0.7 * body) & (downshadow > 0.7 * body)

    # Range
    hlc3 = (h + l + c) / 3.0
    candle_range = h - l

    # EMA indicators
    ema5 = _ema(hlc3, 5, n)
    emaFast = _ema(hlc3, 13, n)
    emaMedium = _ema(hlc3, 34, n)
    emaSlow = _ema(hlc3, 55, n)

    # ATR trailing stop (for S4 and AIO)
    ar = 1.0 * _atr(h, l, c, 7, n)
    ls = np.empty(n)
    ss = np.empty(n)
    ls[:] = np.nan
    ss[:] = np.nan
    for i in range(n):
        ls_val = hlc3[i] - ar[i] if not np.isnan(ar[i]) else np.nan
        ss_val = hlc3[i] + ar[i] if not np.isnan(ar[i]) else np.nan
        if i > 0 and not np.isnan(ls[i - 1]):
            ls_val = max(ls_val, ls[i - 1]) if c[i - 1] > ls[i - 1] else ls_val
        if i > 0 and not np.isnan(ss[i - 1]):
            ss_val = min(ss_val, ss[i - 1]) if c[i - 1] < ss[i - 1] else ss_val
        ls[i] = ls_val
        ss[i] = ss_val

    dr = np.ones(n)
    for i in range(1, n):
        dr[i] = dr[i - 1]
        if dr[i - 1] == -1 and c[i] > ss[i - 1]:
            dr[i] = 1
        elif dr[i - 1] == 1 and c[i] < ls[i - 1]:
            dr[i] = -1

    # Avg candle range (for S5)
    avg_candle_range = np.empty(n)
    avg_candle_range[:] = np.nan
    for i in range(7, n):
        avg_candle_range[i] = (candle_range[i-1]*2 + candle_range[i-3] + candle_range[i-4] +
                               candle_range[i-5] + candle_range[i-6] + candle_range[i-7]) / 7.0
    avg_high = o + avg_candle_range / 2.0
    avg_low = o - avg_candle_range / 2.0

    return {
        "o": o, "h": h, "l": l, "c": c, "n": n, "times": times,
        "body": body, "upshadow": upshadow, "downshadow": downshadow,
        "c_pos_neg": c_pos_neg,
        "BullPinbar": BullPinbar, "BearPinbar": BearPinbar, "Dojibar": Dojibar,
        "hlc3": hlc3, "candle_range": candle_range,
        "avg_candle_range": avg_candle_range, "avg_high": avg_high, "avg_low": avg_low,
        "ema5": ema5, "emaFast": emaFast, "emaMedium": emaMedium, "emaSlow": emaSlow,
        "ar": ar, "ls": ls, "ss": ss, "dr": dr,
    }


def _to_signals(cond_buy, cond_sell, times, n):
    """Convert boolean arrays to signal dicts."""
    buys = [{"time": int(times[i]), "dir": "up"} for i in range(n) if cond_buy[i]]
    sells = [{"time": int(times[i]), "dir": "down"} for i in range(n) if cond_sell[i]]
    return {"buys": buys, "sells": sells}


# ── Individual signal functions ────────────────────────────────────────────


def compute_s1(df):
    """
    S1/B1: Close breaks prev 2 candle extreme with opposite prev 2 candles.
    Buy: close > max(high[1], high[2]) AND prev 2 are opposite colors.
    Sell: close < min(low[1], low[2]) AND prev 2 are opposite colors.
    """
    ins = _compute_internals(df)
    n, o, h, l, c = ins["n"], ins["o"], ins["h"], ins["l"], ins["c"]
    c_pos_neg = ins["c_pos_neg"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b[i] = (c[i] > max(h[i - 1], h[i - 2])) and (
            (c_pos_neg[i - 1] == 1 and c_pos_neg[i - 2] == -1) or
            (c_pos_neg[i - 1] == -1 and c_pos_neg[i - 2] == 1)
        )
        s[i] = (c[i] < min(l[i - 1], l[i - 2])) and (
            (c_pos_neg[i - 1] == 1 and c_pos_neg[i - 2] == -1) or
            (c_pos_neg[i - 1] == -1 and c_pos_neg[i - 2] == 1)
        )
    return _to_signals(b, s, ins["times"], n)


def compute_s2(df):
    """
    S2/B2: Doji breakout.
    Buy: Doji[1] + close >= max(high[1], open[2], close[2]).
    Sell: Doji[1] + close <= min(low[1], open[2], close[2]).
    """
    ins = _compute_internals(df)
    n, o, h, l, c = ins["n"], ins["o"], ins["h"], ins["l"], ins["c"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b[i] = ins["Dojibar"][i - 1] and c[i] >= max(h[i - 1], o[i - 2], c[i - 2])
        s[i] = ins["Dojibar"][i - 1] and c[i] <= min(l[i - 1], o[i - 2], c[i - 2])
    return _to_signals(b, s, ins["times"], n)


def compute_s3(df):
    """
    S3/B3: Pinbar breakout.
    Buy: BullPinbar[1] + close >= high[1].
    Sell: BearPinbar[1] + close <= low[1].
    """
    ins = _compute_internals(df)
    n, h, l, c = ins["n"], ins["h"], ins["l"], ins["c"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b[i] = ins["BullPinbar"][i - 1] and c[i] >= h[i - 1]
        s[i] = ins["BearPinbar"][i - 1] and c[i] <= l[i - 1]
    return _to_signals(b, s, ins["times"], n)


def compute_s4(df):
    """
    S4/B4: ATR trailing stop reversal.
    Buy: direction changes from -1 to 1.
    Sell: direction changes from 1 to -1.
    """
    ins = _compute_internals(df)
    n = ins["n"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b[i] = (ins["dr"][i] == 1 and ins["dr"][i - 1] == -1)
        s[i] = (ins["dr"][i] == -1 and ins["dr"][i - 1] == 1)
    return _to_signals(b, s, ins["times"], n)


def compute_s5(df):
    """
    S5/B5: Candle range >= avg range with high/low break.
    Buy: green + close > prev close + range >= avg + range > prev range + high > avg_high.
    Sell: red + close < prev close + range >= avg + range > prev range + low < avg_low.
    First-only filter: no consecutive signals.
    """
    ins = _compute_internals(df)
    n, o, h, l, c = ins["n"], ins["o"], ins["h"], ins["l"], ins["c"]
    candle_range = ins["candle_range"]
    avg_candle_range = ins["avg_candle_range"]
    avg_high = ins["avg_high"]
    avg_low = ins["avg_low"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        if not np.isnan(ins["avg_candle_range"][i]):
            is_green = c[i] > o[i]
            is_red = c[i] < o[i]
            b[i] = is_green and (c[i] > c[i - 1]) and (ins["candle_range"][i] >= ins["avg_candle_range"][i]) and (ins["candle_range"][i] > ins["candle_range"][i - 1]) and (h[i] > ins["avg_high"][i])
            s[i] = is_red and (c[i] < c[i - 1]) and (ins["candle_range"][i] >= ins["avg_candle_range"][i]) and (ins["candle_range"][i] > ins["candle_range"][i - 1]) and (l[i] < ins["avg_low"][i])
            if b[i] and b[i - 1]:
                b[i] = False
            if s[i] and s[i - 1]:
                s[i] = False
    return _to_signals(b, s, ins["times"], n)


def compute_s6(df):
    """
    S6/B6: Consecutive pinbars.
    Buy: BullPinbar[1] + BullPinbar[0] + close > prev close + close > prev open.
    Sell: BearPinbar[1] + BearPinbar[0] + close < prev close + close < prev open.
    """
    ins = _compute_internals(df)
    n, o, h, l, c = ins["n"], ins["o"], ins["h"], ins["l"], ins["c"]
    BullPinbar = ins["BullPinbar"]
    BearPinbar = ins["BearPinbar"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b[i] = ins["BullPinbar"][i - 1] and ins["BullPinbar"][i] and c[i] > c[i - 1] and c[i] > o[i - 1]
        s[i] = ins["BearPinbar"][i - 1] and ins["BearPinbar"][i] and c[i] < c[i - 1] and c[i] < o[i - 1]
    return _to_signals(b, s, ins["times"], n)


def compute_s7(df):
    """
    S7/B7: EMA5 crossover on hlc3.
    Buy: close > EMA5 AND prev high < prev EMA5 AND green candle.
    Sell: close < EMA5 AND prev low > prev EMA5 AND red candle.
    """
    ins = _compute_internals(df)
    n, o, h, l, c = ins["n"], ins["o"], ins["h"], ins["l"], ins["c"]
    ema5 = ins["ema5"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        if not np.isnan(ema5[i]) and not np.isnan(ema5[i - 1]):
            b[i] = (c[i] > ema5[i]) and (h[i - 1] < ema5[i - 1]) and (c[i] > o[i])
            s[i] = (c[i] < ema5[i]) and (l[i - 1] > ema5[i - 1]) and (c[i] < o[i])
    return _to_signals(b, s, ins["times"], n)


def compute_s8(df):
    """
    S8/B8: Triple EMA (13, 34, 55) new cross.
    Buy: close > all 3 EMAs AND prev close was NOT above all 3.
    Sell: close < all 3 EMAs AND prev close was NOT below all 3.
    """
    ins = _compute_internals(df)
    n, c = ins["n"], ins["c"]
    emaFast = ins["emaFast"]
    emaMedium = ins["emaMedium"]
    emaSlow = ins["emaSlow"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(2, n):
        if not np.isnan(ins["emaFast"][i]) and not np.isnan(ins["emaMedium"][i]) and not np.isnan(ins["emaSlow"][i]):
            if not np.isnan(ins["emaFast"][i - 1]) and not np.isnan(ins["emaMedium"][i - 1]) and not np.isnan(ins["emaSlow"][i - 1]):
                is_buy = c[i] > ins["emaFast"][i] and c[i] > ins["emaMedium"][i] and c[i] > ins["emaSlow"][i]
                is_buy_prev = c[i - 1] > ins["emaFast"][i - 1] and c[i - 1] > ins["emaMedium"][i - 1] and c[i - 1] > ins["emaSlow"][i - 1]
                is_sell = c[i] < ins["emaFast"][i] and c[i] < ins["emaMedium"][i] and c[i] < ins["emaSlow"][i]
                is_sell_prev = c[i - 1] < ins["emaFast"][i - 1] and c[i - 1] < ins["emaMedium"][i - 1] and c[i - 1] < ins["emaSlow"][i - 1]
                b[i] = is_buy and not is_buy_prev
                s[i] = is_sell and not is_sell_prev
    return _to_signals(b, s, ins["times"], n)


def compute_s9(df):
    """
    S9/B9: TCC — Trend Change Candle. Tracks cumulative red/green momentum.
    Buy: green close > last red high (first candle of momentum change).
    Sell: red close < last green low (first candle of momentum change).
    Resets: buy momentum on red, sell momentum on green.
    """
    ins = _compute_internals(df)
    n, o, h, l, c = ins["n"], ins["o"], ins["h"], ins["l"], ins["c"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    last_red_high = None
    last_green_low = None
    tcc_buy_momentum = False
    tcc_sell_momentum = False
    tcc_already_bought = False
    tcc_already_sold = False

    for i in range(n):
        is_red = c[i] < o[i]
        is_green = c[i] > o[i]
        prev_buy_mom = tcc_buy_momentum
        prev_sell_mom = tcc_sell_momentum

        if is_red:
            last_red_high = h[i]
            tcc_buy_momentum = False
        if is_green:
            last_green_low = l[i]
            tcc_sell_momentum = False

        if is_green and last_red_high is not None and c[i] > last_red_high and not tcc_already_bought:
            tcc_buy_momentum = True
            tcc_already_bought = True
        if is_red and last_green_low is not None and c[i] < last_green_low and not tcc_already_sold:
            tcc_sell_momentum = True
            tcc_already_sold = True
        if tcc_buy_momentum and not prev_buy_mom:
            tcc_already_sold = False
        if tcc_sell_momentum and not prev_sell_mom:
            tcc_already_bought = False
        if tcc_buy_momentum and not prev_buy_mom:
            b[i] = True
        elif tcc_sell_momentum and not prev_sell_mom:
            s[i] = True
    return _to_signals(b, s, ins["times"], n)


# ── Composite signal functions ─────────────────────────────────────────────


def _compute_all_signals(df):
    """
    Compute S1-S9 and derived arrays from OHLCV data.
    Returns dict with all boolean arrays and internals.
    Internal helper — not for public use.
    """
    ins = _compute_internals(df)
    n, o, h, l, c = ins["n"], ins["o"], ins["h"], ins["l"], ins["c"]

    # S1
    b1 = np.zeros(n, dtype=bool)
    s1 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b1[i] = (c[i] > max(h[i - 1], h[i - 2])) and (
            (ins["c_pos_neg"][i - 1] == 1 and ins["c_pos_neg"][i - 2] == -1) or
            (ins["c_pos_neg"][i - 1] == -1 and ins["c_pos_neg"][i - 2] == 1)
        )
        s1[i] = (c[i] < min(l[i - 1], l[i - 2])) and (
            (ins["c_pos_neg"][i - 1] == 1 and ins["c_pos_neg"][i - 2] == -1) or
            (ins["c_pos_neg"][i - 1] == -1 and ins["c_pos_neg"][i - 2] == 1)
        )

    # S2
    b2 = np.zeros(n, dtype=bool)
    s2 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b2[i] = ins["Dojibar"][i - 1] and c[i] >= max(h[i - 1], o[i - 2], c[i - 2])
        s2[i] = ins["Dojibar"][i - 1] and c[i] <= min(l[i - 1], o[i - 2], c[i - 2])

    # S3
    b3 = np.zeros(n, dtype=bool)
    s3 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b3[i] = ins["BullPinbar"][i - 1] and c[i] >= h[i - 1]
        s3[i] = ins["BearPinbar"][i - 1] and c[i] <= l[i - 1]

    # S4
    b4 = np.zeros(n, dtype=bool)
    s4 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b4[i] = (ins["dr"][i] == 1 and ins["dr"][i - 1] == -1)
        s4[i] = (ins["dr"][i] == -1 and ins["dr"][i - 1] == 1)

    # S5
    b5 = np.zeros(n, dtype=bool)
    s5 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        if not np.isnan(ins["avg_candle_range"][i]):
            is_green = c[i] > o[i]
            is_red = c[i] < o[i]
            b5[i] = is_green and (c[i] > c[i - 1]) and (ins["candle_range"][i] >= ins["avg_candle_range"][i]) and (ins["candle_range"][i] > ins["candle_range"][i - 1]) and (h[i] > ins["avg_high"][i])
            s5[i] = is_red and (c[i] < c[i - 1]) and (ins["candle_range"][i] >= ins["avg_candle_range"][i]) and (ins["candle_range"][i] > ins["candle_range"][i - 1]) and (l[i] < ins["avg_low"][i])
            if b5[i] and b5[i - 1]:
                b5[i] = False
            if s5[i] and s5[i - 1]:
                s5[i] = False

    # S6
    b6 = np.zeros(n, dtype=bool)
    s6 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        b6[i] = ins["BullPinbar"][i - 1] and ins["BullPinbar"][i] and c[i] > c[i - 1] and c[i] > o[i - 1]
        s6[i] = ins["BearPinbar"][i - 1] and ins["BearPinbar"][i] and c[i] < c[i - 1] and c[i] < o[i - 1]

    # S7
    b7 = np.zeros(n, dtype=bool)
    s7 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        if not np.isnan(ins["ema5"][i]) and not np.isnan(ins["ema5"][i - 1]):
            b7[i] = (c[i] > ins["ema5"][i]) and (h[i - 1] < ins["ema5"][i - 1]) and (c[i] > o[i])
            s7[i] = (c[i] < ins["ema5"][i]) and (l[i - 1] > ins["ema5"][i - 1]) and (c[i] < o[i])

    # S8
    b8 = np.zeros(n, dtype=bool)
    s8 = np.zeros(n, dtype=bool)
    for i in range(2, n):
        if not np.isnan(ins["emaFast"][i]) and not np.isnan(ins["emaMedium"][i]) and not np.isnan(ins["emaSlow"][i]):
            if not np.isnan(ins["emaFast"][i - 1]) and not np.isnan(ins["emaMedium"][i - 1]) and not np.isnan(ins["emaSlow"][i - 1]):
                is_buy = c[i] > ins["emaFast"][i] and c[i] > ins["emaMedium"][i] and c[i] > ins["emaSlow"][i]
                is_buy_prev = c[i - 1] > ins["emaFast"][i - 1] and c[i - 1] > ins["emaMedium"][i - 1] and c[i - 1] > ins["emaSlow"][i - 1]
                is_sell = c[i] < ins["emaFast"][i] and c[i] < ins["emaMedium"][i] and c[i] < ins["emaSlow"][i]
                is_sell_prev = c[i - 1] < ins["emaFast"][i - 1] and c[i - 1] < ins["emaMedium"][i - 1] and c[i - 1] < ins["emaSlow"][i - 1]
                b8[i] = is_buy and not is_buy_prev
                s8[i] = is_sell and not is_sell_prev

    # S9
    b9 = np.zeros(n, dtype=bool)
    s9 = np.zeros(n, dtype=bool)
    last_red_high = None
    last_green_low = None
    tcc_buy_momentum = False
    tcc_sell_momentum = False
    tcc_already_bought = False
    tcc_already_sold = False
    for i in range(n):
        is_red = c[i] < o[i]
        is_green = c[i] > o[i]
        prev_buy_mom = tcc_buy_momentum
        prev_sell_mom = tcc_sell_momentum
        if is_red:
            last_red_high = h[i]
            tcc_buy_momentum = False
        if is_green:
            last_green_low = l[i]
            tcc_sell_momentum = False
        if is_green and last_red_high is not None and c[i] > last_red_high and not tcc_already_bought:
            tcc_buy_momentum = True
            tcc_already_bought = True
        if is_red and last_green_low is not None and c[i] < last_green_low and not tcc_already_sold:
            tcc_sell_momentum = True
            tcc_already_sold = True
        if tcc_buy_momentum and not prev_buy_mom:
            tcc_already_sold = False
        if tcc_sell_momentum and not prev_sell_mom:
            tcc_already_bought = False
        if tcc_buy_momentum and not prev_buy_mom:
            b9[i] = True
        elif tcc_sell_momentum and not prev_sell_mom:
            s9[i] = True

    return {
        **ins,
        "b1": b1, "s1": s1, "b2": b2, "s2": s2,
        "b3": b3, "s3": s3, "b4": b4, "s4": s4,
        "b5": b5, "s5": s5, "b6": b6, "s6": s6,
        "b7": b7, "s7": s7, "b8": b8, "s8": s8,
        "b9": b9, "s9": s9,
    }


def compute_aio_sub(df):
    """
    AIO Sub: OR of S1,S2,S4,S6,S7,S8 + not BearPinbar/BullPinbar filter.
    Excludes S3 (pinbar dependent), S5 (small candle can trigger), S9 (no size filter).
    """
    sigs = _compute_all_signals(df)
    n = sigs["n"]

    aio_buy = np.zeros(n, dtype=bool)
    aio_sell = np.zeros(n, dtype=bool)
    for i in range(n):
        aio_buy[i] = (sigs["b1"][i] or sigs["b2"][i] or sigs["b4"][i] or sigs["b6"][i] or sigs["b7"][i] or sigs["b8"][i]) and not sigs["BearPinbar"][i]
        aio_sell[i] = (sigs["s1"][i] or sigs["s2"][i] or sigs["s4"][i] or sigs["s6"][i] or sigs["s7"][i] or sigs["s8"][i]) and not sigs["BullPinbar"][i]

    return _to_signals(aio_buy, aio_sell, sigs["times"], n)


def _compute_aio_sub_arrays(df):
    """Internal: compute AIO Sub boolean arrays (for AIO Main/Test01)."""
    sigs = _compute_all_signals(df)
    n = sigs["n"]

    mad_long = np.zeros(n, dtype=bool)
    mad_short = np.zeros(n, dtype=bool)
    for i in range(2, n):
        mad_long[i] = (sigs["b1"][i] or sigs["b2"][i] or sigs["b4"][i] or sigs["b6"][i] or sigs["b7"][i] or sigs["b8"][i]) and not sigs["BearPinbar"][i]
        mad_short[i] = (sigs["s1"][i] or sigs["s2"][i] or sigs["s4"][i] or sigs["s6"][i] or sigs["s7"][i] or sigs["s8"][i]) and not sigs["BullPinbar"][i]

    return {**sigs, "mad_long": mad_long, "mad_short": mad_short}


def compute_aio_main(df):
    """
    AIO Main: direction tracking based on AIO Sub signals.
    Fires when direction changes (buy→sell or sell→buy).
    """
    sigs = _compute_aio_sub_arrays(df)
    n, h, l, c = sigs["n"], sigs["h"], sigs["l"], sigs["c"]
    mad_long = sigs["mad_long"]
    mad_short = sigs["mad_short"]

    def nz(x, default=0.0):
        return default if np.isnan(x) else x

    last_sell_high = _ta_valuewhen(mad_short, h, 0, n)
    last_sell_low = _ta_valuewhen(mad_short, l, 0, n)
    last_buy_low = _ta_valuewhen(mad_long, l, 0, n)
    last_buy_high = _ta_valuewhen(mad_long, h, 0, n)

    direction = np.zeros(n)
    for i in range(1, n):
        direction[i] = direction[i - 1]
        cond_long = (
            mad_long[i] and c[i] > nz(last_sell_high[i - 1]) or
            (nz(last_buy_low[i]) > nz(last_buy_low[i - 1]) and direction[i - 1] == 1) or
            (nz(last_buy_high[i]) > nz(last_buy_high[i - 1]) and direction[i - 1] == 1) or
            (
                i >= 4 and
                not mad_short[i - 1] and not mad_short[i - 2] and not mad_short[i - 3] and not mad_short[i - 4] and
                mad_long[i] and
                (mad_long[i - 2] or mad_long[i - 3] or mad_long[i - 4]) and
                l[i] > nz(last_buy_low[i - 1])
            ) or
            c[i] > nz(last_sell_high[i - 1])
        )
        cond_short = (
            mad_short[i] and c[i] < nz(last_buy_low[i - 1]) or
            (nz(last_sell_high[i]) < nz(last_sell_high[i - 1]) and direction[i - 1] == -1) or
            (nz(last_sell_low[i]) < nz(last_sell_low[i - 1]) and direction[i - 1] == -1) or
            (
                i >= 4 and
                not mad_long[i - 1] and not mad_long[i - 2] and not mad_long[i - 3] and not mad_long[i - 4] and
                mad_short[i] and
                (mad_short[i - 2] or mad_short[i - 3] or mad_short[i - 4])
            ) or
            c[i] < nz(last_buy_low[i - 1])
        )
        if cond_long:
            direction[i] = 1
        elif cond_short:
            direction[i] = -1

    long_condition = np.zeros(n, dtype=bool)
    short_condition = np.zeros(n, dtype=bool)
    for i in range(1, n):
        long_condition[i] = (direction[i] == 1 and direction[i - 1] != 1)
        short_condition[i] = (direction[i] == -1 and direction[i - 1] != -1)

    return _to_signals(long_condition, short_condition, sigs["times"], n)


def compute_test01a(df):
    """
    AIO Test01-A: Level break signals from AIO Sub.
    Tracks last AIO Sub buy signal low and sell signal high.
    Close above last sell high = buy (once). Close below last buy low = sell (once).
    """
    sigs = _compute_aio_sub_arrays(df)
    n, h, l, c = sigs["n"], sigs["h"], sigs["l"], sigs["c"]
    mad_long = sigs["mad_long"]
    mad_short = sigs["mad_short"]

    last_buy_signal_low = None
    last_sell_signal_high = None
    level_break_buy_done = False
    level_break_sell_done = False
    last_aio_dir = 0

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    for i in range(n):
        if mad_long[i] and last_aio_dir != 1:
            last_buy_signal_low = l[i]
            last_aio_dir = 1
        if mad_short[i] and last_aio_dir != -1:
            last_sell_signal_high = h[i]
            last_aio_dir = -1
        if last_sell_signal_high is not None and c[i] > last_sell_signal_high and not level_break_buy_done:
            b[i] = True
            level_break_buy_done = True
            level_break_sell_done = False
        if last_buy_signal_low is not None and c[i] < last_buy_signal_low and not level_break_sell_done:
            s[i] = True
            level_break_sell_done = True
            level_break_buy_done = False
    return _to_signals(b, s, sigs["times"], n)


def compute_test01b(df):
    """
    AIO Test01-B: AIO Sub alternating only.
    Same as AIO Sub but ignores if last signal was same direction.
    Ensures buy → sell → buy → sell pattern.
    """
    sigs = _compute_aio_sub_arrays(df)
    n = sigs["n"]
    mad_long = sigs["mad_long"]
    mad_short = sigs["mad_short"]

    b = np.zeros(n, dtype=bool)
    s = np.zeros(n, dtype=bool)
    last_dir = 0
    for i in range(n):
        if mad_long[i] and last_dir != 1:
            b[i] = True
            last_dir = 1
        elif mad_short[i] and last_dir != -1:
            s[i] = True
            last_dir = -1
    return _to_signals(b, s, sigs["times"], n)


def compute_test01(df):
    """
    AIO Test01: Test01-A + Test01-B combined.
    Level break signals + alternating AIO Sub signals.
    """
    sigs = _compute_aio_sub_arrays(df)
    n, h, l, c = sigs["n"], sigs["h"], sigs["l"], sigs["c"]
    mad_long = sigs["mad_long"]
    mad_short = sigs["mad_short"]

    # Test01-A
    last_buy_signal_low = None
    last_sell_signal_high = None
    level_break_buy_done = False
    level_break_sell_done = False
    last_aio_dir = 0
    aio_test01a_long = np.zeros(n, dtype=bool)
    aio_test01a_short = np.zeros(n, dtype=bool)
    for i in range(n):
        if mad_long[i] and last_aio_dir != 1:
            last_buy_signal_low = l[i]
            last_aio_dir = 1
        if mad_short[i] and last_aio_dir != -1:
            last_sell_signal_high = h[i]
            last_aio_dir = -1
        if last_sell_signal_high is not None and c[i] > last_sell_signal_high and not level_break_buy_done:
            aio_test01a_long[i] = True
            level_break_buy_done = True
            level_break_sell_done = False
        if last_buy_signal_low is not None and c[i] < last_buy_signal_low and not level_break_sell_done:
            aio_test01a_short[i] = True
            level_break_sell_done = True
            level_break_buy_done = False

    # Test01-B
    aio_test01b_long = np.zeros(n, dtype=bool)
    aio_test01b_short = np.zeros(n, dtype=bool)
    last_test01b_dir = 0
    for i in range(n):
        if mad_long[i] and last_test01b_dir != 1:
            aio_test01b_long[i] = True
            last_test01b_dir = 1
        elif mad_short[i] and last_test01b_dir != -1:
            aio_test01b_short[i] = True
            last_test01b_dir = -1

    # Combined
    aio_long = aio_test01a_long | aio_test01b_long
    aio_short = aio_test01a_short | aio_test01b_short
    return _to_signals(aio_long, aio_short, sigs["times"], n)


def compute_levels(df):
    """
    Levels: step-like lines from AIO Main last buy low / last sell high.
    Updates on AIO Sub signals and direction changes.
    """
    sigs = _compute_aio_sub_arrays(df)
    n, h, l, c = sigs["n"], sigs["h"], sigs["l"], sigs["c"]
    mad_long = sigs["mad_long"]
    mad_short = sigs["mad_short"]
    times = sigs["times"]

    def nz(x, default=0.0):
        return default if np.isnan(x) else x

    last_sell_high = _ta_valuewhen(mad_short, h, 0, n)
    last_sell_low = _ta_valuewhen(mad_short, l, 0, n)
    last_buy_low = _ta_valuewhen(mad_long, l, 0, n)
    last_buy_high = _ta_valuewhen(mad_long, h, 0, n)

    direction = np.zeros(n)
    for i in range(1, n):
        direction[i] = direction[i - 1]
        cond_long = (
            mad_long[i] and c[i] > nz(last_sell_high[i - 1]) or
            (nz(last_buy_low[i]) > nz(last_buy_low[i - 1]) and direction[i - 1] == 1) or
            (nz(last_buy_high[i]) > nz(last_buy_high[i - 1]) and direction[i - 1] == 1) or
            (
                i >= 4 and
                not mad_short[i - 1] and not mad_short[i - 2] and not mad_short[i - 3] and not mad_short[i - 4] and
                mad_long[i] and
                (mad_long[i - 2] or mad_long[i - 3] or mad_long[i - 4]) and
                l[i] > nz(last_buy_low[i - 1])
            ) or
            c[i] > nz(last_sell_high[i - 1])
        )
        cond_short = (
            mad_short[i] and c[i] < nz(last_buy_low[i - 1]) or
            (nz(last_sell_high[i]) < nz(last_sell_high[i - 1]) and direction[i - 1] == -1) or
            (nz(last_sell_low[i]) < nz(last_sell_low[i - 1]) and direction[i - 1] == -1) or
            (
                i >= 4 and
                not mad_long[i - 1] and not mad_long[i - 2] and not mad_long[i - 3] and not mad_long[i - 4] and
                mad_short[i] and
                (mad_short[i - 2] or mad_short[i - 3] or mad_short[i - 4])
            ) or
            c[i] < nz(last_buy_low[i - 1])
        )
        if cond_long:
            direction[i] = 1
        elif cond_short:
            direction[i] = -1

    levels = []
    for i in range(n):
        if mad_long[i] or mad_short[i] or direction[i] != direction[i - 1]:
            levels.append({
                "time": int(times[i]),
                "buy_level": float(last_buy_low[i]) if not np.isnan(last_buy_low[i]) else None,
                "sell_level": float(last_sell_high[i]) if not np.isnan(last_sell_high[i]) else None,
            })
    return levels
