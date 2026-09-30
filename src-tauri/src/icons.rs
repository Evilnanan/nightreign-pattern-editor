use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, fs, io::Write, path::Path};
use tauri::{AppHandle, Manager};

const NAMES: &str = include_str!("../../data/pattern_names.csv");
const CONFIG_FILE: &str = "icon-mapping.json";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconResource {
    name: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconResources {
    path: String,
    icons: Vec<IconResource>,
}

fn icon_mime(name: &str) -> Option<&'static str> {
    match name.rsplit_once('.')?.1.to_ascii_lowercase().as_str() {
        "webp" => Some("image/webp"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        _ => None,
    }
}

fn valid_icon_name(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(stem, _)| !stem.is_empty()) && icon_mime(name).is_some() &&
        !name.chars().any(|ch| ch == '/' || ch == '\\' || ch == ':' || ch.is_control())
}

fn read_icon_resources(directory: &Path) -> AppResult<IconResources> {
    let path = directory.canonicalize().map_err(|e| AppError::contextual("errors.iconDirectoryMissing", serde_json::json!({"path": directory.display().to_string()}), e))?;
    if !path.is_dir() { return Err(AppError::params("errors.iconDirectoryInvalid", serde_json::json!({"path": path.display().to_string()}))); }
    let mut entries = fs::read_dir(&path).map_err(|e| AppError::diagnostic("errors.iconDirectoryRead", e))?
        .map(|entry| entry.map_err(|e| AppError::diagnostic("errors.iconOperation", e))).collect::<AppResult<Vec<_>>>()?;
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    let mut icons = Vec::new();
    for entry in entries {
        if !entry.file_type().map_err(|e| AppError::diagnostic("errors.iconOperation", e))?.is_file() { continue; }
        let name = entry.file_name().into_string().map_err(|_| AppError::new("errors.iconFilenameEncoding"))?;
        let Some(mime) = icon_mime(&name) else { continue; };
        if !valid_icon_name(&name) { return Err(AppError::params("errors.iconFilename", serde_json::json!({"file": name}))); }
        let bytes = fs::read(entry.path()).map_err(|e| AppError::contextual("errors.iconRead", serde_json::json!({"file": name}), e))?;
        let valid = match mime {
            "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
            "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
            _ => false,
        };
        if !valid {
            return Err(AppError::params("errors.iconFormat", serde_json::json!({"file": name})));
        }
        icons.push(IconResource { name, data_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)) });
    }
    if icons.is_empty() { return Err(AppError::params("errors.iconDirectoryEmpty", serde_json::json!({"path": path.display().to_string()}))); }
    Ok(IconResources { path: path.display().to_string(), icons })
}

#[tauri::command]
pub fn reload_icon_resources() -> AppResult<IconResources> {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("public").join("icons");
    read_icon_resources(&directory)
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IconConfig {
    pub schema_version: u8,
    pub unit_icons: HashMap<String, Option<String>>,
    pub variant_icons: HashMap<String, Option<String>>,
    #[serde(default)]
    pub unit_badges: HashMap<String, String>,
    #[serde(default)]
    pub variant_badges: HashMap<String, Option<String>>,
    #[serde(default)]
    pub unit_badge_styles: HashMap<String, BadgeStyle>,
    #[serde(default)]
    pub variant_badge_styles: HashMap<String, BadgeStyle>,
    #[serde(default)]
    pub unit_icon_frames: HashMap<String, bool>,
    #[serde(default)]
    pub variant_icon_frames: HashMap<String, bool>,
    #[serde(default)]
    pub unit_icon_glows: HashMap<String, bool>,
    #[serde(default)]
    pub variant_icon_glows: HashMap<String, bool>,
    #[serde(default)]
    pub unit_icon_shadows: HashMap<String, bool>,
    #[serde(default)]
    pub variant_icon_shadows: HashMap<String, bool>,
    #[serde(default)]
    pub unit_icon_scales: HashMap<String, u16>,
    #[serde(default)]
    pub variant_icon_scales: HashMap<String, u16>,
    #[serde(default = "default_map_icon_scales")]
    pub map_icon_scales: HashMap<String, u16>,
    #[serde(default)]
    pub unit_map_icon_scales: HashMap<String, u16>,
    #[serde(default)]
    pub variant_map_icon_scales: HashMap<String, u16>,
    #[serde(default)]
    pub file_icon_styles: HashMap<String, FileIconStyle>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileIconStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glow: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<u16>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BadgeStyle {
    pub size: u8,
    pub frame: bool,
    #[serde(default)]
    pub glow: bool,
    #[serde(default = "default_icon_scale")]
    pub scale: u16,
}

fn default_icon_scale() -> u16 { 100 }

fn default_map_icon_scales() -> HashMap<String, u16> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Defaults { map_icon_scales: HashMap<String, u16> }
    serde_json::from_str::<Defaults>(include_str!("../../data/icon-mapping.json"))
        .expect("valid bundled map icon scales").map_icon_scales
}

impl IconConfig {
    #[cfg(test)]
    fn empty() -> Self {
        Self { schema_version: 10, map_icon_scales: default_map_icon_scales(), ..Self::default() }
    }

    fn validate(&self) -> AppResult<()> {
        if !(1..=10).contains(&self.schema_version) { return Err(AppError::new("errors.iconConfigVersion")); }
        let mut ids = HashSet::new();
        let mut variants = HashSet::new();
        let mut reader = csv::Reader::from_reader(NAMES.as_bytes());
        for row in reader.records() {
            let row = row.map_err(|e| AppError::diagnostic("errors.iconOperation", e))?;
            if &row[0] != "spot" || row[4].is_empty() { continue; }
            ids.insert(row[1].to_string());
            variants.insert(format!("{}|{}", &row[1], &row[2]));
        }
        for (key, file) in &self.unit_icons {
            if !ids.contains(key) { return Err(AppError::params("errors.unknownUnit", serde_json::json!({"unitId": key}))); }
            if let Some(file) = file {
                if !valid_icon_name(file) { return Err(AppError::params("errors.iconFilename", serde_json::json!({"file": file}))); }
            }
        }
        for (key, file) in &self.variant_icons {
            if !variants.contains(key) { return Err(AppError::params("errors.unknownVariant", serde_json::json!({"variant": key}))); }
            if let Some(file) = file {
                if !valid_icon_name(file) { return Err(AppError::params("errors.iconFilename", serde_json::json!({"file": file}))); }
            }
        }
        for (key, file) in &self.unit_badges {
            if !ids.contains(key) { return Err(AppError::params("errors.unknownUnit", serde_json::json!({"unitId": key}))); }
            if !valid_icon_name(file) { return Err(AppError::params("errors.badgeFilename", serde_json::json!({"file": file}))); }
        }
        for (key, file) in &self.variant_badges {
            if !variants.contains(key) { return Err(AppError::params("errors.unknownVariant", serde_json::json!({"variant": key}))); }
            if let Some(file) = file {
                if !valid_icon_name(file) { return Err(AppError::params("errors.badgeFilename", serde_json::json!({"file": file}))); }
            }
        }
        for (key, style) in &self.unit_badge_styles {
            if !ids.contains(key) { return Err(AppError::params("errors.unknownUnit", serde_json::json!({"unitId": key}))); }
            if !(20..=100).contains(&style.size) { return Err(AppError::params("errors.badgeSize", serde_json::json!({"unit": key}))); }
            if !(20..=300).contains(&style.scale) { return Err(AppError::params("errors.badgeScale", serde_json::json!({"unit": key}))); }
        }
        for (key, style) in &self.variant_badge_styles {
            if !variants.contains(key) { return Err(AppError::params("errors.unknownVariant", serde_json::json!({"variant": key}))); }
            if !(20..=100).contains(&style.size) { return Err(AppError::params("errors.badgeSize", serde_json::json!({"unit": key}))); }
            if !(20..=300).contains(&style.scale) { return Err(AppError::params("errors.badgeScale", serde_json::json!({"unit": key}))); }
        }
        for key in self.unit_icon_frames.keys().chain(self.unit_icon_glows.keys()).chain(self.unit_icon_shadows.keys()).chain(self.unit_icon_scales.keys()).chain(self.unit_map_icon_scales.keys()) {
            if !ids.contains(key) { return Err(AppError::params("errors.unknownUnit", serde_json::json!({"unitId": key}))); }
        }
        for key in self.variant_icon_frames.keys().chain(self.variant_icon_glows.keys()).chain(self.variant_icon_shadows.keys()).chain(self.variant_icon_scales.keys()).chain(self.variant_map_icon_scales.keys()) {
            if !variants.contains(key) { return Err(AppError::params("errors.unknownVariant", serde_json::json!({"variant": key}))); }
        }
        for (key, scale) in self.unit_icon_scales.iter().chain(self.variant_icon_scales.iter()) {
            if !(20..=300).contains(scale) { return Err(AppError::params("errors.iconScale", serde_json::json!({"unit": key}))); }
        }
        let mut filenames = HashSet::new();
        for keys in [self.map_icon_scales.keys().collect::<Vec<_>>(), self.file_icon_styles.keys().collect::<Vec<_>>()] {
            filenames.clear();
            for key in keys {
                if !valid_icon_name(&format!("{key}.webp")) || !filenames.insert(key.to_lowercase()) {
                    return Err(AppError::params("errors.iconFilename", serde_json::json!({"file": key})));
                }
            }
        }
        for (key, scale) in self.map_icon_scales.iter().chain(self.unit_map_icon_scales.iter()).chain(self.variant_map_icon_scales.iter()) {
            if !(20..=300).contains(scale) { return Err(AppError::params("errors.mapIconScale", serde_json::json!({"unit": key}))); }
        }
        for (key, style) in &self.file_icon_styles {
            if style.size.is_some_and(|size| !(20..=100).contains(&size)) { return Err(AppError::params("errors.badgeSize", serde_json::json!({"unit": key}))); }
            if style.scale.is_some_and(|scale| !(20..=300).contains(&scale)) { return Err(AppError::params("errors.iconScale", serde_json::json!({"unit": key}))); }
        }
        Ok(())
    }

    fn into_current(mut self) -> AppResult<Self> {
        self.validate()?;
        self.map_icon_scales = self.map_icon_scales.into_iter().map(|(key, value)| (key.to_lowercase(), value)).collect();
        self.file_icon_styles = self.file_icon_styles.into_iter().map(|(key, value)| (key.to_lowercase(), value)).collect();
        self.schema_version = 10;
        Ok(self)
    }
}

fn config_path(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let directory = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
    } else {
        app.path().resource_dir().map_err(|e| AppError::diagnostic("errors.iconOperation", e))?
    };
    Ok(directory.join("data").join(CONFIG_FILE))
}

fn write_json(path: &Path, config: &IconConfig) -> AppResult<()> {
    let parent = path.parent().ok_or(AppError::new("errors.outputParent"))?;
    fs::create_dir_all(parent).map_err(|e| AppError::diagnostic("errors.iconConfigDirectory", e))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| AppError::diagnostic("errors.iconConfigTemporaryFile", e))?;
    let mut stable = config.clone();
    // Map iteration order is not stable, so sort the exported JSON by key.
    let ordered = serde_json::json!({
        "schemaVersion": stable.schema_version,
        "unitIcons": stable.unit_icons.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantIcons": stable.variant_icons.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "unitBadges": stable.unit_badges.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantBadges": stable.variant_badges.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "unitBadgeStyles": stable.unit_badge_styles.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantBadgeStyles": stable.variant_badge_styles.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "unitIconFrames": stable.unit_icon_frames.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantIconFrames": stable.variant_icon_frames.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "unitIconGlows": stable.unit_icon_glows.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantIconGlows": stable.variant_icon_glows.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "unitIconShadows": stable.unit_icon_shadows.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantIconShadows": stable.variant_icon_shadows.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "unitIconScales": stable.unit_icon_scales.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantIconScales": stable.variant_icon_scales.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "mapIconScales": stable.map_icon_scales.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "unitMapIconScales": stable.unit_map_icon_scales.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "variantMapIconScales": stable.variant_map_icon_scales.drain().collect::<std::collections::BTreeMap<_, _>>(),
        "fileIconStyles": stable.file_icon_styles.drain().collect::<std::collections::BTreeMap<_, _>>()
    });
    serde_json::to_writer_pretty(&mut temp, &ordered).map_err(|e| AppError::diagnostic("errors.iconConfigSerialize", e))?;
    temp.write_all(b"\n").map_err(|e| AppError::diagnostic("errors.iconOperation", e))?;
    temp.flush().map_err(|e| AppError::diagnostic("errors.iconOperation", e))?;
    temp.persist(path).map_err(|e| AppError::diagnostic("errors.iconConfigWrite", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_icon_config(app: AppHandle) -> AppResult<IconConfig> {
    let path = config_path(&app)?;
    let text = fs::read_to_string(&path).map_err(|e| AppError::contextual("errors.iconConfigRead", serde_json::json!({"path": path.display().to_string()}), e))?;
    let config: IconConfig = serde_json::from_str(&text).map_err(|e| AppError::diagnostic("errors.iconConfigParse", e))?;
    config.into_current()
}

#[tauri::command]
pub fn save_icon_config(app: AppHandle, config: IconConfig) -> AppResult<()> {
    write_json(&config_path(&app)?, &config.into_current()?)
}

#[tauri::command]
pub fn import_icon_config(app: AppHandle, path: String) -> AppResult<IconConfig> {
    let text = fs::read_to_string(&path).map_err(|e| AppError::diagnostic("errors.iconConfigImportRead", e))?;
    let config: IconConfig = serde_json::from_str(&text).map_err(|e| AppError::diagnostic("errors.iconConfigImportParse", e))?;
    let config = config.into_current()?;
    write_json(&config_path(&app)?, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn export_icon_config(app: AppHandle, path: String) -> AppResult<()> {
    let config = load_icon_config(app)?;
    write_json(Path::new(&path), &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_unit_keys_and_preserves_missing_files() {
        let mut config = IconConfig::empty();
        config.unit_icons.insert("4100".into(), Some("4100.webp".into()));
        config.unit_icons.insert("4652".into(), Some("Boss.webp".into()));
        config.variant_icons.insert("4652|0".into(), Some("Boss.webp".into()));
        config.variant_icons.insert("4101|1".into(), Some("Boss.webp".into()));
        config.unit_badges.insert("4100".into(), "Magic.webp".into());
        config.variant_badges.insert("4100|0".into(), None);
        assert!(config.validate().is_ok());
        config.unit_icons.insert("4100".into(), Some("Removed.webp".into()));
        assert!(config.validate().is_ok());
        config.unit_icons.insert("4100".into(), Some("../Outside.webp".into()));
        assert!(config.validate().is_err());
        config.unit_icons.insert("4100".into(), Some("Castle.webp".into()));
        config.variant_icons.insert("9999|0".into(), Some("Boss.webp".into()));
        assert!(config.validate().is_err());
    }

    #[test]
    fn upgrades_existing_icon_config_without_badges() {
        let old = r#"{"schemaVersion":1,"unitIcons":{"4100":"Castle.webp"},"variantIcons":{}}"#;
        let config: IconConfig = serde_json::from_str(old).unwrap();
        let config = config.into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert_eq!(config.unit_icons.get("4100").and_then(Option::as_deref), Some("Castle.webp"));
        assert!(config.unit_badges.is_empty());
        assert!(config.variant_badges.is_empty());
        assert!(config.unit_badge_styles.is_empty());
        assert!(config.variant_badge_styles.is_empty());
        assert!(config.unit_icon_frames.is_empty());
        assert!(config.variant_icon_frames.is_empty());
    }

    #[test]
    fn preserves_explicit_no_badge_on_json_round_trip() {
        let mut config = IconConfig::empty();
        config.unit_badges.insert("3000".into(), "Magic.webp".into());
        config.variant_badges.insert("3000|1".into(), None);
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"3000|1\":null"));
        let restored: IconConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.unit_badges.get("3000").map(String::as_str), Some("Magic.webp"));
        assert_eq!(restored.variant_badges.get("3000|1"), Some(&None));
        assert!(restored.validate().is_ok());
    }

    #[test]
    fn rereads_icon_directory_after_files_change() {
        let dir = tempfile::tempdir().unwrap();
        let webp_header = b"RIFF\0\0\0\0WEBP";
        fs::write(dir.path().join("Magic.webp"), webp_header).unwrap();
        let first = read_icon_resources(dir.path()).unwrap();
        assert_eq!(first.icons.len(), 1);
        fs::write(dir.path().join("New Icon.webp"), webp_header).unwrap();
        fs::remove_file(dir.path().join("Magic.webp")).unwrap();
        let second = read_icon_resources(dir.path()).unwrap();
        assert_eq!(second.icons.len(), 1);
        assert_eq!(second.icons[0].name, "New Icon.webp");
    }

    #[test]
    fn reads_mixed_image_formats_with_matching_mime_types() {
        let dir = tempfile::tempdir().unwrap();
        let images: [(&str, &[u8], &str); 4] = [
            ("Existing.webp", b"RIFF\0\0\0\0WEBP", "image/webp"),
            ("a.PNG", b"\x89PNG\r\n\x1a\n", "image/png"),
            ("Merchant.jpg", b"\xff\xd8\xff\xe0", "image/jpeg"),
            ("3000.JPEG", b"\xff\xd8\xff\xe1", "image/jpeg"),
        ];
        for (name, bytes, _) in images { fs::write(dir.path().join(name), bytes).unwrap(); }
        fs::write(dir.path().join("Notes.txt"), "ignored").unwrap();
        fs::create_dir(dir.path().join("Folder.png")).unwrap();
        let resources = read_icon_resources(dir.path()).unwrap();
        assert_eq!(resources.icons.len(), images.len());
        for (name, bytes, mime) in images {
            let icon = resources.icons.iter().find(|icon| icon.name == name).unwrap();
            assert_eq!(icon.data_url, format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
        }
        fs::write(dir.path().join("Wrong.png"), b"RIFF\0\0\0\0WEBP").unwrap();
        let error = read_icon_resources(dir.path()).err().unwrap();
        assert_eq!(error.code, "errors.iconFormat");
        assert_eq!(error.params["file"], "Wrong.png");
    }

    #[test]
    fn persists_png_and_jpeg_body_and_badge_overrides() {
        let mut config = IconConfig::empty();
        config.unit_icons.insert("3000".into(), Some("a.png".into()));
        config.variant_icons.insert("3000|1".into(), Some("Custom.JPG".into()));
        config.unit_badges.insert("3000".into(), "Badge.jpeg".into());
        config.variant_badges.insert("3030|1".into(), Some("Variant.PNG".into()));
        config.variant_badges.insert("3000|0".into(), None);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("icons.json");
        write_json(&path, &config.into_current().unwrap()).unwrap();
        let restored = serde_json::from_str::<IconConfig>(&fs::read_to_string(path).unwrap()).unwrap().into_current().unwrap();
        assert_eq!(restored.unit_icons["3000"].as_deref(), Some("a.png"));
        assert_eq!(restored.variant_icons["3000|1"].as_deref(), Some("Custom.JPG"));
        assert_eq!(restored.unit_badges["3000"], "Badge.jpeg");
        assert_eq!(restored.variant_badges["3030|1"].as_deref(), Some("Variant.PNG"));
        assert_eq!(restored.variant_badges["3000|0"], None);
        for invalid in [".png", "../Outside.jpg", "Bad\\Image.jpeg", "Wrong.png.exe"] {
            assert!(!valid_icon_name(invalid));
        }
    }

    #[test]
    fn validates_badge_style_and_upgrades_v2_config() {
        let old = r#"{"schemaVersion":2,"unitIcons":{},"variantIcons":{},"unitBadges":{"3000":"Magic.webp"},"variantBadges":{}}"#;
        let mut config: IconConfig = serde_json::from_str(old).unwrap();
        config = config.into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert_eq!(config.unit_badges.get("3000").map(String::as_str), Some("Magic.webp"));
        config.unit_badge_styles.insert("3000".into(), BadgeStyle {size: 60, frame: true, glow: false, scale: 100});
        config.variant_badge_styles.insert("3000|1".into(), BadgeStyle {size: 25, frame: false, glow: false, scale: 100});
        assert!(config.validate().is_ok());
        config.variant_badge_styles.get_mut("3000|1").unwrap().size = 101;
        assert!(config.validate().is_err());
    }

    #[test]
    fn preserves_no_icon_and_variant_override() {
        let mut config = IconConfig::empty();
        config.unit_icons.insert("3000".into(), None);
        config.variant_icons.insert("3000|1".into(), Some("Castle.webp".into()));
        config.variant_icons.insert("3000|0".into(), None);
        let json = serde_json::to_string(&config).unwrap();
        let restored: IconConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.unit_icons.get("3000"), Some(&None));
        assert_eq!(restored.variant_icons.get("3000|1").and_then(Option::as_deref), Some("Castle.webp"));
        assert_eq!(restored.variant_icons.get("3000|0"), Some(&None));
        assert!(restored.validate().is_ok());
    }

    #[test]
    fn upgrades_v3_icons_and_badge_styles() {
        let old = r#"{"schemaVersion":3,"unitIcons":{"3000":"Castle.webp"},"variantIcons":{"3000|1":"Boss.webp"},"unitBadges":{},"variantBadges":{},"unitBadgeStyles":{"3000":{"size":60,"frame":true}},"variantBadgeStyles":{}}"#;
        let config: IconConfig = serde_json::from_str(old).unwrap();
        let config = config.into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert_eq!(config.unit_icons.get("3000").and_then(Option::as_deref), Some("Castle.webp"));
        assert_eq!(config.variant_icons.get("3000|1").and_then(Option::as_deref), Some("Boss.webp"));
        assert_eq!(config.unit_badge_styles.get("3000").unwrap().size, 60);
    }

    #[test]
    fn upgrades_v4_and_persists_base_frames_with_explicit_variant_false() {
        let old = r#"{"schemaVersion":4,"unitIcons":{"3000":"Castle.webp"},"variantIcons":{},"unitBadgeStyles":{"3000":{"size":60,"frame":true}}}"#;
        let mut config = serde_json::from_str::<IconConfig>(old).unwrap().into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert!(config.unit_icon_frames.is_empty());
        assert!(config.variant_icon_frames.is_empty());
        config.unit_icon_frames.insert("3000".into(), true);
        config.variant_icon_frames.insert("3000|0".into(), false);
        config.variant_icon_frames.insert("3000|1".into(), true);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("icons.json");
        write_json(&path, &config).unwrap();
        let restored = serde_json::from_str::<IconConfig>(&fs::read_to_string(path).unwrap()).unwrap().into_current().unwrap();
        assert_eq!(restored.unit_icon_frames.get("3000"), Some(&true));
        assert_eq!(restored.variant_icon_frames.get("3000|0"), Some(&false));
        assert_eq!(restored.variant_icon_frames.get("3000|1"), Some(&true));
        assert_eq!(restored.unit_icons.get("3000").and_then(Option::as_deref), Some("Castle.webp"));
        assert_eq!(restored.unit_badge_styles.get("3000").unwrap().size, 60);
        assert!(restored.unit_badge_styles.get("3000").unwrap().frame);
    }

    #[test]
    fn upgrades_v5_with_glows_off_and_persists_independent_glow_settings() {
        let old = r#"{"schemaVersion":5,"unitIcons":{"5361":"Bloodhound Knight.webp"},"variantIcons":{},"unitIconFrames":{"5361":true},"unitBadgeStyles":{"5361":{"size":48,"frame":true}}}"#;
        let mut config = serde_json::from_str::<IconConfig>(old).unwrap().into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert!(config.unit_icon_glows.is_empty());
        assert!(config.variant_icon_glows.is_empty());
        assert!(!config.unit_badge_styles.get("5361").unwrap().glow);
        config.unit_icon_glows.insert("5361".into(), true);
        config.variant_icon_glows.insert("5361|0".into(), false);
        config.unit_badge_styles.get_mut("5361").unwrap().glow = true;
        config.variant_badge_styles.insert("5361|0".into(), BadgeStyle {size: 48, frame: true, glow: false, scale: 100});
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("icons.json");
        write_json(&path, &config).unwrap();
        let restored = serde_json::from_str::<IconConfig>(&fs::read_to_string(path).unwrap()).unwrap().into_current().unwrap();
        assert_eq!(restored.unit_icon_glows.get("5361"), Some(&true));
        assert_eq!(restored.variant_icon_glows.get("5361|0"), Some(&false));
        assert_eq!(restored.unit_icon_frames.get("5361"), Some(&true));
        assert!(restored.unit_badge_styles.get("5361").unwrap().frame);
        assert!(restored.unit_badge_styles.get("5361").unwrap().glow);
        assert!(!restored.variant_badge_styles.get("5361|0").unwrap().glow);
        assert_eq!(restored.unit_icons.get("5361").and_then(Option::as_deref), Some("Bloodhound Knight.webp"));
    }

    #[test]
    fn validates_base_frame_unit_and_variant_keys() {
        let mut config = IconConfig::empty();
        config.unit_icon_frames.insert("9999".into(), true);
        assert!(config.validate().is_err());
        config.unit_icon_frames.clear();
        config.variant_icon_frames.insert("3000|9999".into(), false);
        assert!(config.validate().is_err());
        assert!(serde_json::from_str::<IconConfig>(r#"{"schemaVersion":5,"unitIcons":{},"variantIcons":{},"unitIconFrames":{"3000":"true"}}"#).is_err());
        config.variant_icon_frames.clear();
        config.unit_icon_glows.insert("9999".into(), true);
        assert!(config.validate().is_err());
        config.unit_icon_glows.clear();
        config.variant_icon_glows.insert("5361|9999".into(), false);
        assert!(config.validate().is_err());
        assert!(serde_json::from_str::<IconConfig>(r#"{"schemaVersion":6,"unitIcons":{},"variantIcons":{},"unitIconGlows":{"5361":"true"}}"#).is_err());
    }

    #[test]
    fn upgrades_v6_with_default_scales_and_persists_unit_and_variant_scales() {
        let old = r#"{"schemaVersion":6,"unitIcons":{"3000":"Crop Test.png"},"variantIcons":{},"unitBadges":{"3000":"Badge.jpg"},"unitIconFrames":{"3000":true},"unitIconGlows":{"3000":true},"unitBadgeStyles":{"3000":{"size":72,"frame":true,"glow":true}}}"#;
        let mut config = serde_json::from_str::<IconConfig>(old).unwrap().into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert!(config.unit_icon_scales.is_empty());
        assert!(config.variant_icon_scales.is_empty());
        assert_eq!(config.unit_badge_styles["3000"].scale, 100);
        config.unit_icon_scales.insert("3000".into(), 175);
        config.variant_icon_scales.insert("3000|1".into(), 100);
        config.unit_badge_styles.get_mut("3000").unwrap().scale = 240;
        config.variant_badge_styles.insert("3000|1".into(), BadgeStyle {size: 72, frame: true, glow: true, scale: 20});
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("icons.json");
        write_json(&path, &config.into_current().unwrap()).unwrap();
        let restored = serde_json::from_str::<IconConfig>(&fs::read_to_string(path).unwrap()).unwrap().into_current().unwrap();
        assert_eq!(restored.unit_icon_scales["3000"], 175);
        assert_eq!(restored.variant_icon_scales["3000|1"], 100);
        assert_eq!(restored.unit_badge_styles["3000"].scale, 240);
        assert_eq!(restored.variant_badge_styles["3000|1"].scale, 20);
        assert!(restored.unit_icon_frames["3000"]);
        assert!(restored.unit_icon_glows["3000"]);
        assert_eq!(restored.unit_icons["3000"].as_deref(), Some("Crop Test.png"));
        assert_eq!(restored.unit_badges["3000"], "Badge.jpg");
    }

    #[test]
    fn validates_scale_ranges_and_unit_and_variant_keys() {
        let mut config = IconConfig::empty();
        for scale in [20, 100, 300] {
            config.unit_icon_scales.insert("3000".into(), scale);
            config.variant_icon_scales.insert("3000|1".into(), scale);
            config.unit_badge_styles.insert("3000".into(), BadgeStyle {size: 48, frame: true, glow: false, scale});
            config.variant_badge_styles.insert("3000|1".into(), BadgeStyle {size: 48, frame: true, glow: false, scale});
            assert!(config.validate().is_ok());
        }
        for scale in [0, 19, 301] {
            let mut invalid = config.clone();
            invalid.unit_icon_scales.insert("3000".into(), scale);
            assert!(invalid.validate().is_err());
            let mut invalid = config.clone();
            invalid.variant_icon_scales.insert("3000|1".into(), scale);
            assert!(invalid.validate().is_err());
            let mut invalid = config.clone();
            invalid.unit_badge_styles.get_mut("3000").unwrap().scale = scale;
            assert!(invalid.validate().is_err());
            let mut invalid = config.clone();
            invalid.variant_badge_styles.get_mut("3000|1").unwrap().scale = scale;
            assert!(invalid.validate().is_err());
        }
        config.unit_icon_scales.insert("9999".into(), 100);
        assert!(config.validate().is_err());
        config.unit_icon_scales.remove("9999");
        config.variant_icon_scales.insert("3000|999".into(), 100);
        assert!(config.validate().is_err());
        assert!(serde_json::from_str::<IconConfig>(r#"{"schemaVersion":7,"unitIcons":{},"variantIcons":{},"unitIconScales":{"3000":100.5}}"#).is_err());
    }

    #[test]
    fn upgrades_v7_and_round_trips_map_icon_scales_without_changing_frame_scales() {
        let old = r#"{"schemaVersion":7,"unitIcons":{"3000":"3000.webp"},"variantIcons":{},"unitIconScales":{"3000":175}}"#;
        let mut config = serde_json::from_str::<IconConfig>(old).unwrap().into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert_eq!(config.map_icon_scales["3000"], 200);
        assert_eq!(config.map_icon_scales["boss"], 120);
        assert_eq!(config.map_icon_scales["evergaol"], 150);
        assert_eq!(config.unit_icon_scales["3000"], 175);
        config.unit_map_icon_scales.insert("3000".into(), 100);
        config.variant_map_icon_scales.insert("3000|1".into(), 230);
        config.map_icon_scales.insert("custom icon".into(), 135);
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("icons.json");
        write_json(&path, &config).unwrap();
        let restored = serde_json::from_str::<IconConfig>(&fs::read_to_string(path).unwrap()).unwrap().into_current().unwrap();
        assert_eq!(restored.unit_map_icon_scales["3000"], 100);
        assert_eq!(restored.variant_map_icon_scales["3000|1"], 230);
        assert_eq!(restored.map_icon_scales["custom icon"], 135);
        assert_eq!(restored.unit_icon_scales["3000"], 175);
        let explicit = r#"{"schemaVersion":8,"unitIcons":{},"variantIcons":{},"mapIconScales":{}}"#;
        assert!(serde_json::from_str::<IconConfig>(explicit).unwrap().into_current().unwrap().map_icon_scales.is_empty());
    }

    #[test]
    fn validates_map_scales_and_normalizes_asset_names() {
        let mut config = IconConfig::empty();
        config.map_icon_scales.insert("Custom Icon".into(), 135);
        assert!(config.clone().into_current().unwrap().map_icon_scales.contains_key("custom icon"));
        for scale in [20, 100, 300] {
            config.unit_map_icon_scales.insert("3000".into(), scale);
            config.variant_map_icon_scales.insert("3000|1".into(), scale);
            assert!(config.validate().is_ok());
        }
        for scale in [0, 19, 301] {
            let mut invalid = config.clone();
            invalid.unit_map_icon_scales.insert("3000".into(), scale);
            assert!(invalid.validate().is_err());
            let mut invalid = config.clone();
            invalid.variant_map_icon_scales.insert("3000|1".into(), scale);
            assert!(invalid.validate().is_err());
            let mut invalid = config.clone();
            invalid.map_icon_scales.insert("custom".into(), scale);
            assert!(invalid.validate().is_err());
        }
        config.unit_map_icon_scales.insert("9999".into(), 100);
        assert!(config.validate().is_err());
        config.unit_map_icon_scales.remove("9999");
        config.variant_map_icon_scales.insert("3000|999".into(), 100);
        assert!(config.validate().is_err());
        config.variant_map_icon_scales.remove("3000|999");
        config.map_icon_scales.insert("../outside".into(), 100);
        assert!(config.validate().is_err());
        assert!(serde_json::from_str::<IconConfig>(r#"{"schemaVersion":8,"unitIcons":{},"variantIcons":{},"unitMapIconScales":{"3000":125.5}}"#).is_err());
    }

    #[test]
    fn upgrades_v8_and_round_trips_partial_file_styles_and_explicit_unit_overrides() {
        let old = r#"{"schemaVersion":8,"unitIcons":{},"variantIcons":{},"unitIconFrames":{"3000":false},"unitIconScales":{"3000":100}}"#;
        let mut config = serde_json::from_str::<IconConfig>(old).unwrap().into_current().unwrap();
        assert_eq!(config.schema_version, 10);
        assert!(config.file_icon_styles.is_empty());
        config.file_icon_styles.insert("Boss".into(), FileIconStyle {frame:Some(true),scale:Some(175),..FileIconStyle::default()});
        config = config.into_current().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("icons.json");
        write_json(&path, &config).unwrap();
        let text=fs::read_to_string(path).unwrap();
        let restored = serde_json::from_str::<IconConfig>(&text).unwrap().into_current().unwrap();
        assert_eq!(restored.file_icon_styles["boss"].frame,Some(true));
        assert_eq!(restored.file_icon_styles["boss"].scale,Some(175));
        assert_eq!(restored.file_icon_styles["boss"].glow,None);
        assert!(!restored.unit_icon_frames["3000"]);
        assert_eq!(restored.unit_icon_scales["3000"],100);
        let json:serde_json::Value=serde_json::from_str(&text).unwrap();
        assert!(json["fileIconStyles"]["boss"].get("glow").is_none());
    }

    #[test]
    fn validates_file_style_names_types_and_ranges() {
        let mut config = IconConfig::empty();
        config.file_icon_styles.insert("custom".into(), FileIconStyle {size:Some(72),frame:Some(false),glow:Some(true),scale:Some(230),..FileIconStyle::default()});
        assert!(config.validate().is_ok());
        config.file_icon_styles.get_mut("custom").unwrap().scale=Some(301);
        assert!(config.validate().is_err());
        config.file_icon_styles.get_mut("custom").unwrap().scale=Some(100);
        config.file_icon_styles.get_mut("custom").unwrap().size=Some(101);
        assert!(config.validate().is_err());
        config.file_icon_styles.get_mut("custom").unwrap().size=Some(48);
        config.file_icon_styles.insert("../outside".into(), FileIconStyle::default());
        assert!(config.validate().is_err());
        assert!(serde_json::from_str::<IconConfig>(r#"{"schemaVersion":9,"unitIcons":{},"variantIcons":{},"fileIconStyles":{"boss":{"frame":"true"}}}"#).is_err());
    }

    #[test]
    fn upgrades_v9_and_persists_file_unit_and_variant_shadow_overrides() {
        let old=r#"{"schemaVersion":9,"unitIcons":{},"variantIcons":{},"fileIconStyles":{"boss":{"glow":true}}}"#;
        let mut config=serde_json::from_str::<IconConfig>(old).unwrap().into_current().unwrap();
        assert_eq!(config.schema_version,10);
        assert!(config.unit_icon_shadows.is_empty());
        assert!(config.variant_icon_shadows.is_empty());
        assert_eq!(config.file_icon_styles["boss"].shadow,None);
        config.file_icon_styles.get_mut("boss").unwrap().shadow=Some(false);
        config.unit_icon_shadows.insert("3000".into(),true);
        config.variant_icon_shadows.insert("3000|0".into(),false);
        let directory=tempfile::tempdir().unwrap();
        let path=directory.path().join("icons.json");
        write_json(&path,&config).unwrap();
        let restored=serde_json::from_str::<IconConfig>(&fs::read_to_string(path).unwrap()).unwrap().into_current().unwrap();
        assert_eq!(restored.file_icon_styles["boss"].shadow,Some(false));
        assert!(restored.unit_icon_shadows["3000"]);
        assert!(!restored.variant_icon_shadows["3000|0"]);
        assert_eq!(restored.file_icon_styles["boss"].glow,Some(true));
        config.unit_icon_shadows.insert("9999".into(),true);
        assert!(config.validate().is_err());
        config.unit_icon_shadows.remove("9999");
        config.variant_icon_shadows.insert("3000|999".into(),false);
        assert!(config.validate().is_err());
        assert!(serde_json::from_str::<IconConfig>(r#"{"schemaVersion":10,"unitIcons":{},"variantIcons":{},"fileIconStyles":{"boss":{"shadow":"false"}}}"#).is_err());
    }
}
