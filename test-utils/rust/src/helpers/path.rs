use std::path::{Component, Path, PathBuf};

use crate::errors::{Result, VmError};

/// Walk up from `CARGO_MANIFEST_DIR` until the repo root (pnpm-lock.yaml or .git).
fn repo_root() -> Option<PathBuf> {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if dir.join("pnpm-lock.yaml").exists() || dir.join(".git").exists() {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = repo_root() {
        roots.push(root);
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    roots
}

/// Resolve a readable path and reject traversal outside allowed repo directories.
pub fn validate_readable_path(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref();

    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(VmError::InvalidConfig(format!(
                "Path traversal not allowed: {}",
                path.display()
            )));
        }
    }

    let canonical = path.canonicalize()?;

    for root in allowed_roots() {
        if let Ok(root_canon) = root.canonicalize() {
            if canonical.starts_with(&root_canon) {
                return Ok(canonical);
            }
        }
    }

    Err(VmError::InvalidConfig(format!(
        "Path '{}' is outside allowed directories",
        path.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_dir_in_input() {
        let err = validate_readable_path("../outside.so").unwrap_err();
        assert!(err.to_string().contains("Path traversal"));
    }

    #[test]
    fn accepts_manifest_dir_file() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let cargo_toml = manifest.join("Cargo.toml");
        assert!(validate_readable_path(&cargo_toml).is_ok());
    }
}
