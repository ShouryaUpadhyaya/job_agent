#!/usr/bin/env bash
# ==============================================================================
# Database Restore Script for Job Agent
# Restores PostgreSQL database dump into Docker container via pg_restore.
# ==============================================================================

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Display usage instructions
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] <BACKUP_FILE>

Restores a PostgreSQL custom-format database archive into the Docker container.

Options:
  -h, --help                Show this help message and exit
  -f, --force               Skip interactive confirmation prompt
  --container <name>        Docker container name (default: job_agent_db)
  --database <name>         PostgreSQL database name (default: job_agent)
  --user <username>         PostgreSQL user (default: postgres)

Arguments:
  BACKUP_FILE               Path to the .dump file to restore (required)

Environment Variables:
  POSTGRES_CONTAINER        Container name (overrides default)
  POSTGRES_USER             Database user (overrides default or .env)
  POSTGRES_PASSWORD         Database password (overrides default or .env)
  POSTGRES_DB               Database name (overrides default or .env)
EOF
  exit 0
}

# Load environment variables from .env if present
ENV_FILE="${PROJECT_ROOT}/.env"
if [ -f "${ENV_FILE}" ]; then
  while IFS='=' read -r key value || [ -n "$key" ]; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key// }" ]] && continue
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | xargs)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    if [ -z "${!key+x}" ]; then
      export "${key}=${value}"
    fi
  done < "${ENV_FILE}"
fi

# Default configuration
CONTAINER_NAME="${POSTGRES_CONTAINER:-${CONTAINER_NAME:-job_agent_db}}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-job_agent}"
DB_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
FORCE=false
BACKUP_FILE=""

# Parse command line flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      ;;
    -f|--force)
      FORCE=true
      shift
      ;;
    --container)
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --database)
      DB_NAME="$2"
      shift 2
      ;;
    --user)
      DB_USER="$2"
      shift 2
      ;;
    -*)
      echo "[ERROR] Unknown option: $1" >&2
      echo "Run '$(basename "$0") --help' for usage." >&2
      exit 1
      ;;
    *)
      if [ -z "${BACKUP_FILE}" ]; then
        BACKUP_FILE="$1"
        shift
      else
        echo "[ERROR] Unexpected argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

# Validate input file argument
if [ -z "${BACKUP_FILE}" ]; then
  echo "[ERROR] Missing required BACKUP_FILE argument." >&2
  echo "Usage: $(basename "$0") [OPTIONS] <BACKUP_FILE>" >&2
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "[ERROR] Backup file not found: '${BACKUP_FILE}'" >&2
  exit 1
fi

if [ ! -r "${BACKUP_FILE}" ]; then
  echo "[ERROR] Cannot read backup file (permission denied): '${BACKUP_FILE}'" >&2
  exit 1
fi

echo "=================================================="
echo "  PostgreSQL Database Restore: Job Agent"
echo "=================================================="
echo "Container:   ${CONTAINER_NAME}"
echo "Database:    ${DB_NAME}"
echo "User:        ${DB_USER}"
echo "Backup File: ${BACKUP_FILE}"
echo "--------------------------------------------------"

# Pre-flight check: Docker binary
if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker CLI not found. Please install Docker." >&2
  exit 1
fi

# Pre-flight check: Container running
if ! docker ps --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}$"; then
  echo "[ERROR] Container '${CONTAINER_NAME}' is not currently running." >&2
  echo "        Please start the container with: docker compose up -d postgres" >&2
  exit 1
fi

# Pre-flight check: PostgreSQL readiness
if ! docker exec "${CONTAINER_NAME}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
  echo "[ERROR] PostgreSQL in container '${CONTAINER_NAME}' is not accepting connections." >&2
  exit 1
fi

# Pre-flight check: Verify archive validity before restoring
echo "[*] Validating backup archive format..."
if ! docker exec -i "${CONTAINER_NAME}" pg_restore --list < "${BACKUP_FILE}" >/dev/null 2>&1; then
  echo "[ERROR] Archive validation failed: '${BACKUP_FILE}' is not a valid pg_dump custom archive." >&2
  exit 1
fi
echo "[✓] Archive format is valid."

# Safety confirmation prompt
if [ "${FORCE}" = false ]; then
  if [ -t 0 ]; then
    echo ""
    echo "[WARNING] Restoring will overwrite existing tables and data in database '${DB_NAME}'."
    read -r -p "Are you sure you want to proceed? [y/N]: " confirmation
    case "${confirmation}" in
      [yY]|[yY][eE][sS])
        echo "[*] Confirmation received. Proceeding with restore..."
        ;;
      *)
        echo "[*] Restore cancelled by user."
        exit 0
        ;;
    esac
  else
    echo "[ERROR] Non-interactive shell detected. Use '--force' or '-f' flag to proceed." >&2
    exit 1
  fi
fi

echo "[*] Restoring database via pg_restore..."
# Run pg_restore with --clean --if-exists to replace existing tables cleanly.
# Note: pg_restore may return exit code 1 if non-critical warnings occur (e.g. DROP IF EXISTS on absent objects).
set +e
docker exec -i -e PGPASSWORD="${DB_PASSWORD}" "${CONTAINER_NAME}" \
  pg_restore -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges < "${BACKUP_FILE}"
RESTORE_STATUS=$?
set -e

if [ ${RESTORE_STATUS} -ne 0 ] && [ ${RESTORE_STATUS} -ne 1 ]; then
  echo "[ERROR] pg_restore failed with exit code ${RESTORE_STATUS}." >&2
  exit ${RESTORE_STATUS}
fi

echo "[*] Verifying database tables..."
TABLE_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")

echo "[✓] Database restoration completed successfully!"
echo "    Public Tables Found: ${TABLE_COUNT}"
echo ""
echo "Summary of restored relations:"
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "\dt"
echo "=================================================="
