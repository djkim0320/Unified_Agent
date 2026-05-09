import type express from "express";
import { z } from "zod";
import type { AppStore } from "./context.js";

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  agentId: z.string().min(1).max(120).optional(),
  conversationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export function registerSearchRoutes(app: express.Express, params: { store: AppStore }) {
  const { store } = params;

  app.post("/api/search/rebuild", (_request, response) => {
    response.json(store.rebuildSearchIndex());
  });

  app.get("/api/search", (request, response) => {
    const query = SearchQuerySchema.parse(request.query);
    const indexedCount = store.searchDocuments({
      q: query.q,
      agentId: query.agentId,
      conversationId: query.conversationId,
      projectId: query.projectId,
      limit: 1,
      offset: 0,
    }).results.length;
    if (indexedCount === 0) {
      store.rebuildSearchIndex();
    }
    const search = store.searchDocuments({
      q: query.q,
      agentId: query.agentId,
      conversationId: query.conversationId,
      projectId: query.projectId,
      limit: query.limit,
      offset: query.offset,
    });

    response.json({
      query: query.q,
      results: search.results,
      redacted: true,
      indexMode: search.indexMode,
      limit: query.limit,
      offset: query.offset,
    });
  });
}
