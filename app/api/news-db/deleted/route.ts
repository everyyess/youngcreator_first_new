import { createDeletedRoute } from "@/lib/supabaseInsightRoutes";
const route = createDeletedRoute("deleted_news_articles", "article_url", "deletedUrls");
export const GET = route.GET;
export const POST = route.POST;
