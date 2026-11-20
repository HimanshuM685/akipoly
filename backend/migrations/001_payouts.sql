-- Migration: Create payouts table for USDC settlement tracking
CREATE TABLE IF NOT EXISTS public.payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount_usdc BIGINT NOT NULL,
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payouts_game_id ON public.payouts(game_id);
CREATE INDEX IF NOT EXISTS idx_payouts_user_id ON public.payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON public.payouts(status);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS balance BIGINT DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_app_users_balance ON public.app_users(balance);
