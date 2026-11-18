//! Dev tool: run the sealed overlay on saved bars and print the drawings as JSON.
//! Usage: cargo run --example overlay -- bars.json ctx.json <tf_sec> > overlay.json
//! Only for checking the look on real data; the output never ships.
use std::{env, fs};

#[path = "../src/sealed.rs"]
#[allow(dead_code)]
mod sealed;

fn main() {
    let args: Vec<String> = env::args().collect();
    let bars: Vec<sealed::Bar> = serde_json::from_str(&fs::read_to_string(&args[1]).unwrap()).unwrap();
    let ctx: Vec<sealed::Bar> = serde_json::from_str(&fs::read_to_string(&args[2]).unwrap()).unwrap();
    let tf: i64 = args[3].parse().unwrap();
    let out = sealed::compute(&bars, &ctx, tf, &Default::default());
    println!("{}", serde_json::to_string(&out).unwrap());
}
