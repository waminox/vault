import { requireSession } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { writeChunk } from "@/lib/server/uploads";

type Ctx = { params: Promise<{ id: string; index: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  requireSession(req);
  const { id, index } = await params;
  const sha = req.headers.get("x-chunk-sha256");
  return json(await writeChunk(id, Number(index), req.body, sha && /^[a-f0-9]{64}$/i.test(sha) ? sha : null));
});
