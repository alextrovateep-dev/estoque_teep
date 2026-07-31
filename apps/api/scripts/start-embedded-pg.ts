import EmbeddedPostgres from "embedded-postgres";
import path from "path";
import fs from "fs";

const dataDir = path.join(__dirname, "../../.pgdata");
const port = 5433;

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "teep",
    password: "teep",
    port,
    persistent: true,
  });

  const already = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!already) {
    await pg.initialise();
  }
  await pg.start();
  if (!already) {
    await pg.createDatabase("estoque_teep");
  }
  console.log(`Embedded Postgres on postgresql://teep:teep@127.0.0.1:${port}/estoque_teep`);
  console.log("Leave this process running while developing.");
  // keep alive
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
