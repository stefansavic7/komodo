-- F-01 (docs/SPEC-V1.md): posao base_score (src/poslovi.js) svakih 5 minuta nalazi i oglase koji još imaju
-- ocjenu, a obrisani su (brisanje naloga, administrator) — listings_score_idx je samo za neobrisane.
-- Mali parcijalni indeks: samo oglasi s ocjenom (zadnjih ~30 dana).
create index listings_scored_idx on listings(id) where base_score > 0;

-- Lični faktori „Za tebe” (src/rute/feed.js): oglasi koje je gledalac vidio zadnjih 7 dana čitaju se jednim
-- uzastopnim dijelom indeksa umjesto ~300 sondi u primarni ključ (listing_id, viewer, day).
create index listing_views_viewer_idx on listing_views(viewer, day);
