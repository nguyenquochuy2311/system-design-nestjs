const money = new Intl.NumberFormat('vi-VN');

export const formatMoney = (v: number) => `${money.format(v)} ₫`;

/** Chữ cái đầu của hai từ cuối trong tên: "Nguyễn Văn An" → "VA". */
export const initials = (name: string) =>
  name
    .split(' ')
    .slice(-2)
    .map((w) => w[0])
    .join('');
