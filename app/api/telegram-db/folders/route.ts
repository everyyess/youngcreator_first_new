import { createFolderRoute } from "@/lib/supabaseInsightRoutes";
const route = createFolderRoute("telegram");
export const GET = route.GET;
export const POST = route.POST;
