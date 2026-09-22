//! Native host for the draggable always-on-top pet window.

use std::sync::{Mutex, OnceLock};

use enigo::{Enigo, Mouse, Settings};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const LABEL: &str = "pet-overlay";
const WIDTH: f64 = 192.0;
const HEIGHT: f64 = 208.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetRuntimeState {
    pub status: String,
    pub look_direction: u8,
    pub changed_at: u64,
}

impl Default for PetRuntimeState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            look_direction: 0,
            changed_at: 0,
        }
    }
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static STATE: OnceLock<Mutex<PetRuntimeState>> = OnceLock::new();
static TRACKER: OnceLock<()> = OnceLock::new();

fn state() -> &'static Mutex<PetRuntimeState> {
    STATE.get_or_init(|| Mutex::new(PetRuntimeState::default()))
}

pub fn init(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let _ = state();
    if crate::settings::read_settings()
        .map(|settings| settings.pet_enabled)
        .unwrap_or(false)
    {
        if let Err(error) = set_visible(true) {
            eprintln!("[pet-overlay] startup failed: {error}");
        }
        start_look_tracking();
    }
}

fn app() -> Result<&'static AppHandle, String> {
    APP.get().ok_or_else(|| "pet overlay is not initialized".to_string())
}

fn create_window() -> Result<tauri::WebviewWindow, String> {
    let app = app()?;
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let window = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("CC GUI Pet")
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .inner_size(WIDTH, HEIGHT)
    .visible(false)
    .build()
    .map_err(|e| format!("create pet overlay: {e}"))?;
    let _ = window.eval("window.location.hash = '#/pet-overlay'");
    if let Ok(settings) = crate::settings::read_settings() {
        if let Some(position) = settings.pet_position {
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                position.x,
                position.y,
            )));
        }
    }
    Ok(window)
}

fn emit_state<R: Runtime>(app: &AppHandle<R>) {
    let snapshot = state().lock().ok().map(|guard| guard.clone()).unwrap_or_default();
    let _ = app.emit("pet://state", snapshot);
}

fn set_visible(visible: bool) -> Result<(), String> {
    if !visible {
        let app = app()?;
        if let Some(window) = app.get_webview_window(LABEL) {
            window.hide().map_err(|e| format!("hide pet overlay: {e}"))?;
        }
        return Ok(());
    }
    let window = create_window()?;
    start_look_tracking();
    emit_state(&window.app_handle());
    window.show().map_err(|e| format!("show pet overlay: {e}"))?;
    Ok(())
}

fn start_look_tracking() {
    if TRACKER.set(()).is_err() {
        return;
    }
    let Ok(app) = app().map(Clone::clone) else { return };
    tauri::async_runtime::spawn(async move {
        let mut input = Enigo::new(&Settings::default()).ok();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(180));
        loop {
            interval.tick().await;
            let Some(window) = app.get_webview_window(LABEL) else { continue };
            let Ok(position) = window.outer_position() else { continue };
            let Ok(size) = window.outer_size() else { continue };
            let Some(input) = input.as_mut() else { continue };
            let Ok((mouse_x, mouse_y)) = input.location() else { continue };
            let center_x = position.x as f64 + size.width as f64 / 2.0;
            let center_y = position.y as f64 + size.height as f64 / 2.0;
            let dx = mouse_x as f64 - center_x;
            let dy = mouse_y as f64 - center_y;
            let direction = (((dx.atan2(-dy) / std::f64::consts::TAU) * 16.0).round() as i32 + 16)
                .rem_euclid(16) as u8;
            let changed = if let Ok(mut current) = state().lock() {
                if current.look_direction == direction {
                    false
                } else {
                    current.look_direction = direction;
                    true
                }
            } else {
                false
            };
            if changed {
                let snapshot = state().lock().ok().map(|guard| guard.clone());
                if let Some(snapshot) = snapshot {
                    let _ = window.emit("pet://state", snapshot);
                }
            }
        }
    });
}

#[tauri::command]
pub fn pet_set_visible(visible: bool) -> Result<(), String> {
    set_visible(visible)
}

#[tauri::command]
pub fn pet_set_state<R: Runtime>(app: AppHandle<R>, next: PetRuntimeState) -> Result<(), String> {
    {
        let mut current = state().lock().map_err(|_| "pet state lock poisoned")?;
        if *current == next {
            return Ok(());
        }
        *current = next;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let snapshot = state()
            .lock()
            .map_err(|_| "pet state lock poisoned")?
            .clone();
        window
            .emit("pet://state", snapshot)
            .map_err(|e| format!("emit pet state: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn pet_save_position(position: crate::settings::PetPosition) -> Result<(), String> {
    if !position.x.is_finite() || !position.y.is_finite() {
        return Err("pet position must be finite".to_string());
    }
    let _guard = crate::settings::settings_write_lock();
    let mut settings = crate::settings::read_settings()?;
    settings.pet_position = Some(position);
    crate::settings::persist_settings_committed(&mut settings).map(|_| ())
}
