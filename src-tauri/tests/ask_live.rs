//! Live ask-path tests: drive the real `send_message` → question card →
//! `answer_question` chain of the app against the locally installed `grok` /
//! `codex` CLIs (both must be signed in), plus the image, resume and
//! interrupt paths their new native transports changed. The ask case uses the
//! prompt — 「调用 ask 工具向我提问，必须恰好三个问题，全部放在同一次 ask 调用里」
//! — answers every card with the first option, and asserts the turn settles
//! with `done` (not `error`) and the model reports the answers it received.
//!
//! Not part of the default suite (needs an authenticated CLI, network and
//! minutes of wall time):
//! `cargo test --test ask_live -- --ignored --nocapture --test-threads=1`
#![cfg(unix)]

use ccgui_next_lib::config::ConfigStore;
use ccgui_next_lib::db::Db;
use ccgui_next_lib::engine::{self, ProcessRegistry};
use ccgui_next_lib::event_sink::{EventSink, ENGINE_EVENT_NAME};
use ccgui_next_lib::AppState;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Listener, Manager};

/// 用户复现用提示词:同一次 ask 调用里恰好三个问题。
const PROMPT: &str = "调用 ask 工具向我提问，必须恰好三个问题，全部放在同一次 ask 调用里。\
我回答完之后，只回一行字：告诉我我都选择了哪些答案";

/// Ask must arrive within this window; a real model turn takes seconds, but a
/// cold CLI start plus network stalls deserve room.
const ASK_DEADLINE: u64 = 240_000;
/// Stop has to settle the turn quickly — this is the user's Stop button.
const INTERRUPT_DEADLINE: u64 = 120_000;

/// A 1×1 pixel PNG, solid `#0000FF`: the image case needs a real file for the
/// transport to encode, and a colour with only one honest answer.
const BLUE_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
    0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78,
    0xda, 0x63, 0x60, 0x60, 0xf8, 0x0f, 0x00, 0x01, 0x03, 0x01, 0x00, 0x36, 0x74, 0x11,
    0x40, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "ccgui-ask-live-{}-{}",
        tag,
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// HOME is left alone on purpose: the CLIs must find their real credentials.
fn build_app(
    home: &std::path::Path,
) -> (tauri::App<tauri::test::MockRuntime>, Arc<Mutex<Vec<Value>>>) {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let state = AppState {
        db: Arc::new(Db::open_at(&home.join("app.db")).unwrap()),
        sink: EventSink::new(Arc::new(app.handle().clone())),
        terminal_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::terminal::TERMINAL_OUTPUT_EVENT,
        ),
        plugin_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::event_sink::PLUGIN_AGENT_EVENT_NAME,
        ),
        terminals: ccgui_next_lib::terminal::TerminalRegistry::default(),
        processes: Arc::new(ProcessRegistry::default()),
        emitters: ccgui_next_lib::event_sink::BroadcastEmit::new(Arc::new(app.handle().clone())),
        web: ccgui_next_lib::web::WebAccessState::default(),
        relay: ccgui_next_lib::relay::RelayState::default(),
        dsh_host: Arc::new(ccgui_next_lib::dsh_host::DshHostState::default()),
        opencode_server: Arc::new(
            ccgui_next_lib::engine::opencode_server::OpencodeServerState::default(),
        ),
    };
    app.manage(state);
    app.manage(ConfigStore::default());

    let events: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    let handle = app.handle().clone();
    handle.listen_any(ENGINE_EVENT_NAME, move |event: tauri::Event| {
        if let Ok(batch) = serde_json::from_str::<Vec<Value>>(event.payload()) {
            captured.lock().extend(batch);
        }
    });
    (app, events)
}

fn snapshot(events: &Arc<Mutex<Vec<Value>>>) -> Vec<Value> {
    events.lock().clone()
}

fn kinds(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| e.get("kind").and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn count_kind(events: &[Value], kind: &str) -> usize {
    kinds(events).iter().filter(|k| *k == kind).count()
}

fn first_kind(events: &[Value], kind: &str) -> Option<Value> {
    events
        .iter()
        .find(|e| e.get("kind").and_then(Value::as_str) == Some(kind))
        .cloned()
}

fn text_of(events: &[Value]) -> String {
    events
        .iter()
        .filter(|e| e.get("kind").and_then(Value::as_str) == Some("delta"))
        .filter_map(|e| e.get("data").and_then(Value::as_str))
        .collect()
}

fn assert_no_error(engine_id: &str, stage: &str, events: &[Value]) {
    if let Some(error) = first_kind(events, "error") {
        panic!("{engine_id}: turn failed {stage}: {error}");
    }
}

async fn wait_for<F>(
    events: &Arc<Mutex<Vec<Value>>>,
    what: &str,
    predicate: F,
    deadline_ms: u64,
) -> Vec<Value>
where
    F: Fn(&[Value]) -> bool,
{
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(deadline_ms);
    loop {
        let seen = snapshot(events);
        if predicate(&seen) {
            return seen;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "no {what} within {deadline_ms}ms; kinds={:?}",
            kinds(&seen)
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// One send through the real command surface.
async fn send(
    app: &tauri::App<tauri::test::MockRuntime>,
    engine_id: &str,
    workspace: &std::path::Path,
    session_id: Option<String>,
    run_id: &str,
    prompt: &str,
) {
    engine::send_message(
        app.state::<AppState>(),
        engine_id.to_string(),
        workspace.to_string_lossy().to_string(),
        session_id,
        prompt.to_string(),
        None,
        None,
        None,
        Some("bypass".to_string()),
        None,
        Some(run_id.to_string()),
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("{engine_id}: send_message failed: {error}"));
}

async fn wait_done(
    engine_id: &str,
    events: &Arc<Mutex<Vec<Value>>>,
    wanted: usize,
    what: &str,
) -> Vec<Value> {
    let seen = wait_for(
        events,
        what,
        |seen| count_kind(seen, "done") >= wanted || count_kind(seen, "error") > 0,
        ASK_DEADLINE,
    )
    .await;
    assert_no_error(engine_id, what, &seen);
    seen
}

fn assert_drained(engine_id: &str, app: &tauri::App<tauri::test::MockRuntime>, stage: &str) {
    assert!(
        app.state::<AppState>().processes.0.lock().unwrap().is_empty(),
        "{engine_id}: the run is still registered after {stage}"
    );
}

/// An option label without any trailing parenthesised annotation: the part a
/// model is expected to echo when it reports what the user picked.
fn label_stem(label: &str) -> &str {
    label.split(" (").next().unwrap_or(label).trim()
}

/// Three questions in one ask, answered through the card's own command.
async fn live_ask(engine_id: &str) {
    let home = temp_dir(&format!("ask-{engine_id}"));
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let (app, events) = build_app(&home);
    let run_id = format!("run-ask-{engine_id}");

    send(&app, engine_id, &workspace, None, &run_id, PROMPT).await;

    let seen = wait_for(
        &events,
        "question event",
        |seen| count_kind(seen, "question") > 0 || count_kind(seen, "error") > 0,
        ASK_DEADLINE,
    )
    .await;
    assert_no_error(engine_id, "before asking", &seen);
    let question = first_kind(&seen, "question").expect("question event");
    let cards = question["data"]["input"]["questions"]
        .as_array()
        .unwrap_or_else(|| panic!("{engine_id}: question payload has no questions: {question}"))
        .clone();
    assert_eq!(
        cards.len(),
        3,
        "{engine_id}: expected 3 questions, got {cards:?}"
    );

    let mut answers = serde_json::Map::new();
    let mut labels = Vec::new();
    for card in &cards {
        let header = card["header"]
            .as_str()
            .unwrap_or_else(|| panic!("{engine_id}: card has no header: {card}"));
        assert!(!header.is_empty(), "{engine_id}: empty card header");
        let options = card["options"]
            .as_array()
            .unwrap_or_else(|| panic!("{engine_id}: card has no options: {card}"));
        assert!(
            options.len() >= 2,
            "{engine_id}: card offers fewer than two options: {card}"
        );
        let label = options[0]["label"]
            .as_str()
            .unwrap_or_else(|| panic!("{engine_id}: option has no label: {card}"))
            .to_string();
        labels.push(label.clone());
        answers.insert(
            card["question"]
                .as_str()
                .unwrap_or_else(|| panic!("{engine_id}: card has no question text: {card}"))
                .to_string(),
            json!(label),
        );
    }
    println!(
        "[{engine_id}] answered: {}",
        serde_json::to_string(&answers).unwrap()
    );

    engine::answer_question(
        app.state::<AppState>(),
        run_id.clone(),
        question["data"]["requestId"]
            .as_str()
            .unwrap_or_else(|| panic!("{engine_id}: question event has no requestId: {question}"))
            .to_string(),
        Some(Value::Object(answers)),
    )
    .await
    .unwrap_or_else(|error| panic!("{engine_id}: answer_question failed: {error}"));

    let seen = wait_done(engine_id, &events, 1, "done after the answer").await;
    let reply = text_of(&seen);
    println!("[{engine_id}] reply: {reply}");
    // The model reports the answers in its own words, so compare the label's
    // own text (codex's model drops the `(Recommended)` suffix its card adds).
    let missing: Vec<&str> = labels
        .iter()
        .map(|label| label_stem(label))
        .filter(|stem| !reply.contains(stem))
        .collect();
    assert!(
        missing.is_empty(),
        "{engine_id}: the reply never mentions the chosen answers {missing:?}: {reply}"
    );
    assert_drained(engine_id, &app, "done");
}

/// A second send with the session id the first turn reported must keep the
/// conversation: both engines resume through their native transport now.
async fn live_resume(engine_id: &str) {
    let home = temp_dir(&format!("resume-{engine_id}"));
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let (app, events) = build_app(&home);

    send(
        &app,
        engine_id,
        &workspace,
        None,
        &format!("run-resume1-{engine_id}"),
        "记住这个数字：7531。只回一个字：好",
    )
    .await;
    let seen = wait_done(engine_id, &events, 1, "done of the first turn").await;
    let session_id = first_kind(&seen, "done")
        .and_then(|done| done["sessionId"].as_str().map(str::to_string))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| panic!("{engine_id}: done carried no session id: {:?}", kinds(&seen)));
    assert_drained(engine_id, &app, "the first turn");
    println!("[{engine_id}] session: {session_id}");

    send(
        &app,
        engine_id,
        &workspace,
        Some(session_id),
        &format!("run-resume2-{engine_id}"),
        "我刚才让你记住的数字是多少？只回那个数字，不要解释。",
    )
    .await;
    let seen = wait_done(engine_id, &events, 2, "done of the resumed turn").await;
    let reply = text_of(&seen);
    println!("[{engine_id}] resumed reply: {reply}");
    assert!(
        reply.contains("7531"),
        "{engine_id}: the resumed turn lost the conversation: {reply}"
    );
    assert_drained(engine_id, &app, "the resumed turn");
}

/// Stop: a streaming turn settles without an error and leaves nothing behind.
async fn live_interrupt(engine_id: &str) {
    let home = temp_dir(&format!("interrupt-{engine_id}"));
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let (app, events) = build_app(&home);
    let run_id = format!("run-interrupt-{engine_id}");

    send(
        &app,
        engine_id,
        &workspace,
        None,
        &run_id,
        "请从 1 数到 300，每个数字单独一行，不要省略，不要合并。",
    )
    .await;
    wait_for(
        &events,
        "the first delta",
        |seen| count_kind(seen, "delta") > 0 || count_kind(seen, "error") > 0,
        INTERRUPT_DEADLINE,
    )
    .await;

    let killed = engine::interrupt_session(app.state::<AppState>(), run_id.clone())
        .await
        .unwrap_or_else(|error| panic!("{engine_id}: interrupt_session failed: {error}"));
    assert!(killed, "{engine_id}: the run was already gone before Stop");

    let seen = wait_for(
        &events,
        "settle after Stop",
        |seen| count_kind(seen, "done") > 0 || count_kind(seen, "error") > 0,
        INTERRUPT_DEADLINE,
    )
    .await;
    assert_no_error(engine_id, "after Stop", &seen);
    assert_drained(engine_id, &app, "Stop");
}

/// One send carrying image attachments — the local transports encode the bytes
/// themselves now (grok as ACP image blocks, codex as `localImage`).
async fn send_with_images(
    app: &tauri::App<tauri::test::MockRuntime>,
    engine_id: &str,
    workspace: &std::path::Path,
    run_id: &str,
    prompt: &str,
    images: Vec<String>,
) {
    engine::send_message(
        app.state::<AppState>(),
        engine_id.to_string(),
        workspace.to_string_lossy().to_string(),
        None,
        prompt.to_string(),
        Some(images),
        None,
        None,
        Some("bypass".to_string()),
        None,
        Some(run_id.to_string()),
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("{engine_id}: send_message failed: {error}"));
}

/// An attached image must still reach the model: the local launch moved from a
/// staged prompt file (`grok --prompt-file`) and `codex -i` to the drivers, so
/// the blue pixel is the cheapest proof the bytes survive the swap.
async fn live_image(engine_id: &str) {
    let home = temp_dir(&format!("image-{engine_id}"));
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let png = workspace.join("probe-blue.png");
    std::fs::write(&png, BLUE_PNG).unwrap();
    let (app, events) = build_app(&home);

    send_with_images(
        &app,
        engine_id,
        &workspace,
        &format!("run-image-{engine_id}"),
        "这张图是什么颜色？只回答颜色名称，不要解释。",
        vec![png.to_string_lossy().to_string()],
    )
    .await;

    let seen = wait_done(engine_id, &events, 1, "done of the image turn").await;
    let reply = text_of(&seen);
    println!("[{engine_id}] image reply: {reply}");
    assert!(
        reply.contains("蓝") || reply.to_lowercase().contains("blue"),
        "{engine_id}: the model never saw the blue image: {reply}"
    );
    assert_drained(engine_id, &app, "the image turn");
}

#[tokio::test]
#[ignore = "needs an authenticated grok CLI, network and minutes"]
async fn grok_asks_and_accepts_the_answer() {
    live_ask("grok").await;
}

#[tokio::test]
#[ignore = "needs an authenticated codex CLI, network and minutes"]
async fn codex_asks_and_accepts_the_answer() {
    live_ask("codex").await;
}

#[tokio::test]
#[ignore = "needs an authenticated grok CLI, network and minutes"]
async fn grok_resumes_a_conversation() {
    live_resume("grok").await;
}

#[tokio::test]
#[ignore = "needs an authenticated codex CLI, network and minutes"]
async fn codex_resumes_a_conversation() {
    live_resume("codex").await;
}

#[tokio::test]
#[ignore = "needs an authenticated grok CLI, network and minutes"]
async fn grok_stop_settles_the_turn() {
    live_interrupt("grok").await;
}

#[tokio::test]
#[ignore = "needs an authenticated codex CLI, network and minutes"]
async fn codex_stop_settles_the_turn() {
    live_interrupt("codex").await;
}

#[tokio::test]
#[ignore = "needs an authenticated grok CLI, network and minutes"]
async fn grok_sends_an_image() {
    live_image("grok").await;
}

#[tokio::test]
#[ignore = "needs an authenticated codex CLI, network and minutes"]
async fn codex_sends_an_image() {
    live_image("codex").await;
}
