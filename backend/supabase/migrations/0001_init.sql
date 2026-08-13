-- 0001_init.sql
-- Schema initialization for the content model.
-- `gen_random_uuid()` is provided by the core `pgcrypto` extension, which is
-- enabled by default on Supabase. It is re-asserted here for portability to
-- any PostgreSQL 14+ instance.

create extension if not exists pgcrypto;