-- Remove only the eight empty, retired source tables.
-- blog_folders and youtube_folders each contain a row and must be preserved.
-- Lock before checking so concurrent writes cannot cause accidental data loss.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  target_name text;
  contains_rows boolean;
BEGIN
  FOREACH target_name IN ARRAY ARRAY[
    'blog_feeds', 'blog_folder_items', 'blog_summaries', 'deleted_blog_posts',
    'deleted_youtube_videos', 'youtube_channels', 'youtube_folder_items', 'youtube_summaries'
  ] LOOP
    IF to_regclass(format('public.%I', target_name)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', target_name);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', target_name) INTO contains_rows;
      IF contains_rows THEN
        RAISE EXCEPTION 'Refusing to drop non-empty table public.%', target_name;
      END IF;
    END IF;
  END LOOP;
END
$$;

DROP TABLE IF EXISTS
  public.blog_feeds,
  public.blog_folder_items,
  public.blog_summaries,
  public.deleted_blog_posts,
  public.deleted_youtube_videos,
  public.youtube_channels,
  public.youtube_folder_items,
  public.youtube_summaries
RESTRICT;
COMMIT;
