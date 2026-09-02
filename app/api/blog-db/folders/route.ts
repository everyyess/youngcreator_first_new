import { createFolderRoute } from "@/lib/supabaseInsightRoutes";
const route = createFolderRoute("blog");
export const GET = route.GET;
export const POST = route.POST;
