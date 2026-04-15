use the_reader_settings::DarkModeProfile;

/// The dark mode rendering engine
/// Applies intelligent color transformations to PDF page images
pub struct DarkModeEngine;

impl DarkModeEngine {
    /// Apply dark mode transformation to an RGBA image buffer
    pub fn apply(pixels: &mut [u8], _width: u32, _height: u32, profile: DarkModeProfile) {
        match profile {
            DarkModeProfile::Original => {
                // No transformation
            }
            DarkModeProfile::Dark => {
                Self::apply_dark(pixels);
            }
            DarkModeProfile::SepiaDark => {
                Self::apply_sepia_dark(pixels);
            }
            DarkModeProfile::HighContrast => {
                Self::apply_high_contrast(pixels);
            }
        }
    }

    /// Standard dark mode: invert luminance, preserve hue
    fn apply_dark(pixels: &mut [u8]) {
        for chunk in pixels.chunks_exact_mut(4) {
            let r = chunk[0] as f32 / 255.0;
            let g = chunk[1] as f32 / 255.0;
            let b = chunk[2] as f32 / 255.0;

            // Calculate luminance
            let lum = 0.299 * r + 0.587 * g + 0.114 * b;

            // For near-white backgrounds (paper), convert to dark
            // For dark text, convert to light
            // For colored elements, adjust brightness while preserving hue
            if lum > 0.85 {
                // Background — make it dark (#0F0F0F)
                let target_lum = 0.06;
                let factor = if lum > 0.001 { target_lum / lum } else { 1.0 };
                chunk[0] = (r * factor * 255.0).min(255.0) as u8;
                chunk[1] = (g * factor * 255.0).min(255.0) as u8;
                chunk[2] = (b * factor * 255.0).min(255.0) as u8;
            } else if lum < 0.15 {
                // Dark text — make it light (#E8E8E8)
                let target_lum = 0.91;
                if lum < 0.01 {
                    // Pure black text → near white
                    chunk[0] = 0xE8;
                    chunk[1] = 0xE8;
                    chunk[2] = 0xE8;
                } else {
                    let factor = target_lum / lum;
                    chunk[0] = (r * factor * 255.0).min(255.0) as u8;
                    chunk[1] = (g * factor * 255.0).min(255.0) as u8;
                    chunk[2] = (b * factor * 255.0).min(255.0) as u8;
                }
            } else {
                // Mid-tones: smart inversion preserving hue
                let inv_lum = 1.0 - lum;
                let ratio = if lum > 0.001 { inv_lum / lum } else { 1.0 };
                chunk[0] = (r * ratio * 255.0).clamp(0.0, 255.0) as u8;
                chunk[1] = (g * ratio * 255.0).clamp(0.0, 255.0) as u8;
                chunk[2] = (b * ratio * 255.0).clamp(0.0, 255.0) as u8;
            }
        }
    }

    /// Sepia dark: warm dark tone
    fn apply_sepia_dark(pixels: &mut [u8]) {
        // First apply dark mode
        Self::apply_dark(pixels);

        // Then add warm sepia tint
        for chunk in pixels.chunks_exact_mut(4) {
            let r = chunk[0] as f32;
            let g = chunk[1] as f32;
            let b = chunk[2] as f32;

            // Warm tint — shift toward amber
            chunk[0] = (r * 1.08).min(255.0) as u8;
            chunk[1] = (g * 1.02).min(255.0) as u8;
            chunk[2] = (b * 0.85).min(255.0) as u8;
        }
    }

    /// High contrast: pure black/white
    fn apply_high_contrast(pixels: &mut [u8]) {
        for chunk in pixels.chunks_exact_mut(4) {
            let r = chunk[0] as f32 / 255.0;
            let g = chunk[1] as f32 / 255.0;
            let b = chunk[2] as f32 / 255.0;

            let lum = 0.299 * r + 0.587 * g + 0.114 * b;

            if lum > 0.5 {
                // Light → pure black background
                chunk[0] = 0x00;
                chunk[1] = 0x00;
                chunk[2] = 0x00;
            } else {
                // Dark → pure white text
                chunk[0] = 0xFF;
                chunk[1] = 0xFF;
                chunk[2] = 0xFF;
            }
        }
    }
}
