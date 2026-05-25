use std::{
    env,
    fs::{create_dir_all, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_API_PORT: u16 = 5180;
const PROTECTED_PORTS: [u16; 1] = [17891];
const DEFAULT_SAFETY_SCENARIOS_FLAG: &str = "0";

struct ManagedServer(Mutex<Option<Child>>);

#[tauri::command]
fn app_status() -> String {
    "NexusAPI Evaluator desktop shell is running.".to_string()
}

fn main() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_status])
        .setup(|app| {
            launch_window(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to run NexusAPI Evaluator");

    let app_handle = app.handle().clone();
    app.run(move |_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            stop_managed_server(&app_handle);
        }
    });
}

fn launch_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(dev_url) = env::var("NEXUSAPI_DESKTOP_DEV_URL") {
        create_main_window(app, &dev_url)?;
        return Ok(());
    }

    let resource_root = find_resource_root(app)?;
    let port = find_free_port(DEFAULT_API_PORT)?;
    let data_dir = portable_data_dir()?;
    let log_dir = data_dir.join("日志");
    create_dir_all(&log_dir)?;

    let node_path = find_node_path(&resource_root)?;
    let server_path = resource_root.join("server.mjs");
    let static_root = resource_root.join("dist");
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("desktop-server.log"))?;

    let mut command = Command::new(node_path);
    command
        .arg(server_path)
        .env("API_PORT", port.to_string())
        .env("PORT", port.to_string())
        .env(
            "NEXUSAPI_APP_ROOT",
            resource_root.to_string_lossy().to_string(),
        )
        .env(
            "NEXUSAPI_STATIC_DIR",
            static_root.to_string_lossy().to_string(),
        )
        .env("NEXUSAPI_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env(
            "NEXUSAPI_ENABLE_SAFETY_SCENARIOS",
            safety_scenarios_flag(),
        )
        .env("NO_PROXY", "*")
        .env("no_proxy", "*")
        .env_remove("all_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("http_proxy")
        .env_remove("HTTP_PROXY")
        .env_remove("https_proxy")
        .env_remove("HTTPS_PROXY")
        .env_remove("npm_config_proxy")
        .env_remove("npm_config_https_proxy")
        .env_remove("CARGO_HTTP_PROXY")
        .env_remove("CARGO_HTTPS_PROXY")
        .stdout(Stdio::from(log_file.try_clone()?))
        .stderr(Stdio::from(log_file));

    let child = command.spawn()?;
    wait_for_server(port, Duration::from_secs(12))?;
    app.manage(ManagedServer(Mutex::new(Some(child))));

    create_main_window(app, &format!("http://127.0.0.1:{port}"))?;
    Ok(())
}

fn safety_scenarios_flag() -> &'static str {
    match option_env!("NEXUSAPI_ENABLE_SAFETY_SCENARIOS") {
        Some("1") => "1",
        _ => DEFAULT_SAFETY_SCENARIOS_FLAG,
    }
}

fn create_main_window(app: &tauri::App, url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let url = Url::parse(url)?;
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("NexusAPI Evaluator")
        .inner_size(1280.0, 820.0)
        .min_inner_size(1080.0, 720.0)
        .build()?;
    Ok(())
}

fn stop_managed_server(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<ManagedServer>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn find_free_port(start: u16) -> Result<u16, Box<dyn std::error::Error>> {
    for port in start..start + 50 {
        if PROTECTED_PORTS.contains(&port) {
            continue;
        }
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("没有找到可用的本机通信端口。请关闭本工具后重新打开。".into())
}

fn wait_for_server(port: u16, timeout: Duration) -> Result<(), Box<dyn std::error::Error>> {
    let started_at = Instant::now();
    while started_at.elapsed() < timeout {
        if health_check(port).unwrap_or(false) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err("本地服务启动超时。请关闭本工具后重新打开；如果仍失败，把日志发给负责人。".into())
}

fn health_check(port: u16) -> std::io::Result<bool> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(Duration::from_millis(800)))?;
    stream
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response.contains("200 OK") && response.contains("nexusapi-evaluator-api"))
}

fn find_resource_root(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut candidates = Vec::new();
    candidates.push(app.path().resource_dir()?);

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
        }
        if let Some(app_parent) = app_bundle_parent(&exe) {
            candidates.push(app_parent);
        }
    }

    for candidate in candidates {
        if candidate.join("server.mjs").is_file() {
            return Ok(candidate);
        }
    }
    Err("没有找到应用资源文件。请重新解压完整安装包后再打开。".into())
}

fn app_bundle_parent(exe: &Path) -> Option<PathBuf> {
    for ancestor in exe.ancestors() {
        if ancestor.extension().and_then(|value| value.to_str()) == Some("app") {
            return ancestor.parent().map(Path::to_path_buf);
        }
    }
    None
}

fn find_node_path(resource_root: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let file_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let candidates = [
        resource_root.join("resources").join("bin").join(file_name),
        resource_root.join("bin").join(file_name),
    ];

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("没有找到内置运行环境。请重新下载完整安装包。".into())
}

fn portable_data_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(data_dir) = env::var("NEXUSAPI_DATA_DIR") {
        return Ok(PathBuf::from(data_dir));
    }

    let exe = env::current_exe()?;
    let mut base = exe.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();

    if cfg!(target_os = "macos") {
        for ancestor in exe.ancestors() {
            if ancestor.extension().and_then(|value| value.to_str()) == Some("app") {
                if let Some(parent) = ancestor.parent() {
                    base = parent.to_path_buf();
                }
                break;
            }
        }
    }

    Ok(base.join("NexusAPI数据"))
}
