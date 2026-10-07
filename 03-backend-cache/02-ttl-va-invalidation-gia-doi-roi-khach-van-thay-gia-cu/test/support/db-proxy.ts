import { connect, createServer, type Socket } from 'node:net';

/**
 * Proxy TCP giữa app và PostgreSQL để dựng "đọc chen giữa" một cách tất định, không cần móc vào mã nguồn:
 * hold() giữ lại dữ liệu PostgreSQL trả về cho app (câu SELECT đã chạy, snapshot đã chụp, nhưng app chưa nhận được
 * kết quả); release() trả hết phần đã giữ theo đúng thứ tự.
 */
export async function startDbProxy(targetPort: number) {
  let holding = false;
  let heldBytes = 0;
  const held: { socket: Socket; chunk: Buffer }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(targetPort, '127.0.0.1');
    sockets.add(client).add(upstream);
    client.on('data', (d) => upstream.write(d));
    upstream.on('data', (d) => {
      if (!holding) client.write(d);
      else {
        held.push({ socket: client, chunk: d });
        heldBytes += d.length;
      }
    });
    const closeBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('close', closeBoth).on('error', closeBoth);
    upstream.on('close', closeBoth).on('error', closeBoth);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return {
    url: `postgres://app:app@127.0.0.1:${port}/shop`,
    hold: () => {
      holding = true;
      heldBytes = 0;
    },
    heldBytes: () => heldBytes,
    release: () => {
      holding = false;
      for (const { socket, chunk } of held.splice(0)) socket.write(chunk);
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
