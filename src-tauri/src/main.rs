// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "desktop")]
fn main() {
    shelf_lib::run();
}

#[cfg(not(feature = "desktop"))]
fn main() {}
