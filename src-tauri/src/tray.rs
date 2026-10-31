use tauri::{
    AppHandle, Manager,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

pub fn show_main(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray.open", "打开 AhaKey Studio", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray.quit", "退出 AhaKey Studio", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;

    TrayIconBuilder::with_id("ahakey")
        .icon(keyboard_icon())
        .icon_as_template(true)
        .tooltip("AhaKey Studio")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray.open" => {
                if let Err(error) = show_main(app) {
                    eprintln!("Cannot show AhaKey Studio: {error}");
                }
            }
            // Studio's session Runtime keeps its existing independent lifecycle.
            "tray.quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn keyboard_icon() -> Image<'static> {
    // A 22 pt monochrome keyboard at 2x resolution. macOS supplies the menu
    // bar's light/dark foreground through the template alpha channel.
    const SIZE: u32 = 44;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let outline = (6..38).contains(&x)
                && (10..34).contains(&y)
                && !((8..36).contains(&x) && (12..32).contains(&y))
                && !((x == 6 || x == 37) && (y == 10 || y == 33));
            let keys = (12..32).contains(&x) && (16..20).contains(&y) && (x - 12) % 6 < 3;
            let space = (14..30).contains(&x) && (25..28).contains(&y);
            if outline || keys || space {
                rgba[((y * SIZE + x) * 4 + 3) as usize] = 255;
            }
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}
