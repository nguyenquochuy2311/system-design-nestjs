import { useEffect, useState } from 'react';
import { getReport, type ReportRow } from '../api';
import { formatMoney } from '../format';

// Màn tải lười (React.lazy): thành chunk riêng, chỉ tải khi người dùng mở "Báo cáo".
// __REPORTS_LAYOUT__ đổi giữa các bản 42 → 43 → 44 để có "bản chỉ sửa một màn hình".
export default function ReportsScreen() {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getReport().then((r) => setRows(r.rows), (e: unknown) => setError(String(e)));
  }, []);
  if (error) return <p role="alert">Không tải được báo cáo: {error}</p>;
  if (!rows) return <p>Đang tải số liệu…</p>;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <section data-screen="reports" data-layout={__REPORTS_LAYOUT__}>
      <h1>{__REPORTS_LAYOUT__ === 'c' ? 'Báo cáo pipeline theo giai đoạn' : 'Báo cáo pipeline'}</h1>
      <table>
        <thead>
          <tr>
            <th>Giai đoạn</th>
            <th>Số cơ hội</th>
            <th>Giá trị</th>
            {__REPORTS_LAYOUT__ !== 'a' && <th>Tỉ lệ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stage}>
              <td>{r.stage}</td>
              <td>{r.deals}</td>
              <td>{formatMoney(r.value)}</td>
              {__REPORTS_LAYOUT__ !== 'a' && <td>{((100 * r.value) / total).toFixed(1)} %</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
