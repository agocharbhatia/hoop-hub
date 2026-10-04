#!/bin/sh
set -eu
umask 077

# Newly mounted volumes start root-owned. Do not recursively traverse the database or media files on boot.
mkdir -p /data/exports /data/backups
chown node:node /data /data/exports /data/backups
chmod 700 /data /data/exports /data/backups
exec gosu node "$@"
