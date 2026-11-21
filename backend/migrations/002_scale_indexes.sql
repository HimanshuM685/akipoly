-- 002_scale_indexes: indexes for the career and game-review read paths,
-- which otherwise scan tables that grow with every game.
create index if not exists payouts_game_user_idx on public.payouts (game_id, user_id);
create index if not exists chain_transfers_user_idx on public.chain_transfers (user_id);
create index if not exists picks_user_idx on public.picks (user_id);
