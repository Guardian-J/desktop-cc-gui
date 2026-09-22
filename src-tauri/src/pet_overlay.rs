//! Native host for the draggable always-on-top pet window.

use std::sync::{Mutex, OnceLock};

use enigo::Enigo;
#[cfg(not(windows))]
use enigo::{Mouse, Settings};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(windows)]
use windows::Win32::Foundation::POINT;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

const LABEL: &str = "pet-overlay";
const WIDTH: f64 = 192.0;
const HEIGHT: f64 = 208.0;
const BUBBLE_WIDTH: f64 = 420.0;
const BUBBLE_HEIGHT: f64 = 64.0;
const BASE_SCALE: f64 = 0.6;
const PROXIMITY_PADDING: f64 = 220.0;
const MIN_SCALE: f64 = 0.5;
const MAX_SCALE: f64 = 1.5;
const HIT_TEST_INTERVAL_MS: u64 = 16;
const LOOK_DIRECTION_INTERVAL_MS: u64 = 180;

const PET_OFFSET_X: f64 = (BUBBLE_WIDTH - WIDTH) / 2.0;

fn render_scale(scale: f64) -> f64 {
    BASE_SCALE * scale
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetRuntimeState {
    pub session_key: Option<String>,
    pub session_name: Option<String>,
    pub status: String,
    pub look_direction: u8,
    pub activity: String,
    pub cursor_nearby: bool,
    pub cursor_over: bool,
    pub changed_at: u64,
}

impl Default for PetRuntimeState {
    fn default() -> Self {
        Self {
            session_key: None,
            session_name: None,
            status: "idle".to_string(),
            look_direction: 0,
            activity: "idle".to_string(),
            cursor_nearby: false,
            cursor_over: false,
            changed_at: 0,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetStateUpdate {
    pub session_key: Option<String>,
    pub session_name: Option<String>,
    pub status: String,
    pub look_direction: u8,
    pub activity: String,
    pub changed_at: u64,
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
        .map(|settings| settings.pet_enabled && !settings.pet_id.trim().is_empty())
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
        let cursor_over = state()
            .lock()
            .map(|current| current.cursor_over)
            .unwrap_or(false);
        window
            .set_ignore_cursor_events(!cursor_over)
            .map_err(|e| format!("enable pet overlay click-through: {e}"))?;
        return Ok(window);
    }
    let settings = crate::settings::read_settings().unwrap_or_default();
    let scale = render_scale(settings.pet_scale.clamp(MIN_SCALE, MAX_SCALE));
    let window = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    // Set the hash before the document scripts run.  Using eval after build
    // lets the overlay briefly boot MainApp, which installs unrelated
    // listeners and can leave the transparent window in a blank state.
    .initialization_script("window.location.hash = '#/pet-overlay';")
    .title("CC GUI Pet")
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .inner_size(BUBBLE_WIDTH * scale, HEIGHT * scale + BUBBLE_HEIGHT)
    .visible(false)
    .build()
    .map_err(|e| format!("create pet overlay: {e}"))?;
    // The webview is wider than the visible pet to make room for its status
    // bubble.  Keep that transparent area click-through; the tracker enables
    // interaction only while the cursor is over the pet sprite bounds.
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| format!("enable pet overlay click-through: {e}"))?;
    if let Some(position) = settings.pet_position {
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
            position.x - PET_OFFSET_X * scale,
            position.y - BUBBLE_HEIGHT,
        )));
    }
    Ok(window)
}

fn normalize_scale(scale: f64) -> Result<f64, String> {
    if !scale.is_finite() || !(MIN_SCALE..=MAX_SCALE).contains(&scale) {
        return Err(format!("pet scale must be between {MIN_SCALE} and {MAX_SCALE}"));
    }
    Ok(scale)
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
    let settings = crate::settings::read_settings()?;
    if settings.pet_id.trim().is_empty() {
        return Err("请先导入 Codex 宠物文件".to_string());
    }
    let window = create_window()?;
    start_look_tracking();
    emit_state(&window.app_handle());
    window.show().map_err(|e| format!("show pet overlay: {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn cursor_position(_input: &mut Option<Enigo>) -> Option<(i32, i32)> {
    let mut point = POINT::default();
    // Read the desktop cursor directly. This does not require the input
    // injection permission that Enigo needs for mouse/keyboard actions.
    unsafe { GetCursorPos(&mut point).ok()? };
    Some((point.x, point.y))
}

#[cfg(not(windows))]
fn cursor_position(input: &mut Option<Enigo>) -> Option<(i32, i32)> {
    input.as_mut()?.location().ok()
}

fn start_look_tracking() {
    if TRACKER.set(()).is_err() {
        return;
    }
    let Ok(app) = app().map(Clone::clone) else { return };
    tauri::async_runtime::spawn(async move {
        #[cfg(windows)]
        let mut input: Option<Enigo> = None;
        #[cfg(not(windows))]
        let mut input = Enigo::new(&Settings::default()).ok();
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(HIT_TEST_INTERVAL_MS));
        let mut next_look_update = tokio::time::Instant::now();
        loop {
            interval.tick().await;
            let Some(window) = app.get_webview_window(LABEL) else { continue };
            let Ok(position) = window.outer_position() else { continue };
            let Ok(size) = window.outer_size() else { continue };
            let Some((mouse_x, mouse_y)) = cursor_position(&mut input) else { continue };
            // The native window includes transparent space above the pet for
            // the activity bubble.  Proximity and hover must use the pet's
            // rectangle, not the full transparent window.
            let dpi = window.scale_factor().unwrap_or(1.0);
            let bubble_px = BUBBLE_HEIGHT * dpi;
            let pet_height = size.height as f64 - bubble_px;
            let pet_top = position.y as f64 + bubble_px;
            let pet_left = position.x as f64
                + size.width as f64 * PET_OFFSET_X / BUBBLE_WIDTH;
            let pet_width = size.width as f64 * WIDTH / BUBBLE_WIDTH;
            let center_x = pet_left + pet_width / 2.0;
            let center_y = pet_top + pet_height / 2.0;
            let dx = mouse_x as f64 - center_x;
            let dy = mouse_y as f64 - center_y;
            let direction = (((dx.atan2(-dy) / std::f64::consts::TAU) * 16.0).round() as i32 + 16)
                .rem_euclid(16) as u8;
            let distance = dx.hypot(dy);
            let radius = PROXIMITY_PADDING * dpi + (pet_width.max(pet_height) / 2.0);
            let cursor_nearby = distance <= radius;
            let cursor_over = (mouse_x as f64) >= pet_left
                && (mouse_x as f64) < pet_left + pet_width
                && (mouse_y as f64) >= pet_top
                && (mouse_y as f64) < pet_top + pet_height;
            let now = tokio::time::Instant::now();
            let update_look_direction = now >= next_look_update;
            if update_look_direction {
                next_look_update =
                    now + std::time::Duration::from_millis(LOOK_DIRECTION_INTERVAL_MS);
            }
            let cursor_capture_changed = state()
                .lock()
                .map(|current| current.cursor_over != cursor_over)
                .unwrap_or(false);
            let cursor_capture_applied = if cursor_capture_changed {
                match window.set_ignore_cursor_events(!cursor_over) {
                    Ok(()) => true,
                    Err(error) => {
                        eprintln!("[pet-overlay] update click-through failed: {error}");
                        false
                    }
                }
            } else {
                true
            };
            let changed = if let Ok(mut current) = state().lock() {
                let mut changed = false;
                if current.cursor_nearby != cursor_nearby {
                    current.cursor_nearby = cursor_nearby;
                    changed = true;
                }
                if cursor_capture_applied && current.cursor_over != cursor_over {
                    current.cursor_over = cursor_over;
                    changed = true;
                }
                if update_look_direction
                    && cursor_nearby
                    && current.look_direction != direction
                {
                    current.look_direction = direction;
                    changed = true;
                }
                changed
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
pub fn pet_set_scale(scale: f64) -> Result<f64, String> {
    let scale = normalize_scale(scale)?;
    let _guard = crate::settings::settings_write_lock();
    let mut settings = crate::settings::read_settings()?;
    let previous_render_scale = render_scale(settings.pet_scale.clamp(MIN_SCALE, MAX_SCALE));
    settings.pet_scale = scale;
    crate::settings::persist_settings_committed(&mut settings)?;
    let app = app()?.clone();
    if let Some(window) = app.get_webview_window(LABEL) {
        let dpi = window.scale_factor().unwrap_or(1.0);
        let pet_position = window.outer_position().ok().map(|position| {
            (
                position.x as f64 / dpi + PET_OFFSET_X * previous_render_scale,
                position.y as f64 / dpi + BUBBLE_HEIGHT,
            )
        });
        let next_render_scale = render_scale(scale);
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                BUBBLE_WIDTH * next_render_scale,
                HEIGHT * next_render_scale + BUBBLE_HEIGHT,
            )))
            .map_err(|e| format!("resize pet overlay: {e}"))?;
        if let Some((pet_x, pet_y)) = pet_position {
            window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                    pet_x - PET_OFFSET_X * next_render_scale,
                    pet_y - BUBBLE_HEIGHT,
                )))
                .map_err(|e| format!("reposition pet overlay: {e}"))?;
        }
        window
            .emit("pet://scale", scale)
            .map_err(|e| format!("emit pet scale: {e}"))?;
    }
    Ok(scale)
}

#[tauri::command]
pub fn pet_set_state<R: Runtime>(app: AppHandle<R>, next: PetStateUpdate) -> Result<(), String> {
    {
        let mut current = state().lock().map_err(|_| "pet state lock poisoned")?;
        if current.session_key == next.session_key
            && current.session_name == next.session_name
            && current.status == next.status
            && current.look_direction == next.look_direction
            && current.activity == next.activity
        {
            return Ok(());
        }
        current.session_key = next.session_key;
        current.session_name = next.session_name;
        current.status = next.status;
        current.look_direction = next.look_direction;
        current.activity = next.activity;
        current.changed_at = next.changed_at;
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
