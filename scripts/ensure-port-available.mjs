import net from "node:net";

const port = Number(process.argv[2] || 3000);

const server = net.createServer();

server.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing Sift dev server before starting a new one.`);
    process.exit(1);
  }

  console.error(error.message);
  process.exit(1);
});

server.once("listening", () => {
  server.close(() => process.exit(0));
});

server.listen(port, "0.0.0.0");
