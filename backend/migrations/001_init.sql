-- 001_init: fresh game schema (real USDC on Arc, no dealer).
-- Drops the previous game tables; keeps app_users (minus the fake balance).

drop table if exists public.bets cascade;
drop table if exists public.rounds cascade;
drop table if exists public.game_results cascade;
drop table if exists public.randomness_commits cascade;
drop table if exists public.payouts cascade;
drop table if exists public.games cascade;
drop table if exists public.lobby_seats cascade;
drop table if exists public.lobbies cascade;

create table if not exists public.app_users (
  privy_user_id  text primary key,
  wallet_address text,
  display_name   text
);
alter table public.app_users drop column if exists balance;
alter table public.app_users add column if not exists created_at timestamptz not null default now();
alter table public.app_users add column if not exists updated_at timestamptz not null default now();

create table public.lobbies (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id text not null references public.app_users(privy_user_id),
  name          text not null check (length(name) between 1 and 64),
  buy_in        bigint not null check (buy_in > 0),
  max_players   int not null default 10 check (max_players between 2 and 10),
  status        text not null default 'waiting'
                check (status in ('waiting', 'starting', 'live', 'finished', 'cancelled')),
  starts_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index lobbies_open_idx on public.lobbies (created_at desc)
  where status in ('waiting', 'starting', 'live');
create index lobbies_starting_idx on public.lobbies (starts_at) where status = 'starting';

create table public.lobby_players (
  lobby_id       uuid not null references public.lobbies(id) on delete cascade,
  user_id        text not null references public.app_users(privy_user_id),
  display_name   text not null check (length(display_name) between 1 and 32),
  ready          boolean not null default false,
  buy_in_tx      text unique,
  joined_at      timestamptz not null default now(),
  primary key (lobby_id, user_id)
);
create index lobby_players_user_idx on public.lobby_players (user_id);

create table public.games (
  id             uuid primary key default gen_random_uuid(),
  lobby_id       uuid not null unique references public.lobbies(id),
  status         text not null default 'live' check (status in ('live', 'finished')),
  pot            bigint not null,
  fee            bigint not null default 0,
  winner_user_id text references public.app_users(privy_user_id),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);

create table public.game_players (
  game_id          uuid not null references public.games(id) on delete cascade,
  user_id          text not null references public.app_users(privy_user_id),
  display_name     text not null,
  buy_in           bigint not null,
  eliminated_round int,
  placement        int,
  primary key (game_id, user_id)
);
create index game_players_user_idx on public.game_players (user_id);

create table public.rounds (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  round_number  int not null check (round_number >= 0),
  phase         text not null check (phase in ('betting', 'rolling', 'settled')),
  prev_ball     int,
  ball          int,
  seed          text not null,
  seed_hash     text not null,
  outcome       text check (outcome in ('higher', 'lower', 'push', 'void', 'opening')),
  phase_ends_at timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (game_id, round_number)
);
create index rounds_due_idx on public.rounds (phase_ends_at) where phase in ('betting', 'rolling');

create table public.picks (
  round_id    uuid not null references public.rounds(id) on delete cascade,
  user_id     text not null references public.app_users(privy_user_id),
  direction   text not null check (direction in ('higher', 'lower')),
  side_bet    bigint not null default 0 check (side_bet >= 0),
  side_bet_tx text unique,
  created_at  timestamptz not null default now(),
  primary key (round_id, user_id)
);

-- Every incoming USDC transfer we accepted. tx_hash PK = replay protection.
create table public.chain_transfers (
  tx_hash      text primary key,
  user_id      text not null references public.app_users(privy_user_id),
  from_address text not null,
  amount       bigint not null,
  purpose      text not null check (purpose in ('buy_in', 'side_bet')),
  created_at   timestamptz not null default now()
);

create table public.payouts (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_id         text not null references public.app_users(privy_user_id),
  to_address      text not null,
  amount          bigint not null check (amount > 0),
  reason          text not null check (reason in ('refund', 'pot', 'side_win', 'side_refund', 'split')),
  game_id         uuid,
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'confirmed', 'failed', 'held')),
  -- Signed before broadcast so a crash never causes a double send:
  -- the same raw tx (same hash) is rebroadcast until it lands.
  tx_hash         text,
  raw_tx          text,
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index payouts_due_idx on public.payouts (next_attempt_at) where status = 'pending';
create index payouts_sent_idx on public.payouts (updated_at) where status = 'sent';
