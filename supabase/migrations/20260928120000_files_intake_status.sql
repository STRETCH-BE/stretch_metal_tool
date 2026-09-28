-- ============================================================================
-- Intake tracking on uploads + source link on derived parts
-- File path: /supabase/migrations/20260928120000_files_intake_status.sql
--
-- A large IFC upload stores one part per element; when the route handler
-- was killed mid-way (Vercel maxDuration) the browser only saw a 504 and
-- a retry would have duplicated the parts already stored. The upload's
-- files row now records the run: intake_status processing → done |
-- partial | failed, parts_expected / parts_done as parts land,
-- intake_error with the per-part failures. The client polls
-- GET /api/files/[id]/status after a timeout and POST
-- /api/files/[id]/resume-intake stores only the missing parts: every part
-- carries source_file_id = the upload it came from (the .ifc / .step
-- itself for split models, the file itself for a DXF or single STEP), so
-- "already stored" is (source_file_id, name).
--
-- RLS: files had no update policy (nothing updated them). The intake runs
-- as the user, so the quote's editors may update their uploads' rows;
-- the app only ever writes the four intake columns through this path
-- (lib/parts/intake-db.ts updateFileIntake).
-- ============================================================================

alter table public.files
  add column if not exists intake_status text
    check (intake_status in ('processing', 'done', 'partial', 'failed')),
  add column if not exists parts_expected integer check (parts_expected >= 0),
  add column if not exists parts_done integer check (parts_done >= 0),
  add column if not exists intake_error text;

alter table public.parts
  add column if not exists source_file_id uuid references public.files (id) on delete set null;
create index if not exists parts_source_file_idx on public.parts (source_file_id);

-- Parts stored before this migration: a DXF / single STEP part came from
-- its own file, so file_id is the source. Parts split out of an IFC /
-- STEP assembly point at their derived STEP file and cannot be linked to
-- the upload automatically (the link is set for new uploads only); the
-- README describes the manual backfill for a quote that needs a resume.
update public.parts
set source_file_id = file_id
where source_file_id is null
  and file_id is not null
  and source in ('dxf', 'step');

drop policy if exists files_update_intake on public.files;
create policy files_update_intake on public.files for update to authenticated
  using (public.can_write() and quote_id is not null and public.can_edit_quote(quote_id))
  with check (public.can_write() and quote_id is not null and public.can_edit_quote(quote_id));
