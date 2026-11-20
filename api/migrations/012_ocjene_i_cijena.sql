-- R2-02 (docs/RECENZIJA-2.md): ocjena oglasa za „Za tebe” (base_score) prelazi u zasebnu tabelu.
-- Posao u src/poslovi.js svakih 5 minuta prepiše hiljade ocjena; dok je ocjena bila u listings, svaka serija je
-- zaključavala iste redove koje mijenjaju sviđanja i pregledi (likes_count, views), pa su /like, /view i sve
-- rute koje čekaju vezu iz bazena kasnile do 1,4 s. Sada posao piše samo u listing_scores; upis novog reda
-- uzima samo FOR KEY SHARE na oglasu (provjera stranog ključa), a to se ne sudara s update-om likes_count/views.
-- U tabeli su samo oglasi s ocjenom > 0 (ocjena 0 = red se briše), pa je mala (~oglasi zadnjih 30 dana).
create table listing_scores (
  listing_id integer primary key references listings(id) on delete cascade,
  base_score real not null check (base_score > 0)
);
insert into listing_scores(listing_id, base_score)
  select id, base_score from listings where base_score > 0 and deleted_at is null;
-- Kandidati C (src/rute/feed.js): order by base_score desc limit 200.
create index listing_scores_score_idx on listing_scores(base_score desc);

-- Kolona listings.base_score ostaje (stara verzija API-ja je čita pri povratku, docs/RUNBOOK.md, odjeljak 10), ali
-- je nova verzija više ne piše. Indeksi nad njom više ne trebaju.
drop index if exists listings_score_idx;
drop index if exists listings_cat_score_idx;
drop index if exists listings_scored_idx;

-- R2-07: push o sniženju samo ako je stara cijena važila najmanje 72 h (docs/SPEC-V1.md, F-07). price_set_at =
-- kad je trenutna cijena upisana (objava ili izmjena koja mijenja cijenu). Za postojeće oglase: zadnje sniženje
-- ili objava (ranije izmjene cijene se ne znaju).
alter table listings add column price_set_at timestamptz not null default now();
update listings set price_set_at = coalesce(price_dropped_at, created_at);
