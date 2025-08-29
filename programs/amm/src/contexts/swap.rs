use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{transfer_checked, TransferChecked, Token, Mint, TokenAccount}};
use constant_product_curve::{ConstantProduct, LiquidityPair, SwapResult};

use crate::state::Config;
use crate::errors::AmmError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapArgs {
    pub is_x: bool,
    pub amount: u64, 
    pub min: u64,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [
            b"config", 
            mint_x.key().to_bytes().as_ref(),
            mint_y.key().to_bytes().as_ref(),
            config.seed.to_le_bytes().as_ref()    
        ],
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,   
    #[account(
        seeds = [b"lp", config.key().as_ref()],
        bump = config.lp_bump,
        mint::decimals = 6,
        mint::authority = config
    )]
    pub mint_lp: Account<'info, Mint>, 
    pub mint_x: Account<'info, Mint>,
    pub mint_y: Account<'info, Mint>, 
    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config,
    )]
    pub vault_x: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
    )]
    pub vault_y: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_x,
        associated_token::authority = user,
    )]
    pub user_ata_x: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_y,
        associated_token::authority = user,
    )]
    pub user_ata_y: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Swap<'info> {
    pub fn swap(&mut self, args: SwapArgs) -> Result<()> {
        require!(args.amount > 0, AmmError::InvalidAmount);
        require!(self.config.locked == false, AmmError::AMMLocked);

        // FIXED: Check for zero balance before creating curve
        require!(self.vault_x.amount > 0 && self.vault_y.amount > 0, AmmError::InsufficientBalance);
        require!(self.mint_lp.supply > 0, AmmError::InsufficientBalance);

        let mut curve = ConstantProduct::init(
            self.vault_x.amount,
            self.vault_y.amount,
            self.mint_lp.supply,
            self.config.fee, 
            None,
        ).map_err(|e| AmmError::from(e))?; // FIXED: Handle error properly

        let p = match args.is_x {
            true => LiquidityPair::X,
            false => LiquidityPair::Y,
        };

        let res = curve.swap(p, args.amount, args.min).map_err(|e| AmmError::from(e))?;

        require_neq!(res.deposit, 0, AmmError::InvalidAmount);
        require_neq!(res.withdraw, 0, AmmError::InvalidAmount);

        let res2 = SwapResult {
            deposit: res.deposit.clone(),
            withdraw: res.withdraw.clone(),
            fee: res.fee.clone(),
        };
        
        self.transfer_to_vault(args.clone(), res)?;
        
        self.withdraw_from_vault(args, res2)?;

        Ok(())
    }

    fn transfer_to_vault(&mut self, args: SwapArgs, res: SwapResult) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();

        // FIXED: Correct token account assignment
        let (cpi_accounts, mint_decimals) = match args.is_x {
            true => ( TransferChecked {
                from: self.user_ata_x.to_account_info(),
                mint: self.mint_x.to_account_info(),
                to: self.vault_x.to_account_info(),
                authority: self.user.to_account_info(),
            }, self.mint_x.decimals),
            false => ( TransferChecked {
                from: self.user_ata_y.to_account_info(), // FIXED: was user_ata_x
                mint: self.mint_y.to_account_info(),     // FIXED: was mint_x
                to: self.vault_y.to_account_info(),      // FIXED: was vault_x
                authority: self.user.to_account_info(),
            }, self.mint_y.decimals),                    // FIXED: was mint_x.decimals
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        transfer_checked(cpi_ctx, res.deposit, mint_decimals)?;

        Ok(())
    }

    fn withdraw_from_vault(&mut self, args: SwapArgs, res: SwapResult) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();

        let (cpi_accounts, mint_decimals) = match args.is_x {
            true => (TransferChecked {
                from: self.vault_y.to_account_info(),
                mint: self.mint_y.to_account_info(),
                to: self.user_ata_y.to_account_info(),
                authority: self.config.to_account_info(),
            }, self.mint_y.decimals),

            false => (TransferChecked {
                from: self.vault_x.to_account_info(),
                mint: self.mint_x.to_account_info(),
                to: self.user_ata_x.to_account_info(),
                authority: self.config.to_account_info(),
            }, self.mint_x.decimals),
        };

        let mint_x = self.mint_x.key().to_bytes();
        let mint_y = self.mint_y.key().to_bytes();
        let seed = self.config.seed.to_le_bytes();

        // FIXED: Add config bump to signer seeds
        let seeds = [
            b"config", 
            mint_x.as_ref(),
            mint_y.as_ref(),
            seed.as_ref(),
            &[self.config.config_bump]
        ];

        let signer_seeds =  &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        transfer_checked(cpi_ctx, res.withdraw, mint_decimals)?;

        Ok(())
    }
}