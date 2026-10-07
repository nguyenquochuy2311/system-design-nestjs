/** Email xác nhận đơn. Lab không gửi thật: chỉ ghi lại để test kiểm được "có gửi hay không". */
export interface OrderEmail {
  to: string;
  subject: string;
  body: string;
}

export interface Mailer {
  send(mail: OrderEmail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

export class RecordingMailer implements Mailer {
  readonly sent: OrderEmail[] = [];

  async send(mail: OrderEmail): Promise<void> {
    this.sent.push(mail);
    // Giữ tối đa 1.000 email để lúc đo tải bộ nhớ không phình.
    if (this.sent.length > 1000) this.sent.shift();
  }
}
