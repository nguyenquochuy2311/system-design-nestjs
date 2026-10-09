// Log dạng text tự do như hệ thống "trước" khi có quy ước giám sát: mỗi đội tự viết câu, không có thời gian xử lý,
// không có id request (log có cấu trúc + correlation id là bài 23/02). Cả hai bản trước/sau đều giữ log này.
export function textLog(service: string) {
  const line = (level: string, msg: string) => `${new Date().toISOString()} ${level} ${service}: ${msg}`;
  return {
    info: (msg: string) => console.log(line('INFO', msg)),
    error: (msg: string) => console.error(line('ERROR', msg)),
  };
}

export function listenPort(fallback: number): number {
  return Number(process.env.PORT ?? fallback);
}
