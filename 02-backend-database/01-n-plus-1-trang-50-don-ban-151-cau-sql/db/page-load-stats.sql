-- Sau khi reset thống kê và tải đúng MỘT trang (xem README mục 8), đọc số câu và buffer đã dùng.
SELECT sum(calls)                                AS statements,
       sum(shared_blks_hit + shared_blks_read)   AS buffers_touched,
       round(sum(total_exec_time)::numeric, 1)   AS total_exec_ms
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'shop')
  AND query NOT ILIKE '%pg_stat_statements%';
