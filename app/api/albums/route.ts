import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { handle, json, readJson } from "@/lib/server/http";
import { createAlbum, listAlbums } from "@/lib/server/media";
import { AlbumName } from "@/lib/server/schemas";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  requireSession(req);
  return json({ albums: listAlbums() });
});

export const POST = handle(async (req) => {
  requireSession(req);
  const { name } = await readJson(req, z.object({ name: AlbumName }));
  return json({ album: createAlbum(name) }, { status: 201 });
});
