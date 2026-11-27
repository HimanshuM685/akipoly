-- 004_arc_vrf: balls are now drawn by the hosted Arc VRF (subscription-paid).
-- The server only requests and reads; it no longer proves or fulfils, so the
-- oracle-side job columns and the 'fulfilling' state are gone.
update public.vrf_jobs set status = 'requested' where status = 'fulfilling';

alter table public.vrf_jobs drop constraint if exists vrf_jobs_status_check;
alter table public.vrf_jobs add constraint vrf_jobs_status_check
  check (status in ('pending', 'requested', 'done', 'held'));

alter table public.vrf_jobs drop column if exists pre_seed;
alter table public.vrf_jobs drop column if exists min_confirmations;
alter table public.vrf_jobs drop column if exists callback_gas_limit;
alter table public.vrf_jobs drop column if exists num_words;
alter table public.vrf_jobs drop column if exists fulfill_tx;
alter table public.vrf_jobs drop column if exists fulfill_raw;

drop index if exists public.vrf_jobs_open_idx;
create index vrf_jobs_open_idx on public.vrf_jobs (next_attempt_at)
  where status in ('pending', 'requested');
