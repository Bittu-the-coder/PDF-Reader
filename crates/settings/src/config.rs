use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::theme::DarkModeProfile;

/// Application configuration persisted to disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// The dark mode profile to use
    pub dark_mode: DarkModeProfile,
    /// Default zoom level (1.0 = 100%)
    pub default_zoom: f32,
    /// Whether to show the thumbnail sidebar
    pub show_thumbnails: bool,
    /// Whether to show the outline sidebar
    pub show_outline: bool,
    /// Recently opened files (most recent first)
    pub recent_files: Vec<PathBuf>,
    /// Maximum number of recent files to remember
    pub max_recent_files: usize,
    /// Window width on last close
    pub window_width: u32,
    /// Window height on last close
    pub window_height: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            dark_mode: DarkModeProfile::Dark,
            default_zoom: 1.0,
            show_thumbnails: true,
            show_outline: false,
            recent_files: Vec::new(),
            max_recent_files: 20,
            window_width: 1200,
            window_height: 800,
        }
    }
}

impl AppConfig {
    /// Load config from the default config file path
    pub fn load() -> Result<Self> {
        let path = Self::config_path()?;
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            let config: AppConfig = toml::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Self::default())
        }
    }

    /// Save config to disk
    pub fn save(&self) -> Result<()> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = toml::to_string_pretty(self)?;
        std::fs::write(&path, content)?;
        Ok(())
    }

    /// Add a file to the recent files list
    pub fn add_recent_file(&mut self, path: PathBuf) {
        // Remove if already present
        self.recent_files.retain(|p| p != &path);
        // Add to front
        self.recent_files.insert(0, path);
        // Truncate
        self.recent_files.truncate(self.max_recent_files);
    }

    /// Get the config file path
    fn config_path() -> Result<PathBuf> {
        let config_dir =
            dirs::config_dir().ok_or_else(|| anyhow::anyhow!("Could not find config directory"))?;
        Ok(config_dir.join("the-reader").join("config.toml"))
    }
}
