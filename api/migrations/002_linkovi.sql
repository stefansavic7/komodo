-- Umjesto jednog polja za Instagram: lista linkova (Instagram, Facebook, TikTok, sajt…).
alter table users add column links jsonb not null default '[]'::jsonb;
update users set links = jsonb_build_array('https://instagram.com/' || instagram) where instagram <> '';
alter table users drop column instagram;
