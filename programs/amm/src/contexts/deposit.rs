use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer_checked, mint_to, MintTo, TransferChecked, Token, Mint, TokenAccount};

use constant_product_curve::ConstantProduct;

use crate::state::Config;
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub lp_provider: Signer<'info>,
    pub mint_x: Account<'info, Mint>,
    pub mint_y: Account<'info, Mint>,
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
        mut,
        seeds = [b"lp", config.key().as_ref()],
        bump = config.lp_bump,
        mint::decimals = 6,
        mint::authority = config,
    )]
    pub lp_mint: Account<'info, Mint>,
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
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = lp_provider,
    )]
    pub lp_provider_ata_x: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = lp_provider,
    )]
    pub lp_provider_ata_y: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = lp_provider,
        associated_token::mint = lp_mint,
        associated_token::authority = lp_provider,
    )]
    pub lp_provider_ata_lp: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Deposit<'info> {
    pub fn deposit(&mut self, lp_amount: u64, max_x: u64, max_y: u64) -> Result<()> {
        require!(lp_amount > 0, AmmError::InvalidAmount);
        require!(!self.config.locked, AmmError::AMMLocked);

        let (x, y) = match self.lp_mint.supply == 0 && self.vault_x.amount == 0 && self.vault_y.amount == 0 {
            true => (max_x, max_y),
            false => {
                let amounts = ConstantProduct::xy_deposit_amounts_from_l(
                    self.vault_x.amount,
                    self.vault_y.amount,
                    self.lp_mint.supply,
                    lp_amount,
                    6,
                ).map_err(|_| AmmError::InvalidAmount)?; // Handle error properly
                (amounts.x, amounts.y) 
            },
        };

        require!(max_x >= x, AmmError::InsufficientTokenX);
        require!(max_y >= y, AmmError::InsufficientTokenY);

        self.deposit_token(true, x)?;
        self.deposit_token(false, y)?;
        self.mint_lp_tokens(lp_amount)?;

        Ok(())
    }

    fn deposit_token(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();

        let (cpi_accounts, mint_decimals) = match is_x {
            true => (TransferChecked {
                    from: self.lp_provider_ata_x.to_account_info(),
                    mint: self.mint_x.to_account_info(),
                    to: self.vault_x.to_account_info(),
                    authority: self.lp_provider.to_account_info(),
                }, self.mint_x.decimals),
            false => (TransferChecked {
                    from: self.lp_provider_ata_y.to_account_info(),
                    mint: self.mint_y.to_account_info(),
                    to: self.vault_y.to_account_info(),
                    authority: self.lp_provider.to_account_info(),
                }, self.mint_y.decimals),
        };
        
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        transfer_checked(cpi_ctx, amount, mint_decimals)?;

        Ok(())
    }

    fn mint_lp_tokens(&mut self, amount: u64) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();

        let cpi_accounts = MintTo {
            mint: self.lp_mint.to_account_info(),
            to: self.lp_provider_ata_lp.to_account_info(),
            authority: self.config.to_account_info(),
        };

        let mint_x = self.mint_x.key().to_bytes();
        let mint_y = self.mint_y.key().to_bytes();
        let seed = self.config.seed.to_le_bytes();

        // FIXED: Add the config bump to signer seeds
        let seeds = [
            b"config", 
            mint_x.as_ref(), 
            mint_y.as_ref(), 
            seed.as_ref(),
            &[self.config.config_bump]
        ];

        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        mint_to(cpi_ctx, amount)?;
        
        Ok(())
    }
}