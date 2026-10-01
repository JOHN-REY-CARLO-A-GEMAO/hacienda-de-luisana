-- Phase 0 SUPPLEMENTAL harness — NOT Supabase, NOT staging.
--
-- A minimal reconstruction of the parts of Supabase's `storage` schema that
-- `supabase/01-storage.sql` references, so that file can be applied VERBATIM to
-- a real PostgreSQL policy engine (PGlite / PostgreSQL 17) and its row-level
-- security evaluated by Postgres itself rather than by a hand-written model.
--
-- Known divergences from a real Supabase project (each limits what a result
-- here can prove):
--  * The Supabase Storage API (storage-api) is absent. Real uploads go through
--    it: it chooses INSERT vs INSERT ... ON CONFLICT, may use RETURNING, sets
--    `owner`, and enforces `file_size_limit` / MIME rules. None of that runs here.
--  * Column set, triggers, helper functions other than `storage.foldername`,
--    and grants are approximations of Supabase's published migrations.
--  * No PostgREST / JWT layer: roles are entered with SET ROLE.
-- Anything that depends on those layers stays REQUIRES STAGING.
create schema storage;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table storage.buckets (
  id text primary key, name text not null unique, owner uuid,
  public boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text,
  metadata jsonb, version text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now()
);
create unique index bucketid_objname on storage.objects (bucket_id, name);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
-- a second bucket, to prove policies are bucket-scoped
insert into storage.buckets (id, name, public) values ('other-bucket', 'other-bucket', false);
