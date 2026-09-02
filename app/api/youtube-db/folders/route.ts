import { createFolderRoute } from "@/lib/supabaseInsightRoutes";
const route = createFolderRoute("youtube");
export const GET = route.GET;
export const POST = route.POST;
