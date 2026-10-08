-- Chạy một lần khi volume còn trống (docker-entrypoint-initdb.d). Schema ở file riêng để test nạp lại vào schema `lab_test`.
\i /lab/db/schema.sql
