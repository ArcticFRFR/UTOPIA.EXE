//! The sealed indicator: Arctic's "moneybagg" overlay, ported from Pine v6 and compiled into the .exe.
//!
//! Everything here is New York time except the London box (London time) and the Frankfurt open
//! (Berlin time); `chrono-tz` carries the DST rules so nothing is hard-coded. The web side sends
//! the chart bars, a 1-hour context series and the parameters, and gets back drawings: boxes,
//! horizontal and vertical lines, texts, per-bar candle flags, two plots and the HTF candle sets.
//! It never sees this logic.

use chrono::{Datelike, Duration, NaiveDate, TimeZone, Timelike, Weekday};
use chrono_tz::{America::New_York, Europe::Berlin, Europe::London, Tz};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct Bar {
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxShape {
    pub t0: i64,
    pub t1: i64,
    pub top: f64,
    pub bottom: f64,
    pub fill: String,
    pub border: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HLine {
    pub t0: i64,
    pub t1: i64,
    pub price: f64,
    pub color: String,
    pub style: &'static str,
    pub width: f64,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VLine {
    pub t: i64,
    pub top: f64,
    pub bottom: f64,
    pub color: String,
    pub style: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Text {
    pub t: i64,
    pub text: String,
    pub position: &'static str,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HtfCandle {
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HtfSet {
    pub name: String,
    pub candles: Vec<HtfCandle>,
    pub close_time: i64,
    pub hi_time: i64,
    pub lo_time: i64,
    pub levels: bool,
    pub countdown: bool,
    pub gap: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub gap_minutes: i64,
    pub trading_date: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub boxes: Vec<BoxShape>,
    pub hlines: Vec<HLine>,
    pub vlines: Vec<VLine>,
    pub texts: Vec<Text>,
    /// per chart bar: 1 bullish vector candle, -1 bearish, 0 plain
    pub candles: Vec<i8>,
    pub plots: HashMap<String, Vec<Option<f64>>>,
    pub htf: Vec<HtfSet>,
    pub right_offset_bars: i64,
    pub info: Info,
}

// ── colours (the Pine defaults, lifted for a dark chart) ───────────────────────────────────
const ASIA_FILL: &str = "rgba(152,0,255,0.12)";
const ASIA_LINE: &str = "rgba(152,0,255,0.45)";
const SESS_FILL: &str = "rgba(239,232,218,0.07)";
const NONE: &str = "rgba(0,0,0,0)";
const FF_LC: &str = "rgba(239,232,218,0.8)";
const PD: &str = "rgba(239,232,218,0.9)";
const DAY: &str = "#787b86";

fn hex_rgba(hex: &str, alpha: f64) -> String {
    let h = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(255);
    let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(255);
    let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(255);
    format!("rgba({r},{g},{b},{alpha})")
}

// ── params ──────────────────────────────────────────────────────────────────────────────────
struct P<'a>(&'a HashMap<String, f64>);
impl P<'_> {
    fn f(&self, k: &str, d: f64) -> f64 {
        self.0.get(k).copied().unwrap_or(d)
    }
    fn b(&self, k: &str, d: bool) -> bool {
        self.0.get(k).map(|v| *v != 0.0).unwrap_or(d)
    }
}

// ── time helpers ────────────────────────────────────────────────────────────────────────────
fn local(t: i64, tz: Tz) -> chrono::DateTime<Tz> {
    tz.timestamp_opt(t, 0).single().unwrap_or_else(|| tz.timestamp_opt(0, 0).unwrap())
}
fn mins_of_day(t: i64, tz: Tz) -> i64 {
    let d = local(t, tz);
    (d.hour() * 60 + d.minute()) as i64
}
fn secs_of_day(t: i64, tz: Tz) -> i64 {
    let d = local(t, tz);
    (d.hour() * 3600 + d.minute() * 60 + d.second()) as i64
}
fn weekday_mon_fri(t: i64, tz: Tz) -> bool {
    !matches!(local(t, tz).weekday(), Weekday::Sat | Weekday::Sun)
}
fn in_window(m: i64, start: i64, end: i64) -> bool {
    if start < end { m >= start && m < end } else { m >= start || m < end }
}
/// CME trading date: the session that opens 18:00 NY belongs to the next calendar day.
fn trading_date(t: i64) -> NaiveDate {
    local(t + 6 * 3600, New_York).date_naive()
}
fn ny_ts(date: NaiveDate, h: u32, m: u32) -> i64 {
    New_York
        .from_local_datetime(&date.and_hms_opt(h, m, 0).unwrap())
        .earliest()
        .map(|d| d.timestamp())
        .unwrap_or(0)
}
fn day_start(d: NaiveDate) -> i64 {
    ny_ts(d.pred_opt().unwrap_or(d), 18, 0)
}
fn day_end(d: NaiveDate) -> i64 {
    ny_ts(d, 17, 0)
}
fn week_id(d: NaiveDate) -> (i32, u32) {
    let w = d.iso_week();
    (w.year(), w.week())
}
fn week_end(d: NaiveDate) -> i64 {
    let shift = 4 - d.weekday().num_days_from_monday() as i64;
    day_end(d + Duration::days(shift))
}
/// Pine's `timeInCandle`: if the bar [open, close) contains hh:mm in `tz`, the exact timestamp.
fn time_in_candle(b: &Bar, tf_sec: i64, hh: i64, mm: i64, tz: Tz) -> Option<i64> {
    let target = hh * 3600 + mm * 60;
    let o = secs_of_day(b.time, tz);
    let c = secs_of_day(b.time + tf_sec, tz);
    let inside = if c > o { target >= o && target < c } else { target >= o || target < c };
    if !inside {
        return None;
    }
    let delta = if target >= o { target - o } else { target + 86_400 - o };
    Some(b.time + delta)
}
/// Pine's `sessionAnchor`: the bar's time moved back to the exact session start.
fn session_anchor(t: i64, start_min: i64, tz: Tz) -> i64 {
    let mut diff = mins_of_day(t, tz) - start_min;
    if diff > 720 { diff -= 1440 } else if diff < -720 { diff += 1440 }
    t - diff * 60 - (secs_of_day(t, tz) % 60)
}

// ── maths ───────────────────────────────────────────────────────────────────────────────────
fn sma(values: &[f64], len: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    let mut sum = 0.0;
    for i in 0..values.len() {
        sum += values[i];
        if i >= len { sum -= values[i - len] }
        if i + 1 >= len { out[i] = Some(sum / len as f64) }
    }
    out
}
fn rma(values: &[f64], len: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if values.len() < len || len == 0 { return out }
    let mut v = values[..len].iter().sum::<f64>() / len as f64;
    out[len - 1] = Some(v);
    for i in len..values.len() {
        v = (v * (len as f64 - 1.0) + values[i]) / len as f64;
        out[i] = Some(v);
    }
    out
}
fn atr(bars: &[Bar], len: usize) -> Vec<Option<f64>> {
    let tr: Vec<f64> = bars.iter().enumerate().map(|(i, b)| {
        if i == 0 { b.high - b.low } else {
            let pc = bars[i - 1].close;
            (b.high - b.low).max((b.high - pc).abs()).max((b.low - pc).abs())
        }
    }).collect();
    rma(&tr, len)
}

// ── drawings ────────────────────────────────────────────────────────────────────────────────
/// Session box sized to the full session, growing with the session's high and low (+ optional hi/mid/lo lines).
fn session_boxes(bars: &[Bar], active: &dyn Fn(&Bar) -> bool, start_min: i64, length_min: i64, tz: Tz, fill: &str, lines: Option<&str>, out: &mut Overlay) {
    let mut prev = false;
    let mut cur: Option<(usize, f64, f64, i64)> = None; // box index, hi, lo, t0
    for b in bars {
        let a = active(b);
        if a && !prev {
            let t0 = session_anchor(b.time, start_min, tz);
            out.boxes.push(BoxShape { t0, t1: t0 + length_min * 60, top: b.high, bottom: b.low, fill: fill.into(), border: NONE.into() });
            cur = Some((out.boxes.len() - 1, b.high, b.low, t0));
        } else if a {
            if let Some((i, hi, lo, _)) = cur.as_mut() {
                *hi = hi.max(b.high);
                *lo = lo.min(b.low);
                out.boxes[*i].top = *hi;
                out.boxes[*i].bottom = *lo;
            }
        }
        if !a && prev {
            if let (Some(col), Some((_, hi, lo, t0))) = (lines, cur) {
                let t2 = t0 + length_min * 120;
                for p in [hi, (hi + lo) / 2.0, lo] {
                    out.hlines.push(HLine { t0, t1: t2, price: p, color: col.into(), style: "solid", width: 1.0, label: None });
                }
            }
            cur = None;
        }
        prev = a;
    }
    // Still open at the last bar: lines follow the live high/low.
    if let (Some(col), Some((_, hi, lo, t0)), true) = (lines, cur, prev) {
        let t2 = t0 + length_min * 120;
        for p in [hi, (hi + lo) / 2.0, lo] {
            out.hlines.push(HLine { t0, t1: t2, price: p, color: col.into(), style: "solid", width: 1.0, label: None });
        }
    }
}

/// Macro box covering the candles inside the window.
fn macro_boxes(bars: &[Bar], tf_sec: i64, active: &dyn Fn(&Bar) -> bool, color: &str, out: &mut Overlay) {
    let mut prev = false;
    let mut cur: Option<usize> = None;
    for b in bars {
        let a = active(b);
        if a && !prev {
            out.boxes.push(BoxShape { t0: b.time, t1: b.time + tf_sec, top: b.high, bottom: b.low, fill: hex_rgba(color, 0.25), border: hex_rgba(color, 0.6) });
            cur = Some(out.boxes.len() - 1);
        } else if a {
            if let Some(i) = cur {
                let bx = &mut out.boxes[i];
                bx.top = bx.top.max(b.high);
                bx.bottom = bx.bottom.min(b.low);
                bx.t1 = b.time + tf_sec;
            }
        }
        prev = a;
    }
}

fn ny_mins(b: &Bar) -> i64 { mins_of_day(b.time, New_York) }
fn ldn_mins(b: &Bar) -> i64 { mins_of_day(b.time, London) }
fn hm(h: i64, m: i64) -> i64 { h * 60 + m }

fn period_key(b: &Bar, name: &str) -> i64 {
    match name {
        "1H" => b.time.div_euclid(3600),
        "D" => trading_date(b.time).num_days_from_ce() as i64,
        _ => { let (y, w) = week_id(trading_date(b.time)); y as i64 * 100 + w as i64 }
    }
}
fn period_close(b: &Bar, name: &str) -> i64 {
    match name {
        "1H" => b.time.div_euclid(3600) * 3600 + 3600,
        "D" => day_end(trading_date(b.time)),
        _ => week_end(trading_date(b.time)),
    }
}

/// One HTF set from the context series: the last `count` candles, newest last, plus the live one's extremes.
fn htf_set(ctx: &[Bar], chart: &[Bar], name: &str, count: usize, timer: bool, levels: bool, gap: i64) -> Option<HtfSet> {
    if ctx.is_empty() { return None }
    let mut groups: Vec<(i64, HtfCandle, i64)> = Vec::new(); // key, candle, close time
    for b in ctx {
        let k = period_key(b, name);
        match groups.last_mut() {
            Some((lk, c, _)) if *lk == k => { c.h = c.h.max(b.high); c.l = c.l.min(b.low); c.c = b.close; }
            _ => groups.push((k, HtfCandle { o: b.open, h: b.high, l: b.low, c: b.close }, period_close(b, name))),
        }
    }
    let n = groups.len().min(count);
    let tail = &groups[groups.len() - n..];
    let (cur_key, cur, close_time) = tail.last().cloned()?;
    // Where the live candle's high and low were made: chart bars inside the period, else the context bars.
    let src: Vec<&Bar> = chart.iter().filter(|b| period_key(b, name) == cur_key).collect();
    let src: Vec<&Bar> = if src.is_empty() { ctx.iter().filter(|b| period_key(b, name) == cur_key).collect() } else { src };
    let mut hi_time = src.first().map(|b| b.time).unwrap_or(0);
    let mut lo_time = hi_time;
    let (mut hh, mut ll) = (f64::MIN, f64::MAX);
    for b in &src {
        if b.high > hh { hh = b.high; hi_time = b.time }
        if b.low < ll { ll = b.low; lo_time = b.time }
    }
    let _ = cur;
    Some(HtfSet { name: name.into(), candles: tail.iter().map(|g| g.1.clone()).collect(), close_time, hi_time, lo_time, levels, countdown: timer, gap })
}

const HTF_W: i64 = 2; // candle width in bars ("Small")
const HTF_GAP: i64 = 1;

pub fn compute(bars: &[Bar], ctx: &[Bar], tf_sec: i64, params: &HashMap<String, f64>) -> Overlay {
    let p = P(params);
    let mut out = Overlay::default();
    if bars.is_empty() || tf_sec <= 0 { return out }
    let last = bars.last().unwrap();
    let intraday = tf_sec < 86_400;
    let hide_above = p.f("hideAbove", 59.0) as i64 * 60;

    // ── sessions ──
    let asia_start = hm(18, 5);
    if p.b("asia", true) && tf_sec <= 3600 {
        session_boxes(bars, &|b| in_window(ny_mins(b), asia_start, hm(1, 0)), asia_start, 415, New_York, ASIA_FILL, Some(ASIA_LINE), &mut out);
    }
    if p.b("london", true) && tf_sec <= hide_above {
        session_boxes(bars, &|b| weekday_mon_fri(b.time, London) && in_window(ldn_mins(b), hm(8, 0), hm(9, 0)), hm(8, 0), 60, London, SESS_FILL, None, &mut out);
    }
    if p.b("ny", true) && tf_sec <= hide_above {
        session_boxes(bars, &|b| weekday_mon_fri(b.time, New_York) && in_window(ny_mins(b), hm(8, 0), hm(9, 0)), hm(8, 0), 60, New_York, SESS_FILL, None, &mut out);
    }

    // ── macros (ICT, New York clock; the London pair optionally on London's clock) ──
    if tf_sec <= 3600 {
        let ldn_clock = p.b("lmLondon", false);
        let macros: [(&str, bool, i64, i64, Tz, &str); 5] = [
            ("lm1", true, if ldn_clock { hm(7, 33) } else { hm(2, 33) }, if ldn_clock { hm(8, 0) } else { hm(3, 0) }, if ldn_clock { London } else { New_York }, "#8bbcfc"),
            ("lm2", true, if ldn_clock { hm(9, 3) } else { hm(4, 3) }, if ldn_clock { hm(9, 30) } else { hm(4, 30) }, if ldn_clock { London } else { New_York }, "#f0b884"),
            ("ny1", true, hm(8, 50), hm(9, 10), New_York, "#0cc1c0"),
            ("ny2", true, hm(9, 50), hm(10, 10), New_York, "#fc0000"),
            ("ny3", true, hm(10, 50), hm(11, 10), New_York, "#bbe8b5"),
        ];
        for (key, d, s, e, tz, col) in macros {
            if p.b(key, d) {
                macro_boxes(bars, tf_sec, &|b| weekday_mon_fri(b.time, tz) && in_window(mins_of_day(b.time, tz), s, e), col, &mut out);
            }
        }
    }

    // ── Frankfurt open & London close: short vertical lines at the exact minute ──
    if intraday && tf_sec <= 14_400 {
        let reach_mult = p.f("lineReach", 0.5);
        let a = atr(bars, 14);
        for (i, b) in bars.iter().enumerate() {
            let reach = a[i].unwrap_or(0.0) * reach_mult;
            if p.b("ffOpen", true) {
                if let Some(t) = time_in_candle(b, tf_sec, p.f("ffHour", 8.0) as i64, p.f("ffMin", 0.0) as i64, Berlin) {
                    out.vlines.push(VLine { t, top: b.high + reach, bottom: b.low - reach, color: FF_LC.into(), style: "dashed" });
                }
            }
            if p.b("lcClose", true) {
                if let Some(t) = time_in_candle(b, tf_sec, p.f("lcHour", 16.0) as i64, p.f("lcMin", 0.0) as i64, London) {
                    out.vlines.push(VLine { t, top: b.high + reach, bottom: b.low - reach, color: FF_LC.into(), style: "dashed" });
                }
            }
        }
    }

    // ── day and week opens, previous day high/low, from the context series (weeks of 1h bars) ──
    let src: &[Bar] = if ctx.is_empty() { bars } else { ctx };
    let mut day_open: HashMap<NaiveDate, f64> = HashMap::new();
    let mut day_hl: HashMap<NaiveDate, (f64, f64)> = HashMap::new();
    let mut week_open: HashMap<(i32, u32), f64> = HashMap::new();
    let mut days: Vec<NaiveDate> = Vec::new();
    for b in src {
        let d = trading_date(b.time);
        day_open.entry(d).or_insert(b.open);
        let e = day_hl.entry(d).or_insert((b.high, b.low));
        e.0 = e.0.max(b.high);
        e.1 = e.1.min(b.low);
        week_open.entry(week_id(d)).or_insert(b.open);
        if days.last() != Some(&d) { days.push(d) }
    }
    // The chart's own bars refine the current day (ticks land there first).
    for b in bars {
        let d = trading_date(b.time);
        day_open.entry(d).or_insert(b.open);
        week_open.entry(week_id(d)).or_insert(b.open);
        let e = day_hl.entry(d).or_insert((b.high, b.low));
        e.0 = e.0.max(b.high);
        e.1 = e.1.min(b.low);
        if days.last() != Some(&d) { days.push(d) }
    }
    let today = trading_date(last.time);
    let do_today_only = p.b("doToday", false);
    let mut wo_plot = Vec::with_capacity(bars.len());
    let mut do_plot = Vec::with_capacity(bars.len());
    let mut prev_week: Option<(i32, u32)> = None;
    for b in bars {
        let d = trading_date(b.time);
        let w = week_id(d);
        let new_week = prev_week.is_some() && prev_week != Some(w);
        prev_week = Some(w);
        wo_plot.push(if p.b("weeklyOpen", true) && !new_week { week_open.get(&w).copied() } else { None });
        do_plot.push(if p.b("dailyOpen", true) && (!do_today_only || d == today) { day_open.get(&d).copied() } else { None });
    }
    out.plots.insert("weeklyOpen".into(), wo_plot);
    out.plots.insert("dailyOpen".into(), do_plot);

    if p.b("pd", true) && tf_sec <= 86_400 {
        if let Some(pos) = days.iter().position(|d| *d == today) {
            if pos > 0 {
                if let Some((h, l)) = day_hl.get(&days[pos - 1]) {
                    let (t0, t1) = (day_start(today), day_end(today));
                    out.hlines.push(HLine { t0, t1, price: *h, color: PD.into(), style: "solid", width: 1.0, label: Some("pd high".into()) });
                    out.hlines.push(HLine { t0, t1, price: *l, color: PD.into(), style: "solid", width: 1.0, label: Some("pd low".into()) });
                }
            }
        }
    }

    // ── key opens: NQ's H4 candles open 6PM 10PM 2AM 6AM 10AM 2PM New York ──
    if tf_sec <= 14_400 {
        let kos: [(&str, bool, u32, &str, &str); 6] = [
            ("ko18", false, 18, "#787b86", "6PM open"), ("ko22", false, 22, "#9c27b0", "10PM open"),
            ("ko02", false, 2, "#00897b", "2AM open"), ("ko06", false, 6, "#f57c00", "6AM open"),
            ("ko10", true, 10, "#2962ff", "10AM open"), ("ko14", false, 14, "#e91e63", "2PM open"),
        ];
        let labels = p.b("koLabels", false);
        let width = p.f("koWidth", 1.0);
        for b in bars {
            let d = local(b.time, New_York);
            if d.minute() != 0 { continue }
            for (key, def, hour, col, text) in &kos {
                if d.hour() == *hour && p.b(key, *def) {
                    out.hlines.push(HLine { t0: b.time, t1: day_end(trading_date(b.time)), price: b.open, color: (*col).into(), style: "solid", width, label: if labels { Some((*text).into()) } else { None } });
                }
            }
        }
    }

    // ── day labels at hh:mm New York ──
    if p.b("dayLabels", true) && intraday {
        let (h, m) = (p.f("dayHour", 12.0) as i64, p.f("dayMin", 0.0) as i64);
        for b in bars {
            if let Some(t) = time_in_candle(b, tf_sec, h, m, New_York) {
                let name = match local(t, New_York).weekday() {
                    Weekday::Mon => "M O N", Weekday::Tue => "T U E", Weekday::Wed => "W E D",
                    Weekday::Thu => "T H U", Weekday::Fri => "F R I", _ => continue,
                };
                out.texts.push(Text { t, text: name.into(), position: if p.b("dayTop", false) { "top" } else { "bottom" }, color: DAY.into() });
            }
        }
    }

    // ── vector candles: body and volume both well above their 20-bar averages ──
    let body: Vec<f64> = bars.iter().map(|b| (b.close - b.open).abs()).collect();
    let vol: Vec<f64> = bars.iter().map(|b| b.volume).collect();
    let (ab, av) = (sma(&body, 20), sma(&vol, 20));
    let (bm, vm) = (p.f("bodyMult", 1.5), p.f("volMult", 1.2));
    let show_vec = p.b("vector", true);
    out.candles = bars.iter().enumerate().map(|(i, b)| match (ab[i], av[i]) {
        (Some(x), Some(y)) if show_vec && x > 0.0 && y > 0.0 && body[i] / x > bm && vol[i] / y > vm => if b.close > b.open { 1 } else { -1 },
        _ => 0,
    }).collect();

    // ── HTF candle previews: 1H, D, W ──
    let sets: [(&str, &str, i64, f64, f64, bool, bool); 3] = [
        ("htf1", "1H", 3600, 3.0, 10.0, true, false),
        ("htf2", "D", 86_400, 3.0, 5.0, true, true),
        ("htf3", "W", 604_800, 3.0, 5.0, true, false),
    ];
    let mut offset = 0i64;
    for (key, name, secs, dcount, dgap, dtimer, dlvls) in sets {
        if !p.b(key, true) || secs <= tf_sec { continue }
        let count = p.f(&format!("{key}Count"), dcount).clamp(1.0, 5.0) as usize;
        let gap = p.f(&format!("{key}Gap"), dgap).clamp(1.0, 50.0) as i64;
        let timer = p.b(&format!("{key}Timer"), dtimer);
        let levels = p.b(&format!("{key}Lvls"), dlvls);
        if let Some(mut s) = htf_set(ctx, bars, name, count, timer, levels, gap) {
            s.gap = offset + gap;
            offset += gap + count as i64 * (HTF_W + HTF_GAP) + if levels { 10 } else { 0 };
            out.htf.push(s);
        }
    }
    out.right_offset_bars = if out.htf.is_empty() { 6 } else { offset + 6 };

    // ── info for the watermark ──
    let ldn = mins_of_day(last.time, London);
    let ny = mins_of_day(last.time, New_York);
    let mut gap = ldn - ny;
    if gap < 0 { gap += 1440 }
    out.info = Info { gap_minutes: gap, trading_date: local(last.time + tf_sec, New_York).format("%-d/%-m/%Y").to_string() };
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 5-minute bars across one full NQ trading day plus the Sunday open, Mon 17 Nov 2026 (NY), flat-ish prices.
    fn day_bars() -> Vec<Bar> {
        let start = ny_ts(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap(), 18, 0); // Sunday 18:00 NY
        let mut out = Vec::new();
        let mut t = start;
        let mut i = 0;
        while t < start + 2 * 86_400 {
            let d = local(t, New_York);
            let open_hours = !(d.hour() == 17); // 17:00-18:00 maintenance
            if open_hours {
                let p = 21_500.0 + ((i as f64) * 0.3).sin() * 20.0;
                out.push(Bar { time: t, open: p, high: p + 5.0, low: p - 5.0, close: p + 1.0, volume: 500.0 });
            }
            t += 300;
            i += 1;
        }
        out
    }

    fn ctx_bars() -> Vec<Bar> {
        let start = ny_ts(NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(), 18, 0);
        let mut out = Vec::new();
        let mut t = start;
        while t < ny_ts(NaiveDate::from_ymd_opt(2026, 11, 17).unwrap(), 17, 0) {
            let d = local(t, New_York);
            if d.hour() != 17 && !matches!(d.weekday(), Weekday::Sat) && !(d.weekday() == Weekday::Sun && d.hour() < 18) && !(d.weekday() == Weekday::Fri && d.hour() >= 17) {
                let p = 21_400.0 + ((t / 3600) as f64 * 0.1).sin() * 50.0;
                out.push(Bar { time: t, open: p, high: p + 15.0, low: p - 15.0, close: p + 2.0, volume: 5000.0 });
            }
            t += 3600;
        }
        out
    }

    #[test]
    fn trading_day_boundaries() {
        let d = NaiveDate::from_ymd_opt(2026, 11, 17).unwrap();
        assert_eq!(trading_date(day_start(d)), d);
        assert_eq!(trading_date(day_end(d) - 60), d);
        assert_eq!(trading_date(day_end(d) + 3600), d.succ_opt().unwrap());
        // Sunday 18:00 NY opens Monday's session
        let sun = ny_ts(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap(), 18, 0);
        assert_eq!(trading_date(sun), NaiveDate::from_ymd_opt(2026, 11, 16).unwrap());
    }

    #[test]
    fn sessions_and_macros_are_drawn() {
        let bars = day_bars();
        let out = compute(&bars, &ctx_bars(), 300, &HashMap::new());
        // Asia (2 nights), London (2), NY (2) boxes + 5 macros x 2 days
        assert!(out.boxes.len() >= 6 + 10, "boxes {}", out.boxes.len());
        // Asia box spans 415 minutes from 18:05 NY
        let asia = out.boxes.iter().find(|b| b.fill == ASIA_FILL).unwrap();
        assert_eq!(asia.t1 - asia.t0, 415 * 60);
        assert_eq!(mins_of_day(asia.t0, New_York), hm(18, 5));
        // London box is on London's clock
        let ldn = out.boxes.iter().filter(|b| b.fill == SESS_FILL).find(|b| mins_of_day(b.t0, London) == hm(8, 0)).unwrap();
        assert_eq!(ldn.t1 - ldn.t0, 3600);
        // Frankfurt open (08:00 Berlin) and London close (16:00 London) lines, one each per weekday
        assert!(out.vlines.iter().any(|v| secs_of_day(v.t, Berlin) == 8 * 3600));
        assert!(out.vlines.iter().any(|v| secs_of_day(v.t, London) == 16 * 3600));
        // day labels at 12:00 NY
        assert!(out.texts.iter().any(|t| t.text == "M O N" && mins_of_day(t.t, New_York) == hm(12, 0)));
        // pd high / low for the last trading day
        assert_eq!(out.hlines.iter().filter(|l| l.label.as_deref() == Some("pd high")).count(), 1);
        // the 10AM key open
        assert!(out.hlines.iter().any(|l| l.color == "#2962ff" && local(l.t0, New_York).hour() == 10));
        assert_eq!(out.candles.len(), bars.len());
        assert_eq!(out.plots["weeklyOpen"].len(), bars.len());
        // HTF: 1H, D, W all higher than 5m
        assert_eq!(out.htf.len(), 3);
        assert_eq!(out.htf[1].name, "D");
        assert!(out.htf[1].candles.len() <= 3 && !out.htf[1].candles.is_empty());
        assert!(out.right_offset_bars > 30);
        assert_eq!(out.info.gap_minutes, 300);
    }

    #[test]
    fn htf_sets_hide_at_or_below_chart_timeframe() {
        let out = compute(&ctx_bars(), &ctx_bars(), 3600, &HashMap::new());
        assert!(out.htf.iter().all(|s| s.name != "1H"));
        assert_eq!(out.htf.len(), 2);
    }

    #[test]
    fn time_in_candle_finds_the_minute() {
        let b = Bar { time: ny_ts(NaiveDate::from_ymd_opt(2026, 11, 17).unwrap(), 11, 55), open: 1.0, high: 1.0, low: 1.0, close: 1.0, volume: 1.0 };
        let t = time_in_candle(&b, 900, 12, 0, New_York).unwrap();
        assert_eq!(t - b.time, 300);
        assert!(time_in_candle(&b, 300, 12, 0, New_York).is_none());
    }
}
