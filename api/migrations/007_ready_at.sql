-- Kad je Bunny završio obradu. Lokalni snimak se briše pola sata kasnije,
-- da se ne prekine puštanje kupcima koji su oglas otvorili dok se obrađivao.
alter table listings add column ready_at timestamptz;
