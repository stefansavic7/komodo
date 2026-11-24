-- Popravke iz recenzije 3 (docs/RECENZIJA-3.md, „Stanje popravki”).

-- R3-01: vlasnik ključa „u toku” (nasumična oznaka zahtjeva koji ga je zauzeo). Ključ „u toku” kome je istekao rok
-- rute (poruka 60 s, objava = rok za cijeli zahtjev) smije preuzeti novi zahtjev; stari zahtjev, ako ipak završi,
-- tada ne smije ni upisati svoj odgovor ni obrisati tuđi ključ (update/delete … where vlasnik = $n).
alter table idempotency_keys add column vlasnik text;

-- R3-08: oznaka zakupa reda outboxa. Prolaz prije svake serije produžava zakup samo za redove s njegovom oznakom,
-- pa red čiji je zakup u međuvremenu istekao i koji je preuzeo drugi prolaz ne šalje dvaput.
alter table outbox add column zakup text;

-- R3-09: dnevnik promjena režima rada (ko, kada, staro → novo). user_id ostaje null kad se nalog administratora
-- obriše; zapis ostaje.
create table rezim_promjene (
  id         bigserial primary key,
  user_id    integer references users(id) on delete set null,
  staro      text not null,
  novo       text not null,
  okolina    boolean not null default false,  -- true: vraćeno na KOMODO_REZIM iz okoline
  created_at timestamptz not null default now()
);
create index rezim_promjene_created_idx on rezim_promjene(created_at desc);
