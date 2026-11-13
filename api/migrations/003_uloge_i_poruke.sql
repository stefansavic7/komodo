-- Uloge: kupac se registruje sam, butik otvara administrator (api/src/novi-butik.js).
-- Svi dosadašnji nalozi su bili butici.
alter table users add column role text not null default 'kupac' check (role in ('kupac', 'butik'));
update users set role = 'butik';

-- Poruke: jedan razgovor po paru kupac–butik.
create table conversations (
  id               serial primary key,
  customer_id      integer not null references users(id) on delete cascade,
  shop_id          integer not null references users(id) on delete cascade,
  listing_id       integer references listings(id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  customer_read_at timestamptz not null default now(),
  shop_read_at     timestamptz not null default now(),
  unique (customer_id, shop_id)
);
create index conversations_shop_idx on conversations(shop_id, last_message_at desc);
create index conversations_customer_idx on conversations(customer_id, last_message_at desc);

create table messages (
  id              serial primary key,
  conversation_id integer not null references conversations(id) on delete cascade,
  sender_id       integer not null references users(id) on delete cascade,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on messages(conversation_id, id);
