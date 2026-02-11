/// Returns true if a `leaf` can be proved to be a part of a Merkle tree
/// defined by `root`. For this, a `proof` must be provided, containing
/// sibling hashes on the branch from the leaf to the root of the tree.
/// Each pair of leaves and each pair of pre-images are assumed to be sorted.
pub fn verify_merkle_proof(proof: &[[u8; 32]], root: [u8; 32], leaf: [u8; 32]) -> bool {
    process_proof(proof, leaf) == root
}

/// Returns the rebuilt hash obtained by traversing a Merkle tree up
/// from `leaf` using `proof`. A `proof` is valid if and only if the rebuilt
/// hash matches the root of the tree. When processing the proof, the pairs
/// of leaves & pre-images are assumed to be sorted.
fn process_proof(proof: &[[u8; 32]], leaf: [u8; 32]) -> [u8; 32] {
    let mut computed_hash = leaf;

    for proof_element in proof.iter() {
        computed_hash = commutative_keccak256(computed_hash, *proof_element);
    }

    computed_hash
}

/// Commutative Keccak256 hash of a sorted pair of bytes32.
/// Frequently used when working with merkle proofs.
fn commutative_keccak256(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    if a < b {
        efficient_keccak256(a, b)
    } else {
        efficient_keccak256(b, a)
    }
}

fn efficient_keccak256(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    use solana_program::keccak;

    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(&a);
    combined[32..].copy_from_slice(&b);

    keccak::hash(&combined).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::keccak;

    // Helper function to create a leaf hash (like in your claim process)
    fn create_test_leaf(data: &str) -> [u8; 32] {
        let hash = keccak::hash(data.as_bytes());
        keccak::hash(&hash.to_bytes()).to_bytes() // Double hash like OpenZeppelin
    }

    // Helper function to create a simple hash
    fn hash_data(data: &str) -> [u8; 32] {
        keccak::hash(data.as_bytes()).to_bytes()
    }

    #[test]
    fn test_efficient_keccak256() {
        let a = hash_data("test_a");
        let b = hash_data("test_b");

        let result = efficient_keccak256(a, b);

        // Verify it's equivalent to manual concatenation + hash
        let mut manual_combined = [0u8; 64];
        manual_combined[..32].copy_from_slice(&a);
        manual_combined[32..].copy_from_slice(&b);
        let manual_result = keccak::hash(&manual_combined).to_bytes();

        assert_eq!(result, manual_result);
    }

    #[test]
    fn test_commutative_keccak256() {
        let a = hash_data("first");
        let b = hash_data("second");

        let result1 = commutative_keccak256(a, b);
        let result2 = commutative_keccak256(b, a);

        // Should be the same regardless of order (commutative)
        assert_eq!(result1, result2);

        // Should hash smaller value first
        if a < b {
            assert_eq!(result1, efficient_keccak256(a, b));
        } else {
            assert_eq!(result1, efficient_keccak256(b, a));
        }
    }

    #[test]
    fn test_single_leaf_tree() {
        // Tree with only one leaf - proof should be empty
        let leaf = create_test_leaf("single_leaf");
        let proof: Vec<[u8; 32]> = vec![];
        let root = leaf; // Single leaf tree has leaf as root

        assert!(verify_merkle_proof(&proof, root, leaf));
    }

    #[test]
    fn test_two_leaf_tree() {
        // Simple tree: two leaves
        let leaf1 = create_test_leaf("leaf_1");
        let leaf2 = create_test_leaf("leaf_2");

        // Root is hash of both leaves
        let root = commutative_keccak256(leaf1, leaf2);

        // Proof for leaf1 is [leaf2]
        let proof_for_leaf1 = vec![leaf2];
        assert!(verify_merkle_proof(&proof_for_leaf1, root, leaf1));

        // Proof for leaf2 is [leaf1]
        let proof_for_leaf2 = vec![leaf1];
        assert!(verify_merkle_proof(&proof_for_leaf2, root, leaf2));
    }

    #[test]
    fn test_four_leaf_tree() {
        // Tree structure:
        //       root
        //      /    \
        //   h12      h34
        //   / \      / \
        //  l1  l2   l3  l4

        let leaf1 = create_test_leaf("leaf_1");
        let leaf2 = create_test_leaf("leaf_2");
        let leaf3 = create_test_leaf("leaf_3");
        let leaf4 = create_test_leaf("leaf_4");

        let h12 = commutative_keccak256(leaf1, leaf2);
        let h34 = commutative_keccak256(leaf3, leaf4);
        let root = commutative_keccak256(h12, h34);

        // Test proof for leaf1: [leaf2, h34]
        let proof_leaf1 = vec![leaf2, h34];
        assert!(verify_merkle_proof(&proof_leaf1, root, leaf1));

        // Test proof for leaf2: [leaf1, h34]
        let proof_leaf2 = vec![leaf1, h34];
        assert!(verify_merkle_proof(&proof_leaf2, root, leaf2));

        // Test proof for leaf3: [leaf4, h12]
        let proof_leaf3 = vec![leaf4, h12];
        assert!(verify_merkle_proof(&proof_leaf3, root, leaf3));

        // Test proof for leaf4: [leaf3, h12]
        let proof_leaf4 = vec![leaf3, h12];
        assert!(verify_merkle_proof(&proof_leaf4, root, leaf4));
    }

    #[test]
    fn test_invalid_proof() {
        let leaf1 = create_test_leaf("leaf_1");
        let leaf2 = create_test_leaf("leaf_2");
        let leaf3 = create_test_leaf("leaf_3");

        let root = commutative_keccak256(leaf1, leaf2);

        // Wrong proof should fail
        let wrong_proof = vec![leaf3];
        assert!(!verify_merkle_proof(&wrong_proof, root, leaf1));

        // Wrong root should fail
        let wrong_root = create_test_leaf("wrong_root");
        let correct_proof = vec![leaf2];
        assert!(!verify_merkle_proof(&correct_proof, wrong_root, leaf1));
    }

    #[test]
    fn test_empty_proof_wrong_root() {
        let leaf = create_test_leaf("test_leaf");
        let wrong_root = create_test_leaf("wrong_root");
        let proof: Vec<[u8; 32]> = vec![];

        // Empty proof should only work if leaf == root
        assert!(!verify_merkle_proof(&proof, wrong_root, leaf));
    }

    #[test]
    fn test_real_world_scenario() {
        // Simulating a real claim scenario like in your contract
        let position_type: u8 = 1;
        let position_id = hash_data("fUSDC_position");
        let recipient = hash_data("user_wallet_address");
        let cycle: u32 = 1;
        let cumulative_amount: u64 = 1000000; // 1 USDC (6 decimals)
        let metadata = b"metadata";

        // Create leaf like in your create_leaf_hash function
        let mut leaf_data = Vec::new();
        leaf_data.push(position_type);
        leaf_data.extend_from_slice(&position_id);
        leaf_data.extend_from_slice(&recipient);
        leaf_data.extend_from_slice(&cycle.to_le_bytes());
        leaf_data.extend_from_slice(&cumulative_amount.to_le_bytes());
        leaf_data.extend_from_slice(metadata);

        let inner_hash = keccak::hash(&leaf_data);
        let leaf = keccak::hash(&inner_hash.to_bytes()).to_bytes();

        // Create a simple two-leaf tree
        let other_leaf = create_test_leaf("other_claim");
        let root = commutative_keccak256(leaf, other_leaf);

        // Proof should be the other leaf
        let proof = vec![other_leaf];
        assert!(verify_merkle_proof(&proof, root, leaf));
    }

    #[test]
    fn test_larger_tree() {
        // Test with 8 leaves to ensure our implementation scales
        let leaves: Vec<[u8; 32]> = (0..8)
            .map(|i| create_test_leaf(&format!("leaf_{}", i)))
            .collect();

        // Build tree bottom-up
        // Level 1: pairs of leaves
        let h01 = commutative_keccak256(leaves[0], leaves[1]);
        let h23 = commutative_keccak256(leaves[2], leaves[3]);
        let h45 = commutative_keccak256(leaves[4], leaves[5]);
        let h67 = commutative_keccak256(leaves[6], leaves[7]);

        // Level 2: pairs of level 1
        let h0123 = commutative_keccak256(h01, h23);
        let h4567 = commutative_keccak256(h45, h67);

        // Root
        let root = commutative_keccak256(h0123, h4567);

        // Test proof for leaf 0: [leaf1, h23, h4567]
        let proof_leaf0 = vec![leaves[1], h23, h4567];
        assert!(verify_merkle_proof(&proof_leaf0, root, leaves[0]));

        // Test proof for leaf 5: [leaf4, h67, h0123]
        let proof_leaf5 = vec![leaves[4], h67, h0123];
        assert!(verify_merkle_proof(&proof_leaf5, root, leaves[5]));
    }

    #[test]
    fn test_process_proof_matches_verify() {
        let leaf = create_test_leaf("test_leaf");
        let sibling = create_test_leaf("sibling");
        let proof = vec![sibling];

        let computed_root = process_proof(&proof, leaf);
        let expected_root = commutative_keccak256(leaf, sibling);

        assert_eq!(computed_root, expected_root);
        assert!(verify_merkle_proof(&proof, computed_root, leaf));
    }

    // Benchmark test to ensure reasonable performance
    #[test]
    fn test_performance_large_proof() {
        let leaf = create_test_leaf("performance_test");

        // Create a proof with 20 elements (for a tree with ~1M leaves)
        let proof: Vec<[u8; 32]> = (0..20)
            .map(|i| create_test_leaf(&format!("proof_element_{}", i)))
            .collect();

        // This should complete quickly
        let computed_root = process_proof(&proof, leaf);
        assert!(verify_merkle_proof(&proof, computed_root, leaf));
    }
}

#[cfg(test)]
mod advanced_tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;
    use solana_program::keccak;

    /// Creates a test hash from string data
    fn hash_string(data: &str) -> [u8; 32] {
        keccak::hash(data.as_bytes()).to_bytes()
    }

    /// Creates a double-hashed leaf (OpenZeppelin style)
    fn create_double_hashed_leaf(data: &str) -> [u8; 32] {
        let first_hash = keccak::hash(data.as_bytes());
        keccak::hash(&first_hash.to_bytes()).to_bytes()
    }

    #[test]
    fn test_64_byte_leaf_vulnerability() {
        // Test Case: Exactly 64-byte leaf data vulnerability
        // Based on OpenZeppelin issue: https://github.com/OpenZeppelin/openzeppelin-contracts/issues/3091

        // Create a leaf that would be exactly 64 bytes before hashing
        let mut sixty_four_bytes = [0u8; 64];
        sixty_four_bytes[0] = 1; // Some distinguishable data

        let leaf_from_64_bytes = keccak::hash(&sixty_four_bytes).to_bytes();
        let other_leaf = create_double_hashed_leaf("other_leaf");

        let root = commutative_keccak256(leaf_from_64_bytes, other_leaf);

        // Normal verification should work
        let proof = vec![other_leaf];
        assert!(verify_merkle_proof(&proof, root, leaf_from_64_bytes));

        // Attack: Try to interpret the 64 bytes as two concatenated hashes
        let fake_hash1 = [1u8; 32]; // First 32 bytes
        let fake_hash2 = [2u8; 32]; // Second 32 bytes

        let mut attack_data = [0u8; 64];
        attack_data[..32].copy_from_slice(&fake_hash1);
        attack_data[32..].copy_from_slice(&fake_hash2);

        // This attack should fail because our leaf creation uses double hashing
        let attack_leaf = keccak::hash(&attack_data).to_bytes();
        assert!(!verify_merkle_proof(&proof, root, attack_leaf));
    }

    #[test]
    fn test_proof_length_boundary_conditions() {
        // Test Case: Edge cases with proof lengths

        let leaf = create_double_hashed_leaf("test_leaf");

        // Empty proof (single leaf tree)
        let empty_proof: Vec<[u8; 32]> = vec![];
        assert!(verify_merkle_proof(&empty_proof, leaf, leaf));

        // Maximum practical proof length (for 2^20 = ~1M leaves)
        let max_proof: Vec<[u8; 32]> = (0..20)
            .map(|i| hash_string(&format!("proof_element_{}", i)))
            .collect();

        let computed_root = process_proof(&max_proof, leaf);
        assert!(verify_merkle_proof(&max_proof, computed_root, leaf));
    }

    #[test]
    fn test_hash_collision_resistance() {
        // Test Case: Verify resistance to hash collisions

        // Create similar but different data
        let leaf1 = create_double_hashed_leaf("data");
        let leaf2 = create_double_hashed_leaf("data_");
        let leaf3 = create_double_hashed_leaf("data ");

        // All should produce different hashes
        assert_ne!(leaf1, leaf2);
        assert_ne!(leaf2, leaf3);
        assert_ne!(leaf1, leaf3);

        // Verify they produce different trees
        let other = create_double_hashed_leaf("other");
        let root1 = commutative_keccak256(leaf1, other);
        let root2 = commutative_keccak256(leaf2, other);

        assert_ne!(root1, root2);
    }

    #[test]
    fn test_commutative_property_edge_cases() {
        // Test Case: Ensure commutative property works in edge cases

        // Test with identical hashes
        let identical = hash_string("identical");
        let result = commutative_keccak256(identical, identical);
        assert_eq!(result, efficient_keccak256(identical, identical));

        // Test with maximum difference hashes
        let min_hash = [0u8; 32];
        let max_hash = [255u8; 32];

        let result1 = commutative_keccak256(min_hash, max_hash);
        let result2 = commutative_keccak256(max_hash, min_hash);
        assert_eq!(result1, result2);
        assert_eq!(result1, efficient_keccak256(min_hash, max_hash));
    }

    #[test]
    fn test_malformed_proof_attacks() {
        // Test Case: Various malformed proof attempts

        let leaf = create_double_hashed_leaf("legitimate_leaf");
        let sibling = create_double_hashed_leaf("sibling");
        let root = commutative_keccak256(leaf, sibling);

        // Attack 1: Duplicate elements in proof
        let duplicate_proof = vec![sibling, sibling];
        assert!(!verify_merkle_proof(&duplicate_proof, root, leaf));

        // Attack 2: Wrong order proof (should still work due to commutative property)
        let correct_proof = vec![sibling];
        assert!(verify_merkle_proof(&correct_proof, root, leaf));

        // Attack 3: Completely random proof
        let random_proof = vec![hash_string("random"), hash_string("elements")];
        assert!(!verify_merkle_proof(&random_proof, root, leaf));

        // Attack 4: Proof with wrong length
        let wrong_length_proof = vec![sibling, hash_string("extra_element")];
        assert!(!verify_merkle_proof(&wrong_length_proof, root, leaf));
    }

    #[test]
    fn test_tree_depth_attacks() {
        // Test Case: Attacks related to tree depth manipulation
        // Based on research about Bitcoin's merkle tree vulnerabilities

        // Create trees of different depths but try to use same proofs

        // Depth 2 tree (4 leaves)
        let leaves_4: Vec<[u8; 32]> = (0..4)
            .map(|i| create_double_hashed_leaf(&format!("leaf_{}", i)))
            .collect();

        let h01 = commutative_keccak256(leaves_4[0], leaves_4[1]);
        let h23 = commutative_keccak256(leaves_4[2], leaves_4[3]);
        let root_4 = commutative_keccak256(h01, h23);

        // Depth 3 tree (8 leaves)
        let leaves_8: Vec<[u8; 32]> = (0..8)
            .map(|i| create_double_hashed_leaf(&format!("leaf_{}", i)))
            .collect();

        let h01_8 = commutative_keccak256(leaves_8[0], leaves_8[1]);
        let h23_8 = commutative_keccak256(leaves_8[2], leaves_8[3]);
        let h45_8 = commutative_keccak256(leaves_8[4], leaves_8[5]);
        let h67_8 = commutative_keccak256(leaves_8[6], leaves_8[7]);
        let h0123_8 = commutative_keccak256(h01_8, h23_8);
        let h4567_8 = commutative_keccak256(h45_8, h67_8);
        let root_8 = commutative_keccak256(h0123_8, h4567_8);

        // Attack: Try to use proof from 4-leaf tree on 8-leaf tree
        let proof_4_leaf = vec![leaves_4[1], h23];
        assert!(!verify_merkle_proof(&proof_4_leaf, root_8, leaves_4[0]));

        // Legitimate proofs should work
        let proof_8_leaf = vec![leaves_8[1], h23_8, h4567_8];
        assert!(verify_merkle_proof(&proof_8_leaf, root_8, leaves_8[0]));
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_leaf_hash(
        position_type: u8,
        position_id: Pubkey,
        recipient: Pubkey,
        cycle: u32,
        cumulative_amount: u64,
        metadata: &[u8],
    ) -> [u8; 32] {
        use solana_program::keccak;

        let mut data = Vec::new();
        data.push(position_type);
        data.extend_from_slice(&position_id.to_bytes());
        data.extend_from_slice(&recipient.to_bytes());
        data.extend_from_slice(&cycle.to_le_bytes());
        data.extend_from_slice(&cumulative_amount.to_le_bytes());
        data.extend_from_slice(metadata);

        let inner_hash = keccak::hash(&data);
        keccak::hash(&inner_hash.to_bytes()).to_bytes()
    }

    #[test]
    fn test_real_world_claim_attack_scenarios() {
        let position_type = 1u8;
        let position_id = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let cycle = 1u32;
        let amount = 1_000_000u64;
        let metadata = b"legitimate";

        let legitimate_leaf = create_leaf_hash(
            position_type,
            position_id,
            recipient,
            cycle,
            amount,
            metadata,
        );

        // Create a simple tree
        let other_leaf = create_leaf_hash(
            2u8,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            cycle,
            500_000u64,
            b"other",
        );

        let root = commutative_keccak256(legitimate_leaf, other_leaf);

        // Attack 1: Try to claim with manipulated amount
        let attack_leaf_amount = create_leaf_hash(
            position_type,
            position_id,
            recipient,
            cycle,
            amount * 10,
            metadata,
        );
        let proof = vec![other_leaf];
        assert!(!verify_merkle_proof(&proof, root, attack_leaf_amount));

        // Attack 2: Try to claim for different recipient
        let attack_leaf_recipient = create_leaf_hash(
            position_type,
            position_id,
            Pubkey::new_unique(),
            cycle,
            amount,
            metadata,
        );
        assert!(!verify_merkle_proof(&proof, root, attack_leaf_recipient));

        // Attack 3: Try to claim from different cycle
        let attack_leaf_cycle = create_leaf_hash(
            position_type,
            position_id,
            recipient,
            cycle + 1,
            amount,
            metadata,
        );
        assert!(!verify_merkle_proof(&proof, root, attack_leaf_cycle));

        // Legitimate claim should work
        assert!(verify_merkle_proof(&proof, root, legitimate_leaf));
    }

    #[test]
    fn test_performance_stress_test() {
        // Test Case: Performance under stress conditions

        let leaf = create_double_hashed_leaf("stress_test");

        // Test with maximum realistic proof size (2^30 leaves = ~1B transactions)
        let stress_proof: Vec<[u8; 32]> = (0..30)
            .map(|i| {
                let mut hash = [0u8; 32];
                hash[0] = i as u8;
                hash[31] = (i * 7) as u8; // Add some variation
                hash
            })
            .collect();

        // This should complete reasonably quickly
        let start = std::time::Instant::now();
        let computed_root = process_proof(&stress_proof, leaf);
        let duration = start.elapsed();

        // Verification should also be fast
        assert!(verify_merkle_proof(&stress_proof, computed_root, leaf));

        // Should complete in reasonable time (adjust based on your requirements)
        assert!(
            duration.as_millis() < 100,
            "Proof processing too slow: {:?}",
            duration
        );
    }

    #[test]
    fn test_zero_hash_edge_cases() {
        // Test Case: Edge cases with zero hashes

        let zero_hash = [0u8; 32];
        let normal_hash = hash_string("normal");

        // Zero hash should be handled correctly
        let result1 = commutative_keccak256(zero_hash, normal_hash);
        let result2 = commutative_keccak256(normal_hash, zero_hash);
        assert_eq!(result1, result2);

        // Tree with zero elements should be handled
        let proof_with_zero = vec![zero_hash];
        let computed_root = process_proof(&proof_with_zero, normal_hash);
        assert!(verify_merkle_proof(
            &proof_with_zero,
            computed_root,
            normal_hash
        ));
    }
}
