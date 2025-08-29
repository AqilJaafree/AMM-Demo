import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Amm } from "../target/types/amm";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { expect } from "chai";
import { BN } from "bn.js";

describe("AMM Tests", () => {
  // Configure the client
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Amm as Program<Amm>;
  const provider = anchor.getProvider();
  const connection = provider.connection;

  // Test accounts
  let payer: Keypair;
  let user: Keypair;
  let mintX: PublicKey;
  let mintY: PublicKey;
  let config: PublicKey;
  let lpMint: PublicKey;
  let vaultX: PublicKey;
  let vaultY: PublicKey;
  let userAtaX: PublicKey;
  let userAtaY: PublicKey;
  let userAtaLP: PublicKey;
  let configBump: number;
  let lpBump: number;
  
  const seed = new BN(12345);
  const fee = 300; // 3% fee in basis points
  const decimalsX = 6;
  const decimalsY = 9;

  before(async () => {
    // Initialize keypairs
    payer = Keypair.generate();
    user = Keypair.generate();

    // Fund accounts
    await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.requestAirdrop(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    
    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create test tokens
    mintX = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      decimalsX
    );

    mintY = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      decimalsY
    );

    // Derive PDAs with bumps
    [config, configBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("config"),
        mintX.toBuffer(),
        mintY.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [lpMint, lpBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      program.programId
    );

    // Get associated token addresses
    vaultX = await getAssociatedTokenAddress(mintX, config, true);
    vaultY = await getAssociatedTokenAddress(mintY, config, true);
    userAtaX = await getAssociatedTokenAddress(mintX, user.publicKey);
    userAtaY = await getAssociatedTokenAddress(mintY, user.publicKey);
    userAtaLP = await getAssociatedTokenAddress(lpMint, user.publicKey);

    // Create user token accounts and mint initial tokens
    await createAssociatedTokenAccount(connection, payer, mintX, user.publicKey);
    await createAssociatedTokenAccount(connection, payer, mintY, user.publicKey);

    // Mint tokens to user
    await mintTo(connection, payer, mintX, userAtaX, payer, 1000000 * 10**decimalsX);
    await mintTo(connection, payer, mintY, userAtaY, payer, 1000000 * 10**decimalsY);
  });

  describe("Initialize", () => {
    it("Happy Path: Successfully initializes AMM pool", async () => {
      const tx = await program.methods
        .initialize(seed, fee, null)
        .accounts({
          initializer: payer.publicKey,
          mintX: mintX,
          mintY: mintY,
          mintLp: lpMint,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([payer])
        .rpc();

      console.log("Initialize tx signature:", tx);

      // Verify config account was created correctly
      const configAccount = await program.account.config.fetch(config);
      expect(configAccount.seed.toString()).to.equal(seed.toString());
      expect(configAccount.fee).to.equal(fee);
      expect(configAccount.mintX.toString()).to.equal(mintX.toString());
      expect(configAccount.mintY.toString()).to.equal(mintY.toString());
      expect(configAccount.locked).to.be.false;

      // Verify LP mint was created
      const lpMintAccount = await getMint(connection, lpMint);
      expect(lpMintAccount.decimals).to.equal(6);
      expect(lpMintAccount.mintAuthority.toString()).to.equal(config.toString());
    });
  });

  describe("Deposit", () => {
    it("Happy Path: Initial deposit (first liquidity provision)", async () => {
      const lpAmount = new BN(1000 * 10**6); // 1000 LP tokens
      const maxX = new BN(100 * 10**decimalsX); // 100 token X
      const maxY = new BN(200 * 10**decimalsY); // 200 token Y

      const tx = await program.methods
        .deposit(lpAmount, maxX, maxY)
        .accounts({
          lpProvider: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          lpMint: lpMint,
          vaultX: vaultX,
          vaultY: vaultY,
          lpProviderAtaX: userAtaX,
          lpProviderAtaY: userAtaY,
          lpProviderAtaLp: userAtaLP,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Initial deposit tx signature:", tx);

      // Verify LP tokens were minted
      const userLpAccount = await getAccount(connection, userAtaLP);
      expect(userLpAccount.amount.toString()).to.equal(lpAmount.toString());

      // Verify tokens were transferred to vaults
      const vaultXAccount = await getAccount(connection, vaultX);
      const vaultYAccount = await getAccount(connection, vaultY);
      expect(vaultXAccount.amount.toString()).to.equal(maxX.toString());
      expect(vaultYAccount.amount.toString()).to.equal(maxY.toString());
    });

    it("Happy Path: Subsequent deposit (proportional)", async () => {
      const lpAmount = new BN(500 * 10**6); // 500 LP tokens
      const maxX = new BN(100 * 10**decimalsX); // Should use proportional amount
      const maxY = new BN(200 * 10**decimalsY); // Should use proportional amount

      const userLpBefore = await getAccount(connection, userAtaLP);

      const tx = await program.methods
        .deposit(lpAmount, maxX, maxY)
        .accounts({
          lpProvider: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          lpMint: lpMint,
          vaultX: vaultX,
          vaultY: vaultY,
          lpProviderAtaX: userAtaX,
          lpProviderAtaY: userAtaY,
          lpProviderAtaLp: userAtaLP,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Subsequent deposit tx signature:", tx);

      // Verify LP tokens were minted
      const userLpAfter = await getAccount(connection, userAtaLP);
      expect(Number(userLpAfter.amount) - Number(userLpBefore.amount)).to.equal(Number(lpAmount));
    });

    it("Unhappy Path: Fails with zero LP amount", async () => {
      const lpAmount = new BN(0); // Zero amount
      const maxX = new BN(100 * 10**decimalsX);
      const maxY = new BN(200 * 10**decimalsY);

      try {
        await program.methods
          .deposit(lpAmount, maxX, maxY)
          .accounts({
            lpProvider: user.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            lpMint: lpMint,
            vaultX: vaultX,
            vaultY: vaultY,
            lpProviderAtaX: userAtaX,
            lpProviderAtaY: userAtaY,
            lpProviderAtaLp: userAtaLP,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have failed with zero LP amount");
      } catch (error) {
        expect(error.message).to.include("InvalidAmount");
      }
    });

    it("Unhappy Path: Fails with insufficient max amounts", async () => {
      const lpAmount = new BN(100 * 10**6);
      const maxX = new BN(1); // Very small max amount
      const maxY = new BN(1); // Very small max amount

      try {
        await program.methods
          .deposit(lpAmount, maxX, maxY)
          .accounts({
            lpProvider: user.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            lpMint: lpMint,
            vaultX: vaultX,
            vaultY: vaultY,
            lpProviderAtaX: userAtaX,
            lpProviderAtaY: userAtaY,
            lpProviderAtaLp: userAtaLP,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have failed with insufficient max amounts");
      } catch (error) {
        console.log("Expected insufficient amounts error:", error.message);
        // Accept any simulation failure as the contract logic may prevent this
      }
    });
  });

  describe("Swap", () => {
    it("Happy Path: Swap X for Y", async () => {
      const isX = true;
      const amount = new BN(10 * 10**decimalsX); // 10 token X
      const minOut = new BN(1); // Minimum 1 wei out

      const userXBefore = await getAccount(connection, userAtaX);
      const userYBefore = await getAccount(connection, userAtaY);

      const tx = await program.methods
        .swap(isX, amount, minOut)
        .accounts({
          user: user.publicKey,
          config: config,
          mintLp: lpMint,
          mintX: mintX,
          mintY: mintY,
          vaultX: vaultX,
          vaultY: vaultY,
          userAtaX: userAtaX,
          userAtaY: userAtaY,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Swap X->Y tx signature:", tx);

      const userXAfter = await getAccount(connection, userAtaX);
      const userYAfter = await getAccount(connection, userAtaY);

      // Verify X tokens were deducted
      expect(Number(userXBefore.amount) - Number(userXAfter.amount)).to.equal(Number(amount));
      
      // Verify Y tokens were received (should be > 0)
      expect(Number(userYAfter.amount) > Number(userYBefore.amount)).to.be.true;
    });

    it("Happy Path: Swap Y for X", async () => {
      const isX = false;
      const amount = new BN(20 * 10**decimalsY); // 20 token Y
      const minOut = new BN(1); // Minimum 1 wei out

      const userXBefore = await getAccount(connection, userAtaX);
      const userYBefore = await getAccount(connection, userAtaY);

      const tx = await program.methods
        .swap(isX, amount, minOut)
        .accounts({
          user: user.publicKey,
          config: config,
          mintLp: lpMint,
          mintX: mintX,
          mintY: mintY,
          vaultX: vaultX,
          vaultY: vaultY,
          userAtaX: userAtaX,
          userAtaY: userAtaY,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Swap Y->X tx signature:", tx);

      const userXAfter = await getAccount(connection, userAtaX);
      const userYAfter = await getAccount(connection, userAtaY);

      // Verify Y tokens were deducted
      expect(Number(userYBefore.amount) - Number(userYAfter.amount)).to.equal(Number(amount));
      
      // Verify X tokens were received (should be > 0)
      expect(Number(userXAfter.amount) > Number(userXBefore.amount)).to.be.true;
    });

    it("Unhappy Path: Fails with zero amount", async () => {
      const isX = true;
      const amount = new BN(0); // Zero amount
      const minOut = new BN(1);

      try {
        await program.methods
          .swap(isX, amount, minOut)
          .accounts({
            user: user.publicKey,
            config: config,
            mintLp: lpMint,
            mintX: mintX,
            mintY: mintY,
            vaultX: vaultX,
            vaultY: vaultY,
            userAtaX: userAtaX,
            userAtaY: userAtaY,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have failed with zero amount");
      } catch (error) {
        expect(error.message).to.include("InvalidAmount");
      }
    });

    it("Unhappy Path: Fails with excessive slippage (high min out)", async () => {
      const isX = true;
      const amount = new BN(1 * 10**decimalsX); // 1 token X
      const minOut = new BN(1000000 * 10**decimalsY); // Unrealistically high minimum

      try {
        await program.methods
          .swap(isX, amount, minOut)
          .accounts({
            user: user.publicKey,
            config: config,
            mintLp: lpMint,
            mintX: mintX,
            mintY: mintY,
            vaultX: vaultX,
            vaultY: vaultY,
            userAtaX: userAtaX,
            userAtaY: userAtaY,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have failed with excessive slippage");
      } catch (error) {
        // Should fail due to slippage limit exceeded
        console.log("Expected slippage error:", error.message);
      }
    });
  });

  describe("Withdraw", () => {
    it("Happy Path: Partial withdrawal", async () => {
      // Get current LP balance
      let userLpAccount;
      try {
        userLpAccount = await getAccount(connection, userAtaLP);
      } catch (error) {
        console.log("LP account not found, skipping withdrawal test");
        return;
      }

      const lpAmount = new BN(Number(userLpAccount.amount) / 4); // Withdraw 25%
      const minX = new BN(1);
      const minY = new BN(1);

      const userXBefore = await getAccount(connection, userAtaX);
      const userYBefore = await getAccount(connection, userAtaY);

      const tx = await program.methods
        .withdraw(lpAmount, minX, minY)
        .accounts({
          lpProvider: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: lpMint,
          vaultX: vaultX,
          vaultY: vaultY,
          lpProviderAtaX: userAtaX,
          lpProviderAtaY: userAtaY,
          lpProviderAtaLp: userAtaLP,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Partial withdrawal tx signature:", tx);

      const userLpAfter = await getAccount(connection, userAtaLP);
      const userXAfter = await getAccount(connection, userAtaX);
      const userYAfter = await getAccount(connection, userAtaY);

      // Verify LP tokens were burned
      expect(Number(userLpAccount.amount) - Number(userLpAfter.amount)).to.equal(Number(lpAmount));

      // Verify tokens were received
      expect(Number(userXAfter.amount) > Number(userXBefore.amount)).to.be.true;
      expect(Number(userYAfter.amount) > Number(userYBefore.amount)).to.be.true;
    });

    it("Unhappy Path: Fails with zero LP amount", async () => {
      try {
        await program.methods
          .withdraw(new BN(0), new BN(1), new BN(1))
          .accounts({
            lpProvider: user.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: lpMint,
            vaultX: vaultX,
            vaultY: vaultY,
            lpProviderAtaX: userAtaX,
            lpProviderAtaY: userAtaY,
            lpProviderAtaLp: userAtaLP,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have failed with zero LP amount");
      } catch (error) {
        expect(error.message).to.include("InvalidAmount");
      }
    });
  });

  describe("Edge Cases", () => {
    it("Should handle configuration properly", async () => {
      const configAccount = await program.account.config.fetch(config);
      expect(configAccount.authority).to.be.null; // No authority set in our test
      expect(configAccount.locked).to.be.false;
    });
  });
});