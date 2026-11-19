-- v1: algoritam feeda, veličine, sniženja, praćenje, adresa i radno vrijeme, statistika, brojke.
-- Tačno po docs/SPEC-V1.md, odjeljak 4. Sve nove kolone imaju zadanu vrijednost ili su null, pa prethodna
-- verzija API-ja radi s ovom šemom (povratak verzije bez vraćanja baze).

-- Oglasi
alter table listings add column sizes text[] not null default '{}';
alter table listings add column sold_at timestamptz;
update listings set sold_at = now() where sold;
alter table listings add column old_price_cents integer check (old_price_cents > 0);
alter table listings add column price_dropped_at timestamptz;
alter table listings add column base_score real not null default 0;

create index listings_score_idx on listings(base_score desc)
  where deleted_at is null and base_score > 0;
create index listings_cat_score_idx on listings(category, base_score desc)
  where deleted_at is null and base_score > 0;
create index listings_fresh_idx on listings(created_at desc) where deleted_at is null;
create index listings_sizes_idx on listings using gin (sizes) where deleted_at is null;

-- Sniženje: zadnji push o sniženju za ovo sviđanje
alter table likes add column price_notified_at timestamptz;

-- Butik: adresa, radno vrijeme, brojači praćenja
alter table users add column address text not null default '';
alter table users add column hours jsonb;
alter table users add column followers_count integer not null default 0;
alter table users add column following_count integer not null default 0;

create table follows (
  user_id    integer not null references users(id) on delete cascade,
  shop_id    integer not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id),
  check (user_id <> shop_id)
);
create index follows_shop_idx on follows(shop_id, created_at);

-- Kupac je pisao butiku iz ovog oglasa (statistika i kvalitet u algoritmu)
create table listing_contacts (
  listing_id  integer not null references listings(id) on delete cascade,
  customer_id integer not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (listing_id, customer_id)
);

-- Brojke po danu za administraciju
create table daily_stats (
  day            date primary key,
  active         integer not null default 0,
  active_users   integer not null default 0,
  active_devices integer not null default 0,
  registrations  integer not null default 0,
  shops          integer not null default 0,
  listings       integer not null default 0,
  messages       integer not null default 0,
  conversations  integer not null default 0,
  updated_at     timestamptz not null default now()
);

create index messages_created_brin on messages using brin (created_at);
create index listings_created_brin on listings using brin (created_at);
create index conversations_created_brin on conversations using brin (created_at);
create index users_created_brin on users using brin (created_at);
