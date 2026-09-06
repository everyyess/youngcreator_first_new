import { createDeletedRoute } from "@/lib/supabaseInsightRoutes";
const route = createDeletedRoute("deleted_reports", "report_url", "deletedUrls");
export const GET = route.GET;
export const POST = route.POST;
