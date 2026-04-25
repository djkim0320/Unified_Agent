import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR;
const { app } = createApp({
  port,
  dataDir,
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Local chat server listening on http://127.0.0.1:${port}`);
});
