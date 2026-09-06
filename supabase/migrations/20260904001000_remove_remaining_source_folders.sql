-- Explicitly approved follow-up: remove the two retained folder tables,
-- including their existing rows. Do not cascade to unrelated objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS public.blog_folders, public.youtube_folders RESTRICT;
COMMIT;
