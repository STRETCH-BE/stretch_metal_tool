-- IFC uploads: the original .ifc file is stored as its own kind; the parts
-- split out of it are STEP files (kind 'step') like any other part model.
-- File path: /supabase/migrations/20260928000000_file_kind_ifc.sql
alter type public.file_kind add value if not exists 'ifc';
