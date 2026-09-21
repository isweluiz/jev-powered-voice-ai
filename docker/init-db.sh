#!/bin/sh
set -eu
# The app owns its database but is not a PostgreSQL superuser.
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --set=app_password="$OSPREY_DB_PASSWORD" <<'SQL'
CREATE ROLE osprey LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE osprey OWNER osprey;
SQL
