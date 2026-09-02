import { createDeletedRoute } from "@/lib/supabaseInsightRoutes";
const route = createDeletedRoute("deleted_youtube_videos", "video_id", "deletedVideoIds");
export const GET = route.GET;
export const POST = route.POST;
