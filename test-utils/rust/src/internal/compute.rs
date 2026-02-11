//! Compute unit parsing and tracking

use litesvm::types::TransactionMetadata;

/// Extract compute units from transaction metadata
pub fn get_compute_units(metadata: &TransactionMetadata) -> u64 {
    for log in &metadata.logs {
        if log.contains("consumed") {
            if let Some(units) = parse_compute_units(log) {
                return units;
            }
        }
    }
    0
}

/// Format: "Program X consumed Y of Z compute units"
fn parse_compute_units(log: &str) -> Option<u64> {
    let parts: Vec<&str> = log.split_whitespace().collect();
    for (i, part) in parts.iter().enumerate() {
        if *part == "consumed" {
            if let Some(units_str) = parts.get(i + 1) {
                return units_str.parse().ok();
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_compute_units() {
        let log = "Program 11111111111111111111111111111111 consumed 150 of 200000 compute units";
        assert_eq!(parse_compute_units(log), Some(150));
    }

    #[test]
    fn test_parse_compute_units_invalid() {
        let log = "Some other log message";
        assert_eq!(parse_compute_units(log), None);
    }
}
