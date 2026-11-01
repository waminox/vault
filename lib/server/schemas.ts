import { z } from "zod";

export const Uuid = z.string().uuid();
export const AlbumName = z
  .string()
  .trim()
  .min(1, "Name required")
  .max(80)
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, ""));
export const ItemName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((s) => s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ""));

export const ListQuerySchema = z.object({
  view: z.enum(["all", "photos", "videos", "favorites", "unsorted", "trash", "album"]).default("all"),
  albumId: Uuid.optional(),
  kind: z.enum(["image", "video"]).optional(),
  sort: z.enum(["manual", "added", "taken", "name", "size", "duration"]).default("added"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().max(100).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
