-- ============================================================================
-- SECURITY FIX (PHASE 1 - CONTAINMENT): lock down the `images` storage bucket.
--
-- WHAT WAS WRONG: the bucket is private, but three policies granted the
-- `anon` role (the key that ships inside the app binary and is trivially
-- extractable) blanket access to the whole bucket with no ownership check:
--
--   Image Upload Policy 1ffg0oo_0  SELECT  bucket_id = 'images'
--   Image Upload Policy 1ffg0oo_1  UPDATE  bucket_id = 'images'
--   Image Upload Policy 1ffg0oo_2  INSERT  bucket_id = 'images'
--
-- SELECT powers both list() and createSignedUrl(), so anyone could enumerate
-- all 193 user folders and mint a working download URL for any photo. UPDATE
-- additionally let anyone OVERWRITE any user's photo. Verified live 2026-08-14
-- against the production project with nothing but the public anon key.
--
-- This is a security hole and a GDPR Art.32 personal-data breach exposure.
--
-- ----------------------------------------------------------------------------
-- WHY THIS IS "PHASE 1" AND NOT THE WHOLE FIX
--
-- 391 of 569 rows in public.history (69%) point at legacy `anonymous/...`
-- paths. Those rows belong to SIGNED-IN users who started as guests. Scoping
-- authenticated reads strictly to `<uid>/` would blank their Vault thumbnails
-- immediately, so this migration keeps ONE temporary policy that lets any
-- authenticated user read the legacy `anonymous/` prefix.
--
-- Residual risk after phase 1: someone who registers an account can still
-- enumerate the ~1500 legacy `anonymous/` photos. The 193 per-user folders are
-- fully closed to everyone but their owner, and the bare `anon` role (the app
-- binary key) gets no read access at all.
--
-- PHASE 2 (tracked separately, must follow):
--   1. Move each of the 391 owned objects from `anonymous/<file>` to
--      `<owner-uid>/<file>` using history.user_id, and update history.image_url.
--   2. Drop the temporary policy below.
--   3. Delete the true orphans in `anonymous/`, plus objects under the 14
--      folders whose auth.users row no longer exists (deleted-user erasure).
--   4. Add a retention policy so photos are not kept indefinitely.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STATUS: APPLIED to production 2026-08-14 via Dashboard -> Storage -> Policies.
--
-- The Dashboard appends a unique suffix to each policy name and emits one
-- policy per operation, so the live names are:
--
--   images: owner can read own folder 1ffg0oo_0      SELECT  authenticated
--   images: owner can read own folder 1ffg0oo_1      UPDATE  authenticated
--   images: owner can read own folder 1ffg0oo_2      DELETE  authenticated
--   images: owner can insert own folder 1ffg0oo_0    INSERT  authenticated
--   images: guests can insert into guest prefix 1ffg0oo_0   INSERT  anon
--   images: TEMP read legacy anonymous prefix 1ffg0oo_0     SELECT  authenticated
--
-- (The TEMP name is shortened from the version below because the Dashboard
-- caps policy names at 50 characters.) The Dashboard emits USING only for the
-- UPDATE policy; Postgres reuses USING as WITH CHECK when it is omitted, so
-- that is equivalent to the explicit form written below.
--
-- Verified after applying:
--   anon LIST bucket root            -> 0 entries (was 193 folders)
--   anon LIST a user folder          -> 0 entries
--   anon SIGN another user's object  -> 404 NoSuchKey (was 200 + working URL)
--   authenticated user, simulated in-DB: own folder 1 visible,
--     another user's folder 0 visible, legacy anonymous/ 1500 visible (by
--     design, via the TEMP policy), total 1501 of 1710 objects.
--
-- ----------------------------------------------------------------------------
-- HOW TO APPLY - this file CANNOT be run by the `postgres` role.
--
-- storage.objects is owned by `supabase_storage_admin`, and on this project
-- `postgres` is not a member of it and cannot grant itself membership
-- ("role memberships are reserved, only superusers can grant them"). Both the
-- CLI (supabase db query --linked) and the Dashboard SQL editor connect as
-- `postgres`, so both fail with:
--
--     ERROR: 42501: must be owner of table objects
--
-- Apply via Dashboard -> Storage -> Policies instead, which runs as the
-- storage admin. The `alter table ... enable row level security` line is
-- omitted below because RLS is already enabled (verified) and the statement
-- is owner-only.
-- ----------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Remove the blanket-access policies. This is what closes the hole.
-- ---------------------------------------------------------------------------
drop policy if exists "Image Upload Policy 1ffg0oo_0" on storage.objects;
drop policy if exists "Image Upload Policy 1ffg0oo_1" on storage.objects;
drop policy if exists "Image Upload Policy 1ffg0oo_2" on storage.objects;

-- ---------------------------------------------------------------------------
-- 2. Per-owner policies: a signed-in user sees only images/<their uid>/...
-- ---------------------------------------------------------------------------
drop policy if exists "images: owner can read own folder" on storage.objects;
create policy "images: owner can read own folder"
on storage.objects for select
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "images: owner can insert own folder" on storage.objects;
create policy "images: owner can insert own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- The app uploads with upsert: true, so overwriting own objects must work.
drop policy if exists "images: owner can update own folder" on storage.objects;
create policy "images: owner can update own folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "images: owner can delete own folder" on storage.objects;
create policy "images: owner can delete own folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- 3. Guests (bare `anon`) may WRITE into the guest prefix and nothing else.
--    No SELECT for anon anywhere, so the anon key can no longer list objects
--    or mint signed URLs. Guest scans stay broken until the client is moved to
--    server-side signing; that is the accepted phase-1 tradeoff.
-- ---------------------------------------------------------------------------
-- Tightened 2026-08-14 (same day) to the new guest path shape only, once it was
-- clear the client fix needs an app-store release and would not be live for a
-- day or more. Guests upload ~21 photos/day; with a prefix-only check, every
-- one of those from a pre-release build would be stored and then be unusable
-- (the client can no longer sign it), piling up personal data for no purpose.
-- Matching the exact uuid shape makes old builds fail at upload instead, and
-- means this policy does NOT have to be re-added when the release lands.
drop policy if exists "images: guests can insert into guest prefix" on storage.objects;
create policy "images: guests can insert into guest prefix"
on storage.objects for insert
to anon
with check (
  bucket_id = 'images'
  and name ~ '^anonymous/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
);

-- ---------------------------------------------------------------------------
-- 4. TEMPORARY - delete in phase 2 once the 391 legacy objects are migrated.
--    Without this, 69% of signed-in users' Vault thumbnails go blank.
-- ---------------------------------------------------------------------------
drop policy if exists "images: TEMP authenticated can read legacy anonymous prefix" on storage.objects;
create policy "images: TEMP authenticated can read legacy anonymous prefix"
on storage.objects for select
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = 'anonymous'
);

commit;
