use crate::error::{AppError, AppResult};
use aes::Aes256;
use cbc::{Decryptor, Encryptor};
use cipher::{block_padding::{NoPadding, Pkcs7}, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, HashMap, HashSet}, io::Write, path::Path};

const BUILTIN: &[u8] = include_bytes!("../../data/regulation.bin");
const LOCATIONS: &str = include_str!("../../data/pattern_locations.csv");
const TYPES: &str = include_str!("../../data/pattern_location_types.csv");
const NAMES: &str = include_str!("../../data/pattern_names.csv");
const CIRCLE_OVERRIDES: &str = include_str!("../../data/circle_overrides.csv");
const KEY: [u8; 32] = [
    0x9a, 0x8e, 0xe9, 0x0c, 0x4c, 0x01, 0xa4, 0x31,
    0x68, 0xa1, 0x7d, 0x9d, 0x75, 0xe4, 0xa7, 0xd0,
    0x21, 0x07, 0xeb, 0xcf, 0x43, 0xd5, 0xac, 0xb0,
    0x55, 0x4f, 0x94, 0x16, 0x01, 0xb5, 0x79, 0x18,
];
const VERSION: &str = "10350000";
const EVENT_RESULT_CAPACITY: usize = 20;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub index: i32,
    pub scope: String,
    pub category: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub type_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_flag: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Name {
    pub kind: String,
    pub id: i32,
    pub variation: Option<i32>,
    #[serde(rename = "type")]
    pub unit_type: Option<String>,
    pub name: String,
    pub name_zh: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Flag {
    pub row_id: i32,
    pub modifier_set: i32,
    pub modifier: i32,
    pub event_flag: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Play {
    pub row_id: i32,
    pub play_area1: i32,
    pub play_area2: i32,
    pub boss_id1: i32,
    pub boss_id2: i32,
    pub extra_boss_id1: i32,
    pub extra_boss_id2: i32,
    pub boss_modifier1: i32,
    pub boss_modifier2: i32,
    pub extra_boss_modifier1: i32,
    pub extra_boss_modifier2: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub row_id: i32,
    pub location_index: Option<i32>,
    pub attach_id: i32,
    pub unit_id: i32,
    pub variation_id: i32,
    pub modifier: i32,
    pub map_index: i32,
    pub visible: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub id: i32,
    pub terrain_id: i32,
    pub nightlord_id: i32,
    pub flags: Vec<Flag>,
    pub play: Option<Play>,
    pub placements: Vec<Placement>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dataset {
    pub version: String,
    pub source_path: Option<String>,
    pub patterns: Vec<Pattern>,
    pub locations: Vec<Location>,
    pub names: Vec<Name>,
    pub circle_centers: Vec<CircleCenter>,
    pub diagnostics: Vec<AppError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CircleCenter {
    pub id: i32,
    pub x: f64,
    pub y: f64,
    pub source: &'static str,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub pattern_id: i32,
    pub table: String,
    pub row_id: i32,
    pub field: String,
    pub old_value: i64,
    pub new_value: i64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowAddition {
    pub pattern_id: i32,
    pub table: String,
    pub row_id: i32,
    pub source_row_id: i32,
    pub fields: BTreeMap<String, i64>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowRemoval {
    pub pattern_id: i32,
    #[serde(default = "default_removal_table")]
    pub table: String,
    pub row_id: i32,
}

fn default_removal_table() -> String { "spot".into() }

#[derive(Clone)]
struct Entry {
    name: String,
    header: usize,
    offset: usize,
    size: usize,
}

struct Regulation {
    bnd: Vec<u8>,
    iv: [u8; 16],
    version: String,
    entries: Vec<Entry>,
}

struct Table {
    rows: Vec<(i32, usize)>,
    row_size: usize,
}

fn range(data: &[u8], offset: usize, len: usize) -> AppResult<&[u8]> {
    data.get(offset..offset.checked_add(len).ok_or(AppError::new("errors.offsetOverflow"))?)
        .ok_or_else(|| AppError::params("errors.dataBounds", serde_json::json!({"offset": format!("0x{offset:X}"), "length": len})))
}
fn u16le(data: &[u8], offset: usize) -> AppResult<u16> { Ok(u16::from_le_bytes(range(data, offset, 2)?.try_into().unwrap())) }
fn i16le(data: &[u8], offset: usize) -> AppResult<i16> { Ok(i16::from_le_bytes(range(data, offset, 2)?.try_into().unwrap())) }
fn u32le(data: &[u8], offset: usize) -> AppResult<u32> { Ok(u32::from_le_bytes(range(data, offset, 4)?.try_into().unwrap())) }
fn i32le(data: &[u8], offset: usize) -> AppResult<i32> { Ok(i32::from_le_bytes(range(data, offset, 4)?.try_into().unwrap())) }
fn u64le(data: &[u8], offset: usize) -> AppResult<u64> { Ok(u64::from_le_bytes(range(data, offset, 8)?.try_into().unwrap())) }
fn i64le(data: &[u8], offset: usize) -> AppResult<i64> { Ok(i64::from_le_bytes(range(data, offset, 8)?.try_into().unwrap())) }
fn u32be(data: &[u8], offset: usize) -> AppResult<u32> { Ok(u32::from_be_bytes(range(data, offset, 4)?.try_into().unwrap())) }

impl Regulation {
    fn load(path: Option<&str>) -> AppResult<Self> {
        let raw = match path {
            Some(path) => std::fs::read(path).map_err(|e| AppError::diagnostic("errors.regulationRead", e))?,
            None => BUILTIN.to_vec(),
        };
        let mut iv = [0_u8; 16];
        let payload = if raw.starts_with(b"BND4") {
            raw
        } else {
            if raw.len() < 32 || (raw.len() - 16) % 16 != 0 { return Err(AppError::new("errors.aesLength")); }
            iv.copy_from_slice(&raw[..16]);
            let mut encrypted = raw[16..].to_vec();
            Decryptor::<Aes256>::new_from_slices(&KEY, &iv)
                .map_err(|e| AppError::diagnostic("errors.invalidData", e))?
                .decrypt_padded_mut::<NoPadding>(&mut encrypted)
                .map_err(|e| AppError::diagnostic("errors.aesDecrypt", e))?;
            if !encrypted.starts_with(b"DCX\0") || range(&encrypted, 0x28, 4)? != b"ZSTD" {
                return Err(AppError::new("errors.dcxFormat"));
            }
            let expected = u32be(&encrypted, 0x1c)? as usize;
            let size = u32be(&encrypted, 0x20)? as usize;
            let compressed = range(&encrypted, 0x4c, size)?;
            let decoded = zstd::stream::decode_all(compressed)
                .map_err(|e| AppError::diagnostic("errors.zstdDecode", e))?;
            if decoded.len() != expected { return Err(AppError::new("errors.dcxLength")); }
            decoded
        };
        if range(&payload, 0, 4)? != b"BND4" { return Err(AppError::new("errors.bndSignature")); }
        range(&payload, 0, 0x40)?;
        if payload[9] != 0 || payload[10] != 1 || payload[0x30] != 1 || payload[0x31].reverse_bits() != 0x2e {
            return Err(AppError::new("errors.bndFormat"));
        }
        let version = String::from_utf8_lossy(range(&payload, 0x18, 8)?)
            .trim_end_matches('\0').to_string();
        if version != VERSION { return Err(AppError::params("errors.regulationVersion", serde_json::json!({"supported": VERSION, "actual": version}))); }
        let count = u32le(&payload, 0x0c)? as usize;
        let header_size = u64le(&payload, 0x20)? as usize;
        if header_size != 36 { return Err(AppError::new("errors.bndHeaderLength")); }
        let mut entries = Vec::with_capacity(count);
        for i in 0..count {
            let header = 0x40 + i * header_size;
            range(&payload, header, header_size)?;
            let flags = payload[header].reverse_bits();
            if i32le(&payload, header + 4)? != -1 { return Err(AppError::new("errors.bndHeaderFlags")); }
            if flags & 1 != 0 { return Err(AppError::new("errors.bndCompression")); }
            let size = i64le(&payload, header + 8)?;
            let uncompressed = i64le(&payload, header + 16)?;
            let offset = u32le(&payload, header + 24)? as usize;
            let name_offset = u32le(&payload, header + 32)? as usize;
            if size < 0 || size != uncompressed { return Err(AppError::new("errors.bndParamLength")); }
            range(&payload, offset, size as usize)?;
            let mut codepoints = Vec::new();
            for step in 0..2048 {
                let c = u16le(&payload, name_offset + step * 2)?;
                if c == 0 { break; }
                codepoints.push(c);
                if step == 2047 { return Err(AppError::new("errors.bndFilenameLength")); }
            }
            entries.push(Entry { name: String::from_utf16_lossy(&codepoints), header, offset, size: size as usize });
        }
        Ok(Self { bnd: payload, iv, version, entries })
    }

    fn table(&self, name: &str, expected_size: usize) -> AppResult<Table> {
        let suffix = format!("{name}.param").to_lowercase();
        let entry = self.entries.iter().find(|e| e.name.to_lowercase().ends_with(&suffix))
            .ok_or_else(|| AppError::params("errors.paramMissing", serde_json::json!({"name": name})))?;
        let data = range(&self.bnd, entry.offset, entry.size)?;
        range(data, 0, 0x40)?;
        if data[0x2c] != 0 || data[0x2d] & 0x04 == 0 { return Err(AppError::params("errors.paramLayout", serde_json::json!({"name": name}))); }
        let count = u16le(data, 0x0a)? as usize;
        let mut rows = Vec::with_capacity(count);
        for i in 0..count {
            let header = 0x40 + i * 24;
            range(data, header, 24)?;
            let row_id = i32le(data, header)?;
            let row_offset = i64le(data, header + 8)?;
            if row_offset < 0 { return Err(AppError::params("errors.paramRowOffset", serde_json::json!({"name": name}))); }
            let row_offset = row_offset as usize;
            range(data, row_offset, expected_size)?;
            rows.push((row_id, entry.offset + row_offset));
        }
        if rows.len() > 1 && rows[1].1.checked_sub(rows[0].1) != Some(expected_size) { return Err(AppError::params("errors.paramRowSize", serde_json::json!({"name": name}))); }
        Ok(Table { rows, row_size: expected_size })
    }

    fn replace_param(&mut self, name: &str, data: Vec<u8>) -> AppResult<()> {
        let suffix = format!("{name}.param").to_lowercase();
        let entry = self.entries.iter_mut().find(|entry| entry.name.to_lowercase().ends_with(&suffix))
            .ok_or_else(|| AppError::params("errors.paramMissing", serde_json::json!({"name": name})))?;
        // Keep the existing binder headers, filename hashes and other files.
        // Relocate the expanded Param to an aligned, uncompressed payload.
        let offset = (self.bnd.len() + 15) & !15;
        let encoded_offset = u32::try_from(offset).map_err(|_| AppError::new("errors.signedValueRange"))?;
        self.bnd.resize(offset, 0);
        self.bnd.extend_from_slice(&data);
        self.bnd[entry.header + 8..entry.header + 16].copy_from_slice(&(data.len() as i64).to_le_bytes());
        self.bnd[entry.header + 16..entry.header + 24].copy_from_slice(&(data.len() as i64).to_le_bytes());
        self.bnd[entry.header + 24..entry.header + 28].copy_from_slice(&encoded_offset.to_le_bytes());
        entry.offset = offset;
        entry.size = data.len();
        Ok(())
    }

    fn encode(&self) -> AppResult<Vec<u8>> {
        let mut encoder = zstd::bulk::Compressor::new(15)
            .map_err(|e| AppError::diagnostic("errors.zstdEncode", e))?;
        // Match Smithbox's SFUtil.WriteZstd: one-shot compression with a 64 KiB
        // window, limiting decompressed blocks to 64 KiB for game compatibility.
        encoder.window_log(16).map_err(|e| AppError::diagnostic("errors.zstdEncode", e))?;
        encoder.include_contentsize(false).map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
        let compressed = encoder.compress(&self.bnd).map_err(|e| AppError::diagnostic("errors.zstdEncode", e))?;
        let mut dcx = Vec::with_capacity(0x4c + compressed.len() + 16);
        dcx.extend_from_slice(b"DCX\0");
        for number in [0x11000_u32, 0x18, 0x24, 0x44, 0x4c] { dcx.extend_from_slice(&number.to_be_bytes()); }
        dcx.extend_from_slice(b"DCS\0");
        dcx.extend_from_slice(&(self.bnd.len() as u32).to_be_bytes());
        dcx.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
        dcx.extend_from_slice(b"DCP\0ZSTD");
        dcx.extend_from_slice(&0x20_u32.to_be_bytes());
        dcx.extend_from_slice(&[15, 0, 0, 0]);
        for number in [0_u32, 0, 0, 0x10100] { dcx.extend_from_slice(&number.to_be_bytes()); }
        dcx.extend_from_slice(b"DCA\0");
        dcx.extend_from_slice(&8_u32.to_be_bytes());
        if dcx.len() != 0x4c { return Err(AppError::new("errors.dcxHeader")); }
        dcx.extend_from_slice(&compressed);
        dcx.resize((dcx.len() + 15) & !15, 0);
        let mut buffer = vec![0_u8; dcx.len() + 16];
        buffer[..dcx.len()].copy_from_slice(&dcx);
        let cipher = Encryptor::<Aes256>::new_from_slices(&KEY, &self.iv).map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
        let encrypted = cipher.encrypt_padded_mut::<Pkcs7>(&mut buffer, dcx.len())
            .map_err(|e| AppError::diagnostic("errors.aesEncrypt", e))?;
        let mut out = self.iv.to_vec();
        out.extend_from_slice(encrypted);
        Ok(out)
    }
}

fn parse_locations() -> AppResult<(Vec<Location>, HashMap<i32, i32>)> {
    let mut types = HashMap::new();
    let mut reader = csv::Reader::from_reader(TYPES.as_bytes());
    for row in reader.records() {
        let row = row.map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
        types.insert(row[0].parse::<i32>().map_err(|e| AppError::diagnostic("errors.invalidData", e))?, row[1].parse::<i32>().map_err(|e| AppError::diagnostic("errors.invalidData", e))?);
    }
    let mut by_index = BTreeMap::new();
    let mut by_attach = HashMap::new();
    let mut reader = csv::Reader::from_reader(LOCATIONS.as_bytes());
    for row in reader.records() {
        let row = row.map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
        let index = row[0].parse::<i32>().map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
        let attach = row[2].parse::<i32>().map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
        by_attach.insert(attach, index);
        by_index.entry(index).or_insert_with(|| Location {
            index, scope: row[3].to_string(), category: row[4].to_string(),
            name: if row[5].is_empty() { index.to_string() } else { row[5].to_string() },
            x: row[6].parse().unwrap_or(0.0), y: row[7].parse().unwrap_or(0.0),
            type_index: types.get(&index).copied(), event_flag: None,
        });
    }
    Ok((by_index.into_values().collect(), by_attach))
}

fn apply_castle_positions(reg: &Regulation, locations: &mut [Location]) -> AppResult<()> {
    let points = reg.table("WorldMapPointParam", 128)?;
    // Castle attach points locate unit/control entities, rather than the map
    // icons. In particular, South Castle's attach point is the grid origin.
    // Use the normal, South Castle, and North Castle map-icon rows instead.
    for (index, point_id) in [(10, 64433700), (79, 1104), (81, 1100)] {
        let at = points.rows.iter().find(|(id, _)| *id == point_id)
            .ok_or_else(|| AppError::params("errors.castleRowMissing", serde_json::json!({"rowId": point_id})))?.1;
        let grid_x = reg.bnd[at + 29] as f64;
        let grid_z = reg.bnd[at + 30] as f64;
        let pos_x = f32::from_le_bytes(range(&reg.bnd, at + 32, 4)?.try_into().unwrap()) as f64;
        let pos_z = f32::from_le_bytes(range(&reg.bnd, at + 40, 4)?.try_into().unwrap()) as f64;
        let x = grid_x * 256.0 + pos_x - 10368.0;
        let y = 10368.0 - (grid_z * 256.0 + pos_z);
        if !x.is_finite() || !y.is_finite() || !(0.0..=1536.0).contains(&x) || !(0.0..=1536.0).contains(&y) {
            return Err(AppError::params("errors.castleCoordinates", serde_json::json!({"rowId": point_id})));
        }
        let location = locations.iter_mut().find(|l| l.index == index)
            .ok_or_else(|| AppError::params("errors.castleLocationMissing", serde_json::json!({"location": index})))?;
        location.x = x;
        location.y = y;
    }
    Ok(())
}

fn add_rot_blessing_locations(reg: &Regulation, locations: &mut Vec<Location>) -> AppResult<()> {
    let points = reg.table("WorldMapPointParam", 128)?;
    // These are event-controlled map points, with no unit attach-point row.
    // Match the actual event flags so imported regulations supply their own coordinates.
    for (index, event_flag, name) in [
        (65, 1046300590_u32, "Southwest"),
        (66, 1047300590_u32, "West"),
        (67, 1057300590_u32, "Northeast"),
    ] {
        let mut point = None;
        for (_, at) in &points.rows {
            if u32le(&reg.bnd, at + 8)? == event_flag { point = Some(*at); break; }
        }
        let at = point.ok_or_else(|| AppError::params("errors.rotBlessingRowMissing", serde_json::json!({"eventFlag": event_flag})))?;
        let x = reg.bnd[at + 29] as f64 * 256.0
            + f32::from_le_bytes(range(&reg.bnd, at + 32, 4)?.try_into().unwrap()) as f64 - 10368.0;
        let y = 10368.0 - (reg.bnd[at + 30] as f64 * 256.0
            + f32::from_le_bytes(range(&reg.bnd, at + 40, 4)?.try_into().unwrap()) as f64);
        if !x.is_finite() || !y.is_finite() || !(0.0..=1536.0).contains(&x) || !(0.0..=1536.0).contains(&y) {
            return Err(AppError::params("errors.rotBlessingCoordinates", serde_json::json!({"eventFlag": event_flag})));
        }
        locations.push(Location {
            index, scope: "Surface".to_string(), category: "Rot Blessing".to_string(),
            name: name.to_string(), x, y, type_index: Some(7), event_flag: Some(event_flag),
        });
    }
    locations.sort_by_key(|location| location.index);
    Ok(())
}

fn add_frenzy_tower_locations(reg: &Regulation, locations: &mut Vec<Location>) -> AppResult<()> {
    let points = reg.table("WorldMapPointParam", 128)?;
    // Surface markers store the position flag in eventFlagId1; Great Hollow
    // stores it in eventFlagId0. Read coordinates from the imported file too.
    for (index, event_flag, flag_offset, scope, name) in [
        (118, 1044380230_u32, 8, "Surface", "North"),
        (119, 1044360220_u32, 8, "Surface", "South"),
        (120, 1038400230_u32, 4, "Great Hollow", "North"),
        (121, 1046400230_u32, 4, "Great Hollow", "South"),
    ] {
        let mut point = None;
        for (_, at) in &points.rows {
            if u32le(&reg.bnd, at + flag_offset)? == event_flag { point = Some(*at); break; }
        }
        let at = point.ok_or_else(|| AppError::params("errors.frenzyTowerRowMissing", serde_json::json!({"eventFlag": event_flag})))?;
        let x = reg.bnd[at + 29] as f64 * 256.0
            + f32::from_le_bytes(range(&reg.bnd, at + 32, 4)?.try_into().unwrap()) as f64 - 10368.0;
        let y = 10368.0 - (reg.bnd[at + 30] as f64 * 256.0
            + f32::from_le_bytes(range(&reg.bnd, at + 40, 4)?.try_into().unwrap()) as f64);
        if !x.is_finite() || !y.is_finite() || !(0.0..=1536.0).contains(&x) || !(0.0..=1536.0).contains(&y) {
            return Err(AppError::params("errors.frenzyTowerCoordinates", serde_json::json!({"eventFlag": event_flag})));
        }
        locations.push(Location {
            index, scope: scope.to_string(), category: "Frenzy Tower".to_string(),
            name: name.to_string(), x, y, type_index: Some(8), event_flag: Some(event_flag),
        });
    }
    locations.sort_by_key(|location| location.index);
    Ok(())
}

fn parse_names() -> AppResult<Vec<Name>> {
    parse_names_csv(NAMES)
}

fn parse_names_csv(source: &str) -> AppResult<Vec<Name>> {
    let mut names = Vec::new();
    let mut reader = csv::Reader::from_reader(source.as_bytes());
    for row in reader.records() {
        let row = row.map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
        names.push(Name {
            kind: row[0].to_string(), id: row[1].parse().map_err(|e| AppError::diagnostic("errors.nameId", e))?,
            variation: if row[2].is_empty() { None } else { Some(row[2].parse().map_err(|e| AppError::diagnostic("errors.variantId", e))?) },
            unit_type: if row[3].is_empty() { None } else { Some(row[3].to_string()) },
            name: row[4].to_string(),
            name_zh: row.get(5).map(str::trim).filter(|name| !name.is_empty()).map(str::to_string),
        });
    }
    Ok(names)
}

fn hidden(unit: i32, attach: i32, terrain: i32) -> bool {
    const IDS: &[i32] = &[2000,4130,4552,4553,4555,4600,4601,4602,4603,4604,4605,4606,4678,5006,5105,5300,5305,5349,5350,5351,5352,5353,5354,5355,5356,5357,5362,5363,5364,5380,5381,5382,5383,5386,5387,5388,5389,5390,5391];
    IDS.contains(&unit) || (terrain == 2 && (attach == 129 || attach == 2129))
}

fn circle_centers(reg: &Regulation) -> AppResult<Vec<CircleCenter>> {
    let mut centers = BTreeMap::new();
    // Both tables use world grid coordinates. CreateParam locates the blue
    // night-boss circles on the community maps; DefaultParam is only a fallback.
    for (table, size, grid_offset, pos_offset, source) in [
        ("PlayAreaCreateDefaultParam", 36, 9, 12, "default"),
        ("PlayAreaCreateParam", 64, 5, 8, "playArea"),
    ] {
        for (id, at) in reg.table(table, size)?.rows {
            let grid_x = reg.bnd[at + grid_offset] as f64;
            let grid_z = reg.bnd[at + grid_offset + 1] as f64;
            let pos_x = f32::from_le_bytes(range(&reg.bnd, at + pos_offset, 4)?.try_into().unwrap()) as f64;
            let pos_z = f32::from_le_bytes(range(&reg.bnd, at + pos_offset + 4, 4)?.try_into().unwrap()) as f64;
            centers.insert(id, CircleCenter {
                id, x: grid_x * 256.0 + pos_x - 10368.0,
                y: 10368.0 - (grid_z * 256.0 + pos_z), source,
            });
        }
    }
    // Great Hollow's second-night boss is in the northeast tower for both IDs.
    // The actual Day 2 Circle is marked separately on the community images.
    let mut reader = csv::Reader::from_reader(CIRCLE_OVERRIDES.as_bytes());
    let mut seen = HashSet::new();
    for row in reader.records() {
        let row = row.map_err(|e| AppError::diagnostic("errors.circleData", e))?;
        let id = row[0].parse::<i32>().map_err(|e| AppError::diagnostic("errors.circleId", e))?;
        let x = row[1].parse::<f64>().map_err(|e| AppError::diagnostic("errors.circleX", e))?;
        let y = row[2].parse::<f64>().map_err(|e| AppError::diagnostic("errors.circleY", e))?;
        if !seen.insert(id) || !centers.contains_key(&id) ||
            !x.is_finite() || !y.is_finite() || !(0.0..=1536.0).contains(&x) || !(0.0..=1536.0).contains(&y) {
            return Err(AppError::params("errors.circleCalibration", serde_json::json!({"circleId": id})));
        }
        centers.insert(id, CircleCenter { id, x, y, source: "community" });
    }
    Ok(centers.into_values().collect())
}

pub fn load_dataset(path: Option<String>) -> AppResult<Dataset> {
    let reg = Regulation::load(path.as_deref())?;
    let flags = reg.table("LotResultMapPatternFlag", 28)?;
    let plays = reg.table("LotResultPlayAreaParam", 40)?;
    let spots = reg.table("LotResultSmallBaseAndSpot", 24)?;
    let circle_centers = circle_centers(&reg)?;
    let (mut locations, by_attach) = parse_locations()?;
    apply_castle_positions(&reg, &mut locations)?;
    add_rot_blessing_locations(&reg, &mut locations)?;
    add_frenzy_tower_locations(&reg, &mut locations)?;
    let names = parse_names()?;
    for location in &mut locations {
        if location.name == location.index.to_string() {
            if let Some(named) = names.iter().find(|n| n.kind == "location" && n.id == location.index && n.variation.is_none() && !n.name.is_empty()) {
                location.name = named.name.clone();
            }
        }
    }
    let mut patterns = BTreeMap::<i32, Pattern>::new();
    for (row_id, at) in flags.rows {
        let id = i32le(&reg.bnd, at + 4)?;
        let terrain = i32le(&reg.bnd, at + 24)?;
        let nightlord = i16le(&reg.bnd, at + 22)? as i32;
        let pattern = patterns.entry(id).or_insert_with(|| Pattern { id, terrain_id: terrain, nightlord_id: nightlord, flags: Vec::new(), play: None, placements: Vec::new() });
        if pattern.terrain_id != terrain || pattern.nightlord_id != nightlord { return Err(AppError::params("errors.patternMetadata", serde_json::json!({"patternId": id}))); }
        pattern.flags.push(Flag { row_id, modifier_set: i32le(&reg.bnd, at + 8)?, modifier: i32le(&reg.bnd, at + 12)?, event_flag: u32le(&reg.bnd, at + 16)? });
    }
    for (row_id, at) in plays.rows {
        let id = i32le(&reg.bnd, at + 4)?;
        let pattern = patterns.get_mut(&id).ok_or_else(|| AppError::params("errors.circlePattern", serde_json::json!({"patternId": id})))?;
        if pattern.play.is_some() { return Err(AppError::params("errors.duplicateCircleRows", serde_json::json!({"patternId": id}))); }
        pattern.play = Some(Play {
            row_id, play_area1: i32le(&reg.bnd, at + 8)?, play_area2: i32le(&reg.bnd, at + 12)?,
            boss_id1: i16le(&reg.bnd, at + 16)? as i32, boss_id2: i16le(&reg.bnd, at + 18)? as i32,
            extra_boss_id1: i16le(&reg.bnd, at + 20)? as i32, extra_boss_id2: i16le(&reg.bnd, at + 22)? as i32,
            boss_modifier1: i32le(&reg.bnd, at + 24)?, boss_modifier2: i32le(&reg.bnd, at + 28)?,
            extra_boss_modifier1: i32le(&reg.bnd, at + 32)?, extra_boss_modifier2: i32le(&reg.bnd, at + 36)?,
        });
    }
    for (row_id, at) in spots.rows {
        let id = i32le(&reg.bnd, at + 4)?;
        let pattern = patterns.get_mut(&id).ok_or_else(|| AppError::params("errors.locationPattern", serde_json::json!({"patternId": id})))?;
        let attach_id = i32le(&reg.bnd, at + 8)?;
        let unit_id = i32le(&reg.bnd, at + 12)?;
        pattern.placements.push(Placement {
            row_id, location_index: by_attach.get(&attach_id).copied(), attach_id, unit_id,
            variation_id: reg.bnd[at + 17] as i32, modifier: i32le(&reg.bnd, at + 20)?,
            map_index: reg.bnd[at + 16] as i32, visible: !hidden(unit_id, attach_id, pattern.terrain_id),
        });
    }
    if patterns.len() != 520 { return Err(AppError::new("errors.datasetVersion")); }
    let diagnostics = pattern_result_diagnostics(&reg)?;
    Ok(Dataset { version: reg.version, source_path: path, patterns: patterns.into_values().collect(), locations, names, circle_centers, diagnostics })
}

fn event_result_diagnostic(pattern_id: i32, rows: &[Flag]) -> Option<AppError> {
    let count = rows.iter().filter(|row| row.modifier != 0 || row.event_flag != 0).count();
    let mut used = 0;
    for row in rows {
        // FUN_1406abaf0 checks capacity BEFORE skipping a zero-valued row.
        // Even an empty row after the twentieth occupied slot invalidates the Pattern.
        if used >= EVENT_RESULT_CAPACITY {
            return Some(if count > EVENT_RESULT_CAPACITY {
                AppError::params("errors.eventCapacity", serde_json::json!({
                    "patternId": pattern_id, "count": count, "limit": EVENT_RESULT_CAPACITY, "rowId": row.row_id
                }))
            } else {
                AppError::params("errors.eventTrailingRow", serde_json::json!({
                    "patternId": pattern_id, "count": count, "limit": EVENT_RESULT_CAPACITY, "rowId": row.row_id
                }))
            });
        }
        if row.modifier != 0 || row.event_flag != 0 { used += 1; }
    }
    None
}

fn pattern_result_diagnostics(reg: &Regulation) -> AppResult<Vec<AppError>> {
    let mut diagnostics = Vec::new();
    for (name, size) in [("LotResultMapPatternFlag", 28), ("LotResultSmallBaseAndSpot", 24)] {
        let rows = reg.table(name, size)?.rows.into_iter().map(|(id, at)| {
            Ok((id, at, i32le(&reg.bnd, at + 4)?))
        }).collect::<AppResult<Vec<_>>>()?;
        let mut reported = HashSet::new();
        for pair in rows.windows(2) {
            let (row_id, _, pattern_id) = pair[1];
            if pattern_id < pair[0].2 && reported.insert(pattern_id) {
                diagnostics.push(if name == "LotResultMapPatternFlag" {
                    AppError::params("errors.flagRowOrder", serde_json::json!({"patternId": pattern_id, "rowId": row_id}))
                } else {
                    AppError::params("errors.spotRowOrder", serde_json::json!({"patternId": pattern_id, "rowId": row_id}))
                });
            }
        }
        if name == "LotResultMapPatternFlag" {
            // Inspect each contiguous group in physical order, as the game does.
            for group in rows.chunk_by(|first, second| first.2 == second.2) {
                let flags = group.iter().map(|&(row_id, at, _)| Ok(Flag {
                    row_id, modifier_set: i32le(&reg.bnd, at + 8)?,
                    modifier: i32le(&reg.bnd, at + 12)?, event_flag: u32le(&reg.bnd, at + 16)?,
                })).collect::<AppResult<Vec<_>>>()?;
                if let Some(error) = event_result_diagnostic(group[0].2, &flags) { diagnostics.push(error); }
            }
        }
    }
    Ok(diagnostics)
}

fn field_spec(table: &str, field: &str) -> AppResult<(&'static str, usize, usize, bool)> {
    let spec = match (table, field) {
        ("spot", "unitId") => ("LotResultSmallBaseAndSpot", 12, 4, true),
        ("spot", "variationId") => ("LotResultSmallBaseAndSpot", 17, 1, false),
        ("spot", "modifier") => ("LotResultSmallBaseAndSpot", 20, 4, true),
        ("spot", "attachId") => ("LotResultSmallBaseAndSpot", 8, 4, true),
        ("spot", "mapIndex") => ("LotResultSmallBaseAndSpot", 16, 1, false),
        ("flag", "modifierSet") => ("LotResultMapPatternFlag", 8, 4, true),
        ("flag", "modifier") => ("LotResultMapPatternFlag", 12, 4, true),
        ("flag", "eventFlag") => ("LotResultMapPatternFlag", 16, 4, false),
        ("play", "playArea1") => ("LotResultPlayAreaParam", 8, 4, true),
        ("play", "playArea2") => ("LotResultPlayAreaParam", 12, 4, true),
        ("play", "bossId1") => ("LotResultPlayAreaParam", 16, 2, true),
        ("play", "bossId2") => ("LotResultPlayAreaParam", 18, 2, true),
        ("play", "extraBossId1") => ("LotResultPlayAreaParam", 20, 2, true),
        ("play", "extraBossId2") => ("LotResultPlayAreaParam", 22, 2, true),
        ("play", "bossModifier1") => ("LotResultPlayAreaParam", 24, 4, true),
        ("play", "bossModifier2") => ("LotResultPlayAreaParam", 28, 4, true),
        ("play", "extraBossModifier1") => ("LotResultPlayAreaParam", 32, 4, true),
        ("play", "extraBossModifier2") => ("LotResultPlayAreaParam", 36, 4, true),
        _ => return Err(AppError::params("errors.fieldNotEditable", serde_json::json!({"table": table, "field": field}))),
    };
    Ok(spec)
}

fn read_value(data: &[u8], at: usize, size: usize, signed: bool) -> AppResult<i64> {
    Ok(match (size, signed) {
        (1, false) => range(data, at, 1)?[0] as i64,
        (2, true) => i16le(data, at)? as i64,
        (4, true) => i32le(data, at)? as i64,
        (4, false) => u32le(data, at)? as i64,
        _ => return Err(AppError::new("errors.valueType")),
    })
}

fn write_value(data: &mut [u8], at: usize, size: usize, signed: bool, value: i64) -> AppResult<()> {
    let bytes = match (size, signed) {
        (1, false) => vec![u8::try_from(value).map_err(|_| AppError::new("errors.variantRange"))?],
        (2, true) => i16::try_from(value).map_err(|_| AppError::new("errors.bossRange"))?.to_le_bytes().to_vec(),
        (4, true) => i32::try_from(value).map_err(|_| AppError::new("errors.signedValueRange"))?.to_le_bytes().to_vec(),
        (4, false) => u32::try_from(value).map_err(|_| AppError::new("errors.flagRange"))?.to_le_bytes().to_vec(),
        _ => return Err(AppError::new("errors.valueType")),
    };
    data.get_mut(at..at + size).ok_or(AppError::new("errors.writeBounds"))?.copy_from_slice(&bytes);
    Ok(())
}

fn row_table(table: &str) -> AppResult<(&'static str, usize)> {
    match table {
        "spot" => Ok(("LotResultSmallBaseAndSpot", 24)),
        "flag" => Ok(("LotResultMapPatternFlag", 28)),
        "play" => Ok(("LotResultPlayAreaParam", 40)),
        _ => Err(AppError::params("errors.rowTable", serde_json::json!({"table": table}))),
    }
}

fn rewrite_param(data: &[u8], row_size: usize, additions: &[(i32, Vec<u8>)], removals: &HashSet<i32>, group_by_pattern: bool) -> AppResult<Vec<u8>> {
    range(data, 0, 0x40)?;
    let count = u16le(data, 0x0a)? as usize;
    let mut rows = BTreeMap::new();
    let mut data_end = 0x40 + count * 24;
    for i in 0..count {
        let header = 0x40 + i * 24;
        let offset = usize::try_from(i64le(data, header + 8)?).map_err(|_| AppError::new("errors.invalidData"))?;
        let bytes = range(data, offset, row_size)?.to_vec();
        data_end = data_end.max(offset + row_size);
        if rows.insert(i32le(data, header)?, (range(data, header, 24)?.to_vec(), bytes)).is_some() {
            return Err(AppError::new("errors.duplicateRow"));
        }
    }
    for id in removals {
        if rows.remove(id).is_none() { return Err(AppError::params("errors.rowMissing", serde_json::json!({"rowId": id}))); }
    }
    for (id, bytes) in additions {
        if bytes.len() != row_size || rows.contains_key(id) { return Err(AppError::new("errors.duplicateRow")); }
        let mut header = vec![0; 24];
        header[..4].copy_from_slice(&id.to_le_bytes());
        rows.insert(*id, (header, bytes.clone()));
    }
    let mut rows = rows.into_iter().map(|(id, (header, bytes))| {
        let pattern = if group_by_pattern { i32le(&bytes, 4)? } else { 0 };
        Ok((pattern, id, header, bytes))
    }).collect::<AppResult<Vec<_>>>()?;
    // The game scans LotResult rows by their physical order and stops at the
    // next Pattern. Its separate Row ID lookup index is sorted on load, so
    // keep every ID while placing each Pattern's rows in one ascending group.
    rows.sort_by_key(|(pattern, id, _, _)| (*pattern, *id));
    let total = rows.len();
    let encoded_count = u16::try_from(total).map_err(|_| AppError::new("errors.rowCountLimit"))?;
    let data_start = 0x40 + total * 24;
    let new_data_end = data_start + total * row_size;
    let shift = new_data_end as i64 - data_end as i64;
    let relocate = |offset: i64| -> AppResult<i64> {
        if offset == 0 { return Ok(0); }
        if offset < data_end as i64 || offset >= data.len() as i64 { return Err(AppError::new("errors.invalidData")); }
        Ok(offset + shift)
    };
    let mut result = range(data, 0, 0x40)?.to_vec();
    result.resize(new_data_end, 0);
    result.extend_from_slice(range(data, data_end, data.len() - data_end)?);
    result[0x0a..0x0c].copy_from_slice(&encoded_count.to_le_bytes());
    result[0x30..0x38].copy_from_slice(&(data_start as i64).to_le_bytes());
    let strings = u32le(data, 0)? as i64;
    let strings = if strings >= data_end as i64 { strings + shift } else { new_data_end as i64 };
    result[..4].copy_from_slice(&u32::try_from(strings).map_err(|_| AppError::new("errors.invalidData"))?.to_le_bytes());
    if data[0x2d] & 0x80 != 0 {
        result[0x10..0x18].copy_from_slice(&relocate(i64le(data, 0x10)?)?.to_le_bytes());
    }
    for (i, (_, _, mut header, bytes)) in rows.into_iter().enumerate() {
        let offset = data_start + i * row_size;
        let name = relocate(i64le(&header, 16)?)?;
        header[8..16].copy_from_slice(&(offset as i64).to_le_bytes());
        header[16..24].copy_from_slice(&name.to_le_bytes());
        result[0x40 + i * 24..0x40 + (i + 1) * 24].copy_from_slice(&header);
        result[offset..offset + row_size].copy_from_slice(&bytes);
    }
    Ok(result)
}

fn insert_rows(reg: &mut Regulation, additions: &[RowAddition]) -> AppResult<()> {
    if additions.is_empty() { return Ok(()); }
    let flags = reg.table("LotResultMapPatternFlag", 28)?;
    let metadata: HashMap<_, _> = flags.rows.iter().map(|(_, at)| Ok((i32le(&reg.bnd, at + 4)?,
        (i16le(&reg.bnd, at + 20)?, i16le(&reg.bnd, at + 22)?, i32le(&reg.bnd, at + 24)?)))).collect::<AppResult<_>>()?;
    let mut groups = BTreeMap::<&str, Vec<&RowAddition>>::new();
    for addition in additions { groups.entry(&addition.table).or_default().push(addition); }
    for (table_name, group) in groups {
        let (name, row_size) = row_table(table_name)?;
        let table = reg.table(name, row_size)?;
        let mut ids: HashSet<_> = table.rows.iter().map(|(id, _)| *id).collect();
        let mut owners: HashSet<_> = table.rows.iter().map(|(_, at)| i32le(&reg.bnd, at + 4)).collect::<AppResult<_>>()?;
        let mut added = Vec::new();
        for addition in group {
            if addition.row_id < 0 || !ids.insert(addition.row_id) {
                return Err(AppError::params("errors.rowExists", serde_json::json!({"table": table_name, "rowId": addition.row_id})));
            }
            let (pattern_set, nightlord, terrain) = metadata.get(&addition.pattern_id)
                .ok_or_else(|| AppError::params("errors.patternMissing", serde_json::json!({"patternId": addition.pattern_id})))?;
            if table_name == "play" && !owners.insert(addition.pattern_id) {
                return Err(AppError::params("errors.playRowExists", serde_json::json!({"patternId": addition.pattern_id})));
            }
            let mut bytes = if let Some((_, source)) = table.rows.iter().find(|(id, _)| *id == addition.source_row_id) {
                range(&reg.bnd, *source, row_size)?.to_vec()
            } else {
                // A removed row can still serve as a template after reimport.
                let bundled = Regulation::load(None)?;
                let source = bundled.table(name, row_size)?.rows.into_iter().find(|(id, _)| *id == addition.source_row_id)
                    .ok_or_else(|| AppError::params("errors.rowMissing", serde_json::json!({"rowId": addition.source_row_id})))?.1;
                range(&bundled.bnd, source, row_size)?.to_vec()
            };
            bytes[4..8].copy_from_slice(&addition.pattern_id.to_le_bytes());
            if table_name == "flag" {
                bytes[20..22].copy_from_slice(&pattern_set.to_le_bytes());
                bytes[22..24].copy_from_slice(&nightlord.to_le_bytes());
                bytes[24..28].copy_from_slice(&terrain.to_le_bytes());
            }
            for (field, value) in &addition.fields {
                let (_, offset, size, signed) = field_spec(table_name, field)?;
                write_value(&mut bytes, offset, size, signed, *value)?;
            }
            added.push((addition.row_id, bytes));
        }
        let entry = reg.entries.iter().find(|entry| entry.name.to_lowercase().ends_with(&format!("{name}.param").to_lowercase())).unwrap();
        let data = rewrite_param(range(&reg.bnd, entry.offset, entry.size)?, row_size, &added, &HashSet::new(), true)?;
        reg.replace_param(name, data)?;
    }
    Ok(())
}

fn remove_rows(reg: &mut Regulation, removals: &[RowRemoval]) -> AppResult<()> {
    let mut groups = BTreeMap::<&str, Vec<&RowRemoval>>::new();
    for removal in removals {
        if !matches!(removal.table.as_str(), "spot" | "flag") {
            return Err(AppError::params("errors.rowTable", serde_json::json!({"table": removal.table})));
        }
        groups.entry(&removal.table).or_default().push(removal);
    }
    for (kind, removals) in groups {
        let (name, size) = row_table(kind)?;
        let table = reg.table(name, size)?;
        let mut ids = HashSet::new();
        for removal in &removals {
            if !ids.insert(removal.row_id) { return Err(AppError::new("errors.duplicateRow")); }
            let at = table.rows.iter().find(|(id, _)| *id == removal.row_id)
                .ok_or_else(|| AppError::params("errors.rowMissing", serde_json::json!({"rowId": removal.row_id})))?.1;
            if i32le(&reg.bnd, at + 4)? != removal.pattern_id { return Err(AppError::new("errors.rowPattern")); }
            if kind == "flag" {
                let set = i32le(&reg.bnd, at + 8)?;
                let modifier = i32le(&reg.bnd, at + 12)?;
                let flag = u32le(&reg.bnd, at + 16)?;
                let terrain = i32le(&reg.bnd, at + 24)?;
                let selector = set == 0 && [(120, 0), (140, 0), (180, 0), (200, 0), (210, 0), (230, 0),
                    (600, 8077), (601, 8078), (602, 8079), (603, 8076), (604, 8075),
                    (10000, 8080), (10001, 8081)].contains(&(modifier, flag));
                let support = set == 3100 && modifier == 220 && flag == 0;
                if !((3000..=3130).contains(&set) || (500..=560).contains(&set) || set == 3500 ||
                    selector || support || terrain == 4 && [0, 1000].contains(&set) && [1038400230, 1046400230].contains(&flag)) {
                    return Err(AppError::params("errors.rowNotEvent", serde_json::json!({"rowId": removal.row_id})));
                }
            }
        }
        if kind == "flag" {
            let remaining: HashSet<_> = table.rows.iter().filter(|(id, _)| !ids.contains(id))
                .map(|(_, at)| i32le(&reg.bnd, at + 4)).collect::<AppResult<_>>()?;
            for removal in &removals {
                if !remaining.contains(&removal.pattern_id) {
                    return Err(AppError::params("errors.lastPatternFlag", serde_json::json!({"patternId": removal.pattern_id})));
                }
            }
        }
        let suffix = format!("{name}.param").to_lowercase();
        let entry = reg.entries.iter().find(|entry| entry.name.to_lowercase().ends_with(&suffix)).unwrap();
        let data = rewrite_param(range(&reg.bnd, entry.offset, entry.size)?, size, &[], &ids, true)?;
        reg.replace_param(name, data)?;
    }
    Ok(())
}

fn validate_location_units(reg: &Regulation, patterns: &HashSet<i32>) -> AppResult<()> {
    if patterns.is_empty() { return Ok(()); }
    let flags = reg.table("LotResultMapPatternFlag", 28)?;
    let terrains: HashMap<_, _> = flags.rows.iter().map(|(_, at)| Ok((i32le(&reg.bnd, at + 4)?, i32le(&reg.bnd, at + 24)?)))
        .collect::<AppResult<_>>()?;
    let (_, by_attach) = parse_locations()?;
    let mut locations = HashSet::new();
    for (_, at) in reg.table("LotResultSmallBaseAndSpot", 24)?.rows {
        let owner = i32le(&reg.bnd, at + 4)?;
        if !patterns.contains(&owner) { continue; }
        let attach = i32le(&reg.bnd, at + 8)?;
        let unit = i32le(&reg.bnd, at + 12)?;
        let terrain = *terrains.get(&owner).ok_or_else(|| AppError::params("errors.patternMissing", serde_json::json!({"patternId": owner})))?;
        if hidden(unit, attach, terrain) { continue; }
        if let Some(index) = by_attach.get(&attach) {
            if !locations.insert((owner, *index)) {
                return Err(AppError::params("errors.locationUnitExists", serde_json::json!({"patternId": owner, "location": index})));
            }
        }
    }
    Ok(())
}

fn normalize_map_indices(reg: &mut Regulation, patterns: &HashSet<i32>) -> AppResult<()> {
    if patterns.is_empty() { return Ok(()); }
    let mut groups = BTreeMap::<(i32, i32), Vec<(i32, usize)>>::new();
    for (id, at) in reg.table("LotResultSmallBaseAndSpot", 24)?.rows {
        let owner = i32le(&reg.bnd, at + 4)?;
        if patterns.contains(&owner) {
            groups.entry((owner, i32le(&reg.bnd, at + 12)?)).or_default().push((id, at));
        }
    }
    for ((owner, _), mut rows) in groups {
        if rows.len() > 256 { return Err(AppError::params("errors.mapIndexLimit", serde_json::json!({"patternId": owner}))); }
        rows.sort_by_key(|(id, _)| *id);
        let mut used: HashSet<_> = rows.iter().map(|(_, at)| reg.bnd[at + 16]).collect();
        let mut seen = HashSet::new();
        for (_, at) in rows {
            let index = reg.bnd[at + 16];
            if seen.insert(index) { continue; }
            let next = (0..=u8::MAX).find(|index| !used.contains(index))
                .ok_or_else(|| AppError::params("errors.mapIndexLimit", serde_json::json!({"patternId": owner})))?;
            reg.bnd[at + 16] = next;
            used.insert(next);
        }
    }
    Ok(())
}

fn restore_patterns(reg: &mut Regulation, patterns: &[i32]) -> AppResult<()> {
    if patterns.is_empty() { return Ok(()); }
    let patterns: HashSet<_> = patterns.iter().copied().collect();
    let builtin = Regulation::load(None)?;
    let owners: HashSet<_> = builtin.table("LotResultMapPatternFlag", 28)?.rows.iter()
        .map(|(_, at)| i32le(&builtin.bnd, at + 4)).collect::<AppResult<_>>()?;
    for id in &patterns {
        if !owners.contains(id) { return Err(AppError::params("errors.patternMissing", serde_json::json!({"patternId": id}))); }
    }
    for (name, size) in [("LotResultMapPatternFlag", 28), ("LotResultSmallBaseAndSpot", 24), ("LotResultPlayAreaParam", 40)] {
        let current = reg.table(name, size)?;
        let removals: HashSet<_> = current.rows.iter().filter_map(|(id, at)| match i32le(&reg.bnd, at + 4) {
            Ok(owner) if patterns.contains(&owner) => Some(Ok(*id)),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        }).collect::<AppResult<_>>()?;
        let retained: HashSet<_> = current.rows.iter().map(|(id, _)| *id).filter(|id| !removals.contains(id)).collect();
        let mut additions = Vec::new();
        for (id, at) in builtin.table(name, size)?.rows {
            if !patterns.contains(&i32le(&builtin.bnd, at + 4)?) { continue; }
            if retained.contains(&id) {
                return Err(AppError::params("errors.rowExists", serde_json::json!({"table": name, "rowId": id})));
            }
            additions.push((id, range(&builtin.bnd, at, size)?.to_vec()));
        }
        let suffix = format!("{name}.param").to_lowercase();
        let entry = reg.entries.iter().find(|entry| entry.name.to_lowercase().ends_with(&suffix)).unwrap();
        let data = rewrite_param(range(&reg.bnd, entry.offset, entry.size)?, size, &additions, &removals, true)?;
        reg.replace_param(name, data)?;
    }
    Ok(())
}

pub fn save_changes(input: Option<String>, output: String, patches: Vec<Patch>, additions: Vec<RowAddition>, removals: Vec<RowRemoval>, restorations: Vec<i32>) -> AppResult<String> {
    let target = Path::new(&output);
    if target.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase()) != Some("bin".into()) { return Err(AppError::new("errors.outputExtension")); }
    let mut reg = Regulation::load(input.as_deref())?;
    restore_patterns(&mut reg, &restorations)?;
    insert_rows(&mut reg, &additions)?;
    let mut tables = HashMap::new();
    for (name, size) in [("LotResultSmallBaseAndSpot",24),("LotResultMapPatternFlag",28),("LotResultPlayAreaParam",40)] {
        tables.insert(name, reg.table(name, size)?);
    }
    let mut seen = HashSet::new();
    for patch in &patches {
        if !seen.insert((patch.table.as_str(), patch.row_id, patch.field.as_str())) { return Err(AppError::new("errors.duplicatePatch")); }
        let (table_name, field_offset, size, signed) = field_spec(&patch.table, &patch.field)?;
        let table = tables.get(table_name).unwrap();
        if field_offset + size > table.row_size { return Err(AppError::new("errors.fieldBounds")); }
        let at = table.rows.iter().find(|(id,_)| *id == patch.row_id).map(|(_,at)| *at)
            .ok_or_else(|| AppError::params("errors.rowMissing", serde_json::json!({"rowId": patch.row_id})))?;
        if i32le(&reg.bnd, at + 4)? != patch.pattern_id { return Err(AppError::new("errors.rowPattern")); }
        let current = read_value(&reg.bnd, at + field_offset, size, signed)?;
        if current != patch.old_value { return Err(AppError::params("errors.stalePatch", serde_json::json!({"rowId": patch.row_id, "field": patch.field}))); }
        write_value(&mut reg.bnd, at + field_offset, size, signed, patch.new_value)?;
    }
    remove_rows(&mut reg, &removals)?;
    let affected: HashSet<_> = patches.iter().filter(|patch| patch.table == "spot").map(|patch| patch.pattern_id)
        .chain(additions.iter().filter(|addition| addition.table == "spot").map(|addition| addition.pattern_id))
        .chain(removals.iter().filter(|removal| removal.table == "spot").map(|removal| removal.pattern_id))
        .chain(restorations).collect();
    validate_location_units(&reg, &affected)?;
    normalize_map_indices(&mut reg, &affected)?;
    if let Some(error) = pattern_result_diagnostics(&reg)?.into_iter().next() { return Err(error); }
    let bytes = reg.encode()?;
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| AppError::diagnostic("errors.temporaryFile", e))?;
    temp.write_all(&bytes).map_err(|e| AppError::diagnostic("errors.temporaryFileWrite", e))?;
    temp.flush().map_err(|e| AppError::diagnostic("errors.invalidData", e))?;
    temp.as_file().sync_all().map_err(|e| AppError::diagnostic("errors.temporaryFileWrite", e))?;
    temp.persist(target).map_err(|e| AppError::diagnostic("errors.regulationWrite", e))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reproduce the retained cursor and first-contiguous-group scan in
    // nightreign.exe FUN_1406abaf0, rather than the editor's full-table filter.
    fn game_pattern_row_groups(reg: &Regulation, name: &str, size: usize, patterns: &[i32]) -> BTreeMap<i32, Vec<i32>> {
        let table = reg.table(name, size).unwrap();
        let mut result = BTreeMap::new();
        let mut cursor = 0;
        for &pattern in patterns {
            let mut found = Vec::new();
            for index in cursor..table.rows.len() {
                let (id, at) = table.rows[index];
                if i32le(&reg.bnd, at + 4).unwrap() == pattern {
                    found.push(id);
                } else if !found.is_empty() {
                    cursor = index;
                    break;
                }
            }
            result.insert(pattern, found);
        }
        result
    }

    fn all_pattern_row_groups(reg: &Regulation, name: &str, size: usize) -> BTreeMap<i32, Vec<i32>> {
        let mut result = BTreeMap::<_, Vec<_>>::new();
        for (id, at) in reg.table(name, size).unwrap().rows {
            result.entry(i32le(&reg.bnd, at + 4).unwrap()).or_default().push(id);
        }
        result
    }

    fn additional_events(pattern_id: i32, first_id: i32, count: usize) -> Vec<RowAddition> {
        (0..count).map(|index| RowAddition { pattern_id, table: "flag".into(), row_id: first_id + index as i32,
            source_row_id: 935, fields: BTreeMap::from([
                ("modifierSet".into(), 500), ("modifier".into(), 801), ("eventFlag".into(), 7727)
            ]) }).collect()
    }

    #[test]
    fn complete_morgott_bundle_saves_and_reloads_with_the_target_patterns_metadata() {
        let builtin = load_dataset(None).unwrap();
        let original = builtin.patterns.iter().find(|pattern| pattern.id == 0).unwrap();
        let source = builtin.patterns.iter().find(|pattern| pattern.id == 43).unwrap();
        let schedule = original.flags.iter().find(|row| row.event_flag == 7724).unwrap();
        let selector = original.flags.iter().find(|row| row.modifier == 180).unwrap();
        let support = source.flags.iter().find(|row| row.modifier_set == 3100 && row.modifier == 220).unwrap();
        let patches = vec![
            Patch { pattern_id: 0, table: "flag".into(), row_id: schedule.row_id, field: "modifierSet".into(), old_value: 3030, new_value: 3040 },
            Patch { pattern_id: 0, table: "flag".into(), row_id: schedule.row_id, field: "modifier".into(), old_value: 801, new_value: 800 },
            Patch { pattern_id: 0, table: "flag".into(), row_id: schedule.row_id, field: "eventFlag".into(), old_value: 7724, new_value: 7705 },
            Patch { pattern_id: 0, table: "flag".into(), row_id: selector.row_id, field: "modifier".into(), old_value: 180, new_value: 604 },
            Patch { pattern_id: 0, table: "flag".into(), row_id: selector.row_id, field: "eventFlag".into(), old_value: 0, new_value: 8075 },
        ];
        let additions = vec![RowAddition { pattern_id: 0, table: "flag".into(), row_id: 12232,
            source_row_id: support.row_id, fields: BTreeMap::from([
                ("modifierSet".into(), 3100), ("modifier".into(), 220), ("eventFlag".into(), 0)
            ]) }];
        let removals = original.placements.iter().filter(|row| (4600..=4606).contains(&row.unit_id))
            .map(|row| RowRemoval { pattern_id: 0, table: "spot".into(), row_id: row.row_id }).collect::<Vec<_>>();
        assert!(!removals.is_empty());
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("grouped-event.bin");
        save_changes(None, target.to_string_lossy().into_owned(), patches, additions, removals, vec![]).unwrap();
        let saved = Regulation::load(target.to_str()).unwrap();
        let table = saved.table("LotResultMapPatternFlag", 28).unwrap();
        let target_meta = table.rows.iter().find(|(id, _)| *id == selector.row_id).unwrap().1;
        let added = table.rows.iter().find(|(id, _)| *id == 12232).unwrap().1;
        assert_eq!(&saved.bnd[added + 20..added + 28], &saved.bnd[target_meta + 20..target_meta + 28]);
        let reloaded = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        assert!(reloaded.diagnostics.is_empty());
        let p = reloaded.patterns.iter().find(|pattern| pattern.id == 0).unwrap();
        assert!(p.flags.iter().any(|row| row.modifier == 604 && row.event_flag == 8075));
        assert!(p.flags.iter().any(|row| row.modifier_set == 3100 && row.modifier == 220));
        assert!(p.flags.iter().any(|row| row.modifier_set == 3040 && row.event_flag == 7705));
        assert!(!p.placements.iter().any(|row| (4600..=4606).contains(&row.unit_id)));
        assert_eq!(serde_json::to_value(reloaded.patterns.iter().find(|pattern| pattern.id == 43).unwrap()).unwrap(),
            serde_json::to_value(source).unwrap());
    }

    #[test]
    fn event_capacity_matches_the_game_boundary_and_zero_row_rules() {
        let occupied = |count: usize| (0..count).map(|index| Flag {
            row_id: index as i32 + 1, modifier_set: 500, modifier: 801, event_flag: 7727
        }).collect::<Vec<_>>();
        let empty = Flag { row_id: 45, modifier_set: 3500, modifier: 0, event_flag: 0 };
        let mut nineteen = occupied(19);
        nineteen.extend(vec![empty.clone(); 35]);
        assert!(event_result_diagnostic(0, &nineteen).is_none());
        nineteen.push(occupied(20).pop().unwrap());
        assert!(event_result_diagnostic(0, &nineteen).is_none());
        assert!(event_result_diagnostic(0, &occupied(20)).is_none());
        assert!(event_result_diagnostic(0, &[]).is_none());
        let mut trailing = occupied(20);
        trailing.push(empty);
        let error = event_result_diagnostic(0, &trailing).unwrap();
        assert_eq!(error.code, "errors.eventTrailingRow");
        assert_eq!(error.params, serde_json::json!({"patternId": 0, "count": 20, "limit": 20, "rowId": 45}));
        let error = event_result_diagnostic(15, &occupied(22)).unwrap();
        assert_eq!(error.code, "errors.eventCapacity");
        assert_eq!(error.params, serde_json::json!({"patternId": 15, "count": 22, "limit": 20, "rowId": 21}));
        let mut either = occupied(20);
        either[0].modifier = 0;
        either[1].event_flag = 0;
        assert!(event_result_diagnostic(0, &either).is_none(), "Either field uses one slot; both still use one");
    }

    #[test]
    fn builtin_patterns_have_no_capacity_or_row_order_diagnostics() {
        let data = load_dataset(None).unwrap();
        assert_eq!(data.patterns.len(), 520);
        assert!(data.diagnostics.is_empty());
        assert_eq!(serde_json::to_value(&data).unwrap()["diagnostics"], serde_json::json!([]));
    }

    #[test]
    fn imported_pattern_zero_and_fifteen_overflows_are_diagnosed_without_modifying_files() {
        let mut reg = Regulation::load(None).unwrap();
        let mut additions = additional_events(0, 12232, 12);
        additions.extend(additional_events(15, 12244, 15));
        insert_rows(&mut reg, &additions).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("imported.bin");
        let output = temp.path().join("existing.bin");
        let bytes = reg.encode().unwrap();
        std::fs::write(&source, &bytes).unwrap();
        std::fs::write(&output, BUILTIN).unwrap();
        let data = load_dataset(Some(source.to_string_lossy().into_owned())).unwrap();
        let diagnostics = serde_json::to_value(&data.diagnostics).unwrap();
        assert_eq!(diagnostics, serde_json::json!([
            {"code": "errors.eventCapacity", "params": {"patternId": 0, "count": 22, "limit": 20, "rowId": 12242}},
            {"code": "errors.eventCapacity", "params": {"patternId": 15, "count": 22, "limit": 20, "rowId": 12257}}
        ]));
        let other = data.patterns.iter().find(|p| p.id == 1).unwrap().flags.first().unwrap();
        let patch = Patch { pattern_id: 1, table: "flag".into(), row_id: other.row_id,
            field: "modifier".into(), old_value: other.modifier as i64, new_value: other.modifier as i64 + 1 };
        for target in [&source, &output] {
            let error = save_changes(Some(source.to_string_lossy().into_owned()), target.to_string_lossy().into_owned(),
                vec![patch.clone()], vec![], vec![], vec![]).unwrap_err();
            assert_eq!(error.code, "errors.eventCapacity");
            assert_eq!(error.params["patternId"], 0);
            assert_eq!(std::fs::read(&source).unwrap(), bytes);
            assert_eq!(std::fs::read(&output).unwrap(), BUILTIN);
            assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 2);
        }
        let error = save_changes(Some(source.to_string_lossy().into_owned()), output.to_string_lossy().into_owned(),
            vec![], vec![], vec![], vec![0]).unwrap_err();
        assert_eq!(error.params["patternId"], 15, "An invalid untouched Pattern is checked too");
        save_changes(Some(source.to_string_lossy().into_owned()), output.to_string_lossy().into_owned(),
            vec![], vec![], vec![], vec![0, 15]).unwrap();
        assert!(load_dataset(Some(output.to_string_lossy().into_owned())).unwrap().diagnostics.is_empty());
        assert_eq!(std::fs::read(&source).unwrap(), bytes);
    }

    #[test]
    fn event_capacity_validation_uses_final_patches_additions_and_removals() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        let path = target.to_string_lossy().into_owned();
        save_changes(None, path.clone(), vec![], additional_events(0, 12232, 10), vec![], vec![]).unwrap();
        let bytes = std::fs::read(&target).unwrap();
        let data = load_dataset(Some(path.clone())).unwrap();
        let owner = data.patterns.iter().find(|p| p.id == 0).unwrap();
        assert_eq!(owner.flags.iter().filter(|row| row.modifier != 0 || row.event_flag != 0).count(), 20);
        let empty = owner.flags.iter().find(|row| row.modifier == 0 && row.event_flag == 0).unwrap();
        let error = save_changes(Some(path.clone()), path.clone(), vec![Patch {
            pattern_id: 0, table: "flag".into(), row_id: empty.row_id, field: "modifier".into(), old_value: 0, new_value: 801,
        }], vec![], vec![], vec![]).unwrap_err();
        assert_eq!(error.code, "errors.eventCapacity", "Field-only changes can exceed capacity");
        assert_eq!(std::fs::read(&target).unwrap(), bytes);
        // The intermediate addition state has 23 slots. Clearing one earlier
        // record and removing two added records makes the final state valid.
        save_changes(Some(path.clone()), path.clone(), vec![
            Patch { pattern_id: 0, table: "flag".into(), row_id: 12232, field: "modifier".into(), old_value: 801, new_value: 0 },
            Patch { pattern_id: 0, table: "flag".into(), row_id: 12232, field: "eventFlag".into(), old_value: 7727, new_value: 0 },
        ], additional_events(0, 12242, 3), vec![
            RowRemoval { pattern_id: 0, table: "flag".into(), row_id: 12243 },
            RowRemoval { pattern_id: 0, table: "flag".into(), row_id: 12244 },
        ], vec![]).unwrap();
        let data = load_dataset(Some(path)).unwrap();
        assert!(data.diagnostics.is_empty());
        let owner = data.patterns.iter().find(|p| p.id == 0).unwrap();
        assert_eq!(owner.flags.iter().filter(|row| row.modifier != 0 || row.event_flag != 0).count(), 20);
        assert_eq!(owner.flags.last().unwrap().row_id, 12242);
    }

    #[test]
    fn final_empty_rows_are_rejected_and_restoration_is_validated_after_new_edits() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        let path = target.to_string_lossy().into_owned();
        save_changes(None, path.clone(), vec![], additional_events(0, 12232, 10), vec![], vec![]).unwrap();
        let bytes = std::fs::read(&target).unwrap();
        let mut empty = additional_events(0, 12242, 1);
        empty[0].fields.insert("modifier".into(), 0);
        empty[0].fields.insert("eventFlag".into(), 0);
        let error = save_changes(Some(path.clone()), path.clone(), vec![], empty.clone(), vec![], vec![]).unwrap_err();
        assert_eq!(error.code, "errors.eventTrailingRow");
        assert_eq!(error.params["rowId"], 12242);
        assert_eq!(std::fs::read(&target).unwrap(), bytes);
        save_changes(Some(path.clone()), path.clone(), vec![], empty,
            vec![RowRemoval { pattern_id: 0, table: "flag".into(), row_id: 12241 }], vec![]).unwrap();
        assert!(load_dataset(Some(path.clone())).unwrap().diagnostics.is_empty(), "19 occupied slots can have trailing empty rows");
        let after = std::fs::read(&target).unwrap();
        let error = save_changes(Some(path.clone()), path.clone(), vec![], additional_events(0, 12243, 11), vec![], vec![0]).unwrap_err();
        assert_eq!(error.code, "errors.eventCapacity", "Restoring first does not exempt subsequent additions");
        assert_eq!(std::fs::read(&target).unwrap(), after);
        save_changes(Some(path.clone()), path.clone(), vec![], additional_events(0, 12243, 10), vec![], vec![0]).unwrap();
        assert!(load_dataset(Some(path)).unwrap().diagnostics.is_empty());
    }

    #[test]
    fn reads_utf8_chinese_names_and_optional_empty_translations() {
        let names = parse_names_csv("kind,id,variation,type,name,name_zh\nspot,3000,0,Fort,Lordsworn Captain,  君王军队长  \nspot,4652,0,,Draconic Tree Sentinel,\nspot,4090,0,Difficult Sorcerer's Rise,Above Door,   \n").unwrap();
        assert_eq!(names[0].name_zh.as_deref(), Some("君王军队长"));
        assert_eq!(names[0].name, "Lordsworn Captain");
        assert!(names[1].name_zh.is_none());
        assert!(names[2].name_zh.is_none());
        assert_eq!(serde_json::to_value(&names[0]).unwrap()["nameZh"], "君王军队长");
        assert!(serde_json::to_value(&names[1]).unwrap()["nameZh"].is_null());
        let legacy = parse_names_csv("kind,id,variation,type,name\nnightlord,0,,,Gladius\n").unwrap();
        assert!(legacy[0].name_zh.is_none());
    }

    #[test]
    fn unit_names_have_separate_optional_types() {
        let names = parse_names().unwrap();
        let named = |kind: &str, id: i32, variation: Option<i32>| {
            names.iter().find(|n| n.kind == kind && n.id == id && n.variation == variation).unwrap()
        };
        let fort = named("spot", 3000, Some(0));
        assert_eq!(fort.unit_type.as_deref(), Some("fort"));
        assert_eq!(fort.name, "Lordsworn Captain");
        let boss = named("spot", 4652, Some(0));
        assert!(boss.unit_type.is_none());
        assert_eq!(boss.name, "Draconic Tree Sentinel");
        let rise = named("spot", 4090, Some(0));
        assert_eq!(rise.unit_type.as_deref(), Some("difficultRise"));
        assert_eq!(rise.name, "Above Door, Teleporting Trees, Missing Statue");
        assert_eq!(named("nightlord", 0, None).name, "Gladius");
        let serialized = serde_json::to_value(fort).unwrap();
        assert_eq!(serialized["type"], "fort");
        assert_eq!(serialized["name"], "Lordsworn Captain");
        assert!(serde_json::to_value(boss).unwrap()["type"].is_null());
    }

    #[test]
    fn loads_bundled_patterns_and_layout() {
        let data = load_dataset(None).unwrap();
        assert_eq!(data.patterns.len(), 520);
        assert_eq!(data.version, VERSION);
        assert_eq!(data.patterns.iter().find(|p| p.id == 1000).unwrap().play.as_ref().unwrap().row_id, 1000);
    }

    #[test]
    fn encoded_regulation_matches_smithbox_compression_and_encryption() {
        let reg = Regulation::load(None).unwrap();
        let encoded = reg.encode().unwrap();
        assert_eq!(&encoded[..16], &reg.iv);
        let mut encrypted = encoded[16..].to_vec();
        let dcx = Decryptor::<Aes256>::new_from_slices(&KEY, &reg.iv).unwrap()
            .decrypt_padded_mut::<Pkcs7>(&mut encrypted).unwrap();
        assert_eq!(&dcx[..4], b"DCX\0");
        assert_eq!(&dcx[0x28..0x2c], b"ZSTD");
        assert_eq!(dcx[0x30], 15);
        assert_eq!(u32be(dcx, 0x1c).unwrap() as usize, reg.bnd.len());
        let size = u32be(dcx, 0x20).unwrap() as usize;
        let frame = range(dcx, 0x4c, size).unwrap();
        // Smithbox's frame has no content size or checksum, and a 64 KiB window.
        assert_eq!(&frame[..6], &[0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x30]);
        assert_eq!(zstd::zstd_safe::get_frame_content_size(frame).unwrap(), None);
        let mut decoder = zstd::stream::read::Decoder::new(frame).unwrap();
        decoder.window_log_max(16).unwrap();
        let mut decoded = Vec::new();
        std::io::Read::read_to_end(&mut decoder, &mut decoded).unwrap();
        assert_eq!(decoded, reg.bnd);
        assert_eq!(dcx.len() % 16, 0);
        assert!(dcx[0x4c + size..].iter().all(|&byte| byte == 0));
        assert_eq!(dcx.len(), (0x4c + size + 15) & !15);
    }

    #[test]
    fn rot_blessings_use_event_map_points_and_cover_every_rotted_woods_pattern() {
        let data = load_dataset(None).unwrap();
        let blessings: Vec<_> = data.locations.iter().filter(|location| location.type_index == Some(7) && location.event_flag.is_some()).collect();
        assert_eq!(blessings.len(), 3);
        for (index, event_flag, x, y, count) in [
            (65, 1046300590, 994.66, 1206.77, 15),
            (66, 1047300590, 871.90, 1024.14, 21),
            (67, 1057300590, 1249.22, 930.28, 14),
        ] {
            let location = blessings.iter().find(|location| location.index == index).unwrap();
            assert_eq!(location.type_index, Some(7));
            assert_eq!(location.event_flag, Some(event_flag));
            assert!((location.x - x).abs() < 0.001 && (location.y - y).abs() < 0.001);
            assert_eq!(data.patterns.iter().filter(|pattern| pattern.flags.iter().any(|flag|
                flag.modifier_set == 500 && flag.event_flag == event_flag)).count(), count);
        }
        for pattern in &data.patterns {
            let count = pattern.flags.iter().filter(|flag| flag.modifier_set == 500
                && blessings.iter().any(|location| location.event_flag == Some(flag.event_flag))).count();
            assert_eq!(count, if pattern.terrain_id == 3 { 1 } else { 0 }, "Pattern #{}", pattern.id);
        }
    }

    #[test]
    fn rot_blessing_positions_follow_the_loaded_regulation() {
        let mut reg = Regulation::load(None).unwrap();
        let points = reg.table("WorldMapPointParam", 128).unwrap();
        let at = points.rows.iter().find(|(id, _)| *id == 64443630).unwrap().1;
        reg.bnd[at + 32..at + 36].copy_from_slice(&50_f32.to_le_bytes());
        let mut locations = Vec::new();
        add_rot_blessing_locations(&reg, &mut locations).unwrap();
        let southwest = locations.iter().find(|location| location.index == 65).unwrap();
        assert_eq!(southwest.x, 946.0);
    }

    #[test]
    fn castle_positions_use_map_icons_and_preserve_other_locations() {
        let data = load_dataset(None).unwrap();
        let (original, _) = parse_locations().unwrap();
        for (index, x, y) in [(10, 695.92, 832.12), (79, 985.214, 1001.773), (81, 534.67, 475.64)] {
            let location = data.locations.iter().find(|l| l.index == index).unwrap();
            assert!((location.x - x).abs() < 0.001 && (location.y - y).abs() < 0.001, "Castle #{index}");
        }
        for before in original.iter().filter(|l| ![10, 79, 81].contains(&l.index)) {
            let after = data.locations.iter().find(|l| l.index == before.index).unwrap();
            assert_eq!((after.x, after.y), (before.x, before.y), "location #{}", before.index);
        }
        for pattern in &data.patterns {
            for spot in &pattern.placements {
                if [190, 2190, 1135, 1141].contains(&spot.attach_id) {
                    assert_eq!(spot.location_index, Some(match spot.attach_id {
                        190 | 2190 => 10, 1135 => 79, 1141 => 81, _ => unreachable!(),
                    }));
                }
            }
        }
    }

    #[test]
    fn frenzy_tower_positions_cover_every_bundled_frenzy_event() {
        let data = load_dataset(None).unwrap();
        let towers: Vec<_> = data.locations.iter().filter(|location| location.type_index == Some(8)).collect();
        assert_eq!(towers.len(), 4);
        let frenzy: Vec<_> = data.patterns.iter().filter(|pattern| pattern.flags.iter().any(|flag|
            [3080, 500, 530].contains(&flag.modifier_set) && [7707, 7727].contains(&flag.event_flag))).collect();
        assert_eq!(frenzy.len(), 14);
        for (index, event_flag, scope, x, y, count) in [
            (118, 1044380230, "Surface", 772.44, 532.58, 1),
            (119, 1044360220, "Surface", 809.0, 1051.0, 6),
            (120, 1038400230, "Great Hollow", 621.84, 729.05, 3),
            (121, 1046400230, "Great Hollow", 827.92, 1045.33, 4),
        ] {
            let location = towers.iter().find(|location| location.index == index).unwrap();
            assert_eq!(location.event_flag, Some(event_flag));
            assert_eq!(location.scope, scope);
            assert!((location.x - x).abs() < 0.001 && (location.y - y).abs() < 0.001);
            assert_eq!(frenzy.iter().filter(|pattern| pattern.flags.iter().any(|flag| flag.event_flag == event_flag)).count(), count);
        }
        for pattern in frenzy {
            assert_eq!(towers.iter().filter(|location| pattern.flags.iter().any(|flag|
                Some(flag.event_flag) == location.event_flag)).count(), 1, "Pattern #{}", pattern.id);
        }
    }

    #[test]
    fn frenzy_tower_positions_follow_loaded_map_points_and_reject_invalid_coordinates() {
        let mut reg = Regulation::load(None).unwrap();
        let points = reg.table("WorldMapPointParam", 128).unwrap();
        for (row_id, index, expected_x) in [(30100, 118, 946.0), (30101, 119, 946.0), (163384000, 120, 690.0), (163464000, 121, 946.0)] {
            let at = points.rows.iter().find(|(id, _)| *id == row_id).unwrap().1;
            reg.bnd[at + 32..at + 36].copy_from_slice(&50_f32.to_le_bytes());
            let mut locations = Vec::new();
            add_frenzy_tower_locations(&reg, &mut locations).unwrap();
            assert_eq!(locations.iter().find(|location| location.index == index).unwrap().x, expected_x);
        }
        let at = points.rows.iter().find(|(id, _)| *id == 30100).unwrap().1;
        reg.bnd[at + 32..at + 36].copy_from_slice(&f32::NAN.to_le_bytes());
        let error = add_frenzy_tower_locations(&reg, &mut Vec::new()).unwrap_err();
        assert_eq!(error.code, "errors.frenzyTowerCoordinates");
    }

    #[test]
    fn castle_positions_follow_imported_regulation() {
        let mut reg = Regulation::load(None).unwrap();
        let points = reg.table("WorldMapPointParam", 128).unwrap();
        for (id, grid_x, grid_z, pos_x, pos_z) in [
            (64433700, 43, 37, 60.0_f32, 70.0_f32),
            (1104, 44, 36, 80.0_f32, -100.0_f32),
            (1100, 42, 38, -90.0_f32, -80.0_f32),
        ] {
            let at = points.rows.iter().find(|(row_id, _)| *row_id == id).unwrap().1;
            reg.bnd[at + 29] = grid_x;
            reg.bnd[at + 30] = grid_z;
            reg.bnd[at + 32..at + 36].copy_from_slice(&pos_x.to_le_bytes());
            reg.bnd[at + 40..at + 44].copy_from_slice(&pos_z.to_le_bytes());
        }
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        std::fs::write(&target, reg.encode().unwrap()).unwrap();
        let data = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        for (index, x, y) in [(10, 700.0, 826.0), (79, 976.0, 1252.0), (81, 294.0, 720.0)] {
            let location = data.locations.iter().find(|l| l.index == index).unwrap();
            assert_eq!((location.x, location.y), (x, y), "Castle #{index}");
        }
    }

    #[test]
    fn circle_positions_match_community_maps() {
        let data = load_dataset(None).unwrap();
        // Reference image coordinates, including all terrain-specific circles.
        for (id, x, y) in [
            (1000, 410.0, 1156.0), (1001, 330.0, 619.0), (1002, 330.0, 323.0),
            (1003, 728.0, 1181.0), (1004, 565.0, 1064.0), (1005, 657.0, 954.0),
            (1006, 556.0, 702.0), (1007, 843.0, 832.0), (1008, 862.0, 406.0),
            (1009, 1064.0, 1056.0), (1010, 1104.0, 814.0), (1011, 1234.0, 366.0),
            (1021, 944.90, 1060.65), (1022, 1121.47, 842.13), (1023, 613.46, 604.18),
            (1024, 728.99, 287.29), (1025, 676.38, 854.68),
            (11000, 544.0, 1031.0), (11001, 715.0, 671.0), (11002, 951.69, 860.96),
            (12000, 341.0, 526.0), (12001, 1101.0, 1144.0),
        ] {
            let center = data.circle_centers.iter().find(|c| c.id == id).unwrap();
            assert!((center.x - x).abs() < 0.01 && (center.y - y).abs() < 0.01, "circle #{id}");
            assert_eq!(center.source, if id >= 12000 { "community" } else { "playArea" });
        }
        for play in data.patterns.iter().filter_map(|p| p.play.as_ref()) {
            for id in [play.play_area1, play.play_area2] {
                let center = data.circle_centers.iter().find(|c| c.id == id).unwrap();
                assert_ne!(center.source, "default", "uncalibrated circle #{id}");
                assert!((0.0..=1536.0).contains(&center.x) && (0.0..=1536.0).contains(&center.y));
            }
        }
        assert_eq!(data.circle_centers.iter().find(|c| c.id == 19998).unwrap().source, "default");
    }

    #[test]
    fn circle_positions_follow_loaded_param_coordinates() {
        let mut reg = Regulation::load(None).unwrap();
        let table = reg.table("PlayAreaCreateParam", 64).unwrap();
        let at = table.rows.iter().find(|(id, _)| *id == 1000).unwrap().1;
        reg.bnd[at + 8..at + 12].copy_from_slice(&36.0_f32.to_le_bytes());
        let centers = circle_centers(&reg).unwrap();
        let center = centers.iter().find(|c| c.id == 1000).unwrap();
        assert_eq!(center.x, 420.0);
        assert_eq!(center.y, 1156.0);
    }

    #[test]
    fn saving_without_changes_preserves_builtin_and_imported_parameters() {
        let temp = tempfile::tempdir().unwrap();
        let builtin_copy = temp.path().join("builtin.bin");
        let builtin_path = builtin_copy.to_string_lossy().into_owned();
        save_changes(None, builtin_path.clone(), vec![], vec![], vec![], vec![]).unwrap();
        assert_eq!(Regulation::load(Some(&builtin_path)).unwrap().bnd, Regulation::load(None).unwrap().bnd);

        save_changes(Some(builtin_path.clone()), builtin_path.clone(), vec![Patch {
            pattern_id: 1000, table: "play".into(), row_id: 1000,
            field: "playArea1".into(), old_value: 1000, new_value: 1001,
        }], vec![], vec![], vec![]).unwrap();
        let imported = Regulation::load(Some(&builtin_path)).unwrap();
        let copy_path = temp.path().join("copy.bin").to_string_lossy().into_owned();
        for output in [copy_path, builtin_path.clone()] {
            save_changes(Some(builtin_path.clone()), output.clone(), vec![], vec![], vec![], vec![]).unwrap();
            assert_eq!(Regulation::load(Some(&output)).unwrap().bnd, imported.bnd);
        }
    }

    #[test]
    fn roundtrip_changes_only_requested_field() {
        let original = Regulation::load(None).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        save_changes(None, target.to_string_lossy().into_owned(), vec![Patch {
            pattern_id: 1000, table: "play".into(), row_id: 1000, field: "playArea1".into(), old_value: 1000, new_value: 1001,
        }], vec![], vec![], vec![]).unwrap();
        let saved = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        assert_eq!(saved.bnd.len(), original.bnd.len());
        let differences: Vec<_> = original.bnd.iter().zip(&saved.bnd).enumerate().filter(|(_, (a,b))| a != b).collect();
        assert!(differences.len() <= 4 && !differences.is_empty());
        let data = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        let play = data.patterns.iter().find(|p| p.id == 1000).unwrap().play.as_ref().unwrap();
        assert_eq!(play.play_area1, 1001);
        let center = data.circle_centers.iter().find(|c| c.id == play.play_area1).unwrap();
        assert_eq!((center.x, center.y), (330.0, 619.0));
    }

    #[test]
    fn saving_can_replace_the_source_repeatedly_without_changing_builtin_data() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        std::fs::write(&target, BUILTIN).unwrap();
        let path = target.to_string_lossy().into_owned();
        let original = Regulation::load(Some(&path)).unwrap();
        for (old_value, new_value, output) in [
            (1000, 1001, target.clone()),
            (1001, 1002, temp.path().join(".").join("regulation.bin")),
        ] {
            save_changes(Some(path.clone()), output.to_string_lossy().into_owned(), vec![Patch {
                pattern_id: 1000, table: "play".into(), row_id: 1000,
                field: "playArea1".into(), old_value, new_value,
            }], vec![], vec![], vec![]).unwrap();
            let saved = Regulation::load(Some(&path)).unwrap();
            let table = saved.table("LotResultPlayAreaParam", 40).unwrap();
            let at = table.rows.iter().find(|(id, _)| *id == 1000).unwrap().1;
            assert_eq!(i32le(&saved.bnd, at + 8).unwrap(), new_value as i32);
            let mut expected = original.bnd.clone();
            expected[at + 8..at + 12].copy_from_slice(&(new_value as i32).to_le_bytes());
            assert_eq!(saved.bnd, expected);
        }
        assert_eq!(Regulation::load(None).unwrap().bnd, original.bnd);
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_validation_does_not_modify_the_source_when_overwriting() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        std::fs::write(&target, BUILTIN).unwrap();
        let path = target.to_string_lossy().into_owned();
        let error = save_changes(Some(path.clone()), path, vec![Patch {
            pattern_id: 1000, table: "play".into(), row_id: 1000,
            field: "playArea1".into(), old_value: 9999, new_value: 1001,
        }], vec![], vec![], vec![]).unwrap_err();
        assert_eq!(error.code, "errors.stalePatch");
        assert_eq!(std::fs::read(&target).unwrap(), BUILTIN);
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn failed_replacement_of_a_locked_source_preserves_it_and_cleans_up() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        std::fs::write(&target, BUILTIN).unwrap();
        // Allow reading the input, while denying deletion/replacement.
        let _lock = std::fs::OpenOptions::new().read(true).share_mode(1).open(&target).unwrap();
        let path = target.to_string_lossy().into_owned();
        let error = save_changes(Some(path.clone()), path, vec![Patch {
            pattern_id: 1000, table: "play".into(), row_id: 1000,
            field: "playArea1".into(), old_value: 1000, new_value: 1001,
        }], vec![], vec![], vec![]).unwrap_err();
        assert_eq!(error.code, "errors.regulationWrite");
        assert_eq!(std::fs::read(&target).unwrap(), BUILTIN);
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn expanded_params_preserve_names_and_sort_new_row_headers() {
        let mut data = vec![0; 0x80];
        data[0x2d] = 0x85;
        data[0x0a..0x0c].copy_from_slice(&2_u16.to_le_bytes());
        data[..4].copy_from_slice(&0x78_u32.to_le_bytes());
        data[0x10..0x18].copy_from_slice(&0x78_i64.to_le_bytes());
        data[0x30..0x38].copy_from_slice(&0x70_i64.to_le_bytes());
        for (header, id, offset) in [(0x40, 1_i32, 0x70_i64), (0x58, 9, 0x74)] {
            data[header..header + 4].copy_from_slice(&id.to_le_bytes());
            data[header + 8..header + 16].copy_from_slice(&offset.to_le_bytes());
            data[header + 16..header + 24].copy_from_slice(&0x7c_i64.to_le_bytes());
        }
        data[0x70..0x78].copy_from_slice(&[1, 2, 3, 4, 9, 8, 7, 6]);
        data[0x78..].copy_from_slice(b"TYP\0row\0");
        let expanded = rewrite_param(&data, 4, &[(5, vec![5; 4])], &HashSet::new(), false).unwrap();
        assert_eq!(u16le(&expanded, 0x0a).unwrap(), 3);
        assert_eq!(i64le(&expanded, 0x30).unwrap(), 0x88);
        assert_eq!(i64le(&expanded, 0x10).unwrap(), 0x94);
        assert_eq!(&expanded[0x94..], &data[0x78..]);
        for (i, id, bytes) in [(0, 1, vec![1, 2, 3, 4]), (1, 5, vec![5; 4]), (2, 9, vec![9, 8, 7, 6])] {
            let header = 0x40 + i * 24;
            assert_eq!(i32le(&expanded, header).unwrap(), id);
            let offset = i64le(&expanded, header + 8).unwrap() as usize;
            assert_eq!(&expanded[offset..offset + 4], bytes);
            if id != 5 { assert_eq!(i64le(&expanded, header + 16).unwrap(), 0x98); }
        }
        let reduced = rewrite_param(&expanded, 4, &[], &HashSet::from([1, 5]), false).unwrap();
        assert_eq!(u16le(&reduced, 0x0a).unwrap(), 1);
        assert_eq!(i32le(&reduced, 0x40).unwrap(), 9);
        assert_eq!(&reduced[0x58..0x5c], &[9, 8, 7, 6]);
        assert_eq!(&reduced[0x5c..], b"TYP\0row\0");
        let empty = rewrite_param(&reduced, 4, &[], &HashSet::from([9]), false).unwrap();
        assert_eq!(u16le(&empty, 0x0a).unwrap(), 0);
        assert_eq!(&empty[0x40..], b"TYP\0row\0");
    }

    #[test]
    fn new_unit_and_event_rows_roundtrip_with_patches_and_preserve_other_params() {
        let original = Regulation::load(None).unwrap();
        let data = load_dataset(None).unwrap();
        let pattern = data.patterns.iter().find(|p| p.id == 1000).unwrap();
        let spot = pattern.placements.iter().find(|spot| spot.visible && spot.location_index.is_some()).unwrap();
        let new_spot = 109112;
        let new_flag = 12232;
        let additions = vec![
            RowAddition { pattern_id: 1000, table: "spot".into(), row_id: new_spot, source_row_id: spot.row_id,
                fields: BTreeMap::from([("unitId".into(), 5003), ("variationId".into(), 1), ("modifier".into(), 800)]) },
            RowAddition { pattern_id: 1000, table: "flag".into(), row_id: new_flag, source_row_id: 935,
                fields: BTreeMap::from([("modifierSet".into(), 500), ("modifier".into(), 801), ("eventFlag".into(), 7727)]) },
        ];
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        save_changes(None, target.to_string_lossy().into_owned(), vec![Patch {pattern_id: 1000, table: "spot".into(),
            row_id: new_spot, field: "modifier".into(), old_value: 800, new_value: 801}], additions,
            vec![RowRemoval {table: "spot".into(), pattern_id: 1000, row_id: spot.row_id}], vec![]).unwrap();
        let saved = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        let patterns: Vec<_> = data.patterns.iter().map(|pattern| pattern.id).collect();
        for (name, size) in [("LotResultSmallBaseAndSpot", 24), ("LotResultMapPatternFlag", 28)] {
            assert_eq!(game_pattern_row_groups(&saved, name, size, &patterns), all_pattern_row_groups(&saved, name, size));
        }
        for entry in &original.entries {
            if entry.name.ends_with("LotResultSmallBaseAndSpot.param") || entry.name.ends_with("LotResultMapPatternFlag.param") { continue; }
            let after = saved.entries.iter().find(|after| after.name == entry.name).unwrap();
            assert_eq!(range(&original.bnd, entry.offset, entry.size).unwrap(), range(&saved.bnd, after.offset, after.size).unwrap(), "{}", entry.name);
        }
        let reloaded = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        let p = reloaded.patterns.iter().find(|p| p.id == 1000).unwrap();
        assert_eq!(p.placements.len(), pattern.placements.len());
        assert!(!p.placements.iter().any(|row| row.row_id == spot.row_id));
        assert_eq!(p.flags.len(), pattern.flags.len() + 1);
        let unit = p.placements.iter().find(|row| row.row_id == new_spot).unwrap();
        assert_eq!((unit.unit_id, unit.modifier, unit.attach_id, unit.location_index), (5003, 801, spot.attach_id, spot.location_index));
        assert_eq!((unit.variation_id, unit.map_index), (1, 3));
        let indices: HashSet<_> = p.placements.iter().filter(|row| row.unit_id == 5003).map(|row| row.map_index).collect();
        assert_eq!(indices, HashSet::from([0, 1, 2, 3]));
        assert_eq!(p.flags.iter().find(|row| row.row_id == new_flag).unwrap().event_flag, 7727);
        assert_eq!((p.terrain_id, p.nightlord_id), (pattern.terrain_id, pattern.nightlord_id));
        let flags = saved.table("LotResultMapPatternFlag", 28).unwrap();
        let at = flags.rows.iter().find(|(id, _)| *id == new_flag).unwrap().1;
        assert_eq!(i16le(&saved.bnd, at + 22).unwrap() as i32, p.nightlord_id);
        assert_eq!(i32le(&saved.bnd, at + 24).unwrap(), p.terrain_id);
        let next = temp.path().join("second.bin");
        save_changes(Some(target.to_string_lossy().into_owned()), next.to_string_lossy().into_owned(), vec![Patch {
            pattern_id: 1000, table: "spot".into(), row_id: new_spot, field: "unitId".into(), old_value: 5003, new_value: 5252,
        }], vec![], vec![], vec![]).unwrap();
        let reloaded = load_dataset(Some(next.to_string_lossy().into_owned())).unwrap();
        assert_eq!(reloaded.patterns.iter().find(|p| p.id == 1000).unwrap().placements.iter().find(|row| row.row_id == new_spot).unwrap().unit_id, 5252);
    }

    #[test]
    fn game_scan_skips_a_pattern_appended_after_other_patterns() {
        let original = Regulation::load(None).unwrap();
        for (name, size, new_id) in [("LotResultSmallBaseAndSpot", 24, 109112), ("LotResultMapPatternFlag", 28, 12232)] {
            let table = original.table(name, size).unwrap();
            let entry = original.entries.iter().find(|entry| entry.name.ends_with(&format!("{name}.param"))).unwrap();
            let source = table.rows.iter().find(|(_, at)| i32le(&original.bnd, *at + 4).unwrap() == 0).unwrap().1;
            let added = [(new_id, range(&original.bnd, source, size).unwrap().to_vec())];
            let raw = range(&original.bnd, entry.offset, entry.size).unwrap();
            let mut legacy = Regulation::load(None).unwrap();
            legacy.replace_param(name, rewrite_param(raw, size, &added, &HashSet::new(), false).unwrap()).unwrap();
            let groups = all_pattern_row_groups(&legacy, name, size);
            let patterns: Vec<_> = groups.keys().copied().collect();
            assert!(groups[&0].contains(&new_id));
            assert!(!game_pattern_row_groups(&legacy, name, size, &patterns)[&0].contains(&new_id));
            let diagnostics = pattern_result_diagnostics(&legacy).unwrap();
            let code = if size == 24 { "errors.spotRowOrder" } else { "errors.flagRowOrder" };
            assert!(diagnostics.iter().any(|error| error.code == code && error.params["patternId"] == 0 && error.params["rowId"] == new_id));
            legacy.replace_param(name, rewrite_param(raw, size, &added, &HashSet::new(), true).unwrap()).unwrap();
            assert!(pattern_result_diagnostics(&legacy).unwrap().is_empty());
            assert_eq!(game_pattern_row_groups(&legacy, name, size, &patterns), all_pattern_row_groups(&legacy, name, size));
            // Physical order can differ from ID order: the game builds a
            // separate sorted (ID, ordinal) index in FUN_14286ab50.
            let rows = legacy.table(name, size).unwrap().rows;
            assert!(rows.windows(2).any(|pair| pair[0].0 > pair[1].0));
            let original_rows: HashMap<_, _> = table.rows.iter().copied().collect();
            let by_id: BTreeMap<_, _> = rows.iter().enumerate().map(|(ordinal, (id, _))| (*id, ordinal)).collect();
            let index: Vec<_> = by_id.into_iter().collect();
            for (ordinal, (id, at)) in rows.iter().enumerate() {
                let lookup = index.binary_search_by_key(id, |(key, _)| *key).unwrap();
                assert_eq!(index[lookup].1, ordinal);
                let expected = if *id == new_id { source } else { original_rows[id] };
                assert_eq!(range(&legacy.bnd, *at, size).unwrap(), range(&original.bnd, expected, size).unwrap());
            }
        }
    }

    #[test]
    fn replacing_a_unit_and_adding_events_preserves_game_groups_and_ids_through_restore() {
        let original = Regulation::load(None).unwrap();
        let data = load_dataset(None).unwrap();
        let owner = data.patterns.iter().find(|pattern| pattern.id == 0).unwrap();
        let unit = owner.placements.iter().find(|unit| unit.visible && unit.location_index.is_some()).unwrap();
        let patterns: Vec<_> = data.patterns.iter().map(|pattern| pattern.id).collect();
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("regulation.bin");
        let mut additions = vec![RowAddition { pattern_id: 0, table: "spot".into(), row_id: 109112,
            source_row_id: unit.row_id, fields: BTreeMap::new() }];
        for (pattern, id) in [(0, 12232), (1000, 12233), (1199, 12234)] {
            additions.push(RowAddition { pattern_id: pattern, table: "flag".into(), row_id: id, source_row_id: 935,
                fields: BTreeMap::from([("modifierSet".into(), 500), ("modifier".into(), 801), ("eventFlag".into(), 7727)]) });
        }
        save_changes(None, target.to_string_lossy().into_owned(), vec![], additions,
            vec![RowRemoval { pattern_id: 0, table: "spot".into(), row_id: unit.row_id }], vec![]).unwrap();
        let saved = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        for (name, size) in [("LotResultSmallBaseAndSpot", 24), ("LotResultMapPatternFlag", 28)] {
            let groups = game_pattern_row_groups(&saved, name, size, &patterns);
            assert_eq!(groups, all_pattern_row_groups(&saved, name, size));
            let mut expected = all_pattern_row_groups(&original, name, size);
            if size == 24 {
                expected.get_mut(&0).unwrap().retain(|id| *id != unit.row_id);
                expected.get_mut(&0).unwrap().push(109112);
            } else {
                for (owner, id) in [(0, 12232), (1000, 12233), (1199, 12234)] { expected.get_mut(&owner).unwrap().push(id); }
            }
            assert_eq!(groups, expected);
            let after: HashMap<_, _> = saved.table(name, size).unwrap().rows.into_iter().collect();
            for (id, at) in original.table(name, size).unwrap().rows {
                if size == 24 && id == unit.row_id { continue; }
                assert_eq!(range(&original.bnd, at, size).unwrap(), range(&saved.bnd, after[&id], size).unwrap());
            }
        }
        let saved_unit = saved.table("LotResultSmallBaseAndSpot", 24).unwrap().rows.into_iter().find(|(id, _)| *id == 109112).unwrap().1;
        let original_unit = original.table("LotResultSmallBaseAndSpot", 24).unwrap().rows.into_iter().find(|(id, _)| *id == unit.row_id).unwrap().1;
        assert_eq!(range(&saved.bnd, saved_unit, 24).unwrap(), range(&original.bnd, original_unit, 24).unwrap());
        save_changes(Some(target.to_string_lossy().into_owned()), target.to_string_lossy().into_owned(),
            vec![Patch { pattern_id: 1000, table: "flag".into(), row_id: 12233, field: "modifier".into(), old_value: 801, new_value: 802 }],
            vec![], vec![], vec![0]).unwrap();
        let restored = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        for (name, size) in [("LotResultSmallBaseAndSpot", 24), ("LotResultMapPatternFlag", 28)] {
            let groups = game_pattern_row_groups(&restored, name, size, &patterns);
            assert_eq!(groups, all_pattern_row_groups(&restored, name, size));
            assert_eq!(groups[&0], all_pattern_row_groups(&original, name, size)[&0]);
        }
        let flags = restored.table("LotResultMapPatternFlag", 28).unwrap();
        let edited = flags.rows.iter().find(|(id, _)| *id == 12233).unwrap().1;
        assert_eq!(i32le(&restored.bnd, edited + 12).unwrap(), 802);
        assert!(flags.rows.iter().any(|(id, _)| *id == 12234));
    }

    #[test]
    fn unit_removal_roundtrips_and_preserves_all_other_rows_and_params() {
        let original = Regulation::load(None).unwrap();
        let data = load_dataset(None).unwrap();
        let owner = data.patterns.iter().find(|pattern| pattern.id == 1000).unwrap();
        let unit = owner.placements.iter().find(|spot| spot.visible && spot.location_index.is_some()).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("removed.bin");
        save_changes(None, target.to_string_lossy().into_owned(), vec![], vec![],
            vec![RowRemoval {table: "spot".into(), pattern_id: owner.id, row_id: unit.row_id}], vec![]).unwrap();
        let saved = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        for entry in &original.entries {
            if entry.name.ends_with("LotResultSmallBaseAndSpot.param") { continue; }
            let after = saved.entries.iter().find(|after| after.name == entry.name).unwrap();
            assert_eq!(range(&original.bnd, entry.offset, entry.size).unwrap(), range(&saved.bnd, after.offset, after.size).unwrap(), "{}", entry.name);
        }
        let before = original.table("LotResultSmallBaseAndSpot", 24).unwrap();
        let after = saved.table("LotResultSmallBaseAndSpot", 24).unwrap();
        assert_eq!(after.rows.len(), before.rows.len() - 1);
        let remaining: HashMap<_, _> = after.rows.into_iter().collect();
        assert!(!remaining.contains_key(&unit.row_id));
        for (id, at) in before.rows {
            if id == unit.row_id { continue; }
            assert_eq!(range(&original.bnd, at, 24).unwrap(), range(&saved.bnd, remaining[&id], 24).unwrap(), "Unit row #{id}");
        }
        let reloaded = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        assert_eq!(reloaded.patterns.len(), data.patterns.len());
        let current = reloaded.patterns.iter().find(|pattern| pattern.id == owner.id).unwrap();
        assert_eq!(current.placements.len(), owner.placements.len() - 1);
        assert!(!current.placements.iter().any(|spot| spot.row_id == unit.row_id));
        let restored = temp.path().join("restored.bin");
        save_changes(Some(target.to_string_lossy().into_owned()), restored.to_string_lossy().into_owned(), vec![],
            vec![RowAddition {pattern_id: owner.id, table: "spot".into(), row_id: 109112,
                source_row_id: unit.row_id, fields: BTreeMap::new()}], vec![], vec![]).unwrap();
        let restored = load_dataset(Some(restored.to_string_lossy().into_owned())).unwrap();
        let current = restored.patterns.iter().find(|pattern| pattern.id == owner.id).unwrap();
        let replacement = current.placements.iter().find(|spot| spot.row_id == 109112).unwrap();
        assert_eq!((replacement.unit_id, replacement.attach_id, replacement.location_index), (unit.unit_id, unit.attach_id, unit.location_index));
    }

    #[test]
    fn event_removal_roundtrips_and_preserves_other_rows_and_params() {
        let original = Regulation::load(None).unwrap();
        let data = load_dataset(None).unwrap();
        let mut removals = Vec::new();
        for category in 0..4 {
            let (owner, event) = data.patterns.iter().flat_map(|p| p.flags.iter().map(move |flag| (p, flag)))
                .find(|(p, flag)| match category {
                    0 => (3000..=3130).contains(&flag.modifier_set),
                    1 => (500..=560).contains(&flag.modifier_set),
                    2 => flag.modifier_set == 3500,
                    _ => p.terrain_id == 4 && [0, 1000].contains(&flag.modifier_set)
                        && [1038400230, 1046400230].contains(&flag.event_flag),
                }).unwrap();
            removals.push(RowRemoval {pattern_id: owner.id, table: "flag".into(), row_id: event.row_id});
        }
        let removed: HashSet<_> = removals.iter().map(|row| row.row_id).collect();
        assert_eq!(removed.len(), 4);
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("events-removed.bin");
        save_changes(None, target.to_string_lossy().into_owned(), vec![], vec![], removals, vec![]).unwrap();
        let saved = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        for entry in &original.entries {
            if entry.name.ends_with("LotResultMapPatternFlag.param") { continue; }
            let after = saved.entries.iter().find(|after| after.name == entry.name).unwrap();
            assert_eq!(range(&original.bnd, entry.offset, entry.size).unwrap(), range(&saved.bnd, after.offset, after.size).unwrap(), "{}", entry.name);
        }
        let before = original.table("LotResultMapPatternFlag", 28).unwrap();
        let after = saved.table("LotResultMapPatternFlag", 28).unwrap();
        assert_eq!(after.rows.len(), before.rows.len() - removed.len());
        let remaining: HashMap<_, _> = after.rows.into_iter().collect();
        for (id, at) in before.rows {
            if removed.contains(&id) { assert!(!remaining.contains_key(&id)); continue; }
            assert_eq!(range(&original.bnd, at, 28).unwrap(), range(&saved.bnd, remaining[&id], 28).unwrap(), "Flag row #{id}");
        }
        let reloaded = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        assert_eq!(reloaded.patterns.len(), data.patterns.len());
        for current in &reloaded.patterns {
            let previous = data.patterns.iter().find(|p| p.id == current.id).unwrap();
            assert_eq!((current.terrain_id, current.nightlord_id), (previous.terrain_id, previous.nightlord_id));
            assert_eq!(current.flags.len(), previous.flags.iter().filter(|row| !removed.contains(&row.row_id)).count());
            assert!(current.flags.iter().all(|row| !removed.contains(&row.row_id)));
        }
    }

    #[test]
    fn event_removal_validates_role_and_ownership_and_preserves_pattern_metadata() {
        let original = Regulation::load(None).unwrap();
        let data = load_dataset(None).unwrap();
        let owner = data.patterns.iter().find(|p| p.flags.iter().any(|row| row.modifier_set == 3500)).unwrap();
        let event = owner.flags.iter().find(|row| row.modifier_set == 3500).unwrap();
        let spawn = owner.flags.iter().find(|row| row.modifier_set == 190).unwrap();
        for (removals, expected) in [
            (vec![RowRemoval {pattern_id: owner.id, table: "play".into(), row_id: event.row_id}], "errors.rowTable"),
            (vec![RowRemoval {pattern_id: owner.id, table: "flag".into(), row_id: spawn.row_id}], "errors.rowNotEvent"),
            (vec![RowRemoval {pattern_id: -1, table: "flag".into(), row_id: event.row_id}], "errors.rowPattern"),
            (vec![RowRemoval {pattern_id: owner.id, table: "flag".into(), row_id: -1}], "errors.rowMissing"),
            (vec![RowRemoval {pattern_id: owner.id, table: "flag".into(), row_id: event.row_id}; 2], "errors.duplicateRow"),
        ] {
            let mut reg = Regulation {bnd: original.bnd.clone(), entries: original.entries.clone(), iv: original.iv, version: original.version.clone()};
            assert_eq!(remove_rows(&mut reg, &removals).unwrap_err().code, expected);
            assert_eq!(reg.bnd, original.bnd);
        }
        let mut reg = Regulation::load(None).unwrap();
        let ids = owner.flags.iter().filter(|row| row.row_id != event.row_id).map(|row| row.row_id).collect();
        let entry = reg.entries.iter().find(|entry| entry.name.ends_with("LotResultMapPatternFlag.param")).unwrap();
        let reduced = rewrite_param(range(&reg.bnd, entry.offset, entry.size).unwrap(), 28, &[], &ids, true).unwrap();
        reg.replace_param("LotResultMapPatternFlag", reduced).unwrap();
        let before = reg.bnd.clone();
        assert_eq!(remove_rows(&mut reg, &[RowRemoval {pattern_id: owner.id, table: "flag".into(), row_id: event.row_id}]).unwrap_err().code, "errors.lastPatternFlag");
        assert_eq!(reg.bnd, before);
        let legacy: RowRemoval = serde_json::from_value(serde_json::json!({"patternId": 0, "rowId": 10})).unwrap();
        assert_eq!(legacy.table, "spot");
        let event_request: RowRemoval = serde_json::from_value(serde_json::json!({"patternId": 0, "table": "flag", "rowId": 10})).unwrap();
        assert_eq!(event_request.table, "flag");
    }

    #[test]
    fn unit_and_event_removals_with_the_same_row_id_are_independent() {
        let data = load_dataset(None).unwrap();
        let owner = data.patterns.iter().find(|p| p.id == 1000).unwrap();
        let unit = owner.placements.iter().find(|row| row.visible && row.location_index.is_some() && row.row_id > 12231).unwrap();
        let mut reg = Regulation::load(None).unwrap();
        insert_rows(&mut reg, &[RowAddition {pattern_id: owner.id, table: "flag".into(), row_id: unit.row_id,
            source_row_id: 935, fields: BTreeMap::from([("modifierSet".into(), 500), ("modifier".into(), 801), ("eventFlag".into(), 7727)])}]).unwrap();
        remove_rows(&mut reg, &[
            RowRemoval {pattern_id: owner.id, table: "flag".into(), row_id: unit.row_id},
            RowRemoval {pattern_id: owner.id, table: "spot".into(), row_id: unit.row_id},
        ]).unwrap();
        assert!(!reg.table("LotResultMapPatternFlag", 28).unwrap().rows.iter().any(|(id, _)| *id == unit.row_id));
        assert!(!reg.table("LotResultSmallBaseAndSpot", 24).unwrap().rows.iter().any(|(id, _)| *id == unit.row_id));
    }

    #[test]
    fn restoring_patterns_recovers_builtin_rows_and_preserves_all_other_parameters() {
        let builtin = Regulation::load(None).unwrap();
        let data = load_dataset(None).unwrap();
        let owner = data.patterns.iter().find(|p| p.terrain_id == 4 && p.flags.iter().any(|row| (500..=560).contains(&row.modifier_set))).unwrap();
        let unit = owner.placements.iter().find(|row| row.visible && row.location_index.is_some()).unwrap();
        let event = owner.flags.iter().find(|row| (500..=560).contains(&row.modifier_set)).unwrap();
        let spawn = owner.flags.iter().find(|row| row.modifier_set == 160).unwrap();
        let mut imported = Regulation::load(None).unwrap();
        insert_rows(&mut imported, &[RowAddition {pattern_id: owner.id, table: "flag".into(), row_id: 12232,
            source_row_id: 935, fields: BTreeMap::from([("modifierSet".into(), 500), ("modifier".into(), 999), ("eventFlag".into(), 7727)])}]).unwrap();
        remove_rows(&mut imported, &[
            RowRemoval {pattern_id: owner.id, table: "spot".into(), row_id: unit.row_id},
            RowRemoval {pattern_id: owner.id, table: "flag".into(), row_id: event.row_id},
        ]).unwrap();
        let flags = imported.table("LotResultMapPatternFlag", 28).unwrap();
        for (id, at) in flags.rows {
            if i32le(&imported.bnd, at + 4).unwrap() != owner.id { continue; }
            imported.bnd[at + 22..at + 24].copy_from_slice(&7_i16.to_le_bytes());
            imported.bnd[at + 24..at + 28].copy_from_slice(&0_i32.to_le_bytes());
            if id == spawn.row_id { imported.bnd[at + 12..at + 16].copy_from_slice(&700_i32.to_le_bytes()); }
        }
        let spots = imported.table("LotResultSmallBaseAndSpot", 24).unwrap();
        let at = spots.rows.iter().find(|(_, at)| i32le(&imported.bnd, at + 4).unwrap() == owner.id).unwrap().1;
        imported.bnd[at] ^= 0x7f;
        let entry = imported.entries.iter().find(|entry| entry.name.ends_with("LotResultPlayAreaParam.param")).unwrap();
        let reduced = rewrite_param(range(&imported.bnd, entry.offset, entry.size).unwrap(), 40, &[], &HashSet::from([owner.play.as_ref().unwrap().row_id]), true).unwrap();
        imported.replace_param("LotResultPlayAreaParam", reduced).unwrap();
        let plays = imported.table("LotResultPlayAreaParam", 40).unwrap();
        let other = plays.rows.iter().find(|(_, at)| i32le(&imported.bnd, at + 4).unwrap() != owner.id).unwrap().1;
        imported.bnd[other + 8..other + 12].copy_from_slice(&1002_i32.to_le_bytes());
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("imported.bin");
        std::fs::write(&source, imported.encode().unwrap()).unwrap();
        let target = temp.path().join("restored.bin");
        save_changes(Some(source.to_string_lossy().into_owned()), target.to_string_lossy().into_owned(), vec![], vec![], vec![], vec![owner.id]).unwrap();
        let saved = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        for (name, size) in [("LotResultMapPatternFlag", 28), ("LotResultSmallBaseAndSpot", 24), ("LotResultPlayAreaParam", 40)] {
            let after: HashMap<_, _> = saved.table(name, size).unwrap().rows.into_iter().collect();
            let expected: HashMap<_, _> = builtin.table(name, size).unwrap().rows.into_iter()
                .filter(|(_, at)| i32le(&builtin.bnd, at + 4).unwrap() == owner.id).collect();
            let restored: HashSet<_> = after.iter().filter(|(_, at)| i32le(&saved.bnd, **at + 4).unwrap() == owner.id).map(|(id, _)| *id).collect();
            assert_eq!(restored, expected.keys().copied().collect());
            for (id, at) in expected { assert_eq!(range(&builtin.bnd, at, size).unwrap(), range(&saved.bnd, after[&id], size).unwrap(), "Restored {name} row #{id}"); }
            for (id, at) in imported.table(name, size).unwrap().rows {
                if i32le(&imported.bnd, at + 4).unwrap() == owner.id { continue; }
                assert_eq!(range(&imported.bnd, at, size).unwrap(), range(&saved.bnd, after[&id], size).unwrap(), "Other {name} row #{id}");
            }
        }
        for entry in &imported.entries {
            if ["LotResultMapPatternFlag.param", "LotResultSmallBaseAndSpot.param", "LotResultPlayAreaParam.param"].iter().any(|name| entry.name.ends_with(name)) { continue; }
            let after = saved.entries.iter().find(|after| after.name == entry.name).unwrap();
            assert_eq!(range(&imported.bnd, entry.offset, entry.size).unwrap(), range(&saved.bnd, after.offset, after.size).unwrap(), "{}", entry.name);
        }
        let reloaded = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        let current = reloaded.patterns.iter().find(|p| p.id == owner.id).unwrap();
        assert_eq!((current.terrain_id, current.nightlord_id), (owner.terrain_id, owner.nightlord_id));
        assert_eq!(current.flags.len(), owner.flags.len());assert_eq!(current.placements.len(), owner.placements.len());
        assert!(current.play.is_some());
        let edited = temp.path().join("restored-and-edited.bin");
        save_changes(Some(source.to_string_lossy().into_owned()), edited.to_string_lossy().into_owned(), vec![Patch {
            pattern_id: owner.id, table: "flag".into(), row_id: spawn.row_id, field: "modifier".into(),
            old_value: spawn.modifier as i64, new_value: 13002,
        }], vec![], vec![], vec![owner.id]).unwrap();
        let edited = load_dataset(Some(edited.to_string_lossy().into_owned())).unwrap();
        assert_eq!(edited.patterns.iter().find(|p| p.id == owner.id).unwrap().flags.iter().find(|row| row.row_id == spawn.row_id).unwrap().modifier, 13002);
    }

    #[test]
    fn restorations_reject_unknown_patterns_and_row_ids_owned_by_other_patterns() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("invalid.bin");
        assert_eq!(save_changes(None, target.to_string_lossy().into_owned(), vec![], vec![], vec![], vec![-1]).unwrap_err().code, "errors.patternMissing");
        assert!(!target.exists());
        let mut reg = Regulation::load(None).unwrap();
        let at = reg.table("LotResultSmallBaseAndSpot", 24).unwrap().rows.into_iter().find(|(_, at)| i32le(&reg.bnd, at + 4).unwrap() == 0).unwrap().1;
        reg.bnd[at + 4..at + 8].copy_from_slice(&1000_i32.to_le_bytes());
        let source = temp.path().join("collision.bin");std::fs::write(&source, reg.encode().unwrap()).unwrap();
        assert_eq!(save_changes(Some(source.to_string_lossy().into_owned()), target.to_string_lossy().into_owned(), vec![], vec![], vec![], vec![0]).unwrap_err().code, "errors.rowExists");
        assert!(!target.exists());
    }

    #[test]
    fn duplicate_units_cannot_be_saved_and_removals_check_ids_and_ownership() {
        let data = load_dataset(None).unwrap();
        let owner = data.patterns.iter().find(|pattern| pattern.id == 1000).unwrap();
        let unit = owner.placements.iter().find(|spot| spot.visible && spot.location_index.is_some()).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("duplicate.bin");
        let addition = RowAddition {pattern_id: owner.id, table: "spot".into(), row_id: 109112,
            source_row_id: unit.row_id, fields: BTreeMap::new()};
        let error = save_changes(None, target.to_string_lossy().into_owned(), vec![], vec![addition], vec![], vec![]).unwrap_err();
        assert_eq!(error.code, "errors.locationUnitExists");
        assert!(!target.exists());
        for (removals, expected) in [
            (vec![RowRemoval {table: "spot".into(), pattern_id: owner.id, row_id: -1}], "errors.rowMissing"),
            (vec![RowRemoval {table: "spot".into(), pattern_id: -1, row_id: unit.row_id}], "errors.rowPattern"),
            (vec![RowRemoval {table: "spot".into(), pattern_id: owner.id, row_id: unit.row_id}; 2], "errors.duplicateRow"),
        ] {
            let mut reg = Regulation::load(None).unwrap();
            assert_eq!(remove_rows(&mut reg, &removals).unwrap_err().code, expected);
        }
    }

    #[test]
    fn bundled_map_indices_are_unique_by_unit_id_across_all_patterns_and_variants() {
        let mut reg = Regulation::load(None).unwrap();
        let original = reg.bnd.clone();
        let table = reg.table("LotResultSmallBaseAndSpot", 24).unwrap();
        let mut groups = BTreeMap::<(i32, i32), Vec<(u8, u8)>>::new();
        let mut owners = HashSet::new();
        for (_, at) in table.rows {
            let owner = i32le(&reg.bnd, at + 4).unwrap();owners.insert(owner);
            groups.entry((owner, i32le(&reg.bnd, at + 12).unwrap())).or_default().push((reg.bnd[at + 17], reg.bnd[at + 16]));
        }
        assert_eq!(owners.len(), 520);
        assert_eq!(groups.values().filter(|rows| rows.len() > 1).count(), 4433);
        for (group, rows) in &groups {
            assert_eq!(rows.iter().map(|(_, index)| index).collect::<HashSet<_>>().len(), rows.len(), "Pattern/unit {:?}", group);
        }
        assert_eq!(groups[&(0, 3810)], vec![(0, 0), (1, 1), (1, 2)]);
        assert_eq!(groups[&(1000, 5011)], vec![(3, 0), (6, 1)]);
        assert_eq!(groups[&(1199, 5010)], vec![(3, 0), (2, 1), (3, 2), (2, 3)]);
        normalize_map_indices(&mut reg, &owners).unwrap();
        assert_eq!(reg.bnd, original,"Valid original indices remain unchanged");
    }

    #[test]
    fn missing_play_rows_can_be_created_without_allowing_duplicate_play_owners() {
        let mut reg = Regulation::load(None).unwrap();
        let entry = reg.entries.iter().find(|entry| entry.name.ends_with("LotResultPlayAreaParam.param")).unwrap();
        let count = u16le(&reg.bnd, entry.offset + 10).unwrap();
        let last = entry.offset + 0x40 + (count as usize - 1) * 24;
        let at = entry.offset + i64le(&reg.bnd, last + 8).unwrap() as usize;
        let pattern_id = i32le(&reg.bnd, at + 4).unwrap();
        let source_id = i32le(&reg.bnd, entry.offset + 0x40).unwrap();
        let original_row = range(&reg.bnd, at, 40).unwrap().to_vec();
        let row_id = i32le(&reg.bnd, last).unwrap() + 1;
        let offset = entry.offset;
        reg.bnd[offset + 10..offset + 12].copy_from_slice(&(count - 1).to_le_bytes());
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("missing.bin");
        std::fs::write(&input, reg.encode().unwrap()).unwrap();
        let data = load_dataset(Some(input.to_string_lossy().into_owned())).unwrap();
        assert!(data.patterns.iter().find(|p| p.id == pattern_id).unwrap().play.is_none());
        let addition = RowAddition {pattern_id, table: "play".into(), row_id, source_row_id: source_id,
            fields: BTreeMap::from([("playArea1".into(), i32le(&original_row, 8).unwrap() as i64)])};
        let target = temp.path().join("restored.bin");
        save_changes(Some(input.to_string_lossy().into_owned()), target.to_string_lossy().into_owned(), vec![], vec![addition.clone()], vec![], vec![]).unwrap();
        let data = load_dataset(Some(target.to_string_lossy().into_owned())).unwrap();
        assert_eq!(data.patterns.iter().find(|p| p.id == pattern_id).unwrap().play.as_ref().unwrap().row_id, row_id);
        let mut restored = Regulation::load(Some(target.to_str().unwrap())).unwrap();
        let duplicate = RowAddition {row_id: row_id + 1, ..addition};
        assert_eq!(insert_rows(&mut restored, &[duplicate]).unwrap_err().code, "errors.playRowExists");
    }

    #[test]
    fn new_rows_reject_duplicate_ids_missing_owners_and_invalid_values() {
        let addition = RowAddition {pattern_id: 0, table: "flag".into(), row_id: 12232, source_row_id: 0, fields: BTreeMap::new()};
        for (change, expected) in [
            (RowAddition {row_id: 0, ..addition.clone()}, "errors.rowExists"),
            (RowAddition {pattern_id: -1, ..addition.clone()}, "errors.patternMissing"),
            (RowAddition {source_row_id: -1, ..addition.clone()}, "errors.rowMissing"),
            (RowAddition {table: "invalid".into(), ..addition.clone()}, "errors.rowTable"),
            (RowAddition {fields: BTreeMap::from([("eventFlag".into(), -1)]), ..addition.clone()}, "errors.flagRange"),
        ] {
            let mut reg = Regulation::load(None).unwrap();
            assert_eq!(insert_rows(&mut reg, &[change]).unwrap_err().code, expected);
        }
        let mut reg = Regulation::load(None).unwrap();
        assert_eq!(insert_rows(&mut reg, &[addition.clone(), addition]).unwrap_err().code, "errors.rowExists");
    }
}
