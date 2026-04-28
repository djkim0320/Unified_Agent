import type express from "express";
import { ZodError } from "zod";

function zodDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

export function asyncRoute<
  TRequest extends express.Request,
  TResponse extends express.Response,
>(
  handler: (
    request: TRequest,
    response: TResponse,
    next: express.NextFunction,
  ) => Promise<unknown>,
): express.RequestHandler {
  return (request, response, next) => {
    void handler(request as TRequest, response as TResponse, next).catch(next);
  };
}

export const notFound: express.RequestHandler = (_request, response) => {
  response.status(404).json({ error: "Not found" });
};

export const errorHandler: express.ErrorRequestHandler = (error, _request, response, _next) => {
  if (response.headersSent) {
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Invalid request.",
      details: zodDetails(error),
    });
    return;
  }

  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? Math.trunc((error as { status: number }).status)
      : 500;
  if (status >= 400 && status < 500) {
    response.status(status).json({
      error: error instanceof Error ? error.message : "Request failed.",
    });
    return;
  }

  response.status(500).json({
    error: "Internal server error.",
  });
};
