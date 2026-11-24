// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Tauri links the Windows Common Controls manifest into binary targets.
#[cfg(test)]
mod ipc_tests;

fn main() {
    source_codes_trim_lib::run()
}
