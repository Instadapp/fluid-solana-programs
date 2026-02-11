# Jupiter Lend Solana Program

A two layer modular architecture that enhances capital efficiency, scalability, and risk management.

## Table of Contents

- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Dependencies](#dependencies)
- [Quickstart](#quickstart)
- [Program Overview](#program-overview)
- [Mainnet Deployments](#mainnet-deployments)
- [Authority Structure](#authority-structure)
- [Security](#security)

## Architecture

Jupiter Lend implements a **two-layer modular architecture** that separates liquidity management from user-facing operations, enabling unified liquidity across multiple protocols.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          User Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Wallets   │  │    dApps    │  │ Liquidators │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Protocol Layer                              │
│  ┌──────────────────┐         ┌──────────────────┐               │
│  │  Lending Protocol│         │  Vaults Protocol │               │
│  │                  │         │                  │               │
│  │  • Deposit       │         │  • Operate       │               │
│  │  • Withdraw      │         │  • Liquidate     │               │
│  │  • Rebalance     │         │  • Rebalance     │               │
│  └────────┬─────────┘         └────────┬─────────┘               │
│           │         ┌──────────────────┘                         │
│           │         │     CPI Calls (Cross-Program Invocations)  │
└───────────┼─────────┼────────────────────────────────────────────┘
            │         │
            ▼         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      Liquidity Layer                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │          Unified Liquidity Pool (Single Orderbook)                 │  │
│  │                                                                    │  │
│  │  • Operate (Supply, Withdraw, Borrow, Payback)                     │  │
│  │  • Unified liquidity management, token limits and rates management.│  │
│  │  • Atomic transaction execution                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
            ▲                              ▲
            │                              │
     ┌──────┴──────┐              ┌────────┴────────┐
     │   Oracle    │              │   Flash Loan    │
     │   Program   │              │    Program      │
     └─────────────┘              └─────────────────┘
```

### Key Benefits

- **Unified Liquidity**: All protocols share the same liquidity pool, maximizing capital efficiency and reducing fragmentation
- **Discrete Risk Framework**: Each protocol (Lending, Vaults) maintains a distinct set of risk parameters (CF, LT, etc) while leveraging shared liquidity within set limits
- **Modular Design**: New protocols can be added without modifying the core liquidity layer

## Repository Structure

```
fluid-contracts-solana/
├── programs/                       # Solana programs
│   ├── liquidity/                  # Core liquidity layer
│   ├── lending/                    # Lending protocol
│   ├── vaults/                     # Collateralized borrow protocol
│   ├── oracle/                     # Oracle that utilizes multiple oracles
│   ├── flashloan/                  # Flash loan functionality
│   └── lending_reward_rate_model/  # Reward distribution
├── __tests__/                      # Test suite
├── temp/                           # Build artifacts
└── Anchor.toml                     # Anchor configuration
```

## Dependencies

### Required

- **[Rust](https://www.rust-lang.org/tools/install)** - v1.81.0

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup default 1.81.0
  ```

- **[Solana CLI](https://docs.solanalabs.com/cli/install)** - v2.3.0

  ```bash
  sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"

  # Generate keypair
  solana-keygen new
  ```

- **[Anchor Framework](https://www.anchor-lang.com/docs/installation)** - v0.32.0

  ```bash
  # Install Anchor Version Manager (AVM)
  cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

  # Install Anchor
  avm install 0.32.0
  avm use 0.32.0
  ```

- **[Node.js](https://nodejs.org/)** and **[pnpm](https://pnpm.io/)** - For build scripts and testing

  ```bash
  # Verify installation
  node --version
  pnpm --version

  # Install dependencies
  pnpm install
  ```

## Quickstart

### 1. Clone the Repository

```bash
git clone https://github.com/Instadapp/fluid-solana-programs.git
cd fluid-solana-programs
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
pnpm install

# Verify toolchain versions
rustc --version    # Should be 1.81.0
solana --version   # Should be 2.3.0
anchor --version   # Should be 0.32.0
```

### 3. Build Programs

```bash
# Build all programs with progress output
pnpm build

# Build a specific program
pnpm build --program liquidity
pnpm build --program lending
pnpm build --program vaults

# List every supported program identifier
pnpm build --list-programs
```

### 4. Run Tests with the Unified CLI

`pnpm test` is the single entry-point for every suite. By default it:

- Builds all programs (unless `--skip-build` is provided)
- Runs the TypeScript (Vitest) suite **and** the Rust integration suite back-to-back

Available flags (order-independent):

- `--ts`, `-t` – run only the TypeScript suite
- `--rust`, `-r` – run only the Rust suite
- `--program <name>` – scope to a single program (see `pnpm test --list-programs`)
- `--skip-build` – reuse the previous Anchor build artifacts
- `--verifiable` – pass `--verifiable` to the Anchor build step
- `--verbose` – print the underlying `vitest` / `cargo` output even on success
- `--list-programs` – print every supported program identifier/alias
- `-- -- <cargo args>` – forward additional flags directly to `cargo test` (Rust only)

```bash
# Build everything + run both suites (default behaviour)
pnpm test

# TypeScript-only run for Vaults
pnpm test --ts --program vaults --skip-build

# Rust suite with extra cargo flags
pnpm test --rust -- -- --ignored

# List supported program names / aliases
pnpm test --list-programs
```

> ℹ️ You can still invoke `cargo test --package tests -- vaults` or `bunx vitest run path/to/file.test.ts` directly,
> but the CLI runner keeps the ergonomics consistent across languages and reports the same progress format for both.

## Program Overview

### Liquidity

The Liquidity program serves as the foundational single-pool architecture that manages all liquidity within the system. It tracks the deposit and borrow positions of integrated programs and enforces program-specific borrowing and withdrawal controls, including rate-limited mechanisms such as debt ceilings and withdrawal limits. Access to this program is permission-based, and end users never interact with it directly. Only whitelisted programs, such as Vaults and Lending, can interact with it through CPIs. All other programs in the ecosystem are built on top of this liquidity infrastructure.

**Key Method**

- **Operate:** The core interaction method that handles all liquidity operations (supply, withdraw, borrow, payback) in a single atomic transaction.

### Lending

The Lending program provides a straightforward lending protocol that offers users direct exposure to yield generation. Users can supply assets to earn interest, making it the core yield-bearing mechanism within the protocol suite.

**Key Methods:**

- **Deposit:** Allows users to supply assets into the protocol
- **Withdraw:** Enables users to withdraw their supplied assets
- **Rebalance:** Synchronizes the protocol's accounting with its actual position on the Liquidity layer, ensuring accurate asset tracking and exchange rates. When rewards are active, rebalance syncs the orderbook to incorporate accrued rewards

### Vaults

The Vaults program implements a collateralized debt position (CDP) system. Users deposit collateral assets to borrow debt tokens against them, enabling leverage and capital efficiency. This program handles collateral management, debt issuance, and liquidation mechanisms through a tick-based architecture for efficient risk management.

**Key Methods:**

- **Operate:** Manages collateral and debt positions by interacting with the Liquidity layer, handling deposits, withdrawals, borrows, and paybacks
- **Liquidate:** Allows liquidators to repay debt on behalf of risky positions in exchange for collateral at a discount (liquidation penalty). Positions become liquidatable when they exceed the liquidation threshold (e.g., 90% LT). The liquidation mechanism operates on a tick-based system, where positions are liquidated based on their risk level. Positions with ratio above the liquidation max limit (e.g., 95% LML) is automatically absorbed by the protocol
- **Rebalance:** Reconciles vault positions with the underlying Liquidity layer to maintain accurate collateral and debt accounting. When rewards are active on the protocol, rebalance syncs the orderbook to account for accrued rewards

### Oracle

The Oracle program provides reliable price feeds for the protocol. It supports data sources from multiple providers including Pyth, Chainlink, and Solana-native pools to ensure accurate asset pricing.

### Flash Loan

The Flash Loan program provides atomic loans that must be borrowed and repaid within a same transaction. This enables arbitrage, liquidations, and other advanced DeFi operations without requiring upfront capital.

### Lending Reward Rate Model

The Lending Reward Rate Model program manages the calculation and distribution of rewards for the Lending protocol, determining reward rates based on protocol parameters and market conditions.

## Mainnet Deployments

The following programs are currently deployed on Solana mainnet:

| Program                   | Program ID                                    |
| ------------------------- | --------------------------------------------- |
| Liquidity                 | `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` |
| Lending                   | `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9` |
| Lending Reward Rate Model | `jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar` |
| Vaults                    | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi` |
| Oracle                    | `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc` |
| Flashloan                 | `jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS` |

## Authority Structure

The protocol implements a multi-tiered authority system with distinct permissions for enhanced security.

### Upgrade Authority

- **Purpose:** Controls program upgrades on the Solana network.

- **Governance:** Managed through a 12-hour timelock multisig wallet jointly controlled by Jupiter and Fluid team signers.

- **Address:** `4MsgBB5VPoTrUSp5XnfbViV386C1UnsTdifLBw33ZMSJ`

### Program Authority

- **Purpose:** Manages protocol configuration including rate curves, loan-to-value (LTV) ratios, operational limits, and authority delegation.

- **Governance:** Jointly controlled by Jupiter and Fluid team signers.

- **Address:** `HqPrpa4ESBDnRHRWaiYtjv4xe93wvCS9NNZtDwR89cVa`

### Init Authority

- **Purpose:** Handles initialization operations across all protocol programs, including:

  - **Liquidity**: Initialize new token reserves and protocol positions
  - **Lending**: Initialize new lending markets and fToken mints
  - **Vaults**: Initialize vault configurations and vault states
  - **Lending Reward Rate Model**: Initialize reward rate models

  This authority is limited to initialization only, without configuration modification privileges e.g., setting limits or change configs.

- **Governance:** Controlled by the Fluid team.

- **Address:** `3H8C6yYTXUcN9RRRDmcLDt3e4aZLYRRX4x2HbEjTqQAA`

## Security

- **Audit Reports**: [Jupiter Documentation](https://github.com/jup-ag/docs/tree/main/static/files/audits)
- **Bug Bounty**: Contact security@fluid.io and security@jup.ag for responsible disclosure
- **Security Best Practices**: All programs undergo rigorous testing and multiple security audits before deployment
