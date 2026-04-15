use serde::{Deserialize, Serialize};

/// Dark mode profiles available in the app
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DarkModeProfile {
    /// Full dark background with adjusted text colors
    Dark,
    /// Warm dark tone, easy on eyes for long reading
    SepiaDark,
    /// Pure black bg, pure white text, maximum accessibility
    HighContrast,
    /// No processing, original PDF rendering
    Original,
}

impl DarkModeProfile {
    /// Get display name for the profile
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Dark => "Dark",
            Self::SepiaDark => "Sepia Dark",
            Self::HighContrast => "High Contrast",
            Self::Original => "Original",
        }
    }

    /// Cycle to the next profile
    pub fn next(&self) -> Self {
        match self {
            Self::Dark => Self::SepiaDark,
            Self::SepiaDark => Self::HighContrast,
            Self::HighContrast => Self::Original,
            Self::Original => Self::Dark,
        }
    }
}

/// Color palette for the UI theme
#[derive(Debug, Clone)]
pub struct Theme {
    pub background: u32,
    pub surface: u32,
    pub surface_raised: u32,
    pub border: u32,
    pub text_primary: u32,
    pub text_secondary: u32,
    pub accent: u32,
    pub danger: u32,
}

impl Theme {
    /// The default dark theme as specified in the design doc
    pub fn dark() -> Self {
        Self {
            background: 0x0A0A0AFF,
            surface: 0x141414FF,
            surface_raised: 0x1E1E1EFF,
            border: 0x2A2A2AFF,
            text_primary: 0xEBEBEBFF,
            text_secondary: 0x808080FF,
            accent: 0x6366F1FF,
            danger: 0xEF4444FF,
        }
    }
}
