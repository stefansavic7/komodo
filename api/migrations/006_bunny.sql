-- Snimci na Bunny Stream. Dosadašnji snimci ostaju lokalni (api/uploads).
alter table listings add column video_provider text not null default 'local' check (video_provider in ('local', 'bunny'));
alter table listings add column video_status text not null default 'ready' check (video_status in ('ready', 'processing', 'error'));
alter table listings add column bunny_guid text;
alter table listings add column video_res text;
alter table listings alter column video_path drop not null;
create index listings_processing_idx on listings(id) where video_status = 'processing' and deleted_at is null;
