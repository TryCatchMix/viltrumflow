#!/bin/sh
# Copias de seguridad de PostgreSQL para ViltrumFlow.
#
#   backup.sh once            hace una copia ahora y borra las antiguas
#   backup.sh loop            una copia al arrancar y después cada BACKUP_INTERVAL_HOURS (servicio «backup»)
#   backup.sh restore FICHERO restaura una copia (sustituye el contenido actual de la base de datos)
#
# La conexión se toma de las variables estándar PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

backup_once() {
  mkdir -p "$BACKUP_DIR"
  name="viltrumflow-$(date -u +%Y%m%d-%H%M%S).dump"
  tmp="$BACKUP_DIR/.$name.partial"
  # Formato «custom»: comprimido y restaurable de forma selectiva con pg_restore
  if ! pg_dump --format=custom --no-owner --no-acl --file="$tmp"; then
    rm -f "$tmp"
    log "ERROR: pg_dump ha fallado"
    return 1
  fi
  # Una copia que no se puede leer no es una copia: se comprueba antes de darla por buena
  if ! pg_restore --list "$tmp" >/dev/null; then
    rm -f "$tmp"
    log "ERROR: la copia generada no es legible"
    return 1
  fi
  mv "$tmp" "$BACKUP_DIR/$name"   # aparece con su nombre definitivo solo cuando está completa
  log "copia creada: $name ($(du -h "$BACKUP_DIR/$name" | cut -f1))"
  # Retención: solo se borran copias antiguas después de crear una nueva con éxito
  find "$BACKUP_DIR" -maxdepth 1 -name 'viltrumflow-*.dump' -type f -mtime "+$KEEP_DAYS" -exec rm -f {} \; -exec echo "[backup] eliminada copia antigua: {}" \;
  find "$BACKUP_DIR" -maxdepth 1 -name '.viltrumflow-*.partial' -type f -mmin +120 -exec rm -f {} \;
}

restore() {
  file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || { echo "Uso: backup.sh restore FICHERO.dump" >&2; exit 2; }
  log "restaurando $file sobre la base de datos «$PGDATABASE» (se reemplaza su contenido)"
  # En una sola transacción: si algo falla, la base de datos queda como estaba
  pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --dbname="$PGDATABASE" "$file"
  log "restauración completada"
}

case "${1:-once}" in
  once) backup_once ;;
  loop)
    log "copias cada ${INTERVAL_HOURS} h en $BACKUP_DIR; se conservan $KEEP_DAYS días"
    while true; do
      backup_once || log "se reintentará en el siguiente ciclo"
      sleep $((INTERVAL_HOURS * 3600))
    done ;;
  restore) restore "${2:-}" ;;
  *) echo "Uso: backup.sh [once|loop|restore FICHERO]" >&2; exit 2 ;;
esac
