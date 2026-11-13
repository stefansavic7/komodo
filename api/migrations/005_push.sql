-- Push obavještenja: Expo token po prijavi (sesiji). Odjava briše sesiju, pa i token.
create table push_tokens (
  token         text primary key,
  user_id       integer not null references users(id) on delete cascade,
  session_token text not null references sessions(token) on delete cascade,
  created_at    timestamptz not null default now()
);
create index push_tokens_user_idx on push_tokens(user_id);

alter table users add column push_enabled boolean not null default true;
