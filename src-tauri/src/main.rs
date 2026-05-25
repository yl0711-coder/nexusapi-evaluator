#[tauri::command]
fn app_status() -> String {
    "NexusAPI Evaluator desktop shell is running.".to_string()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_status])
        .run(tauri::generate_context!())
        .expect("failed to run NexusAPI Evaluator");
}
