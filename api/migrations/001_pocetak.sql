-- Početna šema: nalozi (butici), prijave, oglasi i sviđanja.

create table users (
  id            serial primary key,
  email         text not null unique,
  password_hash text not null,
  shop_name     text not null,
  handle        text not null unique,
  phone         text not null default '',
  instagram     text not null default '',
  city          text not null default 'Banja Luka',
  created_at    timestamptz not null default now()
);

create table sessions (
  token      text primary key,
  user_id    integer not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions(user_id);

create table listings (
  id           serial primary key,
  user_id      integer not null references users(id) on delete cascade,
  title        text not null,
  price_cents  integer not null check (price_cents > 0),
  category     text not null,
  video_path   text not null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index listings_feed_idx on listings(id desc) where deleted_at is null;
create index listings_user_idx on listings(user_id);

create table likes (
  user_id    integer not null references users(id) on delete cascade,
  listing_id integer not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index likes_listing_idx on likes(listing_id);
