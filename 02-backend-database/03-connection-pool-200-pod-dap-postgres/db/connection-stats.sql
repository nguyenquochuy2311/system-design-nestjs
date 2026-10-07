-- Kết nối đang mở tới PostgreSQL theo user và trạng thái (chạy bằng superuser nên vẫn vào được khi DB đã đầy).
SHOW max_connections;
SHOW superuser_reserved_connections;

SELECT usename, state, count(*) AS connections
FROM pg_stat_activity
WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
GROUP BY usename, state
ORDER BY usename, state;
