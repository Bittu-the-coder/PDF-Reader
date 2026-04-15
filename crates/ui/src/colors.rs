use gpui::Hsla;

/// Convert a hex color (0xRRGGBBAA) to GPUI's Hsla color
pub fn hex_to_hsla(hex: u32) -> Hsla {
    let r = ((hex >> 24) & 0xFF) as f32 / 255.0;
    let g = ((hex >> 16) & 0xFF) as f32 / 255.0;
    let b = ((hex >> 8) & 0xFF) as f32 / 255.0;
    let a = (hex & 0xFF) as f32 / 255.0;

    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;

    let l = (max + min) / 2.0;

    let (h, s) = if delta < 0.00001 {
        (0.0, 0.0)
    } else {
        let s = if l < 0.5 {
            delta / (max + min)
        } else {
            delta / (2.0 - max - min)
        };

        let h = if (max - r).abs() < 0.00001 {
            ((g - b) / delta) % 6.0
        } else if (max - g).abs() < 0.00001 {
            ((b - r) / delta) + 2.0
        } else {
            ((r - g) / delta) + 4.0
        };

        let h = h * 60.0;
        let h = if h < 0.0 { h + 360.0 } else { h };
        (h / 360.0, s)
    };

    Hsla {
        h,
        s,
        l,
        a,
    }
}

// Theme colors as constants
pub const BG: u32 = 0x0A0A0AFF;
pub const SURFACE: u32 = 0x141414FF;
pub const SURFACE_RAISED: u32 = 0x1E1E1EFF;
pub const BORDER: u32 = 0x2A2A2AFF;
pub const TEXT_PRIMARY: u32 = 0xEBEBEBFF;
pub const TEXT_SECONDARY: u32 = 0x808080FF;
pub const ACCENT: u32 = 0x6366F1FF;
pub const ACCENT_HOVER: u32 = 0x818CF8FF;
pub const DANGER: u32 = 0xEF4444FF;
pub const SURFACE_HOVER: u32 = 0x1A1A1AFF;
