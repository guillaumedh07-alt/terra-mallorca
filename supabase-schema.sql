-- ═══════════════════════════════════════════════════════════════
-- TERRA — Your Private Estate · Supabase schema
-- ───────────────────────────────────────────────────────────────
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS /
-- DROP POLICY IF EXISTS) so re-running after an edit won't error.
--
-- SECURITY NOTE — read before running:
-- The Supabase "publishable" (anon) key ends up in the site's
-- public HTML (client-side), in a public GitHub repo. Row Level
-- Security (RLS) is enabled on every table below with NO public
-- policies, so the anon key alone cannot read or write anything.
-- All real reads/writes go through the Netlify Functions, which
-- use the SECRET key server-side (service_role) and therefore
-- bypass RLS entirely. Do not add public SELECT/INSERT policies
-- here unless you specifically want the browser to talk to
-- Supabase directly instead of through a function.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─── 1. RESERVATIONS ─────────────────────────────────────────────
create table if not exists public.reservations (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  guest_name               text not null,
  guest_email              text not null,
  guest_phone              text,
  arrival_date             date not null,
  departure_date           date not null,
  nights                   integer not null,
  guests_count             integer not null,
  extras                   jsonb not null default '[]'::jsonb,
  special_requests         text,
  discount_code            text,
  base_price                numeric(10,2) not null,
  extras_price             numeric(10,2) not null default 0,
  total_price              numeric(10,2) not null,
  stripe_payment_intent_id text,
  stripe_payment_status    text not null default 'pending'
                             check (stripe_payment_status in ('pending','paid','failed','refunded')),
  status                   text not null default 'pending'
                             check (status in ('pending','confirmed','cancelled')),
  language                 text not null default 'es'
                             check (language in ('es','en','fr','de'))
);

create index if not exists reservations_dates_idx
  on public.reservations (arrival_date, departure_date);
create index if not exists reservations_stripe_pi_idx
  on public.reservations (stripe_payment_intent_id);

alter table public.reservations enable row level security;
drop policy if exists "no public access" on public.reservations;
-- (intentionally no policies — service_role only, see note above)

-- ─── 2. BLOCKED DATES ────────────────────────────────────────────
create table if not exists public.blocked_dates (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  from_date       date not null,
  until_date      date not null,
  -- 'private' matches the admin panel's own <select id="blockReason">
  -- option value — kept as-is rather than remapped to avoid confusion.
  reason          text not null default 'reservation'
                    check (reason in ('reservation','owner_stay','private','maintenance','event')),
  guest_name      text,
  reservation_id  uuid references public.reservations(id) on delete set null,
  created_by      text not null default 'admin'
                    check (created_by in ('admin','system'))
);

create index if not exists blocked_dates_range_idx
  on public.blocked_dates (from_date, until_date);

alter table public.blocked_dates enable row level security;
drop policy if exists "no public access" on public.blocked_dates;

-- ─── 3. DISCOUNT CODES ───────────────────────────────────────────
create table if not exists public.discount_codes (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  code            text not null unique,
  discount_type   text not null check (discount_type in ('percentage','fixed')),
  discount_value  numeric(10,2) not null,
  valid_from      date not null,
  valid_until     date not null,
  max_uses        integer not null default 1,
  current_uses    integer not null default 0,
  is_active       boolean not null default true
);

create unique index if not exists discount_codes_code_idx
  on public.discount_codes (upper(code));

alter table public.discount_codes enable row level security;
drop policy if exists "no public access" on public.discount_codes;

-- ─── 4. REVIEWS ──────────────────────────────────────────────────
create table if not exists public.reviews (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  guest_name      text not null,
  rating          integer not null check (rating between 1 and 5),
  comment         text,
  stay_date       text,
  is_published    boolean not null default false,
  language        text not null default 'es'
                    check (language in ('es','en','fr','de'))
);

alter table public.reviews enable row level security;
drop policy if exists "no public access" on public.reviews;
-- Reviews are the one table where a public read makes sense (only
-- published ones). Uncomment if you want the frontend to read
-- reviews directly with the anon key instead of via a function:
--
-- create policy "public can read published reviews"
--   on public.reviews for select
--   using (is_published = true);
