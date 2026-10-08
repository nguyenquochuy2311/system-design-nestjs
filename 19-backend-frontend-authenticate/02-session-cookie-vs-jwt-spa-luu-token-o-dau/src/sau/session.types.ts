import 'express-session';

// Dữ liệu lưu trong phiên (ở Redis). Chỉ id ngẫu nhiên nằm trong cookie; mọi thứ khác ở phía server.
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    email?: string;
    /** Hạn tuyệt đối (epoch ms): phiên chết sau mốc này dù vẫn hoạt động. */
    absoluteExpiry?: number;
  }
}
