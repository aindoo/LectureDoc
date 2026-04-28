use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio as ProcStdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeta {
    pub filename: String,
    pub path: String,
    pub duration_secs: f64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Clone, Debug)]
pub struct FrameInfo {
    pub index: u32,
    pub filename: String,
    pub path: String,
    pub timestamp_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct HashesCache {
    version: u32,
    hashes: Vec<[u64; 4]>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FrameIndexEntry {
    filename: String,
    timestamp_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FrameIndex {
    version: u32,
    frames: Vec<FrameIndexEntry>,
}

// ─── Ldoc Types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LdocFrameSettings {
    pub interval_s: f64,
    pub diff_threshold: u32,
    pub manual_overrides: HashMap<String, String>,
}

impl Default for LdocFrameSettings {
    fn default() -> Self {
        Self { interval_s: 0.5, diff_threshold: 15, manual_overrides: HashMap::new() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LdocMetadata {
    pub version: u32,
    pub video_filename: String,
    pub video_path: String,
    pub duration_secs: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub extraction_interval_s: f64,
    pub total_frames: u32,
    /// "extracting" | "extracted" | "reviewed"
    pub status: String,
    pub created_at: u64,
    pub last_modified_at: u64,
    pub frame_settings: LdocFrameSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub path: String,
    pub video_filename: String,
    pub status: String,
    pub last_modified_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppManifest {
    pub version: u32,
    pub recent: Vec<ManifestEntry>,
}

// Stored inside the .ldoc zip as frames.json after the user confirms their selection
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StoredFrameLogPage {
    pub page: u32,
    pub timestamp_ms: u64,
    pub frame_file: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StoredFrameLog {
    pub version: u32,
    pub pages: Vec<StoredFrameLogPage>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LdocOpenResult {
    pub cache_dir: String,
    pub metadata: LdocMetadata,
    /// Present when the user has confirmed their frame selection (status = "reviewed")
    pub frame_log: Option<StoredFrameLog>,
}

// ─── Managed State ───────────────────────────────────────────────────────────

pub struct AppState {
    active_jobs: Arc<Mutex<HashSet<String>>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    zip_repack_mutex: Arc<Mutex<()>>,
    /// Path received from a file-association open before the frontend was ready.
    pending_open: Arc<Mutex<Option<String>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_jobs: Arc::new(Mutex::new(HashSet::new())),
            cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            zip_repack_mutex: Arc::new(Mutex::new(())),
            pending_open: Arc::new(Mutex::new(None)),
        }
    }
}

// ─── Binary resolution ───────────────────────────────────────────────────────

/// Locate a bundled sidecar binary.  Search order:
/// 1. Same directory as this executable (production sidecar location on macOS/Windows).
/// 2. Common Homebrew paths — lets the dev build work without copying binaries.
/// 3. Fall through to PATH.
fn find_bin(name: &str) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.exists() { return p; }
        }
    }
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let p = PathBuf::from(prefix).join(name);
        if p.exists() { return p; }
    }
    PathBuf::from(name)
}

// ─── Utilities ───────────────────────────────────────────────────────────────

fn parse_fps(s: &str) -> f64 {
    if let Some((n, d)) = s.split_once('/') {
        let n: f64 = n.parse().unwrap_or(30.0);
        let d: f64 = d.parse().unwrap_or(1.0);
        if d != 0.0 { n / d } else { 30.0 }
    } else {
        s.parse().unwrap_or(30.0)
    }
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn compute_ahash(img_path: &str) -> Result<[u64; 4], String> {
    let img = image::open(img_path).map_err(|e| e.to_string())?;
    let small = img.resize_exact(16, 16, FilterType::Triangle);
    let gray = small.to_luma8();
    let pixels: Vec<u8> = gray.pixels().map(|p| p[0]).collect(); // 256 pixels
    let sum: u32 = pixels.iter().map(|&p| p as u32).sum();
    let mean = sum / 256;
    let mut hash = [0u64; 4];
    for (i, &pixel) in pixels.iter().enumerate() {
        if (pixel as u32) > mean { hash[i / 64] |= 1u64 << (i % 64); }
    }
    Ok(hash)
}

fn hamming_distance(a: [u64; 4], b: [u64; 4]) -> u32 {
    a.iter().zip(b.iter()).map(|(&x, &y)| (x ^ y).count_ones()).sum()
}

fn save_hashes(frame_dir: &str, hashes: &[[u64; 4]]) {
    let path = format!("{}/hashes.json", frame_dir);
    let cache = HashesCache { version: 2, hashes: hashes.to_vec() };
    if let Ok(json) = serde_json::to_string(&cache) { let _ = std::fs::write(path, json); }
}

fn load_hashes(frame_dir: &str) -> Option<Vec<[u64; 4]>> {
    let content = std::fs::read_to_string(format!("{}/hashes.json", frame_dir)).ok()?;
    let cache = serde_json::from_str::<HashesCache>(&content).ok()?;
    if cache.version != 2 { return None; } // v1 was 8×8 u64 — force rehash
    Some(cache.hashes)
}

fn frame_pos_from_filename(name: &str) -> Option<u64> {
    name.strip_prefix("frame_")?.strip_suffix(".png")?.parse().ok()
}

fn deduplicate_frames(
    _frame_dir: &str,
    hashes: Vec<[u64; 4]>,
    all_files: &[String],
    interval_s: f64,
) -> (Vec<[u64; 4]>, FrameIndex) {
    let mut surviving_hashes = Vec::new();
    let mut index_entries = Vec::new();
    let mut prev_hash: Option<[u64; 4]> = None;

    for (hash, path) in hashes.iter().zip(all_files.iter()) {
        let filename = Path::new(path)
            .file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let is_dup = prev_hash.map_or(false, |p| hamming_distance(p, *hash) == 0);
        if is_dup {
            let _ = std::fs::remove_file(path);
        } else {
            let pos = frame_pos_from_filename(&filename).unwrap_or(1);
            let timestamp_ms = ((pos - 1) as f64 * interval_s * 1000.0).round() as u64;
            index_entries.push(FrameIndexEntry { filename, timestamp_ms });
            surviving_hashes.push(*hash);
            prev_hash = Some(*hash);
        }
    }
    (surviving_hashes, FrameIndex { version: 1, frames: index_entries })
}

fn sorted_png_files(dir: &str) -> Vec<String> {
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map_or(false, |ext| ext == "png"))
                .map(|e| e.path().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

fn probe_duration(video_path: &str) -> f64 {
    Command::new(find_bin("ffprobe"))
        .args(["-v", "quiet", "-print_format", "json", "-show_format", video_path])
        .output()
        .ok()
        .and_then(|o| serde_json::from_slice::<serde_json::Value>(&o.stdout).ok())
        .and_then(|j| j["format"]["duration"].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

fn get_app_manifest_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("manifest.json"))
}

fn read_app_manifest_inner(path: &Path) -> AppManifest {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(AppManifest { version: 1, recent: vec![] })
}

fn write_app_manifest_inner(path: &Path, manifest: &AppManifest) -> Result<(), String> {
    let json = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn read_ldoc_metadata_inner(cache_dir: &str) -> Result<LdocMetadata, String> {
    let meta_path = format!("{}/metadata.json", cache_dir);
    let content = std::fs::read_to_string(&meta_path)
        .map_err(|e| format!("Cannot read {}: {}", meta_path, e))?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid metadata.json: {}", e))
}

fn cleanup(
    active_jobs: &Arc<Mutex<HashSet<String>>>,
    cancel_flags: &Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    key: &str,
) {
    active_jobs.lock().unwrap().remove(key);
    cancel_flags.lock().unwrap().remove(key);
}

// ─── Zip / Cache Utilities ───────────────────────────────────────────────────

fn ldoc_cache_id(ldoc_path: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    ldoc_path.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn get_cache_dir(app: &tauri::AppHandle, ldoc_path: &str) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join("cache").join(ldoc_cache_id(ldoc_path)))
}

fn read_metadata_from_zip(ldoc_path: &str) -> Result<LdocMetadata, String> {
    let file = std::fs::File::open(ldoc_path)
        .map_err(|e| format!("Cannot open {}: {}", ldoc_path, e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Invalid zip: {}", e))?;
    let mut entry = archive.by_name("metadata.json")
        .map_err(|_| "No metadata.json in ldoc".to_string())?;
    let mut content = String::new();
    entry.read_to_string(&mut content).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid metadata.json: {}", e))
}

fn extract_zip_to_cache(ldoc_path: &str, cache_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(ldoc_path)
        .map_err(|e| format!("Cannot open {}: {}", ldoc_path, e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Invalid zip: {}", e))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().ends_with('/') { continue; }
        let out_path = cache_dir.join(entry.name());
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn pack_dir_into_zip(cache_dir: &Path, ldoc_path: &str) -> Result<(), String> {
    let tmp_path = format!("{}.tmp", ldoc_path);
    {
        let output = std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        let mut writer = zip::ZipWriter::new(output);
        let options = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        add_dir_to_zip(&mut writer, cache_dir, cache_dir, options)?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, ldoc_path).map_err(|e| e.to_string())
}

fn add_dir_to_zip(
    writer: &mut zip::ZipWriter<std::fs::File>,
    base: &Path,
    dir: &Path,
    options: zip::write::FileOptions,
) -> Result<(), String> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .collect();
    entries.sort();
    for path in entries {
        let rel = path.strip_prefix(base).map_err(|e| e.to_string())?;
        let name = rel.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            add_dir_to_zip(writer, base, &path, options)?;
        } else {
            writer.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
            let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, writer).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Repack the zip, replacing or adding a set of named JSON entries.
/// All other entries are copied verbatim (STORED — no decompression overhead).
fn repack_json_files(ldoc_path: &str, replacements: &[(String, String)]) -> Result<(), String> {
    let stored = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    let tmp_path = format!("{}.tmp", ldoc_path);
    {
        let input = std::fs::File::open(ldoc_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(input).map_err(|e| e.to_string())?;
        let output = std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        let mut zip_writer = zip::ZipWriter::new(output);
        let mut written: HashSet<String> = HashSet::new();

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            if let Some((_, content)) = replacements.iter().find(|(n, _)| n == &name) {
                zip_writer.start_file(&name, stored).map_err(|e| e.to_string())?;
                zip_writer.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
                written.insert(name);
            } else {
                zip_writer.start_file(name.as_str(), stored).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut zip_writer).map_err(|e| e.to_string())?;
            }
        }
        // Append any replacement entries that were not already in the zip
        for (name, content) in replacements {
            if !written.contains(name) {
                zip_writer.start_file(name.as_str(), stored).map_err(|e| e.to_string())?;
                zip_writer.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
            }
        }
        zip_writer.finish().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, ldoc_path).map_err(|e| e.to_string())
}

fn repack_metadata(ldoc_path: &str, metadata: &LdocMetadata) -> Result<(), String> {
    let json = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    repack_json_files(ldoc_path, &[("metadata.json".to_string(), json)])
}

/// Create a minimal stub zip with just metadata.json (used before extraction starts).
fn create_stub_zip(ldoc_path: &str, metadata: &LdocMetadata) -> Result<(), String> {
    let json = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    let file = std::fs::File::create(ldoc_path).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    writer.start_file("metadata.json", options).map_err(|e| e.to_string())?;
    writer.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Commands ────────────────────────────────────────────────────────────────

const VIDEO_EXTS: &[&str] = &[
    "mp4", "mov", "mkv", "avi", "webm", "m4v", "mpg", "mpeg", "wmv", "flv",
];

fn get_video_meta_inner(file_path: &str) -> Result<VideoMeta, String> {
    let output = Command::new(find_bin("ffprobe"))
        .args(["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file_path])
        .output()
        .map_err(|e| format!("ffprobe not found: {}. Please install FFmpeg.", e))?;

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;

    let duration = json["format"]["duration"]
        .as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);

    let video_stream = json["streams"].as_array()
        .and_then(|s| s.iter().find(|s| s["codec_type"].as_str() == Some("video")))
        .cloned();

    let (width, height, fps) = if let Some(stream) = video_stream {
        let w = stream["width"].as_u64().unwrap_or(0) as u32;
        let h = stream["height"].as_u64().unwrap_or(0) as u32;
        let fps = parse_fps(stream["r_frame_rate"].as_str().unwrap_or("30/1"));
        (w, h, fps)
    } else {
        (0, 0, 30.0)
    };

    let filename = Path::new(file_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();

    Ok(VideoMeta { filename, path: file_path.to_string(), duration_secs: duration, fps, width, height })
}

#[tauri::command]
fn list_videos_in_dir(folder_path: String) -> Result<Vec<VideoMeta>, String> {
    let entries = std::fs::read_dir(&folder_path).map_err(|e| e.to_string())?;
    let mut videos = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str())
                .map(|e| e.to_lowercase()).unwrap_or_default();
            if VIDEO_EXTS.contains(&ext.as_str()) {
                if let Ok(meta) = get_video_meta_inner(&path.to_string_lossy()) {
                    videos.push(meta);
                }
            }
        }
    }
    videos.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(videos)
}

#[tauri::command]
fn get_video_meta(file_path: String) -> Result<VideoMeta, String> {
    get_video_meta_inner(&file_path)
}

#[tauri::command]
fn get_ldoc_frame_dir(cache_dir: String) -> String {
    format!("{}/frames", cache_dir)
}

/// Read metadata for an ldoc file. Reads from cache if available, otherwise
/// reads metadata.json directly from the zip (fast, no extraction).
#[tauri::command]
fn read_ldoc_metadata(app: tauri::AppHandle, ldoc_path: String) -> Result<LdocMetadata, String> {
    let cache_dir = get_cache_dir(&app, &ldoc_path)?;
    if cache_dir.join("metadata.json").exists() {
        return read_ldoc_metadata_inner(&cache_dir.to_string_lossy());
    }
    if Path::new(&ldoc_path).exists() {
        return read_metadata_from_zip(&ldoc_path);
    }
    Err(format!("ldoc not found: {}", ldoc_path))
}

/// Persist updated frame settings into the cache and asynchronously repack the zip.
#[tauri::command]
fn save_ldoc_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    ldoc_path: String,
    frame_settings: LdocFrameSettings,
    status: String,
) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app, &ldoc_path)?;
    let mut meta = read_ldoc_metadata_inner(&cache_dir.to_string_lossy())?;
    meta.frame_settings = frame_settings;
    meta.status = status;
    meta.last_modified_at = unix_ms();
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(cache_dir.join("metadata.json"), json).map_err(|e| e.to_string())?;

    let repack_mutex = state.zip_repack_mutex.clone();
    let ldoc_path_clone = ldoc_path.clone();
    let meta_clone = meta.clone();
    std::thread::spawn(move || {
        let _lock = repack_mutex.lock().unwrap();
        let _ = repack_metadata(&ldoc_path_clone, &meta_clone);
    });

    Ok(())
}

#[tauri::command]
fn get_app_manifest(app: tauri::AppHandle) -> Result<AppManifest, String> {
    let path = get_app_manifest_path(&app)?;
    Ok(read_app_manifest_inner(&path))
}

#[tauri::command]
fn upsert_manifest_entry(
    app: tauri::AppHandle,
    entry: ManifestEntry,
) -> Result<(), String> {
    let path = get_app_manifest_path(&app)?;
    let mut manifest = read_app_manifest_inner(&path);
    manifest.recent.retain(|e| e.path != entry.path);
    manifest.recent.insert(0, entry);
    manifest.recent.truncate(10);
    write_app_manifest_inner(&path, &manifest)
}

/// Scan manifest entries and remove those whose .ldoc zip file no longer exists.
#[tauri::command]
fn scan_app_manifest(app: tauri::AppHandle) -> Result<AppManifest, String> {
    let path = get_app_manifest_path(&app)?;
    let mut manifest = read_app_manifest_inner(&path);
    let before = manifest.recent.len();
    manifest.recent.retain(|e| {
        let p = Path::new(&e.path);
        p.exists() && p.is_file()
    });
    if manifest.recent.len() != before {
        write_app_manifest_inner(&path, &manifest)?;
    }
    Ok(manifest)
}

/// Extract the ldoc zip to the runtime cache dir (if not already cached).
/// Returns the cache dir, metadata, and the bundled frame log if present.
#[tauri::command]
fn open_ldoc(app: tauri::AppHandle, ldoc_path: String) -> Result<LdocOpenResult, String> {
    let cache_dir = get_cache_dir(&app, &ldoc_path)?;
    if !cache_dir.join("metadata.json").exists() {
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        extract_zip_to_cache(&ldoc_path, &cache_dir)?;
    }
    let metadata = read_ldoc_metadata_inner(&cache_dir.to_string_lossy())?;
    let frame_log: Option<StoredFrameLog> = std::fs::read_to_string(cache_dir.join("frames.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    Ok(LdocOpenResult {
        cache_dir: cache_dir.to_string_lossy().to_string(),
        metadata,
        frame_log,
    })
}

/// Get the path to a thumbnail image for the library grid.
/// Uses the cached frames dir if available; otherwise extracts just the first
/// frame from the zip into a persistent thumbs directory.
#[tauri::command]
fn get_ldoc_thumbnail(app: tauri::AppHandle, ldoc_path: String) -> Result<Option<String>, String> {
    let cache_dir = get_cache_dir(&app, &ldoc_path)?;
    let frames_dir = cache_dir.join("frames");

    if frames_dir.exists() {
        return Ok(sorted_png_files(&frames_dir.to_string_lossy()).into_iter().next());
    }

    if !Path::new(&ldoc_path).exists() {
        return Ok(None);
    }

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let thumbs_dir = data_dir.join("thumbs");
    let thumb_path = thumbs_dir.join(format!("{}.png", ldoc_cache_id(&ldoc_path)));

    if thumb_path.exists() {
        return Ok(Some(thumb_path.to_string_lossy().to_string()));
    }

    std::fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;

    let file = std::fs::File::open(&ldoc_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut first_frame: Option<String> = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.starts_with("frames/") && name.ends_with(".png") {
            match &first_frame {
                None => first_frame = Some(name),
                Some(current) => { if &name < current { first_frame = Some(name); } }
            }
        }
    }

    if let Some(frame_name) = first_frame {
        let mut entry = archive.by_name(&frame_name).map_err(|e| e.to_string())?;
        let mut out = std::fs::File::create(&thumb_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        return Ok(Some(thumb_path.to_string_lossy().to_string()));
    }

    Ok(None)
}

#[tauri::command]
fn list_frame_files(frame_dir: String, interval_s: f64) -> Result<Vec<FrameInfo>, String> {
    // Use index.json when available (new ldocs with deduplication)
    let index_path = format!("{}/index.json", frame_dir);
    if let Ok(content) = std::fs::read_to_string(&index_path) {
        if let Ok(index) = serde_json::from_str::<FrameIndex>(&content) {
            return Ok(index.frames.into_iter().enumerate().map(|(i, e)| FrameInfo {
                index: (i + 1) as u32,
                path: format!("{}/{}", frame_dir, e.filename),
                filename: e.filename,
                timestamp_ms: e.timestamp_ms,
            }).collect());
        }
    }
    // Fallback: old ldoc without index.json — derive timestamps from sorted position
    let files = sorted_png_files(&frame_dir);
    Ok(files.into_iter().enumerate().map(|(i, path)| {
        let filename = Path::new(&path).file_name()
            .and_then(|n| n.to_str()).unwrap_or("").to_string();
        FrameInfo {
            index: (i + 1) as u32,
            filename,
            path,
            timestamp_ms: (i as f64 * interval_s * 1000.0).round() as u64,
        }
    }).collect())
}

#[tauri::command]
fn compute_diffs(frame_dir: String, frame_indices: Vec<usize>, mode: String) -> Result<Vec<u32>, String> {
    if frame_indices.is_empty() { return Ok(vec![]); }
    let all_files = sorted_png_files(&frame_dir);
    let all_hashes = if let Some(cached) = load_hashes(&frame_dir) {
        if cached.len() == all_files.len() { cached } else {
            let h: Vec<[u64; 4]> = all_files.iter().map(|p| compute_ahash(p).unwrap_or([0; 4])).collect();
            save_hashes(&frame_dir, &h); h
        }
    } else {
        let h: Vec<[u64; 4]> = all_files.iter().map(|p| compute_ahash(p).unwrap_or([0; 4])).collect();
        save_hashes(&frame_dir, &h); h
    };

    let continuous = mode == "continuous";
    let scores: Vec<u32> = frame_indices.iter().enumerate().map(|(subset_pos, &file_idx)| {
        let prev_idx = if continuous {
            if file_idx == 0 { return 100; }
            file_idx - 1
        } else {
            if subset_pos == 0 { return 100; }
            frame_indices[subset_pos - 1]
        };
        let a = all_hashes.get(prev_idx).copied().unwrap_or([0; 4]);
        let b = all_hashes.get(file_idx).copied().unwrap_or([0; 4]);
        hamming_distance(a, b) * 100 / 256
    }).collect();
    Ok(scores)
}

#[tauri::command]
fn get_first_frame_path(frame_dir: String) -> Result<Option<String>, String> {
    Ok(sorted_png_files(&frame_dir).into_iter().next())
}

// ─── Extraction ──────────────────────────────────────────────────────────────

#[tauri::command]
fn start_extraction(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    ldoc_path: String,
    video_path: String,
    interval_s: f64,
    duration_secs: f64,
) -> Result<String, String> {
    let cache_dir = get_cache_dir(&app, &ldoc_path)?;

    {
        let mut jobs = state.active_jobs.lock().unwrap();
        if jobs.contains(&ldoc_path) {
            return Err(format!("{} is already being extracted", ldoc_path));
        }
        jobs.insert(ldoc_path.clone());
    }

    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let video_filename = Path::new(&video_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();

    let init_meta = LdocMetadata {
        version: 1,
        video_filename: video_filename.clone(),
        video_path: video_path.clone(),
        duration_secs,
        width: 0, height: 0, fps: 0.0,
        extraction_interval_s: interval_s,
        total_frames: 0,
        status: "extracting".to_string(),
        created_at: unix_ms(),
        last_modified_at: unix_ms(),
        frame_settings: LdocFrameSettings::default(),
    };

    if let Ok(json) = serde_json::to_string_pretty(&init_meta) {
        let _ = std::fs::write(cache_dir.join("metadata.json"), &json);
    }

    // Create stub zip immediately so the manifest scan can find the .ldoc file
    create_stub_zip(&ldoc_path, &init_meta)?;

    let cancel_flag = {
        let flag = Arc::new(AtomicBool::new(false));
        state.cancel_flags.lock().unwrap().insert(ldoc_path.clone(), flag.clone());
        flag
    };

    let cache_dir_str = cache_dir.to_string_lossy().to_string();
    let active_jobs = state.active_jobs.clone();
    let cancel_flags = state.cancel_flags.clone();
    let cache_dir_thread = cache_dir_str.clone();
    std::thread::spawn(move || {
        run_extraction(app, active_jobs, cancel_flags, ldoc_path, video_path, interval_s, duration_secs, cancel_flag, cache_dir_thread);
    });

    Ok(cache_dir_str)
}

#[tauri::command]
fn cancel_extraction(
    state: tauri::State<'_, AppState>,
    ldoc_path: String,
) -> Result<(), String> {
    if let Some(flag) = state.cancel_flags.lock().unwrap().get(&ldoc_path) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn run_extraction(
    app: tauri::AppHandle,
    active_jobs: Arc<Mutex<HashSet<String>>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    ldoc_path: String,
    video_path: String,
    interval_s: f64,
    duration_secs: f64,
    cancel_flag: Arc<AtomicBool>,
    cache_dir: String,
) {
    let cache_path = PathBuf::from(&cache_dir);
    let frame_dir = format!("{}/frames", cache_dir);
    let video_filename = Path::new(&video_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();

    let duration_secs = { let p = probe_duration(&video_path); if p > 0.0 { p } else { duration_secs } };

    let emit_err = |msg: &str| {
        app.emit("extraction:error", serde_json::json!({
            "ldocPath": ldoc_path,
            "videoFilename": video_filename,
            "error": msg,
        })).ok();
    };

    if std::fs::create_dir_all(&frame_dir).is_err() {
        emit_err("Failed to create frames directory");
        cleanup(&active_jobs, &cancel_flags, &ldoc_path);
        return;
    }

    // Update metadata with real video dimensions
    let video_meta = get_video_meta_inner(&video_path).ok();
    let (w, h, fps) = video_meta.as_ref().map(|m| (m.width, m.height, m.fps)).unwrap_or((0, 0, 30.0));
    let init_meta = LdocMetadata {
        version: 1,
        video_filename: video_filename.clone(),
        video_path: video_path.clone(),
        duration_secs,
        width: w, height: h, fps,
        extraction_interval_s: interval_s,
        total_frames: 0,
        status: "extracting".to_string(),
        created_at: unix_ms(),
        last_modified_at: unix_ms(),
        frame_settings: LdocFrameSettings::default(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&init_meta) {
        let _ = std::fs::write(cache_path.join("metadata.json"), json);
    }

    let fps_val = 1.0 / interval_s;
    let output_pattern = format!("{}/frame_%08d.png", frame_dir);
    let fps_str = format!("{:.6}", fps_val);

    let child_result = Command::new(find_bin("ffmpeg"))
        .args(["-i", &video_path, "-vf", &format!("fps={}", fps_str), "-f", "image2", &output_pattern, "-y"])
        .stdout(ProcStdio::null()).stderr(ProcStdio::null())
        .spawn();

    let mut child = match child_result {
        Ok(c) => c,
        Err(e) => {
            emit_err(&format!("Failed to start FFmpeg: {}. Install FFmpeg and ensure it is in PATH.", e));
            cleanup(&active_jobs, &cancel_flags, &ldoc_path);
            return;
        }
    };

    let total_frames = (duration_secs / interval_s).ceil() as u64;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            child.kill().ok();
            cleanup(&active_jobs, &cancel_flags, &ldoc_path);
            return;
        }
        let count = std::fs::read_dir(&frame_dir)
            .map(|e| e.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map_or(false, |x| x == "png"))
                .count() as u64)
            .unwrap_or(0);
        let progress = if total_frames > 0 { (count * 100 / total_frames).min(99) } else { 50 };
        app.emit("extraction:progress", serde_json::json!({
            "ldocPath": ldoc_path,
            "videoFilename": video_filename,
            "progress": progress,
            "frameCount": count,
            "totalFrames": total_frames,
            "phase": "extracting",
        })).ok();
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    emit_err("FFmpeg extraction failed. Is the video file valid?");
                    cleanup(&active_jobs, &cancel_flags, &ldoc_path);
                    return;
                }
                break;
            }
            Ok(None) => { std::thread::sleep(std::time::Duration::from_millis(500)); }
            Err(e) => {
                emit_err(&format!("FFmpeg process error: {}", e));
                cleanup(&active_jobs, &cancel_flags, &ldoc_path);
                return;
            }
        }
    }
    let _ = child.wait();

    // Phase 2: compute hashes + deduplicate consecutive identical frames
    let all_files = sorted_png_files(&frame_dir);
    let raw_total = all_files.len() as u32;
    app.emit("extraction:progress", serde_json::json!({
        "ldocPath": ldoc_path,
        "videoFilename": video_filename,
        "progress": 99, "frameCount": raw_total, "totalFrames": raw_total, "phase": "hashing",
    })).ok();
    let raw_hashes: Vec<[u64; 4]> = all_files.iter().map(|p| compute_ahash(p).unwrap_or([0; 4])).collect();
    let (surviving_hashes, frame_index) = deduplicate_frames(&frame_dir, raw_hashes, &all_files, interval_s);
    let total = surviving_hashes.len() as u32;
    save_hashes(&frame_dir, &surviving_hashes);
    // Write frames/index.json — authoritative mapping of surviving filenames → timestamps
    let index_path = format!("{}/index.json", frame_dir);
    if let Ok(json) = serde_json::to_string(&frame_index) { let _ = std::fs::write(index_path, json); }

    // Finalise metadata in cache
    let mut final_meta = read_ldoc_metadata_inner(&cache_dir).unwrap_or(init_meta);
    final_meta.total_frames = total;
    final_meta.status = "extracted".to_string();
    final_meta.last_modified_at = unix_ms();
    if let Ok(json) = serde_json::to_string_pretty(&final_meta) {
        let _ = std::fs::write(cache_path.join("metadata.json"), json);
    }

    // Phase 3: pack all frames into the zip
    app.emit("extraction:progress", serde_json::json!({
        "ldocPath": ldoc_path,
        "videoFilename": video_filename,
        "progress": 99, "frameCount": total, "totalFrames": total, "phase": "packing",
    })).ok();

    if let Err(e) = pack_dir_into_zip(&cache_path, &ldoc_path) {
        emit_err(&format!("Failed to pack ldoc: {}", e));
        cleanup(&active_jobs, &cancel_flags, &ldoc_path);
        return;
    }

    app.emit("extraction:complete", serde_json::json!({
        "ldocPath": ldoc_path,
        "videoFilename": video_filename,
        "totalFrames": total,
        "cacheDir": cache_dir,
    })).ok();

    cleanup(&active_jobs, &cancel_flags, &ldoc_path);
}

/// Write frames.json into the ldoc and set status = "reviewed".
/// Called when the user confirms their frame selection in Edit Frames.
#[tauri::command]
fn save_ldoc_frame_log(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    ldoc_path: String,
    pages: Vec<StoredFrameLogPage>,
    frame_settings: LdocFrameSettings,
) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app, &ldoc_path)?;

    let frame_log = StoredFrameLog { version: 1, pages };
    let frame_log_json = serde_json::to_string_pretty(&frame_log).map_err(|e| e.to_string())?;
    std::fs::write(cache_dir.join("frames.json"), &frame_log_json).map_err(|e| e.to_string())?;

    let mut meta = read_ldoc_metadata_inner(&cache_dir.to_string_lossy())?;
    meta.frame_settings = frame_settings;
    meta.status = "reviewed".to_string();
    meta.last_modified_at = unix_ms();
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(cache_dir.join("metadata.json"), &meta_json).map_err(|e| e.to_string())?;

    let repack_mutex = state.zip_repack_mutex.clone();
    let ldoc_path_clone = ldoc_path.clone();
    let meta_json_clone = meta_json.clone();
    let frame_log_json_clone = frame_log_json.clone();
    std::thread::spawn(move || {
        let _lock = repack_mutex.lock().unwrap();
        let _ = repack_json_files(&ldoc_path_clone, &[
            ("metadata.json".to_string(), meta_json_clone),
            ("frames.json".to_string(), frame_log_json_clone),
        ]);
    });

    Ok(())
}

// ─── Pending-open (file association) ─────────────────────────────────────────

#[tauri::command]
fn consume_pending_open(state: tauri::State<'_, AppState>) -> Option<String> {
    state.pending_open.lock().unwrap().take()
}

// ─── Open external URL ───────────────────────────────────────────────────────

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_videos_in_dir,
            get_video_meta,
            get_ldoc_frame_dir,
            read_ldoc_metadata,
            save_ldoc_settings,
            get_app_manifest,
            upsert_manifest_entry,
            scan_app_manifest,
            open_ldoc,
            get_ldoc_thumbnail,
            list_frame_files,
            compute_diffs,
            get_first_frame_path,
            start_extraction,
            cancel_extraction,
            save_ldoc_frame_log,
            consume_pending_open,
            open_external_url,
        ])
        .build(tauri::generate_context!())
        .expect("error building Lecture Doc")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    // to_file_path() decodes percent-encoding so the path is
                    // usable directly as a filesystem path (handles spaces etc.)
                    if let Ok(file_path) = url.to_file_path() {
                        let path = file_path.to_string_lossy().to_string();
                        if path.ends_with(".ldoc") {
                            if let Some(state) = app_handle.try_state::<AppState>() {
                                *state.pending_open.lock().unwrap() = Some(path.clone());
                            }
                            app_handle.emit("open-ldoc-file", &path).ok();
                            break;
                        }
                    }
                }
            }
            let _ = event;
        });
}
