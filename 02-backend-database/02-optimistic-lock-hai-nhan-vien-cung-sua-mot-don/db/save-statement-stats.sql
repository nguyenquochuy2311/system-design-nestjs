-- Sau pnpm db:stats-reset và một lượt k6, so thời gian thực thi TRONG DB của các câu lưu vận đơn:
-- UPDATE ... WHERE id (trước), UPDATE ... WHERE id AND version (sau), SELECT ... FOR UPDATE (phương án so sánh).
SELECT left(query, 24) || ' … ' || coalesce(substring(regexp_replace(query, '\s+', ' ', 'g') from '(where .*)$'), '') AS statement,
       calls,
       round(mean_exec_time::numeric, 4)                  AS mean_ms,
       round(stddev_exec_time::numeric, 4)                AS stddev_ms,
       round(max_exec_time::numeric, 3)                   AS max_ms
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'logistics')
  AND query ILIKE '%shipments%'
  AND query NOT ILIKE '%pg_stat_statements%'
ORDER BY calls DESC
LIMIT 10;
