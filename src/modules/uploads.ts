import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { handler, requireAuth } from "../lib/http.js";

// NOTE: This issues an upload record + URL. Wiring an actual object store
// (S3 / Cloudflare R2 / Railway volume) is a follow-up — the response shape is
// what the client needs (an id to attach + a URL to display). Swap the URL
// generation for a real presigned PUT when storage is provisioned.
export function uploadsRoutes(): Router {
  const r = Router();

  r.post(
    "/uploads",
    requireAuth,
    handler(
      { body: z.object({ content_type: z.string().default("image/jpeg"), filename: z.string().optional() }).optional() },
      async ({ body, userId, res }) => {
        const contentType = body?.content_type ?? "image/jpeg";
        const upload = await prisma.upload.create({
          data: { userId, contentType, url: `${env.PUBLIC_BASE_URL}/uploads/pending` },
        });
        const url = `${env.PUBLIC_BASE_URL}/uploads/${upload.id}`;
        await prisma.upload.update({ where: { id: upload.id }, data: { url } });

        res.status(201).json({
          id: upload.id,
          url,
          // Client PUTs the binary here once real storage is wired.
          upload_url: url,
          content_type: contentType,
        });
      },
    ),
  );

  return r;
}
