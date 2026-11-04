#!/usr/bin/env node

import http from "http";
import app from "./app.js";

/**
 * Get port from env.
 */
const port = normalizePort(process.env.PORT ?? "5000");
app.set("port", port);

/**
 * Create HTTP server:
 */
const server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */
server.listen(port, () => {});

server.on("error", onError);
server.on("listening", onListening);

// UTILS:

/**
 * Normalize the port into number, string, or false.
 */
function normalizePort(value) {
  const parsedPort = Number.parseInt(value, 10);

  if (Number.isNaN(parsedPort)) {
    // named pipe:
    return value;
  }

  if (parsedPort >= 0) {
    // port number:
    return parsedPort;
  }

  return false;
}

/**
 * Event listener for HTTP server "error" event.
 */
function onError(error) {
  if (error.syscall !== "listen") {
    throw error;
  }

  const bind = typeof port === "string" ? `Pipe ${port}` : `Port ${port}`;

  switch (error.code) {
    case "EACCES":
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;

    case "EADDRINUSE":
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;

    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */
function onListening() {
  const addr = server.address();
  const bind = typeof addr === "string" ? `pipe ${addr}` : `port ${addr.port}`;

  console.log(`Express server listening on ${bind}`);
}
