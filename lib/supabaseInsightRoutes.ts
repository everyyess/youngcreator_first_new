import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { formatSupabaseError, getInsightSupabase, insightDbUnavailable } from "./supabaseInsightDb";

export function createFolderRoute(prefix: "telegram") {
  const foldersTable = `${prefix}_folders`;
  const itemsTable = `${prefix}_folder_items`;
  return {
    async GET(req: NextRequest) {
      const db = getInsightSupabase(req);
      if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
      const [{ data: folders, error: folderError }, { data: rows, error: itemError }] = await Promise.all([
        db.from(foldersTable).select("id,name").order("created_at", { ascending: true }),
        db.from(itemsTable).select("folder_id,item_id"),
      ]);
      const error = folderError ?? itemError;
      if (error) return NextResponse.json({ error: formatSupabaseError(error) }, { status: 500 });
      const items: Record<string, string[]> = {};
      for (const row of rows ?? []) (items[String(row.folder_id)] ??= []).push(String(row.item_id));
      return NextResponse.json({ folders: folders ?? [], items });
    },
    async POST(req: NextRequest) {
      const db = getInsightSupabase(req);
      if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
      const body = await req.json() as Record<string, unknown>;
      const action = String(body.action ?? "");
      try {
        if (action === "createFolder") {
          const name = String(body.name ?? "").trim();
          if (!name) return NextResponse.json({ error: "이름이 필요합니다." }, { status: 400 });
          const folder = { id: `folder_${randomUUID()}`, name };
          const { error } = await db.from(foldersTable).insert(folder);
          if (error) throw error;
          return NextResponse.json({ folder });
        }
        if (action === "renameFolder") {
          const { error } = await db.from(foldersTable).update({ name: String(body.name ?? "").trim() }).eq("id", String(body.id ?? ""));
          if (error) throw error;
          return NextResponse.json({ ok: true });
        }
        if (action === "deleteFolder") {
          const { error } = await db.from(foldersTable).delete().eq("id", String(body.id ?? ""));
          if (error) throw error;
          return NextResponse.json({ ok: true });
        }
        if (action === "addItem") {
          const { error } = await db.from(itemsTable).upsert({ folder_id: String(body.folderId ?? ""), item_id: String(body.itemId ?? "") }, { onConflict: "folder_id,item_id" });
          if (error) throw error;
          return NextResponse.json({ ok: true });
        }
        if (action === "removeItem") {
          const { error } = await db.from(itemsTable).delete().eq("folder_id", String(body.folderId ?? "")).eq("item_id", String(body.itemId ?? ""));
          if (error) throw error;
          return NextResponse.json({ ok: true });
        }
        return NextResponse.json({ error: "지원하지 않는 action" }, { status: 400 });
      } catch (error) {
        return NextResponse.json({ error: formatSupabaseError(error) }, { status: 500 });
      }
    },
  };
}

export function createDeletedRoute(table: string, keyColumn: string, responseKey: string) {
  return {
    async GET(req: NextRequest) {
      const db = getInsightSupabase(req);
      if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
      const { data, error } = await db.from(table).select(keyColumn).order("created_at", { ascending: false });
      if (error) return NextResponse.json({ error: formatSupabaseError(error) }, { status: 500 });
      return NextResponse.json({ [responseKey]: (data ?? []).map((row) => String((row as unknown as Record<string, unknown>)[keyColumn])) });
    },
    async POST(req: NextRequest) {
      const db = getInsightSupabase(req);
      if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
      const body = await req.json() as Record<string, unknown>;
      const value = String(body[keyColumn] ?? body.id ?? body.url ?? "");
      if (!value) return NextResponse.json({ error: `${keyColumn}이 필요합니다.` }, { status: 400 });
      const { error } = await db.from(table).upsert({ [keyColumn]: value } as never, { onConflict: keyColumn });
      if (error) return NextResponse.json({ error: formatSupabaseError(error) }, { status: 500 });
      return NextResponse.json({ ok: true });
    },
  };
}
