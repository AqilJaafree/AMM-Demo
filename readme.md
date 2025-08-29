# Solana AMM (Automated Market Maker)

A production-ready Automated Market Maker built on Solana using the constant product formula (`x * y = k`). This AMM enables decentralized token swapping with liquidity provision rewards.

## 🌟 Features

- **Constant Product Market Making**: Uses the proven `x * y = k` formula
- **Multiple Pools**: Create different pools for the same token pair with unique seeds
- **Configurable Fees**: Set custom trading fees (in basis points)
- **LP Token System**: Mint/burn LP tokens for liquidity provision
- **Slippage Protection**: Built-in minimum output guarantees
- **Emergency Pause**: Optional authority can lock pools if needed
- **Comprehensive Testing**: Full test suite with edge cases

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend UI   │────│   Anchor SDK     │────│  Solana Program │
│   (React/Next)  │    │   (TypeScript)   │    │     (Rust)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
    ┌─────────┐              ┌──────────┐           ┌─────────────┐
    │ Tests   │              │   RPC    │           │   Config +  │
    │(Mocha)  │              │ Provider │           │ LP Tokens   │
    └─────────┘              └──────────┘           └─────────────┘
```

## 📦 Project Structure

```
├── programs/
│   └── amm/
│       ├── src/
│       │   ├── contexts/          # Account validation & instruction logic
│       │   │   ├── init.rs        # Pool initialization
│       │   │   ├── deposit.rs     # Add liquidity
│       │   │   ├── swap.rs        # Token swapping
│       │   │   └── withdraw.rs    # Remove liquidity
│       │   ├── state/
│       │   │   └── config.rs      # Pool configuration state
│       │   ├── errors.rs          # Custom error definitions
│       │   └── lib.rs             # Program entry points
│       └── Cargo.toml
├── tests/
│   └── amm.ts                     # Comprehensive test suite
├── package.json                   # TypeScript dependencies
└── Cargo.toml                     # Workspace configuration
```

## 🚀 Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (16+) 
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor Framework](https://www.anchor-lang.com/docs/installation) (0.31.1)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd solana-amm
   ```

2. **Install dependencies**
   ```bash
   # Install Node.js dependencies
   npm install
   
   # Install Rust dependencies (handled by Anchor)
   anchor build
   ```

3. **Configure Solana**
   ```bash
   # Set to devnet for testing
   solana config set --url devnet
   
   # Create a keypair if you don't have one
   solana-keygen new
   
   # Get some SOL for testing
   solana airdrop 2
   ```

### Build & Test

```bash
# Build the program
anchor build

# Run tests
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## 🔧 Usage

### 1. Initialize a Pool

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Amm } from "./target/types/amm";

const program = anchor.workspace.Amm as Program<Amm>;

// Create unique pool
const seed = new anchor.BN(12345);
const fee = 300; // 3% trading fee (basis points)
const authority = null; // No admin control

await program.methods
  .initialize(seed, fee, authority)
  .accounts({
    initializer: wallet.publicKey,
    mintX: tokenXMint,
    mintY: tokenYMint,
    // Other accounts derived automatically
  })
  .rpc();
```

### 2. Add Liquidity

```typescript
// For initial deposit, you set the price ratio
const lpAmount = new anchor.BN(1000 * 10**6);  // 1000 LP tokens
const maxX = new anchor.BN(100 * 10**6);       // 100 Token X
const maxY = new anchor.BN(200 * 10**9);       // 200 Token Y

await program.methods
  .deposit(lpAmount, maxX, maxY)
  .accounts({
    lpProvider: wallet.publicKey,
    // ... other accounts
  })
  .rpc();
```

### 3. Swap Tokens

```typescript
// Swap Token X for Token Y
const isX = true;                              // Direction: X → Y
const amount = new anchor.BN(10 * 10**6);      // 10 Token X
const minOut = new anchor.BN(18 * 10**9);      // Minimum 18 Token Y

await program.methods
  .swap(isX, amount, minOut)
  .accounts({
    user: wallet.publicKey,
    // ... other accounts
  })
  .rpc();
```

### 4. Remove Liquidity

```typescript
// Withdraw 25% of LP tokens
const lpAmount = new anchor.BN(250 * 10**6);   // 250 LP tokens
const minX = new anchor.BN(20 * 10**6);        // Minimum Token X
const minY = new anchor.BN(40 * 10**9);        // Minimum Token Y

await program.methods
  .withdraw(lpAmount, minX, minY)
  .accounts({
    lpProvider: wallet.publicKey,
    // ... other accounts
  })
  .rpc();
```

## 📊 Core Concepts

### Constant Product Formula
The AMM uses the constant product formula: **x × y = k**

- When you swap tokens, the product remains constant
- Price is determined by the ratio of tokens in the pool
- Larger trades have higher price impact (slippage)

### Liquidity Provision
- **First Deposit**: Sets the initial price ratio
- **Subsequent Deposits**: Must maintain current price ratio
- **LP Tokens**: Represent ownership percentage of the pool
- **Fee Earnings**: LP providers earn trading fees proportionally

### Fee Structure
- Trading fees are set in basis points (100 = 1%)
- Fees are collected on each swap
- LP providers earn fees proportional to their pool ownership

## 🧪 Testing

The project includes comprehensive tests covering:

### Happy Paths
- ✅ Pool initialization
- ✅ Initial liquidity provision
- ✅ Subsequent proportional deposits
- ✅ Bidirectional swaps (X→Y and Y→X)
- ✅ Partial and full withdrawals

### Edge Cases
- ❌ Zero amounts
- ❌ Insufficient slippage protection
- ❌ Locked pools
- ❌ Invalid parameters

### Run Tests
```bash
# Run all tests
anchor test

# Run specific test file
anchor test --skip-deploy tests/amm.ts

# Run tests with logs
anchor test --skip-deploy -- --reporter spec
```

## 🔐 Security Features

### Built-in Protections
- **Slippage Protection**: `max_x`, `max_y`, `min` parameters prevent unfavorable trades
- **Emergency Pause**: Optional authority can lock pools
- **Input Validation**: All amounts must be positive and valid
- **PDA Security**: Accounts use deterministic addresses preventing attacks
- **Error Handling**: Comprehensive error types with clear messages

### Best Practices Implemented
- ✅ **Checked Math**: Uses external curve library for overflow protection
- ✅ **Access Controls**: Proper signer validation on all instructions  
- ✅ **Atomic Operations**: All operations complete or fail together
- ✅ **Account Validation**: Strict constraints on all accounts
- ✅ **Error Propagation**: Library errors mapped to custom errors

## 📈 Program Accounts

### Config Account
```rust
pub struct Config {
    pub seed: u64,              // Unique pool identifier
    pub authority: Option<Pubkey>, // Optional admin authority
    pub mint_x: Pubkey,         // Token X mint
    pub mint_y: Pubkey,         // Token Y mint
    pub fee: u16,               // Trading fee (basis points)
    pub locked: bool,           // Emergency pause flag
    pub config_bump: u8,        // PDA bump
    pub lp_bump: u8,            // LP mint PDA bump
}
```

### PDA Derivation
```typescript
// Config PDA
const [config, configBump] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("config"),
    mintX.toBuffer(),
    mintY.toBuffer(),
    seed.toArrayLike(Buffer, "le", 8),
  ],
  program.programId
);

// LP Token Mint PDA  
const [lpMint, lpBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("lp"), config.toBuffer()],
  program.programId
);
```

## 🛠️ Development

### Local Development Setup

1. **Start local validator**
   ```bash
   solana-test-validator
   ```

2. **Build and deploy locally**
   ```bash
   anchor build
   anchor deploy --provider.cluster localnet
   ```

3. **Run tests against local validator**
   ```bash
   anchor test --skip-local-validator
   ```

### Code Formatting
```bash
# Format Rust code
cargo fmt

# Format TypeScript code
npm run lint:fix
```

### Adding New Features

1. **Program Changes**: Modify Rust code in `programs/amm/src/`
2. **Generate Types**: Run `anchor build` to update TypeScript types
3. **Add Tests**: Add test cases in `tests/amm.ts`
4. **Update Documentation**: Update this README and inline docs

## 📚 External Dependencies

### Rust Dependencies
- **anchor-lang**: Solana development framework
- **anchor-spl**: SPL token integration
- **constant-product-curve**: Mathematical curve calculations

### TypeScript Dependencies
- **@coral-xyz/anchor**: Anchor TypeScript client
- **@solana/web3.js**: Solana web3 library
- **@solana/spl-token**: SPL token utilities

## 🔗 Useful Links

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [SPL Token Program](https://spl.solana.com/token)
- [Constant Product Curve Library](https://github.com/deanmlittle/constant-product-curve)

## 📄 License

This project is licensed under the ISC License - see the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Guidelines
1. **Follow Rust/TypeScript conventions**
2. **Add tests for new features**
3. **Update documentation**
4. **Ensure all tests pass**

### Reporting Issues
Please use GitHub Issues to report bugs or request features.

## 🚀 Deployment

### Devnet Deployment
```bash
# Build optimized program
anchor build --verifiable

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show <program-id> --programs
```

### Mainnet Deployment
```bash
# Use mainnet cluster
anchor deploy --provider.cluster mainnet

# ⚠️ Make sure to:
# 1. Audit the code thoroughly
# 2. Test extensively on devnet
# 3. Use a secure deployment key
# 4. Set up proper monitoring
```

## 📞 Support

- **Documentation**: See the inline code comments and this README
- **Issues**: Open a GitHub issue for bugs or feature requests
- **Community**: Join Solana Discord for general questions

---

**Program ID**: `3FqHinWiuVAhvL8o9MWeZAny2a6BqtEYqxTTcFS84Sqa`

Built with ❤️ for the Solana ecosystem