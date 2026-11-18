//! The sealed indicator slot.
//!
//! Arctic's own indicator goes here, in Rust, so it ships compiled inside the .exe instead of as
//! readable JavaScript. The web side only sends bars and parameters and gets plot values back
//! (`compute_sealed` in lib.rs). What is below is a PLACEHOLDER so the plumbing can be seen
//! working on the chart: a bias oscillator (fast EMA minus slow EMA, in ATR units) and a session
//! VWAP. Replace `compute` with the real logic; keep the `Output` shape or update
//! `src/indicators/sealed.ts` to match.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)] // `open` is here for Arctic's logic; the placeholder does not read it
pub struct Bar {
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Debug, Default, Serialize)]
pub struct Output {
    /// plot key -> one value per bar (None where the indicator has no value yet)
    pub plots: HashMap<String, Vec<Option<f64>>>,
}

fn param(params: &HashMap<String, f64>, key: &str, default: f64) -> f64 {
    params.get(key).copied().unwrap_or(default)
}

fn ema(values: &[f64], len: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if len == 0 || values.len() < len {
        return out;
    }
    let k = 2.0 / (len as f64 + 1.0);
    let mut e = values[..len].iter().sum::<f64>() / len as f64;
    out[len - 1] = Some(e);
    for i in len..values.len() {
        e = values[i] * k + e * (1.0 - k);
        out[i] = Some(e);
    }
    out
}

fn atr(bars: &[Bar], len: usize) -> Vec<Option<f64>> {
    let mut tr = Vec::with_capacity(bars.len());
    for (i, b) in bars.iter().enumerate() {
        let t = if i == 0 {
            b.high - b.low
        } else {
            let pc = bars[i - 1].close;
            (b.high - b.low).max((b.high - pc).abs()).max((b.low - pc).abs())
        };
        tr.push(t);
    }
    ema(&tr, len)
}

/// CME Globex session opens 22:00 UTC; anchor the VWAP there.
fn session_id(time: i64) -> i64 {
    (time + 2 * 3600).div_euclid(86_400)
}

fn session_vwap(bars: &[Bar]) -> Vec<Option<f64>> {
    let mut out = Vec::with_capacity(bars.len());
    let (mut pv, mut v, mut sid) = (0.0, 0.0, i64::MIN);
    for b in bars {
        let s = session_id(b.time);
        if s != sid {
            sid = s;
            pv = 0.0;
            v = 0.0;
        }
        let tp = (b.high + b.low + b.close) / 3.0;
        pv += tp * b.volume;
        v += b.volume;
        out.push(if v > 0.0 { Some(pv / v) } else { None });
    }
    out
}

pub fn compute(bars: &[Bar], params: &HashMap<String, f64>) -> Output {
    let fast = param(params, "fast", 9.0).max(1.0) as usize;
    let slow = param(params, "slow", 34.0).max(1.0) as usize;
    let atr_len = param(params, "atr", 14.0).max(1.0) as usize;

    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let ef = ema(&closes, fast);
    let es = ema(&closes, slow);
    let a = atr(bars, atr_len);

    let bias: Vec<Option<f64>> = (0..bars.len())
        .map(|i| match (ef[i], es[i], a[i]) {
            (Some(f), Some(s), Some(r)) if r > 0.0 => Some((f - s) / r),
            _ => None,
        })
        .collect();

    let mut plots = HashMap::new();
    plots.insert("vwap".to_string(), session_vwap(bars));
    plots.insert("bias".to_string(), bias);
    Output { plots }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bars(n: usize) -> Vec<Bar> {
        (0..n)
            .map(|i| {
                let p = 100.0 + (i as f64 * 0.7).sin() * 3.0 + i as f64 * 0.05;
                Bar { time: 1_700_000_000 + i as i64 * 60, open: p, high: p + 1.0, low: p - 1.0, close: p + 0.2, volume: 100.0 }
            })
            .collect()
    }

    #[test]
    fn plots_are_bar_aligned() {
        let b = bars(120);
        let out = compute(&b, &HashMap::new());
        assert_eq!(out.plots["bias"].len(), 120);
        assert_eq!(out.plots["vwap"].len(), 120);
        assert!(out.plots["bias"][..33].iter().all(|v| v.is_none()));
        assert!(out.plots["bias"][40].is_some());
        assert!(out.plots["vwap"][0].is_some());
    }

    #[test]
    fn session_resets_at_2200_utc() {
        let day = 1_700_000_000 - (1_700_000_000 % 86_400);
        let t1 = day + 21 * 3600 + 59 * 60;
        assert_ne!(session_id(t1), session_id(t1 + 60));
    }
}
