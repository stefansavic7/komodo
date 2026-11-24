-- Talas 4 „otpornost” (docs/PLAN-PRODUKCIJA.md, Faza 2b; docs/ARHITEKTURA.md, odjeljak „Otpornost”).

-- 1. Vruć brojač: sviđanje ne mijenja red oglasa u listings, nego upisuje razliku (+1 / −1) ovdje. Posao u
--    src/poslovi.js (sabirSvidjanja, svake sekunde) sabira razlike u listings.likes_count i briše ih u istoj
--    transakciji. Tačan broj = listings.likes_count + zbir razlika koje posao još nije sabrao; to čitaju
--    LISTING_SELECT, /api/likes i odgovor na sviđanje. Bez stranog ključa: upis ne zaključava red oglasa
--    (FOR KEY SHARE), a razlike za oglas koji više ne postoji posao samo obriše.
create table listing_likes_delta (
  id         bigserial primary key,
  listing_id integer not null,
  delta      integer not null
);
create index listing_likes_delta_listing_idx on listing_likes_delta(listing_id);

-- 2. Odgođeni poslovi koji se ne gube (outbox): push o novoj poruci i o sniženju se prvo upisuju ovdje (u istoj
--    naredbi/transakciji kao poruka, odnosno izmjena cijene), a šalje ih posao (src/outbox.js) u serijama.
--    vrsta: 'poruka' | 'snizenje' | 'push'. Red se „zakupi” (run_at pomjeren unaprijed, for update skip locked),
--    pa ga dva procesa nikad ne uzmu istovremeno; ako proces padne usred slanja, red se ponovo pokuša kad zakup
--    istekne. Greška → ponovo s rastućim čekanjem; poslije OUTBOX_POKUSAJA pokušaja red je „mrtav” (dead_at).
create table outbox (
  id         bigserial primary key,
  vrsta      text not null check (vrsta in ('poruka', 'snizenje', 'push')),
  payload    jsonb not null,
  pokusaja   integer not null default 0,
  run_at     timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  dead_at    timestamptz,
  greska     text
);
create index outbox_ceka_idx on outbox(run_at, id) where sent_at is null and dead_at is null;
create index outbox_created_idx on outbox(created_at);

-- 3. Ključ protiv duplog slanja (Idempotency-Key): POST poruke i POST /api/listings. Isti ključ istog korisnika
--    za istu radnju u 24 h vraća sačuvan odgovor. status null = zahtjev je još u toku. Čišćenje: posao cleanup.
create table idempotency_keys (
  user_id    integer not null references users(id) on delete cascade,
  ruta       text not null,
  kljuc      text not null,
  status     integer,
  odgovor    text,
  created_at timestamptz not null default now(),
  primary key (user_id, ruta, kljuc)
);
create index idempotency_keys_created_idx on idempotency_keys(created_at);

-- 4. „Veliki crveni prekidač”: režim rada koji je administrator izabrao (ključ 'rezim', vrijednost
--    "normalno" | "stedi" | "hitno"). Bez reda važi KOMODO_REZIM iz okoline (zadano normalno).
create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
