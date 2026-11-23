-- 003_vrf: balls come from the on-chain VRF (AkipolyRounds + AkipolyVRFCoordinator),
-- not from a server seed. Rounds gain a 'drawing' phase between betting and rolling.

-- Keep old commit-reveal seeds so games played before the switch stay verifiable.
create table if not exists public.legacy_round_seeds (
  round_id  uuid primary key references public.rounds(id) on delete cascade,
  seed      text not null,
  seed_hash text not null
);
insert into public.legacy_round_seeds (round_id, seed, seed_hash)
select id, seed, seed_hash from public.rounds
on conflict do nothing;

alter table public.rounds drop column seed;
alter table public.rounds drop column seed_hash;

alter table public.rounds drop constraint if exists rounds_phase_check;
alter table public.rounds add constraint rounds_phase_check
  check (phase in ('betting', 'drawing', 'rolling', 'settled'));

-- Copied from the chain once the VRF answers, so views and reviews can link to it.
alter table public.rounds add column vrf_request_id    text;   -- uint256, decimal
alter table public.rounds add column vrf_request_tx    text;
alter table public.rounds add column vrf_request_block bigint;
alter table public.rounds add column vrf_fulfill_tx    text;
alter table public.rounds add column vrf_random_word   text;   -- uint256, decimal

-- One VRF draw per round, sent by the single treasury worker:
--   pending → requested (requestBall tx signed + broadcast)
--           → fulfilling (proof tx signed + broadcast) → done
--   held: needs a human (reverted, or stuck far past its deadline)
-- Raw txs are stored before broadcast so a crash can only rebroadcast the
-- same transaction. A round is never requested twice (the contract enforces
-- this too).
create table public.vrf_jobs (
  round_id           uuid primary key references public.rounds(id) on delete cascade,
  game_id            uuid not null references public.games(id) on delete cascade,
  round_number       int not null,
  status             text not null default 'pending'
                     check (status in ('pending', 'requested', 'fulfilling', 'done', 'held')),
  request_tx         text,
  request_raw        text,
  request_id         text,
  pre_seed           text,
  request_block      bigint,
  min_confirmations  int,
  callback_gas_limit int,
  num_words          int,
  fulfill_tx         text,
  fulfill_raw        text,
  attempts           int not null default 0,
  last_error         text,
  next_attempt_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (game_id, round_number)
);
create index vrf_jobs_open_idx on public.vrf_jobs (next_attempt_at)
  where status in ('pending', 'requested', 'fulfilling');

-- The scheduler also watches drawing rounds: their phase_ends_at is the VRF
-- deadline, after which the round is voided.
drop index if exists public.rounds_due_idx;
create index rounds_due_idx on public.rounds (phase_ends_at) where phase in ('betting', 'drawing', 'rolling');
