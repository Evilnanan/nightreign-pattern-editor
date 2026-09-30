use serde::Serialize;
use serde_json::{json, Value};
use std::fmt;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub params: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        Self::params(code, json!({}))
    }

    pub fn params(code: &'static str, params: Value) -> Self {
        Self { code, params, details: None }
    }

    pub fn diagnostic(code: &'static str, error: impl fmt::Display) -> Self {
        Self::contextual(code, json!({}), error)
    }

    pub fn contextual(code: &'static str, params: Value, error: impl fmt::Display) -> Self {
        Self { code, params, details: Some(error.to_string()) }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.params)?;
        if let Some(details) = &self.details { write!(formatter, " ({details})")?; }
        Ok(())
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_error_codes_and_parameters_separately_from_diagnostics() {
        let error = AppError::contextual("errors.iconRead", json!({"file": "Boss.webp"}), "OS error");
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value, json!({"code": "errors.iconRead", "params": {"file": "Boss.webp"}, "details": "OS error"}));
        let error = serde_json::to_value(AppError::new("errors.noChanges")).unwrap();
        assert_eq!(error, json!({"code": "errors.noChanges", "params": {}}));
    }
}
