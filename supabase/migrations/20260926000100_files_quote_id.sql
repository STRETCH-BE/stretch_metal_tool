-- ============================================================================
-- files.quote_id — tie every uploaded file to its quote
-- File path: /supabase/migrations/20260926000100_files_quote_id.sql
--
-- Until now a file's quote was only implied by its storage path
-- (quotes/<quote id>/<file id>/<name>). The intake review asked for an
-- explicit, RLS-checked association: a sales user may only register files
-- for quotes they can edit, and every quote-scoped lookup (PDF companion
-- matching, "files of this quote") uses the column instead of a path
-- prefix. The storage insert policy is tightened the same way: the object
-- name's second segment must be a quote the user can edit (uploads go
-- through signed upload URLs minted by the server, which already checks
-- this — the policy is defence in depth).
-- ============================================================================

alter table public.files
  add column if not exists quote_id uuid references public.quotes (id) on delete cascade;
create index if not exists files_quote_idx on public.files (quote_id);

-- Backfill from the storage path convention for rows created before this
-- migration (no-op on a fresh project).
update public.files f
set quote_id = q.id
from public.quotes q
where f.quote_id is null
  and split_part(f.storage_path, '/', 1) = 'quotes'
  and split_part(f.storage_path, '/', 2) = q.id::text;

drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check (
    public.can_write()
    and uploaded_by = auth.uid()
    and (quote_id is null or public.can_edit_quote(quote_id))
  );

-- Only the owner of an editable quote (or an admin) may add objects under
-- that quote's folder; anything outside quotes/<uuid>/ is refused.
create or replace function public.storage_quote_id(p_name text)
returns uuid language plpgsql immutable as $$
begin
  if split_part(p_name, '/', 1) <> 'quotes' then
    return null;
  end if;
  return split_part(p_name, '/', 2)::uuid;
exception when others then
  return null;
end $$;

drop policy if exists quote_files_insert on storage.objects;
create policy quote_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'quote-files'
    and public.can_write()
    and public.storage_quote_id(name) is not null
    and public.can_edit_quote(public.storage_quote_id(name))
  );
