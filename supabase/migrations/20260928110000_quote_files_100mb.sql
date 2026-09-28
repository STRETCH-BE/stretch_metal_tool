-- ============================================================================
-- quote-files bucket: 100 MB per file (IFC / STEP models), IFC MIME types
-- File path: /supabase/migrations/20260928110000_quote_files_100mb.sql
--
-- The app-side limit MAX_FILE_BYTES (lib/files/sniff.ts) moved from 25 MB
-- to 100 MB for large IFC exports; the bucket's file_size_limit must
-- match (Storage refuses larger objects at upload time). The project's
-- GLOBAL upload limit (Supabase dashboard → Storage → Settings, "Upload
-- file size limit") is not a database setting: it must be raised to at
-- least 100 MB by hand — see README "Deploy checklist".
--
-- MIME types: browsers send no type (or application/octet-stream) for
-- .ifc; the resumable upload path declares the same, and the server side
-- files .ifc rows as application/x-step (mimeForKind). Both were already
-- allowed; the list is restated here in full (idempotent update) so this
-- migration documents what the bucket accepts.
-- ============================================================================

update storage.buckets
set
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'application/dxf',
    'image/vnd.dxf',
    'application/octet-stream',
    'application/pdf',
    'model/step',
    'application/step',
    'application/x-step',
    'text/plain',
    'image/svg+xml'
  ]
where id = 'quote-files';
