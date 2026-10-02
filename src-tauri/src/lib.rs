mod regulation;
mod icons;
mod error;

use error::{AppError, AppResult};

async fn run_regulation_task<T: Send + 'static>(task: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::diagnostic("errors.regulationTask", error))?
}

#[tauri::command]
async fn load_dataset(path: Option<String>) -> AppResult<regulation::Dataset> {
    run_regulation_task(move || regulation::load_dataset(path)).await
}

#[tauri::command]
async fn save_changes(input: Option<String>, output: String, patches: Vec<regulation::Patch>, additions: Option<Vec<regulation::RowAddition>>, removals: Option<Vec<regulation::RowRemoval>>, restorations: Option<Vec<i32>>) -> AppResult<String> {
    run_regulation_task(move || regulation::save_changes(input, output, patches, additions.unwrap_or_default(), removals.unwrap_or_default(), restorations.unwrap_or_default())).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![load_dataset, save_changes, icons::load_icon_config, icons::save_icon_config, icons::import_icon_config, icons::export_icon_config, icons::reload_icon_resources]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![load_dataset, save_changes, icons::load_icon_config]);
    builder
        .run(tauri::generate_context!())
        .expect("failed to run Nightreign Pattern Editor");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{future::Future, sync::{mpsc, Arc}, task::{Context, Poll, Wake, Waker}, time::Duration};

    struct NoopWake;
    impl Wake for NoopWake {
        fn wake(self: Arc<Self>) {}
    }

    #[test]
    fn regulation_work_yields_while_the_worker_is_busy() {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let task = run_regulation_task(move || {
            started_tx.send(std::thread::current().id()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            Ok(42)
        });
        let mut task = std::pin::pin!(task);
        let waker = Waker::from(Arc::new(NoopWake));
        assert!(matches!(task.as_mut().poll(&mut Context::from_waker(&waker)), Poll::Pending));
        let worker = started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_ne!(worker, std::thread::current().id());
        release_tx.send(()).unwrap();
        assert_eq!(tauri::async_runtime::block_on(task).unwrap(), 42);
    }

    #[test]
    fn regulation_worker_errors_preserve_diagnostics() {
        let error = tauri::async_runtime::block_on(run_regulation_task::<()>(|| {
            Err(AppError::new("errors.noChanges"))
        })).unwrap_err();
        assert_eq!(error.code, "errors.noChanges");
        let error = tauri::async_runtime::block_on(run_regulation_task::<()>(|| {
            panic!("worker failure")
        })).unwrap_err();
        assert_eq!(error.code, "errors.regulationTask");
        assert!(error.details.unwrap().contains("worker failure"));
    }
}
