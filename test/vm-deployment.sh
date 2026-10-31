#!/usr/bin/env bash
# Tests lifecycle orchestration, not Docker itself. Fixtures contain no game data.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$1"
mkdir -p "$workspace/bin"
export DOMINO_DEPLOY_DIR="$workspace/installed"
export VM_TEST_LOG="$workspace/docker.log"
export PATH="$workspace/bin:$PATH"
cat > "$workspace/bin/flock" <<'STUB'
#!/usr/bin/env bash
[[ "${VM_TEST_LOCKED:-0}" != 1 ]]
STUB
cat > "$workspace/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$VM_TEST_LOG"
if [[ "$1" == load ]]; then [[ "${VM_TEST_LOAD_FAIL:-0}" != 1 ]]; exit; fi
if [[ "$*" == *" up "* && "$*" == *"/v2/"* && "${VM_TEST_UNHEALTHY:-0}" == 1 ]]; then exit 1; fi
exit 0
STUB
chmod +x "$workspace/bin/docker" "$workspace/bin/flock"
release() {
  local name="$1" directory="$workspace/$1"
  mkdir -p "$directory"
  printf 'image %s\n' "$name" > "$directory/image.tar"
  printf 'DOMINO_IMAGE=domino-analytics:%s\n' "$name" > "$directory/image.env"
  cp "$root/deploy/vm/"{compose.yaml,dominoctl.sh,smoke.mjs} "$directory/"
  (cd "$directory" && sha256sum image.tar compose.yaml image.env dominoctl.sh smoke.mjs > SHA256SUMS)
}
ctl() { bash "$root/deploy/vm/dominoctl.sh" "$@"; }
release v1
release v2
ctl install "$workspace/v1"
[[ "$(cat "$DOMINO_DEPLOY_DIR/current")" == v1 ]]
printf 'keep\n' > "$DOMINO_DEPLOY_DIR/data/examples/keep.txt"
cp "$workspace/v2/image.tar" "$workspace/original.tar"
echo broken >> "$workspace/v2/image.tar"
if ctl update "$workspace/v2"; then echo 'Corruption accepted' >&2; exit 1; fi
[[ "$(cat "$DOMINO_DEPLOY_DIR/current")" == v1 ]]
cp "$workspace/original.tar" "$workspace/v2/image.tar"
if VM_TEST_LOAD_FAIL=1 ctl update "$workspace/v2"; then echo 'Load failure accepted' >&2; exit 1; fi
[[ "$(cat "$DOMINO_DEPLOY_DIR/current")" == v1 ]]
if VM_TEST_LOCKED=1 ctl update "$workspace/v2"; then echo 'Lock ignored' >&2; exit 1; fi
if VM_TEST_UNHEALTHY=1 ctl update "$workspace/v2"; then echo 'Unhealthy update accepted' >&2; exit 1; fi
[[ "$(cat "$DOMINO_DEPLOY_DIR/current")" == v1 ]]
[[ "$(tail -1 "$VM_TEST_LOG")" == *"/v1/"*" up "* ]]
ctl update "$workspace/v2"
[[ "$(cat "$DOMINO_DEPLOY_DIR/current")" == v2 ]]
[[ "$(cat "$DOMINO_DEPLOY_DIR/previous")" == v1 ]]
ctl rollback
[[ "$(cat "$DOMINO_DEPLOY_DIR/current")" == v1 ]]
[[ "$(cat "$DOMINO_DEPLOY_DIR/data/examples/keep.txt")" == keep ]]
echo altered >> "$workspace/v1/image.tar"
(cd "$workspace/v1" && sha256sum image.tar compose.yaml image.env dominoctl.sh smoke.mjs > SHA256SUMS)
if ctl update "$workspace/v1"; then echo 'Version collision accepted' >&2; exit 1; fi
if grep -Eq 'down.*-v|volume rm|system prune' "$VM_TEST_LOG"; then echo 'Destructive cleanup' >&2; exit 1; fi
echo 'VM lifecycle: install, corruption, load error, lock, health rollback, update and rollback — OK'
