#!/bin/bash
# Nightly backup (plan section 7): a full dump of the database into /backups (the folder the customer chose), KEEP_DAYS kept.
# Runs inside the `backup` container. The customer's IT may stop this container and use their own backups instead.
set -euo pipefail
while true; do
  now=$(date +%H%M)
  if [ "$now" = "0200" ]; then
    file="/backups/erp-$(date +%Y-%m-%d).dump"
    if pg_dump -h db -U postgres -d postgres -Fc -f "$file.part"; then
      mv "$file.part" "$file"
      echo "backup written: $file"
    else
      rm -f "$file.part"
      echo "BACKUP FAILED $(date)" >&2
    fi
    find /backups -name 'erp-*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
    sleep 61
  fi
  sleep 30
done
