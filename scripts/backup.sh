#!/usr/bin/env bash
# ==============================================================================
# Database Backup Script for Job Agent
# Dumps PostgreSQL database from docker container using pg_dump custom format.
# ==============================================================================

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Display usage instructions
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [OUTPUT_FILE]

Dumps the PostgreSQL database from the Docker container to a secure custom-format archive.

Options:
  -h, --help                Show this help message and exit
  --dir <directory>         Directory to store the backup (default: ${PROJECT_ROOT}/backups)
  --container <name>        Docker container name (default: job_agent_db)
  --database <name>         PostgreSQL database name (default: job_agent)
  --user <username>         PostgreSQL user (default: postgres)

Arguments:
  OUTPUT_FILE               Optional explicit destination path for the backup file.
                            If omitted, generates: <backup_dir>/job_agent_<db>_<timestamp>.dump

Environment Variables:
  POSTGRES_CONTAINER        Container name (overrides default)
  POSTGRES_USER             Database user (overrides default or .env)
  POSTGRES_PASSWORD         Database password (overrides default or .env)
  POSTGRES_DB               Database name (overrides default or .env)
  BACKUP_DIR                Default backup directory
  BACKUP_RETENTION_DAYS     Optional number of days to retain old backups in BACKUP_DIR
EOF
  exit 0
}

# Load environment variables from .env if present
ENV_FILE="${PROJECT_ROOT}/.env"
if [ -f "${ENV_FILE}" ]; then
  # Read variables while keeping existing shell exports intact
  while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip comments and empty lines
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key// }" ]] && continue
    # Trim leading/trailing whitespace
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | xargs)"
    # Strip quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    # Only set if not already set in environment
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
TARGET_BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
EXPLICIT_OUTPUT=""

# Parse command line flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      ;;
    --dir)
      TARGET_BACKUP_DIR="$2"
      shift 2
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
      if [ -z "${EXPLICIT_OUTPUT}" ]; then
        EXPLICIT_OUTPUT="$1"
        shift
      else
        echo "[ERROR] Unexpected argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

# Determine backup file path
if [ -n "${EXPLICIT_OUTPUT}" ]; then
  BACKUP_FILE="${EXPLICIT_OUTPUT}"
else
  TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
  BACKUP_FILE="${TARGET_BACKUP_DIR}/job_agent_${DB_NAME}_${TIMESTAMP}.dump"
fi

BACKUP_PARENT_DIR="$(dirname "${BACKUP_FILE}")"
mkdir -p "${BACKUP_PARENT_DIR}"

echo "=================================================="
echo "  PostgreSQL Database Backup: Job Agent"
echo "=================================================="
echo "Container:   ${CONTAINER_NAME}"
echo "Database:    ${DB_NAME}"
echo "User:        ${DB_USER}"
echo "Destination: ${BACKUP_FILE}"
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

# Prepare temporary working file for atomic backup creation
TEMP_BACKUP="${BACKUP_FILE}.tmp.$$"
cleanup() {
  if [ -f "${TEMP_BACKUP}" ]; then
    rm -f "${TEMP_BACKUP}"
  fi
}
trap cleanup EXIT INT TERM

echo "[*] Creating database dump via pg_dump (custom archive format)..."
# Dump with custom format (-F c), blobs (-b), and verbose output redirected
if ! docker exec -i -e PGPASSWORD="${DB_PASSWORD}" "${CONTAINER_NAME}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" -F c -b > "${TEMP_BACKUP}"; then
  echo "[ERROR] pg_dump failed to export database." >&2
  exit 1
fi

# Ensure backup file is non-empty
if [ ! -s "${TEMP_BACKUP}" ]; then
  echo "[ERROR] Backup file is empty. Dumping failed." >&2
  exit 1
fi

# Restrict file permissions to owner-only for security (contains confidential applicant/system data)
chmod 600 "${TEMP_BACKUP}"

echo "[*] Verifying backup archive integrity..."
if ! docker exec -i "${CONTAINER_NAME}" pg_restore --list < "${TEMP_BACKUP}" >/dev/null 2>&1; then
  echo "[ERROR] Backup verification failed. Dump file is corrupted." >&2
  exit 1
fi

# Move temporary file to final destination
mv "${TEMP_BACKUP}" "${BACKUP_FILE}"
trap - EXIT INT TERM

# Compute file metadata
BACKUP_SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
CHECKSUM="$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')"

echo "[✓] Backup completed and verified successfully!"
echo "    File Size: ${BACKUP_SIZE}"
echo "    SHA256:    ${CHECKSUM}"
echo "    Path:      ${BACKUP_FILE}"

# Optional retention policy cleanup
if [ -n "${BACKUP_RETENTION_DAYS:-}" ] && [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "[*] Applying retention policy: removing backups older than ${BACKUP_RETENTION_DAYS} days in ${TARGET_BACKUP_DIR}..."
  find "${TARGET_BACKUP_DIR}" -maxdepth 1 -name "*.dump" -type f -mtime +"${BACKUP_RETENTION_DAYS}" -exec rm -f {} +
fi

echo "=================================================="
