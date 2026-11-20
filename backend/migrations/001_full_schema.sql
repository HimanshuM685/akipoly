-- Migration: Create all tables for Akipoly game engine
-- Run this against your Neon database

-- app_users table
CREATE TABLE IF NOT EXISTS public.app_users (
    privy_user_id TEXT PRIMARY KEY,
    wallet_address TEXT,
    display_name TEXT,
    balance BIGINT DEFAULT 0
);

-- lobbies table
CREATE TABLE IF NOT EXISTS public.lobbies (
    id TEXT PRIMARY KEY,
    host_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    current_round INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- games table
CREATE TABLE IF NOT EXISTS public.games (
    id TEXT PRIMARY KEY,
    lobby_id TEXT NOT NULL,
    host_user_id TEXT NOT NULL,
    winner_user_id TEXT,
    ended_at TIMESTAMPTZ,
    status TEXT DEFAULT 'live',
    current_round INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- rounds table
CREATE TABLE IF NOT EXISTS public.rounds (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    ball INTEGER,
    status TEXT DEFAULT 'awaiting_spin',
    created_at TIMESTAMPTZ DEFAULT now(),
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    high_pool BIGINT DEFAULT 0,
    low_pool BIGINT DEFAULT 0
);

-- lobby_seats table
CREATE TABLE IF NOT EXISTS public.lobby_seats (
    lobby_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT,
    joined_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (lobby_id, user_id)
);

-- bets table
CREATE TABLE IF NOT EXISTS public.bets (
    game_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    side TEXT NOT NULL,
    amount BIGINT NOT NULL,
    settled BOOLEAN DEFAULT false,
    claimable BIGINT DEFAULT 0,
    PRIMARY KEY (game_id, round_id, user_id)
);

-- game_results table
CREATE TABLE IF NOT EXISTS public.game_results (
    game_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    placement INTEGER,
    points BIGINT DEFAULT 0,
    eliminated_round INTEGER,
    PRIMARY KEY (game_id, user_id)
);

-- randomness_commits table
CREATE TABLE IF NOT EXISTS public.randomness_commits (
    game_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    commitment TEXT NOT NULL,
    revealed_seed TEXT,
    committed_at TIMESTAMPTZ DEFAULT now(),
    revealed_at TIMESTAMPTZ,
    PRIMARY KEY (game_id, round_id)
);

-- payouts table (from 001_payouts.sql)
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