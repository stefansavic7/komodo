-- Sigurnosne popravke (docs/SIGURNOST.md).

-- S-04: uređaj (potpisan kolačić `did`) s kog je prijava na nalog već uspjela. Takav uređaj ne podliježe
-- ograničenju prijava po emailu, pa napadač pogrešnim lozinkama ne može zaključati vlasnika.
create table known_devices (
  user_id integer not null references users(id) on delete cascade,
  did     text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, did)
);
create index known_devices_seen_idx on known_devices(seen_at);

-- S-18: u bazi se čuva sha256 tokena sesije (hex), u kolačiću sirovi token. Postojeće sesije se
-- pretvaraju na licu mjesta, pa niko nije odjavljen. Push tokeni pokazuju na sesiju; veza dobija
-- `on update cascade`, da se pretvore zajedno.
-- Povratak na stariju verziju API-ja bez vraćanja baze: stari API traži sirovi token, pa su svi
-- odjavljeni (prijava ponovo radi); ništa ne pada.
alter table push_tokens drop constraint push_tokens_session_token_fkey;
alter table push_tokens add constraint push_tokens_session_token_fkey
  foreign key (session_token) references sessions(token) on delete cascade on update cascade;
update sessions set token = encode(sha256(convert_to(token, 'UTF8')), 'hex');
