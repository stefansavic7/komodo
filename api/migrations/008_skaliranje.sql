-- Skaliranje (docs/SKALIRANJE.md): brojač sviđanja u oglasu, pregledi po gledaocu i danu,
-- ograničenja učestalosti u bazi (zajednička za sve procese) i indeksi za pretragu, kategoriju i butik.

create extension if not exists pg_trgm;

-- Broj sviđanja se čuva u oglasu; mijenja ga ruta za sviđanje u istoj transakciji s redom u likes.
alter table listings add column likes_count integer not null default 0;
update listings l set likes_count = k.n
  from (select listing_id, count(*)::int as n from likes group by listing_id) k
 where k.listing_id = l.id;

-- Jedan pregled po oglasu, po gledaocu ('u<id korisnika>' ili 'd<id uređaja>'), po danu.
create table listing_views (
  listing_id integer not null references listings(id) on delete cascade,
  viewer     text not null,
  day        date not null default current_date,
  primary key (listing_id, viewer, day)
);
create index listing_views_day_idx on listing_views(day);

-- Ograničenja učestalosti: fiksni prozor po ključu.
create table rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         integer not null
);
create index rate_limits_window_idx on rate_limits(window_start);

-- Pretraga (ilike '%…%') po nazivu oglasa i nazivu butika.
create index listings_title_trgm_idx on listings using gin (title gin_trgm_ops);
create index users_shop_name_trgm_idx on users using gin (shop_name gin_trgm_ops);

-- Feed po kategoriji i profil butika, oboje sortirano po id desc.
create index listings_category_feed_idx on listings(category, id desc) where deleted_at is null;
create index listings_user_feed_idx on listings(user_id, id desc) where deleted_at is null;
