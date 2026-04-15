use gpui::*;
use std::path::PathBuf;

use the_reader_settings::AppConfig;
use the_reader_ui::AppView;

fn main() {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    log::info!("Starting The Reader PDF Reader");

    // Load config
    let config = AppConfig::load().unwrap_or_else(|e| {
        log::warn!("Failed to load config: {:?}, using defaults", e);
        AppConfig::default()
    });

    // Check for command-line arguments (file to open)
    let file_arg: Option<PathBuf> = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .filter(|p| p.exists());

    let window_width = config.window_width;
    let window_height = config.window_height;

    // Create the GPUI application
    let app = Application::new();

    app.run(move |cx: &mut AppContext| {
        let bounds = Bounds {
            origin: Point::default(),
            size: Size {
                width: px(window_width as f32),
                height: px(window_height as f32),
            },
        };

        let window_bounds = WindowBounds::Windowed(bounds);

        let options = WindowOptions {
            window_bounds: Some(window_bounds),
            titlebar: Some(TitlebarOptions {
                title: Some("The Reader".into()),
                ..Default::default()
            }),
            kind: WindowKind::Normal,
            ..Default::default()
        };

        cx.open_window(options, |_window, cx| {
            let mut app_view = AppView::new(config.clone());

            // If a file was passed as argument, open it
            if let Some(ref path) = file_arg {
                app_view.open_file(path.clone());
            }

            cx.new(|_cx| app_view)
        })
        .expect("Failed to open window");
    });
}
