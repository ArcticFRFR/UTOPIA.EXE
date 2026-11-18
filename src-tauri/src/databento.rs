//! Databento: licensed CME Globex data (dataset GLBX.MDP3) through the official `databento` crate.
//!
//! Historical bars come from the Historical API (pay-as-you-go; available up to roughly the previous
//! day). The Live API fills from there: `start` replays the intraday trades since the history end,
//! then the stream is real-time. Live needs a Databento CME plan; without it history alone works.
//! Replayed trades are folded into 1-minute bars here and sent as four pseudo-ticks per bar, so the
//! web side needs nothing but its tick path; once the stream is within a few seconds of the clock,
//! raw trades are forwarded as they come.

use databento::{
    dbn::{Dataset, OhlcvMsg, SType, Schema, TradeMsg, FIXED_PRICE_SCALE},
    historical::timeseries::GetRangeParams,
    live::Subscription,
    HistoricalClient, LiveClient,
};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize)]
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
pub struct Tick {
    pub symbol: String,
    /// milliseconds
    pub time: i64,
    pub price: f64,
    pub size: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractInfo {
    pub symbol: String,
    pub tick_size: f64,
    pub point_value: f64,
}

static LIVE: Mutex<Option<tauri::async_runtime::JoinHandle<()>>> = Mutex::new(None);

fn px(v: i64) -> f64 {
    v as f64 / FIXED_PRICE_SCALE as f64
}

/// Tick size and point value for the common CME roots; anything else gets NQ's.
pub fn resolve(symbol: &str) -> ContractInfo {
    let root: String = symbol.chars().take_while(|c| c.is_ascii_alphanumeric() && !c.is_ascii_digit() || *c == '6').collect();
    let (tick_size, point_value) = match root.as_str() {
        "NQ" => (0.25, 20.0),
        "MNQ" => (0.25, 2.0),
        "ES" => (0.25, 50.0),
        "MES" => (0.25, 5.0),
        "YM" => (1.0, 5.0),
        "MYM" => (1.0, 0.5),
        "RTY" => (0.1, 50.0),
        "M2K" => (0.1, 5.0),
        "CL" => (0.01, 1000.0),
        "GC" => (0.1, 100.0),
        "6E" => (0.00005, 125_000.0),
        _ => (0.25, 20.0),
    };
    ContractInfo { symbol: symbol.to_string(), tick_size, point_value }
}

fn stype_for(symbol: &str) -> SType {
    if symbol.contains(".c.") { SType::Continuous } else { SType::RawSymbol }
}

/// Historical OHLCV bars, oldest first. `tf_sec` picks the schema (1m, 1h or 1d); the web side
/// resamples anything in between. Returns the bars and the exclusive end of the available range.
pub async fn history(key: &str, symbol: &str, tf_sec: i64, count: i64) -> Result<(Vec<Bar>, i64), String> {
    let mut client = HistoricalClient::builder().key(key).map_err(e)?.build().map_err(e)?;
    let range = client.metadata().get_dataset_range(Dataset::GlbxMdp3.as_str()).await.map_err(e)?;
    let (schema, step) = if tf_sec >= 86_400 { (Schema::Ohlcv1D, 86_400) } else if tf_sec >= 3600 { (Schema::Ohlcv1H, 3600) } else { (Schema::Ohlcv1M, 60) };
    let bars_wanted = count.max(1) * (tf_sec / step).max(1);
    // Globex trades ~23h a day, 5 days a week: ask for ~1.7x the span, capped.
    let span_sec = (bars_wanted * step) as f64 * 1.7;
    let span_sec = if step == 60 { span_sec.min(60.0 * 86_400.0) } else { span_sec.min(400.0 * 86_400.0) } as i64;
    let end = range.end;
    let start = (end - time::Duration::seconds(span_sec)).max(range.start);
    let mut decoder = client
        .timeseries()
        .get_range(
            &GetRangeParams::builder()
                .dataset(Dataset::GlbxMdp3)
                .date_time_range(start..end)
                .symbols(symbol)
                .stype_in(stype_for(symbol))
                .schema(schema)
                .build(),
        )
        .await
        .map_err(e)?;
    let mut out = Vec::new();
    while let Some(b) = decoder.decode_record::<OhlcvMsg>().await.map_err(e)? {
        if b.hd.ts_event == u64::MAX { continue }
        let t = (b.hd.ts_event / 1_000_000_000) as i64;
        out.push(Bar { time: t, open: px(b.open), high: px(b.high), low: px(b.low), close: px(b.close), volume: b.volume as f64 });
    }
    out.sort_by_key(|b| b.time);
    out.dedup_by_key(|b| b.time);
    if out.len() as i64 > bars_wanted {
        let drop = out.len() - bars_wanted as usize;
        out.drain(..drop);
    }
    Ok((out, end.unix_timestamp()))
}

/// Start (or restart) the live stream for one symbol. `since` (unix seconds) asks the gateway to
/// replay the intraday trades from there first; it is clamped to the last 23 hours.
pub async fn live_start(app: AppHandle, key: String, symbol: String, since: i64) -> Result<(), String> {
    live_stop();
    let mut client = LiveClient::builder().key(&key).map_err(e)?.dataset(Dataset::GlbxMdp3).build().await.map_err(e)?;
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let since = since.max(now - 23 * 3600);
    let base = Subscription::builder().symbols(symbol.as_str()).schema(Schema::Trades).stype_in(stype_for(&symbol));
    let sub = if since < now - 60 {
        base.start(OffsetDateTime::from_unix_timestamp(since).map_err(e)?).build()
    } else {
        base.build()
    };
    client.subscribe(sub).await.map_err(e)?;
    client.start().await.map_err(e)?;

    let handle = tauri::async_runtime::spawn(async move {
        // Replay folding: one (minute, o, h, l, c, v) bar at a time until the stream is current.
        let mut cur: Option<(i64, f64, f64, f64, f64, f64)> = None;
        let flush = |app: &AppHandle, symbol: &str, b: (i64, f64, f64, f64, f64, f64)| {
            let (t, o, h, l, c, v) = b;
            for (dt, p, s) in [(0, o, 0.0), (20, h, 0.0), (40, l, 0.0), (59, c, v)] {
                let _ = app.emit("md:tick", Tick { symbol: symbol.to_string(), time: (t + dt) * 1000, price: p, size: s });
            }
        };
        loop {
            match client.next_record().await {
                Ok(Some(rec)) => {
                    if let Some(tr) = rec.get::<TradeMsg>() {
                        let ts_ms = (tr.hd.ts_event / 1_000_000) as i64;
                        let price = px(tr.price);
                        let size = tr.size as f64;
                        let wall_ms = OffsetDateTime::now_utc().unix_timestamp() * 1000;
                        if wall_ms - ts_ms > 5_000 {
                            let minute = ts_ms / 60_000 * 60;
                            match cur.as_mut() {
                                Some(b) if b.0 == minute => { b.2 = b.2.max(price); b.3 = b.3.min(price); b.4 = price; b.5 += size; }
                                _ => {
                                    if let Some(b) = cur.take() { flush(&app, &symbol, b) }
                                    cur = Some((minute, price, price, price, price, size));
                                }
                            }
                        } else {
                            if let Some(b) = cur.take() { flush(&app, &symbol, b) }
                            let _ = app.emit("md:tick", Tick { symbol: symbol.clone(), time: ts_ms, price, size });
                        }
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    let _ = app.emit("md:error", format!("Databento live: {err}"));
                    break;
                }
            }
        }
    });
    *LIVE.lock().unwrap() = Some(handle);
    Ok(())
}

pub fn live_stop() {
    if let Some(h) = LIVE.lock().unwrap().take() {
        h.abort();
    }
}

fn e(err: impl std::fmt::Display) -> String {
    err.to_string()
}
