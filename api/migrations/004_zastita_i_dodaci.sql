-- Potvrda emaila, gašenje naloga, tokeni za email, prodato i pregledi, prijave, blokiranje.
alter table users add column email_verified_at timestamptz;
alter table users add column suspended_at timestamptz;
update users set email_verified_at = now();

create table email_tokens (
  token      text primary key,
  user_id    integer not null references users(id) on delete cascade,
  kind       text not null check (kind in ('potvrda', 'lozinka')),
  expires_at timestamptz not null
);

alter table listings add column sold boolean not null default false;
alter table listings add column views integer not null default 0;

create table reports (
  id          serial primary key,
  reporter_id integer not null references users(id) on delete cascade,
  listing_id  integer references listings(id) on delete cascade,
  message_id  integer references messages(id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  check (listing_id is not null or message_id is not null)
);
create index reports_open_idx on reports(created_at) where resolved_at is null;

create table blocks (
  blocker_id integer not null references users(id) on delete cascade,
  blocked_id integer not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table conversations add column email_notified_at timestamptz;
