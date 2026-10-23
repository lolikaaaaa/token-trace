use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "macos")]
use std::path::Path;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageWindow {
    used_percent: f64,
    remaining_percent: f64,
    window_duration_mins: u64,
    resets_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealUsage {
    primary: UsageWindow,
    secondary: Option<UsageWindow>,
    plan_type: Option<String>,
    source: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentTask {
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    token_count: Option<u64>,
    token_source: Option<&'static str>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardSnapshot {
    usage: RealUsage,
    tasks: Vec<RecentTask>,
    tasks_available: bool,
}

fn codex_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = env::var("CODEX_EXECUTABLE") {
        candidates.push(path.into());
    }
    #[cfg(target_os = "windows")]
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        let root = PathBuf::from(local_app_data);
        let bin = root.join("OpenAI").join("Codex").join("bin");
        if let Ok(entries) = fs::read_dir(bin) {
            let mut installed: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path().join("codex.exe"))
                .filter(|path| path.is_file())
                .collect();
            installed.sort();
            installed.reverse();
            candidates.extend(installed);
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = env::var("HOME") {
            let home = PathBuf::from(home);
            candidates.extend([
                home.join(".local/bin/codex"),
                home.join(".npm-global/bin/codex"),
                home.join(".bun/bin/codex"),
            ]);
        }
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/codex"),
            PathBuf::from("/usr/local/bin/codex"),
        ]);
        // The desktop app's internal layout may change between Codex releases.
        // Discover a bundled CLI instead of depending on a single guessed path.
        append_macos_app_candidates(
            Path::new("/Applications/Codex.app/Contents/Resources"),
            &mut candidates,
        );
        if let Ok(home) = env::var("HOME") {
            append_macos_app_candidates(
                &PathBuf::from(home).join("Applications/Codex.app/Contents/Resources"),
                &mut candidates,
            );
        }
    }
    #[cfg(target_os = "windows")]
    candidates.push("codex.exe".into());
    #[cfg(not(target_os = "windows"))]
    candidates.push("codex".into());
    candidates.dedup();
    candidates
}

#[cfg(target_os = "macos")]
fn append_macos_app_candidates(root: &Path, candidates: &mut Vec<PathBuf>) {
    if !root.is_dir() {
        return;
    }
    let mut stack = vec![(root.to_path_buf(), 0_u8)];
    while let Some((directory, depth)) = stack.pop() {
        if depth > 3 {
            continue;
        }
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push((path, depth + 1));
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if matches!(name, "codex" | "codex-cli") {
                candidates.push(path);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn profile_from_codex_binary(binary: &PathBuf) -> Option<PathBuf> {
    let text = binary.to_string_lossy();
    let lower = text.to_ascii_lowercase();
    let marker = "\\users\\";
    let index = lower.find(marker)?;
    let after = &text[index + marker.len()..];
    let user = after.split(['\\', '/']).next()?;
    Some(
        PathBuf::from(&text[..index])
            .join("Users")
            .join(user)
            .join(".codex"),
    )
}

#[cfg(not(target_os = "windows"))]
fn profile_from_codex_binary(_binary: &PathBuf) -> Option<PathBuf> {
    None
}

fn codex_home() -> Option<PathBuf> {
    if let Ok(executable) = env::current_exe() {
        if let Some(home) = profile_from_codex_binary(&executable) {
            if home.join("auth.json").is_file() {
                return Some(home);
            }
        }
    }
    if let Ok(home) = env::var("CODEX_HOME") {
        let path = PathBuf::from(home);
        let isolated = path
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("sandbox");
        if !isolated && path.join("auth.json").is_file() {
            return Some(path);
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(home) = env::var("HOME") {
        let path = PathBuf::from(home).join(".codex");
        if path.join("auth.json").is_file() {
            return Some(path);
        }
    }
    #[cfg(target_os = "windows")]
    if let Ok(profile) = env::var("USERPROFILE") {
        let path = PathBuf::from(profile).join(".codex");
        let isolated = path
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("sandbox");
        if !isolated && path.join("auth.json").is_file() {
            return Some(path);
        }
    }
    None
}

fn usage_window(value: &Value) -> Result<UsageWindow, String> {
    let used = value
        .get("usedPercent")
        .and_then(Value::as_f64)
        .ok_or("usedPercent is missing or not a number")?;
    let duration = value
        .get("windowDurationMins")
        .and_then(Value::as_u64)
        .ok_or("windowDurationMins is missing or not an integer")?;
    let resets_at = value
        .get("resetsAt")
        .and_then(Value::as_i64)
        .ok_or("resetsAt is missing or not Unix seconds")?;
    Ok(UsageWindow {
        used_percent: used,
        remaining_percent: (100.0 - used).clamp(0.0, 100.0),
        window_duration_mins: duration,
        resets_at,
    })
}

fn task_from_value(value: &Value) -> Option<RecentTask> {
    let id = value.get("id")?.as_str()?.to_owned();
    let title = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .or_else(|| value.get("preview").and_then(Value::as_str))
        .unwrap_or("未命名会话")
        .lines()
        .next()
        .unwrap_or("未命名会话")
        .trim()
        .to_owned();
    Some(RecentTask {
        id,
        title,
        created_at: value.get("createdAt")?.as_i64()?,
        updated_at: value.get("updatedAt")?.as_i64()?,
        token_count: None,
        token_source: None,
    })
}

fn estimated_thread_tokens(result: &Value) -> Option<u64> {
    let groups = result.pointer("/threadUsage/groups")?.as_array()?;
    let mut found = false;
    let total = groups
        .iter()
        .filter_map(|group| group.get("totalTokens").and_then(Value::as_u64))
        .inspect(|_| found = true)
        .sum();
    found.then_some(total)
}

fn fill_local_task_tokens(tasks: &mut [RecentTask], home: &PathBuf) {
    let root = home.join("sessions");
    if !root.is_dir() {
        return;
    }
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some(index) = tasks
                .iter()
                .position(|task| task.token_count.is_none() && name.contains(&task.id))
            else {
                continue;
            };
            let Ok(file) = fs::File::open(path) else {
                continue;
            };
            let mut latest = None;
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if !line.contains("\"type\":\"token_count\"") {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if let Some(tokens) = value
                        .pointer("/payload/info/total_token_usage/total_tokens")
                        .and_then(Value::as_u64)
                    {
                        latest = Some(tokens);
                    }
                }
            }
            if let Some(tokens) = latest {
                tasks[index].token_count = Some(tokens);
                tasks[index].token_source = Some("local-session");
            }
        }
    }
}

fn shared_dashboard_service() -> Result<DashboardSnapshot, String> {
    let mut child = None;
    let mut active_home = None;
    let mut last_error = "Codex is not installed".to_string();
    for candidate in codex_candidates() {
        let resolved = fs::canonicalize(&candidate).unwrap_or_else(|_| candidate.clone());
        let home = profile_from_codex_binary(&resolved).or_else(codex_home);
        let mut command = Command::new(&resolved);
        command
            .args(["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(value) = &home {
            command.env("CODEX_HOME", value);
        }
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000);
        match command.spawn() {
            Ok(process) => {
                active_home = home;
                child = Some(process);
                break;
            }
            Err(_) => last_error = "Codex App Server could not be started".into(),
        }
    }
    let mut child = child.ok_or(last_error)?;
    let mut stdin = child.stdin.take().ok_or("app-server stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("app-server stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("app-server stderr unavailable")?;
    let stderr_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = BufReader::new(stderr).read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).to_string()
    });
    for request in [
        r#"{"method":"initialize","id":1,"params":{"clientInfo":{"name":"token-trace","title":"Token Trace","version":"0.1.0"},"capabilities":{}}}"#,
        r#"{"method":"initialized","params":{}}"#,
        r#"{"method":"account/read","id":2,"params":{}}"#,
        r#"{"method":"account/rateLimits/read","id":3,"params":{}}"#,
        r#"{"method":"thread/list","id":4,"params":{"limit":100,"archived":false,"sortKey":"updated_at","sortDirection":"desc","useStateDbOnly":true}}"#,
    ] {
        writeln!(stdin, "{request}").map_err(|error| format!("JSON-RPC send failed: {error}"))?;
    }
    // Keep stdin alive until rateLimits/read responds. Closing it here was the original UI bug.
    let (stdout_tx, stdout_rx) = mpsc::channel();
    let stdout_thread = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let message = line.map_err(|_| "Codex output could not be read".to_string());
            if stdout_tx.send(message).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(18);
    let mut usage = None;
    let mut tasks: Option<Vec<RecentTask>> = None;
    let mut tasks_available = true;
    let mut task_requests: HashMap<i64, usize> = HashMap::new();
    let mut failure = None;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let line = match stdout_rx.recv_timeout(remaining) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => {
                failure = Some(error);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                failure = Some("Codex usage request timed out".into());
                break;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                failure = Some("Codex usage service ended before returning data".into());
                break;
            }
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match message.get("id").and_then(Value::as_i64) {
            Some(1) => {
                if message.get("error").is_some() {
                    failure = Some("Codex initialize failed".into());
                    break;
                }
            }
            Some(2) => {
                if message.get("error").is_some() {
                    failure = Some("Codex account request failed".into());
                    break;
                }
            }
            Some(3) => {
                if message.get("error").is_some() {
                    failure = Some("Codex usage request failed".into());
                    break;
                }
                let parsed = (|| -> Result<RealUsage, String> {
                    let result = message
                        .get("result")
                        .ok_or("rateLimits/read result missing")?;
                    let limits = result
                        .pointer("/rateLimitsByLimitId/codex")
                        .or_else(|| result.get("rateLimits"))
                        .ok_or("codex rate-limit bucket missing")?;
                    let primary =
                        usage_window(limits.get("primary").ok_or("primary window missing")?)?;
                    let secondary = limits
                        .get("secondary")
                        .filter(|value| !value.is_null())
                        .map(usage_window)
                        .transpose()?;
                    if secondary.is_none() {
                        return Err("secondary window missing".into());
                    }
                    Ok(RealUsage {
                        primary,
                        secondary,
                        plan_type: limits
                            .get("planType")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        source: "codex-app-server",
                    })
                })();
                match parsed {
                    Ok(dto) => usage = Some(dto),
                    Err(error) => failure = Some(error),
                }
                if failure.is_some() || (tasks.is_some() && task_requests.is_empty()) {
                    break;
                }
            }
            Some(4) => {
                if message.get("error").is_some() {
                    tasks = Some(Vec::new());
                    tasks_available = false;
                } else {
                    let parsed: Vec<RecentTask> = message
                        .pointer("/result/data")
                        .and_then(Value::as_array)
                        .map(|items| items.iter().filter_map(task_from_value).collect())
                        .unwrap_or_default();
                    for (index, task) in parsed.iter().take(12).enumerate() {
                        let request_id = 1000 + index as i64;
                        let request = serde_json::json!({"method":"account/usage/read","id":request_id,"params":{"threadId":task.id}});
                        if writeln!(stdin, "{request}").is_ok() {
                            task_requests.insert(request_id, index);
                        }
                    }
                    tasks = Some(parsed);
                }
                if usage.is_some() && task_requests.is_empty() {
                    break;
                }
            }
            Some(id) if id >= 1000 => {
                if let Some(index) = task_requests.remove(&id) {
                    if message.get("error").is_none() {
                        if let (Some(token_count), Some(items)) = (
                            message.get("result").and_then(estimated_thread_tokens),
                            tasks.as_mut(),
                        ) {
                            if let Some(task) = items.get_mut(index) {
                                task.token_count = Some(token_count);
                                task.token_source = Some("account-estimate");
                            }
                        }
                    }
                }
                if usage.is_some() && tasks.is_some() && task_requests.is_empty() {
                    break;
                }
            }
            _ => {}
        }
    }
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    if let Some(error) = failure {
        return Err(error);
    }
    let usage =
        usage.ok_or_else(|| "Codex usage service ended before returning data".to_string())?;
    let mut tasks = tasks.unwrap_or_default();
    if let Some(home) = active_home.as_ref() {
        fill_local_task_tokens(&mut tasks, home);
    }
    Ok(DashboardSnapshot {
        usage,
        tasks,
        tasks_available,
    })
}

#[tauri::command]
async fn get_dashboard_snapshot() -> Result<DashboardSnapshot, String> {
    tauri::async_runtime::spawn_blocking(shared_dashboard_service)
        .await
        .map_err(|_| "Dashboard worker stopped unexpectedly".to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_dashboard_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
